// shift-close.test.js — run with: node shift-close.test.js
const assert = require("node:assert");
const { SHIFT_CLOSE_QR_VALUE, isShiftCloseUnlocked, partitionBoxContents } = require("./shift-close.js");

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

test("SHIFT_CLOSE_QR_VALUE matches the physical QR placed in the revision office", () => {
    assert.strictEqual(SHIFT_CLOSE_QR_VALUE, "WMSP.PLCE.WSHK.FLR");
});

test("isShiftCloseUnlocked is false before 19:30", () => {
    assert.strictEqual(isShiftCloseUnlocked(new Date(2026, 0, 1, 10, 0)), false);
    assert.strictEqual(isShiftCloseUnlocked(new Date(2026, 0, 1, 19, 29)), false);
});

test("isShiftCloseUnlocked is true from 19:30 onward, no upper bound", () => {
    assert.strictEqual(isShiftCloseUnlocked(new Date(2026, 0, 1, 19, 30)), true);
    assert.strictEqual(isShiftCloseUnlocked(new Date(2026, 0, 1, 23, 59)), true);
    assert.strictEqual(isShiftCloseUnlocked(new Date(2026, 0, 1, 3, 0)), true);
});

test("partitionBoxContents pulls out only КГТ rows, preserving order", () => {
    const rows = [
        { item_text: "Носки", item_type: "Мелкий товар" },
        { item_text: "Стол", item_type: "КГТ" },
        { item_text: "Кружка", item_type: "Мелкий товар" },
        { item_text: "Стул", item_type: "КГТ" },
    ];
    const { kgtItems } = partitionBoxContents(rows);
    assert.deepStrictEqual(kgtItems.map((r) => r.item_text), ["Стол", "Стул"]);
});

test("partitionBoxContents handles an empty/missing list", () => {
    assert.deepStrictEqual(partitionBoxContents([]).kgtItems, []);
    assert.deepStrictEqual(partitionBoxContents(undefined).kgtItems, []);
});
