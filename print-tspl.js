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

// TSC's built-in bitmap font "3" (the only font textCommand ever uses) has
// a nominal cell size of 16x24 dots at its base 1x multiplier, per the
// TSPL2 programming manual -- like PRINTER_DPI above, this has NOT been
// confirmed against the physical DA220; adjust here if on-site testing
// shows otherwise. Used to estimate how many characters/lines of text
// actually fit in a given mm budget for wrap_width_mm below.
const FONT3_CHAR_WIDTH_MM_AT_MULT1 = 16 / DOTS_PER_MM;
const FONT3_CHAR_HEIGHT_MM_AT_MULT1 = 24 / DOTS_PER_MM;

// Greedy word-wrap into at most maxLines lines of at most maxCharsPerLine
// characters each. A word wider than one line is hard-broken (no narrower
// unit to wrap on); content that still doesn't fit within maxLines is
// truncated with an ellipsis on the last line -- this is a label, not a
// document, there's no more room to give it.
function wrapText(value, maxCharsPerLine, maxLines) {
    const words = String(value == null ? "" : value).split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    let i = 0;

    function pushCurrent() {
        if (current) { lines.push(current); current = ""; }
    }

    while (i < words.length && lines.length < maxLines) {
        const word = words[i];
        if (word.length > maxCharsPerLine) {
            pushCurrent();
            if (lines.length >= maxLines) break;
            lines.push(word.slice(0, maxCharsPerLine));
            words[i] = word.slice(maxCharsPerLine); // remainder retried next iteration
            continue;
        }
        const candidate = current ? current + " " + word : word;
        if (candidate.length <= maxCharsPerLine) {
            current = candidate;
            i++;
        } else {
            pushCurrent();
        }
    }
    if (lines.length < maxLines) pushCurrent();

    const usedAllInput = i >= words.length && !current;
    if (lines.length > maxLines) lines.length = maxLines;
    if (!usedAllInput && lines.length) {
        const last = lines[lines.length - 1];
        const budget = Math.max(0, maxCharsPerLine - 1);
        lines[lines.length - 1] = (last.length > budget ? last.slice(0, budget) : last) + "…";
    }
    return lines.length ? lines : [""];
}

function textCommand(element, data) {
    const x = mmToDots(element.x_mm);
    const y = mmToDots(element.y_mm);
    const value = resolveElementValue(element, data);
    // Built-in font "3" (a mid-size bitmap font); font_size scales it via
    // the x/y multiplier args (TSPL takes integer multipliers, not a
    // point size) -- font_size 10 -> multiplier 1, roughly doubling per
    // +10, clamped to TSPL's 1-10 multiplier range.
    const mult = Math.min(10, Math.max(1, Math.round((Number(element.font_size) || 10) / 10)));
    const rotation = VALID_ROTATIONS.indexOf(Number(element.rotation)) !== -1 ? Number(element.rotation) : 0;

    // wrap_width_mm opts an element into multi-line word-wrap instead of a
    // single fixed-width TEXT command -- everything else (barcode, qr,
    // single-line text) is unaffected, this only activates when a template
    // explicitly sets it (e.g. the "КГТ «Без ШК»" name field, which needs
    // to fit long free-text item names on a small label).
    if (element.wrap_width_mm) {
        const maxCharsPerLine = Math.max(1, Math.floor(Number(element.wrap_width_mm) / (FONT3_CHAR_WIDTH_MM_AT_MULT1 * mult)));
        const maxLines = Math.max(1, Number(element.max_lines) || 2);
        const lineHeightMm = Number(element.line_height_mm) || Math.round(FONT3_CHAR_HEIGHT_MM_AT_MULT1 * mult * 1.5);
        const lines = wrapText(value, maxCharsPerLine, maxLines);
        return lines
            .map((line, i) => `TEXT ${x},${y + mmToDots(lineHeightMm * i)},"3",${rotation},${mult},${mult},"${tsplEscape(line)}"`)
            .join("\r\n");
    }

    return `TEXT ${x},${y},"3",${rotation},${mult},${mult},"${tsplEscape(value)}"`;
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

// QR error-correction-level M capacity (max characters) by version, for
// the two encoding modes every QR value in this app actually uses -- a
// short uppercase/digit/symbol code (Alphanumeric mode: box_code,
// shelf_code, "WMSP.PLCE.WSHK...") or a longer mixed-case string (Byte
// mode, e.g. "WMSP.INV." + a lowercase-hex session uuid). Row index i
// is version i+1; module count for a version is 4*version+17 (the
// standard QR side-length formula). Index by whichever mode `value`
// actually is, pick the first version whose capacity covers its length.
const QR_ECC_M_CAPACITY = [
    // [alphanumeric, byte]
    [20, 14], [38, 26], [61, 42], [90, 62], [122, 84],
    [154, 106], [178, 122], [221, 152], [262, 180], [311, 213],
];
const QR_ALPHANUMERIC_RE = /^[A-Z0-9 $%*+\-./:]*$/;

// A QR's cellSize (dots per module) only controls PER-MODULE size --
// the printer itself decides the actual module COUNT from the data
// length/mode/ECC level, which this app's code never sees. The previous
// version of this function assumed a flat ~40 modules regardless of
// content and picked cellSize to fit width_mm against that guess -- but
// every real value here (14-20 char alphanumeric codes) is versions
// 1-2, only ~21-25 modules, so the ACTUAL printed size came out at
// roughly HALF of width_mm. That silently made every box/shelf QR
// sticker in this app print much smaller and denser than intended,
// which is the leading suspect for real-world "phone camera can't
// scan this QR reliably" reports -- estimating the true module count
// from the value itself (rather than a fixed guess) fixes the size for
// any FUTURE print/reprint; it can't retroactively fix stickers already
// printed at the old (smaller) size.
function estimateQrModuleCount(value) {
    const isAlphanumeric = QR_ALPHANUMERIC_RE.test(value);
    const len = value.length;
    for (let v = 0; v < QR_ECC_M_CAPACITY.length; v++) {
        const capacity = QR_ECC_M_CAPACITY[v][isAlphanumeric ? 0 : 1];
        if (len <= capacity) return 4 * (v + 1) + 17;
    }
    // Longer than this table covers -- fall back to its last (biggest)
    // version's module count rather than guessing further.
    return 4 * QR_ECC_M_CAPACITY.length + 17;
}

function qrCommand(element, data) {
    const x = mmToDots(element.x_mm);
    const y = mmToDots(element.y_mm);
    const value = tsplEscape(resolveElementValue(element, data));
    // ECC level M (medium, TSPL's "M"), cell width from width_mm (a QR
    // "cell" in TSPL is specified as a dot-size integer, not mm directly
    // -- derived from width_mm / the ACTUAL module count this value's
    // length+mode will produce, so the printed QR's real physical size
    // actually matches width_mm instead of silently coming out smaller).
    const moduleCount = estimateQrModuleCount(value);
    const cellSize = Math.max(1, Math.round(mmToDots(element.width_mm || 20) / moduleCount));
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
    module.exports = { buildTsplFromTemplate, buildTsplPayloadBase64, cp1251Encode, bytesToBase64, mmToDots, tsplEscape, wrapText, estimateQrModuleCount };
}
