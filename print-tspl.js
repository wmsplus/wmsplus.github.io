// print-tspl.js — builds TSPL2 command text from a label template + field
// values. Pure, no DOM/network, loaded as a plain global-scope <script>
// like task-verdicts.js. The print bridge (print-bridge/) never runs this
// file — it only ever relays the string this produces.

// TSC desktop-class printers (DA-series included) are commonly 203dpi.
// Not confirmed against this specific unit -- see Task 8 of
// docs/superpowers/plans/2026-08-31-print-bridge.md. If labels come out
// the wrong size/position on real hardware, this is the first constant
// to check.
const PRINTER_DPI = 203;
const DOTS_PER_MM = PRINTER_DPI / 25.4;

function mmToDots(mm) {
    return Math.round(Number(mm || 0) * DOTS_PER_MM);
}

function tsplEscape(value) {
    // TSPL string literals are double-quoted; escape embedded quotes and
    // strip control characters that would break the command line.
    return String(value == null ? "" : value)
        .replace(/["\\]/g, "")
        .replace(/[\r\n]/g, " ");
}

function resolveElementValue(element, data) {
    if (Object.prototype.hasOwnProperty.call(element, "literal")) return element.literal;
    return (data && data[element.field] != null) ? data[element.field] : "";
}

const VALID_ROTATIONS = [0, 90, 180, 270];

function textCommand(element, data) {
    const x = mmToDots(element.x_mm);
    const y = mmToDots(element.y_mm);
    const value = tsplEscape(resolveElementValue(element, data));
    // Built-in font "3" (a mid-size bitmap font); font_size scales it via
    // the x/y multiplier args (TSPL takes integer multipliers, not a
    // point size) -- font_size 10 -> multiplier 1, roughly doubling per
    // +10, clamped to TSPL's 1-10 multiplier range.
    const mult = Math.min(10, Math.max(1, Math.round((Number(element.font_size) || 10) / 10)));
    const rotation = VALID_ROTATIONS.indexOf(Number(element.rotation)) !== -1 ? Number(element.rotation) : 0;
    return `TEXT ${x},${y},"3",${rotation},${mult},${mult},"${value}"`;
}

function barcodeCommand(element, data) {
    const x = mmToDots(element.x_mm);
    const y = mmToDots(element.y_mm);
    const height = mmToDots(element.height_mm || 10);
    const value = tsplEscape(resolveElementValue(element, data));
    const type = element.barcode_type === "ean13" ? "EAN13" : "128";
    // human-readable line under the barcode (1) -- useful on a warehouse
    // floor where someone may need to read it without a scanner.
    return `BARCODE ${x},${y},"${type}",${height},1,0,2,2,"${value}"`;
}

function qrCommand(element, data) {
    const x = mmToDots(element.x_mm);
    const y = mmToDots(element.y_mm);
    const value = tsplEscape(resolveElementValue(element, data));
    // ECC level M (medium, TSPL's "M"), cell width from width_mm (a QR
    // "cell" in TSPL is specified as a dot-size integer, not mm directly
    // -- approximate via width_mm / expected module count; a flat default
    // of 4 dots/cell reads reliably at 50mm label size and is adjusted
    // per-template via width_mm if a template needs it denser/looser).
    const cellSize = Math.max(1, Math.round(mmToDots(element.width_mm || 20) / 40));
    return `QRCODE ${x},${y},M,${cellSize},A,0,"${value}"`;
}

// Purely decorative plus/cross, drawn as two overlapping filled rectangles
// (TSPL's BAR command) rather than a bitmap -- no image data to encode,
// just two more plain-text TSPL lines. x_mm/y_mm is the top-left of the
// cross's square bounding box.
function crossCommand(element) {
    const size = mmToDots(element.size_mm || 12);
    const thickness = mmToDots(element.thickness_mm || 4);
    const x = mmToDots(element.x_mm);
    const y = mmToDots(element.y_mm);
    const vBarX = x + Math.round((size - thickness) / 2);
    const hBarY = y + Math.round((size - thickness) / 2);
    return `BAR ${vBarX},${y},${thickness},${size}\r\nBAR ${x},${hBarY},${size},${thickness}`;
}

function elementCommand(element, data) {
    if (element.type === "text") return textCommand(element, data);
    if (element.type === "barcode") return barcodeCommand(element, data);
    if (element.type === "qr") return qrCommand(element, data);
    if (element.type === "cross") return crossCommand(element);
    throw new Error("print-tspl: unknown element type '" + element.type + "'");
}

function buildTsplFromTemplate(template, data) {
    const widthMm = Number(template.width_mm) || 50;
    const heightMm = Number(template.height_mm) || 50;
    const elements = Array.isArray(template.elements) ? template.elements : [];
    const lines = [
        `SIZE ${widthMm} mm,${heightMm} mm`,
        `GAP 2 mm,0 mm`,
        `CLS`,
        // Confirmed on-site against the real DA220 (2026-09-01): without
        // this, content prints mirrored 180° and shifted to the opposite
        // corner from the x_mm/y_mm coordinates given.
        `DIRECTION 1`,
        // Cyrillic text: the printer expects Windows-1251 bytes, not
        // UTF-8. buildTsplPayloadBase64() below does that re-encoding --
        // confirmed needed on-site (2026-09-02): without it, Cyrillic
        // text printed as garbled glyphs.
        `CODEPAGE 1251`,
        ...elements.map((element) => elementCommand(element, data || {})),
        `PRINT 1,1`,
    ];
    return lines.join("\r\n") + "\r\n";
}

// CP1251 (Windows Cyrillic) byte for one Unicode code point. ASCII passes
// through unchanged; А-я (U+0410-U+044F) is a contiguous block that maps
// linearly to 0xC0-0xFF; Ё/ё and common "smart" punctuation sit outside
// that block at fixed positions. Anything else falls back to "?" rather
// than corrupting the byte stream with an unmappable character.
const CP1251_PUNCTUATION = {
    0x2018: 0x91, // '
    0x2019: 0x92, // '
    0x201c: 0x93, // "
    0x201d: 0x94, // "
    0x2013: 0x96, // –
    0x2014: 0x97, // —
    0x2026: 0x85, // …
    0x2116: 0xb9, // №
    0x00ab: 0xab, // «
    0x00bb: 0xbb, // »
};

function cp1251ByteForCodePoint(cp) {
    if (cp < 0x80) return cp;
    if (cp === 0x0401) return 0xa8; // Ё
    if (cp === 0x0451) return 0xb8; // ё
    if (cp >= 0x0410 && cp <= 0x044f) return cp - 0x0410 + 0xc0; // А-я
    if (Object.prototype.hasOwnProperty.call(CP1251_PUNCTUATION, cp)) return CP1251_PUNCTUATION[cp];
    return 0x3f; // '?' -- unmappable character
}

function cp1251Encode(str) {
    const bytes = [];
    for (const ch of String(str == null ? "" : str)) {
        bytes.push(cp1251ByteForCodePoint(ch.codePointAt(0)));
    }
    return bytes;
}

function bytesToBase64(bytes) {
    // Node (tests, and any future server-side use) vs browser (production
    // pages) -- pick whichever byte->base64 primitive is actually available.
    if (typeof Buffer !== "undefined") {
        return Buffer.from(bytes).toString("base64");
    }
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

// The actual value stored in print_jobs.tspl and sent to the bridge:
// CP1251-encoded bytes, base64-wrapped so the text column can hold them
// safely. The bridge only ever base64-decodes this and writes the raw
// bytes -- it has no charset knowledge of its own. This is also the seam
// a future "image" element type hooks into: BITMAP's raw pixel bytes
// would join this same byte array before base64-encoding, with zero
// changes needed on the bridge side.
function buildTsplPayloadBase64(template, data) {
    const tspl = buildTsplFromTemplate(template, data);
    return bytesToBase64(cp1251Encode(tspl));
}

// Plain global-scope exports (this repo has no module system) plus a
// CommonJS export so print-tspl.test.js (Node, no browser) can require it.
if (typeof module !== "undefined" && module.exports) {
    module.exports = { buildTsplFromTemplate, buildTsplPayloadBase64, cp1251Encode, bytesToBase64, mmToDots, tsplEscape };
}
