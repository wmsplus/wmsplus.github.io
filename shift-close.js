// shift-close.js — pure helpers for the end-of-shift box-closing flow
// (docs/superpowers/specs/2026-09-10-shift-box-closing-design.md). No
// DOM/network, loaded as a plain global-scope <script> like print-tspl.js.

// The physical QR code placed in the revision office ("кабинет ревизии")
// that confirms the worker is physically there before printing/closing.
const SHIFT_CLOSE_QR_VALUE = "WMSP.PLCE.WSHK.FLR";

// Hard gate: the shift counter only becomes tappable from 19:30 local
// time onward, no upper bound within that window -- it stays tappable
// through the rest of the day and night until used. The early-morning
// side of that window mirrors intake.js's own computeShift() day/night
// boundary (day shift starts at 8:00), so this stays unlocked for the
// entire night shift rather than an arbitrary cutoff.
function isShiftCloseUnlocked(date) {
    const totalMinutes = date.getHours() * 60 + date.getMinutes();
    return totalMinutes >= (19 * 60 + 30) || date.getHours() < 8;
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
    module.exports = { SHIFT_CLOSE_QR_VALUE, isShiftCloseUnlocked, partitionBoxContents };
}
