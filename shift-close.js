// shift-close.js — pure helpers for the end-of-shift box-closing flow
// (docs/superpowers/specs/2026-09-10-shift-box-closing-design.md). No
// DOM/network, loaded as a plain global-scope <script> like print-tspl.js.

// The physical QR code placed in the revision office ("кабинет ревизии")
// that confirms the worker is physically there before printing/closing.
const SHIFT_CLOSE_QR_VALUE = "WMSP.PLCE.WSHK.FLR";

// Hard gate for the box actively forming the CURRENT shift (not older,
// already-finished-shift boxes, which have no time gate at all): it only
// becomes closeable in the last 30 minutes of its own shift, mirroring
// intake.js's computeShift() day/night boundary (day 8:00-20:00, night
// 20:00-8:00) -- day's box unlocks at 19:30, night's at 7:30.
function isCurrentShiftBoxUnlocked(date) {
    const hour = date.getHours();
    if (hour >= 8 && hour < 20) {
        return hour === 19 && date.getMinutes() >= 30;
    }
    return hour === 7 && date.getMinutes() >= 30;
}

// Splits wms_no_shk_box_contents() rows into the ones that need their own
// КГТ sticker vs everything else, which the box's own single sticker
// already covers (a КГТ item never goes into the box itself).
function partitionBoxContents(rows) {
    const kgtItems = [];
    for (const row of (rows || [])) {
        if (row.item_type === "КГТ") kgtItems.push(row);
    }
    return { kgtItems };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { SHIFT_CLOSE_QR_VALUE, isCurrentShiftBoxUnlocked, partitionBoxContents };
}
