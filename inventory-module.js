// mobile-inventory.js — "Инвентаризация «Без ШК»", the mobile side.
// Paired live with display.js through wms_no_shk_inventory_sessions --
// see docs/superpowers/specs/2026-09-23-no-shk-inventory-design.md.
window.WmsInventoryModule = (function () {
    "use strict";
    let controller = null;

    function createInventory(options) {
    const supabaseClient = options.supabaseClient;
    let user = options.user;
    let onExit = options.onExit || function () {};
    let isOpen = false;
    /* Standalone-page bootstrap retired: the host app owns the session. */
    /*
    const SUPABASE_URL = "https://bgphllmzmlwurfnbagho.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q";
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const LS_KEY = "wmsplus_mobile_user";

    const userRaw = localStorage.getItem(LS_KEY);
    if (!userRaw) {
        window.location.href = "mobile-login.html";
        return;
    }
    let user;
    try {
        user = JSON.parse(userRaw);
    } catch (e) {
        // Corrupted/hand-edited localStorage value -- treat exactly like
        // "not logged in" instead of throwing into a blank page.
        window.location.href = "mobile-login.html";
        return;
    }

    // LS_KEY alone isn't proof of a live login: a phone left on this page
    // since before the Supabase Auth cutover (or an expired session) still
    // carries this cache, so every RLS-gated table (print_label_templates,
    // print_jobs, ...) then fails silently while wms_no_shk_* reads/writes
    // -- anon-open by design -- keep working, masking the problem. Confirm
    // an actual session exists; this runs in parallel with the rest of
    // this file's synchronous setup below, and just redirects shortly
    // after if there's no session to find.
    (async () => {
        const { data: sessionData } = await supabaseClient.auth.getSession();
        if (!sessionData?.session) {
            localStorage.removeItem(LS_KEY);
            window.location.href = "mobile-login.html";
        }
    })();

    // Auto-reload on a new deploy -- this page can stay open on a phone for
    // a whole inventory session (unlike display.js's kiosk analog, this one
    // has bitten us for real: a reprint queued via stale in-memory JS from
    // before a fix landed produced output indistinguishable from "the fix
    // didn't work" until the actual print_jobs row was inspected directly).
    // Bump CLIENT_VERSION here AND version.json's "v" together whenever
    // this file, print-tspl.js, or inventory-dates.js changes.
    const CLIENT_VERSION = 9;
    setInterval(() => {
        fetch("version.json?bust=" + Date.now(), { cache: "no-store" })
            .then((res) => res.json())
            .then((data) => {
                if (data && data.v && data.v !== CLIENT_VERSION) window.location.reload();
            })
            .catch(() => {}); // best-effort -- a failed check just skips this cycle
    }, 20000);

    */
    const stepTitle = document.getElementById("stepTitle");
    const stepMsg = document.getElementById("stepMsg");
    const scanFrame = document.getElementById("scanFrame");
    const video = document.getElementById("invVideo");
    const canvas = document.getElementById("invCanvas");
    const stepButtons = document.getElementById("stepButtons");
    const inventoryShelf = document.getElementById("inventoryShelf");
    const inventoryShelfName = document.getElementById("inventoryShelfName");
    const inventoryShelfCount = document.getElementById("inventoryShelfCount");
    const inventoryShelfBoxes = document.getElementById("inventoryShelfBoxes");

    let activeSession = null;
    let scanStream = null;
    let scanRafId = null;
    let scannerRun = 0;
    // Tracks the currently-rendered shelf-step buttons so finishShelf()'s
    // error paths can re-enable them -- they were disabled synchronously
    // by renderShelfButtons' click handler (the re-entrancy guard) before
    // finishShelf() ran, and a failure must leave the worker able to
    // retry rather than stuck with two dead buttons.
    let shelfFinishBtn = null;
    let shelfMissingBtn = null;
    let lastScanErrorAt = 0;
    let autoAdvancingShelf = false;

    // ---------- Reusable camera scanner (shelf codes here, box codes in
    // Task 6, pairing code below) -- mirrors intake.js's
    // startCloseQrScan/scanCloseQrFrame pattern (wmsplus-intake-form repo).
    async function startScanner(onMatch) {
        stopScanner();
        const run = ++scannerRun;
        if (scanFrame) scanFrame.style.display = "block"; // #scanFrame's default CSS is display:none -- clearing to "" would just fall back to that
        try {
            // Box QR stickers are small thermal-printed labels -- a
            // browser's default getUserMedia stream (often ~640x480 when
            // only facingMode is given) doesn't carry enough detail for
            // jsQR to decode one reliably at normal scanning distance,
            // even though the same stream is plenty for the much larger
            // shelf QR signs. Asking for a bigger frame directly targets
            // that gap; `ideal` (not exact/min) so it degrades gracefully
            // on a camera that can't do 1280x720.
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
            });
            // The worker may have returned to the application while the
            // browser was still asking for camera permission. Do not revive
            // a scanner on a hidden screen after that delayed response.
            if (!isOpen || run !== scannerRun) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }
            scanStream = stream;
        } catch (error) {
            if (scanFrame) scanFrame.style.display = "none";
            stepMsg.textContent = "Не удалось открыть камеру: " + error.message;
            return;
        }
        video.srcObject = scanStream;
        await video.play();
        // Best-effort continuous autofocus -- a close-up small QR code is
        // also where a phone camera's default (often single-shot/fixed)
        // focus is most likely to leave the frame permanently blurry.
        // Not all browsers/devices expose focus control this way (notably
        // iOS Safari doesn't), so this silently no-ops there; scanning
        // still works, just relying on whatever autofocus the device
        // already does on its own.
        const [scanTrack] = scanStream.getVideoTracks();
        if (scanTrack && scanTrack.getCapabilities) {
            try {
                const caps = scanTrack.getCapabilities();
                if (caps.focusMode && caps.focusMode.includes("continuous")) {
                    await scanTrack.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
                }
            } catch (focusError) {
                console.error("Continuous focus not applied", focusError);
            }
        }
        const ctx = canvas.getContext("2d");
        // Re-entrancy guard: a code held steady in frame decodes on every
        // tick, and onMatch is async (DB round-trips) -- without this, a
        // second onMatch for the SAME decode can start before the first
        // one finishes reacting to it (stopScanner(), dup-checks, etc.),
        // racing itself. Frames keep being captured/decoded regardless;
        // only the onMatch dispatch is serialized. Declared fresh per
        // startScanner() call so a stale `true` from a previous scan
        // session can never wedge a later one.
        let processingMatch = false;
        function tick() {
            if (isOpen && video.readyState === video.HAVE_ENOUGH_DATA && !processingMatch) {
                // Wrapped in try/catch: an uncaught throw anywhere in here
                // (e.g. getImageData/jsQR) would otherwise silently kill
                // this rAF loop for good, since the requestAnimationFrame(tick)
                // call below is never reached after a throw -- the scanner
                // would freeze on the very first bad frame with literally no
                // visible symptom.
                try {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const code = jsQR(imageData.data, imageData.width, imageData.height);
                    if (code && code.data) {
                        processingMatch = true;
                        Promise.resolve(onMatch(code.data)).finally(() => { processingMatch = false; });
                    }
                } catch (tickError) {
                    console.error("Scanner tick failed", tickError);
                }
            }
            if (scanStream) { // still running unless onMatch called stopScanner()
                scanRafId = requestAnimationFrame(tick);
            }
        }
        scanRafId = requestAnimationFrame(tick);
    }

    // Short two-tone "success" chime via Web Audio -- no audio file to
    // host, and a shared lazily-created AudioContext (rather than one per
    // call) avoids hitting a per-page context limit on rapid successive
    // scans. Created on first use, which by then is always well after a
    // real user gesture (tapping "Начать инвентаризацию" etc.), so
      // autoplay-policy audio-unlock is not a concern here.
    let audioCtx = null;
    function getAudioContext() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === "suspended") void audioCtx.resume();
        return audioCtx;
    }

    function playNotes(notes, volume) {
        try {
            const context = getAudioContext();
            const start = context.currentTime + 0.01;
            notes.forEach((note, index) => {
                const oscillator = context.createOscillator();
                const gain = context.createGain();
                oscillator.connect(gain);
                gain.connect(context.destination);
                oscillator.type = note.type || "sine";
                oscillator.frequency.setValueAtTime(note.frequency, start + note.offset);
                gain.gain.setValueAtTime(0.001, start + note.offset);
                gain.gain.exponentialRampToValueAtTime(volume || .26, start + note.offset + .015);
                gain.gain.exponentialRampToValueAtTime(0.001, start + note.offset + note.duration);
                oscillator.start(start + note.offset);
                oscillator.stop(start + note.offset + note.duration + .02);
            });
        } catch (e) {
            // Sound is an enhancement; the visual confirmation still works.
        }
    }

    function playSuccessSound() {
        playNotes([
            { frequency: 784, offset: 0, duration: .12 },
            { frequency: 1046, offset: .09, duration: .16 },
            { frequency: 1568, offset: .18, duration: .18 },
        ], .34);
    }

    function playErrorSound() {
        playNotes([
            { frequency: 210, offset: 0, duration: .12, type: "square" },
            { frequency: 155, offset: .11, duration: .18, type: "square" },
        ], .16);
    }

    function playCompletionJingle() {
        playNotes([
            { frequency: 523, offset: 0, duration: .15 },
            { frequency: 659, offset: .11, duration: .15 },
            { frequency: 784, offset: .22, duration: .18 },
            { frequency: 1046, offset: .36, duration: .32 },
        ], .3);
    }

    // Visible + audible + tactile confirmation that a box was actually
    // recorded -- a text-only "добавлен" message was easy to miss while
    // looking at the box/camera rather than the screen.
    function flashScanSuccess() {
        const card = document.querySelector(".inventory-card");
        if (card) {
            card.classList.remove("is-scan-success");
            void card.offsetWidth;
            card.classList.add("is-scan-success");
        }
        playSuccessSound();
        if (navigator.vibrate) {
            try { navigator.vibrate(80); } catch (e) { /* best-effort only */ }
        }
    }

    function reportScanError(message) {
        const now = Date.now();
        if (now - lastScanErrorAt < 1100) return;
        lastScanErrorAt = now;
        const card = document.querySelector(".inventory-card");
        if (card) {
            card.classList.remove("is-scan-error");
            void card.offsetWidth;
            card.classList.add("is-scan-error");
        }
        playErrorSound();
        if (navigator.vibrate) {
            try { navigator.vibrate([45, 40, 45]); } catch (e) { /* best-effort only */ }
        }
        stepMsg.textContent = message;
    }

    function hideShelfVisual() {
        if (inventoryShelf) inventoryShelf.hidden = true;
        if (inventoryShelfBoxes) inventoryShelfBoxes.replaceChildren();
    }

    function resetShelfVisual(shelf) {
        if (!inventoryShelf || !inventoryShelfBoxes) return;
        inventoryShelf.hidden = false;
        inventoryShelfName.textContent = "Полка " + (shelf.name || "");
        inventoryShelfBoxes.replaceChildren();
        updateShelfVisualCount(0, shelf.capacity || 0);
    }

    function updateShelfVisualCount(count, capacity) {
        if (inventoryShelfCount) inventoryShelfCount.textContent = String(count) + " / " + String(capacity);
    }

    function addBoxToShelfVisual(boxNumber, shelf, isMissingSticker) {
        if (!inventoryShelfBoxes) return;
        const box = document.createElement("span");
        box.className = "inventory-shelf-box" + (isMissingSticker ? " is-missing" : "");
        box.textContent = isMissingSticker ? "без ШК" : "№" + boxNumber;
        inventoryShelfBoxes.appendChild(box);
        inventoryShelfBoxes.scrollLeft = inventoryShelfBoxes.scrollWidth;
        updateShelfVisualCount(inventoryShelfBoxes.children.length, shelf.capacity || 0);
    }

    async function restoreShelfVisual(shelf) {
        resetShelfVisual(shelf);
        const { data: results, error } = await supabaseClient
            .from("wms_no_shk_inventory_box_results")
            .select("box_id,result,scan_order,recorded_at")
            .eq("session_id", activeSession.id)
            .eq("shelf_id", shelf.id)
            .in("result", ["found", "missing_sticker"])
            .order("scan_order", { ascending: true, nullsFirst: false })
            .order("recorded_at", { ascending: true });
        if (error) { console.error("Failed to restore shelf visual", error); return; }
        const rows = results || [];
        activeSession.nextScanOrder = rows.reduce((max, row, index) => Math.max(max, Number(row.scan_order) || index + 1), 0) + 1;
        if (!rows.length) return;
        const ids = rows.map((row) => row.box_id);
        const { data: boxes, error: boxesError } = await supabaseClient
            .from("wms_no_shk_boxes")
            .select("id,box_number")
            .in("id", ids);
        if (boxesError) { console.error("Failed to restore scanned boxes", boxesError); return; }
        const byId = new Map((boxes || []).map((box) => [box.id, box]));
        rows.forEach((row) => addBoxToShelfVisual(byId.get(row.box_id)?.box_number || "?", shelf, row.result === "missing_sticker"));
    }

    function stopScanner() {
        scannerRun += 1;
        if (scanRafId) { cancelAnimationFrame(scanRafId); scanRafId = null; }
        if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
        if (scanFrame) scanFrame.style.display = "none";
    }

    // ---------- Pairing / session bootstrap ----------
    async function findActiveSession() {
        const { data, error } = await supabaseClient
            .from("wms_no_shk_inventory_sessions")
            .select("id,status,step,started_by_id,started_by_name,started_at,current_shelf_id")
            .in("status", ["waiting_for_phone", "in_progress"])
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) {
            // Indistinguishable from "no active session" to the caller, but
            // at least not invisible for debugging.
            console.error("findActiveSession query failed", error);
        }
        return data || null;
    }

    // Shared by beginNewSession() and resumeSession()'s pairing branch --
    // both need to react identically to the display's pairing QR being
    // scanned, whether this is a session THIS phone just created or one it
    // reconnected to after a reload.
    async function handlePairingScan(text) {
        if (text !== "WMSP.INV." + activeSession.id) return; // not our pairing code, keep scanning
        stopScanner();
        const { error: updateError } = await supabaseClient
            .from("wms_no_shk_inventory_sessions")
            .update({ status: "in_progress", step: "scan_shelf", last_activity_at: new Date().toISOString() })
            .eq("id", activeSession.id);
        if (updateError) {
            stepMsg.textContent = "Ошибка: " + updateError.message;
            return;
        }
        stepTitle.textContent = "Отсканируйте полку";
        stepMsg.textContent = "";
        void startShelfScan();
    }

    function renderStartScreen() {
        activeSession = null;
        hideShelfVisual();
        stepTitle.textContent = "Инвентаризация «Без ШК»";
        stepMsg.textContent = "";
        stepButtons.innerHTML = "";
        const startBtn = document.createElement("button");
        startBtn.className = "primary-btn inventory-start-btn";
        startBtn.textContent = "Начать инвентаризацию";
        startBtn.addEventListener("click", () => {
            // Disable synchronously so a double-tap can't race two inserts
            // before the first one's unique partial index would reject the
            // second anyway.
            startBtn.disabled = true;
            // Start the audio context inside the worker's real tap. This is
            // required by iOS for the later scan/completion sounds.
            getAudioContext();
            void beginNewSession();
        });
        stepButtons.appendChild(startBtn);
    }

    async function beginNewSession() {
        const { data, error } = await supabaseClient
            .from("wms_no_shk_inventory_sessions")
            .insert({ status: "waiting_for_phone", step: "pairing", started_by_id: String(user.id), started_by_name: user.name })
            .select("id")
            .single();
        if (error || !data) {
            // Covers both a real failure and the app-level check above
            // losing a race to the DB's own unique-active-session index --
            // either way the friendly message is right, never the raw
            // Postgres constraint text.
            if (error) console.error("Failed to start inventory session", error);
            stepMsg.textContent = "Инвентаризация уже идёт, попробуйте позже";
            return;
        }
        activeSession = { id: data.id };
        stepTitle.textContent = "Отсканируйте QR на экране";
        stepMsg.textContent = "Экран в кабинете ОПП";
        stepButtons.replaceChildren();
        void startScanner(handlePairingScan);
    }

    // Rejoins an in-flight session that THIS phone (same started_by_id)
    // already started, at whatever step the DB says it's on -- so a
    // reload/backgrounded-tab-reload mid-audit doesn't strand the worker
    // on a dead scan screen. This is the entire reason a persisted
    // sessions TABLE was chosen over one-shot broadcast in the original
    // design -- before this fix that guarantee only held on the display
    // side.
    async function resumeSession(session) {
        activeSession = { id: session.id, shelfId: session.current_shelf_id || null };
        if (session.step === "pairing") {
            stepTitle.textContent = "Отсканируйте QR на экране";
            stepMsg.textContent = "Экран в кабинете ОПП";
            stepButtons.replaceChildren();
            void startScanner(handlePairingScan);
            return;
        }
        if (session.step === "scan_shelf") {
            void startShelfScan();
            return;
        }
        if (session.step === "scan_boxes" && session.current_shelf_id) {
            const { data: shelfRows, error } = await supabaseClient
                .from("wms_no_shk_shelves")
                .select("id,name,capacity,rack_id")
                .eq("id", session.current_shelf_id)
                .limit(1);
            const shelf = shelfRows && shelfRows[0];
            if (error || !shelf) {
                // The shelf this session was mid-scanning on somehow no
                // longer resolves -- fall back to a clean shelf scan rather
                // than getting stuck.
                void startShelfScan();
                return;
            }
            activeSession.shelfId = shelf.id;
            activeSession.shelf = shelf;
            void startBoxScan(shelf);
            return;
        }
        // Unknown/unexpected step for an active session -- safest fallback.
        void startShelfScan();
    }

    async function initInventoryFlow() {
        const existing = await findActiveSession();
        if (!existing) {
            renderStartScreen();
            return;
        }
        if (String(existing.started_by_id) === String(user.id)) {
            await resumeSession(existing);
            return;
        }
        // Someone else's session is active -- lets the abandon-recovery
        // watcher below (and this phone's own staleness self-check) react
        // if it later gets marked abandoned or completes.
        activeSession = existing;
        stepTitle.textContent = "Инвентаризация уже идёт";
        stepMsg.textContent = "Начал(а): " + (existing.started_by_name || "неизвестно") + " в " + new Date(existing.started_at).toLocaleTimeString("ru-RU");
    }

    // ---------- Per-shelf loop ----------
    async function startShelfScan() {
        hideShelfVisual();
        autoAdvancingShelf = false;
        stepTitle.textContent = "Отсканируйте полку";
        stepMsg.textContent = "";
        stepButtons.innerHTML = "";
        const { error: resetStepError } = await supabaseClient
            .from("wms_no_shk_inventory_sessions")
            .update({ step: "scan_shelf", current_shelf_id: null, last_activity_at: new Date().toISOString() })
            .eq("id", activeSession.id);
        if (resetStepError) console.error("Failed to reset session to scan_shelf", resetStepError); // housekeeping only -- scanning still starts below regardless

        void startScanner(async (text) => {
            // WMSP.PLCE.WSHK.{rack_number}.{shelf_number}
            const match = /^WMSP\.PLCE\.WSHK\.(\d+)\.(\d+)$/.exec(text);
            if (!match) { reportScanError("Это не QR-код полки"); return; }
            const rackNumber = Number(match[1]);
            const shelfNumber = Number(match[2]);
            const { data: shelfRows, error: shelfError } = await supabaseClient
                .from("wms_no_shk_shelves")
                .select("id,name,capacity,rack_id,wms_no_shk_racks!inner(rack_number)")
                .eq("shelf_number", shelfNumber)
                .eq("wms_no_shk_racks.rack_number", rackNumber)
                .limit(1);
            if (shelfError) { stepMsg.textContent = "Ошибка: " + shelfError.message; return; }
            const shelf = shelfRows && shelfRows[0];
            if (!shelf) {
                reportScanError("Полка не найдена в системе");
                return;
            }
            stopScanner();

            // Reopen (or create) this session's audit row for the shelf --
            // re-scanning an already-audited shelf this session should
            // redo it cleanly, not create a duplicate/conflicting record.
            // The delete and the audit-row lookup touch different tables
            // with no dependency between them -- run in parallel.
            const [{ error: clearError }, { data: existingAudit, error: auditLookupError }] = await Promise.all([
                supabaseClient.from("wms_no_shk_inventory_box_results").delete().eq("session_id", activeSession.id).eq("shelf_id", shelf.id),
                supabaseClient.from("wms_no_shk_inventory_shelf_audits").select("id").eq("session_id", activeSession.id).eq("shelf_id", shelf.id).maybeSingle(),
            ]);
            if (clearError) { stepMsg.textContent = "Ошибка: " + clearError.message; return; }
            if (auditLookupError) { stepMsg.textContent = "Ошибка: " + auditLookupError.message; return; }

            if (existingAudit) {
                const { error: auditUpdateError } = await supabaseClient.from("wms_no_shk_inventory_shelf_audits")
                    .update({ started_at: new Date().toISOString(), finished_at: null, boxes_found_count: 0, boxes_missing_sticker_count: 0, boxes_not_found_count: 0 })
                    .eq("id", existingAudit.id);
                if (auditUpdateError) { stepMsg.textContent = "Ошибка: " + auditUpdateError.message; return; }
            } else {
                const { error: auditInsertError } = await supabaseClient.from("wms_no_shk_inventory_shelf_audits").insert({ session_id: activeSession.id, shelf_id: shelf.id });
                if (auditInsertError) { stepMsg.textContent = "Ошибка: " + auditInsertError.message; return; }
            }

            activeSession.shelfId = shelf.id;
            activeSession.shelf = shelf;
            const { error: sessionUpdateError } = await supabaseClient
                .from("wms_no_shk_inventory_sessions")
                .update({ step: "scan_boxes", current_shelf_id: shelf.id, last_activity_at: new Date().toISOString() })
                .eq("id", activeSession.id);
            if (sessionUpdateError) { stepMsg.textContent = "Ошибка: " + sessionUpdateError.message; return; }
            void startBoxScan(shelf);
        });
    }

    async function scannedCountForCurrentShelf() {
        const { count } = await supabaseClient
            .from("wms_no_shk_inventory_box_results")
            .select("id", { count: "exact", head: true })
            .eq("session_id", activeSession.id)
            .eq("shelf_id", activeSession.shelfId);
        return count || 0;
    }

    function renderShelfButtons(scannedCount, shelf) {
        stepButtons.innerHTML = "";
        const finishLabel = scannedCount === 0 ? "На полке нет коробов" : "На полке больше нет коробов";
        const finishBtn = document.createElement("button");
        finishBtn.className = "secondary-btn inventory-action-btn";
        finishBtn.textContent = finishLabel;
        let missingBtn = null;
        finishBtn.addEventListener("click", () => {
            // Disable synchronously, before any await, so a fast double-tap
            // can't re-enter finishShelf() while the first call is still in
            // flight (which would insert duplicate not_found rows and could
            // race the session-completion check) -- same disable-on-click
            // guard selectMissingStickerBox's caller uses below.
            finishBtn.disabled = true;
            if (missingBtn) missingBtn.disabled = true;
            void finishShelf();
        });
        stepButtons.appendChild(finishBtn);

        if (scannedCount < shelf.capacity) {
            missingBtn = document.createElement("button");
            missingBtn.className = "secondary-btn inventory-action-btn is-missing";
            missingBtn.textContent = "Короб без наклейки";
            missingBtn.addEventListener("click", () => void openMissingStickerCalendar());
            stepButtons.appendChild(missingBtn);
        }

        // Recorded so finishShelf()'s error paths can re-enable exactly
        // these buttons (see the module-level declaration above).
        shelfFinishBtn = finishBtn;
        shelfMissingBtn = missingBtn;
    }

    // Shared by the QR scanner's onMatch AND (formerly) the manual-entry
    // fallback -- reacts to "this box number is now accounted for on this
    // shelf".
    //
    // Perf note: only the box lookup, dup-check, insert, and shelf_id
    // update are on the critical path (blocks the next scan via
    // startScanner's processingMatch guard). Everything after
    // flashScanSuccess() is denormalized-counter/session-touch
    // housekeeping that doesn't need to finish before the worker scans
    // the next box, so it runs in the background instead of adding 3-4
    // more sequential network round trips to every single scan -- this
    // was the main source of the app feeling slow during rapid scanning.
    async function recordFoundBox(boxNumber, shelf) {
        const { data: boxRows, error: boxLookupError } = await supabaseClient.from("wms_no_shk_boxes").select("id").eq("box_number", boxNumber).limit(1);
        if (boxLookupError) { stepMsg.textContent = "Ошибка: " + boxLookupError.message; return; }
        const box = boxRows && boxRows[0];
        if (!box) { reportScanError("Короб №" + boxNumber + " не найден в системе"); return; }

        const { data: dup, error: dupError } = await supabaseClient
            .from("wms_no_shk_inventory_box_results")
            .select("id")
            .eq("session_id", activeSession.id)
            .eq("shelf_id", shelf.id)
            .eq("box_id", box.id)
            .maybeSingle();
        if (dupError) { stepMsg.textContent = "Ошибка: " + dupError.message; return; }
        if (dup) { reportScanError("Короб №" + boxNumber + " уже отсканирован"); return; }

        const scanOrder = Number(activeSession.nextScanOrder) || 1;

        // Independent writes (different tables, neither depends on the
        // other's result) -- run in parallel rather than sequentially.
        const [{ error: insertError }, { error: boxUpdateError }] = await Promise.all([
            supabaseClient.from("wms_no_shk_inventory_box_results").insert({ session_id: activeSession.id, shelf_id: shelf.id, box_id: box.id, result: "found", scan_order: scanOrder }),
            // shortage:false -- a box scanned onto a shelf is by definition
            // no longer missing, even if a PREVIOUS shelf's finishShelf()
            // had flagged it (see finishShelf() below).
            supabaseClient.from("wms_no_shk_boxes").update({ shelf_id: shelf.id, shortage: false }).eq("id", box.id),
        ]);
        if (insertError) { stepMsg.textContent = "Ошибка: " + insertError.message; return; }
        if (boxUpdateError) { stepMsg.textContent = "Ошибка: " + boxUpdateError.message; return; }

        // The box is now safely recorded -- give immediate feedback and
        // let scanning resume right away; counter/session housekeeping
        // below runs in the background.
        flashScanSuccess();
        activeSession.nextScanOrder = scanOrder + 1;
        addBoxToShelfVisual(boxNumber, shelf, false);
        stepMsg.textContent = "Короб №" + boxNumber + " добавлен (" + shelf.name + ")";

        void (async () => {
            const [{ count: newCount }, { count: foundCount }] = await Promise.all([
                supabaseClient.from("wms_no_shk_inventory_box_results").select("id", { count: "exact", head: true }).eq("session_id", activeSession.id).eq("shelf_id", activeSession.shelfId),
                supabaseClient.from("wms_no_shk_inventory_box_results").select("id", { count: "exact", head: true }).eq("session_id", activeSession.id).eq("shelf_id", activeSession.shelfId).eq("result", "found"),
            ]);
            // Only re-render if we're still on the SAME shelf -- the
            // worker may have already moved on by the time this resolves.
            if (activeSession.shelfId === shelf.id) {
                const count = newCount || 0;
                renderShelfButtons(count, shelf);
                if (count >= shelf.capacity && !autoAdvancingShelf) {
                    autoAdvancingShelf = true;
                    stopScanner();
                    stepButtons.replaceChildren();
                    stepMsg.textContent = "Полка заполнена. Переходим к следующей…";
                    setTimeout(() => { void finishShelf(); }, 620);
                }
            }
            const [{ error: auditUpdateError }, { error: touchError }] = await Promise.all([
                supabaseClient.from("wms_no_shk_inventory_shelf_audits").update({ boxes_found_count: foundCount || 0 }).eq("session_id", activeSession.id).eq("shelf_id", shelf.id),
                supabaseClient.from("wms_no_shk_inventory_sessions").update({ last_activity_at: new Date().toISOString() }).eq("id", activeSession.id),
            ]);
            if (auditUpdateError) console.error("Failed to update boxes_found_count", auditUpdateError); // denormalized counter only -- the box result above already succeeded
            if (touchError) console.error("Failed to touch last_activity_at", touchError); // housekeeping only
        })();
    }

    async function startBoxScan(shelf, statusMsg) {
        stepTitle.textContent = "Отсканируйте все короба на полке слева направо";
        stepMsg.textContent = statusMsg || shelf.name;
        autoAdvancingShelf = false;
        await restoreShelfVisual(shelf);
        const count = await scannedCountForCurrentShelf();
        renderShelfButtons(count, shelf);

        void startScanner(async (text) => {
            const match = /^WMSP\.BOX\.(\d+)$/.exec(text);
            if (!match) { reportScanError("Это не QR-код короба"); return; }
            await recordFoundBox(Number(match[1]), shelf);
            // keep scanning -- do NOT stop the scanner here, the loop in
            // startScanner already re-arms via requestAnimationFrame for
            // every call that doesn't return early
        });
    }

    // ---------- Короб без наклейки ----------
    // formatDateShort/addDays now live in inventory-dates.js (shared,
    // tested global-scope module -- see inventory-dates.test.js), loaded
    // via <script> before this file in mobile-inventory.html.

    // Instead of picking a specific box from a list (a full-warehouse list
    // was unwieldy and easy to lose boxes in), the worker specifies the
    // box by what's actually knowable about an unlabeled box on the shelf:
    // its date and shift. Matches the first (lowest box_number) existing
    // box for that date+shift; if none exists, offers to create one on the
    // spot (box_number is a DB identity column -- auto-assigned).
    function openMissingStickerCalendar() {
        stopScanner();
        stepTitle.textContent = "Короб без наклейки";
        stepMsg.textContent = "Выберите дату и смену";
        stepButtons.innerHTML = "";

        const dateInput = document.createElement("input");
        dateInput.type = "date";
        dateInput.className = "field";
        // Left empty (not defaulted to today) on purpose -- the shift
        // buttons below only appear once the worker actually picks a date,
        // via the dateInput 'change' listener below.
        dateInput.style.marginBottom = "10px";
        stepButtons.appendChild(dateInput);

        // Hidden until a date is actually picked -- showing both shift
        // buttons up front, before the worker has chosen a date, invited
        // tapping one before the date field was even touched.
        const dayBtn = document.createElement("button");
        dayBtn.className = "primary-btn inventory-action-btn";
        dayBtn.textContent = "Короб День";
        dayBtn.style.display = "none";
        stepButtons.appendChild(dayBtn);

        const nightBtn = document.createElement("button");
        nightBtn.className = "primary-btn inventory-action-btn";
        nightBtn.textContent = "Короб Ночь";
        nightBtn.style.display = "none";
        stepButtons.appendChild(nightBtn);

        dateInput.addEventListener("change", () => {
            const show = Boolean(dateInput.value);
            dayBtn.style.display = show ? "" : "none";
            nightBtn.style.display = show ? "" : "none";
        });

        function pick(shiftType) {
            if (dayBtn.disabled) return; // both disabled together, checking one covers both
            if (!dateInput.value) { stepMsg.textContent = "Выберите дату"; return; }
            dayBtn.disabled = true;
            nightBtn.disabled = true;
            void handleMissingStickerDateShift(dateInput.value, shiftType).finally(() => {
                dayBtn.disabled = false;
                nightBtn.disabled = false;
            });
        }
        dayBtn.addEventListener("click", () => pick("Дневная"));
        nightBtn.addEventListener("click", () => pick("Ночная"));

        const backBtn = document.createElement("button");
        backBtn.className = "secondary-btn inventory-action-btn";
        backBtn.textContent = "Назад";
        backBtn.addEventListener("click", () => void startBoxScan(activeSession.shelf));
        stepButtons.appendChild(backBtn);
    }

    async function handleMissingStickerDateShift(dateStr, shiftType) {
        stepMsg.textContent = "Ищу короб...";
        const { data: matches, error } = await supabaseClient
            .from("wms_no_shk_boxes")
            .select("id,box_number,area,box_type,shift_date,shift_type")
            .eq("shift_date", dateStr)
            .eq("shift_type", shiftType)
            .order("box_number", { ascending: true })
            .limit(1);
        if (error) { stepMsg.textContent = "Ошибка: " + error.message; return; }
        let box = matches && matches[0];
        if (!box) {
            const label = formatDateShort(dateStr) + ", " + (shiftType === "Ночная" ? "ночь" : "день");
            const confirmed = window.confirm("Короба за " + label + " не существует. Создать?");
            if (!confirmed) { stepMsg.textContent = ""; return; }
            const { data: newBox, error: createError } = await supabaseClient
                .from("wms_no_shk_boxes")
                .insert({ shift_date: dateStr, shift_type: shiftType })
                .select("id,box_number,area,box_type,shift_date,shift_type")
                .single();
            if (createError) { stepMsg.textContent = "Не удалось создать: " + createError.message; return; }
            box = newBox;
        }
        await selectMissingStickerBox(box);
    }

    // Perf note: same background-housekeeping split as recordFoundBox --
    // only the result insert + shelf_id update + print-job queue are on
    // the critical path before the worker sees "поставлен в печать" and
    // scanning resumes; the denormalized counter and session touch run
    // after.
    async function selectMissingStickerBox(box) {
        const { data: duplicate, error: duplicateError } = await supabaseClient
            .from("wms_no_shk_inventory_box_results")
            .select("id")
            .eq("session_id", activeSession.id)
            .eq("shelf_id", activeSession.shelfId)
            .eq("box_id", box.id)
            .maybeSingle();
        if (duplicateError) { stepMsg.textContent = "Ошибка: " + duplicateError.message; return; }
        if (duplicate) { reportScanError("Этот короб уже учтён на полке"); return; }
        const scanOrder = Number(activeSession.nextScanOrder) || 1;
        const { error: resultInsertError } = await supabaseClient.from("wms_no_shk_inventory_box_results").insert({
            session_id: activeSession.id, shelf_id: activeSession.shelfId, box_id: box.id, result: "missing_sticker", scan_order: scanOrder,
        });
        if (resultInsertError) { stepMsg.textContent = "Ошибка: " + resultInsertError.message; return; }
        const { error: boxUpdateError } = await supabaseClient.from("wms_no_shk_boxes").update({ shelf_id: activeSession.shelfId, shortage: false }).eq("id", box.id);
        if (boxUpdateError) { stepMsg.textContent = "Ошибка: " + boxUpdateError.message; return; }

        // Reprint this box's own sticker -- same payload shape
        // no_shk_zone.js's printActiveBox() builds for the "Короб «Без
        // ШК»" template.
        const { data: template, error: templateError } = await supabaseClient
            .from("print_label_templates")
            .select("id,width_mm,height_mm,elements")
            .eq("name", "Короб «Без ШК»")
            .maybeSingle();
        if (templateError) console.error("Failed to load print template", templateError); // reprint is best-effort here -- the box result above already succeeded
        if (template) {
            const tsplData = {
                box_code: "WMSP.BOX." + String(box.box_number).padStart(5, "0"),
                box_number: String(box.box_number),
                box_type: box.box_type,
                area: box.area,
                date_line1: formatDateShort(box.shift_date),
                date_line2: box.shift_type === "Ночная" ? formatDateShort(addDays(box.shift_date, 1)) : "",
                shift: box.shift_type === "Ночная" ? "Ночь" : "День",
            };
            const { error: printJobError } = await supabaseClient.from("print_jobs").insert({
                template_id: template.id, data: tsplData,
                tspl: window.buildTsplPayloadBase64 ? window.buildTsplPayloadBase64(template, tsplData) : null,
                created_by: user.id != null ? String(user.id) : null,
            });
            if (printJobError) console.error("Failed to queue print job", printJobError); // reprint is best-effort -- the box result above already succeeded
        }

        flashScanSuccess();
        activeSession.nextScanOrder = scanOrder + 1;
        addBoxToShelfVisual(box.box_number, activeSession.shelf, true);
        void startBoxScan(activeSession.shelf, "Стикер короба №" + box.box_number + " поставлен в печать");

        void (async () => {
            const { error: auditUpdateError } = await supabaseClient.from("wms_no_shk_inventory_shelf_audits")
                .update({ boxes_missing_sticker_count: (await currentMissingStickerCount()) })
                .eq("session_id", activeSession.id).eq("shelf_id", activeSession.shelfId);
            if (auditUpdateError) console.error("Failed to update boxes_missing_sticker_count", auditUpdateError); // denormalized counter only -- the box result above already succeeded
            const { error: touchError } = await supabaseClient.from("wms_no_shk_inventory_sessions").update({ last_activity_at: new Date().toISOString() }).eq("id", activeSession.id);
            if (touchError) console.error("Failed to touch last_activity_at", touchError); // housekeeping only
        })();
    }

    async function currentMissingStickerCount() {
        const { count, error } = await supabaseClient
            .from("wms_no_shk_inventory_box_results")
            .select("id", { count: "exact", head: true })
            .eq("session_id", activeSession.id).eq("shelf_id", activeSession.shelfId).eq("result", "missing_sticker");
        if (error) console.error("Failed to count missing_sticker results", error);
        return count || 0;
    }

    async function currentFoundCount() {
        const { count, error } = await supabaseClient
            .from("wms_no_shk_inventory_box_results")
            .select("id", { count: "exact", head: true })
            .eq("session_id", activeSession.id).eq("shelf_id", activeSession.shelfId).eq("result", "found");
        if (error) console.error("Failed to count found results", error);
        return count || 0;
    }

    // ---------- Finishing a shelf ----------
    // Re-enables the shelf-step buttons on an error return below -- they
    // were disabled synchronously by renderShelfButtons' click handler
    // (the re-entrancy guard) before finishShelf() ran, so a failure here
    // must give the worker a way to retry instead of leaving both buttons
    // permanently dead (same reasoning as selectMissingStickerBox's own
    // re-enable-on-error, one function away in this same file).
    function reenableShelfButtons() {
        if (shelfFinishBtn) shelfFinishBtn.disabled = false;
        if (shelfMissingBtn) shelfMissingBtn.disabled = false;
    }

    async function finishShelf() {
        stopScanner();
        const shelf = activeSession.shelf;

        // Boxes the DB currently says are on this shelf but weren't
        // matched (found or missing_sticker) during this pass -> not_found.
        const { data: dbBoxesHere, error: dbBoxesHereError } = await supabaseClient
            .from("wms_no_shk_boxes")
            .select("id")
            .eq("shelf_id", shelf.id);
        if (dbBoxesHereError) { stepMsg.textContent = "Ошибка: " + dbBoxesHereError.message; reenableShelfButtons(); return; }
        const { data: accountedFor, error: accountedForError } = await supabaseClient
            .from("wms_no_shk_inventory_box_results")
            .select("box_id")
            .eq("session_id", activeSession.id).eq("shelf_id", shelf.id);
        if (accountedForError) { stepMsg.textContent = "Ошибка: " + accountedForError.message; reenableShelfButtons(); return; }
        const accountedIds = new Set((accountedFor || []).map((r) => r.box_id));
        const notFound = (dbBoxesHere || []).filter((b) => !accountedIds.has(b.id));
        if (notFound.length) {
            // A box that was supposed to be here but wasn't scanned this
            // pass no longer belongs to this shelf -- clear shelf_id and
            // flag it shortage:true so it drops out of the shelf entirely
            // and surfaces in the display's "Недостача" section instead of
            // silently still showing up here on the next render. Cleared
            // again (shortage:false) the moment it's actually found on any
            // shelf -- see recordFoundBox()/selectMissingStickerBox() above.
            const [{ error: notFoundInsertError }, { error: shortageUpdateError }] = await Promise.all([
                supabaseClient.from("wms_no_shk_inventory_box_results").insert(
                    notFound.map((b) => ({ session_id: activeSession.id, shelf_id: shelf.id, box_id: b.id, result: "not_found" }))
                ),
                supabaseClient.from("wms_no_shk_boxes").update({ shelf_id: null, shortage: true }).in("id", notFound.map((b) => b.id)),
            ]);
            if (notFoundInsertError) { stepMsg.textContent = "Ошибка: " + notFoundInsertError.message; reenableShelfButtons(); return; }
            if (shortageUpdateError) { stepMsg.textContent = "Ошибка: " + shortageUpdateError.message; reenableShelfButtons(); return; }
        }

        const { error: auditFinishError } = await supabaseClient.from("wms_no_shk_inventory_shelf_audits")
            .update({ finished_at: new Date().toISOString(), boxes_not_found_count: notFound.length })
            .eq("session_id", activeSession.id).eq("shelf_id", shelf.id);
        if (auditFinishError) { stepMsg.textContent = "Ошибка: " + auditFinishError.message; reenableShelfButtons(); return; }

        const { count: totalShelves, error: totalShelvesError } = await supabaseClient
            .from("wms_no_shk_shelves")
            .select("id", { count: "exact", head: true });
        if (totalShelvesError) { stepMsg.textContent = "Ошибка: " + totalShelvesError.message; reenableShelfButtons(); return; }
        const { data: finishedRows, error: finishedRowsError } = await supabaseClient
            .from("wms_no_shk_inventory_shelf_audits")
            .select("shelf_id")
            .eq("session_id", activeSession.id)
            .not("finished_at", "is", null);
        if (finishedRowsError) { stepMsg.textContent = "Ошибка: " + finishedRowsError.message; reenableShelfButtons(); return; }
        const finishedCount = new Set((finishedRows || []).map((r) => r.shelf_id)).size;

        if (totalShelves != null && finishedCount >= totalShelves) {
            const { error: completeSessionError } = await supabaseClient
                .from("wms_no_shk_inventory_sessions")
                .update({ status: "completed", step: "completed", finished_at: new Date().toISOString(), last_activity_at: new Date().toISOString() })
                .eq("id", activeSession.id);
            // The shelf itself is already finished in the DB by this point
            // (the shelf_audits update above succeeded) -- only the
            // session-completion update failed, so re-enabling here lets
            // the worker retry the finish tap, which safely re-runs this
            // now-idempotent shelf-finish work and tries the completion
            // update again, rather than being stuck on a dead screen.
            if (completeSessionError) { stepMsg.textContent = "Ошибка: " + completeSessionError.message; reenableShelfButtons(); return; }
            void showCompletion();
            return;
        }

        activeSession.shelfId = null;
        activeSession.shelf = null;
        void startShelfScan();
    }

    // ---------- Completion ----------
    async function showCompletion() {
        stepButtons.innerHTML = "";
        video.style.display = "none";
        hideShelfVisual();
        const card = document.querySelector(".inventory-card");
        if (card) {
            card.classList.remove("is-complete");
            void card.offsetWidth;
            card.classList.add("is-complete");
        }
        playCompletionJingle();
        const { data, error } = await supabaseClient.from("wms_no_shk_inventory_sessions").select("started_at,finished_at").eq("id", activeSession.id).single();
        stepTitle.textContent = "✓ Инвентаризация завершена";
        if (error || !data) {
            // The session itself already completed successfully (finishShelf()
            // wouldn't have called showCompletion() otherwise) -- this is just
            // the follow-up read for the elapsed-time display failing, so fall
            // back to a generic message instead of crashing on
            // `new Date(undefined)` below.
            stepMsg.textContent = "Готово!";
        } else {
            const elapsedMs = new Date(data.finished_at).getTime() - new Date(data.started_at).getTime();
            const totalSec = Math.max(0, Math.round(elapsedMs / 1000));
            const hh = String(Math.floor(totalSec / 3600)).padStart(2, "0");
            const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
            const ss = String(totalSec % 60).padStart(2, "0");
            stepMsg.textContent = "Время: " + hh + ":" + mm + ":" + ss;
        }
        setTimeout(() => {
            close();
            onExit();
        }, 3000);
    }

    // Recovers a phone left open on a session that got marked abandoned
    // (by display.js's own 30-minute staleness check, or by this phone's
    // own staleness self-check below) -- whichever side notices first
    // wins, both react the same way: reload back to the start screen
    // instead of sitting stuck on a dead scan prompt.
    supabaseClient
        .channel("mobile_inventory_session_watch")
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "wms_no_shk_inventory_sessions" }, (payload) => {
            if (activeSession && payload.new.id === activeSession.id && payload.new.status === "abandoned") {
                stopScanner();
                activeSession = null;
                if (isOpen) renderStartScreen();
            }
        })
        .subscribe();

    // Same 30-minute staleness rule as display.js's own watcher, run here
    // too so the feature doesn't depend on a display.html tab being open
    // anywhere -- most relevant for the "Инвентаризация уже идёт" screen,
    // where this phone is only observing someone ELSE's session and would
    // otherwise have no way to notice it went stale.
    const INVENTORY_ABANDON_MS = 30 * 60 * 1000;
    setInterval(async () => {
        if (!isOpen || !activeSession || !activeSession.id) return;
        const { data, error } = await supabaseClient
            .from("wms_no_shk_inventory_sessions")
            .select("status,last_activity_at")
            .eq("id", activeSession.id)
            .maybeSingle();
        if (error || !data) return;
        if (data.status !== "waiting_for_phone" && data.status !== "in_progress") return;
        const staleMs = Date.now() - new Date(data.last_activity_at).getTime();
        if (staleMs > INVENTORY_ABANDON_MS) {
            await supabaseClient
                .from("wms_no_shk_inventory_sessions")
                .update({ status: "abandoned" })
                .eq("id", activeSession.id)
                .in("status", ["waiting_for_phone", "in_progress"]);
        }
    }, 20000);

    function open(nextOptions) {
        user = nextOptions && nextOptions.user ? nextOptions.user : user;
        onExit = nextOptions && typeof nextOptions.onExit === "function" ? nextOptions.onExit : onExit;
        isOpen = true;
        video.style.display = "";
        void initInventoryFlow();
    }

    function close() {
        isOpen = false;
        stopScanner();
    }

    return { open, close };
    }

    return {
        open(options) {
            if (!options || !options.supabaseClient || !options.user) return;
            if (!controller) controller = createInventory(options);
            controller.open(options);
        },
        close() {
            if (controller) controller.close();
        },
    };
})();
