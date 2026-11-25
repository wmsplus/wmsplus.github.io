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
    const MOBILE_APP_ACCESS = 'mobile_app';
    const MOBILE_PROBLEM_ITEM_ACCESS = 'mobile_problem_item';
    const MOBILE_VIOLATIONS_ACCESS = 'mobile_violations';
    const MOBILE_PASSES_ACCESS = 'mobile_passes';
    const MOBILE_INVENTORY_ACCESS = 'mobile_inventory';
    const MOBILE_SCREEN_ACCESS = {
        screenEntryType: MOBILE_PROBLEM_ITEM_ACCESS,
        screenItemType: MOBILE_PROBLEM_ITEM_ACCESS,
        screen2Shk: MOBILE_PROBLEM_ITEM_ACCESS,
        screenEmptyPackage: MOBILE_PROBLEM_ITEM_ACCESS,
        screenCategory: MOBILE_PROBLEM_ITEM_ACCESS,
        screenItemName: MOBILE_PROBLEM_ITEM_ACCESS,
        screenPhoto: MOBILE_PROBLEM_ITEM_ACCESS,
        screenStickerScan: MOBILE_PROBLEM_ITEM_ACCESS,
        screenStickerSaved: MOBILE_PROBLEM_ITEM_ACCESS,
        screenInstrSlide: MOBILE_PROBLEM_ITEM_ACCESS,
        screenTakeToHub: MOBILE_PROBLEM_ITEM_ACCESS,
        screenShiftCloseList: MOBILE_PROBLEM_ITEM_ACCESS,
        screenShiftClose: MOBILE_PROBLEM_ITEM_ACCESS,
        screenShiftCloseQr: MOBILE_PROBLEM_ITEM_ACCESS,
        screenShiftClosePrint: MOBILE_PROBLEM_ITEM_ACCESS,
        screenSuccess: MOBILE_PROBLEM_ITEM_ACCESS,
        screenViolations: MOBILE_VIOLATIONS_ACCESS,
        screenEmployeeViolations: MOBILE_VIOLATIONS_ACCESS,
        screenPinnedEmployees: MOBILE_VIOLATIONS_ACCESS,
        screenPasses: MOBILE_PASSES_ACCESS,
        screenInventory: MOBILE_INVENTORY_ACCESS,
    };

    const screens = Array.from(document.querySelectorAll('.screen'));
    function showScreen(id) {
        if (id !== 'screenInventory' && window.WmsInventoryModule) window.WmsInventoryModule.close();
        screens.forEach((s) => s.classList.toggle('is-active', s.id === id));
        updateBottomNavigation(id);
        updateNotificationBell(id);
        void refreshShiftCounter();
    }

    function mobileTabForScreen(screenId) {
        if (screenId === 'screenViolations' || screenId === 'screenEmployeeViolations' || screenId === 'screenPinnedEmployees') return 'violations';
        if (screenId === 'screenProfile' || screenId === 'screenNotifications' || screenId === 'screenNotificationInbox' || screenId === 'screenPassword') return 'profile';
        if (screenId === 'screenArea' && state.pendingScreen === 'screenProfile') return 'profile';
        return 'home';
    }

    function updateBottomNavigation(screenId) {
        const nav = document.getElementById('mobileTabbar');
        if (!nav) return;
        const loggedIn = Boolean(state && state.user);
        // Once a "Без ШК" name is confirmed, the worker must finish the
        // active fixation before leaving for another main section.
        nav.hidden = !loggedIn || !hasMobileAppAccess() || screenId === 'screenAuth' || screenId === 'screenMobileAccessDenied' || screenId === 'screenInventory' || Boolean(state.noShkFixationLocked);
        if (nav.hidden) return;
        const activeTab = mobileTabForScreen(screenId);
        const visibleTabs = Array.from(nav.querySelectorAll('[data-mobile-tab]')).filter((button) => !button.hidden);
        const tabIndex = Math.max(0, visibleTabs.findIndex((button) => button.dataset.mobileTab === activeTab));
        nav.style.setProperty('--tab-index', String(tabIndex));
        nav.querySelectorAll('[data-mobile-tab]').forEach((button) => {
            const active = button.dataset.mobileTab === activeTab;
            button.classList.toggle('is-active', active);
            if (active) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
    }

    function updateNotificationBell(screenId) {
        const bell = document.getElementById('notificationBellBtn');
        if (!bell) return;
        const dashboardScreens = new Set(['screenHome', 'screenViolations', 'screenProfile']);
        bell.hidden = !state.user || !hasMobileAppAccess() || state.noShkFixationLocked || !dashboardScreens.has(screenId);
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
        notificationReturnScreen: 'screenHome',
        violations: {
            loading: false,
            error: '',
            periodDays: 7,
            people: [],
            selected: null,
            detailLoading: false,
            detailError: '',
            detailRows: [],
            detailPeriodDays: 7,
            talks: [],
            talkCount30: 0,
            isPinned: false,
            talkDraft: null,
        },
        pinnedEmployees: [],
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

    function hasMobileAppAccess() {
        return state.accesses.includes(MOBILE_APP_ACCESS);
    }

    function hasMobileFeatureAccess(access) {
        return hasMobileAppAccess() && state.accesses.includes(access);
    }

    function screenAccessAllowed(screenId) {
        const requiredAccess = MOBILE_SCREEN_ACCESS[screenId];
        return !requiredAccess || hasMobileFeatureAccess(requiredAccess);
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
        void loadPinnedEmployees();
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
        state.pinnedEmployees = [];
    }

    function applyRoleAccess() {
        const problemItem = document.getElementById('openProblemItemBtn');
        const passes = document.getElementById('openPassesBtn');
        const inventory = document.getElementById('openInventoryBtn');
        const tabbar = document.getElementById('mobileTabbar');
        const violationsTab = document.querySelector('[data-mobile-tab="violations"]');
        if (problemItem) problemItem.hidden = !hasMobileFeatureAccess(MOBILE_PROBLEM_ITEM_ACCESS);
        if (passes) passes.hidden = !hasMobileFeatureAccess(MOBILE_PASSES_ACCESS);
        if (inventory) inventory.hidden = !hasMobileFeatureAccess(MOBILE_INVENTORY_ACCESS);
        if (violationsTab) violationsTab.hidden = !hasMobileFeatureAccess(MOBILE_VIOLATIONS_ACCESS);
        if (tabbar) tabbar.classList.toggle('has-violations', Boolean(violationsTab && !violationsTab.hidden));
        const activeScreen = screens.find((screen) => screen.classList.contains('is-active'))?.id || 'screenHome';
        updateBottomNavigation(activeScreen);
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
        if (!hasMobileAppAccess()) {
            showScreen('screenMobileAccessDenied');
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
        } else if (!hasMobileAppAccess()) {
            showScreen('screenMobileAccessDenied');
        } else if (!screenAccessAllowed(state.pendingScreen)) {
            // Deep links and stale browser history must not open a feature
            // after its mobile permission was revoked in SCUD.
            state.pendingScreen = 'screenHome';
            showScreen('screenHome');
        } else if (!state.area) {
            showScreen('screenArea');
        } else {
            updateAreaPills();
            updateShiftHeaders();
            updateHomeGreeting();
            updateProfileScreen();
            showScreen(state.pendingScreen);
            if (state.pendingScreen === 'screenInventory') startInventoryModule();
            if (state.pendingScreen === 'screenViolations') void loadWeeklyViolators(true);
        }
    }

    function goToStart() {
        openProtectedScreen('screenEntryType');
    }

    function startInventoryModule() {
        if (window.WmsInventoryModule) {
            window.WmsInventoryModule.open({
                supabaseClient,
                user: { id: state.employeeId, name: state.fullName },
                onExit: openHome,
            });
        }
    }

    function openInventory() {
        if (!hasMobileFeatureAccess(MOBILE_INVENTORY_ACCESS)) {
            openProtectedScreen('screenHome');
            return;
        }
        openProtectedScreen('screenInventory');
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
    document.getElementById('openInventoryBtn').addEventListener('click', openInventory);
    document.getElementById('backFromInventoryBtn').addEventListener('click', openHome);
    document.getElementById('openPinnedEmployeesBtn').addEventListener('click', () => openProtectedScreen('screenPinnedEmployees'));
    document.getElementById('backFromPinnedEmployeesBtn').addEventListener('click', () => openProtectedScreen('screenViolations'));
    document.getElementById('pushSetupBtn').addEventListener('click', () => { void enableOrTestPush(); });
    document.getElementById('notificationBellBtn').addEventListener('click', () => {
        const activeScreen = screens.find((screen) => screen.classList.contains('is-active'))?.id;
        state.notificationReturnScreen = ['screenHome', 'screenViolations', 'screenProfile'].includes(activeScreen)
            ? activeScreen
            : 'screenHome';
        openProtectedScreen('screenNotificationInbox');
    });
    document.getElementById('backFromNotificationInboxBtn').addEventListener('click', () => {
        openProtectedScreen(state.notificationReturnScreen || 'screenHome');
    });
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
            const loader = document.createElement('div');
            loader.className = 'violators-loading';
            loader.setAttribute('role', 'status');
            loader.setAttribute('aria-label', 'Загружаю нарушения');
            // Mirrors the main dashboard's smooth chart reveal while the
            // mobile list is waiting for a real response.
            loader.innerHTML = [
                '<svg viewBox="0 0 300 132" aria-hidden="true" focusable="false">',
                '<defs><linearGradient id="violatorsLoaderFill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#623CEA" stop-opacity=".28"/><stop offset="1" stop-color="#623CEA" stop-opacity="0"/></linearGradient></defs>',
                '<path class="violators-loader-grid" d="M8 26H292M8 65H292M8 104H292"/>',
                '<path class="violators-loader-area" d="M10 93 C38 80 44 48 74 56 S108 104 137 73 S178 28 208 54 S242 95 290 37 L290 118 L10 118Z"/>',
                '<path class="violators-loader-line" d="M10 93 C38 80 44 48 74 56 S108 104 137 73 S178 28 208 54 S242 95 290 37"/>',
                '<g><circle class="violators-loader-point" cx="10" cy="93" r="4"/><circle class="violators-loader-point" cx="74" cy="56" r="4"/><circle class="violators-loader-point" cx="137" cy="73" r="4"/><circle class="violators-loader-point" cx="208" cy="54" r="4"/><circle class="violators-loader-point" cx="290" cy="37" r="4"/></g>',
                '</svg>',
                '<span class="violators-loading-caption">Загружаем нарушения…</span>',
            ].join('');
            list.appendChild(loader);
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
            row.className = 'violator-row' + (person.isRepeatOffender ? ' is-repeat' : '');
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
            count.textContent = (person.isRepeatOffender ? '🔥 ' : '') + person.count + ' нар.';
            row.append(rank, personWrap, count);
            row.style.animationDelay = Math.min(index, 7) * 45 + 'ms';
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
                    talkCount30: Number(person.talk_count_30) || 0,
                    isRepeatOffender: Boolean(person.is_repeat_offender),
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

    function compactEmployeeName(fullName) {
        const normalized = String(fullName || '').trim().replace(/\s+/g, ' ');
        if (normalized.length <= 27) return normalized || 'Сотрудник';
        const parts = normalized.split(' ');
        if (parts.length < 2) return normalized;
        return parts[0] + ' ' + parts.slice(1).map((part) => part ? part[0] + '.' : '').join(' ');
    }

    function latestTalkCutoff() {
        return state.violations.talks.reduce((latest, talk) => {
            const time = new Date(talk.covered_until).getTime();
            return Number.isFinite(time) && time > latest ? time : latest;
        }, 0);
    }

    function isDiscussedViolation(item) {
        const cutoff = latestTalkCutoff();
        const createdAt = new Date(item.created_at).getTime();
        return cutoff > 0 && Number.isFinite(createdAt) && createdAt <= cutoff;
    }

    function setEmployeeStatus(message, isError) {
        const status = document.getElementById('employeeStatus');
        if (!status) return;
        status.textContent = message || '';
        status.classList.toggle('is-error', Boolean(isError));
    }

    function renderEmployeeViolations() {
        const person = state.violations.selected;
        const name = document.getElementById('employeeViolationsName');
        const id = document.getElementById('employeeViolationsId');
        const total = document.getElementById('employeeViolationsTotal');
        const count = document.getElementById('employeeViolationsCount');
        const talksBadge = document.getElementById('employeeTalksBadge');
        const pinButton = document.getElementById('pinEmployeeBtn');
        const talkButton = document.getElementById('talkEmployeeBtn');
        const body = document.getElementById('employeeViolationsBody');
        if (!person || !name || !id || !total || !count || !talksBadge || !pinButton || !talkButton || !body) return;

        name.textContent = compactEmployeeName(person.fullName);
        name.title = person.fullName;
        id.textContent = 'ID ' + person.employeeId;
        renderQrInto('employeeQr', person.employeeId);
        body.replaceChildren();
        pinButton.classList.toggle('is-active', state.violations.isPinned);
        pinButton.textContent = state.violations.isPinned ? '📌' : '📍';
        pinButton.title = state.violations.isPinned ? 'Открепить исполнителя' : 'Закрепить исполнителя';
        pinButton.setAttribute('aria-label', pinButton.title);
        if (state.violations.detailLoading) {
            count.textContent = '—';
            total.textContent = 'Загружаю…';
            talksBadge.textContent = 'Бесед: —';
            talkButton.disabled = true;
            return;
        }
        if (state.violations.detailError) {
            count.textContent = '—';
            total.textContent = 'Ошибка загрузки';
            talksBadge.textContent = 'Бесед: —';
            setEmployeeStatus(state.violations.detailError, true);
            talkButton.disabled = true;
            return;
        }
        const sum = state.violations.detailRows.reduce((amount, row) => amount + (Number(row.task_price) || 0), 0);
        const newRows = state.violations.detailRows.filter((row) => !isDiscussedViolation(row));
        const talkCount30 = state.violations.talkCount30;
        const isRepeatOffender = talkCount30 >= 3 && newRows.length > 0;
        count.textContent = String(state.violations.detailRows.length);
        total.textContent = formatRoubles(sum || person.totalTaskPrice);
        talksBadge.textContent = isRepeatOffender ? '🔥 Злостный нарушитель · бесед: ' + talkCount30 : 'Бесед: ' + talkCount30;
        talksBadge.classList.toggle('is-repeat', isRepeatOffender);
        talkButton.disabled = newRows.length === 0;
        setEmployeeStatus(newRows.length ? 'Новых нарушений: ' + newRows.length : 'Все нарушения уже обсуждены.');
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
            row.classList.toggle('is-discussed', isDiscussedViolation(item));
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

    async function openEmployeeViolations(person, keepPeriod) {
        state.violations.selected = person;
        state.violations.detailRows = [];
        state.violations.detailError = '';
        state.violations.detailLoading = true;
        state.violations.talks = [];
        state.violations.talkCount30 = 0;
        state.violations.isPinned = false;
        if (!keepPeriod) state.violations.detailPeriodDays = state.violations.periodDays;
        document.querySelectorAll('[data-employee-period]').forEach((button) => {
            button.classList.toggle('is-active', Number(button.dataset.employeePeriod) === state.violations.detailPeriodDays);
        });
        showScreen('screenEmployeeViolations');
        renderEmployeeViolations();
        const from = new Date(Date.now() - state.violations.detailPeriodDays * 24 * 60 * 60 * 1000).toISOString();
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
            const [violationsResult, talksResult, pinResult] = await Promise.all([
                query,
                supabaseClient.rpc('mobile_employee_violation_follow_up', { p_employee_id: person.employeeId }),
                supabaseClient.from('wms_mobile_employee_pins').select('employee_id').eq('employee_id', person.employeeId).maybeSingle(),
            ]);
            if (violationsResult.error) throw violationsResult.error;
            if (talksResult.error) throw talksResult.error;
            if (pinResult.error) throw pinResult.error;
            state.violations.detailRows = violationsResult.data || [];
            const followUp = Array.isArray(talksResult.data) ? talksResult.data[0] : null;
            state.violations.talks = followUp?.covered_until ? [{ covered_until: followUp.covered_until }] : [];
            state.violations.talkCount30 = Number(followUp?.talk_count_30) || 0;
            state.violations.isPinned = Boolean(pinResult.data);
        } catch (error) {
            state.violations.detailError = 'Не удалось загрузить карточку сотрудника.';
            console.warn('employee violations load failed:', error);
        } finally {
            state.violations.detailLoading = false;
            renderEmployeeViolations();
        }
    }

    async function loadPinnedEmployees() {
        if (!state.user) return;
        try {
            const { data, error } = await supabaseClient.rpc('mobile_pinned_employees');
            if (error) throw error;
            state.pinnedEmployees = (data || []).map((item) => ({
                employeeId: String(item.employee_id || '').trim(),
                fullName: String(item.full_name || '').trim() || 'ID ' + String(item.employee_id || '').trim(),
                openViolationCount: Number(item.open_violation_count) || 0,
            })).filter((item) => item.employeeId);
        } catch (error) {
            console.warn('pinned employees load failed:', error);
            state.pinnedEmployees = [];
        }
        renderPinnedEmployees();
        const count = document.getElementById('pinnedEmployeesCount');
        if (count) count.textContent = String(state.pinnedEmployees.length);
    }

    function renderPinnedEmployees() {
        const list = document.getElementById('pinnedEmployeesList');
        if (!list) return;
        list.replaceChildren();
        if (!state.pinnedEmployees.length) {
            const empty = document.createElement('div');
            empty.className = 'violators-empty';
            empty.textContent = 'Закреплённых исполнителей пока нет.';
            list.appendChild(empty);
            return;
        }
        state.pinnedEmployees.forEach((person) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'pinned-row';
            row.innerHTML = '<span aria-hidden="true">📌</span><span><strong></strong><small></small></span><em class="pinned-open-count"></em>';
            row.querySelector('strong').textContent = compactEmployeeName(person.fullName);
            row.querySelector('small').textContent = 'ID ' + person.employeeId;
            const count = row.querySelector('.pinned-open-count');
            count.textContent = person.openViolationCount ? person.openViolationCount + ' нар.' : 'Без новых';
            count.classList.toggle('is-clear', person.openViolationCount === 0);
            row.addEventListener('click', () => { void openEmployeeViolations({ ...person, count: 0, totalTaskPrice: 0 }, false); });
            list.appendChild(row);
        });
    }

    async function toggleEmployeePin() {
        const person = state.violations.selected;
        if (!person) return;
        setEmployeeStatus(state.violations.isPinned ? 'Открепляю исполнителя…' : 'Закрепляю исполнителя…');
        try {
            const result = state.violations.isPinned
                ? await supabaseClient.from('wms_mobile_employee_pins').delete().eq('employee_id', person.employeeId)
                : await supabaseClient.from('wms_mobile_employee_pins').insert({ employee_id: person.employeeId, employee_name: person.fullName });
            if (result.error) throw result.error;
            state.violations.isPinned = !state.violations.isPinned;
            await loadPinnedEmployees();
            renderEmployeeViolations();
            setEmployeeStatus(state.violations.isPinned ? 'Исполнитель закреплён.' : 'Исполнитель откреплён.');
        } catch (error) {
            console.warn('employee pin failed:', error);
            setEmployeeStatus('Не удалось изменить закрепление.', true);
        }
    }

    async function openTalkDialog() {
        const person = state.violations.selected;
        const dialog = document.getElementById('talkDialog');
        const text = document.getElementById('talkDialogText');
        const summary = document.getElementById('talkSummary');
        if (!person || !dialog || !text || !summary) return;
        setEmployeeStatus('Собираю все новые нарушения…');
        let query = supabaseClient
            .from('wms_violations')
            .select('created_at,violation_type,shk,task_price')
            .order('created_at', { ascending: false })
            .limit(5000);
        query = /^\d+$/.test(person.employeeId)
            ? query.or('culprit_employee_id.eq.' + person.employeeId + ',culprit_name.eq.' + person.employeeId)
            : query.eq('culprit_employee_id', person.employeeId);
        let allRows;
        try {
            const { data, error } = await query;
            if (error) throw error;
            allRows = data || [];
        } catch (error) {
            console.warn('all employee violations load failed:', error);
            setEmployeeStatus('Не удалось загрузить нарушения для беседы.', true);
            return;
        }
        const freshRows = allRows.filter((row) => !isDiscussedViolation(row));
        if (!freshRows.length) {
            setEmployeeStatus('Новых нарушений для беседы нет.');
            return;
        }
        const grouped = freshRows.reduce((result, row) => {
            const label = String(row.violation_type || 'Без типа');
            result[label] = (result[label] || 0) + 1;
            return result;
        }, {});
        state.violations.talkDraft = { coveredUntil: new Date().toISOString(), summary: grouped };
        text.textContent = 'Проведите беседу с «' + compactEmployeeName(person.fullName) + '» по новым нарушениям:';
        summary.replaceChildren();
        Object.entries(grouped).forEach(([label, value]) => {
            const row = document.createElement('div');
            row.className = 'talk-summary-row';
            row.append(Object.assign(document.createElement('span'), { textContent: label }), Object.assign(document.createElement('strong'), { textContent: String(value) }));
            summary.appendChild(row);
        });
        dialog.hidden = false;
    }

    function closeTalkDialog() {
        const dialog = document.getElementById('talkDialog');
        if (dialog) dialog.hidden = true;
        state.violations.talkDraft = null;
    }

    async function confirmTalk() {
        const person = state.violations.selected;
        const draft = state.violations.talkDraft;
        const button = document.getElementById('confirmTalkBtn');
        if (!person || !draft || !button) return;
        button.disabled = true;
        try {
            const { error } = await supabaseClient.from('wms_mobile_violation_talks').insert({
                employee_id: person.employeeId,
                covered_until: draft.coveredUntil,
                summary: draft.summary,
            });
            if (error) throw error;
            closeTalkDialog();
            await loadWeeklyViolators(true);
            await openEmployeeViolations(person, true);
            setEmployeeStatus('Беседа отмечена. Новые нарушения будут показаны отдельно.');
        } catch (error) {
            console.warn('violation talk save failed:', error);
            setEmployeeStatus('Не удалось сохранить беседу.', true);
        } finally {
            button.disabled = false;
        }
    }

    document.getElementById('backToViolatorsBtn').addEventListener('click', () => {
        state.violations.selected = null;
        showScreen('screenViolations');
        renderWeeklyViolators();
    });
    document.querySelectorAll('[data-employee-period]').forEach((button) => {
        button.addEventListener('click', () => {
            const periodDays = Number(button.dataset.employeePeriod);
            if (periodDays === state.violations.detailPeriodDays || !state.violations.selected) return;
            state.violations.detailPeriodDays = periodDays;
            document.querySelectorAll('[data-employee-period]').forEach((item) => item.classList.toggle('is-active', Number(item.dataset.employeePeriod) === periodDays));
            void openEmployeeViolations(state.violations.selected, true);
        });
    });
    document.getElementById('pinEmployeeBtn').addEventListener('click', () => { void toggleEmployeePin(); });
    document.getElementById('talkEmployeeBtn').addEventListener('click', () => { void openTalkDialog(); });
    document.getElementById('cancelTalkBtn').addEventListener('click', closeTalkDialog);
    document.getElementById('confirmTalkBtn').addEventListener('click', () => { void confirmTalk(); });

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
    document.getElementById('mobileAccessDeniedSignOutBtn').addEventListener('click', () => { void signOut(); });
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
        showScreen('screenBoot');
        try {
            const { data: sessionData } = await supabaseClient.auth.getSession();
            if (!sessionData?.session) {
                clearProfile();
                showScreen('screenAuth');
                return;
            }
            await loadProfileForSession(sessionData.session);
            await showAuthenticatedStart();
        } catch (error) {
            console.warn('mobile auth bootstrap failed:', error);
            await supabaseClient.auth.signOut();
            clearProfile();
            setAuthMessage('Сессия завершена. Войдите снова.', true);
            showScreen('screenAuth');
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
