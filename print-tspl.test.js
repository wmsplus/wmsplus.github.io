// print-tspl.test.js — run with: node print-tspl.test.js
const assert = require("node:assert");
const { buildTsplFromTemplate, buildTsplPayloadBase64, cp1251Encode, bytesToBase64, mmToDots, tsplEscape, wrapText, packQrModulesToBitmap } = require("./print-tspl.js");

function test(name, fn) {
    try {
        fn();
        console.log("PASS " + name);
    } catch (error) {
        console.error("FAIL " + name);
        console.error(error);
        process.exitCode = 1;
    }
}

test("mmToDots converts using 203dpi", () => {
    assert.strictEqual(mmToDots(25.4), 203);
    assert.strictEqual(mmToDots(0), 0);
});

test("tsplEscape strips quotes and newlines", () => {
    assert.strictEqual(tsplEscape('a"b\\c'), "abc");
    assert.strictEqual(tsplEscape("line1\nline2"), "line1 line2");
    assert.strictEqual(tsplEscape(null), "");
});

test("buildTsplFromTemplate emits SIZE/GAP/CLS/PRINT around elements", () => {
    const template = {
        width_mm: 50,
        height_mm: 50,
        elements: [
            { type: "text", field: "title", x_mm: 5, y_mm: 5, font_size: 10 },
        ],
    };
    const tspl = buildTsplFromTemplate(template, { title: "Тест" });
    assert.ok(tspl.startsWith("SIZE 50 mm,50 mm\r\nGAP 2 mm,0 mm\r\nCLS\r\nDIRECTION 1\r\nCODEPAGE 1251\r\n"));
    assert.ok(tspl.includes('TEXT 40,40,"3",0,1,1,"Тест"'));
    assert.ok(tspl.trim().endsWith("PRINT 1,1"));
});

test("buildTsplFromTemplate resolves literal text over a missing field", () => {
    const template = { width_mm: 50, height_mm: 50, elements: [{ type: "text", literal: "СКЛАД", x_mm: 0, y_mm: 0 }] };
    const tspl = buildTsplFromTemplate(template, {});
    assert.ok(tspl.includes('"СКЛАД"'));
});

test("buildTsplFromTemplate emits a BARCODE command for type=barcode", () => {
    const template = { width_mm: 50, height_mm: 50, elements: [{ type: "barcode", field: "shk", x_mm: 5, y_mm: 5, height_mm: 10 }] };
    const tspl = buildTsplFromTemplate(template, { shk: "56515623488" });
    assert.ok(tspl.includes('BARCODE 40,40,"128",80,1,0,2,2,"56515623488"'));
});

test("buildTsplFromTemplate describes a qr element as a placeholder, not a real TSPL command", () => {
    // Real on-site testing found the printer's own QRCODE command
    // produces output no scanner recognizes as a valid QR at all --
    // qr elements are now rendered as a BITMAP instead (see
    // qrBitmapCommandBytes), which needs a browser (qrcodejs + canvas).
    // buildTsplFromTemplate is a plain-text preview usable in Node, so it
    // can't build the real bitmap -- it just describes the element
    // instead of throwing.
    const template = { width_mm: 50, height_mm: 50, elements: [{ type: "qr", field: "url", x_mm: 5, y_mm: 5, width_mm: 20 }] };
    const tspl = buildTsplFromTemplate(template, { url: "https://example.com" });
    assert.ok(tspl.includes('[QR bitmap for "https://example.com"'));
    assert.ok(!tspl.includes("QRCODE"));
});

test("packQrModulesToBitmap: a single dark module lands after the quiet zone, not at pixel (0,0)", () => {
    const isDark = (r, c) => r === 0 && c === 0;
    const { widthBytes, heightDots, bytes } = packQrModulesToBitmap(1, isDark, 20);
    const totalModules = 1 + 4 * 2; // moduleCount=1 + 4-module quiet zone each side
    const cellSizeDots = Math.round(mmToDots(20) / totalModules);
    assert.strictEqual(heightDots, totalModules * cellSizeDots);
    assert.strictEqual(widthBytes, Math.ceil(heightDots / 8));
    // The quiet zone itself must stay blank -- pixel (0,0) is inside it.
    assert.strictEqual(bytes[0] & 0x80, 0);
    // The dark module's own first pixel (after the quiet-zone offset) must be set.
    const pxStart = 4 * cellSizeDots;
    const byteIndex = pxStart * widthBytes + (pxStart >> 3);
    const bitMask = 0x80 >> (pxStart & 7);
    assert.ok((bytes[byteIndex] & bitMask) !== 0);
});

test("packQrModulesToBitmap: an all-light matrix produces an all-zero (blank) bitmap", () => {
    const { bytes } = packQrModulesToBitmap(5, () => false, 20);
    assert.ok(bytes.length > 0 && bytes.every((b) => b === 0));
});

test("packQrModulesToBitmap: widthBytes is byte-padded for a non-multiple-of-8 pixel width", () => {
    const { widthBytes, heightDots } = packQrModulesToBitmap(3, () => false, 10);
    assert.strictEqual(widthBytes, Math.ceil(heightDots / 8));
    assert.ok(heightDots % 8 !== 0, "test is only meaningful when padding actually matters");
});

test("buildTsplFromTemplate emits a rotated TEXT command when rotation is set", () => {
    const template = { width_mm: 50, height_mm: 50, elements: [{ type: "text", literal: "Ночь", x_mm: 5, y_mm: 5, font_size: 10, rotation: 90 }] };
    const tspl = buildTsplFromTemplate(template, {});
    assert.ok(tspl.includes('TEXT 40,40,"3",90,1,1,"Ночь"'));
});

test("buildTsplFromTemplate falls back to rotation 0 for an invalid value", () => {
    const template = { width_mm: 50, height_mm: 50, elements: [{ type: "text", literal: "x", x_mm: 0, y_mm: 0, rotation: 45 }] };
    const tspl = buildTsplFromTemplate(template, {});
    assert.ok(tspl.includes('TEXT 0,0,"3",0,1,1,"x"'));
});

test("buildTsplFromTemplate emits two BAR commands for a cross element", () => {
    const template = { width_mm: 50, height_mm: 50, elements: [{ type: "cross", x_mm: 5, y_mm: 5, size_mm: 10, thickness_mm: 2 }] };
    const tspl = buildTsplFromTemplate(template, {});
    // size_mm=10 -> 80dots, thickness_mm=2 -> 16dots, x_mm/y_mm=5 -> 40dots.
    // Bars centered within the 80x80 box: offset (80-16)/2=32 -> 40+32=72.
    assert.ok(tspl.includes("BAR 72,40,16,80"));
    assert.ok(tspl.includes("BAR 40,72,80,16"));
});

test("wrapText fills lines greedily on word boundaries", () => {
    assert.deepStrictEqual(wrapText("Увлажнитель воздуха ультразвуковой", 20, 2), ["Увлажнитель воздуха", "ультразвуковой"]);
});

test("wrapText hard-breaks a single word longer than one line", () => {
    assert.deepStrictEqual(wrapText("Суперкалифраджилистикэкспиалидоциус", 10, 2), ["Суперкалиф", "раджилист…"]);
});

test("wrapText truncates with an ellipsis when content exceeds maxLines", () => {
    const lines = wrapText("один два три четыре пять шесть", 8, 2);
    assert.strictEqual(lines.length, 2);
    assert.ok(lines[1].endsWith("…"));
});

test("wrapText returns the text as-is when it fits on one line", () => {
    assert.deepStrictEqual(wrapText("Стол", 20, 2), ["Стол"]);
});

test("wrapText handles empty input", () => {
    assert.deepStrictEqual(wrapText("", 20, 2), [""]);
    assert.deepStrictEqual(wrapText(null, 20, 2), [""]);
});

test("buildTsplFromTemplate wraps a text element with wrap_width_mm into multiple TEXT lines", () => {
    const template = {
        width_mm: 50,
        height_mm: 50,
        elements: [{ type: "text", field: "name", x_mm: 5, y_mm: 7, font_size: 14, wrap_width_mm: 42, line_height_mm: 9, max_lines: 2 }],
    };
    const tspl = buildTsplFromTemplate(template, { name: "Увлажнитель воздуха ультразвуковой" });
    // x_mm 5 -> 40 dots; y_mm 7 -> 56 dots; line_height_mm 9 -> 72 dots per line.
    assert.ok(tspl.includes('TEXT 40,56,"3",0,1,1,"Увлажнитель воздуха"'));
    assert.ok(tspl.includes('TEXT 40,128,"3",0,1,1,"ультразвуковой"'));
});

test("buildTsplFromTemplate leaves non-wrapped text elements on a single TEXT line", () => {
    const template = { width_mm: 50, height_mm: 50, elements: [{ type: "text", field: "name", x_mm: 5, y_mm: 7, font_size: 14 }] };
    const tspl = buildTsplFromTemplate(template, { name: "Очень длинное наименование товара для теста" });
    const textLines = tspl.split("\r\n").filter((line) => line.startsWith("TEXT"));
    assert.strictEqual(textLines.length, 1);
});

test("buildTsplFromTemplate throws on an unknown element type", () => {
    const template = { width_mm: 50, height_mm: 50, elements: [{ type: "bogus", x_mm: 0, y_mm: 0 }] };
    assert.throws(() => buildTsplFromTemplate(template, {}), /unknown element type/);
});

test("cp1251Encode passes ASCII through unchanged", () => {
    assert.deepStrictEqual(cp1251Encode("PRINT 1,1"), [80, 82, 73, 78, 84, 32, 49, 44, 49]);
});

test("cp1251Encode maps СКЛАД to the correct Windows-1251 bytes", () => {
    // Verified against iconv-lite's own win1251 encoder for the same input.
    assert.deepStrictEqual(cp1251Encode("СКЛАД"), [0xd1, 0xca, 0xcb, 0xc0, 0xc4]);
});

test("cp1251Encode maps Ё/ё to their non-contiguous CP1251 slots", () => {
    assert.deepStrictEqual(cp1251Encode("Ёё"), [0xa8, 0xb8]);
});

test("cp1251Encode falls back to '?' for unmappable characters", () => {
    assert.deepStrictEqual(cp1251Encode("中"), [0x3f]);
});

test("bytesToBase64 round-trips through Buffer", () => {
    const bytes = [0xd1, 0xca, 0xcb, 0xc0, 0xc4];
    const b64 = bytesToBase64(bytes);
    assert.deepStrictEqual(Array.from(Buffer.from(b64, "base64")), bytes);
});

test("buildTsplPayloadBase64 base64-decodes back to the CP1251-encoded TSPL text", () => {
    const template = { width_mm: 50, height_mm: 50, elements: [{ type: "text", literal: "СКЛАД", x_mm: 0, y_mm: 0 }] };
    const b64 = buildTsplPayloadBase64(template, {});
    const decodedBytes = Array.from(Buffer.from(b64, "base64"));
    const expectedBytes = cp1251Encode(buildTsplFromTemplate(template, {}));
    assert.deepStrictEqual(decodedBytes, expectedBytes);
});

if (process.exitCode) {
    console.error("Some tests failed.");
} else {
    console.log("All print-tspl.js tests passed.");
}
