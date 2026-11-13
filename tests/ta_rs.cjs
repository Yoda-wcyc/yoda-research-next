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
if (fails) { console.log(fails + " 項失敗"); process.exit(1); }
console.log("全部通過");
