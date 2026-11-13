// lib/data-parts.js（資料檔分段上傳 Blob，2026-11-13）。跑法：node tests/data_parts.cjs（失敗 exit 1）
const fs = require("fs"), path = require("path"), crypto = require("crypto"), assert = require("assert");
const ROOT = path.join(__dirname, "..");
const { transformSync } = require(path.join(ROOT, "node_modules", "next", "dist", "build", "swc"));
const code = transformSync(fs.readFileSync(path.join(ROOT, "lib", "data-parts.js"), "utf8"), { jsc: { parser: { syntax: "ecmascript" }, target: "es2020" }, module: { type: "commonjs" } }).code;
const m = { exports: {} };
new Function("module", "exports", "require", code)(m, m.exports, require);
const { checkPart, partsComplete, assemble, sha256, partPath, latestPath, PART_MAX } = m.exports;

let fails = 0;
function t(name, fn) { try { fn(); console.log("ok  ", name); } catch (e) { fails++; console.log("FAIL", name, "→", e && e.message); } }

const whole = crypto.randomBytes(PART_MAX * 2 + 1234);
const cuts = [whole.subarray(0, PART_MAX), whole.subarray(PART_MAX, PART_MAX * 2), whole.subarray(PART_MAX * 2)];
const SHA = sha256(whole);
const ok = (o) => Object.assign({ name: "tw_rs_panel", ver: "20261112-" + SHA.slice(0, 12), part: 0, parts: 3, through: "20261112", bytes: whole.length, sha256: SHA, data: cuts[0].toString("base64") }, o);

t("路徑", () => {
  assert.strictEqual(partPath("tw_rs_panel", "20261112-abcdef12", 2), "data/tw_rs_panel/20261112-abcdef12/part2.bin");
  assert.strictEqual(latestPath("tw_rs_panel"), "data/tw_rs_panel/latest.json");
});
t("合法的一段 → meta＋原始位元組", () => {
  const c = checkPart(ok({ part: 2, data: cuts[2].toString("base64") }));
  assert.ok(!c.error, c.error);
  assert.strictEqual(c.meta.part, 2);
  assert.ok(c.buf.equals(cuts[2]));
  assert.ok(checkPart(ok()).buf.length === PART_MAX);            // 剛好上限可以
});
t("白名單與欄位驗證", () => {
  for (const bad of [
    { name: "reports" }, { name: "../x" }, { name: undefined },
    { ver: "latest" }, { ver: "2026-11-12-abc" }, { ver: "20261112-ABCDEF12" },
    { part: 3 }, { part: -1 }, { part: 1.5 }, { part: "0" }, { parts: 0 }, { parts: 21 },
    { through: "2026-11-12" }, { sha256: "x".repeat(64) }, { bytes: 0 }, { bytes: 3 * PART_MAX + 1 },
    { data: "" }, { data: "not base64!" }, { data: crypto.randomBytes(PART_MAX + 3).toString("base64") },
  ]) assert.ok(checkPart(ok(bad)).error, JSON.stringify(bad).slice(0, 80));
  assert.ok(checkPart(null).error && checkPart("x").error);
});
t("到齊判定：缺段、大小不合都不算", () => {
  const meta = { parts: 3, bytes: whole.length };
  assert.ok(partsComplete(cuts.map((b) => b.length), meta));
  assert.ok(!partsComplete([PART_MAX, null, 1234], meta));
  assert.ok(!partsComplete([PART_MAX, PART_MAX], meta));
  assert.ok(!partsComplete([PART_MAX, PART_MAX, 1233], meta));
});
t("接回＋sha256：順序對才過，壞一個位元組就回 null", () => {
  assert.ok(assemble(cuts, SHA).equals(whole));
  assert.strictEqual(assemble([cuts[1], cuts[0], cuts[2]], SHA), null);
  const bad = Buffer.from(cuts[2]); bad[0] ^= 1;
  assert.strictEqual(assemble([cuts[0], cuts[1], bad], SHA), null);
  assert.strictEqual(assemble([cuts[0], cuts[1], Buffer.alloc(0)], SHA), null);   // 缺段（讀不到）
});

console.log(fails ? fails + " FAIL" : "all ok");
process.exit(fails ? 1 : 0);
