// shift-close.test.js — run with: node shift-close.test.js
const assert = require("node:assert");
const { SHIFT_CLOSE_QR_VALUE, isCurrentShiftBoxUnlocked, partitionBoxContents } = require("./shift-close.js");

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

test("isCurrentShiftBoxUnlocked is false during most of the day shift", () => {
    assert.strictEqual(isCurrentShiftBoxUnlocked(new Date(2026, 0, 1, 8, 0)), false);
    assert.strictEqual(isCurrentShiftBoxUnlocked(new Date(2026, 0, 1, 10, 0)), false);
    assert.strictEqual(isCurrentShiftBoxUnlocked(new Date(2026, 0, 1, 19, 29)), false);
});

test("isCurrentShiftBoxUnlocked is true in the day shift's last 30 minutes only", () => {
    assert.strictEqual(isCurrentShiftBoxUnlocked(new Date(2026, 0, 1, 19, 30)), true);
    assert.strictEqual(isCurrentShiftBoxUnlocked(new Date(2026, 0, 1, 19, 59)), true);
    assert.strictEqual(isCurrentShiftBoxUnlocked(new Date(2026, 0, 1, 20, 0)), false);
});

test("isCurrentShiftBoxUnlocked is false during most of the night shift", () => {
    assert.strictEqual(isCurrentShiftBoxUnlocked(new Date(2026, 0, 1, 20, 0)), false);
    assert.strictEqual(isCurrentShiftBoxUnlocked(new Date(2026, 0, 1, 23, 59)), false);
    assert.strictEqual(isCurrentShiftBoxUnlocked(new Date(2026, 0, 1, 3, 0)), false);
    assert.strictEqual(isCurrentShiftBoxUnlocked(new Date(2026, 0, 1, 7, 29)), false);
});

test("isCurrentShiftBoxUnlocked is true in the night shift's last 30 minutes only", () => {
    assert.strictEqual(isCurrentShiftBoxUnlocked(new Date(2026, 0, 1, 7, 30)), true);
    assert.strictEqual(isCurrentShiftBoxUnlocked(new Date(2026, 0, 1, 7, 59)), true);
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
