// 反彈五階段（空頭中的反彈→進空，side "s"）／修正五階段（多頭中的修正→進多，side "l"＝完全鏡像）。Yoda 11-24 定。
// 純函式，只吃已收完的 K、收盤判定。對照 Python 參考實作 five2.py run(bars, ma, side, exit)（＝five.py＋出場變體），黃金比對見 tests/ta_5stage.cjs。
// 不是交易訊號：不進左側面板、回測統計；只畫在 K 線圖上（app/ta/page.jsx）。
//   前提：前一根收盤在長均線 L 的反方向側、L 往反方向彎（空方：收盤 < L、L 下彎）
//   ① 收盤站上短 S、中 M（前一根沒同時站上）＝開始反彈；支撐＝這根最低。新①會作廢還沒到②的舊序列
//   ② 碰壓力（反彈方向最近的長均線 L 或之前 120 根前五大量 K 的最低；最高 ≥ 壓力×(1−0.5%)）、碰後 3 根內有一根量 ≥ 前 20 根均量 1.5 倍且收在壓力下，
//      之後第一根收破 S＝到頂；反彈頂＝①到這根的最高
//   ③ 收破 M 且 S 下彎；③前收盤破支撐＝作廢
//   ④ ③後最低回到支撐 ±0.5% 內、收盤守在支撐上＝回測支撐，防線＝這根最低（沒有④＝支撐）
//   ⑤ 收盤破防線＝進空（收盤價）。停損價＝反彈頂；⑤後第 2 根長黑（實體 ≥ 前 20 根平均 1.5 倍）起移到最近那根長黑最高，只往下
//   出場（r2 回測選 V2，11-24）：收盤越過停損價＝停；不然收盤站回 M＝利（同根都成立算停）
//   作廢：②前收盤站上 L 且 L 上彎、③前收盤破支撐、新①、①後 60 根沒到⑤（逾時）——作廢都不畫
// 數字算法照 CPython：sum() 是 Neumaier 補償加總（3.12 起），SMA＝每根重加一次 n 根；沒有量（null）不算進均量、不算大量K。
export const DELTA = 0.005, VOL_K = 1.5, BODY_K = 1.5, TIMEOUT = 60, KK_N = 120, KK_TOP = 5, AVG_N = 20;
export const EXITS = ["V0", "V1", "V2", "V3"], EXIT5 = "V2";
export const HIDE5 = ["void_premise", "void_reset", "void_break", "timeout"];

// CPython sum(list of float)：第一個直接加、之後 Neumaier，最後補回誤差
function pySum(a, i0, i1) {
  if (i1 <= i0) return 0;
  let f = a[i0], c = 0;
  for (let i = i0 + 1; i < i1; i++) {
    const x = a[i], t = f + x;
    c += Math.abs(f) >= Math.abs(x) ? f - t + x : x - t + f;
    f = t;
  }
  return c && Number.isFinite(c) ? f + c : f;
}
export function smaPy(C, n) {
  return C.map((_, i) => (i < n - 1 ? null : pySum(C, i - n + 1, i + 1) / n));
}
function avgPrev(X, k, n = AVG_N) {   // 前 n 根平均（不含當根，null 不算）；不足 n 根＝null
  if (k < n) return null;
  const xs = X.slice(k - n, k).filter((x) => x != null);
  return xs.length ? pySum(xs, 0, xs.length) / xs.length : null;
}
function bigK(V, k, n = KK_N, top = KK_TOP) {   // 同 ta-trade keyKEvents：第 k 根之前 n 根、量 > 0、量大的先（同量取較近）
  const js = [];
  for (let j = Math.max(0, k - n); j < k; j++) if (V[j] != null && V[j] > 0) js.push(j);
  js.sort((x, y) => V[y] - V[x] || y - x);
  return js.slice(0, top);
}
const ok = (...xs) => xs.every((x) => x != null && Number.isFinite(x));

// bars＝[{t,o,h,l,c,v}]（只放已收完的 K）；lines＝[S, M, L] 三條均線（同長度，缺值 null）；sd＝"s"｜"l"
// 回每條序列（含作廢）：s1..s5={i,p}、sup、def、top、touch={i,P,kind:"L"|"bigK",j,vol_i,vol_mult}、stops=[[i,價]]、ex={type:"profit"|"stop",i,p,pnl,pct}、status、end
export function fiveStageAll(bars, lines, sd, exit = EXIT5) {
  const s = sd === "l" ? -1 : 1, n = bars.length;
  const num = (f) => bars.map((b) => (b[f] == null || !Number.isFinite(Number(b[f])) ? null : Number(b[f])));
  const O = num("o"), H = num("h"), Lw = num("l"), C = num("c"), V = num("v");
  const [S, M, LL] = lines;
  const up = (a, b) => s * (a - b) > 0;
  const rx = (k) => (s === 1 ? H[k] : Lw[k]), ax = (k) => (s === 1 ? Lw[k] : H[k]);
  const body = C.map((c, k) => Math.abs(c - O[k]));
  const cross = (k) => k >= 1 && ok(S[k], M[k], S[k - 1], M[k - 1]) && up(C[k], S[k]) && up(C[k], M[k]) && !(up(C[k - 1], S[k - 1]) && up(C[k - 1], M[k - 1]));
  const premise = (k) => { const p = k - 1; return p >= 1 && ok(LL[p], LL[p - 1]) && up(LL[p], C[p]) && up(LL[p - 1], LL[p]); };
  const pressure = (k) => {
    let best = null;
    const cands = (LL[k] != null ? [[LL[k], "L", null]] : []).concat(bigK(V, k).map((j) => [ax(j), "bigK", j]));
    for (const c of cands) {
      if (!up(c[0], C[k])) continue;
      const d = s * (c[0] - C[k]);
      if (!best || d < best[3] || (d === best[3] && best[1] !== "L" && c[1] === "L")) best = [c[0], c[1], c[2], d];
    }
    return best;
  };
  const longBody = (k) => { const a = avgPrev(body, k); return a != null && s * (O[k] - C[k]) > 0 && body[k] >= BODY_K * a; };
  const take = { V0: cross, V1: () => false, V2: (k) => M[k] != null && up(C[k], M[k]), V3: (k) => LL[k] != null && up(C[k], LL[k]) }[exit];
  if (!take) throw new Error("exit " + exit);
  const seqs = [];
  let act = [];
  const drop = (q) => { act = act.filter((x) => x !== q); };
  for (let k = 0; k < n; k++) {
    for (const q of act.slice()) {
      let st = q.stage;
      if (st < 5) {
        if (k - q.s1.i > TIMEOUT) { q.status = "timeout"; q.end = q.s1.i + TIMEOUT; drop(q); continue; }
        if (st < 2 && ok(LL[k], LL[k - 1]) && up(C[k], LL[k]) && up(LL[k], LL[k - 1])) { q.status = "void_premise"; q.end = k; drop(q); continue; }
      }
      if (st === 1 && k > q.s1.i) {
        if (!q.touch) {
          const P = pressure(k);
          if (P && s * (rx(k) - P[0] * (1 - s * DELTA)) >= 0) q.pend.push({ i: k, P: P[0], kind: P[1], j: P[2] });
          for (const t of q.pend) {
            if (k - t.i > 3) continue;
            const a = avgPrev(V, k);
            if (a != null && V[k] != null && V[k] > 0 && V[k] >= VOL_K * a && up(t.P, C[k])) { q.touch = { ...t, vol_i: k, vol_mult: a ? V[k] / a : null }; break; }
          }
          q.pend = q.pend.filter((t) => k - t.i < 3);
        }
        const t = q.touch;
        if (t && k >= Math.max(t.i + 1, t.vol_i) && up(S[k], C[k])) {
          q.s2 = { i: k, p: C[k] };
          let top = rx(q.s1.i);
          for (let j = q.s1.i + 1; j <= k; j++) top = s === 1 ? Math.max(top, rx(j)) : Math.min(top, rx(j));
          q.top = top; q.stage = st = 2;
        }
      }
      if (st === 2 && ok(M[k], S[k], S[k - 1]) && up(M[k], C[k]) && up(S[k - 1], S[k])) { q.s3 = { i: k, p: C[k] }; q.stage = st = 3; }
      else if ((st === 1 || st === 2) && k > q.s1.i && up(q.sup, C[k])) { q.status = "void_break"; q.end = k; drop(q); continue; }
      if ((st === 3 || st === 4) && k > q.s3.i) {
        if (up(q.def, C[k])) { q.s5 = { i: k, p: C[k] }; q.stage = 5; q.stops = [[k, q.top]]; q.nlong = 0; continue; }
        if (st === 3 && Math.abs(ax(k) - q.sup) <= q.sup * DELTA && up(C[k], q.sup)) { q.s4 = { i: k, p: C[k] }; q.def = ax(k); q.stage = 4; }
      }
      if (st === 5 && k > q.s5.i) {
        const stop = q.stops[q.stops.length - 1][1];
        const typ = up(C[k], stop) ? "stop" : take(k) ? "profit" : null;
        if (typ) {
          const e = q.s5.p;
          q.ex = { type: typ, i: k, p: C[k], pnl: s * (e - C[k]), pct: (s * (e - C[k])) / e * 100 };
          q.status = "done"; q.end = k; drop(q); continue;
        }
        if (longBody(k)) {
          q.nlong += 1;
          if (q.nlong >= 2 && up(stop, rx(k))) q.stops.push([k, rx(k)]);
        }
      }
    }
    if (cross(k) && premise(k)) {
      for (const q of act.filter((x) => x.stage < 2)) { q.status = "void_reset"; q.end = k; drop(q); }
      const q = { side: sd, stage: 1, s1: { i: k, p: C[k] }, sup: ax(k), def: ax(k), pend: [], touch: null, s2: null, s3: null, s4: null, s5: null, top: null, stops: null, ex: null, status: null, end: null };
      seqs.push(q); act.push(q);
    }
  }
  for (const q of act) q.status = q.stage === 5 ? "open" : "wait" + (q.stage + 1);
  for (const q of seqs) { delete q.stage; delete q.pend; delete q.nlong; }
  return seqs;
}
// 圖上用：作廢（含逾時）不畫
export const fiveStage = (bars, lines, sd, exit = EXIT5) => fiveStageAll(bars, lines, sd, exit).filter((q) => !HIDE5.includes(q.status));
export const smaLines = (bars, ma) => { const C = bars.map((b) => Number(b.c)); return ma.map((m) => smaPy(C, m)); };

// ───────── 共振（只做空方，Yoda 11-24）：兩組同方向、同階段 w 根內都成立 ─────────
const KEYS5 = [1, 2, 3, 4, 5];
export const exKey5 = (q) => (q.ex ? (q.ex.type === "profit" ? "x" : "stop") : null);
export function events5(res) {   // → [[side, key, i]]；key＝1～5、"x"（利）、"stop"（停）
  const out = [];
  for (const q of res) {
    if (HIDE5.includes(q.status)) continue;
    for (const k of KEYS5) if (q["s" + k]) out.push([q.side, k, q["s" + k].i]);
    if (q.ex) out.push([q.side, exKey5(q), q.ex.i]);
  }
  return out;
}
// 每個 A 事件配最近的 B 事件（同距取較早）→ [{side, key, iA, iB, late}]
export function coincide5(resA, resB, w = 3) {
  const eb = events5(resB), out = [];
  for (const [sd, key, ia] of events5(resA)) {
    let ib = null;
    for (const [s2, k2, j] of eb) if (s2 === sd && k2 === key && Math.abs(j - ia) <= w && (ib == null || Math.abs(j - ia) < Math.abs(ib - ia) || (Math.abs(j - ia) === Math.abs(ib - ia) && j < ib))) ib = j;
    if (ib != null) out.push({ side: sd, key, iA: ia, iB: ib, late: Math.max(ia, ib) });
  }
  return out;
}
export const CO5_SETS = [[5, 10, 20], [8, 13, 34]];
export function co5Short(bars) {   // 背景另算 5/10/20 與 8/13/34 的反彈五階段（SMA）
  const [A, B] = CO5_SETS.map((ma) => fiveStageAll(bars, smaLines(bars, ma), "s"));
  return coincide5(A, B);
}

// ───────── 浮動說明（bars＝整段 K，含 t；時間照引擎給的商品當地時間）；nm＝三條均線名稱 ─────────
const SD5 = { s: { nm: "反彈五階段", pre: "彈", sup: "支撐", top: "反彈頂" }, l: { nm: "修正五階段", pre: "修", sup: "壓力", top: "修正底" } };
const KS = [1, 2, 3, 4, 5, "x", "stop"];
export const step5Name = (sd, k) => SD5[sd].pre + (k === "x" ? "利" : k === "stop" ? "停" : k);
export const ev5 = (q, k) => (typeof k === "number" ? q["s" + k] : exKey5(q) === k ? q.ex : null);
const fp = (x) => (x == null || !Number.isFinite(Number(x)) ? "—" : Number(x).toLocaleString("en-US", { maximumFractionDigits: 2 }));
const sgn = (x) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pnl5 = (ex) => sgn(ex.pnl) + " 點（" + sgn(ex.pct) + "%）";
const pctd = (x, r) => { const d = (x / r - 1) * 100; return (d >= 0 ? "+" : "−") + Math.abs(d).toFixed(2) + "%"; };
const md = (t) => String(t || "").slice(5);
const stopAt = (q, i) => { let p = q.stops[0][1]; for (const [j, v] of q.stops) if (j < i) p = v; return p; };
export function status5(sd, q) {
  const N = (k) => step5Name(sd, k);
  return { wait2: N(1) + " 後等" + N(2), wait3: N(2) + " 後等" + N(3), wait4: N(3) + " 後等" + N(4) + "／" + N(5), wait5: N(4) + " 後等" + N(5), open: N(5) + " 後持有中" }[q.status] || "";
}
// 某一階段 → {title, sub, rows, status, cls}；k＝1～5、"x"、"stop"；lines＝[S,M,L]、nm＝["SMA5","SMA10","SMA20"]；co＝共振說明列（可缺）
export function info5(sd, q, k, bars, lines, nm, co) {
  const sh = sd === "s", S = SD5[sd], e = ev5(q, k), i = e.i, b = bars[i], [mS, mM, mL] = lines, [nS, nM, nL] = nm;
  const on = sh ? "站上" : "跌破", off = sh ? "跌破" : "站上", rows = [];
  if (k === 1) {
    rows.push(["價位", "收盤 " + fp(b.c) + "；" + S.sup + " " + fp(q.sup) + "（這根" + (sh ? "最低" : "最高") + "）"]);
    rows.push(["條件", "收盤 " + on + " " + nS + " " + fp(mS[i]) + "、" + nM + " " + fp(mM[i]) + "（前一根沒同時" + on + "）；前一根收盤 " + fp(bars[i - 1].c) + " 在 " + nL + " " + fp(mL[i - 1]) + (sh ? " 下、" : " 上、") + nL + (sh ? "下彎" : "上彎")]);
  } else if (k === 2) {
    const t = q.touch, x = sh ? bars[t.i].h : bars[t.i].l;
    const pn = t.kind === "L" ? nL + " " + fp(t.P) : "大量K " + md(bars[t.j].t) + (sh ? " 最低 " : " 最高 ") + fp(t.P);
    rows.push(["價位", "收盤 " + fp(b.c) + "；" + S.top + " " + fp(q.top)]);
    rows.push(["條件", md(bars[t.i].t) + (sh ? " 最高 " : " 最低 ") + fp(x) + " 碰到" + (sh ? "壓力 " : "支撐 ") + pn + "（" + pctd(x, t.P) + "）、量 " + (t.vol_mult ? t.vol_mult.toFixed(2) : "—") + " 倍（" + md(bars[t.vol_i].t) + "，前 20 根均量）收在" + (sh ? "下" : "上") + "；這根收盤" + off + " " + nS + " " + fp(mS[i])]);
  } else if (k === 3) {
    rows.push(["價位", "收盤 " + fp(b.c)]);
    rows.push(["條件", "收盤" + off + " " + nM + " " + fp(mM[i]) + "，" + nS + (sh ? "下彎" : "上彎") + "（" + fp(mS[i - 1]) + "→" + fp(mS[i]) + "）"]);
  } else if (k === 4) {
    const x = sh ? b.l : b.h;
    rows.push(["價位", "防線 " + fp(q.def) + "（這根" + (sh ? "最低" : "最高") + "）"]);
    rows.push(["條件", (sh ? "最低 " : "最高 ") + fp(x) + " 回測" + S.sup + " " + fp(q.sup) + "（" + pctd(x, q.sup) + "，±0.5% 內），收盤 " + fp(b.c) + (sh ? " 守在上" : " 壓在下")]);
  } else if (k === 5) {
    rows.push(["價位", "收盤 " + fp(b.c) + "（" + (sh ? "進空" : "進多") + "）"]);
    rows.push(["條件", "收盤" + (sh ? "跌破" : "突破") + "防線 " + fp(q.def) + "（" + (q.s4 ? step5Name(sd, 4) + (sh ? "最低" : "最高") : "沒有" + step5Name(sd, 4) + "，用" + S.sup) + "）"]);
    rows.push(["停損", q.stops.map(([j, p]) => fp(p) + "（" + (j === q.s5.i ? S.top : md(bars[j].t) + (sh ? " 長黑最高" : " 長紅最低")) + "）").join(" → ")]);
    if (q.ex) rows.push(["出場", step5Name(sd, exKey5(q)) + " " + md(bars[q.ex.i].t) + "，" + pnl5(q.ex)]);
  } else if (k === "x") {
    rows.push(["出場", "獲利出場"]);
    rows.push(["條件", "收盤 " + fp(b.c) + (sh ? " 站回 " : " 跌回 ") + nM + " " + fp(mM[i])]);
  } else {
    rows.push(["出場", "停損"]);
    rows.push(["條件", "收盤 " + fp(b.c) + " " + on + "停損 " + fp(stopAt(q, i))]);
  }
  if (k === "x" || k === "stop") rows.push(["損益", pnl5(q.ex) + "，" + step5Name(sd, 5) + " " + md(bars[q.s5.i].t) + " 進場 " + fp(q.s5.p)]);
  if (co) rows.push(["共振", co]);
  rows.push(["序列", KS.filter((j) => ev5(q, j)).map((j) => step5Name(sd, j) + " " + md(bars[ev5(q, j).i].t)).join(" → ")]);
  return { title: S.nm + " " + step5Name(sd, k), sub: String(b.t), rows, status: status5(sd, q), cls: sd + k };
}
// 支撐／防線／停損線 → {title, sub, rows, status, cls}；kind＝"sup"｜"def"｜"stop"
export function line5Info(sd, q, kind, bars) {
  const sh = sd === "s", S = SD5[sd], rows = [];
  if (kind === "sup" || kind === "def") {
    const src = kind === "sup" ? q.s1 : q.s4;
    rows.push(["來源", step5Name(sd, kind === "sup" ? 1 : 4) + " " + md(bars[src.i].t) + " 那根" + (sh ? "最低" : "最高")]);
    rows.push(["結束", q.s5 ? step5Name(sd, 5) + " " + md(bars[q.s5.i].t) + " 收盤 " + fp(q.s5.p) : "還沒" + (sh ? "跌破" : "突破") + "（" + status5(sd, q) + "）"]);
    return { title: (kind === "sup" ? S.sup : "防線") + " " + fp(kind === "sup" ? q.sup : q.def), sub: bars[src.i].t + " 起", rows, status: "", cls: sd + (kind === "sup" ? 1 : 4) };
  }
  rows.push(["歷程", q.stops.map(([j, p]) => md(bars[j].t) + " " + fp(p)).join(" → ")]);
  rows.push(["規則", "進場時＝" + S.top + "；進場後第 2 根" + (sh ? "長黑起改成那根最高，只往下移" : "長紅起改成那根最低，只往上移")]);
  if (q.ex) rows.push(["出場", step5Name(sd, exKey5(q)) + " " + md(bars[q.ex.i].t) + "，" + pnl5(q.ex)]);
  return { title: "停損 " + fp(q.stops[q.stops.length - 1][1]), sub: bars[q.s5.i].t + " 起", rows, status: q.ex ? "" : status5(sd, q), cls: sd + "stop" };
}
