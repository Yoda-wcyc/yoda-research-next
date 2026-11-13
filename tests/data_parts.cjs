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

t("白名單：美股面板 us_rs_panel 也收", () => {
  assert.ok(!checkPart(ok({ name: "us_rs_panel" })).error);
  assert.ok(checkPart(ok({ name: "us_rs_panelx" })).error);
});

// 路由（app/api/admin-put-data/route.js）：Blob 換成記憶體假的
function esm(file, over) {
  const c = transformSync(fs.readFileSync(file, "utf8"), { jsc: { parser: { syntax: "ecmascript" }, target: "es2020" }, module: { type: "commonjs" } }).code;
  const mm = { exports: {} };
  const rq = (s) => (s in over ? over[s] : s.startsWith(".") ? esm(path.resolve(path.dirname(file), s) + ".js", over) : require(s));
  new Function("module", "exports", "require", c)(mm, mm.exports, rq);
  return mm.exports;
}
const zlib = require("zlib");
const store = {};
process.env.ADMIN_KEY = "k-" + crypto.randomBytes(8).toString("hex");
const rt = esm(path.join(ROOT, "app", "api", "admin-put-data", "route.js"), { "../../../lib/data-blob": {
  put: async (p, b) => { store[p] = Buffer.from(b); return { pathname: p }; },
  get: async (p) => (store[p] ? { stream: store[p] } : null),
} });
const send = (o, raw) => rt.POST(new Request("http://x/api/admin-put-data", { method: "POST", headers: { "x-yoda-encoding": "gzip" }, body: raw || zlib.gzipSync(JSON.stringify(Object.assign({ key: process.env.ADMIN_KEY }, o))) }))
  .then(async (r) => ({ status: r.status, j: await r.json() }));
function version(name, through, buf) {
  const h = sha256(buf), cut = Math.ceil(buf.length / 2), ps = [buf.subarray(0, cut), buf.subarray(cut)];
  return ps.map((p, i) => ({ name, ver: through + "-" + h.slice(0, 12), part: i, parts: 2, through, bytes: buf.length, sha256: h, data: p.toString("base64") }));
}
const LP = "data/us_rs_panel/latest.json", lat = () => JSON.parse(store[LP]);
const at = [];
at.push(["路由：兩段傳完 → latest 指向新版", async () => {
  for (const b of version("us_rs_panel", "20261112", crypto.randomBytes(5000))) assert.strictEqual((await send(b)).status, 200);
  assert.strictEqual(lat().through, "20261112");
}]);
at.push(["路由：有一段壞了（大小一樣、sha256 不對）→ 409，latest 不動", async () => {
  const before = store[LP].toString(), v = version("us_rs_panel", "20261113", crypto.randomBytes(5000));
  const bad = Buffer.from(v[0].data, "base64"); bad[7] ^= 1;
  await send(Object.assign({}, v[0], { data: bad.toString("base64") }));
  const r = await send(v[1]);
  assert.strictEqual(r.status, 409); assert.ok(r.j.error.includes("sha256"), r.j.error);
  assert.strictEqual(store[LP].toString(), before);
  assert.strictEqual((await send(v[0])).status, 200);                       // 重傳那段＋最後一段 → 過
  assert.strictEqual((await send(v[1])).j.done, true); assert.strictEqual(lat().through, "20261113");
}]);
at.push(["路由：資料日倒退 → 409（force:true 才放行）；同一天重傳可以", async () => {
  const v = version("us_rs_panel", "20261110", crypto.randomBytes(3000));
  await send(v[0]);
  const r = await send(v[1]);
  assert.strictEqual(r.status, 409); assert.strictEqual(lat().through, "20261113");
  assert.strictEqual((await send(Object.assign({}, v[1], { force: "true" }))).status, 409);   // 只認布林 true
  assert.strictEqual((await send(Object.assign({}, v[1], { force: true }))).status, 200); assert.strictEqual(lat().through, "20261110");
  for (const b of version("us_rs_panel", "20261110", crypto.randomBytes(3000))) assert.strictEqual((await send(b)).status, 200);
  assert.ok(!store["data/tw_rs_panel/latest.json"]);                       // 各資料名各自一份 latest
}]);
at.push(["路由：gzip 炸彈（解開 > 8MB）→ 400；金鑰錯 → 403", async () => {
  const r = await send(null, zlib.gzipSync(JSON.stringify({ key: process.env.ADMIN_KEY, pad: "a".repeat(9e6) })));   // 合法 JSON，沒護欄會解開
  assert.strictEqual(r.status, 400); assert.ok(r.j.error.startsWith("請求內容無法解析"), r.j.error);
  assert.strictEqual((await send(Object.assign({}, version("us_rs_panel", "20261114", Buffer.from("x"))[0], { key: "nope" }))).status, 403);
}]);
(async () => {
  for (const [name, fn] of at) { try { await fn(); console.log("ok  ", name); } catch (e) { fails++; console.log("FAIL", name, "→", e && e.message); } }
  console.log(fails ? fails + " FAIL" : "all ok");
  process.exit(fails ? 1 : 0);
})();
