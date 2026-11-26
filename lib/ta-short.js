// /ta「選擇權 → 作空試算」子分頁（2026-11-26 Yoda）：三種買賣權結構（長天期價外賣權／賣權價差／短天期滾動）的成本、情境損益、試算最大虧損
// 純函式（tests/ta_short.cjs）；公式照 demo\ta_選擇權作空試算_demo.html 搬，數字對拍同一組輸入。
// 這個子分頁 Yoda 11-26 定「自己要看、規則放寬」：可以有價差、Theta、轉倉。原本的選擇權試算（lib/ta-opt.js）不動。

// 標準常態累積分配（Abramowitz–Stegun 26.2.17，誤差 < 7.5e-8；跟 demo 同一式，對拍數字才一致）
export function N(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
// 歐式賣權：股票／指數用 Black-Scholes（沒放股利），期貨選擇權用 Black-76；到期、IV 0、價格 0 ＝內含價值
export function bsPut(S, K, T, v, r) {
  if (T <= 0 || v <= 0 || S <= 0) return Math.max(K - S, 0);
  const sq = v * Math.sqrt(T), d1 = (Math.log(S / K) + (r + v * v / 2) * T) / sq, d2 = d1 - sq;
  return K * Math.exp(-r * T) * N(-d2) - S * N(-d1);
}
export function b76Put(F, K, T, v, r) {
  if (T <= 0 || v <= 0 || F <= 0) return Math.max(K - F, 0);
  const sq = v * Math.sqrt(T), d1 = (Math.log(F / K) + v * v / 2 * T) / sq, d2 = d1 - sq;
  return Math.exp(-r * T) * (K * N(-d2) - F * N(-d1));
}
export const putPrice = (fut, S, K, T, v, r) => (fut ? b76Put(S, K, T, v, r) : bsPut(S, K, T, v, r));
// 賣權 Delta（標的漲 1 元、賣權價值變多少；負數）
export function putDelta(fut, S, K, T, v, r) {
  if (T <= 0 || v <= 0 || S <= 0) return S < K ? -1 : 0;
  const d1 = (Math.log(S / K) + ((fut ? 0 : r) + v * v / 2) * T) / (v * Math.sqrt(T));
  return fut ? -Math.exp(-r * T) * N(-d1) : N(d1) - 1;
}

// IV 隨跌幅上升：d＝跌幅（0.2＝跌 20%）；跌 20% 加 a、跌 50% 加 b（小數），中間直線內插、超過 50% 照同斜率外推；不跌不加
export function ivUp(d, a, b) {
  if (!(d > 0)) return 0;
  return d <= 0.2 ? (a * d) / 0.2 : a + ((b - a) * (d - 0.2)) / 0.3;
}

export const SCEN = [{ H: 182.5, D: 0.2 }, { H: 365, D: 0.35 }, { H: 365, D: 0.5 }, { H: 0 }];   // 6 個月跌 20%／12 個月跌 35%／腰斬／沒崩
export const XS = Array.from({ length: 61 }, (_, d) => d);   // 圖與試算最大虧損共用：12 個月跌 0～60%
export const cyclesOf = (n) => Math.max(1, Math.round(365 / n));

// 一年計畫：今天買 N 口，每 365/cycles 天換倉（賣掉舊的、照同樣價外比例買新的）；跌勢在 H 天內等比例走完；IV＝各腳原 IV＋隨跌幅上升
// st＝{legs:[{K, mid, iv, q(+1 買／−1 賣)}], n（到期天數）, S0}；c＝{m（乘數）, r, fut, ivA, ivB（小數）}
export function sim(st, o, H, Dd, c) {
  const S0 = st.S0, S = (t) => S0 * Math.pow(1 - Dd, Math.min(t, H) / H), bump = (t) => ivUp(1 - S(t) / S0, c.ivA, c.ivB), step = 365 / o.cycles;
  const px = (s, K, T, v) => putPrice(c.fut, s, K, T, v, c.r);
  const value = (L, t) => L.reduce((a, l) => a + l.q * (t >= l.ex - 1e-9 ? Math.max(l.K - S(l.ex), 0) : px(S(t), l.K, (l.ex - t) / 365, l.iv + bump(t))), 0);
  let legs = st.legs.map((l) => ({ K: l.K, iv: l.iv, q: l.q, ex: st.n })), cash = -o.net;
  for (let k = 1; k < o.cycles; k++) {
    const tk = k * step;
    if (tk >= H - 1e-9) break;
    cash += value(legs, tk);
    legs = st.legs.map((l) => ({ K: (l.K / S0) * S(tk), iv: l.iv, q: l.q, ex: tk + st.n }));
    cash -= legs.reduce((a, l) => a + l.q * px(S(tk), l.K, st.n / 365, l.iv + bump(tk)), 0);
  }
  cash += value(legs, H);
  return cash * c.m * o.N;
}

// 一個結構的成本與風險：B＝年保險費預算（美元）；口數＝B ÷ 一年換幾次 ÷ 每口成本（捨去），不到 1 口＝以 1 口示意（demo:true）
export function calc(st, cap, B, c) {
  const m = c.m, net = st.legs.reduce((a, l) => a + l.q * l.mid, 0), costC = net * m;
  const cycles = cyclesOf(st.n), per = B / cycles, N0 = Math.floor(per / costC + 1e-9), demo = !(N0 >= 1), Nn = demo ? 1 : N0;
  const val = (s, tD) => st.legs.reduce((a, l) => a + l.q * putPrice(c.fut, s, l.K, tD / 365, l.iv, c.r), 0);
  const K1 = st.legs[0].K, K2 = st.legs[1] ? st.legs[1].K : 0;
  const o = {
    net, costC, cycles, N: Nn, demo, cost: costC * Nn, annual: costC * Nn * cycles, maxG: (K1 - K2 - net) * m * Nn, be: K1 - net,
    theta: (val(st.S0, st.n - 1) - val(st.S0, st.n)) * m * Nn, need: (costC * cycles) / (B / cap),
    delta: st.legs.reduce((a, l) => a + l.q * putDelta(c.fut, st.S0, l.K, st.n / 365, l.iv, c.r), 0) * m * Nn,   // 部位 Delta（美元／標的每 1 點）
  };
  o.sc = SCEN.map((s) => (s.H ? sim(st, o, s.H, s.D, c) : -o.annual));
  o.line = XS.map((d) => sim(st, o, 365, d / 100, c));
  const cand = [...o.line.map((v, d) => [v, "12 個月跌 " + d + "%"]), [o.sc[0], "6 個月跌 20%"], [o.sc[3], "沒崩、全部歸零"]];
  [o.worst, o.worstAt] = cand.reduce((a, x) => (x[0] < a[0] ? x : a));
  return o;
}

// 一個結構的輸入檢查（legs 已解析好；有一腳是 null＝沒報價或 % 超出範圍）→ 錯誤字串陣列（空＝可以算）
export function checkStruct(name, legs, n, tick, unit) {
  if (!(n >= 1)) return [name + "：這個到期日已過或今天到期，換一個到期日"];
  if (legs.some((l) => !l)) return [name + "：有一腳沒有報價或履約價 % 超出範圍"];
  const e = [];
  if (legs[1] && !(legs[1].K < legs[0].K)) e.push(name + "：賣出那腳的履約價要低於買進那腳（換一個 %）");
  if (legs.some((l) => !(l.mid > 0))) e.push(name + "：權利金是 0，這個履約價太價外");
  if (e.length) return e;
  const net = legs.reduce((a, l) => a + l.q * l.mid, 0), capx = legs[0].K - (legs[1] ? legs[1].K : 0);
  if (!(net >= tick)) e.push(name + "：淨權利金不到 " + tick + unit + "，這組太價外或兩腳太近");
  else if (!(net < capx)) e.push(name + "：淨權利金要低於 " + capx.toFixed(2) + "，不然最多賺不到錢");
  return e;
}
// 共用輸入檢查（字串照輸入框原樣傳進來）
export function checkGlobal({ cap, bp, rf, ivA, ivB, fut, nqiv }) {
  const e = [];
  if (!(+cap > 0)) e.push("總資金要大於 0");
  if (!(+bp > 0 && +bp <= 100)) e.push("年保險費要在 0～100% 之間");
  if (rf === "" || !(+rf >= -5 && +rf <= 20)) e.push("無風險利率要在 −5%～20% 之間");
  if (ivA === "" || ivB === "") e.push("IV 上升點數要填");
  else if (!(+ivA >= 0 && +ivB >= 0)) e.push("IV 上升點數不能是負的");
  else if (!(+ivB >= +ivA)) e.push("跌 50% 加的 IV 點數不能比跌 20% 少");
  if (fut && !(+nqiv > 0)) e.push("估算 IV 要大於 0");
  return e;
}

// 到期清單 [{e, n}] 裡天數最接近 target 的
export function nearExp(list, target) {
  let b = null;
  for (const x of list || []) if (!b || Math.abs(x.n - target) < Math.abs(b.n - target)) b = x;
  return b;
}
// /api/ta-opt 的 rows（[{k, p:{b,a,iv,oi}}]）裡履約價最接近 want、且賣權有賣價的那檔；sc＝換算倍數（XND 借 NDX 報價＝1/100）
export function nearPut(rows, want, sc = 1) {
  let best = null;
  for (const r of rows || []) {
    if (!r || !r.p || !(r.p.a > 0)) continue;
    if (!best || Math.abs(r.k * sc - want) < Math.abs(best.k * sc - want)) best = r;
  }
  if (!best) return null;
  const q = best.p;
  return { K: best.k * sc, b: q.b * sc, a: q.a * sc, mid: ((q.b + q.a) / 2) * sc, iv: q.iv, oi: q.oi };
}
// 價平 IV：履約價最接近現價那檔賣權的 IV（沒有＝null）
export function atmIv(rows, S) {
  const l = nearPut(rows, S);
  return l && l.iv > 0 ? l.iv : null;
}

// NQ／MNQ：期貨選擇權到期日之後最近的季月期貨（3／6／9／12 月第三個星期五）
const MON = { 3: "H", 6: "M", 9: "U", 12: "Z" };
export function thirdFri(y, m) {   // m＝1～12 → "YYYY-MM-DD"
  const wd = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), day = 1 + ((5 - wd + 7) % 7) + 14;
  return y + "-" + String(m).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}
export function futOf(exp) {
  let y = Number(exp.slice(0, 4)), m = Number(exp.slice(5, 7));
  for (let i = 0; i < 6; i++, m++) {
    if (m > 12) { m = 1; y++; }
    if (MON[m] && thirdFri(y, m) >= exp) return { code: MON[m] + String(y).slice(2), fe: thirdFri(y, m) };
  }
  return null;
}
// 引擎回的 NQ=F 目前合約（Yahoo shortName，例「Nasdaq 100 Dec 26」）→ {code:"Z26", fe}；認不出（或不是季月）＝null
const MN = { Mar: 3, Jun: 6, Sep: 9, Dec: 12 };
export function contractOf(s) {
  const m = /\b(Mar|Jun|Sep|Dec)\w*\s+'?(\d{2})\b/.exec(String(s || ""));
  if (!m) return null;
  const y = 2000 + Number(m[2]), mo = MN[m[1]];
  return { code: MON[mo] + m[2], fe: thirdFri(y, mo) };
}
// 持有成本（年化）＝ln(NQ 近月 ÷ NDX) ÷ 近月剩餘年數；近月剩不到 7 天、NDX 沒給（非正規盤）或算出來不在 −5%～15%
// （兩邊報價時間對不上）→ 改用無風險利率 r，implied:false；raw＝反推出來的值（沒算＝NaN），給頁面寫原因
export function carryOf(nq, ndx, d0, r) {
  const c = nq > 0 && ndx > 0 && d0 >= 7 ? Math.log(nq / ndx) / (d0 / 365) : NaN;
  return c >= -0.05 && c <= 0.15 ? { c, implied: true } : { c: r, implied: false, raw: c };
}
// 各季月期貨價：錨在 NQ 近月報價（剩 d0 天），往後每多 1 天乘 e^(c/365)；近月本身＝報價
export const futPx = (nq, c, d0, d) => nq * Math.exp((c * (d - d0)) / 365);
