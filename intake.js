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

    const CATEGORIES_SMALL = [
        { name: 'Одежда', emoji: '👕' },
        { name: 'Обувь', emoji: '👟' },
        { name: 'Косметика', emoji: '💄' },
        { name: 'Бытовая химия', emoji: '🧴' },
        { name: 'Электроника', emoji: '🔌' },
        { name: 'Ювелирка', emoji: '💍' },
        { name: 'Для авто', emoji: '🚗' },
        { name: 'Для животных', emoji: '🐾' },
        { name: 'Посуда', emoji: '🍽️' },
        { name: 'Еда', emoji: '🍎' },
        { name: 'Посылка', emoji: '📦' },
        { name: 'Другое', emoji: '🧩' },
    ];
    const CATEGORIES_KGT = [
        { name: 'Обувь', emoji: '👟' },
        { name: 'Бытовая химия', emoji: '🧴' },
        { name: 'Мебель', emoji: '🛋️' },
        { name: 'Электроника', emoji: '🔌' },
        { name: 'Для авто', emoji: '🚗' },
        { name: 'Для животных', emoji: '🐾' },
        { name: 'Посуда', emoji: '🍽️' },
        { name: 'Еда', emoji: '🍎' },
        { name: 'Посылка', emoji: '📦' },
        { name: 'Другое', emoji: '🧩' },
    ];

    const LS_EMPLOYEE_ID = 'wmsplus_intake_employee_id';
    const LS_FULL_NAME = 'wmsplus_intake_full_name';
    const LS_AREA = 'wmsplus_intake_area';

    const screens = Array.from(document.querySelectorAll('.screen'));
    function showScreen(id) {
        screens.forEach((s) => s.classList.toggle('is-active', s.id === id));
        void refreshShiftCounter();
    }

    // Упаковка has no shift-box concept (every item there is bucketed,
    // never counted into a shift box) -- hide the counter entirely there.
    async function refreshShiftCounter() {
        const els = document.querySelectorAll('[data-shift-counter]');
        if (!els.length) return;
        if (!state.area || state.area === 'Упаковка') {
            els.forEach((el) => { el.style.display = 'none'; });
            return;
        }
        const shift = computeShift();
        const { data, error } = await supabaseClient
            .from('wms_no_shk_boxes')
            .select('total_items')
            .eq('area', state.area)
            .eq('shift_date', shift.date)
            .eq('shift_type', shift.type)
            .eq('outside_opp', true)
            .maybeSingle();
        els.forEach((el) => {
            el.style.display = '';
            el.textContent = 'За смену зафиксировано: ' + (error || !data ? 0 : data.total_items);
        });
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
        itemType: null,
        category: null,
        itemText: null,
        photoPath: null,
        stickerCode: null,
        spillFlag: false,
    };

    // Priority when more than one trigger applies to the same item: Шредер
    // > Бытовая химия (Товар льётся) > участок Упаковка. See spec Part A.1.
    function needsStickerFlow() {
        return state.itemType === 'Шредер' || state.area === 'Упаковка' || state.spillFlag;
    }

    function computeNoShkBucket() {
        if (state.itemType === 'Шредер') return 'Шредер';
        if (state.spillFlag) return 'Брак Бытовая химия';
        if (state.area === 'Упаковка') return 'Товар с переупаковки';
        return 'Короб смены';
    }

    let photoBackTarget = 'screenCategory';
    let qrStream = null;
    let qrAnimFrame = null;
    let qrScanCancelled = false;

    function updateAreaPills() {
        [
            'areaPillEntryText', 'areaPillTypeText', 'areaPillCategoryText', 'areaPillNameText',
            'areaPillPhotoText', 'areaPillStickerText', 'areaPill2ShkText', 'areaPillEmptyText',
            'areaPillStickerSavedText', 'areaPillInstrText', 'areaPillHubText',
        ].forEach((id) => {
            document.getElementById(id).textContent = state.area || '';
        });
    }

    function pad2(n) { return String(n).padStart(2, '0'); }
    function formatDate(d) { return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1); }
    function isoDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

    // Single source of truth for the 8:00/20:00 shift boundary -- both the
    // header label (formatted for display) and the shift_date/shift_type
    // saved on every submission (shift boxes, Task 6-7) come from here so
    // they can never drift apart.
    function computeShift() {
        const now = new Date();
        const hour = now.getHours();
        if (hour >= 8 && hour < 20) {
            return { date: isoDate(now), type: 'Дневная', label: formatDate(now) + ' · Дневная смена' };
        }
        let start, end;
        if (hour >= 20) {
            start = now;
            end = new Date(now);
            end.setDate(end.getDate() + 1);
        } else {
            end = now;
            start = new Date(now);
            start.setDate(start.getDate() - 1);
        }
        return { date: isoDate(start), type: 'Ночная', label: formatDate(start) + '-' + formatDate(end) + ' · Ночная смена' };
    }

    function shiftLabel() {
        return computeShift().label;
    }

    function renderQrInto(containerId, text) {
        const el = document.getElementById(containerId);
        if (!el) return;
        el.innerHTML = '';
        if (typeof QRCode === 'undefined') {
            el.textContent = text;
            return;
        }
        new QRCode(el, { text: text, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
    }

    const AREA_INSTR_CODES = {
        'ХАБ': { mx: 'PLCE1034816435', wct: 'WCT1000100010', destination: 'на Идентификацию' },
        'Упаковка': { mx: 'PLCE1034816436', wct: 'WCT700100010', destination: 'на переупаковку' },
    };
    function areaInstrCodes() {
        return AREA_INSTR_CODES[state.area] || AREA_INSTR_CODES['ХАБ'];
    }

    const INSTRUCTIONS_FULL = [
        { text: () => 'Войдите в ТСД под своим бейджиком.' },
        { text: () => 'Перейдите в модуль «Стол старшего».' },
        { text: () => 'Перейдите в процесс «Стол старшего».' },
        { text: () => 'Отсканируйте МХ Стола руководителя.', qr: () => areaInstrCodes().mx },
        { text: () => 'Отсканируйте тару ПЕРЕУПАКОВКИ, если нужно.', qr: () => areaInstrCodes().wct },
        { text: () => 'Не сканируйте тару сортировки, нажмите «Пропустить».' },
        { text: () => 'Далее в интерфейсе нажмите «Нет стикера», затем «Нет баркода», затем «Нет акциза».' },
        { text: () => 'Далее необходимо отсканировать приклеенный ранее на вещь стикер.' },
        { text: () => 'Отсканируйте тару ПЕРЕУПАКОВКИ.', qr: () => areaInstrCodes().wct },
        { text: () => 'Отнесите товар ' + areaInstrCodes().destination + '.' },
    ];

    const INSTRUCTIONS_SHORT = [
        { text: () => 'Отсканируйте МХ Стола руководителя.', qr: () => areaInstrCodes().mx },
        { text: () => 'Отсканируйте тару ПЕРЕУПАКОВКИ, если нужно.', qr: () => areaInstrCodes().wct },
        { text: () => 'Отсканируйте приклеенный ранее на вещь стикер.' },
        { text: () => 'Отсканируйте тару ПЕРЕУПАКОВКИ и передайте товар ' + areaInstrCodes().destination + '.', qr: () => areaInstrCodes().wct },
    ];

    function renderInstrSlide() {
        const steps = state.instrSequence;
        const i = state.instrIndex;
        const step = steps[i];
        document.getElementById('instrStepIndicator').textContent = 'Шаг ' + (i + 1) + ' из ' + steps.length;
        document.getElementById('instrStepText').textContent = step.text();
        const qrSlot = document.getElementById('instrQrSlot');
        qrSlot.innerHTML = '';
        if (step.qr) {
            renderQrInto('instrQrSlot', step.qr());
        }
        document.getElementById('instrNextBtn').textContent = (i === steps.length - 1) ? 'Завершить' : 'Далее';
    }

    function startInstructions(sequence) {
        state.instrSequence = sequence;
        state.instrIndex = 0;
        renderInstrSlide();
        showScreen('screenInstrSlide');
    }

    document.getElementById('instrFullBtn').addEventListener('click', () => startInstructions(INSTRUCTIONS_FULL));
    document.getElementById('instrSkipBtn').addEventListener('click', () => startInstructions(INSTRUCTIONS_SHORT));

    document.getElementById('instrNextBtn').addEventListener('click', () => {
        const steps = state.instrSequence;
        if (state.instrIndex === steps.length - 1) {
            state.itemType = null;
            state.category = null;
            state.itemText = null;
            state.photoPath = null;
            state.stickerCode = null;
            state.spillFlag = false;
            showScreen('screenEntryType');
            return;
        }
        state.instrIndex += 1;
        renderInstrSlide();
    });

    document.getElementById('backToInstrPrevBtn').addEventListener('click', () => {
        if (state.instrIndex === 0) {
            showScreen('screenStickerSaved');
        } else {
            state.instrIndex -= 1;
            renderInstrSlide();
        }
    });

    document.getElementById('hubBackBtn').addEventListener('click', () => {
        state.itemType = null;
        state.category = null;
        state.itemText = null;
        state.photoPath = null;
        state.stickerCode = null;
        state.spillFlag = false;
        showScreen('screenEntryType');
    });

    function updateShiftHeaders() {
        const label = shiftLabel();
        [
            'shiftHeaderEntry', 'shiftHeaderType', 'shiftHeaderCategory',
            'shiftHeaderName', 'shiftHeaderPhoto', 'shiftHeaderSticker',
            'shiftHeader2Shk', 'shiftHeaderEmpty',
            'shiftHeaderStickerSaved', 'shiftHeaderInstr', 'shiftHeaderHub',
        ].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.textContent = label;
        });
    }

    function goToStart() {
        if (!state.employeeId || !state.fullName) {
            showScreen('screenId');
        } else if (!state.area) {
            showScreen('screenArea');
        } else {
            updateAreaPills();
            updateShiftHeaders();
            showScreen('screenEntryType');
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
            updateShiftHeaders();
            showScreen('screenEntryType');
        } else {
            showScreen('screenArea');
        }
    }
    document.getElementById('nameNextBtn').addEventListener('click', submitName);
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitName(); });

    // ---------- Screen: area ----------
    // Selected via [data-area] (not the shared .area-btn class, which is
    // reused for visual style only by the type-selection buttons on
    // screenItemType and the entry-type buttons on screenEntryType --
    // those are NOT area buttons and must not trigger this handler).
    document.querySelectorAll('[data-area]').forEach((btn) => {
        btn.addEventListener('click', () => {
            state.area = btn.dataset.area;
            localStorage.setItem(LS_AREA, state.area);
            updateAreaPills();
            updateShiftHeaders();
            showScreen('screenEntryType');
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
    [
        'areaPillEntry', 'areaPillType', 'areaPillCategory', 'areaPillName',
        'areaPillPhoto', 'areaPillSticker', 'areaPill2Shk', 'areaPillEmpty',
        'areaPillStickerSaved', 'areaPillInstr', 'areaPillHub',
    ].forEach((id) => {
        document.getElementById(id).addEventListener('click', () => {
            stopQrScan();
            showScreen('screenArea');
        });
    });

    // ---------- Entry-type screen ----------
    document.querySelectorAll('[data-entry]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const entry = btn.dataset.entry;
            if (entry === 'no-shk') {
                showScreen('screenItemType');
            } else if (entry === 'two-shk') {
                shkCorrectInput.value = '';
                shkWrongInput.value = '';
                shk2Msg.textContent = '';
                shk2Msg.className = 'msg';
                resetShk2Photos();
                showScreen('screen2Shk');
            } else if (entry === 'empty-package') {
                shkEmptyInput.value = '';
                emptyMsg.textContent = '';
                emptyMsg.className = 'msg';
                resetEmptyPhotos();
                showScreen('screenEmptyPackage');
            }
        });
    });
    document.getElementById('backToEntryTypeBtn').addEventListener('click', () => showScreen('screenEntryType'));
    document.getElementById('backToEntryFrom2ShkBtn').addEventListener('click', () => showScreen('screenEntryType'));
    document.getElementById('backToEntryFromEmptyBtn').addEventListener('click', () => showScreen('screenEntryType'));

    // ---------- Wizard step 0: item type ----------
    document.querySelectorAll('[data-type]').forEach((btn) => {
        btn.addEventListener('click', () => {
            state.stickerCode = null;
            state.itemType = btn.dataset.type;
            if (state.itemType === 'Шредер' && state.area === 'Маркетплейс') {
                state.category = null;
                state.itemText = null;
                showScreen('screenTakeToHub');
            } else if (state.itemType === 'Шредер') {
                state.category = null;
                state.itemText = null;
                photoBackTarget = 'screenItemType';
                clearPhotoMsg();
                showScreen('screenPhoto');
            } else {
                renderCategoryGrid(state.itemType === 'КГТ' ? CATEGORIES_KGT : CATEGORIES_SMALL);
                showScreen('screenCategory');
            }
        });
    });
    document.getElementById('backToTypeBtn').addEventListener('click', () => showScreen('screenItemType'));

    // ---------- Wizard step 1: category grid ----------
    const categoryGrid = document.getElementById('categoryGrid');
    const itemNameInput = document.getElementById('itemNameInput');
    const itemNameMsg = document.getElementById('itemNameMsg');
    function renderCategoryGrid(list) {
        categoryGrid.innerHTML = '';
        list.forEach((cat) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'category-btn';
            btn.innerHTML = '<span class="category-emoji">' + cat.emoji + '</span><span class="category-label">' + cat.name + '</span>';
            btn.addEventListener('click', () => {
                state.category = cat.name;
                state.spillFlag = false;
                document.getElementById('selectedCategoryLine').innerHTML =
                    '<span class="emoji">' + cat.emoji + '</span><span>' + cat.name + '</span>';
                if (cat.name === 'Посылка') {
                    state.itemText = null;
                    photoBackTarget = 'screenCategory';
                    clearPhotoMsg();
                    showScreen('screenPhoto');
                } else {
                    itemNameInput.value = '';
                    itemNameMsg.textContent = '';
                    itemNameMsg.className = 'msg';
                    document.getElementById('spillBtn').style.display = (cat.name === 'Бытовая химия') ? 'block' : 'none';
                    showScreen('screenItemName');
                }
            });
            categoryGrid.appendChild(btn);
        });
    }

    // ---------- Wizard step 2: item name ----------
    function validateItemName() {
        const val = itemNameInput.value.trim();
        if (!val) {
            itemNameMsg.textContent = 'Введите наименование.';
            itemNameMsg.className = 'msg is-error';
            return false;
        }
        state.itemText = val;
        itemNameMsg.textContent = '';
        itemNameMsg.className = 'msg';
        return true;
    }

    function submitItemName() {
        if (!validateItemName()) return;
        state.spillFlag = false;
        photoBackTarget = 'screenItemName';
        clearPhotoMsg();
        showScreen('screenPhoto');
    }
    document.getElementById('itemNameNextBtn').addEventListener('click', submitItemName);
    itemNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitItemName(); });
    document.getElementById('backToCategoryBtn').addEventListener('click', () => showScreen('screenCategory'));

    document.getElementById('spillBtn').addEventListener('click', () => {
        if (!validateItemName()) return;
        state.spillFlag = true;
        if (state.area === 'Маркетплейс') {
            showScreen('screenTakeToHub');
            return;
        }
        photoBackTarget = 'screenItemName';
        clearPhotoMsg();
        showScreen('screenPhoto');
    });

    // ---------- Wizard step 3: photo ----------
    const photoInput = document.getElementById('photoInput');
    const photoMsg = document.getElementById('photoMsg');
    const photoPickBtn = document.getElementById('photoPickBtn');
    function clearPhotoMsg() {
        photoMsg.textContent = '';
        photoMsg.className = 'msg';
    }
    document.getElementById('backToNameBtn').addEventListener('click', () => showScreen(photoBackTarget));

    photoPickBtn.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', () => {
        const file = photoInput.files[0];
        if (file) handlePhoto(file);
    });

    async function handlePhoto(rawFile) {
        // Honeypot: bots fill every field, real users never see or fill this one.
        if (document.getElementById('c_addr_2').value) return;

        photoPickBtn.disabled = true;
        photoMsg.className = 'msg';
        photoMsg.textContent = '';

        // Check jsQR availability before spending an upload on a Шредер
        // submission that can't proceed to the scan step anyway.
        if (needsStickerFlow() && typeof jsQR === 'undefined') {
            photoMsg.textContent = 'Не удалось загрузить сканер QR. Проверьте подключение к интернету и обновите страницу.';
            photoMsg.className = 'msg is-error';
            photoPickBtn.disabled = false;
            photoInput.value = '';
            return;
        }

        try {
            photoMsg.textContent = 'Сжимаем фото...';
            const file = await compressImage(rawFile);
            if (file.size > 8 * 1024 * 1024) {
                photoMsg.textContent = 'Фото слишком большое (максимум 8 МБ).';
                photoMsg.className = 'msg is-error';
                return;
            }
            const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
            const photoPath = Date.now() + '-' + crypto.randomUUID() + '.' + ext;

            await withRetry(3, 'Загрузка фото', (m) => { photoMsg.textContent = m; }, async () => {
                photoMsg.textContent = 'Загрузка фото...';
                const { error } = await supabaseClient.storage
                    .from('intake-photos')
                    .upload(photoPath, file, { contentType: file.type || 'image/jpeg' });
                if (error) throw error;
            });

            state.photoPath = photoPath;

            if (needsStickerFlow()) {
                showScreen('screenStickerScan');
                startQrScan();
            } else {
                await finalizeSubmit(photoMsg);
            }
        } catch (err) {
            photoMsg.textContent = 'Не получилось отправить (проверьте связь и попробуйте ещё раз): ' + (err.message || 'ошибка сети');
            photoMsg.className = 'msg is-error';
        } finally {
            photoPickBtn.disabled = false;
            photoInput.value = '';
        }
    }

    // ---------- Wizard step 4 (Шредер only): sticker QR scan ----------
    const stickerMsg = document.getElementById('stickerMsg');

    function stopQrScan() {
        qrScanCancelled = true;
        if (qrAnimFrame) {
            cancelAnimationFrame(qrAnimFrame);
            qrAnimFrame = null;
        }
        if (qrStream) {
            qrStream.getTracks().forEach((t) => t.stop());
            qrStream = null;
        }
    }

    async function startQrScan() {
        qrScanCancelled = false;
        stickerMsg.textContent = '';
        stickerMsg.className = 'msg';
        if (typeof jsQR === 'undefined') {
            stickerMsg.textContent = 'Не удалось загрузить сканер QR. Проверьте подключение к интернету и обновите страницу.';
            stickerMsg.className = 'msg is-error';
            return;
        }
        const video = document.getElementById('qrVideo');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            if (qrScanCancelled) {
                stream.getTracks().forEach((t) => t.stop());
                return;
            }
            qrStream = stream;
            video.srcObject = qrStream;
            await video.play();
            if (qrScanCancelled) return;
            qrAnimFrame = requestAnimationFrame(scanQrFrame);
        } catch (err) {
            if (qrScanCancelled) return;
            stickerMsg.textContent = 'Не удалось открыть камеру: ' + (err.message || 'нет доступа');
            stickerMsg.className = 'msg is-error';
        }
    }

    function scanQrFrame() {
        const video = document.getElementById('qrVideo');
        const canvas = document.getElementById('qrCanvas');
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            if (code && code.data) {
                // Our stickers are generated by shk_generator.js, whose
                // codes always start with "*" -- anything else is a
                // random/unrelated QR someone pointed the camera at, not
                // one of our stickers. Reject it and keep scanning
                // instead of saving a garbage sticker_code.
                if (code.data.charAt(0) !== '*') {
                    stickerMsg.textContent = 'Это не наш стикер (должен начинаться с «*»). Отсканируйте стикер, выданный складом.';
                    stickerMsg.className = 'msg is-error';
                    qrAnimFrame = requestAnimationFrame(scanQrFrame);
                    return;
                }
                stopQrScan();
                state.stickerCode = code.data;
                document.getElementById('backToPhotoFromScanBtn').disabled = true;
                finalizeSubmit(stickerMsg);
                return;
            }
        }
        qrAnimFrame = requestAnimationFrame(scanQrFrame);
    }

    document.getElementById('backToPhotoFromScanBtn').addEventListener('click', () => {
        stopQrScan();
        clearPhotoMsg();
        showScreen('screenPhoto');
    });

    document.getElementById('retryQrScanBtn').addEventListener('click', () => startQrScan());

    async function finalizeSubmit(msgEl) {
        try {
            const shift = computeShift();

            // For shift-box items (no sticker), log into the box FIRST so
            // the returned box_id can be stamped onto the submission row
            // itself -- that's the only precise link between a row and
            // the exact box it landed in (matching by area/shift/date
            // alone is ambiguous once a box has been through "Принесено"
            // mid-shift, or against a manually-created box sharing the
            // same triple). Non-fatal: a failed call here just leaves
            // box_id null, same as before this call existed.
            let boxId = null;
            if (!state.stickerCode) {
                const { data: rpcData, error: rpcError } = await supabaseClient.rpc('wms_no_shk_box_log_item', {
                    p_area: state.area,
                    p_shift_date: shift.date,
                    p_shift_type: shift.type,
                    p_full_name: state.fullName,
                });
                if (rpcError) {
                    console.warn('wms_no_shk_box_log_item failed:', rpcError);
                } else if (rpcData && rpcData[0]) {
                    boxId = rpcData[0].box_id;
                }
            }

            // intake_submissions is insert-only for anon (no SELECT grant --
            // see this repo's access-model notes), and Postgres' INSERT ...
            // RETURNING needs SELECT privilege even via PostgREST's
            // .select() chaining, so the id can't be read back after
            // inserting. Generate it client-side instead, overriding the
            // column's own gen_random_uuid() default, so it's known
            // up-front for the sticker-history write below.
            const submissionId = crypto.randomUUID();
            await withRetry(3, 'Сохранение', (m) => { msgEl.textContent = m; }, async () => {
                msgEl.textContent = 'Сохранение...';
                const { error } = await supabaseClient
                    .from('intake_submissions')
                    .insert({
                        id: submissionId,
                        item_text: state.itemText,
                        employee_id: Number(state.employeeId),
                        full_name: state.fullName,
                        area: state.area,
                        item_type: state.itemType,
                        category: state.category,
                        photo_path: state.photoPath,
                        sticker_code: state.stickerCode,
                        shift_date: shift.date,
                        shift_type: shift.type,
                        no_shk_bucket: computeNoShkBucket(),
                        box_id: boxId,
                    });
                if (error) throw error;
                // Non-fatal: the sticker itself is already saved on the
                // row above either way, this just feeds the assignment
                // history (see wms_no_shk_sticker_events).
                if (state.stickerCode) {
                    const { error: historyError } = await supabaseClient
                        .from('wms_no_shk_sticker_events')
                        .insert({
                            intake_submission_id: submissionId,
                            sticker_code: state.stickerCode,
                            source: 'form',
                            actor_employee_id: state.employeeId != null ? String(state.employeeId) : null,
                            actor_name: state.fullName,
                            payload: { note: 'Присвоен стикер к товару «Без ШК»' },
                        });
                    if (historyError) console.warn('sticker history insert failed:', historyError);
                }
            });
            const scanBackBtn = document.getElementById('backToPhotoFromScanBtn');
            if (scanBackBtn) scanBackBtn.disabled = false;
            if (state.stickerCode) {
                showScreen('screenStickerSaved');
            } else {
                showScreen('screenSuccess');
            }
        } catch (err) {
            msgEl.textContent = 'Не получилось отправить (проверьте связь и попробуйте ещё раз): ' + (err.message || 'ошибка сети');
            msgEl.className = 'msg is-error';
            const scanBackBtn = document.getElementById('backToPhotoFromScanBtn');
            if (scanBackBtn) scanBackBtn.disabled = false;
        }
    }

    document.getElementById('againBtn').addEventListener('click', () => {
        state.itemType = null;
        state.category = null;
        state.itemText = null;
        state.photoPath = null;
        state.stickerCode = null;
        state.spillFlag = false;
        showScreen('screenEntryType');
    });

    // ---------- Entry-type sub-flows: 2 ШК / Пустая упаковка (write to 2shk_rep) ----------
    function isDigitsOnly(v) {
        return /^\d+$/.test(v);
    }

    function buildPublicPhotoUrl(path) {
        return 'https://bgphllmzmlwurfnbagho.supabase.co/storage/v1/object/public/intake-photos/' + path;
    }

    async function uploadCompressedPhoto(rawFile, onStatus) {
        onStatus('Сжимаем фото...');
        const file = await compressImage(rawFile);
        if (file.size > 8 * 1024 * 1024) {
            throw new Error('Фото слишком большое (максимум 8 МБ).');
        }
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const path = Date.now() + '-' + crypto.randomUUID() + '.' + ext;
        await withRetry(3, 'Загрузка фото', onStatus, async () => {
            onStatus('Загрузка фото...');
            const { error } = await supabaseClient.storage
                .from('intake-photos')
                .upload(path, file, { contentType: file.type || 'image/jpeg' });
            if (error) throw error;
        });
        return path;
    }

    const shkCorrectInput = document.getElementById('shkCorrectInput');
    const shkWrongInput = document.getElementById('shkWrongInput');
    const photo2ShkInput = document.getElementById('photo2ShkInput');
    const photo2ShkPickBtn = document.getElementById('photo2ShkPickBtn');
    const photo2ShkInput2 = document.getElementById('photo2ShkInput2');
    const photo2ShkPickBtn2 = document.getElementById('photo2ShkPickBtn2');
    const shk2Msg = document.getElementById('shk2Msg');
    let shk2FirstPhotoPath = null;

    function resetShk2Photos() {
        shk2FirstPhotoPath = null;
        photo2ShkPickBtn.disabled = false;
        photo2ShkPickBtn.textContent = '📷 Добавьте фото 1';
        photo2ShkPickBtn2.style.display = 'none';
        photo2ShkPickBtn2.disabled = false;
    }

    photo2ShkPickBtn.addEventListener('click', () => {
        const correct = shkCorrectInput.value.trim();
        const wrong = shkWrongInput.value.trim();
        if (!isDigitsOnly(correct) || !isDigitsOnly(wrong)) {
            shk2Msg.textContent = 'ШК должен состоять только из цифр.';
            shk2Msg.className = 'msg is-error';
            return;
        }
        shk2Msg.textContent = '';
        shk2Msg.className = 'msg';
        photo2ShkInput.click();
    });

    photo2ShkInput.addEventListener('change', () => {
        const file = photo2ShkInput.files[0];
        if (file) void handleFirstPhoto2Shk(file);
    });

    async function handleFirstPhoto2Shk(rawFile) {
        if (document.getElementById('c_addr_2').value) return;
        photo2ShkPickBtn.disabled = true;
        shk2Msg.className = 'msg';
        try {
            shk2FirstPhotoPath = await uploadCompressedPhoto(rawFile, (m) => { shk2Msg.textContent = m; });
            photo2ShkPickBtn.textContent = '✓ Фото 1 добавлено';
            shk2Msg.textContent = 'Теперь добавьте второе фото.';
            shk2Msg.className = 'msg';
            photo2ShkPickBtn2.style.display = '';
        } catch (err) {
            shk2Msg.textContent = 'Не получилось отправить (проверьте связь и попробуйте ещё раз): ' + (err.message || 'ошибка сети');
            shk2Msg.className = 'msg is-error';
            photo2ShkPickBtn.disabled = false;
        } finally {
            photo2ShkInput.value = '';
        }
    }

    photo2ShkPickBtn2.addEventListener('click', () => photo2ShkInput2.click());

    photo2ShkInput2.addEventListener('change', () => {
        const file = photo2ShkInput2.files[0];
        if (file) submit2Shk(file);
    });

    async function submit2Shk(rawFile) {
        if (document.getElementById('c_addr_2').value) return;
        const correct = shkCorrectInput.value.trim();
        const wrong = shkWrongInput.value.trim();
        photo2ShkPickBtn2.disabled = true;
        shk2Msg.className = 'msg';
        try {
            const path2 = await uploadCompressedPhoto(rawFile, (m) => { shk2Msg.textContent = m; });
            await withRetry(3, 'Сохранение', (m) => { shk2Msg.textContent = m; }, async () => {
                shk2Msg.textContent = 'Сохранение...';
                const { error } = await supabaseClient.from('2shk_rep').insert({
                    shk1: correct,
                    shk2: wrong,
                    eventtype: 'Два ШК',
                    media: buildPublicPhotoUrl(shk2FirstPhotoPath),
                    media2: buildPublicPhotoUrl(path2),
                    wh_id: '50144199',
                });
                if (error) throw error;
            });
            showScreen('screenSuccess');
        } catch (err) {
            shk2Msg.textContent = 'Не получилось отправить (проверьте связь и попробуйте ещё раз): ' + (err.message || 'ошибка сети');
            shk2Msg.className = 'msg is-error';
        } finally {
            photo2ShkPickBtn2.disabled = false;
            photo2ShkInput2.value = '';
        }
    }

    const shkEmptyInput = document.getElementById('shkEmptyInput');
    const photoEmptyInput = document.getElementById('photoEmptyInput');
    const photoEmptyPickBtn = document.getElementById('photoEmptyPickBtn');
    const photoEmptyInput2 = document.getElementById('photoEmptyInput2');
    const photoEmptyPickBtn2 = document.getElementById('photoEmptyPickBtn2');
    const emptyMsg = document.getElementById('emptyMsg');
    let emptyFirstPhotoPath = null;

    function resetEmptyPhotos() {
        emptyFirstPhotoPath = null;
        photoEmptyPickBtn.disabled = false;
        photoEmptyPickBtn.textContent = '📷 Добавьте фото 1';
        photoEmptyPickBtn2.style.display = 'none';
        photoEmptyPickBtn2.disabled = false;
    }

    photoEmptyPickBtn.addEventListener('click', () => {
        const shk = shkEmptyInput.value.trim();
        if (!isDigitsOnly(shk)) {
            emptyMsg.textContent = 'ШК должен состоять только из цифр.';
            emptyMsg.className = 'msg is-error';
            return;
        }
        emptyMsg.textContent = '';
        emptyMsg.className = 'msg';
        photoEmptyInput.click();
    });

    photoEmptyInput.addEventListener('change', () => {
        const file = photoEmptyInput.files[0];
        if (file) void handleFirstPhotoEmpty(file);
    });

    async function handleFirstPhotoEmpty(rawFile) {
        if (document.getElementById('c_addr_2').value) return;
        photoEmptyPickBtn.disabled = true;
        emptyMsg.className = 'msg';
        try {
            emptyFirstPhotoPath = await uploadCompressedPhoto(rawFile, (m) => { emptyMsg.textContent = m; });
            photoEmptyPickBtn.textContent = '✓ Фото 1 добавлено';
            emptyMsg.textContent = 'Теперь добавьте второе фото.';
            emptyMsg.className = 'msg';
            photoEmptyPickBtn2.style.display = '';
        } catch (err) {
            emptyMsg.textContent = 'Не получилось отправить (проверьте связь и попробуйте ещё раз): ' + (err.message || 'ошибка сети');
            emptyMsg.className = 'msg is-error';
            photoEmptyPickBtn.disabled = false;
        } finally {
            photoEmptyInput.value = '';
        }
    }

    photoEmptyPickBtn2.addEventListener('click', () => photoEmptyInput2.click());

    photoEmptyInput2.addEventListener('change', () => {
        const file = photoEmptyInput2.files[0];
        if (file) submitEmptyPackage(file);
    });

    async function submitEmptyPackage(rawFile) {
        if (document.getElementById('c_addr_2').value) return;
        const shk = shkEmptyInput.value.trim();
        photoEmptyPickBtn2.disabled = true;
        emptyMsg.className = 'msg';
        try {
            const path2 = await uploadCompressedPhoto(rawFile, (m) => { emptyMsg.textContent = m; });
            await withRetry(3, 'Сохранение', (m) => { emptyMsg.textContent = m; }, async () => {
                emptyMsg.textContent = 'Сохранение...';
                const { error } = await supabaseClient.from('2shk_rep').insert({
                    shk1: shk,
                    shk2: ' ',
                    eventtype: 'Пустая упаковка',
                    media: buildPublicPhotoUrl(emptyFirstPhotoPath),
                    media2: buildPublicPhotoUrl(path2),
                    wh_id: '50144199',
                });
                if (error) throw error;
            });
            showScreen('screenSuccess');
        } catch (err) {
            emptyMsg.textContent = 'Не получилось отправить (проверьте связь и попробуйте ещё раз): ' + (err.message || 'ошибка сети');
            emptyMsg.className = 'msg is-error';
        } finally {
            photoEmptyPickBtn2.disabled = false;
            photoEmptyInput2.value = '';
        }
    }

    setInterval(updateShiftHeaders, 60000);

    goToStart();
})();
