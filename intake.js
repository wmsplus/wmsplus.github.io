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

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMsg();

        // Honeypot: bots fill every field, real users never see or fill this one.
        if (document.getElementById('c_addr_2').value) return;

        const itemText = document.getElementById('itemText').value.trim();
        const employeeId = document.getElementById('employeeId').value;
        const category = document.getElementById('category').value;
        const photoInput = document.getElementById('photo');
        const file = photoInput.files[0];

        if (!itemText || !employeeId || !category || !file) {
            showMsg('Заполните все поля.', true);
            return;
        }

        submitBtn.disabled = true;
        showMsg('Отправка...', false);

        if (file.size > 8 * 1024 * 1024) {
            showMsg('Фото слишком большое (максимум 8 МБ).', true);
            submitBtn.disabled = false;
            return;
        }

        try {
            const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
            const photoPath = Date.now() + '-' + crypto.randomUUID() + '.' + ext;

            const { error: uploadError } = await supabaseClient.storage
                .from('intake-photos')
                .upload(photoPath, file, { contentType: file.type || 'image/jpeg' });
            if (uploadError) throw uploadError;

            const { error: insertError } = await supabaseClient
                .from('intake_submissions')
                .insert({
                    item_text: itemText,
                    employee_id: Number(employeeId),
                    category: category,
                    photo_path: photoPath,
                });
            if (insertError) throw insertError;

            form.reset();
            form.style.display = 'none';
            successScreen.classList.add('is-visible');
        } catch (err) {
            showMsg('Не получилось отправить: ' + (err.message || 'ошибка сети'), true);
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
