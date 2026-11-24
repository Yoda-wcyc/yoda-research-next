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

t("NQ 4H 中均線（demo 那份資料，11-24 稽核加距離上限後）：空轉多 ①② 算得出、③ 卡報酬風險、④ 近期低點太遠；多轉空四條都卡距離；全部情境過半算得出", () => {
  assert.ok(all.filter((x) => x[5].list.some(Boolean)).length >= all.length * 0.6, "算得出的情境太少");
  const up = all.find((x) => x[0] === "NQ 4H 8/13/34 空轉多")[5], dn = all.find((x) => x[0] === "NQ 4H 8/13/34 多轉空")[5];
  assert.deepStrictEqual(up.list.map(Boolean), [true, true, false, false]);
  assert.strictEqual(up.nos[2], "停損 25,826.5（6.0%）比出場1 遠太多");
  assert.strictEqual(up.nos[3], "近期波段低 24,976.5 離現價 26,734.25 有 3.7 ATR，太遠");
  assert.deepStrictEqual(dn.list.map(Boolean), [false, false, false, false]);
  assert.deepStrictEqual(dn.nos, ["回落底 24,976.5 離現價 26,734.25 有 3.7 ATR，太遠", "回落底 24,976.5 離現價 26,734.25 有 3.7 ATR，太遠",
    "空方關鍵K 價位 28,583.75 離現價 26,734.25 有 3.9 ATR，太遠", "近期波段高 28,697 離現價 26,734.25 有 4.1 ATR，太遠"]);
});

t("四條路徑 OHLC 合法、對齊跳動單位、量 ≥ 0、根數在 1H 60～70／4H 50～60／日K 25～40（11-24 加長）；時間接在最後一根之後、不重複", () => {
  const rngN = { "4H": [50, 60], D: [25, 40] };
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
  assert.ok(all.some(([, , o, , , r]) => o.tf === "D" && r.list.some((p) => p && p.sim.length > 25)), "日K 示意段有超過 25 根的");
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

t("算不出回 null：沒有成交量的 1H → 沒有多方關鍵K → W 底那條 null；K 太少、週K → 四條都 null（不硬畫）", () => {
  const nv = NQ.map((b) => ({ ...b, v: 0 })), r = run(nv, { ...CASES[0][2], tf: "1H" }, [8, 13, 34], 1);
  assert.strictEqual(r.list[2], null, "W 底");
  assert.ok(r.lv.find((x) => x.k === "KK").p === null && !r.lv.some((x) => x.k === "V20"), "關鍵K 寫沒有、不列均量");
  assert.strictEqual(r.nos[2], "這檔沒有成交量，1H 認不出關鍵K", "沒量的 1H 不寫等出現、不寫放量");
  assert.strictEqual(r.lv.find((x) => x.k === "KK").why, "這檔沒有成交量，1H 認不出關鍵K", "關鍵K 列跟原因句同口徑");
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

// 另寫一份關鍵K（canonical＝空轉多；多轉空用翻轉資料）：先找放量長紅，全部找不到才退到實體 ≥ 1.3 ATR 長紅（1H 不退）；缺量那根不算
function kkRef(bars, tf) {
  const b = bars.map((x) => ({ ...x, v: x.v == null ? null : +x.v })), N = b.length, lb = Math.min({ "1H": 120, "4H": 60, D: 60 }[tf], N - 21);
  const tr = (i) => Math.max(b[i].h, b[i - 1].c) - Math.min(b[i].l, b[i - 1].c), atr = (i) => { let s = 0; for (let j = i - 19; j <= i; j++) s += tr(j); return s / 20; };
  const va = (i) => { const xs = b.slice(i - 20, i).map((x) => x.v).filter((x) => x != null); return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0; };
  let iL = N - lb; for (let i = N - lb; i < N; i++) if (b[i].l < b[iL].l) iL = i;
  const hv = va(N) > 0, ok = (i) => i >= 21 && b[i].c > b[i].o && !(hv && b[i].v == null);
  for (let i = iL + 1; i < N; i++) if (ok(i) && hv && b[i].v >= 1.5 * va(i) && b[i].c - b[i].o >= atr(i - 1)) return { p: b[i].l, soft: false };
  if (tf !== "1H") for (let i = iL + 1; i < N; i++) if (ok(i) && b[i].c - b[i].o >= 1.3 * atr(i - 1)) return { p: b[i].l, soft: true };
  return null;
}
const flipOf = (bars) => { const K = S.mirrorK(bars, S.tickOf(bars)); return bars.map((b) => ({ t: b.t, o: K - b.o, h: K - b.l, l: K - b.h, c: K - b.c, v: b.v })); };
const kkRow = (r) => r.lv.find((x) => x.k === "KK");
t("關鍵K 退路：有放量長紅就用它（不被退路換掉）；全部找不到才取實體 ≥ 1.3 ATR 長紅、標「量沒放大」；1H 不退", () => {
  const flat = NQ.map((b) => ({ ...b, v: 1000 }));   // 量全一樣＝沒有放量那根
  const cases = [...CASES, ["NQ 4H 平量", flat, CASES[0][2]], ["NQ 平量當 1H", flat, { ...CASES[0][2], tf: "1H" }]];
  let soft = 0, strict = 0;
  for (const [nm, bars, o] of cases) for (const dir of [1, -1]) {
    const r = run(bars, o, [8, 13, 34], dir), kk = kkRow(r), ref = kkRef(dir === 1 ? bars : flipOf(bars), o.tf);
    const lab = dir === 1 ? "長紅、量沒放大" : "長黑、量沒放大";
    if (!ref) { assert.strictEqual(kk.p, null, nm + " " + dir + " 應該沒有關鍵K"); continue; }
    const want = dir === 1 ? ref.p : r.K - ref.p;
    assert.ok(Math.abs(kk.p - want) < 1e-6, nm + " " + dir + " 關鍵K " + kk.p + " vs " + want);
    if (ref.soft) { soft++; assert.ok(kk.name.includes(lab) && kk.why.includes(lab) && !kk.why.includes("第一根放量"), nm + " 退路標示：" + kk.name + "／" + kk.why); }
    else { strict++; assert.ok(!kk.name.includes("量沒放大") && kk.why.includes("第一根放量"), nm + " 原條件標示：" + kk.why); }
    if (o.tf === "1H") assert.ok(!ref.soft && !kk.name.includes("量沒放大"), "1H 不用退路");
  }
  assert.ok(soft >= 2 && strict >= 2, "兩種都有測到 soft=" + soft + " strict=" + strict);
  // 原本就有放量長紅的（NQ 4H、2330 日K 多轉空）關鍵K 不變
  assert.strictEqual(kkRow(run(NQ, CASES[0][2], [8, 13, 34], 1)).p, 25824);
  assert.strictEqual(kkRow(run(TW, CASES[1][2], [8, 13, 34], -1)).p, 2320);
  // 平量 1H：沒有關鍵K、W 底算不出、原因講放量長紅
  const h = run(flat, { ...CASES[0][2], tf: "1H" }, [8, 13, 34], 1);
  assert.strictEqual(kkRow(h).p, null); assert.strictEqual(h.list[2], null); assert.ok(/放量長紅/.test(h.nos[2]), h.nos[2]);
});

t("算不出時回原因句：每條 null 都有一句、算得出＝null；長均線在反彈頂之上、沒有關鍵K、種子全沒過各有固定句型", () => {
  for (const [nm, , , , , r] of all) r.list.forEach((p, i) => {
    if (p) assert.strictEqual(r.nos[i], null, nm); else assert.ok(typeof r.nos[i] === "string" && r.nos[i].length > 8, nm + " 第 " + (i + 1) + " 條沒有原因");
  });
  const tw = run(TW, CASES[1][2], [20, 60, 120], 1);
  assert.ok(/^SMA120 [\d,.]+ 在反彈頂 [\d,.]+ 之上（均線糾結），要先站回 SMA120 才有回踩劇本$/.test(tw.nos[0]), tw.nos[0]);
  assert.strictEqual(tw.nos[2], "低點後還沒有長紅 K（量 ≥1.5 倍且實體 ≥1 ATR，或實體 ≥1.3 ATR），等出現再看");
  assert.ok(/^這段資料走不出這個劇本的路徑（最常卡在：.+）$/.test(tw.nos[1]) && !/[a-z]{3}|前提/.test(tw.nos[1]), tw.nos[1]);
  const seedNo = all.flatMap((x) => x[5].nos).filter((x) => x && x.startsWith("這段"));   // 種子全沒過的句型
  assert.ok(seedNo.length && seedNo.every((x) => /^這段資料走不出這個劇本的路徑（最常卡在：.+）$/.test(x) && !/[a-z]{3}|前提/.test(x)), seedNo.join("｜"));
  const few = run(NQ.slice(-60), CASES[0][2], [8, 13, 34], 1);
  assert.deepStrictEqual(few.nos, Array(4).fill("K 線不足 80 根"));
});

t("缺量 K（Yahoo 期貨最後一根 None）：不進均量、不當關鍵K候選", () => {
  const o = CASES[1][2], tk = S.tickOf(TW), A = run(TW, o, [8, 13, 34], 1).A, N = TW.length;
  const pc = TW[N - 2].c, cc = Math.round((pc + 3 * A) / tk) * tk;
  const big = TW.map((b, i) => (i === N - 1 ? { ...b, o: pc, l: pc, c: cc, h: cc, v: 10 * TW[N - 2].v } : b));
  assert.strictEqual(kkRow(run(big, o, [8, 13, 34], 1)).p, pc, "有量時最後一根是放量長紅");
  const nul = big.map((b, i) => (i === N - 1 ? { ...b, v: null } : b)), r = run(nul, o, [8, 13, 34], 1);
  // 11-24 稽核（ES1! 日K）：退路本來就不看量 → 缺量那根實體 ≥ 1.3 ATR 照當關鍵K，標「資料源還沒給量」
  assert.strictEqual(kkRow(r).p, pc, "缺量長紅走退路");
  assert.ok(kkRow(r).name.includes("長紅、資料源還沒給量") && kkRow(r).why.includes("資料源還沒給量") && !kkRow(r).why.includes("量 —"), kkRow(r).name + "／" + kkRow(r).why);
  // 缺量那根實體只有 1.1 ATR（要看量才算）→ 沒有關鍵K，原因寫「那根資料源還沒給量」、不寫「沒有長紅」
  const c11 = Math.round((pc + 1.1 * A) / tk) * tk, mid = TW.map((b, i) => (i === N - 1 ? { ...b, o: pc, l: pc, c: c11, h: c11, v: null } : b)), rm = run(mid, o, [8, 13, 34], 1);
  assert.strictEqual(kkRow(rm).p, null);
  assert.strictEqual(rm.nos[2], "低點後的長紅 K（" + TW[N - 1].t.slice(5) + "）那根資料源還沒給量，等量出來再看");
  assert.ok(kkRow(rm).why.includes("資料源還沒給量") && !/^低點後沒有放量/.test(kkRow(rm).why), kkRow(rm).why);
  assert.ok(!kkRow(run(mid.map((b, i) => (i === N - 1 ? { ...b, v: 10 * TW[N - 2].v } : b)), o, [8, 13, 34], 1)).name.includes("資料源"), "有量時不寫資料源");
  const xs = TW.slice(N - 20, N - 1).map((b) => b.v), avg = xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.strictEqual(r.lv.find((x) => x.k === "V20").p, Math.round(avg), "前 20 根均量只算 19 根有量的");
  for (const p of r.list) if (p) assert.ok(p.sim.every((b) => Number.isInteger(b.v) && b.v > 0), "示意 K 的量照樣有");
  // 關鍵K 之後收盤跌破它的低點 → 原因句寫「已跌破」，不寫「離現價不到 0.3 ATR」
  const t1 = new Date(Date.parse(TW[N - 1].t) + 3 * 864e5).toISOString().slice(0, 10);
  const brk = [...big, { t: t1, o: cc, h: cc, l: pc - tk, c: pc - tk, v: TW[N - 2].v }], rb = run(brk, o, [8, 13, 34], 1);
  assert.strictEqual(kkRow(rb).p, pc); assert.strictEqual(rb.list[2], null);
  assert.ok(/^現價 [\d,.]+ 已跌破多方關鍵K低點 [\d,.]+，沒有回測的空間$/.test(rb.nos[2]), rb.nos[2]);
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

// ───── 11-24 稽核（標普／SOX）每條規則一條測試：兩份資料往前切幾段 × 三組均線 × 兩個方向，規則對每條算得出的劇本都成立 ─────
const VAR = [];
for (const [nm, bars, o] of CASES) for (const cut of [0, 20, 60, 80, 100, 150]) for (const mn of SETS) for (const dir of [1, -1]) {
  const b = cut ? bars.slice(0, -cut) : bars;
  VAR.push([nm + " −" + cut + " " + mn.join("/") + " " + dir, b, o, mn, dir, run(b, o, mn, dir)]);
}
const LV = (r) => Object.fromEntries(r.lv.map((x) => [x.k, x.p]));
const ROW = (p) => Object.fromEntries(p.plan.map((x) => [x.kind, x]));
t("距離上限 3 ATR：進場前要先走到的關鍵價（① 反彈頂、長均線；② 反彈頂；③ 關鍵K；④ 近期低點）離現價超過就不畫，原因句「X 離現價 Y 有 Z ATR，太遠」", () => {
  let far = 0, drawn = 0;
  for (const [nm, b, , , s, r] of VAR) {
    const L = LV(r), C0 = b[b.length - 1].c, d = (x) => (s * x) / r.A;
    const key = [Math.max(d(L.T - C0), d(C0 - L.M2)), d(L.T - C0), L.KK == null ? 0 : d(C0 - L.KK), d(C0 - L.LOW)];
    r.list.forEach((p, i) => {
      if (p) { drawn++; assert.ok(key[i] <= 3.01, nm + " 第 " + (i + 1) + " 條要先走 " + key[i].toFixed(2) + " ATR"); return; }
      if (/離現價 [\d,.]+ 有 [\d.]+ ATR，太遠$/.test(r.nos[i])) { far++; assert.ok(key[i] > 2.99, nm + " " + r.nos[i]); }
    });
  }
  assert.ok(far >= 10 && drawn >= 30, "far=" + far + " drawn=" + drawn);
  // ③ 關鍵K 太遠（2330 日K 多轉空：空方關鍵K 在現價上方 3.5 ATR）
  const tw = run(TW, CASES[1][2], [8, 13, 34], -1);
  assert.strictEqual(tw.list[2], null); assert.ok(/^空方關鍵K 價位 2,320 離現價 2,030 有 3\.\d ATR，太遠$/.test(tw.nos[2]), tw.nos[2]);
  // 1H 的 ② 也用同一個 3 ATR（舊的 n×0.25 根放寬到十幾 ATR）
  const h = run(NQ, { ...CASES[0][2], tf: "1H" }, [8, 13, 34], -1);
  assert.strictEqual(h.list[1], null); assert.ok(/^回落底 24,976\.5 離現價 26,734\.25 有 3\.7 ATR，太遠$/.test(h.nos[1]), h.nos[1]);
});

t("上方壓力（下方支撐）離進場超過 4 ATR → 出場1 改取進場 ± 3 ATR，由來寫「太遠」；算得出的出場1 都在進場 4 ATR 內", () => {
  const b = TW.slice(0, -60), r = run(b, CASES[1][2], [8, 13, 34], -1), L = LV(r), R = r.lv.find((x) => x.k === "RES");
  assert.ok(/^支撐 [\d,.]+（\d\d-\d\d 大量 K）太遠（[\d.]+ ATR），出場1 改取進場 − 3 ATR$/.test(R.why), R.why);
  assert.ok(Math.abs(R.p - (L.T - 3 * r.A)) <= r.tick + 0.01, R.p + " vs " + (L.T - 3 * r.A));
  let sp = 0;
  for (const [nm, , , , s, r2] of VAR) for (const p of r2.list) {
    if (!p) continue;
    const g = ROW(p);
    if (p.id === "spring" && /太遠）$/.test(g.ex1.cond)) {   // ④ 出場1＝反彈頂，太遠也改取進場 ± 3 ATR
      sp++; assert.ok(Math.abs(g.ex1.level - (g.entry.level + s * 3 * r2.A)) <= r2.tick + 0.01, nm + " ④ 出場1 " + g.ex1.level);
      assert.ok(/^最[高低]價觸及進場 [+−] 3 ATR [\d,.]+（(反彈頂|回落底) [\d,.]+ 太遠）$/.test(g.ex1.cond), g.ex1.cond);
    }
    assert.ok((s * (g.ex1.p - g.entry.p)) / r2.A <= 4.01, nm + " " + p.name + " 出場1 離進場 " + ((s * (g.ex1.p - g.entry.p)) / r2.A).toFixed(2) + " ATR");
  }
  assert.ok(sp >= 1, "沒測到 ④ 出場1 太遠");
});

t("報酬風險：出場1 距離 ≥ 0.5 × 停損距離；種子全部只卡這條＝不畫，原因句「停損 X（Z%）比出場1 遠太多」", () => {
  let rr = 0;
  for (const [nm, , , , s, r] of VAR) r.list.forEach((p, i) => {
    if (!p) { if (/比出場1/.test(r.nos[i])) { rr++; assert.ok(/^停損 [\d,.]+（\d+\.\d%）比出場1 遠太多$/.test(r.nos[i]), r.nos[i]); } return; }
    const g = ROW(p), x1 = s * (g.ex1.p - g.entry.p), st = s * (g.entry.p - g.stop.level);
    assert.ok(x1 >= 0.5 * st - r.tick, nm + " " + p.name + " 出場1 " + x1 + " < 0.5 × 停損 " + st);
  });
  assert.ok(rr >= 3, "rr=" + rr);
});

t("① 前提原因句的排列照三條均線實際大小（空頭排列／多頭排列／均線糾結）", () => {
  const seen = new Set();
  for (const [nm, b, , mn, s, r] of VAR) {
    if (!/才有(回踩|反彈測)劇本$/.test(r.nos[0] || "")) continue;
    const M = TT.maLines(b.map((x) => x.c), { ma: "sma", ma_n: mn }).map((x) => x[b.length - 1]);
    const w = M[0] < M[1] && M[1] < M[2] ? "空頭排列" : M[0] > M[1] && M[1] > M[2] ? "多頭排列" : "均線糾結";
    assert.ok(r.nos[0].includes("（" + w + "）"), nm + "：" + M.map((x) => x.toFixed(1)) + " → " + r.nos[0]);
    seen.add(w);
  }
  assert.ok(seen.has("均線糾結") && seen.size >= 2, [...seen].join());
});

t("無量商品：原因句、關鍵K 列不寫「放量／量放大」，寫「長紅（實體 ≥1.3 ATR）」；有量商品括號寫齊「量 ≥1.5 倍且實體 ≥1 ATR，或實體 ≥1.3 ATR」", () => {
  let n0 = 0;
  for (const [nm, bars, o] of CASES) for (const tf of o.tf === "4H" ? ["4H", "1H"] : [o.tf]) for (const dir of [1, -1]) for (const cut of [0, 60, 100]) {   // 日K 資料沒有時刻、不能當 1H
    const nv = bars.slice(0, bars.length - cut).map((b) => ({ ...b, v: 0 })), r = run(nv, { ...o, tf }, [8, 13, 34], dir), kk = kkRow(r);
    const txt = [kk.name, kk.why, ...r.nos.filter(Boolean)].join("｜");
    assert.ok(!/放量|量放大|量 ≥/.test(txt), nm + " " + tf + " " + dir + "：" + txt);
    if (tf !== "1H" && kk.p == null) { n0++; assert.ok(kk.why.endsWith("（實體 ≥ 1.3 ATR）") && r.nos[2].endsWith("K（實體 ≥1.3 ATR），等出現再看"), kk.why + "／" + r.nos[2]); }
    if (tf !== "1H" && kk.p != null) assert.ok(kk.why.startsWith("這檔沒有成交量，取"), kk.why);
  }
  assert.ok(n0 >= 1, "沒有測到無量、無關鍵K 的情形");
  for (const [, , , , , r] of VAR) if (/還沒有長[紅黑] K（/.test(r.nos[2] || "") && !/1H/.test(r.nos[2])) assert.ok(r.nos[2].includes("（量 ≥1.5 倍且實體 ≥1 ATR，或實體 ≥1.3 ATR）"), r.nos[2]);
});

t("④ 進場那根不寫量倍數（站回不看量）；①②③ 進場照寫（量是條件）", () => {
  const ids = new Set();
  for (const [nm, , , , , r] of VAR) for (const p of r.list) {
    if (!p) continue;
    ids.add(p.id);
    if (p.id === "spring") assert.strictEqual(p.plan[0].vmul, undefined, nm + " ④ 進場寫了量");
    else assert.ok(typeof p.plan[0].vmul === "number" && p.plan[0].vmul >= 1.5, nm + " " + p.id + " 進場量");
  }
  assert.ok(ids.has("spring") && ids.size >= 3, [...ids].join());
});

t("用字：劇本名稱、條件、價位由來、算不出的原因不寫機率與操作用語", () => {
  const txt = JSON.stringify(all.map((x) => [x[5].names, x[5].lv, x[5].nos, x[5].list.map((p) => p && p.plan)]));
  for (const w of ["建議", "應該", "最佳", "推薦", "機率", "%的", "停利", "2R", "加碼", "出一半", "保本"]) assert.ok(!txt.includes(w), w);
});

console.log(fails ? "FAILED " + fails : "all passed");
process.exit(fails ? 1 : 0);
