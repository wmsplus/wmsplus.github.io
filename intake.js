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
    const WEB_PUSH_VAPID_PUBLIC_KEY = 'BBkitRC9ly-XwQuHuxPYppaS4c9GZHUnpzZZevTkZBsTwZJMzhe3JRFtSefk577wQYhywKPLhSHpCUqgBvtNG2g';

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

    // The desktop WMS+ uses Supabase Auth plus a public.users profile.  The
    // mobile app intentionally keeps only a harmless profile cache locally;
    // permission is always backed by the live Supabase session.
    const LS_MOBILE_USER = 'wmsplus_mobile_auth_user';
    const LS_AREA = 'wmsplus_intake_area';

    const screens = Array.from(document.querySelectorAll('.screen'));
    function showScreen(id) {
        screens.forEach((s) => s.classList.toggle('is-active', s.id === id));
        updateBottomNavigation(id);
        void refreshShiftCounter();
    }

    function mobileTabForScreen(screenId) {
        if (screenId === 'screenViolations' || screenId === 'screenEmployeeViolations') return 'violations';
        if (screenId === 'screenProfile' || screenId === 'screenNotifications' || screenId === 'screenPassword') return 'profile';
        if (screenId === 'screenArea' && state.pendingScreen === 'screenProfile') return 'profile';
        return 'home';
    }

    function updateBottomNavigation(screenId) {
        const nav = document.getElementById('mobileTabbar');
        if (!nav) return;
        const loggedIn = Boolean(state && state.user);
        // Once a "Без ШК" name is confirmed, the worker must finish the
        // active fixation before leaving for another main section.
        nav.hidden = !loggedIn || screenId === 'screenAuth' || Boolean(state.noShkFixationLocked);
        if (nav.hidden) return;
        const activeTab = mobileTabForScreen(screenId);
        const tabIndex = { home: 0, violations: 1, profile: 2 }[activeTab] || 0;
        nav.style.setProperty('--tab-index', String(tabIndex));
        nav.querySelectorAll('[data-mobile-tab]').forEach((button) => {
            const active = button.dataset.mobileTab === activeTab;
            button.classList.toggle('is-active', active);
            if (active) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
    }

    // Упаковка has no shift-box concept (every item there is bucketed,
    // never counted into a shift box) -- hide the counter entirely there.
    // The number itself is scoped to the CURRENT shift's own box only --
    // older not-yet-closed boxes are never added into it, they just show up
    // as selectable entries once the plate is tapped (see openShiftCloseList
    // below). The plate is always tappable now: even when the current shift
    // has recorded nothing yet, older boxes may still be waiting to close.
    async function refreshShiftCounter() {
        const els = document.querySelectorAll('[data-shift-counter]');
        if (!els.length) return;
        if (!state.user || !state.area || state.area === 'Упаковка') {
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
            .limit(1)
            .maybeSingle();
        const count = error || !data ? 0 : data.total_items;
        els.forEach((el) => {
            el.style.display = '';
            el.textContent = 'За смену зафиксировано: ' + count;
            el.classList.add('is-tappable');
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
        user: null,
        employeeId: null,
        fullName: null,
        accesses: [],
        area: localStorage.getItem(LS_AREA),
        itemType: null,
        category: null,
        itemText: null,
        photoPath: null,
        stickerCode: null,
        spillFlag: false,
        noShkFixationLocked: false,
        pendingScreen: 'screenHome',
        violations: {
            loading: false,
            error: '',
            periodDays: 7,
            people: [],
            selected: null,
            detailLoading: false,
            detailError: '',
            detailRows: [],
        },
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

    function createIntakePhotoPath(extension) {
        const authUid = state.user?.authUid;
        if (!authUid) throw new Error('Сессия сотрудника не найдена. Войдите заново.');
        // Storage RLS accepts only the current authenticated user's folder.
        // The UUID filename keeps a direct public photo URL unguessable.
        return authUid + '/' + Date.now() + '-' + crypto.randomUUID() + '.' + extension;
    }

    let photoBackTarget = 'screenCategory';
    let qrStream = null;
    let qrAnimFrame = null;
    let qrScanCancelled = false;

    function updateAreaPills() {
        [
            'areaPillEntryText', 'areaPillTypeText', 'areaPillCategoryText', 'areaPillNameText',
            'areaPillPhotoText', 'areaPillStickerText', 'areaPill2ShkText', 'areaPillEmptyText',
            'areaPillStickerSavedText', 'areaPillInstrText', 'areaPillHubText', 'areaPillCloseListText',
            'areaPillCloseText', 'areaPillCloseQrText', 'areaPillHomeText',
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
            'shiftHeaderStickerSaved', 'shiftHeaderInstr', 'shiftHeaderHub', 'shiftHeaderCloseList',
            'shiftHeaderClose', 'shiftHeaderCloseQr', 'shiftHeaderHome',
        ].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.textContent = label;
        });
    }

    function greetingName(fullName) {
        const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
        return parts[1] || parts[0] || '';
    }

    function updateHomeGreeting() {
        const el = document.getElementById('homeGreeting');
        if (!el) return;
        const name = greetingName(state.fullName);
        el.textContent = name ? 'Привет, ' + name : 'Привет!';
    }

    function updateProfileScreen() {
        const name = document.getElementById('profileName');
        const id = document.getElementById('profileId');
        const area = document.getElementById('profileArea');
        if (name) name.textContent = state.fullName || 'Сотрудник';
        if (id) id.textContent = state.employeeId ? 'ID ' + state.employeeId : 'ID —';
        if (area) area.textContent = state.area ? 'Участок: ' + state.area : 'Участок не выбран';
    }

    function pushSupported() {
        return 'serviceWorker' in navigator
            && 'PushManager' in window
            && 'Notification' in window;
    }

    function setPushStatus(message, isError) {
        const target = document.getElementById('pushStatus');
        if (!target) return;
        target.textContent = message || '';
        target.className = isError ? 'home-push-status is-error' : 'home-push-status';
    }

    function updatePushButton(status) {
        const button = document.getElementById('pushSetupBtn');
        const title = document.getElementById('pushSetupTitle');
        const note = document.getElementById('pushSetupNote');
        if (!button || !title || !note) return;
        if (!pushSupported()) {
            button.disabled = true;
            title.textContent = 'Уведомления не поддерживаются';
            note.textContent = 'Откройте приложение в современном браузере.';
            return;
        }
        if (status === 'subscribed') {
            title.textContent = 'Проверить уведомления';
            note.textContent = 'Уведомления включены на этом устройстве.';
        } else if (Notification.permission === 'denied') {
            button.disabled = true;
            title.textContent = 'Уведомления заблокированы';
            note.textContent = 'Разрешите их в настройках браузера.';
        } else {
            title.textContent = 'Включить уведомления';
            note.textContent = 'После подключения сразу пришлём тест.';
        }
    }

    function base64UrlToUint8Array(value) {
        const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
        const raw = atob(padded);
        return Uint8Array.from(raw, (character) => character.charCodeAt(0));
    }

    async function pushRegistration() {
        const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
        return navigator.serviceWorker.ready || registration;
    }

    async function refreshPushState() {
        if (!state.user || !pushSupported()) {
            updatePushButton();
            return null;
        }
        try {
            const registration = await pushRegistration();
            const subscription = await registration.pushManager.getSubscription();
            updatePushButton(subscription ? 'subscribed' : 'idle');
            return subscription;
        } catch (error) {
            console.warn('push registration check failed:', error);
            updatePushButton();
            return null;
        }
    }

    async function callPushEndpoint(action, subscription) {
        const { data, error } = await supabaseClient.functions.invoke('mobile-web-push', {
            body: { action, ...(subscription ? { subscription } : {}) },
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || 'Не удалось выполнить запрос.');
        return data;
    }

    async function enableOrTestPush() {
        const button = document.getElementById('pushSetupBtn');
        if (!state.user || !pushSupported() || !button) return;
        button.disabled = true;
        setPushStatus('Подключаю уведомления…');
        try {
            const registration = await pushRegistration();
            let permission = Notification.permission;
            if (permission === 'default') permission = await Notification.requestPermission();
            if (permission !== 'granted') throw new Error('Разрешение на уведомления не получено.');
            let subscription = await registration.pushManager.getSubscription();
            if (!subscription) {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: base64UrlToUint8Array(WEB_PUSH_VAPID_PUBLIC_KEY),
                });
            }
            await callPushEndpoint('subscribe', subscription.toJSON());
            await callPushEndpoint('test');
            updatePushButton('subscribed');
            setPushStatus('Тестовое уведомление отправлено на это устройство.');
        } catch (error) {
            console.warn('push setup failed:', error);
            setPushStatus(error?.message || 'Не удалось включить уведомления.', true);
            updatePushButton();
        } finally {
            button.disabled = false;
        }
    }

    function normalizeAccesses(accesses) {
        if (Array.isArray(accesses)) {
            return accesses.map((access) => String(access || '').trim()).filter(Boolean);
        }
        return String(accesses || '')
            .split(',')
            .map((access) => access.trim())
            .filter(Boolean);
    }

    function applyProfile(profile) {
        const mobileUser = {
            id: String(profile.id || '').trim(),
            fio: String(profile.fio || profile.name || '').trim(),
            accesses: normalizeAccesses(profile.accesses),
            authUid: String(profile.auth_uid || '').trim(),
        };
        state.user = mobileUser;
        state.employeeId = mobileUser.id;
        state.fullName = mobileUser.fio;
        state.accesses = mobileUser.accesses;
        localStorage.setItem(LS_MOBILE_USER, JSON.stringify(mobileUser));
        void refreshPushState();
    }

    function clearProfile() {
        localStorage.removeItem(LS_MOBILE_USER);
        localStorage.removeItem(LS_AREA);
        // Remove the pre-auth identity cache too, so an older installation
        // cannot accidentally display the previous employee after upgrade.
        localStorage.removeItem('wmsplus_intake_employee_id');
        localStorage.removeItem('wmsplus_intake_full_name');
        state.user = null;
        state.employeeId = null;
        state.fullName = null;
        state.accesses = [];
        state.area = null;
        state.noShkFixationLocked = false;
    }

    function applyRoleAccess() {
        const passes = document.getElementById('openPassesBtn');
        // A verified WMS+ profile is the baseline permission for the mobile
        // workplace.  `accesses` stays loaded into state for future granular
        // capabilities, but it must never hide the staff services by default.
        if (passes) passes.hidden = false;
    }

    async function loadProfileForSession(session) {
        const { data, error } = await supabaseClient
            .from('users')
            .select('id,fio,accesses,auth_uid')
            .eq('auth_uid', session.user.id)
            .maybeSingle();
        if (error) throw error;
        if (!data || !String(data.id || '').trim()) {
            throw new Error('Профиль сотрудника не найден');
        }
        applyProfile(data);
        applyRoleAccess();
    }

    function setAuthMessage(message, isError) {
        const target = document.getElementById('authMsg');
        target.textContent = message || '';
        target.className = isError ? 'msg is-error' : 'msg';
    }

    async function showAuthenticatedStart() {
        if (!state.user) {
            showScreen('screenAuth');
            return;
        }
        if (!state.area) {
            showScreen('screenArea');
            return;
        }
        openProtectedScreen(state.pendingScreen || 'screenHome');
    }

    async function submitAuth() {
        const idInput = document.getElementById('authIdInput');
        const passwordInput = document.getElementById('authPasswordInput');
        const submit = document.getElementById('authSubmitBtn');
        const id = idInput.value.trim();
        const password = passwordInput.value;
        if (!/^\d+$/.test(id) || !password) {
            setAuthMessage('Введите ID цифрами и пароль.', true);
            return;
        }
        submit.disabled = true;
        setAuthMessage('Проверяю доступ…');
        try {
            const { data, error } = await supabaseClient.auth.signInWithPassword({
                email: id + '@wms.internal',
                password,
            });
            if (error || !data?.session) throw new Error('Неверный ID или пароль');
            await loadProfileForSession(data.session);
            passwordInput.value = '';
            setAuthMessage('');
            await showAuthenticatedStart();
        } catch (error) {
            await supabaseClient.auth.signOut();
            clearProfile();
            setAuthMessage(error?.message === 'Неверный ID или пароль'
                ? error.message
                : 'Не удалось загрузить профиль. Обратитесь к старшему смены.', true);
        } finally {
            submit.disabled = false;
        }
    }

    async function signOut() {
        await supabaseClient.auth.signOut();
        clearProfile();
        document.getElementById('authPasswordInput').value = '';
        setAuthMessage('');
        showScreen('screenAuth');
    }

    function setChangePasswordMessage(message, isError) {
        const target = document.getElementById('changePasswordMsg');
        target.textContent = message || '';
        target.className = isError ? 'msg is-error' : 'msg';
    }

    function clearChangePasswordForm() {
        ['currentPasswordInput', 'newPasswordInput', 'newPasswordConfirmInput'].forEach((id) => {
            const input = document.getElementById(id);
            if (input) input.value = '';
        });
        setChangePasswordMessage('');
    }

    async function changePassword() {
        const currentInput = document.getElementById('currentPasswordInput');
        const nextInput = document.getElementById('newPasswordInput');
        const confirmInput = document.getElementById('newPasswordConfirmInput');
        const submit = document.getElementById('changePasswordBtn');
        const currentPassword = currentInput.value;
        const nextPassword = nextInput.value;
        const confirmation = confirmInput.value;

        if (!currentPassword || !nextPassword || !confirmation) {
            setChangePasswordMessage('Заполните все поля.', true);
            return;
        }
        if (nextPassword.length < 8) {
            setChangePasswordMessage('Новый пароль должен содержать не менее 8 символов.', true);
            return;
        }
        if (nextPassword !== confirmation) {
            setChangePasswordMessage('Новый пароль и его повтор не совпадают.', true);
            return;
        }

        submit.disabled = true;
        setChangePasswordMessage('Проверяю текущий пароль…');
        try {
            // A live session alone is not enough on a shared warehouse device:
            // require the current password before changing the account secret.
            const { error: verificationError } = await supabaseClient.auth.signInWithPassword({
                email: String(state.employeeId) + '@wms.internal',
                password: currentPassword,
            });
            if (verificationError) throw new Error('Текущий пароль указан неверно.');

            setChangePasswordMessage('Сохраняю новый пароль…');
            const { error } = await supabaseClient.auth.updateUser({ password: nextPassword });
            if (error) throw error;
            clearChangePasswordForm();
            setChangePasswordMessage('Пароль успешно изменён.');
        } catch (error) {
            const message = error?.message === 'Текущий пароль указан неверно.'
                ? error.message
                : 'Не удалось изменить пароль. Попробуйте ещё раз.';
            setChangePasswordMessage(message, true);
        } finally {
            submit.disabled = false;
        }
    }

    function openProtectedScreen(screenId) {
        state.pendingScreen = screenId || 'screenHome';
        if (!state.user || !state.employeeId || !state.fullName) {
            showScreen('screenAuth');
        } else if (!state.area) {
            showScreen('screenArea');
        } else {
            updateAreaPills();
            updateShiftHeaders();
            updateHomeGreeting();
            updateProfileScreen();
            showScreen(state.pendingScreen);
            if (state.pendingScreen === 'screenViolations') void loadWeeklyViolators(true);
        }
    }

    function goToStart() {
        openProtectedScreen('screenEntryType');
    }

    // All top-level services live in the same document. Switching one of
    // them only swaps the active app screen, so there is no browser reload,
    // visible URL jump, or separate HTML page to maintain.
    function openHome() {
        stopQrScan();
        stopCloseQrScan();
        openProtectedScreen('screenHome');
    }

    document.getElementById('openProblemItemBtn').addEventListener('click', goToStart);
    document.getElementById('openPassesBtn').addEventListener('click', () => openProtectedScreen('screenPasses'));
    document.getElementById('pushSetupBtn').addEventListener('click', () => { void enableOrTestPush(); });
    document.querySelectorAll('[data-mobile-tab]').forEach((button) => {
        button.addEventListener('click', () => {
            const tab = button.dataset.mobileTab;
            stopQrScan();
            stopCloseQrScan();
            if (tab === 'home') openHome();
            else if (tab === 'violations') openProtectedScreen('screenViolations');
            else if (tab === 'profile') openProtectedScreen('screenProfile');
        });
    });

    function renderWeeklyViolators() {
        const list = document.getElementById('violatorsList');
        if (!list) return;

        list.replaceChildren();
        if (state.violations.loading) {
            const message = document.createElement('div');
            message.className = 'violators-empty';
            message.textContent = 'Загружаю нарушения…';
            list.appendChild(message);
            return;
        }
        if (state.violations.error) {
            const message = document.createElement('div');
            message.className = 'violators-empty';
            message.textContent = state.violations.error;
            list.appendChild(message);
            return;
        }

        if (!state.violations.people.length) {
            const message = document.createElement('div');
            message.className = 'violators-empty';
            message.textContent = 'За последние 7 дней нет сотрудников с 3 и более нарушениями.';
            list.appendChild(message);
            return;
        }
        state.violations.people.forEach((person, index) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'violator-row';
            const rank = document.createElement('span');
            rank.className = 'violator-rank';
            rank.textContent = String(index + 1) + '.';
            const personWrap = document.createElement('span');
            personWrap.className = 'violator-person';
            const name = document.createElement('span');
            name.className = 'violator-name';
            name.textContent = person.fullName;
            const id = document.createElement('span');
            id.className = 'violator-id';
            id.textContent = 'ID ' + person.employeeId;
            personWrap.append(name, id);
            const count = document.createElement('span');
            count.className = 'violator-count';
            count.textContent = person.count + ' нар.';
            row.append(rank, personWrap, count);
            row.addEventListener('click', () => { void openEmployeeViolations(person); });
            list.appendChild(row);
        });
    }

    async function loadWeeklyViolators(force) {
        if (state.violations.loading || (!force && state.violations.people.length)) {
            renderWeeklyViolators();
            return;
        }
        state.violations.loading = true;
        state.violations.error = '';
        renderWeeklyViolators();
        try {
            const { data, error } = await supabaseClient.rpc('mobile_violators', {
                p_period_days: state.violations.periodDays,
            });
            if (error) throw error;
            state.violations.people = (data || [])
                .map((person) => ({
                    employeeId: String(person.employee_id || '').trim(),
                    fullName: String(person.full_name || '').trim(),
                    count: Number(person.violation_count) || 0,
                    totalTaskPrice: Number(person.total_task_price) || 0,
                }))
                .filter((person) => person.employeeId)
                .map((person) => ({ ...person, fullName: person.fullName || 'ID ' + person.employeeId }));
        } catch (error) {
            state.violations.error = 'Не удалось загрузить список. Попробуйте ещё раз.';
            console.warn('weekly violators load failed:', error);
        } finally {
            state.violations.loading = false;
            renderWeeklyViolators();
        }
    }

    document.querySelectorAll('[data-violations-period]').forEach((button) => {
        button.addEventListener('click', () => {
            const periodDays = Number(button.dataset.violationsPeriod);
            if (periodDays === state.violations.periodDays) return;
            state.violations.periodDays = periodDays;
            document.querySelectorAll('[data-violations-period]').forEach((item) => {
                item.classList.toggle('is-active', Number(item.dataset.violationsPeriod) === periodDays);
            });
            void loadWeeklyViolators(true);
        });
    });

    function formatRoubles(value) {
        return new Intl.NumberFormat('ru-RU', {
            style: 'currency', currency: 'RUB', maximumFractionDigits: 2,
        }).format(Number(value) || 0);
    }

    function formatViolationDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return new Intl.DateTimeFormat('ru-RU', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        }).format(date);
    }

    function renderEmployeeViolations() {
        const person = state.violations.selected;
        const name = document.getElementById('employeeViolationsName');
        const id = document.getElementById('employeeViolationsId');
        const total = document.getElementById('employeeViolationsTotal');
        const body = document.getElementById('employeeViolationsBody');
        if (!person || !name || !id || !total || !body) return;

        name.textContent = person.fullName;
        id.textContent = 'ID ' + person.employeeId;
        body.replaceChildren();
        if (state.violations.detailLoading) {
            total.textContent = 'Загружаю нарушения…';
            return;
        }
        if (state.violations.detailError) {
            total.textContent = state.violations.detailError;
            return;
        }
        const sum = state.violations.detailRows.reduce((amount, row) => amount + (Number(row.task_price) || 0), 0);
        total.textContent = 'Суммарная стоимость нарушений: ' + formatRoubles(sum || person.totalTaskPrice);
        if (!state.violations.detailRows.length) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 3;
            cell.textContent = 'За выбранный период нарушений нет.';
            row.appendChild(cell);
            body.appendChild(row);
            return;
        }
        state.violations.detailRows.forEach((item) => {
            const row = document.createElement('tr');
            [
                formatViolationDate(item.created_at),
                item.violation_type || '—',
                item.shk || '—',
            ].forEach((value) => {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
            });
            body.appendChild(row);
        });
    }

    async function openEmployeeViolations(person) {
        state.violations.selected = person;
        state.violations.detailRows = [];
        state.violations.detailError = '';
        state.violations.detailLoading = true;
        showScreen('screenEmployeeViolations');
        renderEmployeeViolations();
        const from = new Date(Date.now() - state.violations.periodDays * 24 * 60 * 60 * 1000).toISOString();
        try {
            let query = supabaseClient
                .from('wms_violations')
                .select('created_at,violation_type,shk,task_price')
                .gte('created_at', from)
                .order('created_at', { ascending: false })
                .limit(1000);
            // The current form saves the culprit into culprit_employee_id.
            // The fallback keeps historic rows, where a numeric ID was put in
            // culprit_name, in the same employee card.
            query = /^\d+$/.test(person.employeeId)
                ? query.or('culprit_employee_id.eq.' + person.employeeId + ',culprit_name.eq.' + person.employeeId)
                : query.eq('culprit_employee_id', person.employeeId);
            const { data, error } = await query;
            if (error) throw error;
            state.violations.detailRows = data || [];
        } catch (error) {
            state.violations.detailError = 'Не удалось загрузить карточку сотрудника.';
            console.warn('employee violations load failed:', error);
        } finally {
            state.violations.detailLoading = false;
            renderEmployeeViolations();
        }
    }

    document.getElementById('backToViolatorsBtn').addEventListener('click', () => {
        state.violations.selected = null;
        showScreen('screenViolations');
        renderWeeklyViolators();
    });

    // ---------- Screen: Auth ----------
    document.getElementById('authSubmitBtn').addEventListener('click', () => { void submitAuth(); });
    document.getElementById('authIdInput').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') document.getElementById('authPasswordInput').focus();
    });
    document.getElementById('authPasswordInput').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') void submitAuth();
    });

    // ---------- Screen: area ----------
    // Selected via [data-area] (not the shared .area-btn class, which is
    // reused for visual style only by the type-selection buttons on
    // screenItemType and the entry-type buttons on screenEntryType --
    // those are NOT area buttons and must not trigger this handler).
    document.querySelectorAll('[data-area]').forEach((btn) => {
        btn.addEventListener('click', () => {
            state.area = btn.dataset.area;
            localStorage.setItem(LS_AREA, state.area);
            openProtectedScreen(state.pendingScreen);
        });
    });
    document.getElementById('profileLogoutBtn').addEventListener('click', () => {
        if (window.confirm('Выйти из аккаунта на этом устройстве?')) void signOut();
    });
    document.getElementById('profileChangeAreaBtn').addEventListener('click', () => {
        state.pendingScreen = 'screenProfile';
        showScreen('screenArea');
    });
    document.getElementById('profileNotificationsBtn').addEventListener('click', () => {
        openProtectedScreen('screenNotifications');
    });
    document.getElementById('backToProfileFromNotificationsBtn').addEventListener('click', () => {
        openProtectedScreen('screenProfile');
    });
    document.getElementById('profilePasswordBtn').addEventListener('click', () => {
        clearChangePasswordForm();
        openProtectedScreen('screenPassword');
    });
    document.getElementById('backToProfileFromPasswordBtn').addEventListener('click', () => {
        clearChangePasswordForm();
        openProtectedScreen('screenProfile');
    });
    document.getElementById('changePasswordBtn').addEventListener('click', () => { void changePassword(); });
    document.getElementById('newPasswordConfirmInput').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') void changePassword();
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
        state.noShkFixationLocked = true;
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
            const photoPath = createIntakePhotoPath(ext);

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
            state.noShkFixationLocked = false;
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
        state.noShkFixationLocked = false;
        showScreen('screenEntryType');
    });

    // ---------- Shift-box closing (end-of-shift, 19:30+) ----------
    let shiftCloseReturnTo = 'screenItemType';
    let shiftCloseBoxId = null;
    let shiftCloseBoxNumber = null;
    let shiftCloseBoxTotalItems = null;
    let shiftCloseShift = null;

    // Best-effort "show the QR on the warehouse display" signal for
    // display.html (WMSplus-main) -- a Realtime Broadcast, not a table
    // write, since there's nothing here worth persisting: it's a one-off
    // "someone just tapped Закрыть короб" heads-up, not state. Subscribed
    // once at page load (not lazily on first tap) so it's already
    // connected by the time the button is actually pressed. If the display
    // page happens to be offline or the broadcast is missed, nothing here
    // is affected -- the physical QR sticker in the revision office still
    // works exactly as before.
    const displayBroadcastChannel = supabaseClient.channel('shift_close_display');
    let displayBroadcastReady = false;
    displayBroadcastChannel.subscribe((status) => { displayBroadcastReady = status === 'SUBSCRIBED'; });
    function notifyDisplayShowQr() {
        if (!displayBroadcastReady) return;
        void displayBroadcastChannel.send({
            type: 'broadcast',
            event: 'show_qr',
            payload: { area: state.area, box_number: shiftCloseBoxNumber, total_items: shiftCloseBoxTotalItems },
        });
    }

    document.querySelectorAll('[data-shift-counter]').forEach((el) => {
        el.addEventListener('click', () => {
            if (!el.classList.contains('is-tappable')) return;
            const active = screens.find((s) => s.classList.contains('is-active'));
            if (active) shiftCloseReturnTo = active.id;
            void openShiftCloseList();
        });
    });

    // Lists every box outside ОПП for the area: older (previous-shift) boxes
    // are always listed, ready to close any time -- they're the ones that
    // were "still not brought in". The box actively forming for the CURRENT
    // shift is included only once isCurrentShiftBoxUnlocked() opens (last 30
    // minutes of that shift), same as the old single-box flow's gate, just
    // now scoped to one row instead of gating the whole plate.
    async function openShiftCloseList() {
        showScreen('screenShiftCloseList');
        const container = document.getElementById('shiftCloseListContainer');
        const msg = document.getElementById('shiftCloseListMsg');
        container.innerHTML = '';
        msg.textContent = 'Загружаю...';
        msg.className = 'msg';

        const { data, error } = await supabaseClient
            .from('wms_no_shk_boxes')
            .select('id,total_items,box_number,shift_date,shift_type')
            .eq('area', state.area)
            .eq('outside_opp', true)
            .order('shift_date', { ascending: true })
            .order('created_at', { ascending: true });

        if (error) {
            msg.textContent = 'Не удалось загрузить список: ' + error.message;
            msg.className = 'msg is-error';
            return;
        }

        const shift = computeShift();
        const now = new Date();
        const boxes = (data || []).filter((box) => {
            const isCurrentShiftBox = box.shift_date === shift.date && box.shift_type === shift.type;
            return !isCurrentShiftBox || isCurrentShiftBoxUnlocked(now);
        });

        if (!boxes.length) {
            msg.textContent = 'Нечего закрывать.';
            return;
        }
        msg.textContent = '';
        boxes.forEach((box) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'shift-close-list-item';
            item.textContent = 'Короб №' + box.box_number + ' — ' + box.total_items + ' шт. — ' +
                formatDateShortClose(box.shift_date) + ', ' + (box.shift_type === 'Ночная' ? 'ночная смена' : 'дневная смена');
            item.addEventListener('click', () => openShiftCloseConfirm(box));
            container.appendChild(item);
        });
    }

    document.getElementById('backFromCloseListBtn').addEventListener('click', () => {
        showScreen(shiftCloseReturnTo);
    });

    // Confirmation screen for one specific box chosen from the list --
    // reuses the box data the list already fetched, no re-query needed.
    function openShiftCloseConfirm(box) {
        shiftCloseBoxId = box.id;
        shiftCloseBoxNumber = box.box_number;
        shiftCloseBoxTotalItems = box.total_items;
        // Read the persisted shift_date/shift_type off the chosen row itself,
        // not a fresh computeShift() call -- this can't drift after the QR
        // scan/printing spans past a shift boundary.
        shiftCloseShift = { date: box.shift_date, type: box.shift_type };
        showScreen('screenShiftClose');
        const countLine = document.getElementById('shiftCloseCount');
        const startBtn = document.getElementById('shiftCloseStartBtn');
        const msg = document.getElementById('shiftCloseMsg');
        msg.textContent = '';
        msg.className = 'msg';
        countLine.textContent = 'За смену зафиксировано: ' + box.total_items;
        startBtn.style.display = '';
    }

    document.getElementById('backToListFromCloseBtn').addEventListener('click', () => {
        showScreen('screenShiftCloseList');
    });

    document.getElementById('shiftCloseStartBtn').addEventListener('click', () => {
        showScreen('screenShiftCloseQr');
        startCloseQrScan();
        notifyDisplayShowQr();
    });

    // ---------- QR scan for revision-office location check (shift-box closing) ----------
    function formatDateShortClose(isoDate) {
        const parts = String(isoDate).split('-');
        if (parts.length !== 3) return String(isoDate);
        return parts[2] + '.' + parts[1] + '.' + parts[0].slice(2);
    }

    function addDaysClose(isoDate, days) {
        const d = new Date(isoDate + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
    }

    let boxLabelTemplateForClose = null;
    let kgtLabelTemplate = null;
    // Re-entrancy guard: a double-fire (e.g. a retried QR scan that wasn't
    // properly stopped) must not start a second overlapping print run.
    let shiftClosePrintInFlight = false;

    async function loadCloseTemplates() {
        if (!boxLabelTemplateForClose) {
            const { data } = await supabaseClient.from('print_label_templates').select('id,width_mm,height_mm,elements').eq('name', 'Короб «Без ШК»').maybeSingle();
            boxLabelTemplateForClose = data || null;
        }
        if (!kgtLabelTemplate) {
            const { data } = await supabaseClient.from('print_label_templates').select('id,width_mm,height_mm,elements').eq('name', 'КГТ «Без ШК»').maybeSingle();
            kgtLabelTemplate = data || null;
        }
    }

    async function finishShiftClosePrint(anyFailed, msg, retryBtn) {
        if (anyFailed) {
            msg.textContent = 'Не всё получилось. Проверьте принтер и подключение, попробуйте ещё раз.';
            msg.className = 'msg is-error';
            retryBtn.style.display = '';
            return;
        }
        const { error } = await supabaseClient.from('wms_no_shk_boxes').update({ outside_opp: false }).eq('id', shiftCloseBoxId);
        if (error) {
            msg.textContent = 'Стикеры напечатаны, но не удалось закрыть короб: ' + error.message;
            msg.className = 'msg is-error';
            retryBtn.style.display = '';
            return;
        }
        msg.textContent = 'Готово! Короб закрыт.';
        msg.className = 'msg';
        setTimeout(() => { showScreen('screenEntryType'); }, 1500);
    }

    async function runShiftClosePrint() {
        // Re-entrancy guard: a stray double-trigger (e.g. an imperfectly
        // stopped QR scanner detecting the same code twice) must be a no-op
        // rather than starting a second overlapping print run.
        if (shiftClosePrintInFlight) return;
        shiftClosePrintInFlight = true;
        try {
            showScreen('screenShiftClosePrint');
            const list = document.getElementById('shiftClosePrintList');
            const msg = document.getElementById('shiftClosePrintMsg');
            const retryBtn = document.getElementById('shiftClosePrintRetryBtn');
            retryBtn.style.display = 'none';
            msg.textContent = '';
            msg.className = 'msg';
            list.textContent = 'Готовлю печать...';

            await loadCloseTemplates();
            if (!boxLabelTemplateForClose) {
                list.textContent = '';
                msg.textContent = 'Шаблон этикетки «Короб «Без ШК»» не найден.';
                msg.className = 'msg is-error';
                retryBtn.style.display = '';
                return;
            }

            const { data: contentRows, error: contentsError } = await supabaseClient.rpc('wms_no_shk_box_contents', { p_box_id: shiftCloseBoxId });
            if (contentsError) {
                list.textContent = '';
                msg.textContent = 'Не удалось прочитать содержимое короба: ' + contentsError.message;
                msg.className = 'msg is-error';
                retryBtn.style.display = '';
                return;
            }
            const { kgtItems } = partitionBoxContents(contentRows || []);
            if (kgtItems.length && !kgtLabelTemplate) {
                list.textContent = '';
                msg.textContent = 'Шаблон этикетки «КГТ «Без ШК»» не найден.';
                msg.className = 'msg is-error';
                retryBtn.style.display = '';
                return;
            }

            const dateLine1 = formatDateShortClose(shiftCloseShift.date);
            const dateLine2 = shiftCloseShift.type === 'Ночная' ? formatDateShortClose(addDaysClose(shiftCloseShift.date, 1)) : '';

            const jobsToCreate = [{
                label: 'Короб',
                template: boxLabelTemplateForClose,
                data: {
                    box_code: 'WMSP.BOX.' + String(shiftCloseBoxNumber).padStart(5, '0'),
                    box_number: String(shiftCloseBoxNumber),
                    box_type: 'Короб',
                    area: state.area,
                    date_line1: dateLine1,
                    date_line2: dateLine2,
                    shift: shiftCloseShift.type === 'Ночная' ? 'Ночь' : 'День',
                },
            }];
            // item_text is free text up to 2000 chars; wrapping/truncation to
            // fit the label is handled by print-tspl.js itself (the "name"
            // field's wrap_width_mm/max_lines in the template), so the raw
            // text goes through unmodified here.
            kgtItems.forEach((item, i) => {
                jobsToCreate.push({
                    label: 'КГТ ' + (i + 1) + ' из ' + kgtItems.length,
                    template: kgtLabelTemplate,
                    data: { name: item.item_text, area: state.area, date_line1: dateLine1, date_line2: dateLine2 },
                });
            });

            list.innerHTML = '';
            const jobRows = jobsToCreate.map((j) => {
                const row = document.createElement('div');
                row.textContent = j.label + ': в очереди...';
                list.appendChild(row);
                return { ...j, rowEl: row };
            });

            msg.textContent = 'Печатаю...';
            const results = await Promise.all(jobRows.map((job) => printOneJob(job)));
            const anyFailed = results.some((r) => !r.ok);
            void finishShiftClosePrint(anyFailed, msg, retryBtn);
        } finally {
            shiftClosePrintInFlight = false;
        }
    }

    // How long to wait for Realtime to report a terminal print_jobs status
    // before giving up and checking once by hand -- covers the print-bridge
    // process not running at all, or the Realtime connection dropping
    // silently after a successful insert (neither raises a subscribe error).
    const PRINT_JOB_SAFETY_TIMEOUT_MS = 75000;

    async function printOneJob(job) {
        const jobId = crypto.randomUUID();
        const tspl = buildTsplPayloadBase64(job.template, job.data);
        return new Promise((resolve) => {
            let settled = false;
            let inserted = false;
            let safetyTimer = null;

            function settle(result) {
                if (settled) return;
                settled = true;
                if (safetyTimer) {
                    clearTimeout(safetyTimer);
                    safetyTimer = null;
                }
                supabaseClient.removeChannel(channel);
                resolve(result);
            }

            const channel = supabaseClient
                .channel('shift_close_print_job_' + jobId)
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'print_jobs', filter: 'id=eq.' + jobId }, (payload) => {
                    const row = payload.new;
                    if (row.status !== 'printed' && row.status !== 'failed') return;
                    job.rowEl.textContent = job.label + ': ' + (row.status === 'printed' ? 'напечатано ✓' : 'ошибка (' + (row.error_message || 'неизвестная ошибка') + ')');
                    settle({ ok: row.status === 'printed' });
                })
                .subscribe(async (status) => {
                    if (status === 'SUBSCRIBED') {
                        if (inserted) return;
                        inserted = true;
                        const { error } = await supabaseClient
                            .from('print_jobs')
                            .insert({ id: jobId, template_id: job.template.id, data: job.data, tspl, created_by: state.employeeId != null ? String(state.employeeId) : null });
                        if (error) {
                            job.rowEl.textContent = job.label + ': ошибка постановки в очередь (' + error.message + ')';
                            settle({ ok: false });
                        } else {
                            job.rowEl.textContent = job.label + ': печатаю...';
                        }
                        return;
                    }
                    // Any other status (CHANNEL_ERROR, TIMED_OUT, CLOSED, or the
                    // connection just dropping) means we'll never hear about a
                    // status change over Realtime -- fail this job rather than
                    // hang forever. The safety-timeout below is the backstop for
                    // the case where the connection drops *silently* instead
                    // (no status callback fires at all).
                    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                        job.rowEl.textContent = job.label + ': ошибка подписки на статус: ' + status;
                        settle({ ok: false });
                    }
                });

            safetyTimer = setTimeout(async () => {
                if (settled) return;
                const { data, error } = await supabaseClient
                    .from('print_jobs')
                    .select('status,error_message')
                    .eq('id', jobId)
                    .maybeSingle();
                if (settled) return; // settled via Realtime while this query was in flight
                if (!error && data && data.status === 'printed') {
                    job.rowEl.textContent = job.label + ': напечатано ✓';
                    settle({ ok: true });
                } else {
                    const reason = (!error && data && data.status === 'failed' && data.error_message)
                        ? data.error_message
                        : 'нет ответа от принтера дольше 75 секунд';
                    job.rowEl.textContent = job.label + ': ошибка (' + reason + ')';
                    settle({ ok: false });
                }
            }, PRINT_JOB_SAFETY_TIMEOUT_MS);
        });
    }

    document.getElementById('shiftClosePrintRetryBtn').addEventListener('click', () => {
        void runShiftClosePrint();
    });

    // Escape hatch if printing is genuinely stuck (e.g. print-bridge down and
    // the 75s safety timeout hasn't fired yet). Does NOT flip outside_opp --
    // any jobs already queued are left as-is; retrying the whole close flow
    // later just creates additional print_jobs rows (the same accepted
    // duplicate-print trade-off already documented for the failure path).
    document.getElementById('backFromShiftClosePrintBtn').addEventListener('click', () => {
        showScreen('screenShiftClose');
    });

    const closeQrMsg = document.getElementById('closeQrMsg');
    let closeQrStream = null;
    let closeQrAnimFrame = null;
    let closeQrScanCancelled = false;

    function stopCloseQrScan() {
        closeQrScanCancelled = true;
        if (closeQrAnimFrame) {
            cancelAnimationFrame(closeQrAnimFrame);
            closeQrAnimFrame = null;
        }
        if (closeQrStream) {
            closeQrStream.getTracks().forEach((t) => t.stop());
            closeQrStream = null;
        }
    }

    async function startCloseQrScan() {
        // Stop any scan already in flight first -- otherwise retrying after a
        // failed scan (tapping "Попробовать снова") starts a second camera
        // stream + rAF loop on top of the first, risking the same QR being
        // detected twice (double print + double close).
        stopCloseQrScan();
        closeQrScanCancelled = false;
        closeQrMsg.textContent = '';
        closeQrMsg.className = 'msg';
        if (typeof jsQR === 'undefined') {
            closeQrMsg.textContent = 'Не удалось загрузить сканер QR. Проверьте подключение к интернету и обновите страницу.';
            closeQrMsg.className = 'msg is-error';
            return;
        }
        const video = document.getElementById('closeQrVideo');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            if (closeQrScanCancelled) {
                stream.getTracks().forEach((t) => t.stop());
                return;
            }
            closeQrStream = stream;
            video.srcObject = closeQrStream;
            await video.play();
            if (closeQrScanCancelled) return;
            closeQrAnimFrame = requestAnimationFrame(scanCloseQrFrame);
        } catch (err) {
            if (closeQrScanCancelled) return;
            closeQrMsg.textContent = 'Не удалось открыть камеру: ' + (err.message || 'нет доступа');
            closeQrMsg.className = 'msg is-error';
        }
    }

    function scanCloseQrFrame() {
        const video = document.getElementById('closeQrVideo');
        const canvas = document.getElementById('closeQrCanvas');
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            if (code && code.data) {
                if (code.data !== SHIFT_CLOSE_QR_VALUE) {
                    closeQrMsg.textContent = 'Это не тот QR-код. Отсканируйте QR в кабинете ревизии.';
                    closeQrMsg.className = 'msg is-error';
                    closeQrAnimFrame = requestAnimationFrame(scanCloseQrFrame);
                    return;
                }
                stopCloseQrScan();
                void runShiftClosePrint();
                return;
            }
        }
        closeQrAnimFrame = requestAnimationFrame(scanCloseQrFrame);
    }

    document.getElementById('backToCloseFromQrBtn').addEventListener('click', () => {
        stopCloseQrScan();
        showScreen('screenShiftClose');
    });

    document.getElementById('retryCloseQrScanBtn').addEventListener('click', () => startCloseQrScan());

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
        const path = createIntakePhotoPath(ext);
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

    async function bootstrapAuth() {
        state.pendingScreen = window.location.hash === '#violations'
            ? 'screenViolations'
            : window.location.hash === '#passes'
                ? 'screenPasses'
                : 'screenHome';
        showScreen('screenAuth');
        try {
            const { data: sessionData } = await supabaseClient.auth.getSession();
            if (!sessionData?.session) {
                clearProfile();
                return;
            }
            await loadProfileForSession(sessionData.session);
            await showAuthenticatedStart();
        } catch (error) {
            console.warn('mobile auth bootstrap failed:', error);
            await supabaseClient.auth.signOut();
            clearProfile();
            setAuthMessage('Сессия завершена. Войдите снова.', true);
        }
    }

    supabaseClient.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
            clearProfile();
            showScreen('screenAuth');
        }
    });

    void bootstrapAuth();
})();
