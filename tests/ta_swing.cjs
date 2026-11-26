// /ta「多空波段」：lib/ta-swing.js＋app/api/ta-swing/route.js（2026-11-26）。跑法：node tests/ta_swing.cjs（失敗 exit 1）
// 真資料（G:\Yoda x Claude\Skill\swing_page\out\swing_data.json、swing_embed_page.html、Skill\data\swing_score\scores.json，唯讀；不在就略過）
//   驗注入＝外殼模式頁逐字相同、分數＝scores.json
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
  const k = { ...D, ck: { ...D.ck, __SW_CDT_DATA__: 1 } };   // 資料裡的 key 撞到佔位字串
  assert.strictEqual(S.inject("A" + S.PH_CDT + "B" + S.PH_CK + "C", k), "A" + JSON.stringify(D.cdt) + "B" + JSON.stringify(k.ck).replace(/<\//g, "\\u003c/") + "C");
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

t("外殼是外殼模式（sw-embed）：無 viewport 1280、無 DEMO 徽章、外框不設最小寬、層名欄 72px", () => {
  assert.strictEqual(cnt(SHELL, 'class="sw-embed"'), 1);
  assert.ok(!SHELL.includes("width=1280") && !SHELL.includes('badge-demo">DEMO'));
  assert.ok(SHELL.includes(".sw-embed .sw-bar,.sw-embed .sw-wrap{min-width:0}") && SHELL.includes('html[class~="sw-embed"] .ck-root .wrap{min-width:0}'));
  assert.ok(SHELL.includes('<col style="width:72px">'));
  // 緊湊明細（11-26）：每邊 條件定義｜回測結論｜目前，「10 月亮了沒」「兩季首見」兩欄進 ⓘ
  assert.ok(SHELL.includes('<colgroup><col style="width:72px"><col><col style="width:92px"><col style="width:112px"><col><col style="width:92px"><col style="width:112px"></colgroup>'));
  assert.strictEqual(cnt(SHELL, 'colspan="5"'), 0); assert.strictEqual(cnt(SHELL, 'colspan="3"'), 5);
  assert.ok(!SHELL.includes('{k:s+"_o"') && !SHELL.includes('{k:s+"_f"') && SHELL.includes('class="tipk octf"'));
});

// 合約：外殼模式頁＝外殼＋資料（compose --shell --data 同次寫出 out/swing_embed_page.html；一般模式 demo 頁另有 viewport 1280／DEMO，不再拿來比）
const REAL = "G:/Yoda x Claude/Skill/swing_page/out/swing_data.json", EPAGE = "G:/Yoda x Claude/Skill/swing_page/out/swing_embed_page.html";
const SCORES = "G:/Yoda x Claude/Skill/data/swing_score/scores.json";
t("真資料：注入後跟 compose 外殼模式頁逐字相同；今天分數＝帳本 scores.json 同一天", () => {
  if (!fs.existsSync(REAL) || !fs.existsSync(EPAGE) || !fs.existsSync(SCORES)) { console.log("     （真資料不在，略過）"); return; }
  const d = JSON.parse(fs.readFileSync(REAL, "utf8"));
  assert.ok(S.valid(d));
  assert.ok(S.inject(SHELL, d) === fs.readFileSync(EPAGE, "utf8"), "跟外殼模式頁不同（外殼或資料不是同一次 compose？）");
  const x = S.summary(d);
  // 分數對帳本的 scores.json 同一天（11/25：頂部 2.86、底部 20.93；舊版寫死的 3／19 是來源頁內嵌矩陣，落後帳本）
  const sc = JSON.parse(fs.readFileSync(SCORES, "utf8")).days.find((z) => z.d === x.day);
  assert.ok(sc, "scores.json 沒有 " + x.day);
  assert.ok(Math.abs(x.score.top - sc.bull) < 0.06 && Math.abs(x.score.bottom - sc.bear) < 0.06, JSON.stringify([x.score, sc.bull, sc.bear]));
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
t("路由：Blob 丟例外 → 503 資料不足（不露原始訊息）；壞版＋有舊資料 → 用舊的且 10 分鐘內不重下", async () => {
  const boom = { get: async () => { throw new Error("blob down SECRET"); } };
  const live = { authOf: () => ({ sub: "m" }), owners: () => [], store: async () => ({ isOwner: async () => false, allowed: async () => true }) };
  const r1 = await ask(esm(path.join(ROOT, "app", "api", "ta-swing", "route.js"), { "../../../lib/ta-live": live, "../../../lib/data-blob": boom }), {});
  assert.strictEqual(r1.status, 503); assert.ok(r1.j.error.startsWith("資料不足")); assert.ok(!r1.j.error.includes("SECRET"));
  upload(D); const rt = route("m");
  assert.strictEqual((await ask(rt, {})).status, 200);
  upload({ ...D, v: 9 }, "20261126-badbad00");
  const real = Date.now; Date.now = () => real() + 11 * 60 * 1000;   // 過了 10 分鐘
  try {
    assert.strictEqual((await ask(rt, { op: "ck" })).status, 200, "壞版先用舊的");
    const n = reads; await ask(rt, { op: "ck" }); assert.strictEqual(reads, n, "壞版不每次重下");
  } finally { Date.now = real; }
});
t("admin-put-data：swing 用 valid() 擋壞版、資料日要跟 through 一致", async () => {
  const store = {};
  const fb = { put: async (p, b) => { store[p] = Buffer.from(b); }, get: async (p) => (p in store ? { stream: store[p] } : null) };
  const rt = esm(path.join(ROOT, "app", "api", "admin-put-data", "route.js"), { "../../../lib/data-blob": fb });
  process.env.ADMIN_KEY = "k";
  const send = (d, through) => {
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(d)));
    const body = { key: "k", name: "swing", ver: through + "-abcdef12", part: 0, parts: 1, through, bytes: gz.length, sha256: P.sha256(gz), data: gz.toString("base64") };
    return rt.POST(new Request("http://x/api/admin-put-data", { method: "POST", body: JSON.stringify(body) })).then((r) => r.status);
  };
  assert.strictEqual(await send({ v: 1, through: "2026-11-26", ck: { a: 1 }, cdt: { a: 1 } }, "20261126"), 409);
  assert.strictEqual(await send(D, "20261126"), 409, "資料日 2026-11-25 ≠ through 20261126");
  assert.strictEqual(await send(D, "20261125"), 200);
});

(async () => {
  for (const [name, fn] of at) {
    try { await fn(); console.log("ok  ", name); } catch (e) { fails++; console.log("FAIL", name, "→", e && e.message); }
  }
  if (fails) { console.log("\n" + fails + " 項失敗"); process.exit(1); }
  console.log("\n全部通過");
})();
