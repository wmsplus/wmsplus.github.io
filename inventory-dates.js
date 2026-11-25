// inventory-dates.js — date-formatting helpers shared by mobile-inventory.js
// (missing-sticker reprint) and originally copied from no_shk_zone.js's
// printActiveBox(). Pulled into its own tested file after this exact
// formatDateShort/addDays pairing already produced one real bug (a prior
// review round found night-shift boxes printing the wrong second date)
// with no regression test to catch it. Plain global-scope <script> like
// print-tspl.js -- this repo has no module system.

function formatDateShort(isoDate) {
    const parts = String(isoDate).split("-");
    if (parts.length !== 3) return String(isoDate);
    return parts[2] + "." + parts[1] + "." + parts[0].slice(2);
}

function addDays(isoDate, days) {
    const d = new Date(isoDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

// Plain global-scope exports (this repo has no module system) plus a
// CommonJS export so inventory-dates.test.js (Node, no browser) can
// require it -- same pattern as print-tspl.js.
if (typeof module !== "undefined" && module.exports) {
    module.exports = { formatDateShort, addDays };
}
