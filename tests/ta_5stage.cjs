// 反彈五階段／修正五階段（lib/ta-5stage.js，Yoda 11-24）。跑法：node tests/ta_5stage.cjs（失敗 exit 1）
//  手造情境（同 five2.py 自測）：走完五階段、沒有④直接破支撐、②要量（碰後 3 根內、缺量不算進均量）、大量K當壓力、作廢三種＋逾時、重置、
//  停損價移動（只往有利方向）、四種出場、K 棒上下翻轉＝空多鏡像、共振配對
//  黃金比對：tests/ta_5stage_nq4h.json、ta_5stage_2330d.json（five2.run exit=V2 算，scratchpad five\r2\gen_golden.py 產生），JS 逐筆一致
const fs = require("fs"), path = require("path"), assert = require("assert");
const ROOT = path.join(__dirname, "..");
const { transformSync } = require(path.join(ROOT, "node_modules", "next", "dist", "build", "swc"));
const opts = { jsc: { parser: { syntax: "ecmascript", jsx: false }, target: "es2020" }, module: { type: "commonjs" } };
const Mod = require("module");
const load = (f) => {
  const m = new Mod(path.join(ROOT, "lib", f)); m.filename = m.id; m.paths = Mod._nodeModulePaths(ROOT);
  m._compile(transformSync(fs.readFileSync(m.id, "utf8"), opts).code, m.id);
  require.cache[m.id] = m; m.loaded = true;
  return m.exports;
};
const F = load("ta-5stage.js");
let fails = 0;
function t(name, fn) { try { fn(); console.log("ok  ", name); } catch (e) { fails++; console.log("FAIL", name, "→", e && e.message); } }
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, m + "：" + a + " ≠ " + b);

// 同 five2.py mk：收盤序列 → K（開＝前收、高低＝實體外 0.2；vol／hl／op 覆寫）
const mk = (cs, vol = {}, hl = {}, op = {}) => cs.map((c, i) => {
  const o = i in op ? op[i] : i ? cs[i - 1] : c, [h, l] = i in hl ? hl[i] : [Math.max(o, c) + 0.2, Math.min(o, c) - 0.2];
  return { t: "2026-01-" + String(1 + Math.floor(i / 24)).padStart(2, "0") + " " + String(i % 24).padStart(2, "0") + ":00", o, h, l, c, v: i in vol ? vol[i] : 0 };
});
const flip = (bars, K) => bars.map((b) => ({ ...b, o: K - b.o, h: K - b.l, l: K - b.h, c: K - b.c }));
const MA = [2, 3, 20];
const run = (bars, sd = "s", ex = "V0") => F.fiveStageAll(bars, F.smaLines(bars, MA), sd, ex);
const mine = (r) => r.find((x) => x.s1.i === 30);
const down = Array.from({ length: 30 }, (_, i) => 160 - 2 * i);
const V33 = { 33: 300 }, HL33 = { 33: [114.5, 105.8] };
const cs1 = [...down, 104, 105, 106, 107, 106.4, 104.5, 103.0, 102.4, 102.0, 101.2, 100.5, 115];
const b1 = mk(cs1, V33, { ...HL33, 37: [103.2, 101.5] });
const cs2 = [...down, 104, 105, 106, 107, 106.4, 104.5, 101.5, 100];
const cs7 = [...cs2.slice(0, 37), 98, 97.5, 93.5, 94, 90, 90.5, 92.5];

t("走完五階段：①30 → 33 碰 L 帶量 → ②34（頂 114.5）→ ③35 → ④37（防線 101.5）→ ⑤39 → 41 收 115 越過停損＝線（同根也是新①，仍算線）", () => {
  const r = run(b1), q = mine(r);
  assert.strictEqual(q.sup, 101.8); assert.deepStrictEqual([q.touch.i, q.touch.kind, q.touch.vol_i], [33, "L", 33]);
  assert.deepStrictEqual([q.s2.i, q.top, q.s3.i, q.s4.i, q.def, q.s5.i, q.s5.p], [34, 114.5, 35, 37, 101.5, 39, 101.2]);
  assert.deepStrictEqual([q.ex.type, q.ex.i, q.status], ["stop", 41, "done"]);
  near(q.ex.pnl, 101.2 - 115, "pnl"); assert.ok(q.ex.pct < 0);
  assert.ok(r.some((x) => x.s1.i === 41));
});
t("沒有④直接破支撐：③35 後第一根收 101.5 < 支撐 101.8＝⑤", () => {
  const q = mine(run(mk(cs2, V33, HL33)));
  assert.deepStrictEqual([q.s3.i, q.s4, q.def, q.s5.i], [35, null, q.sup, 36]);
});
t("②要量：33 沒量 → 36 破支撐作廢；碰後第 3 根帶量算、第 4 根不算；缺量（null）不算進均量", () => {
  let q = mine(run(mk(cs2, {}, HL33)));
  assert.deepStrictEqual([q.touch, q.s2, q.status, q.end], [null, null, "void_break", 36]);
  const cs3 = [...down, 104, 105, 106, 107, 107.2, 107.4, 107.5, 106, 105];
  q = mine(run(mk(cs3, { 36: 300 }, HL33)));
  assert.deepStrictEqual([q.touch.i, q.touch.vol_i, q.s2.i], [33, 36, 37]);
  q = mine(run(mk(cs3, { 37: 300 }, HL33)));
  assert.deepStrictEqual([q.touch, q.s2], [null, null]);
  for (const v20 of [200, null]) {
    const v = {}; for (let i = 0; i < cs2.length; i++) v[i] = 200; v[33] = 290; v[20] = v20;
    q = mine(run(mk(cs2, v, HL33)));
    assert.deepStrictEqual([q.touch, q.status], [null, "void_break"], "v20=" + v20);
  }
});
t("壓力用大量K：5 號大量K最低 106 比 L 近 → bigK；拿掉大量K → 沒有②", () => {
  const cs = [...down, 104, 105, 105.5, 104, 103, 102.5], hl = { 5: [152.2, 106.0], 32: [105.8, 104.8] };
  let q = mine(run(mk(cs, { 5: 900, 32: 300 }, hl)));
  assert.deepStrictEqual([q.touch.kind, q.touch.j, q.touch.P, q.s2.i], ["bigK", 5, 106, 33]);
  q = mine(run(mk(cs, { 32: 300 }, hl)));
  assert.strictEqual(q.touch, null);
});
t("作廢：②前站上 L 且 L 上彎；60 根逾時；③前破支撐；新①重置還沒到②的（作廢都不畫）", () => {
  let r = run(mk([...down, 104, 110, 116, 122, 128, 134, 140]));
  assert.deepStrictEqual([mine(r).status, mine(r).end], ["void_premise", 35]);
  const q = mine(run(mk([...down, 104, 105, 106, 107, 106.4, 104.5, ...Array(70).fill(102.6)], V33, HL33)));
  assert.deepStrictEqual([q.status, !!q.s3, q.s5, q.end], ["timeout", true, null, 90]);
  r = run(mk([...down, 104, 105, 101, 100]));
  assert.deepStrictEqual([mine(r).status, mine(r).end], ["void_break", 32]);
  r = run(mk([...down, 104, 101.9, 101.85, 104.5, 105]));
  assert.deepStrictEqual([mine(r).status, mine(r).end], ["void_reset", 33]); assert.ok(r.some((x) => x.s1.i === 33));
  const bars = mk([...down, 104, 101.9, 101.85, 104.5, 105]);
  assert.ok(!F.fiveStage(bars, F.smaLines(bars, MA), "s").some((x) => x.s1.i === 30), "作廢不畫");
});
t("停損價：⑤36 停損＝頂 114.5；37 第 1 根長黑不動、39 第 2 根移到 97.7、41 再移 94.2；跳空長黑最高較高不動", () => {
  let q = mine(run(mk(cs7, V33, HL33)));
  assert.strictEqual(q.s5.i, 36); assert.deepStrictEqual(q.stops, [[36, 114.5], [39, 97.7], [41, 94.2]]);
  assert.deepStrictEqual([q.ex.type, q.ex.i], ["profit", 43]); near(q.ex.pnl, 9, "V0 新①出 +9");
  q = mine(run(mk(cs7, V33, HL33, { 41: 97.9 })));
  assert.deepStrictEqual(q.stops, [[36, 114.5], [39, 97.7]]);
});
t("四種出場：V1 持有中、V2 收站回 M＝均 +9、V3 持有中；V2 同根破停損算線；①～⑤ 跟出場無關；預設＝V2", () => {
  assert.strictEqual(F.EXIT5, "V2");
  let q = mine(run(mk(cs7, V33, HL33), "s", "V1"));
  assert.deepStrictEqual([q.ex, q.status], [null, "open"]); assert.deepStrictEqual(q.stops, [[36, 114.5], [39, 97.7], [41, 94.2]]);
  q = mine(F.fiveStageAll(mk(cs7, V33, HL33), F.smaLines(mk(cs7, V33, HL33), MA), "s"));
  assert.deepStrictEqual([q.ex.type, q.ex.i], ["profit", 43]); near(q.ex.pnl, 9, "V2");
  assert.strictEqual(mine(run(mk(cs7, V33, HL33), "s", "V3")).status, "open");
  q = mine(run(b1, "s", "V2")); assert.deepStrictEqual([q.ex.type, q.ex.i], ["stop", 41]);
  for (const b of [b1, mk(cs2, V33, HL33), mk(cs7, V33, HL33)]) {
    const ref = JSON.stringify(run(b).map((x) => [x.s1.i, x.s5 && x.s5.i]));
    for (const e of F.EXITS) assert.strictEqual(JSON.stringify(run(b, "s", e).map((x) => [x.s1.i, x.s5 && x.s5.i])), ref, e);
  }
});
t("鏡像：價格上下翻轉（216−x）後修正五階段＝原本反彈五階段（四種出場都驗）", () => {
  const K = 216;
  for (const b of [b1, mk(cs2, V33, HL33), mk(cs7, V33, HL33)]) for (const e of F.EXITS) {
    const rs = run(b, "s", e), rl = run(flip(b, K), "l", e);
    assert.ok(rs.length && rs.length === rl.length);
    rs.forEach((x, k) => {
      const y = rl[k];
      assert.strictEqual(x.status, y.status);
      for (const j of [1, 2, 3, 4, 5]) assert.strictEqual(x["s" + j] && x["s" + j].i, y["s" + j] && y["s" + j].i);
      near(x.sup, K - y.sup, "sup"); near(x.def, K - y.def, "def");
      if (x.top != null) near(x.top, K - y.top, "top");
      assert.strictEqual(!!x.ex, !!y.ex);
      if (x.ex) { assert.deepStrictEqual([x.ex.type, x.ex.i], [y.ex.type, y.ex.i]); near(x.ex.pnl, y.ex.pnl, "pnl"); }
      if (x.stops) x.stops.forEach(([i, p], j) => { assert.strictEqual(i, y.stops[j][0]); near(p, K - y.stops[j][1], "stop"); });
    });
  }
});
t("共振：自己跟自己每個事件都配到；B 的①差 3 根算、4 根不算；方向不同不算；作廢不算", () => {
  const r = run(b1), q = mine(r);
  const co = F.coincide5(r, r);
  assert.strictEqual(co.length, F.events5(r).length); assert.ok(co.every((c) => c.iA === c.iB));
  const fake = [{ ...q, s1: { i: 33, p: 0 } }, { ...q, s1: { i: 34, p: 0 } }];
  assert.deepStrictEqual(F.coincide5(r, fake).filter((c) => c.key === 1 && c.iA === 30).map((c) => [c.iA, c.iB, c.late]), [[30, 33, 33]]);
  assert.strictEqual(F.coincide5(r, fake.map((x) => ({ ...x, side: "l" }))).length, 0);
  assert.strictEqual(F.coincide5(r, fake.map((x) => ({ ...x, status: "void_reset" }))).length, 0);
});
t("浮動說明：⑤列停損歷程、②列量倍數與壓力、均／線列損益；名稱 彈1～彈5、彈均、彈線／修…（11-24 改名：利→均、停→線）", () => {
  const b = mk(cs7, V33, HL33), L = F.smaLines(b, MA), q = mine(F.fiveStageAll(b, L, "s")), nm = ["SMA2", "SMA3", "SMA20"];
  const i5 = F.info5("s", q, 5, b, L, nm), i2 = F.info5("s", q, 2, b, L, nm), ix = F.info5("s", q, "x", b, L, nm, "5/10/20 01-02 12:00、8/13/34 01-02 13:00");
  assert.strictEqual(i5.title, "反彈五階段 彈5");
  assert.ok(i5.rows.some(([k, v]) => k === "停損" && v.startsWith("114.5（反彈頂） → 97.7")), JSON.stringify(i5.rows));
  assert.ok(i2.rows.some(([k, v]) => k === "條件" && /碰到壓力 SMA20 114\.\d+.*量 — 倍/.test(v)), JSON.stringify(i2.rows));
  assert.ok(ix.rows.some(([k, v]) => k === "損益" && v.startsWith("+9.00 點")));
  assert.ok(ix.rows.some(([k]) => k === "共振"));
  assert.deepStrictEqual([1, 5, "x", "stop"].map((k) => F.step5Name("l", k)), ["修1", "修5", "修均", "修線"]);
  assert.strictEqual(F.line5Info("s", q, "stop", b).title, "停損 94.2");
});

// ───────── 黃金比對 ─────────
for (const fx of ["nq4h", "2330d"]) {
  const G = JSON.parse(fs.readFileSync(path.join(__dirname, "ta_5stage_" + fx + ".json"), "utf8"));
  const bars = G.bars.map(([t0, o, h, l, c, v]) => ({ t: t0, o, h, l, c, v }));
  t("黃金 " + fx + "（" + G.src + "）：三組均線 × 空多，每條序列逐欄一致；A×B 空方共振一致", () => {
    const res = {};
    let n5 = 0;
    for (const [sk, ma] of Object.entries(G.sets)) for (const [side, sd] of [["short", "s"], ["long", "l"]]) {
      const got = F.fiveStageAll(bars, F.smaLines(bars, ma), sd), exp = G.exp[sk + " " + side];
      res[sk + sd] = got;
      assert.strictEqual(got.length, exp.length, sk + " " + side + " 序列數");
      got.forEach((q, k) => {
        const e = exp[k], tag = sk + " " + side + " #" + k;
        const sim = { st: q.status, end: q.end, s: [1, 2, 3, 4, 5].map((j) => (q["s" + j] ? [q["s" + j].i, q["s" + j].p] : null)), sup: q.sup, def: q.def, top: q.top,
          touch: q.touch ? [q.touch.i, q.touch.P, q.touch.kind, q.touch.j, q.touch.vol_i, q.touch.vol_mult] : null, stops: q.stops,
          ex: q.ex ? [q.ex.type, q.ex.i, q.ex.p, q.ex.pnl, q.ex.pct] : null };
        assert.deepStrictEqual(sim, e, tag);
        if (q.s5) n5++;
      });
    }
    assert.ok(fx !== "nq4h" || n5 >= 10, "nq4h 要有足夠的⑤：" + n5);
    const q2 = res.As.find((q) => q.s2 && q.touch.vol_mult);   // 真資料的②：說明寫出量倍數與碰到的壓力
    if (q2) assert.ok(F.info5("s", q2, 2, bars, F.smaLines(bars, G.sets.A), ["SMA5", "SMA10", "SMA20"]).rows[1][1].includes("量 " + q2.touch.vol_mult.toFixed(2) + " 倍"));
    assert.deepStrictEqual(F.coincide5(res.As, res.Bs).map((c) => [c.key, c.iA, c.iB, c.late]), G.co, "共振");
  });
}

if (fails) { console.log(fails + " 項失敗"); process.exit(1); }
console.log("全部通過");
