// intake.js
(function () {
    if (typeof supabase === 'undefined') {
        document.body.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:center;height:100dvh;padding:24px;text-align:center;font-family:sans-serif;color:#ef4444;font-weight:600;">Не удалось загрузить форму. Проверьте подключение к интернету и обновите страницу.</div>';
        return;
    }

    const SUPABASE_URL = 'https://bgphllmzmlwurfnbagho.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q';
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const CATEGORIES = [
        { name: 'Одежда', emoji: '👕' },
        { name: 'Обувь', emoji: '👟' },
        { name: 'Косметика', emoji: '💄' },
        { name: 'Бытовая химия', emoji: '🧴' },
        { name: 'Мебель', emoji: '🛋️' },
        { name: 'Электроника', emoji: '🔌' },
        { name: 'Ювелирка', emoji: '💍' },
        { name: 'Для авто', emoji: '🚗' },
        { name: 'Для животных', emoji: '🐾' },
        { name: 'Посуда', emoji: '🍽️' },
        { name: 'Еда', emoji: '🍎' },
        { name: 'Посылка', emoji: '📦' },
        { name: 'КГТ', emoji: '📏' },
    ];

    const LS_EMPLOYEE_ID = 'wmsplus_intake_employee_id';
    const LS_FULL_NAME = 'wmsplus_intake_full_name';
    const LS_AREA = 'wmsplus_intake_area';

    const screens = Array.from(document.querySelectorAll('.screen'));
    function showScreen(id) {
        screens.forEach((s) => s.classList.toggle('is-active', s.id === id));
    }

    function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // "Load failed" (Safari's generic network-error message) happens
    // intermittently on flaky mobile connections / iOS pausing an
    // in-flight request when the tab backgrounds -- not a code bug.
    // Retrying recovers from exactly that kind of transient failure.
    async function withRetry(attempts, statusPrefix, onStatus, fn) {
        let lastError;
        for (let i = 0; i < attempts; i++) {
            if (i > 0) {
                onStatus(statusPrefix + ' (попытка ' + (i + 1) + ' из ' + attempts + ')...');
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

    // Re-encodes the photo to a smaller JPEG before upload -- iPhone
    // photos (often several MB of HEIC) were failing/slow on mobile
    // networks. Falls back to the original file if decoding fails.
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

    const state = {
        employeeId: localStorage.getItem(LS_EMPLOYEE_ID),
        fullName: localStorage.getItem(LS_FULL_NAME),
        area: localStorage.getItem(LS_AREA),
        category: null,
        itemText: null,
    };

    function updateAreaPills() {
        document.getElementById('areaPillCategoryText').textContent = state.area || '';
        document.getElementById('areaPillNameText').textContent = state.area || '';
        document.getElementById('areaPillPhotoText').textContent = state.area || '';
    }

    function goToStart() {
        if (!state.employeeId || !state.fullName) {
            showScreen('screenId');
        } else if (!state.area) {
            showScreen('screenArea');
        } else {
            updateAreaPills();
            showScreen('screenCategory');
        }
    }

    // ---------- Screen: ID ----------
    const idInput = document.getElementById('idInput');
    const idMsg = document.getElementById('idMsg');
    function submitId() {
        const val = idInput.value.trim();
        if (!val || Number(val) <= 0) {
            idMsg.textContent = 'Введите корректный ID.';
            idMsg.className = 'msg is-error';
            return;
        }
        state.employeeId = val;
        localStorage.setItem(LS_EMPLOYEE_ID, val);
        idMsg.textContent = '';
        idMsg.className = 'msg';
        showScreen('screenName');
    }
    document.getElementById('idNextBtn').addEventListener('click', submitId);
    idInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitId(); });

    // ---------- Screen: full name ----------
    const nameInput = document.getElementById('nameInput');
    const nameMsg = document.getElementById('nameMsg');
    function submitName() {
        const val = nameInput.value.trim();
        if (!val) {
            nameMsg.textContent = 'Введите ФИО.';
            nameMsg.className = 'msg is-error';
            return;
        }
        state.fullName = val;
        localStorage.setItem(LS_FULL_NAME, val);
        nameMsg.textContent = '';
        nameMsg.className = 'msg';
        if (state.area) {
            updateAreaPills();
            showScreen('screenCategory');
        } else {
            showScreen('screenArea');
        }
    }
    document.getElementById('nameNextBtn').addEventListener('click', submitName);
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitName(); });

    // ---------- Screen: area ----------
    document.querySelectorAll('.area-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            state.area = btn.dataset.area;
            localStorage.setItem(LS_AREA, state.area);
            updateAreaPills();
            showScreen('screenCategory');
        });
    });
    document.getElementById('changeUserBtn').addEventListener('click', () => {
        localStorage.removeItem(LS_EMPLOYEE_ID);
        localStorage.removeItem(LS_FULL_NAME);
        localStorage.removeItem(LS_AREA);
        state.employeeId = null;
        state.fullName = null;
        state.area = null;
        idInput.value = '';
        nameInput.value = '';
        showScreen('screenId');
    });

    // ---------- Area pill (pencil) on wizard screens ----------
    ['areaPillCategory', 'areaPillName', 'areaPillPhoto'].forEach((id) => {
        document.getElementById(id).addEventListener('click', () => showScreen('screenArea'));
    });

    // ---------- Wizard step 1: category grid ----------
    const categoryGrid = document.getElementById('categoryGrid');
    const itemNameInput = document.getElementById('itemNameInput');
    const itemNameMsg = document.getElementById('itemNameMsg');
    CATEGORIES.forEach((cat) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'category-btn';
        btn.innerHTML = '<span class="category-emoji">' + cat.emoji + '</span><span class="category-label">' + cat.name + '</span>';
        btn.addEventListener('click', () => {
            state.category = cat.name;
            document.getElementById('selectedCategoryLine').innerHTML =
                '<span class="emoji">' + cat.emoji + '</span><span>' + cat.name + '</span>';
            itemNameInput.value = '';
            itemNameMsg.textContent = '';
            itemNameMsg.className = 'msg';
            showScreen('screenItemName');
        });
        categoryGrid.appendChild(btn);
    });

    // ---------- Wizard step 2: item name ----------
    function submitItemName() {
        const val = itemNameInput.value.trim();
        if (!val) {
            itemNameMsg.textContent = 'Введите наименование.';
            itemNameMsg.className = 'msg is-error';
            return;
        }
        state.itemText = val;
        itemNameMsg.textContent = '';
        itemNameMsg.className = 'msg';
        showScreen('screenPhoto');
    }
    document.getElementById('itemNameNextBtn').addEventListener('click', submitItemName);
    itemNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitItemName(); });
    document.getElementById('backToCategoryBtn').addEventListener('click', () => showScreen('screenCategory'));

    // ---------- Wizard step 3: photo ----------
    const photoInput = document.getElementById('photoInput');
    const photoMsg = document.getElementById('photoMsg');
    const photoPickBtn = document.getElementById('photoPickBtn');
    const skipPhotoBtn = document.getElementById('skipPhotoBtn');
    document.getElementById('backToNameBtn').addEventListener('click', () => showScreen('screenItemName'));

    photoPickBtn.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', () => {
        const file = photoInput.files[0];
        if (file) submitEntry(file);
    });
    skipPhotoBtn.addEventListener('click', () => submitEntry(null));

    async function submitEntry(rawFile) {
        // Honeypot: bots fill every field, real users never see or fill this one.
        if (document.getElementById('c_addr_2').value) return;

        photoPickBtn.disabled = true;
        skipPhotoBtn.disabled = true;
        photoMsg.className = 'msg';
        photoMsg.textContent = '';

        try {
            let photoPath = null;

            if (rawFile) {
                photoMsg.textContent = 'Сжимаем фото...';
                const file = await compressImage(rawFile);
                if (file.size > 8 * 1024 * 1024) {
                    photoMsg.textContent = 'Фото слишком большое (максимум 8 МБ).';
                    photoMsg.className = 'msg is-error';
                    return;
                }
                const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
                photoPath = Date.now() + '-' + crypto.randomUUID() + '.' + ext;

                await withRetry(3, 'Загрузка фото', (m) => { photoMsg.textContent = m; }, async () => {
                    photoMsg.textContent = 'Загрузка фото...';
                    const { error } = await supabaseClient.storage
                        .from('intake-photos')
                        .upload(photoPath, file, { contentType: file.type || 'image/jpeg' });
                    if (error) throw error;
                });
            }

            await withRetry(3, 'Сохранение', (m) => { photoMsg.textContent = m; }, async () => {
                photoMsg.textContent = 'Сохранение...';
                const { error } = await supabaseClient
                    .from('intake_submissions')
                    .insert({
                        item_text: state.itemText,
                        employee_id: Number(state.employeeId),
                        full_name: state.fullName,
                        area: state.area,
                        category: state.category,
                        photo_path: photoPath,
                    });
                if (error) throw error;
            });

            showScreen('screenSuccess');
        } catch (err) {
            photoMsg.textContent = 'Не получилось отправить (проверьте связь и попробуйте ещё раз): ' + (err.message || 'ошибка сети');
            photoMsg.className = 'msg is-error';
        } finally {
            photoPickBtn.disabled = false;
            skipPhotoBtn.disabled = false;
            photoInput.value = '';
        }
    }

    document.getElementById('againBtn').addEventListener('click', () => {
        state.category = null;
        state.itemText = null;
        showScreen('screenCategory');
    });

    goToStart();
})();
