// /ta「區間強弱」：lib/ta-rs.js 純函式（2026-11-13）。跑法：node tests/ta_rs.cjs（失敗 exit 1）
// 合成面板驗規則；真面板（Skill\data\tw_rs\tw_rs_panel.json.gz，唯讀；不在就略過）抽 3 檔直接重算 rel 對答案。
const fs = require("fs"), path = require("path"), zlib = require("zlib"), assert = require("assert");
const ROOT = path.join(__dirname, "..");
const { transformSync } = require(path.join(ROOT, "node_modules", "next", "dist", "build", "swc"));
const code = transformSync(fs.readFileSync(path.join(ROOT, "lib", "ta-rs.js"), "utf8"), { jsc: { parser: { syntax: "ecmascript" }, target: "es2020" }, module: { type: "commonjs" } }).code;
const m = { exports: {} };
new Function("module", "exports", "require", code)(m, m.exports, require);
const { load, compute, snap, range, presetStart } = m.exports;

let fails = 0;
function t(name, fn) { try { fn(); console.log("ok  ", name); } catch (e) { fails++; console.log("FAIL", name, "→", e && e.message); } }
const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, a + " ≠ " + b);

// 5 個交易日（中間跳過週末）；A 漲、B 跌、C 上市晚（基準日沒價）、D 量太小、E 迄日前下市
const P = {
  schema: "tw-rs-1", through: "20260109", groups_ver: "v6",
  dates: ["20260102", "20260105", "20260106", "20260107", "20260109"],
  bench_tr: [100, 101, 102, 103, 110], bench_px: [100, 101, 101, 102, 108],
  codes: ["1101", "1102", "1103", "1104", "1105"], names: ["甲", "乙", "丙", "丁", "戊"], mkt: ["上市", "上櫃", "上市", "上市", "上櫃"],
  px: [[10, 10, 11, 12, 13], [20, 20, 19, 18, 16], [null, null, 30, 31, 32], [5, 5, 5, 5, 6], [8, 8, 8, null, null]],
  amt: [[100, 100, 100, 100, 100], [60, 60, 60, 60, 60], [500, 500, 500, 500, 500], [1, 1, 1, 1, 1], [100, 100, 100, 0, 0]],
  groups: { G1: ["1101", "1102"], G2: ["1103", "1104"], G3: ["1105"] },
};

t("range：起日最早＝第二個交易日、迄日最晚＝最後一天", () => assert.deepStrictEqual(range(P), { min: "2026-01-05", max: "2026-01-09" }));
t("snap：非交易日起日往後、迄日往前；不合法回錯誤", () => {
  assert.deepStrictEqual(snap(P, "2026-01-05", "2026-01-08"), { i: 1, j: 3 });
  assert.deepStrictEqual(snap(P, "2026-01-08", "2026-01-09"), { i: 4, j: 4 });
  assert.ok(snap(P, "2026-01-02", "2026-01-09").error);        // 第一天沒有基準
  assert.ok(snap(P, "2026-01-06", "2026-01-05").error);        // 起日晚於迄日
  assert.ok(snap(P, "2026-01-05", "2026-01-10").error);        // 超出資料
  assert.ok(compute(P, { start: "2026-01-08", end: "2026-01-08" }).error);   // 週四沒交易日（起吸到 1/9、迄吸到 1/7）
});
t("compute：基準＝起日前一天收盤、rel＝ret − 報酬指數", () => {
  const r = compute(P, { start: "2026-01-06", end: "2026-01-09", minAmt: 5e7, n: 5 });
  assert.strictEqual(r.base, "2026-01-05"); assert.strictEqual(r.start, "2026-01-06"); assert.strictEqual(r.end, "2026-01-09"); assert.strictEqual(r.days, 3);
  near(r.bench.tr, (110 / 101 - 1) * 100); near(r.bench.px, (108 / 101 - 1) * 100);
  // 1101：13/10；1102：16/20；1103 基準日沒價、1105 迄日沒價 → 不算；1104 量 1 百萬 < 50 百萬 → 不進排名但進族群
  assert.deepStrictEqual(r.strong.map((x) => x.code), ["1101", "1102"]);
  assert.deepStrictEqual(r.weak.map((x) => x.code), ["1102", "1101"]);
  near(r.strong[0].rel, 30 - (110 / 101 - 1) * 100);
  assert.deepStrictEqual(r.universe, { eligible: 2, total: 3 });
  near(r.strong[0].avgAmt, 100); assert.deepStrictEqual(r.strong[0].groups, ["G1"]);
  const g = Object.fromEntries(r.groups.map((x) => [x.name, x]));
  near(g.G1.ret, (30 + -20) / 2); assert.strictEqual(g.G1.n, 2);
  assert.strictEqual(g.G2.n, 1); assert.strictEqual(g.G2.total, 2); near(g.G2.ret, 20);
  assert.strictEqual(g.G3.n, 0); assert.strictEqual(g.G3.rel, null);
  assert.deepStrictEqual(r.groups.map((x) => x.name), ["G2", "G1", "G3"]);   // 強到弱、沒值的最後
  assert.deepStrictEqual(g.G1.members.map((x) => x.code), ["1101", "1102"]);
});
t("compute：門檻 0 → 量小的也排；n 截斷", () => {
  const r = compute(P, { start: "2026-01-06", end: "2026-01-09", minAmt: 0, n: 1 });
  assert.strictEqual(r.universe.eligible, 3);
  assert.deepStrictEqual(r.strong.map((x) => x.code), ["1101"]); assert.deepStrictEqual(r.weak.map((x) => x.code), ["1102"]);
});
t("presetStart：往回一段再加一天；月底不溢位；今年以來", () => {
  assert.strictEqual(presetStart("2026-11-12", "1w"), "2026-11-06");
  assert.strictEqual(presetStart("2026-11-12", "1m"), "2026-10-13");
  assert.strictEqual(presetStart("2026-11-12", "3m"), "2026-08-13");
  assert.strictEqual(presetStart("2026-03-31", "1m"), "2026-03-01");   // 2/28＋1
  assert.strictEqual(presetStart("2026-11-12", "ytd"), "2026-01-01");
});
t("load：格式不符丟錯、同 key 不重讀", () => {
  assert.throws(() => load("x1", () => '{"schema":"nope"}'));
  let n = 0;
  const a = load("k1", () => { n++; return JSON.stringify(P); }), b = load("k1", () => { n++; return "{}"; });
  assert.strictEqual(a, b); assert.strictEqual(n, 1);
});

t("台股輸出跟加美股之前逐位元組相同（舊版 lib 算的 sha256）", () => {
  const opts = [{ start: "2026-01-06", end: "2026-01-09", minAmt: 5e7, n: 5 }, { start: "2026-01-05", end: "2026-01-09", minAmt: 0, n: 1 }, { start: "2026-01-05", end: "2026-01-07" }];
  const s = JSON.stringify(opts.map((o) => compute(P, o)));
  assert.strictEqual(require("crypto").createHash("sha256").update(s).digest("hex"), "c144cf1e319418fb25e3572e3dcb23b63eb449a716e8f3d5907e5340b1397d70");
});
const U = Object.assign({}, P, { schema: "us-rs-1", currency: "USD", groups_ver: "treemap" });
t("load：美股 schema、各市場分開快取、市場對錯 schema 就丟錯", () => {
  assert.throws(() => load("u0", () => JSON.stringify(P), "us"));     // 台股面板不能當美股
  assert.throws(() => load("u0", () => JSON.stringify(U), "tw"));
  assert.throws(() => load("u0", () => JSON.stringify(U), "jp"));
  const a = load("same", () => JSON.stringify(P), "tw"), b = load("same", () => JSON.stringify(U), "us");
  assert.strictEqual(a.schema, "tw-rs-1"); assert.strictEqual(b.schema, "us-rs-1");
  assert.strictEqual(load("same", () => "{}", "tw"), a); assert.strictEqual(load("same", () => "{}", "us"), b);
  assert.strictEqual(m.exports.loaded("same", "us"), true); assert.strictEqual(m.exports.loaded("same"), true);
});

// 路由（app/api/ta-rs/route.js）：會員閘門、Blob 換成記憶體假的；每個情境重新載入（模組層快取歸零）
function esm(file, over) {
  const c = transformSync(fs.readFileSync(file, "utf8"), { jsc: { parser: { syntax: "ecmascript" }, target: "es2020" }, module: { type: "commonjs" } }).code;
  const mm = { exports: {} };
  const rq = (s) => (s in over ? over[s] : s.startsWith(".") ? esm(path.resolve(path.dirname(file), s) + ".js", over) : require(s));
  new Function("module", "exports", "require", c)(mm, mm.exports, rq);
  return mm.exports;
}
function route(files, calls) {
  const live = { authOf: () => ({ sub: "o" }), owners: () => ["o"], store: async () => ({ isOwner: async () => true, allowed: async () => true }) };
  const get = async (p) => {
    calls.push(p);
    await new Promise((r) => setTimeout(r, 5));
    const v = files[p];
    if (v instanceof Error) throw v;
    return v === undefined ? null : { stream: Buffer.from(v) };
  };
  return esm(path.join(ROOT, "app", "api", "ta-rs", "route.js"), { "../../../lib/ta-live": live, "../../../lib/data-blob": { get } });
}
function blobOf(name, panel, through) {
  const gz = zlib.gzipSync(JSON.stringify(panel)), h = require("crypto").createHash("sha256").update(gz).digest("hex"), ver = through + "-" + h.slice(0, 12);
  const cut = Math.floor(gz.length / 2), f = {};
  f["data/" + name + "/latest.json"] = JSON.stringify({ ver, parts: 2, through, bytes: gz.length, sha256: h });
  f["data/" + name + "/" + ver + "/part0.bin"] = gz.subarray(0, cut);
  f["data/" + name + "/" + ver + "/part1.bin"] = gz.subarray(cut);
  return f;
}
const ask = (rt, body) => rt.POST(new Request("http://x/api/ta-rs", { method: "POST", body: JSON.stringify(body) })).then(async (r) => ({ status: r.status, j: await r.json() }));
const at = [];
const step = (name, fn) => at.push([name, fn]);
delete process.env.TA_RS_LOCAL_FILE; delete process.env.TA_RS_US_LOCAL_FILE;
step("路由：美股 market:'us' 讀 us_rs_panel、預設門檻 0、回 market／currency／groups_ver；同時兩個請求只下載一次", async () => {
  const calls = [], rt = route(Object.assign(blobOf("tw_rs_panel", P, "20260109"), blobOf("us_rs_panel", U, "20260109")), calls);
  const [a, b] = await Promise.all([ask(rt, { market: "us", start: "2026-01-06", end: "2026-01-09" }), ask(rt, { market: "us", start: "2026-01-06", end: "2026-01-09" })]);
  assert.strictEqual(a.status, 200, JSON.stringify(a.j)); assert.strictEqual(b.status, 200);
  assert.strictEqual(a.j.market, "us"); assert.strictEqual(a.j.currency, "USD"); assert.strictEqual(a.j.groups_ver, "treemap");
  assert.strictEqual(a.j.universe.eligible, 3);                                 // 美股預設 minAmt 0：量小的 1104 也排
  assert.strictEqual(calls.filter((p) => p.endsWith("part0.bin")).length, 1, calls.join(","));
  assert.ok(calls.every((p) => p.startsWith("data/us_rs_panel/")));
  const tw = await ask(rt, { start: "2026-01-06", end: "2026-01-09" });     // 沒給 market＝台股、預設 5e7、跟 compute 直接算一樣
  assert.strictEqual(tw.j.market, "tw"); assert.strictEqual(tw.j.currency, "TWD");
  const { ok, market, currency, ...rest } = tw.j;
  assert.deepStrictEqual(rest, JSON.parse(JSON.stringify(compute(P, { start: "2026-01-06", end: "2026-01-09", minAmt: 5e7, n: 20 }))));
  const again = await ask(rt, { market: "us", start: "2026-01-06", end: "2026-01-09" });   // 美股快取沒被台股擠掉
  assert.strictEqual(again.j.market, "us"); assert.strictEqual(calls.filter((p) => p.endsWith("part0.bin")).length, 2);
});
step("路由：op:'names' 回台股代號 → 中文名（不管 market／門檻）；記憶體有面板不重讀段；沒來源 503", async () => {
  const calls = [], rt = route(blobOf("tw_rs_panel", P, "20260109"), calls);
  const a = await ask(rt, { op: "names", market: "jp", minAmt: -1 });
  assert.strictEqual(a.status, 200, JSON.stringify(a.j));
  assert.deepStrictEqual(a.j.names, { 1101: "甲", 1102: "乙", 1103: "丙", 1104: "丁", 1105: "戊" });
  await ask(rt, { op: "names" }); await ask(rt, { start: "2026-01-06", end: "2026-01-09" });
  assert.strictEqual(calls.filter((p) => p.endsWith("part0.bin")).length, 1, calls.join(","));
  const none = await ask(route({}, []), { op: "names" });
  assert.strictEqual(none.status, 503); assert.strictEqual(none.j.reason, "no-source");
});
step("路由：market／minAmt 驗證", async () => {
  const rt = route({}, []);
  for (const bad of [{ market: "jp" }, { market: null }, { market: "toString" }, { market: "us", minAmt: 2e11 }, { market: "us", minAmt: -1 }, { minAmt: "1" }]) {
    const r = await ask(rt, bad);
    assert.strictEqual(r.status, 400, JSON.stringify(bad)); assert.strictEqual(r.j.reason, "bad-input");
  }
  assert.ok((await ask(rt, { market: "us", minAmt: 2e11 })).j.error.includes("100,000 百萬美元"));   // 同頁面輸入單位
  assert.ok((await ask(rt, { minAmt: 2e11 })).j.error.includes("10,000,000 萬"));
  assert.strictEqual((await ask(rt, { market: "us", minAmt: 1e11 })).j.reason !== "bad-input", true);   // 上限本身可以
});
step("路由：latest.json 讀失敗／JSON 壞 → 記憶體有好面板就照用；沒有才 500", async () => {
  const files = blobOf("us_rs_panel", U, "20260109"), calls = [], rt = route(files, calls), Q = { market: "us", start: "2026-01-06", end: "2026-01-09" };
  assert.strictEqual((await ask(rt, Q)).status, 200);
  const now = Date.now, real = files["data/us_rs_panel/latest.json"];
  try {
    Date.now = () => now() + 11 * 60 * 1000;                                  // 10 分鐘到了要回源看 latest
    files["data/us_rs_panel/latest.json"] = new Error("Blob 503");
    const a = await ask(rt, Q);
    assert.strictEqual(a.status, 200, JSON.stringify(a.j)); assert.strictEqual(a.j.market, "us");
    files["data/us_rs_panel/latest.json"] = "{not json";
    assert.strictEqual((await ask(rt, Q)).status, 200);
    const fresh = route(files, []);                                           // 冷啟動、沒有好面板 → 500
    assert.strictEqual((await ask(fresh, Q)).status, 500);
  } finally { Date.now = now; files["data/us_rs_panel/latest.json"] = real; }
});
step("路由：段跟 latest 對不上 → 503 updating", async () => {
  const files = blobOf("us_rs_panel", U, "20260109"), k = Object.keys(files).find((p) => p.endsWith("part1.bin"));
  files[k] = Buffer.from(files[k]); files[k][0] ^= 1;
  const r = await ask(route(files, []), { market: "us" });
  assert.strictEqual(r.status, 503); assert.strictEqual(r.j.reason, "updating");
});
step("路由：latest 換到壞版（sha256 不對／schema 不符）而記憶體有舊的好面板 → 回舊面板（帶舊的資料日），不 503", async () => {
  const files = blobOf("us_rs_panel", U, "20260109"), rt = route(files, []), Q = { market: "us", start: "2026-01-06", end: "2026-01-07" };
  assert.strictEqual((await ask(rt, Q)).j.through, "2026-01-09");
  const now = Date.now;
  const U2 = Object.assign({}, U, { through: "20260110" });
  for (const bad of [(f) => { const k = Object.keys(f).find((p) => p.endsWith("part1.bin")); f[k] = Buffer.from(f[k]); f[k][0] ^= 1; },
                     (f) => Object.assign(f, blobOf("us_rs_panel", Object.assign({}, U2, { schema: "tw-rs-1" }), "20260110"))]) {
    const nf = blobOf("us_rs_panel", U2, "20260110"); bad(nf); Object.assign(files, nf);
    try {
      Date.now = () => now() + 11 * 60 * 1000;
      const r = await ask(rt, Q);
      assert.strictEqual(r.status, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.through, "2026-01-09");
    } finally { Date.now = now; }
  }
});
step("路由：新版下載段時 Blob 丟錯 → 記憶體有舊面板就回舊的；沒有才 500；修好後下一個請求就載到新版（不留卡住的 INFLIGHT）", async () => {
  const files = blobOf("us_rs_panel", U, "20260109"), rt = route(files, []), Q = { market: "us", start: "2026-01-06", end: "2026-01-07" };
  assert.strictEqual((await ask(rt, Q)).j.through, "2026-01-09");
  const nf = blobOf("us_rs_panel", Object.assign({}, U, { through: "20260110" }), "20260110"), k = Object.keys(nf).find((p) => p.endsWith("part1.bin")), good = nf[k];
  nf[k] = new Error("Blob 503"); Object.assign(files, nf);
  const now = Date.now;
  try {
    Date.now = () => now() + 11 * 60 * 1000;
    const r = await ask(rt, Q);
    assert.strictEqual(r.status, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.through, "2026-01-09");
    const cold = route(files, []);
    assert.strictEqual((await ask(cold, Q)).status, 500);
    files[k] = good;
    const a = await ask(rt, Q), b = await ask(cold, Q);
    assert.strictEqual(a.j.through, "2026-01-10", JSON.stringify(a.j)); assert.strictEqual(b.j.through, "2026-01-10", JSON.stringify(b.j));
  } finally { Date.now = now; }
});

const US_REAL ="G:\\Yoda x Claude\\Skill\\data\\us_rs\\us_rs_panel.json.gz";
if (!fs.existsSync(US_REAL)) console.log("skip 美股真面板不在：", US_REAL);
else t("美股真面板：2026-11-02→11-12 SPY +0.1853%、APP rel ≈ +72.10pp", () => {
  const R = load("us-real", () => zlib.gunzipSync(fs.readFileSync(US_REAL)).toString("utf8"), "us");
  if (R.through < "20261112") throw new Error("美股面板資料日 " + R.through + " < 20261112");
  const r = compute(R, { start: "2026-11-02", end: "2026-11-12", minAmt: 0, n: 20 });
  assert.strictEqual(r.base, "2026-10-30"); assert.strictEqual(r.groups.length, 13);
  near(r.bench.tr, 0.1853, 1e-9);
  const app = r.strong.find((x) => x.code === "APP");
  assert.ok(app, "APP 不在強勢前 20"); near(app.rel, 72.10, 0.01);
});

const REAL = "G:\\Yoda x Claude\\Skill\\data\\tw_rs\\tw_rs_panel.json.gz";
if (!fs.existsSync(REAL)) console.log("skip 真面板不在：", REAL);
else {
  const R = load("real", () => zlib.gunzipSync(fs.readFileSync(REAL)).toString("utf8"));
  const ix = (d) => R.dates.indexOf(d);
  t("真面板：11/02→迄日，3 檔直接重算 rel", () => {
    const r = compute(R, { start: "2026-11-02", end: range(R).max, minAmt: 5e7, n: 20 });
    assert.strictEqual(r.groups.length, 27);
    const b = R.dates.findIndex((d) => d >= "20261102") - 1, e = R.dates.length - 1;
    assert.strictEqual(r.base, R.dates[b].replace(/(\d{4})(\d\d)(\d\d)/, "$1-$2-$3"));
    const tr = (R.bench_tr[e] / R.bench_tr[b] - 1) * 100;
    const pool = r.strong.concat(r.weak, r.groups[0].members);
    const pick = [pool[0], pool[Math.floor(pool.length / 2)], pool[pool.length - 1]];
    for (const x of pick) {
      const k = R.codes.indexOf(x.code);
      near(x.rel, (R.px[k][e] / R.px[k][b] - 1) * 100 - tr, 2e-4);
    }
    assert.ok(r.strong[0].rel >= r.strong[r.strong.length - 1].rel && r.weak[0].rel <= r.weak[r.weak.length - 1].rel);
    assert.ok(r.strong.every((x) => x.avgAmt >= 50));
  });
  t("真面板：2327 國巨 2025-08 面額變更不顯示 −74%", () => {
    const r = compute(R, { start: "2025-08-01", end: "2025-09-30", minAmt: 0, n: 100 });
    const k = R.codes.indexOf("2327"), b = ix("20250731"), e = ix("20250930");
    const ret = (R.px[k][e] / R.px[k][b] - 1) * 100;
    assert.ok(ret > -40, "2327 " + ret);
    assert.ok(!r.weak.some((x) => x.code === "2327" && x.ret < -40));
  });
}
(async () => {
  for (const [name, fn] of at) { try { await fn(); console.log("ok  ", name); } catch (e) { fails++; console.log("FAIL", name, "→", e && e.message); } }
  if (fails) { console.log(fails + " 項失敗"); process.exit(1); }
  console.log("全部通過");
})();
