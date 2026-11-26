// /ta「多空波段」：lib/ta-swing.js＋app/api/ta-swing/route.js（2026-11-26）。跑法：node tests/ta_swing.cjs（失敗 exit 1）
// 真資料（G:\Yoda x Claude\demo\merge_swing\out\swing_data.json 與 demo\多空波段_demo.html，唯讀；不在就略過）驗注入逐字相同、分數 3／19
const fs = require("fs"), path = require("path"), zlib = require("zlib"), assert = require("assert");
const ROOT = path.join(__dirname, "..");
const { transformSync } = require(path.join(ROOT, "node_modules", "next", "dist", "build", "swc"));
function esm(file, over = {}) {
  const c = transformSync(fs.readFileSync(file, "utf8"), { jsc: { parser: { syntax: "ecmascript" }, target: "es2020" }, module: { type: "commonjs" } }).code;
  const mm = { exports: {} };
  const rq = (s) => (s in over ? over[s] : s.startsWith(".") ? esm(path.resolve(path.dirname(file), s) + ".js", over) : require(s));
  new Function("module", "exports", "require", c)(mm, mm.exports, rq);
  return mm.exports;
}
const S = esm(path.join(ROOT, "lib", "ta-swing.js"));
const { SHELL } = esm(path.join(ROOT, "lib", "ta-swing-shell.js"));
const P = esm(path.join(ROOT, "lib", "data-parts.js"));

let fails = 0;
const at = [];
const t = (name, fn) => at.push([name, fn]);
const cnt = (s, x) => s.split(x).length - 1;

// 合成資料：頂部 2 條（有效、無效）、底部 2 條（偏有效、資料不足）＋流程規則；3 天
const D = {
  v: 1, through: "2026-11-25", built_at: "x",
  ck: {
    static: { layers: {}, evn: {}, note_d: "11/25", note: "", rows: [
      { no: "1", L: 1, bull: { t: "甲", g: "有效" }, bear: { t: "乙", g: "偏有效" } },
      { no: "2", L: 1, bull: { t: "丙", g: "無效" }, bear: { t: "丁</script>", g: "資料不足" } },
      { no: "4", L: 1, bull: { t: "流程", g: "流程" } },
    ] },
    dyn: { dates: ["2026-01-02", "2026-11-12", "2026-11-25"], ndx: [1, 2, 3], m: { bull_1: "100", bull_2: "011", bear_1: "01-", bear_2: "000" } },
  },
  cdt: { TW: {} },
};

t("外殼：佔位各剛好一次", () => {
  assert.strictEqual(cnt(SHELL, S.PH_CK), 1); assert.strictEqual(cnt(SHELL, S.PH_CDT), 1);
  assert.ok(SHELL.startsWith("<!doctype html>"));
});
t("inject：換掉佔位、</ 跳脫、佔位不對回 null", () => {
  const h = S.inject("<script>const CKD=" + S.PH_CK + ";</script><script type=\"application/json\">" + S.PH_CDT + "</script>", D);
  assert.ok(!h.includes("__SW_")); assert.strictEqual(cnt(h, "</script>"), 2, "資料裡的 </script> 要跳脫");
  assert.deepStrictEqual(JSON.parse(h.slice(h.indexOf("CKD=") + 4, h.indexOf(";</script>"))), D.ck);
  assert.strictEqual(S.inject("no placeholder", D), null);
  assert.strictEqual(S.inject(S.PH_CK + S.PH_CK + S.PH_CDT, D), null);
});
t("valid：格式不符都擋", () => {
  assert.ok(S.valid(D));
  for (const bad of [null, {}, { ...D, v: 2 }, { ...D, through: "20261125" }, { ...D, cdt: null }, { ...D, ck: { static: D.ck.static, dyn: { dates: [], m: {} } } }]) assert.ok(!S.valid(bad));
});
t("summary：分數＝Σ權重×成立÷Σ可判斷權重；on／last_on／grade；流程規則不列", () => {
  const x = S.summary(D);
  // 頂部：有效 3（0）、無效 0.5（1）→ 0.5/3.5；底部：偏有效缺資料不進分母、資料不足 1（0）→ 0
  assert.deepStrictEqual(x.score, { top: Math.round((0.5 / 3.5) * 1000) / 10, bottom: 0 });
  assert.strictEqual(x.day, "2026-11-25"); assert.strictEqual(x.through, "2026-11-25");
  assert.deepStrictEqual(Object.keys(x.conds).sort(), ["bear_1", "bear_2", "bull_1", "bull_2"]);
  assert.deepStrictEqual(x.conds.bull_1, { side: "top", no: "1", t: "甲", grade: "有效", on: false, last_on: "2026-01-02" });
  assert.strictEqual(x.conds.bull_2.on, true); assert.strictEqual(x.conds.bull_2.last_on, "2026-11-25");
  assert.strictEqual(x.conds.bear_1.on, null); assert.strictEqual(x.conds.bear_1.last_on, "2026-11-12");
  assert.strictEqual(x.conds.bear_2.last_on, null); assert.strictEqual(x.conds.bear_2.side, "bottom");
});
t("data-parts：swing 收進白名單、沒 schema 欄位以 v:1＋ck＋cdt 認", () => {
  assert.ok(P.DATASETS.includes("swing")); assert.strictEqual(P.schemaOf(D), P.SCHEMA_OF.swing);
  assert.strictEqual(P.schemaOf({ schema: "tw-rs-1" }), "tw-rs-1"); assert.strictEqual(P.schemaOf({ v: 1 }), null);
});

const REAL = "G:/Yoda x Claude/demo/merge_swing/out/swing_data.json", DEMO = "G:/Yoda x Claude/demo/多空波段_demo.html";
t("真資料：注入後跟 compose 一般模式頁逐字相同；今天分數頂部 3、底部 19", () => {
  if (!fs.existsSync(REAL) || !fs.existsSync(DEMO)) { console.log("     （真資料不在，略過）"); return; }
  const d = JSON.parse(fs.readFileSync(REAL, "utf8"));
  assert.ok(S.valid(d));
  assert.ok(S.inject(SHELL, d) === fs.readFileSync(DEMO, "utf8"), "跟 demo 頁不同（外殼或資料不是同一次 compose？）");
  const x = S.summary(d);
  assert.strictEqual(Math.round(x.score.top), 3); assert.strictEqual(Math.round(x.score.bottom), 19);
  assert.strictEqual(Object.keys(x.conds).length, 45);
});

// 路由：閘門、Blob 缺資料、注入、op:'ck'；Blob 換成假的（記憶體 map）
let blob = {}, reads = 0;
const fakeBlob = { get: async (p) => { reads++; return p in blob ? { stream: blob[p] } : null; } };
function route(sub, allowed = true) {
  const live = { authOf: () => (sub ? { sub } : null), owners: () => ["o"], store: async () => ({ isOwner: async () => false, allowed: async () => allowed }) };
  return esm(path.join(ROOT, "app", "api", "ta-swing", "route.js"), { "../../../lib/ta-live": live, "../../../lib/data-blob": fakeBlob });
}
function upload(d, ver = "20261125-abcdef12") {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(d)));
  blob = { [P.latestPath("swing")]: Buffer.from(JSON.stringify({ ver, parts: 1, through: "20261125", bytes: gz.length, sha256: P.sha256(gz) })), [P.partPath("swing", ver, 0)]: gz };
}
const ask = (rt, body) => rt.POST(new Request("http://x/api/ta-swing", { method: "POST", body: JSON.stringify(body) })).then(async (r) => ({ status: r.status, j: await r.json() }));

t("路由閘門：未登入 401、未開通 403（都不讀 Blob）；op 不對 400", async () => {
  upload(D); reads = 0;
  assert.strictEqual((await ask(route(null), {})).status, 401);
  assert.strictEqual((await ask(route("m", false), {})).status, 403);
  assert.strictEqual(reads, 0);
  const r = await ask(route("m"), { op: "x" }); assert.strictEqual(r.status, 400); assert.strictEqual(r.j.reason, "bad-input");
});
t("路由：Blob 沒資料／段壞 → 503 資料不足（不丟 500）", async () => {
  blob = {};
  let r = await ask(route("m"), {}); assert.strictEqual(r.status, 503); assert.strictEqual(r.j.reason, "no-source"); assert.ok(r.j.error.startsWith("資料不足"));
  upload(D); blob[P.partPath("swing", "20261125-abcdef12", 0)] = Buffer.from("broken");
  r = await ask(route("m"), { op: "ck" }); assert.strictEqual(r.status, 503); assert.strictEqual(r.j.reason, "updating"); assert.ok(r.j.error.startsWith("資料不足"));
  upload({ ...D, v: 9 });
  r = await ask(route("m"), {}); assert.strictEqual(r.status, 503, "格式不符當壞版");
});
t("路由：op:'page' 回注入好的頁（佔位不見、資料在、外殼切換鈕藏起來）；op:'ck' 欄位", async () => {
  upload(D);
  const rt = route("m");
  const a = await ask(rt, { op: "page" });
  assert.strictEqual(a.status, 200); assert.strictEqual(a.j.through, "2026-11-25");
  assert.ok(!a.j.html.includes("__SW_")); assert.ok(a.j.html.includes(JSON.stringify(D.cdt)));
  assert.ok(a.j.html.includes(".sw-theme{display:none"));
  assert.ok(a.j.html.replace(/<style>\.sw-theme[^<]*<\/style>/, "") === S.inject(SHELL, D), "除了 /ta 版面那段 style，跟 inject 一樣");
  const b = await ask(rt, { op: "ck" });
  assert.strictEqual(b.status, 200);
  assert.deepStrictEqual(Object.keys(b.j).sort(), ["built_at", "conds", "day", "ok", "score", "through"]);
  assert.deepStrictEqual(b.j.conds, S.summary(D).conds);
  const n = reads; await ask(rt, {}); assert.strictEqual(reads, n, "10 分鐘內不重讀 Blob");
});

(async () => {
  for (const [name, fn] of at) {
    try { await fn(); console.log("ok  ", name); } catch (e) { fails++; console.log("FAIL", name, "→", e && e.message); }
  }
  if (fails) { console.log("\n" + fails + " 項失敗"); process.exit(1); }
  console.log("\n全部通過");
})();
