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

// ---------- QR rendering: bitmap, not the printer's onboard QRCODE
// command ----------
//
// Real on-site testing (2026-09-24) found the printer's own TSPL QRCODE
// command produces output that NO scanner -- not just this app's jsQR,
// a generic phone camera QR reader too -- recognizes as a valid QR code
// at all, regardless of cellSize/physical size. Meanwhile this exact
// app already has a QR path PROVEN to produce genuinely scannable codes:
// the on-screen pairing QR (display.js/mobile-login.html), rendered via
// the qrcodejs CDN library. So printed QR codes are now built the same
// way -- encode with qrcodejs's own QR model (not the printer's
// firmware), rasterize the EXACT module matrix it computes, and send
// that as a TSPL BITMAP (a raw monochrome image) instead of a QRCODE
// command. This sidesteps the printer's QR encoder entirely; the
// printer only ever draws pixels we already know are correct.
//
// This makes the QR path DOM-dependent (needs `document` + the
// `QRCode` global from qrcodejs) unlike the rest of this file, which is
// why it's isolated to qrModuleMatrixFor() below -- everything else
// (the bit-packing math in packQrModulesToBitmap) stays pure/testable.

// Standard QR minimum quiet zone (blank margin) -- required for reliable
// detection by any scanner; qrcodejs's module matrix does NOT include
// this itself, only the actual symbol.
const QR_QUIET_ZONE_MODULES = 4;

// Packs an already-computed QR module matrix into a 1-bit-per-pixel
// bitmap sized to fit widthMm, adding the quiet zone margin. Pure/no DOM
// -- isDarkFn(row, col) is any function, so this is fully unit-testable
// with a hand-built fake matrix, independent of qrcodejs.
function packQrModulesToBitmap(moduleCount, isDarkFn, widthMm) {
    const totalModules = moduleCount + QR_QUIET_ZONE_MODULES * 2;
    const cellSizeDots = Math.max(1, Math.round(mmToDots(widthMm || 20) / totalModules));
    const pixelSize = totalModules * cellSizeDots;
    const widthBytes = Math.ceil(pixelSize / 8);
    const bytes = new Array(widthBytes * pixelSize).fill(0);
    for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
            if (!isDarkFn(row, col)) continue;
            const pxRowStart = (row + QR_QUIET_ZONE_MODULES) * cellSizeDots;
            const pxColStart = (col + QR_QUIET_ZONE_MODULES) * cellSizeDots;
            for (let dy = 0; dy < cellSizeDots; dy++) {
                const rowByteOffset = (pxRowStart + dy) * widthBytes;
                for (let dx = 0; dx < cellSizeDots; dx++) {
                    const pxCol = pxColStart + dx;
                    bytes[rowByteOffset + (pxCol >> 3)] |= (0x80 >> (pxCol & 7));
                }
            }
        }
    }
    return { widthBytes, heightDots: pixelSize, bytes };
}

// The one DOM-dependent piece: builds the REAL module matrix for a
// value via qrcodejs's own encoder (davidshimjs/qrcodejs -- same CDN
// library and version already used for the pairing QR). Never appended
// to the document -- canvas-based rendering works fine detached, and we
// only read the encoder's internal model, never qrcodejs's own drawn
// pixels (which would reintroduce exactly the anti-aliasing/scaling
// ambiguity this rewrite is trying to avoid).
function qrModuleMatrixFor(value) {
    const container = document.createElement("div");
    // eslint-disable-next-line no-undef -- QRCode comes from the qrcodejs CDN script
    const qr = new QRCode(container, { text: String(value), width: 1, height: 1, correctLevel: QRCode.CorrectLevel.M });
    const model = qr._oQRCode;
    return { moduleCount: model.getModuleCount(), isDark: (row, col) => model.isDark(row, col) };
}

// Full TSPL BITMAP command bytes (header text + raw binary image data +
// trailing CRLF) for one qr-type element. The header text is CP1251-
// encoded like any other command line; the binary image bytes are NOT
// -- cp1251Encode maps unmapped byte values (which real bitmap data is
// full of) to '?', so it would corrupt roughly half of them. This is
// the reason buildTsplBytes() (below) assembles the payload as a byte
// array directly rather than building one big string and encoding it
// as a single last step, the way buildTsplFromTemplate() still does for
// its text-only preview.
function qrBitmapCommandBytes(element, data) {
    const value = tsplEscape(resolveElementValue(element, data));
    const { moduleCount, isDark } = qrModuleMatrixFor(value);
    const { widthBytes, heightDots, bytes } = packQrModulesToBitmap(moduleCount, isDark, element.width_mm);
    const x = mmToDots(element.x_mm);
    const y = mmToDots(element.y_mm);
    const header = cp1251Encode(`BITMAP ${x},${y},${widthBytes},${heightDots},0,`);
    return header.concat(bytes, [0x0d, 0x0a]);
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
    if (element.type === "cross") return crossCommand(element);
    if (element.type === "qr") {
        // qr elements no longer produce a plain TSPL text command --
        // they're rendered as a BITMAP by buildTsplBytes()/
        // qrBitmapCommandBytes() instead (see the comment above that
        // function). This branch only exists so buildTsplFromTemplate()'s
        // human-readable PREVIEW can still describe a qr element without
        // throwing; it is never what's actually sent to a printer.
        return `[QR bitmap for "${tsplEscape(resolveElementValue(element, data))}" -- generated at print time by buildTsplBytes(), not shown here]`;
    }
    throw new Error("print-tspl: unknown element type '" + element.type + "'");
}

const TSPL_HEADER_LINES = (widthMm, heightMm) => [
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
];

// Human-readable TEXT preview of a template -- NOT what's actually sent
// to a printer for any template containing a qr element (see
// elementCommand's qr branch above). Kept for tests/debugging of the
// non-qr command shapes; buildTsplPayloadBase64() below builds the real
// payload independently via buildTsplBytes().
function buildTsplFromTemplate(template, data) {
    const widthMm = Number(template.width_mm) || 50;
    const heightMm = Number(template.height_mm) || 50;
    const elements = Array.isArray(template.elements) ? template.elements : [];
    const lines = [
        ...TSPL_HEADER_LINES(widthMm, heightMm),
        ...elements.map((element) => elementCommand(element, data || {})),
        `PRINT 1,1`,
    ];
    return lines.join("\r\n") + "\r\n";
}

// The REAL byte-exact printer payload, built as a byte array from the
// start rather than one big string CP1251-encoded as a last step (see
// qrBitmapCommandBytes' comment for why that would corrupt binary
// bitmap data). Produces byte-identical output to
// cp1251Encode(buildTsplFromTemplate(...)) for any template with no qr
// elements; diverges only for qr elements, which this builds as a real
// BITMAP instead of buildTsplFromTemplate's text placeholder.
//
// Requires a browser environment (document + the qrcodejs global) for
// any template containing a qr element -- see qrModuleMatrixFor().
function buildTsplBytes(template, data) {
    const widthMm = Number(template.width_mm) || 50;
    const heightMm = Number(template.height_mm) || 50;
    const elements = Array.isArray(template.elements) ? template.elements : [];
    const bytes = [];
    function appendLine(line) {
        bytes.push(...cp1251Encode(line + "\r\n"));
    }
    TSPL_HEADER_LINES(widthMm, heightMm).forEach(appendLine);
    elements.forEach((element) => {
        if (element.type === "qr") {
            bytes.push(...qrBitmapCommandBytes(element, data || {}));
        } else {
            appendLine(elementCommand(element, data || {}));
        }
    });
    appendLine(`PRINT 1,1`);
    return bytes;
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
// base64-wrapped bytes so the text column can hold them safely. The
// bridge only ever base64-decodes this and writes the raw bytes -- it
// has no charset knowledge of its own.
function buildTsplPayloadBase64(template, data) {
    return bytesToBase64(buildTsplBytes(template, data));
}

// Plain global-scope exports (this repo has no module system) plus a
// CommonJS export so print-tspl.test.js (Node, no browser) can require it.
if (typeof module !== "undefined" && module.exports) {
    module.exports = { buildTsplFromTemplate, buildTsplBytes, buildTsplPayloadBase64, cp1251Encode, bytesToBase64, mmToDots, tsplEscape, wrapText, packQrModulesToBitmap };
}
