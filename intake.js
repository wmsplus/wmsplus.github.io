// intake.js
(function () {
    const form = document.getElementById('intakeForm');
    const formMsg = document.getElementById('formMsg');

    function showMsg(text, isError) {
        formMsg.textContent = text;
        formMsg.className = 'msg is-visible' + (isError ? ' is-error' : '');
    }

    // The Supabase CDN script may fail to load entirely (offline, corporate
    // proxy, network blocks). Without this guard, referencing `supabase`
    // below would throw a ReferenceError before any listener attaches, and
    // the page would look normal but be completely dead.
    if (typeof supabase === 'undefined') {
        showMsg('Не удалось загрузить форму. Проверьте подключение к интернету и обновите страницу.', true);
        return;
    }

    const SUPABASE_URL = 'https://bgphllmzmlwurfnbagho.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q';

    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const submitBtn = document.getElementById('submitBtn');
    const successScreen = document.getElementById('successScreen');
    const againBtn = document.getElementById('againBtn');

    function clearMsg() {
        formMsg.className = 'msg';
        formMsg.textContent = '';
    }

    function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // "Load failed" (Safari's generic network-error message) turned out to
    // keep happening intermittently even after compression -- the classic
    // signature of a flaky mobile connection or iOS pausing/killing an
    // in-flight request when the tab is backgrounded (screen lock, app
    // switch), not a code bug. Retrying a couple of times with a short
    // pause recovers from exactly that kind of transient failure, instead
    // of making the user re-fill and resubmit the whole form by hand.
    async function withRetry(attempts, statusPrefix, fn) {
        let lastError;
        for (let i = 0; i < attempts; i++) {
            if (i > 0) {
                showMsg(statusPrefix + ' (попытка ' + (i + 1) + ' из ' + attempts + ')...', false);
                await wait(1500);
            }
            try {
                return await fn();
            } catch (err) {
                lastError = err;
            }
        }
        throw lastError;
    }

    // Re-encodes the photo to a smaller JPEG before upload -- iPhone photos
    // (often several MB of HEIC) were failing mid-upload on mobile networks
    // with a generic "Load failed". Downscaling + re-compressing client-side
    // fixes both the wait and the failure rate. If decoding fails for any
    // reason (unsupported format, old browser), falls back to the original
    // file untouched rather than blocking the submission.
    async function compressImage(file) {
        try {
            const bitmap = await createImageBitmap(file);
            const maxSide = 1600;
            const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
            const width = Math.round(bitmap.width * scale);
            const height = Math.round(bitmap.height * scale);

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
            bitmap.close();

            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
            if (!blob) return file;

            const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
            return new File([blob], baseName + '.jpg', { type: 'image/jpeg' });
        } catch (err) {
            return file;
        }
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMsg();

        // Honeypot: bots fill every field, real users never see or fill this one.
        if (document.getElementById('c_addr_2').value) return;

        const itemText = document.getElementById('itemText').value.trim();
        const employeeId = document.getElementById('employeeId').value;
        const category = document.getElementById('category').value;
        const photoInput = document.getElementById('photo');
        const originalFile = photoInput.files[0];

        if (!itemText || !employeeId || !category || !originalFile) {
            showMsg('Заполните все поля.', true);
            return;
        }

        submitBtn.disabled = true;
        showMsg('Сжимаем фото...', false);

        const file = await compressImage(originalFile);

        if (file.size > 8 * 1024 * 1024) {
            showMsg('Фото слишком большое (максимум 8 МБ).', true);
            submitBtn.disabled = false;
            return;
        }

        try {
            const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
            const photoPath = Date.now() + '-' + crypto.randomUUID() + '.' + ext;

            await withRetry(3, 'Загрузка фото', async () => {
                showMsg('Загрузка фото...', false);
                const { error } = await supabaseClient.storage
                    .from('intake-photos')
                    .upload(photoPath, file, { contentType: file.type || 'image/jpeg' });
                if (error) throw error;
            });

            await withRetry(3, 'Сохранение', async () => {
                showMsg('Сохранение...', false);
                const { error } = await supabaseClient
                    .from('intake_submissions')
                    .insert({
                        item_text: itemText,
                        employee_id: Number(employeeId),
                        category: category,
                        photo_path: photoPath,
                    });
                if (error) throw error;
            });

            form.reset();
            form.style.display = 'none';
            successScreen.classList.add('is-visible');
        } catch (err) {
            showMsg('Не получилось отправить (проверьте связь и попробуйте ещё раз): ' + (err.message || 'ошибка сети'), true);
            submitBtn.disabled = false;
        }
    });

    againBtn.addEventListener('click', () => {
        successScreen.classList.remove('is-visible');
        form.style.display = '';
        submitBtn.disabled = false;
        clearMsg();
    });
})();
