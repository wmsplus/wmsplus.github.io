// print-tspl.test.js — run with: node print-tspl.test.js
const assert = require("node:assert");
const { buildTsplFromTemplate, buildTsplPayloadBase64, cp1251Encode, bytesToBase64, mmToDots, tsplEscape } = require("./print-tspl.js");

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

test("buildTsplFromTemplate emits a QRCODE command for type=qr", () => {
    const template = { width_mm: 50, height_mm: 50, elements: [{ type: "qr", field: "url", x_mm: 5, y_mm: 5, width_mm: 20 }] };
    const tspl = buildTsplFromTemplate(template, { url: "https://example.com" });
    assert.ok(tspl.includes('QRCODE 40,40,M,4,A,0,"https://example.com"'));
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
