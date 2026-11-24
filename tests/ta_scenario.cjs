// 劇本示意 K（lib/ta-scenario.js，Yoda 11-24）。跑法：node tests/ta_scenario.cjs（失敗 exit 1）
//  決定性（同輸入同輸出）、四條路徑 OHLC 合法＋對齊跳動單位、規劃點＝示意 K 上條件第一次成立那根（這裡另寫一份判斷逐根驗）、
//  算不出回 null、空轉多／多轉空鏡像（K 上下翻轉後兩邊一模一樣）、時間軸跳過週末與休市（含半日市、美國期貨 18:00 開盤）、
//  不改輸入、不影響回測與五階段結果、效能（一次四條 < 300ms）
//  資料：tests/ta_5stage_nq4h.json（NQ=F 4H，美東）、ta_5stage_2330d.json（2330 日K）
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
const TT = load("ta-trade.js"), F5 = load("ta-5stage.js"), S = load("ta-scenario.js");
let fails = 0;
function t(name, fn) { try { fn(); console.log("ok  ", name); } catch (e) { fails++; console.log("FAIL", name, "→", e && e.message); } }

const fx = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8")).bars.map(([t0, o, h, l, c, v]) => ({ t: t0, o, h, l, c, v }));
const NQ = fx("ta_5stage_nq4h.json"), TW = fx("ta_5stage_2330d.json").map((b) => ({ ...b, t: b.t.slice(0, 10) }));
const CASES = [["NQ 4H", NQ, { tf: "4H", mkt: "fut", tz: "America/New_York" }], ["2330 D", TW, { tf: "D", mkt: "tw", tz: "Asia/Taipei" }]];
const SETS = [[5, 10, 20], [8, 13, 34], [20, 60, 120]];
const run = (bars, o, ma_n, dir, ma = "sma") => S.scenarios(bars, { ...o, ma, ma_n, dir });
const all = [];
for (const [nm, bars, o] of CASES) for (const mn of SETS) for (const dir of [1, -1]) all.push([nm + " " + mn.join("/") + (dir === 1 ? " 空轉多" : " 多轉空"), bars, o, mn, dir, run(bars, o, mn, dir)]);

t("決定性：同一份資料、同設定算兩次一模一樣（含 EMA）", () => {
  for (const [nm, bars, o, mn, dir, r] of all) {
    const r2 = run(bars, o, mn, dir);
    assert.deepStrictEqual({ ...r2, ms: 0 }, { ...r, ms: 0 }, nm);
  }
  const e1 = run(NQ, CASES[0][2], [8, 13, 34], 1, "ema"), e2 = run(NQ, CASES[0][2], [8, 13, 34], 1, "ema");
  assert.deepStrictEqual({ ...e1, ms: 0 }, { ...e2, ms: 0 });
  assert.ok(e1.names[0] === "回踩 EMA34 再攻", e1.names[0]);
});

t("NQ 4H 中均線兩個方向四條都算得出（demo 那份資料）；全部情境多數算得出", () => {
  assert.ok(all.filter((x) => x[5].list.some(Boolean)).length >= all.length * 0.75, "算得出的情境太少");
  for (const [nm, , , mn, , r] of all) if (nm.startsWith("NQ 4H") && mn[1] === 13) assert.ok(r.list.every(Boolean), nm + "：" + r.list.map(Boolean));
});

t("四條路徑 OHLC 合法、對齊跳動單位、量 ≥ 0、根數在 1H 60～70／4H 50～60／日K 15～25；時間接在最後一根之後、不重複", () => {
  const rngN = { "4H": [50, 60], D: [15, 25] };
  for (const [nm, bars, o, , , r] of all) for (const p of r.list) {
    if (!p) continue;
    assert.ok(p.sim.length >= rngN[o.tf][0] && p.sim.length <= rngN[o.tf][1], nm + " 根數 " + p.sim.length);
    let prev = bars[bars.length - 1].t;
    for (const b of p.sim) {
      assert.ok(b.l <= Math.min(b.o, b.c) && Math.max(b.o, b.c) <= b.h, nm + " " + p.name + " " + JSON.stringify(b));
      for (const x of [b.o, b.h, b.l, b.c]) assert.ok(Math.abs(x / r.tick - Math.round(x / r.tick)) < 1e-6, nm + " 跳動單位 " + x + " / " + r.tick);
      assert.ok(Number.isInteger(b.v) && b.v >= 0, "量");
      assert.ok(b.t > prev, nm + " 時間 " + prev + " → " + b.t); prev = b.t;
    }
  }
  assert.strictEqual(all[0][5].tick, 0.25, "NQ 跳動 0.25");
  // 較舊的 K 是除權息調整價（帶小數）、近 40 根都是 5 的倍數 → 跳動單位 5
  const adj = Array.from({ length: 200 }, (_, i) => (i < 150 ? { o: 2316.62, h: 2320.37, l: 2311.08, c: 2317.9 } : { o: 2310, h: 2325, l: 2305, c: 2320 }));
  assert.strictEqual(S.tickOf(adj), 5, "近期跳動單位");
});

// 另寫一份判斷（真實價格、方向 s）：規劃點必須是第一根成立
const KIND = {
  ma: { entry: "brk", stop: ["ma", 2], ex1: "touch", ex2: ["ma", 1] }, strong: { entry: "brk", stop: "back", ex1: "touch", ex2: ["ma", 0] },
  w: { entry: "brk", stop: "back", ex1: "touch", ex2: "touch" }, spring: { entry: "reclaim", stop: "back", ex1: "touch", ex2: ["ma", 0] },
};
t("規劃點＝示意 K 上條件第一次成立那根（進場、出場1、出場2；停損整段沒觸發、畫得出價位）", () => {
  for (const [nm, bars, , mn, dir, r] of all) for (const p of r.list) {
    if (!p) continue;
    const B = bars.concat(p.sim), NA = bars.length, C = B.map((b) => b.c), M = TT.maLines(C, { ma: "sma", ma_n: mn });
    const va = (k) => { let z = 0; for (let j = k - 20; j < k; j++) z += B[j].v; return z / 20; };
    const row = Object.fromEntries(p.plan.map((x) => [x.kind, x])), s = dir, K = KIND[p.id];
    const ok = (kind, k) => {
      const c = K[kind], lv = row[kind].level, b = B[k];
      if (c === "brk") return s * (b.c - lv) > 0 && b.v >= 1.5 * va(k);
      if (c === "reclaim") return s * (b.c - lv) > 0 && B.slice(NA, k).some((x) => s * (x.c - lv) < 0);
      if (c === "back") return s * (b.c - lv) < 0;
      if (c === "touch") return s === 1 ? b.h >= lv : b.l <= lv;
      return s * (b.c - M[c[1]][k]) < 0;
    };
    const e = row.entry.k, x1 = row.ex1.k, x2 = row.ex2.k;
    assert.ok(e >= NA && x1 > e && x2 > x1 && x2 < B.length, nm + " " + p.name + " 順序 " + [e, x1, x2]);
    for (let k = NA; k < e; k++) assert.ok(!ok("entry", k), nm + " " + p.name + " 進場前 " + B[k].t + " 就成立");
    assert.ok(ok("entry", e), nm + " " + p.name + " 進場那根不成立");
    for (let k = e; k < x1; k++) assert.ok(!ok("ex1", k), nm + " " + p.name + " 出場1 前 " + B[k].t + " 就成立（含進場那根）");
    assert.ok(ok("ex1", x1), nm + " 出場1 那根不成立");
    for (let k = x1 + 1; k < x2; k++) assert.ok(!ok("ex2", k), nm + " " + p.name + " 出場2 前 " + B[k].t + " 就成立");
    assert.ok(ok("ex2", x2), nm + " 出場2 那根不成立");
    if (K.stop[0] !== "ma") for (let k = e + 1; k <= x2; k++) assert.ok(!ok("stop", k), nm + " " + p.name + " 停損在 " + B[k].t + " 觸發了");
    else for (let k = e + 1; k <= x2; k++) assert.ok(!(s * (B[k].c - M[K.stop[1]][k]) < 0), nm + " 停損（均線）觸發");
    assert.strictEqual(row.stop.k, null); assert.ok(row.stop.level != null && s * (row.entry.p - row.stop.level) > 0, nm + " 停損價位在進場價的不利那邊");
    assert.strictEqual(row.entry.t, B[e].t); assert.strictEqual(row.entry.p, B[e].c, "進場價＝收盤");
    // 損益：多單＝出 − 進、空單＝進 − 出（點數與 %）
    for (const q of ["ex1", "ex2"]) {
      const pn = s * (row[q].p - row.entry.p);
      assert.ok(Math.abs(row[q].pnl - pn) < 1e-6 && Math.abs(row[q].pct - (pn / row.entry.p) * 100) < 1e-9, nm + " " + q + " 損益");
      assert.ok(row[q].pnl >= 0, nm + " " + p.name + " " + q + " 比進場差");
    }
  }
});

t("鏡像：K 上下翻轉後跑空轉多 ＝ 原資料跑多轉空（同種子、同根數、價位互為 K − x、損益相同）", () => {
  for (const [nm, bars, o] of CASES) for (const mn of SETS) {
    const K = S.mirrorK(bars, S.tickOf(bars)), flip = bars.map((b) => ({ t: b.t, o: K - b.o, h: K - b.l, l: K - b.h, c: K - b.c, v: b.v }));
    const up = run(flip, o, mn, 1), dn = run(bars, o, mn, -1);
    assert.strictEqual(dn.K, K);
    up.list.forEach((u, i) => {
      const d = dn.list[i];
      assert.strictEqual(!!u, !!d, nm + " " + mn + " 第 " + (i + 1) + " 條一邊有一邊沒有");
      if (!u) return;
      assert.deepStrictEqual([u.seed, u.n], [d.seed, d.n]);
      u.sim.forEach((b, j) => {
        const e = d.sim[j];
        assert.deepStrictEqual([e.t, e.v], [b.t, b.v], nm + " sim " + j);
        [[e.o, b.o], [e.h, b.l], [e.l, b.h], [e.c, b.c]].forEach(([y, x]) => assert.ok(Math.abs(y - (K - x)) < 1e-6, nm + " sim " + j + "：" + y + " vs K−" + x));
      });
      u.plan.forEach((x, j) => {
        const y = d.plan[j];
        assert.deepStrictEqual([y.kind, y.k, y.t], [x.kind, x.k, x.t]);
        if (x.p != null) assert.ok(Math.abs(y.p - (K - x.p)) < 1e-6, "價位鏡像");
        if (x.pnl != null) assert.ok(Math.abs(y.pnl - x.pnl) < 1e-6, "損益點數相同");
      });
    });
    const q = Math.pow(10, -(String(dn.tick).split(".")[1] || "").length);   // 均線顯示到跳動單位的小數位（2330＝整數），捨入差一個最小位
    up.lv.forEach((x, j) => { const y = dn.lv[j]; if (x.p != null && !/^(ATR|前 20)/.test(x.name)) assert.ok(Math.abs(y.p - (K - x.p)) <= q + 1e-9, nm + " " + x.name + "：" + y.p + " vs " + (K - x.p)); });
  }
});

t("算不出回 null：沒有成交量 → 沒有多方關鍵K → W 底那條 null；K 太少、週K → 四條都 null（不硬畫）", () => {
  const nv = NQ.map((b) => ({ ...b, v: 0 })), r = run(nv, CASES[0][2], [8, 13, 34], 1);
  assert.strictEqual(r.list[2], null, "W 底");
  assert.ok(r.lv.find((x) => x.k === "KK").p === null && !r.lv.some((x) => x.k === "V20"), "關鍵K 寫沒有、不列均量");
  for (const p of r.list) if (p) { assert.ok(!/量 ≥/.test(p.plan[0].cond), "沒有量就不寫量的條件"); assert.ok(p.sim.every((b) => b.v === 0)); }
  const few = run(NQ.slice(-60), CASES[0][2], [8, 13, 34], 1);
  assert.deepStrictEqual(few.list, [null, null, null, null]); assert.ok(few.why && few.names.length === 4);
  const w = S.scenarios(TW, { tf: "W", mkt: "tw", tz: "Asia/Taipei", ma: "sma", ma_n: [5, 10, 20], dir: 1 });
  assert.deepStrictEqual(w.list, [null, null, null, null]); assert.strictEqual(w.why, "劇本只支援 1H／4H／日K");
  // 前提不成立（長均線在反彈頂之上）→ 第一條 null，不用試 200 個種子
  const dbg = {};
  S.scenarios(TW, { tf: "D", mkt: "tw", tz: "Asia/Taipei", ma: "sma", ma_n: [20, 60, 120], dir: 1, dbg });
  if (dbg["ma:前提不成立"]) assert.strictEqual(dbg["ma:前提不成立"], 1);
});

t("時間軸：跳週末、休市、半日市（美股 13:00、美國期貨 13:15）、美國期貨週日 18:00 開、台股 12-25／元旦", () => {
  const day = (d, hs) => hs.map((h) => ({ t: d + " " + h }));
  const US1 = ["09:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30"];
  const us = [...day("2026-11-23", US1), ...day("2026-11-24", US1), ...day("2026-11-25", US1)];
  const a = S.futureTimes(us, "1H", "us", "America/New_York", 6);
  assert.deepStrictEqual(a.map((x) => x.t), ["2026-11-27 09:30", "2026-11-27 10:30", "2026-11-27 11:30", "2026-11-27 12:30", "2026-11-30 09:30", "2026-11-30 10:30"], "感恩節休市、隔天半日市");
  assert.strictEqual(a[3].f, 0.5, "12:30 那根只到 13:00"); assert.ok(a[0].note.includes("感恩節隔天") && a[0].open && !a[1].open && a[4].open);
  const tw = [{ t: "2026-12-23" }, { t: "2026-12-24" }];
  assert.deepStrictEqual(S.futureTimes(tw, "D", "tw", "Asia/Taipei", 5).map((x) => x.t), ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-04"], "12-25 行憲紀念日、元旦、週末");
  assert.deepStrictEqual(S.futureTimes([{ t: "2026-11-25" }], "D", "us", "America/New_York", 2).map((x) => x.t), ["2026-11-27", "2026-11-30"]);
  const F4 = ["18:00", "22:00", "02:00", "06:00", "10:00", "14:00"];
  const fut = [...day("2026-11-18", F4.slice(2)), ...day("2026-11-18", F4.slice(0, 2)), ...day("2026-11-19", F4.slice(2)), ...day("2026-11-19", F4.slice(0, 2)), ...day("2026-11-20", F4.slice(2))];
  assert.deepStrictEqual(S.futureTimes(fut, "4H", "fut", "America/New_York", 3).map((x) => x.t), ["2026-11-22 18:00", "2026-11-22 22:00", "2026-11-23 02:00"], "週五收盤 → 週日 18:00 開");
  const tg = [...fut, ...day("2026-11-22", F4.slice(0, 2)), ...day("2026-11-23", F4.slice(2)), ...day("2026-11-23", F4.slice(0, 2)), ...day("2026-11-24", F4.slice(2)), ...day("2026-11-24", F4.slice(0, 2)), ...day("2026-11-25", F4.slice(2))];
  const g = S.futureTimes(tg, "4H", "fut", "America/New_York", 7);
  assert.deepStrictEqual(g.map((x) => x.t), ["2026-11-26 18:00", "2026-11-26 22:00", "2026-11-27 02:00", "2026-11-27 06:00", "2026-11-27 10:00", "2026-11-29 18:00", "2026-11-29 22:00"],
    "感恩節那個交易日不排；隔天 13:15 收（14:00 那根不排）；週日 18:00 再開");
  assert.strictEqual(g[4].f, 195 / 240, "10:00 那根只到 13:15");
  const tw1 = [...day("2026-11-23", ["09:00", "10:00", "11:00", "12:00", "13:00"]), ...day("2026-11-24", ["09:00", "10:00", "11:00", "12:00", "13:00"])];
  const h = S.futureTimes(tw1, "1H", "tw", "Asia/Taipei", 6);
  assert.deepStrictEqual(h.map((x) => x.t), ["2026-11-25 09:00", "2026-11-25 10:00", "2026-11-25 11:00", "2026-11-25 12:00", "2026-11-25 13:00", "2026-11-26 09:00"]);
  assert.strictEqual(h[4].f, 1, "13:00 那根本來就只到 13:30");
  // 劇本裡的時間也照這個排
  const nq = all.find((x) => x[0] === "NQ 4H 8/13/34 空轉多")[5].list[0];
  assert.ok(nq.sim.every((b) => { const w = new Date(b.t.slice(0, 10) + "T00:00:00Z").getUTCDay(); return w !== 6 && (w !== 0 || b.t.slice(11) >= "18:00") && !(w === 5 && b.t.slice(11) >= "18:00"); }), "NQ 示意 K 沒有週末盤");
  assert.ok(nq.sim.every((b) => !b.t.startsWith("2026-11-26 02") && !b.t.startsWith("2026-11-27 14")), "感恩節");
});

t("不改輸入、不影響回測與五階段：算劇本前後 backtest／fiveStage 結果一模一樣", () => {
  const bars = NQ.map((b) => ({ ...b })), snap = JSON.stringify(bars);
  const h = { t: bars.map((b) => b.t), o: bars.map((b) => b.o), h: bars.map((b) => b.h), l: bars.map((b) => b.l), c: bars.map((b) => b.c), v: bars.map((b) => b.v) };
  const p = TT.normParams({ ma: "sma", ma_n: [8, 13, 34] }).p, lines = F5.smaLines(bars, p.ma_n);
  const bt0 = JSON.stringify(TT.backtest(h, bars.length, p)), f50 = JSON.stringify([F5.fiveStage(bars, lines, "s"), F5.fiveStage(bars, lines, "l")]);
  run(bars, CASES[0][2], p.ma_n, 1); run(bars, CASES[0][2], p.ma_n, -1);
  assert.strictEqual(JSON.stringify(bars), snap, "輸入沒被改");
  assert.strictEqual(JSON.stringify(TT.backtest(h, bars.length, p)), bt0, "回測");
  assert.strictEqual(JSON.stringify([F5.fiveStage(bars, lines, "s"), F5.fiveStage(bars, lines, "l")]), f50, "五階段");
});

t("效能：一次算四條（兩個方向、三組均線）每次 < 300ms", () => {
  const ms = [];
  for (const [nm, bars, o] of CASES) for (const mn of SETS) for (const dir of [1, -1]) {
    const t0 = process.hrtime.bigint(); run(bars, o, mn, dir); const d = Number(process.hrtime.bigint() - t0) / 1e6;
    ms.push(d); assert.ok(d < 300, nm + " " + mn + " " + dir + "：" + d.toFixed(0) + "ms");
  }
  console.log("     最慢 " + Math.max(...ms).toFixed(1) + "ms、平均 " + (ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(1) + "ms");
});

t("用字：劇本名稱、條件、價位由來不寫機率與操作用語", () => {
  const txt = JSON.stringify(all.map((x) => [x[5].names, x[5].lv, x[5].list.map((p) => p && p.plan)]));
  for (const w of ["建議", "應該", "最佳", "推薦", "機率", "%的", "停利", "2R", "加碼", "出一半", "保本"]) assert.ok(!txt.includes(w), w);
});

console.log(fails ? "FAILED " + fails : "all passed");
process.exit(fails ? 1 : 0);
