// 空方／多方四步（lib/ta-4step.js，Yoda 11-24）。跑法：node tests/ta_4step.cjs（失敗 exit 1）
//  手造小資料：走完四步、②前破 L1 作廢、新序列到②才作廢舊的、到③不被重置、同根空4＋空利算空4、空利但虧損、多方手算、K 棒翻轉＝多空鏡像
//  黃金比對：tests/ta_4step_nq4h.json（NQ=F 4H final=true）期望值由 Python seq.py＋exit_ma5.py（reset=new_s2, tol=0.005）算，JS 逐筆一致
const fs = require("fs"), path = require("path"), assert = require("assert");
const ROOT = path.join(__dirname, "..");
const { transformSync } = require(path.join(ROOT, "node_modules", "next", "dist", "build", "swc"));
const opts = { jsc: { parser: { syntax: "ecmascript", jsx: false }, target: "es2020" }, module: { type: "commonjs" } };
const Mod = require("module");
const load = (f) => {
  const m = new Mod(path.join(ROOT, "lib", f)); m.filename = m.id; m.paths = Mod._nodeModulePaths(ROOT);   // filename：ta-4step 的 require("./ta-trade") 才解得到
  m._compile(transformSync(fs.readFileSync(m.id, "utf8"), opts).code, m.id);
  require.cache[m.id] = m; m.loaded = true;
  return m.exports;
};
load("ta-trade.js");
const F = load("ta-4step.js");
let fails = 0;
function t(name, fn) { try { fn(); console.log("ok  ", name); } catch (e) { fails++; console.log("FAIL", name, "→", e && e.message); } }
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, m + "：" + a + " ≠ " + b);

// 20 根 110 → 10 根 90 → 第 30 根拉到 96（> MA5 91.2、MA10 90.6，< MA20 99.3）＝空1
const base = [...Array(20).fill(110), ...Array(10).fill(90)];
const mk = (cs, lows = {}) => cs.map((x, i) => ({ t: "2026-01-01 " + String(i).padStart(2, "0") + ":00", o: x, h: x + 1, l: i in lows ? lows[i] : x - 1, c: x }));
const S = (bars) => F.fourStepAll(bars, "s");
const idx = (q) => [q.s1, q.s2, q.s3, q.s4, q.sx].map((x) => (x ? x.i : null));
const flip = (bars) => bars.map((b) => ({ ...b, o: -b.o, h: -b.l, l: -b.h, c: -b.c }));

t("走完四步：空1 30 → 空2 31（L2 94.2）→ 空3 32 收 93.9 → 33 收 95 站回 L2＝空4（同根也站上 MA5，算空4）", () => {
  const q = S(mk([...base, 96, 95, 93.9, 95], { 30: 94, 31: 94.2, 32: 93, 33: 94.5 }));
  assert.strictEqual(q.length, 1);
  assert.deepStrictEqual(idx(q[0]), [30, 31, 32, 33, null]);
  assert.strictEqual(q[0].status, "done"); assert.strictEqual(q[0].L1, 94); assert.strictEqual(q[0].L2, 94.2);
  assert.strictEqual(q[0].ex.type, "stop"); near(q[0].ex.pnl, 93.9 - 95, "停損虧損");
  near(q[0].s1.ma5, 91.2, "MA5"); near(q[0].s1.ma20, 99.3, "MA20");
});
t("空利但虧損：33 收 94.0 沒站回 L2、站上 MA5 93.78 → 空利，損益 −0.1（照實寫負數）", () => {
  const bars = mk([...base, 96, 95, 93.9, 94.0], { 30: 94, 31: 94.2, 32: 93 });
  const q = S(bars)[0];
  assert.strictEqual(q.ex.type, "profit"); assert.deepStrictEqual(idx(q), [30, 31, 32, null, 33]);
  near(q.ex.pnl, -0.1, "pnl"); assert.ok(q.ex.pct < 0);
  assert.strictEqual(F.pnl4(q.ex), "−0.10 點（−0.11%）");
  const inf = F.info4("s", q, "x", bars);
  assert.strictEqual(inf.title, "空方四步 空利"); assert.deepStrictEqual(inf.rows[0], ["出場", "獲利出場"]);
  assert.ok(inf.rows.some(([k, v]) => k === "損益" && v.startsWith("−0.10 點")));
});
t("空利真的賺；持有中；沒到③", () => {
  let q = S(mk([...base, 96, 95, 93.9, 88, 93.5], { 30: 94, 31: 94.2, 32: 93 }))[0];
  assert.strictEqual(q.ex.type, "profit"); assert.strictEqual(q.ex.i, 34); near(q.ex.pnl, 0.4, "pnl");
  q = S(mk([...base, 96, 95, 93.9, 88], { 30: 94, 31: 94.2, 32: 93 }))[0];
  assert.strictEqual(q.status, "wait4"); assert.strictEqual(q.ex, null); assert.strictEqual(F.info4("s", q, 3, mk([...base, 96, 95, 93.9, 88])).status, "空3 後持有中");
  q = S(mk([...base, 96, 95], { 30: 94, 31: 94.2 }))[0];
  assert.strictEqual(q.status, "wait3"); assert.strictEqual(q.s3, null);
});
t("②前收盤破 L1 → 作廢（圖上不畫）", () => {
  const bars = mk([...base, 96, 93.5, 95], { 30: 94, 31: 93, 32: 94.1 });
  assert.strictEqual(S(bars)[0].status, "void_close_below_L1");
  assert.strictEqual(F.fourStep(bars, "s").length, 0);
});
t("新序列走到②才作廢舊的：新空1 出現時舊的還在，新的到空2 那根舊的才作廢", () => {
  // A：空1 30（下影 low 85）；31 收 91 跌回 MA5 下；32 收 97 再站上＝B 空1（low 95）；33 low 95.2 收 96 → B 空2 → A 作廢
  const pre = [...base, 96, 91, 97], lows = { 30: 85, 31: 90, 32: 95 };
  let q = S(mk(pre, lows));
  assert.deepStrictEqual(q.map((x) => [x.s1.i, x.status]), [[30, "wait2"], [32, "wait2"]]);
  q = S(mk([...pre, 96], { ...lows, 33: 95.2 }));
  assert.deepStrictEqual(q.map((x) => [x.s1.i, x.status]), [[30, "void_newer_s2"], [32, "wait3"]]);
  assert.deepStrictEqual(F.fourStep(mk([...pre, 96], { ...lows, 33: 95.2 }), "s").map((x) => x.s1.i), [32]);
});
t("已到③的不被重置：A 空3 與 B 空2 同一根，A 照樣持有", () => {
  // A：空1 30（low 85）空2 31（low 85.3）；32 收 91 跌回；33 收 95 low 84＝B 空1；34 收 85 < 85.3＝A 空3，同根 low 84.2 收 85＝B 空2；35 收 84.5 A 不出場
  const q = S(mk([...base, 96, 95, 91, 95, 85, 84.5], { 30: 85, 31: 85.3, 32: 90, 33: 84, 34: 84.2, 35: 84 }));
  assert.deepStrictEqual(q.map((x) => [x.s1.i, x.status]), [[30, "wait4"], [33, "wait3"]]);
  assert.deepStrictEqual(idx(q[0]), [30, 31, 34, null, null]); assert.deepStrictEqual(idx(q[1]), [33, 34, null, null, null]);
});
t("多方手算：多1 30（H1 106）→ 多2 31（H2 106.4）→ 多3 32 收 106.5 → 33 收 106 跌回 H2＝多4；另一組 35 多利賺 0.7", () => {
  const mkh = (cs, highs) => cs.map((x, i) => ({ t: "d" + i, o: x, h: i in highs ? highs[i] : x + 1, l: x - 1, c: x }));
  const lb = [...Array(20).fill(90), ...Array(10).fill(110)], hs = { 30: 106, 31: 106.4, 32: 107 };
  let q = F.fourStepAll(mkh([...lb, 104, 105, 106.5, 106], { ...hs, 33: 106.8 }), "l");
  assert.strictEqual(q.length, 1); assert.deepStrictEqual(idx(q[0]), [30, 31, 32, 33, null]);
  assert.strictEqual(q[0].L1, 106); assert.strictEqual(q[0].L2, 106.4); assert.strictEqual(q[0].s3.p, 106.5); near(q[0].ex.pnl, -0.5, "多4 虧");
  near(q[0].s1.ma5, 108.8, "MA5");
  q = F.fourStepAll(mkh([...lb, 104, 105, 106.5, 112, 107, 107.2], hs), "l");
  assert.strictEqual(q[0].ex.type, "profit"); assert.strictEqual(q[0].ex.i, 35); near(q[0].ex.pnl, 0.7, "多利");
  // 帶外 106.6（+0.57%）不算多2；多2 前收盤 106.2 > H1 → 作廢
  q = F.fourStepAll(mkh([...lb, 104, 105, 106.2], { 30: 106, 31: 106.6, 32: 107 }), "l");
  assert.strictEqual(q[0].status, "void_close_below_L1"); assert.strictEqual(q[0].s2, null);
  // 空方資料用多方跑不會在 30 誤判出多1
  assert.ok(F.fourStepAll(mk([...base, 96, 95, 93.9, 95], { 30: 94, 31: 94.2, 32: 93 }), "l").every((x) => x.s1.i !== 30));
});

const G = JSON.parse(fs.readFileSync(path.join(__dirname, "ta_4step_nq4h.json"), "utf8"));
const GB = G.t.map((tt, i) => ({ t: tt, h: G.h[i], l: G.l[i], c: G.c[i] }));
t("K 棒上下翻轉後的空方結果＝多方結果（NQ 4H 整段：索引、狀態、價位取負）", () => {
  const a = F.fourStepAll(flip(GB), "s"), b = F.fourStepAll(GB, "l");
  assert.strictEqual(a.length, b.length); assert.ok(b.length > 5);
  a.forEach((x, k) => {
    const y = b[k];
    assert.deepStrictEqual(idx(x), idx(y)); assert.strictEqual(x.status, y.status);
    assert.strictEqual(-x.L1, y.L1); assert.strictEqual(x.L2 == null ? null : -x.L2, y.L2);
    if (x.ex) { assert.strictEqual(-x.ex.p, y.ex.p); near(x.ex.pnl, y.ex.pnl, "pnl"); }
  });
});
for (const sd of ["s", "l"]) {
  t("黃金比對（" + (sd === "s" ? "空方" : "多方") + "）：NQ 4H 每個序列（含作廢）①②③ 與 4／利 的索引與價位＝Python", () => {
    const js = F.fourStepAll(GB, sd), py = G.exp[sd];
    assert.strictEqual(js.length, py.length, "序列數");
    py.forEach((p, k) => {
      const q = js[k], at = "第 " + k + " 個（" + G.t[p.s1[0]] + "）";
      assert.strictEqual(q.status, p.status, at + " 狀態");
      near(q.L1, p.L1, at + " L1");
      assert.strictEqual(q.L2 == null, p.L2 == null, at + " L2 有無"); if (p.L2 != null) near(q.L2, p.L2, at + " L2");
      for (const s of ["s1", "s2", "s3"]) {
        assert.strictEqual(q[s] == null, p[s] == null, at + " " + s + " 有無");
        if (p[s]) { assert.strictEqual(q[s].i, p[s][0], at + " " + s + " 索引"); near(q[s].p, p[s][1], at + " " + s + " 價"); }
      }
      assert.strictEqual(q.ex == null, p.ex == null, at + " 出場有無");
      if (p.ex) {
        const [type, i, px, pnl, pct] = p.ex;
        assert.strictEqual(q.ex.type, type, at + " 出場別"); assert.strictEqual(q.ex.i, i, at + " 出場索引");
        near(q.ex.p, px, at + " 出場價"); near(q.ex.pnl, pnl, at + " pnl"); near(q.ex.pct, pct, at + " pct");
        assert.ok(q[type === "stop" ? "s4" : "sx"] && q[type === "stop" ? "s4" : "sx"].i === i);
      }
    });
  });
}
t("Yoda 定的 11-09 那組空方（美東 11-08 18:00 空1）：空3 11-19 14:00 收 26,505.5（台灣 11-20 03:00）、空利 11-20 06:00（台灣 19:00）；說明文字", () => {
  const q = F.fourStep(GB, "s").find((x) => G.t[x.s1.i] === "2026-11-08 18:00");
  assert.ok(q, "找不到那組");
  assert.strictEqual(G.t[q.s3.i], "2026-11-19 14:00"); assert.strictEqual(G.t[q.sx.i], "2026-11-20 06:00");
  assert.strictEqual(q.L1, 26882.25); assert.strictEqual(q.L2, 26751.25); assert.strictEqual(q.s3.p, 26505.5);
  const i3 = F.info4("s", q, 3, GB);
  assert.strictEqual(i3.title, "空方四步 空3"); assert.strictEqual(i3.sub, "2026-11-19 14:00");
  assert.deepStrictEqual(i3.rows[1], ["條件", "收盤 26,505.5 跌破 L2 26,751.25"]);
  const ix = F.info4("s", q, "x", GB);
  assert.ok(/^收盤 [\d,.]+ 站上 MA5 [\d,.]+$/.test(ix.rows.find(([k]) => k === "條件")[1]));
  const l2 = F.l2Info4("s", q, GB);
  assert.strictEqual(l2.title, "L2 26,751.25"); assert.ok(l2.sub.endsWith("到 2026-11-20 06:00"));
});

console.log(fails ? fails + " FAIL" : "all ok");
process.exit(fails ? 1 : 0);
