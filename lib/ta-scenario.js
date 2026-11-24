// 劇本示意 K（Yoda 11-24）：空轉多／多轉空各四條路徑（可能性高→低），瀏覽器端純函式、決定性亂數
//
//   scenarios(bars, opt) → { dir, K, A, lv:[價位＋由來], list:[四條，算不出＝null], ms }
//     bars＝已收完的 K（{t,o,h,l,c,v}，盤中未定那根不給）；opt＝{ tf:'1H'|'4H'|'D', mkt, tz, ma:'sma'|'ema', ma_n:[短,中,長], dir:1 空轉多｜-1 多轉空 }
//   參考實作＝scratchpad scen\build.py（NQ 4H demo）：收盤走 Brownian bridge 串起劇本轉折、開＝前收（開盤那根小跳空）、影線看時段振幅、
//   量＝時段均量×劇本量能；規劃點＝條件寫成資料、在示意 K 上逐根判，第一根成立的才標；固定種子 1…SEEDS 逐一試，第一個通過劇本檢查的採用，全部不過＝null。
//   多轉空＝把 K 上下翻轉（x → K−x，K 對齊跳動單位）跑空轉多同一套程式再翻回來：價位、條件、檢查全部鏡像（測試守著）。
//   示意 K 只給畫面看：不進回測、訊號、五階段、共振（呼叫端只把它接在圖上）。
import { maLines } from "./ta-trade";

// ───── 休市表（美股＝NYSE，抄自 Skill us_holidays.py；台股＝TWSE 官方表，Skill data\tw_holidays_2026.json＋override）─────
// shortcut: 美股到 2027、台股只有 2026（＋2027-01-01），之後要照官方表補
export const US_CLOSED = {
  "2025-01-01": "元旦", "2025-01-09": "卡特國葬", "2025-01-20": "馬丁路德金恩紀念日", "2025-02-17": "總統日", "2025-04-18": "耶穌受難日",
  "2025-05-26": "陣亡將士紀念日", "2025-06-19": "六月節", "2025-07-04": "獨立紀念日", "2025-09-01": "勞動節", "2025-11-27": "感恩節", "2025-12-25": "聖誕節",
  "2026-01-01": "元旦", "2026-01-19": "馬丁路德金恩紀念日", "2026-02-16": "總統日", "2026-04-03": "耶穌受難日", "2026-05-25": "陣亡將士紀念日",
  "2026-06-19": "六月節", "2026-07-03": "獨立紀念日（補假）", "2026-09-07": "勞動節", "2026-11-26": "感恩節", "2026-12-25": "聖誕節",
  "2027-01-01": "元旦", "2027-01-18": "馬丁路德金恩紀念日", "2027-02-15": "總統日", "2027-03-26": "耶穌受難日", "2027-05-31": "陣亡將士紀念日",
  "2027-06-18": "六月節（補假）", "2027-07-05": "獨立紀念日（補假）", "2027-09-06": "勞動節", "2027-11-25": "感恩節", "2027-12-24": "聖誕節（補假）",
};
// 美股半日市（NYSE 13:00 收；美國期貨 CME 13:15 收）
export const US_EARLY = {
  "2025-07-03": "獨立紀念日前一天", "2025-11-28": "感恩節隔天", "2025-12-24": "聖誕夜",
  "2026-11-27": "感恩節隔天", "2026-12-24": "聖誕夜", "2027-11-26": "感恩節隔天",
};
export const TW_CLOSED = Object.fromEntries([
  "2026-01-01", "2026-02-12", "2026-02-13", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-27",
  "2026-04-03", "2026-04-06", "2026-05-01", "2026-06-19", "2026-07-10", "2026-09-25", "2026-09-28", "2026-10-09", "2026-10-23", "2026-10-26",
  "2026-12-25", "2027-01-01",
].map((d) => [d, "休市"]));

export const SEEDS = 200;
const NSIM = { "1H": [60, 70], "4H": [50, 60], D: [15, 25] };
const LB = { "1H": 120, "4H": 60, D: 60 };   // 近期波段低／高＝最近 LB 根
const STEP = 0.38, WICK = 0.44;              // 同 build.py：示意 K 平均振幅接近實際近 20 根

// ───── 日曆 ─────
const addDay = (d, k) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const wday = (d) => new Date(d + "T00:00:00Z").getUTCDay();
const hmOf = (t) => { const m = /\d{4}-\d\d-\d\d[ T](\d\d):(\d\d)/.exec(String(t)); return m ? +m[1] * 60 + +m[2] : null; };
const fmtHM = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
export function calOf(mkt, tz) {
  const tw = tz === "Asia/Taipei", us = tz === "America/New_York", fut = mkt === "fut";
  return {
    closed: tw ? TW_CLOSED : us ? US_CLOSED : {}, early: us ? US_EARLY : {}, earlyAt: fut ? 13 * 60 + 15 : 13 * 60,
    sess: fut && us ? 18 * 60 : 0,   // 美國期貨 18:00 開、算隔天的交易日
    close: fut ? (us ? 17 * 60 : 13 * 60 + 45) : us ? 16 * 60 : tw ? 13 * 60 + 30 : 24 * 60,
  };
}
const isTd = (d, cal) => wday(d) % 6 !== 0 && !cal.closed[d];
const nextTd = (d, cal) => { do d = addDay(d, 1); while (!isTd(d, cal)); return d; };

// 最後一根之後 n 根的時間（商品當地時間，同引擎 t 格式）：日K 逐個交易日；1H／4H 照資料裡出現過的開始時間（近 400 根，出現次數 ≥ 最多那個的 3 成）排，
// 跳週末、休市日；半日市那天收盤後的不排、跨收盤那根縮短。→ [{t, slot, f（這根長度／平常長度）, open（交易日第一根）, note}]
export function futureTimes(bars, tf, mkt, tz, n) {
  const cal = calOf(mkt, tz), last = String(bars[bars.length - 1].t), out = [];
  const eNote = (d) => (cal.early[d] ? cal.early[d] + "（" + fmtHM(cal.earlyAt) + " 提早收盤）" : "");
  if (tf === "D") {
    let d = last.slice(0, 10);
    while (out.length < n) { d = nextTd(d, cal); out.push({ t: d, slot: "D", f: cal.early[d] ? 0.55 : 1, open: true, note: eNote(d) }); }
    return out;
  }
  const ord = (m) => (m - cal.sess + 1440) % 1440, cnt = new Map();
  for (const b of bars.slice(-400)) { const m = hmOf(b.t); if (m != null) cnt.set(m, (cnt.get(m) || 0) + 1); }
  const mx = Math.max(...cnt.values());
  const slots = [...cnt].filter(([, c]) => c >= mx * 0.3).map(([m]) => m).sort((x, y) => ord(x) - ord(y));
  const endOf = (j) => (j + 1 < slots.length ? ord(slots[j + 1]) : ord(cal.close));
  const tdOf = (t) => { const d = t.slice(0, 10); return cal.sess && hmOf(t) >= cal.sess ? addDay(d, 1) : d; };
  let td = tdOf(last), from = ord(hmOf(last));
  if (!isTd(td, cal)) { td = nextTd(td, cal); from = -1; }
  while (out.length < n) {
    let first = from < 0;   // 接著最後一根的那個交易日：第一根不是開盤
    for (let j = 0; j < slots.length && out.length < n; j++) {
      const m = slots[j], o = ord(m);
      if (o <= from) continue;
      let e = endOf(j);
      const ea = cal.early[td] ? ord(cal.earlyAt) : null;
      if (ea != null && o >= ea) continue;
      if (ea != null) e = Math.min(e, ea);
      const day = cal.sess && m >= cal.sess ? addDay(td, -1) : td;
      out.push({ t: day + " " + fmtHM(m), slot: m, f: (e - o) / (endOf(j) - o), open: first, note: ea != null ? eNote(td) : "" });
      first = false;
    }
    td = nextTd(td, cal); from = -1;
  }
  return out;
}

// ───── 數字小工具 ─────
function prng(seed) {   // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (R) => { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()); };
// 跳動單位：近 200 根開高低收 ≥98% 是它的倍數的最大一個（調整後價格對不上 → 0.01）
export function tickOf(bars) {
  const xs = []; for (const b of bars.slice(-200)) xs.push(b.o, b.h, b.l, b.c);
  for (const t of [100, 50, 10, 5, 1, 0.5, 0.25, 0.1, 0.05, 0.01]) {
    if (xs.filter((x) => Math.abs(x / t - Math.round(x / t)) < 1e-6).length >= xs.length * 0.98) return t;
  }
  return 0.01;
}
const dec = (t) => (String(t).split(".")[1] || "").length;
export const mirrorK = (bars, tick) => { const s = bars.slice(-300); return Math.round((Math.max(...s.map((b) => b.h)) + Math.min(...s.map((b) => b.l))) / tick) * tick; };

// ───── 劇本（canonical＝空轉多方向；多轉空在翻轉後的 K 上跑同一份）─────
// phases：{ n, to(s)＝這段終點收盤（段開始時算）, vm 量能倍數, vs 波動倍數, cmin/cmax(s) 收盤上下限, lmin(s) 低點下限, hmax(s) 高點上限, lowAt(s) 段最後一根低點 }
// s＝目前狀態 {c, m:[三條均線目前值], lo（示意段最低）, hi}；規劃點條件 t：cgt 收盤 > lv（vx＝量 ≥ vx 倍前 20 根均量）｜clt 收盤 < lv｜cltma 收盤 < 第 n 條均線｜
// hge 最高 ≥ lv｜reclaim 示意段先有收盤 < lv、這根收盤 > lv
// 走一段距離至少要幾根（每根平均 r 倍 ATR）：段長取「比例」與「距離」較大的；剩下的放主升段，不夠＝這個種子不成立
const SC = [
  {
    id: "ma",
    phases(v, n, u) {
      const { A, T, m, C0 } = v, need = (d, r = 0.6) => Math.ceil(Math.abs(d) / (r * A));
      if (!(m[2] < T - 0.3 * A)) return null;   // 長均線在反彈頂附近之上＝沒有「回踩長均線」的空間
      const cap = () => T - 0.1 * A, hcap = () => T - 0.03 * A, fl = (s) => s.mf[2] + 0.03 * A;
      const p1 = Math.min(T - 0.25 * A, Math.max(C0, m[2] + (0.6 + 0.4 * u()) * A));
      const n1 = Math.max(Math.round(n * 0.17 * (0.8 + 0.4 * u())), need(p1 - C0)), n2 = Math.max(Math.round(n * 0.22 * (0.8 + 0.4 * u())), need(p1 - m[2], 0.4));
      const n3 = Math.max(Math.round(n * 0.07), need(T - m[2], 0.55)), n6 = Math.round(n * 0.2);
      const n5 = Math.max(n - n1 - n2 - n3 - 1 - n6, 0);
      if (n5 < need(v.RES - T, 0.7)) return [{ n: 0 }];
      return [
        { n: n1, to: () => p1, cmax: cap, hmax: hcap },
        { n: n2, to: (s) => s.m[2] + (0.1 + 0.2 * u()) * A, cmin: fl, cmax: cap, hmax: hcap, lmin: (s) => s.m[2] - 0.08 * A, lowAt: (s) => s.m[2] - 0.03 * A * u(), vm: 0.6, vs: 0.8 },
        { n: n3, to: () => T - (0.15 + 0.25 * u()) * A, cmin: fl, cmax: cap, hmax: hcap, vm: 0.7 },
        { n: 1, to: () => T + (0.45 + 0.35 * u()) * A, brk: 1, vs: 1.2 },
        { n: n5, to: () => v.RES + (0.4 + 0.6 * u()) * A },
        { n: n6, to: (s) => s.m[1] - (0.8 + 0.6 * u()) * A, vs: 1.1 },
      ];
    },
    plan: (v) => ({ entry: { t: "cgt", lv: v.T, vx: 1.5 }, stop: { t: "cltma", n: 2 }, ex1: { t: "hge", lv: v.RES }, ex2: { t: "cltma", n: 1 } }),
    check(v, x) {
      const { A, T } = v, { k0, ent, n, C, L, V, M } = x, pb = [];
      for (let k = k0 + Math.ceil(n * 0.15); k < ent; k++) pb.push(k);
      if (rng(k0, ent).some((k) => C(k) > T)) return "收盤先站上反彈頂";
      if (ent - k0 < n * 0.3 || !pb.length) return "進場太早";
      if (!pb.some((k) => L(k) <= M(2, k) + 0.05 * A)) return "沒有回踩到長均線";
      if (pb.some((k) => C(k) < M(2, k))) return "回踩時收破長均線";
      if (v.hasVol && pb.reduce((s, k) => s + V(k), 0) / pb.length > 0.85 * v.V20) return "回踩沒量縮";
      const e8 = Math.min(ent + 8, k0 + n - 1);
      if (!(M(2, e8) > M(2, ent))) return "長均線沒翻揚";
      return null;
    },
  },
  {
    id: "strong",
    phases(v, n, u) {
      const { A, T, C0 } = v, need = (d, r) => Math.ceil(Math.abs(d) / (r * A));
      const n1 = Math.max(Math.floor(u() * 3), need(T - 0.3 * A - C0, 0.8) - 1), n2 = Math.max(Math.round(n * 0.6), need(v.RES - T, 0.6) + 4);
      if (n1 > n * 0.25) return null;   // 離反彈頂太遠，談不上「直接衝過」
      return [
        ...(n1 ? [{ n: n1, to: () => T - (0.2 + 0.2 * u()) * A, cmax: () => T - 0.12 * A }] : []),
        { n: 1, to: () => T + (0.6 + 0.4 * u()) * A, brk: 1, vs: 1.2 },
        { n: n2, to: () => v.RES + (0.6 + 0.8 * u()) * A, cmin: (s) => s.mf[0] + 0.05 * A },
        { n: n - n1 - 1 - n2, to: (s) => s.m[0] - (1 + 0.5 * u()) * A, vs: 1.1 },
      ];
    },
    plan: (v) => ({ entry: { t: "cgt", lv: v.T, vx: 1.5 }, stop: { t: "clt", lv: v.T }, ex1: { t: "hge", lv: v.RES }, ex2: { t: "cltma", n: 0 } }),
    check(v, x) {
      const { k0, ent, n, C, M, ev } = x;
      if (ent > k0 + Math.max(3, Math.ceil(n * 0.08), Math.ceil((v.T - v.C0) / (0.8 * v.A)) + 1)) return "進場太晚";
      if (ev.ex2 - ent < n * 0.45) return "太快收破短均線";
      if (rng(ent + 1, ev.ex2).some((k) => C(k) < M(0, k))) return "出場2 前收破短均線";
      if (!rng(ent + Math.ceil(n * 0.25), ev.ex2).every((k) => M(0, k) > M(1, k))) return "短均線沒站上中均線";
      return null;
    },
  },
  {
    id: "w",
    phases(v, n, u) {
      const { A, T, KKL, C0 } = v, need = (d, r) => Math.ceil(Math.abs(d) / (r * A));
      if (KKL == null || !(KKL < C0 - 0.3 * A) || !(KKL < T - A)) return null;
      const cap = () => T - 0.15 * A, hcap = () => T - 0.05 * A, lf = () => KKL + 0.005 * A;
      const n1 = Math.max(Math.round(n * 0.3 * (0.8 + 0.4 * u())), need(C0 - KKL, 0.6)), n2 = Math.max(Math.round(n * 0.25 * (0.8 + 0.4 * u())), need(T - KKL, 0.55));
      const n5 = Math.round(n * 0.12), n4 = n - n1 - n2 - 1 - n5;
      if (n4 < need(T - KKL, 0.7)) return [{ n: 0 }];
      return [
        { n: n1, to: () => KKL + (0.1 + 0.15 * u()) * A, cmin: () => KKL + 0.06 * A, cmax: cap, hmax: hcap, lmin: lf, lowAt: () => KKL + (0.02 + 0.1 * u()) * A, vm: 0.65, vs: 0.85 },
        { n: n2, to: () => T - (0.2 + 0.3 * u()) * A, cmin: () => KKL + 0.1 * A, cmax: () => T - 0.12 * A, hmax: () => T - 0.03 * A, lmin: lf, vm: 0.85 },
        { n: 1, to: () => T + (0.45 + 0.35 * u()) * A, brk: 1, vs: 1.2 },
        { n: n4, to: (s) => T + (T - s.lo) + (0.3 + 0.5 * u()) * A },
        { n: n5, to: (s) => s.c - (1 + 0.6 * u()) * A },
      ];
    },
    plan: (v) => ({ entry: { t: "cgt", lv: v.T, vx: 1.5 }, stop: { t: "clt", lv: "rlow" }, ex1: { t: "hge", lv: "e1" }, ex2: { t: "hge", lv: "tgt" } }),
    prep(v, x, c) {
      c.rlow = Math.min(...rng(x.k0, x.ent + 1).map(x.L));
      c.tgt = rt(v.T + (v.T - c.rlow), v.tick);
      c.e1 = v.RES < c.tgt - 0.25 * v.A ? v.RES : rt((v.T + c.tgt) / 2, v.tick);
      c.e1mid = c.e1 !== v.RES;
    },
    check(v, x, c) {
      const { A, T, KKL, k0, ent, n, C } = { ...v, ...x };
      if (!(c.rlow >= KKL && c.rlow <= KKL + 0.3 * A)) return "右腳沒守在關鍵K 低點";
      if (rng(k0, ent).some((k) => C(k) < KKL || C(k) > T)) return "右腳收破關鍵K 或先站上頸線";
      if (ent - k0 < n * 0.35) return "進場太早";
      return null;
    },
  },
  {
    id: "spring",
    phases(v, n, u) {
      const { A, T, LOW, C0 } = v, need = (d, r) => Math.ceil(Math.abs(d) / (r * A));
      const n1 = Math.max(Math.round(n * 0.25 * (0.8 + 0.4 * u())), need(C0 - LOW, 0.6)), n2 = 2 + Math.floor(u() * 3), n4 = Math.max(Math.round(n * 0.22), need(T - LOW - 2 * A, 0.7));
      const n5 = n - n1 - n2 - 4 - n4;
      if (n5 < Math.round(n * 0.1)) return [{ n: 0 }];
      return [
        { n: n1, to: () => LOW + (0.25 + 0.3 * u()) * A },
        { n: n2, to: () => LOW - (0.35 + 0.4 * u()) * A, cmax: () => LOW - 0.05 * A, lmin: () => LOW - 1.5 * A, vm: 1.2 },
        { n: 1, to: () => LOW + (0.35 + 0.35 * u()) * A, vm: 1.5 },
        { n: 3, to: (s) => s.c + (1.5 + 0.6 * u()) * A, vs: 0.4, vm: 1.3 },
        { n: n4, to: () => T + (0.3 + 0.4 * u()) * A, vm: 1.15, cmin: (s) => s.mf[0] + 0.02 * A },
        { n: n5, to: (s) => s.m[0] - (0.8 + 0.5 * u()) * A },
      ];
    },
    plan: (v) => ({ entry: { t: "reclaim", lv: v.LOW }, stop: { t: "clt", lv: "slow" }, ex1: { t: "hge", lv: v.T }, ex2: { t: "cltma", n: 0 } }),
    prep(v, x, c) { c.slow = Math.min(...rng(x.k0, x.ent + 1).map(x.L)); },
    check(v, x, c) {
      const { A, LOW, k0, ent, n, C, O, M } = { ...v, ...x };
      if (!(c.slow >= LOW - 1.6 * A && c.slow <= LOW - 0.25 * A)) return "破底深度不對";
      const nb = rng(k0, ent).filter((k) => C(k) < LOW).length;
      if (nb < 1 || nb > 4) return "收在低點之下的根數不對";
      if (!rng(ent, ent + Math.ceil(n * 0.35)).some((k) => C(k) > M(1, k))) return "沒站上中均線";
      if (!rng(ent, ent + Math.ceil(n * 0.2)).some((k) => [0, 1, 2].every((j) => C(k + j) - O(k + j) >= 0.4 * A))) return "沒有連三根長紅";
      if (rng(ent + 1, ent + Math.ceil(n * 0.12)).some((k) => C(k) < M(0, k))) return "V 轉不乾淨";
      return null;
    },
  },
];
const rng = (a, b) => { const o = []; for (let k = a; k < b; k++) o.push(k); return o; };
const rt = (x, t) => Math.round(x / t) * t;

// 劇本名稱與條件文字（dir 1＝空轉多、-1＝多轉空；{x} 代入實際數字；量的條件在沒有成交量的標的拿掉）
const TXT = {
  1: {
    name: ["回踩 {m3} 再攻", "強勢上漲", "W 底回測多方關鍵K", "破底翻"],
    vol: " 且量 ≥ 前 20 根均量 1.5 倍",
    ma: { entry: "收盤站上反彈頂 {lv}{vol}", stop: "進場後收盤跌破 {m3}（進場那根 {m3} {lv}）", ex1: "最高價觸及上方壓力 {lv}", ex2: "出場1 之後收盤跌破 {m2}" },
    strong: { entry: "收盤站上反彈頂 {lv}{vol}", stop: "進場後收盤跌回反彈頂 {lv} 之下", ex1: "最高價觸及上方壓力 {lv}", ex2: "出場1 之後收盤跌破 {m1}" },
    w: { entry: "收盤站上頸線（反彈頂）{lv}{vol}", stop: "進場後收盤跌破 W 底右腳低點 {lv}", ex1: "最高價觸及上方壓力 {lv}", ex1mid: "最高價觸及頸線到量測目標的一半 {lv}",
      ex2: "最高價觸及 W 底量測目標 {lv}（頸線 + 頸線到右腳的距離）" },
    spring: { entry: "破底翻：先收盤跌破近期低點 {lv}，之後第一根收盤站回 {lv}", stop: "進場後收盤跌破破底最低點 {lv}", ex1: "最高價觸及反彈頂 {lv}", ex2: "出場1 之後收盤跌破 {m1}" },
    lv: { LOW: "近期波段低", T: "反彈頂", KK: "多方關鍵K", RES: "上方壓力" },
  },
  "-1": {
    name: ["反彈測 {m3} 不過再跌", "急跌破支撐", "M 頭回測空方關鍵K", "假突破翻黑"],
    vol: " 且量 ≥ 前 20 根均量 1.5 倍",
    ma: { entry: "收盤跌破回落底 {lv}{vol}", stop: "進場後收盤站回 {m3}（進場那根 {m3} {lv}）", ex1: "最低價觸及下方支撐 {lv}", ex2: "出場1 之後收盤站回 {m2}" },
    strong: { entry: "收盤跌破回落底 {lv}{vol}", stop: "進場後收盤站回回落底 {lv} 之上", ex1: "最低價觸及下方支撐 {lv}", ex2: "出場1 之後收盤站回 {m1}" },
    w: { entry: "收盤跌破頸線（回落底）{lv}{vol}", stop: "進場後收盤站上 M 頭右肩高點 {lv}", ex1: "最低價觸及下方支撐 {lv}", ex1mid: "最低價觸及頸線到量測目標的一半 {lv}",
      ex2: "最低價觸及 M 頭量測目標 {lv}（頸線 − 右肩到頸線的距離）" },
    spring: { entry: "假突破：先收盤站上近期高點 {lv}，之後第一根收盤跌回 {lv} 之下", stop: "進場後收盤站上假突破最高點 {lv}", ex1: "最低價觸及回落底 {lv}", ex2: "出場1 之後收盤站回 {m1}" },
    lv: { LOW: "近期波段高", T: "回落底", KK: "空方關鍵K", RES: "下方支撐" },
  },
};
export const PNAME = { entry: "進場", stop: "停損", ex1: "出場1", ex2: "出場2" };
const KINDS = ["entry", "stop", "ex1", "ex2"];

// 規劃點：進場＝示意段第一根成立；之後逐根先看停損，出場1 成立後才看出場2（同 build.py run_plan）
function runPlan(pl, x, entryOnly) {
  const { k0, end, C, H, V, M, vavg, hasVol } = x;
  const ok = (cd, k) => {
    switch (cd.t) {
      case "cgt": return C(k) > cd.lv && (!cd.vx || !hasVol || V(k) >= cd.vx * vavg(k));
      case "clt": return C(k) < cd.lv;
      case "cltma": return C(k) < M(cd.n, k);
      case "hge": return H(k) >= cd.lv;
      case "reclaim": return C(k) > cd.lv && rng(k0, k).some((j) => C(j) < cd.lv);
      default: throw new Error(cd.t);
    }
  };
  let ent = null;
  for (let k = k0; k < end; k++) if (ok(pl.entry, k)) { ent = k; break; }
  if (ent == null) return null;
  if (entryOnly) return { ent };
  const ev = { entry: ent, stop: null, ex1: null, ex2: null };
  for (let k = ent + 1; k < end; k++) {
    if (ok(pl.stop, k)) { ev.stop = k; break; }
    if (ev.ex1 == null) { if (ok(pl.ex1, k)) ev.ex1 = k; } else if (ok(pl.ex2, k)) { ev.ex2 = k; break; }
  }
  return { ent, ev, ok };
}

export function scenarios(bars, opt) {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const dir = opt.dir === -1 ? -1 : 1, tf = opt.tf, NA = bars.length, W = TXT[dir];
  const mn = opt.ma_n.slice(0, 3).map((k) => (opt.ma === "ema" ? "EMA" : "SMA") + k), names = W.name.map((x) => x.replace("{m3}", mn[2]));
  const empty = (why) => ({ dir, names, lv: [], list: [null, null, null, null], why, ms: 0 });
  if (!NSIM[tf]) return empty("劇本只支援 1H／4H／日K");
  if (NA < 80) return empty("K 線不足 80 根");
  const tick = tickOf(bars), dd = dec(tick), K = +mirrorK(bars, tick).toFixed(dd);
  const cl = (x) => +x.toFixed(dd);   // 對齊跳動單位後去掉浮點尾巴（0.1+0.2 那種）
  const fl = (b) => ({ t: b.t, o: cl(K - b.o), h: cl(K - b.l), l: cl(K - b.h), c: cl(K - b.c), v: b.v });
  const act = dir === 1 ? bars.map((b) => ({ t: b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v || 0 })) : bars.map((b) => fl({ ...b, v: +b.v || 0 }));
  const real = (p) => (p == null ? null : dir === 1 ? p : K - p);
  const fx = (p) => Number(real(p).toFixed(dd));
  const ma = { ma: opt.ma === "ema" ? "ema" : "sma", ma_n: opt.ma_n.slice(0, 3) };
  const C0s = act.map((b) => b.c), MA = maLines(C0s, ma);
  const tr = (k) => Math.max(act[k].h, act[k - 1].c) - Math.min(act[k].l, act[k - 1].c);
  const atrAt = (k) => { let s = 0; for (let j = k - 19; j <= k; j++) s += tr(j); return s / 20; };
  const vavgA = (k) => { let s = 0; for (let j = k - 20; j < k; j++) s += act[j].v; return s / 20; };
  const A = atrAt(NA - 1), V20 = vavgA(NA), hasVol = V20 > 0, C0 = act[NA - 1].c;
  const m = MA.map((x) => x[NA - 1]);
  if (!(A > 0) || m.some((x) => !Number.isFinite(x))) return empty("均線或 ATR 算不出來");
  // 關鍵價位（canonical）
  const lb = Math.min(LB[tf], NA - 21);
  let iLow = NA - lb;
  for (let i = NA - lb; i < NA; i++) if (act[i].l < act[iLow].l) iLow = i;
  const LOW = act[iLow].l;
  let iTop = -1;
  for (let i = iLow + 1; i < NA; i++) if (iTop < 0 || act[i].h > act[iTop].h) iTop = i;
  if (iTop < 0) iTop = iLow;
  const T = act[iTop].h;
  let iKK = null;
  for (let i = iLow + 1; i < NA && iKK == null; i++) {
    const b = act[i];
    if (hasVol && i >= 21 && b.c > b.o && b.v >= 1.5 * vavgA(i) && b.c - b.o >= atrAt(i - 1)) iKK = i;
  }
  const KKL = iKK == null ? null : act[iKK].l;
  const cand = [];
  let iPH = -1;
  for (let i = NA - lb; i < iLow; i++) if (iPH < 0 || act[i].h > act[iPH].h) iPH = i;
  if (iPH >= 0) cand.push({ p: act[iPH].h, i: iPH, src: "ph" });
  const vi = rng(Math.max(0, NA - 120), NA).filter((i) => act[i].v > 0).sort((x, y) => act[y].v - act[x].v || y - x).slice(0, 5);
  for (const i of vi) cand.push({ p: act[i].h, i, src: "vol" });
  const res = cand.filter((x) => x.p > T + 0.5 * A).sort((x, y) => x.p - y.p)[0] || { p: rt(T + 2 * A, tick), i: null, src: "atr" };
  const RES = res.p;
  const hm = (i) => String(act[i].t).slice(5, 16);
  const vm = (i) => (i >= 20 && vavgA(i) > 0 ? (act[i].v / vavgA(i)).toFixed(1) + " 倍" : "—");
  const lv = [
    { k: "LOW", name: W.lv.LOW, p: fx(LOW), why: "最近 " + lb + " 根" + (dir === 1 ? "最低點" : "最高點") + "（" + hm(iLow) + "）" },
    { k: "T", name: W.lv.T, p: fx(T), why: (dir === 1 ? "低點之後的最高點" : "高點之後的最低點") + "（" + hm(iTop) + "）" },
    { k: "KK", name: W.lv.KK, p: iKK == null ? null : fx(KKL),
      why: iKK == null ? (dir === 1 ? "低點後沒有" : "高點後沒有") + "放量長" + (dir === 1 ? "紅" : "黑") + "（量 ≥ 前 20 根均量 1.5 倍且實體 ≥ 1 ATR）"
        : (dir === 1 ? "低點後第一根放量長紅（" : "高點後第一根放量長黑（") + hm(iKK) + "，量 " + vm(iKK) + "、實體 " + (Math.abs(act[iKK].c - act[iKK].o) / atrAt(iKK - 1)).toFixed(1) + " ATR），取它的" + (dir === 1 ? "最低點" : "最高點") },
    { k: "RES", name: W.lv.RES, p: fx(RES),
      why: res.src === "ph" ? (dir === 1 ? "低點之前的前高" : "高點之前的前低") + "（" + hm(res.i) + "）"
        : res.src === "vol" ? "大量 K " + (dir === 1 ? "最高點" : "最低點") + "（" + hm(res.i) + "，量 " + vm(res.i) + "）"
        : W.lv.T + (dir === 1 ? " + " : " − ") + "2 倍 ATR（0.5 ATR 外沒有前" + (dir === 1 ? "高" : "低") + "或大量 K）" },
    ...mn.map((nm, j) => ({ k: "M" + j, name: nm, p: fx(m[j]), why: "目前值（第 " + (j + 1) + " 條交易均線）" })),
    { k: "ATR", name: "ATR20", p: Number(A.toFixed(dd)), why: "近 20 根真實區間平均，示意 K 振幅照這個" },
    ...(hasVol ? [{ k: "V20", name: "前 20 根均量", p: Math.round(V20), why: "示意 K 的量照這個（突破放量、回測量縮）" }] : []),
  ];
  const v = { A, T, LOW, KKL, RES, C0, m, V20, hasVol, tick };
  // 時段的量、振幅樣態（近 120 根）
  const [n0, n1] = NSIM[tf], fut = futureTimes(bars, tf, opt.mkt, opt.tz, n1);
  const key = (b) => (tf === "D" ? "D" : hmOf(b.t)), PV = new Map(), PR = new Map();
  for (const b of act.slice(-120)) { const s = key(b); const o = PR.get(s) || [0, 0, 0]; o[0] += b.v; o[1] += b.h - b.l; o[2]++; PR.set(s, o); }
  const mV = [...PR.values()].reduce((z, o) => z + o[0] / o[2], 0) / PR.size, mR = [...PR.values()].reduce((z, o) => z + o[1] / o[2], 0) / PR.size;
  for (const [s, o] of PR) PV.set(s, mV > 0 ? (o[0] / o[2] / mV) * V20 : 0);
  for (const [s, o] of PR) PR.set(s, mR > 0 ? o[1] / o[2] / mR : 1);
  const slotV = (s) => (PV.has(s) ? PV.get(s) : V20), slotR = (s) => (PR.has(s) ? PR.get(s) : 1);
  // 均線逐根延伸（SMA 滑動和、EMA 遞迴＝emaPandas 沒有缺值時的式子）
  const st0 = ma.ma_n.map((k, j) => (ma.ma === "ema" ? { e: m[j] } : { s: C0s.slice(NA - k).reduce((z, c) => z + c, 0) }));
  const SEEDK = [1, 2, 3, 4].map((j) => j * 104729);   // 兩個方向同一串亂數：多轉空＝翻轉資料上的空轉多（鏡像測試靠這個）
  const dbg = opt.dbg;   // 測試／調參用：{劇本:理由 → 次數}
  const list = SC.map((sc, si) => {
    const no = (why) => { if (dbg) dbg[sc.id + ":" + why] = (dbg[sc.id + ":" + why] || 0) + 1; };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const R = prng(seed * 7919 + SEEDK[si]), u = () => R(), n = n0 + Math.floor(u() * (n1 - n0 + 1));
      const phases = sc.phases(v, n, u);
      if (!phases) { no("前提不成立"); return null; }   // 換種子也沒用
      if (phases.some((p) => p.n < 1)) { no("段太短"); continue; }
      const sim = [], simC = [], sM = [[], [], []], stt = st0.map((x) => ({ ...x }));
      const Cx = (k) => (k < NA ? C0s[k] : simC[k - NA]);
      let c = C0, lo = Infinity, hi = -Infinity, k = 0;
      // m＝上一根的三條均線；mf＝這根收盤要高過「含這根的均線」的門檻（SMA：(窗內和 − 要滑出那根)/(n−1)；EMA：上一根的值）
      const st = () => ({ c, m: [0, 1, 2].map((j) => (k ? sM[j][k - 1] : m[j])), mf: ma.ma_n.map((w, q) => (ma.ma === "ema" ? stt[q].e : (stt[q].s - Cx(NA + k - w)) / (w - 1))), lo, hi });
      for (const P of phases) {
        const end = P.to(st());
        for (let j = 0; j < P.n; j++, k++) {
          const s = st(), rem = P.n - j, sl = fut[k], f = sl.f, rs = slotR(sl.slot) * f;
          const sg = STEP * A * (P.vs || 1) * Math.sqrt(rs);
          let cc = c + (end - c) / rem + sg * Math.sqrt((rem - 1) / rem) * gauss(R);
          if (P.cmin) cc = Math.max(cc, P.cmin(s));
          if (P.cmax) cc = Math.min(cc, P.cmax(s));
          const gap = sl.open ? gauss(R) * (tf === "D" ? 0.1 : 0.06) * A : 0;
          const o = cl(rt(c + gap, tick)); cc = cl(rt(cc, tick));
          const wk = WICK * A * Math.sqrt(rs * (P.vs || 1));
          let h = Math.max(o, cc) + Math.min(2, Math.abs(gauss(R))) * wk, l = Math.min(o, cc) - Math.min(2, Math.abs(gauss(R))) * wk;
          if (P.hmax) h = Math.min(h, P.hmax(s));
          if (P.lmin) l = Math.max(l, P.lmin(s));
          if (P.lowAt && j === P.n - 1) l = P.lowAt(s);
          h = Math.max(cl(Math.round(h / tick - 1e-9) * tick), o, cc); l = Math.min(cl(Math.round(l / tick + 1e-9) * tick), o, cc);
          // 突破那根（brk）＝前 20 根均量的 1.6～2.3 倍（照時段均量乘會把開盤時段的突破量放大到五、六倍）
          let vol = 0;
          if (hasVol && P.brk) { let z = 0; for (let q = NA + k - 20; q < NA + k; q++) z += q < NA ? act[q].v : sim[q - NA].v; vol = Math.round((z / 20) * (1.6 + 0.7 * u())); }
          else if (hasVol) vol = Math.round(slotV(sl.slot) * (P.vm || 1) * f * Math.exp(0.18 * gauss(R)));
          sim.push({ t: sl.t, o, h, l, c: cc, v: vol, note: sl.note });
          simC.push(cc);
          const kk = NA + k;
          ma.ma_n.forEach((w, q) => {
            const z = stt[q];
            if (ma.ma === "ema") { z.e += (2 / (w + 1)) * (cc - z.e); sM[q].push(z.e); }
            else { z.s += cc - Cx(kk - w); sM[q].push(z.s / w); }
          });
          c = cc; lo = Math.min(lo, l); hi = Math.max(hi, h);
        }
      }
      // 合法性與量級：OHLC、單根振幅 ≤ 3.5 ATR、收盤跳動 ≤ 2.5 ATR
      let bad = false;
      for (let q = 0; q < n && !bad; q++) {
        const b = sim[q], pc = q ? sim[q - 1].c : C0;
        if (!(b.l <= Math.min(b.o, b.c) && Math.max(b.o, b.c) <= b.h) || b.h - b.l > 3.5 * A || Math.abs(b.c - pc) > 2.5 * A) bad = true;
      }
      if (bad) { no("振幅過大"); continue; }
      const at = (k2, f2) => (k2 < NA ? act[k2][f2] : sim[k2 - NA][f2]);
      const x = {
        k0: NA, end: NA + n, n, hasVol,
        C: (k2) => at(k2, "c"), O: (k2) => at(k2, "o"), H: (k2) => at(k2, "h"), L: (k2) => at(k2, "l"), V: (k2) => at(k2, "v"),
        M: (q, k2) => (k2 < NA ? MA[q][k2] : sM[q][k2 - NA]),
        vavg: (k2) => { let z = 0; for (let j = k2 - 20; j < k2; j++) z += at(j, "v"); return z / 20; },
      };
      const pl = sc.plan(v), r0 = runPlan(pl, x, true);
      if (!r0) { no("沒進場"); continue; }
      x.ent = r0.ent;
      const cx = {};
      if (sc.prep) sc.prep(v, x, cx);   // 進場後才知道的價位（右腳低點、破底低點、量測目標）
      for (const q of KINDS) if (typeof pl[q].lv === "string") pl[q] = { ...pl[q], lv: cx[pl[q].lv] };
      const r = runPlan(pl, x);
      x.ev = r.ev;
      if (r.ev.stop != null || r.ev.ex1 == null || r.ev.ex2 == null || r.ev.ex2 > x.end - 2) { no(r.ev.stop != null ? "停損" : "出場不全"); continue; }
      // 兩個出場都不能比進場差（劇本講的是這條路走得通的樣子）
      const fill0 = (q) => (pl[q].t === "hge" ? Math.max(pl[q].lv, x.O(r.ev[q])) : x.C(r.ev[q]));
      if (fill0("ex1") < x.C(r0.ent) || fill0("ex2") < x.C(r0.ent)) { no("出場比進場差"); continue; }
      const why = sc.check(v, x, cx);
      if (why) { no(why); continue; }
      // 通過 → 轉回實際價格
      const e = x.C(r.ent), T2 = W[sc.id];
      const nm = { m1: mn[0], m2: mn[1], m3: mn[2] };
      const fill = (q, k2) => (pl[q].t === "hge" ? Math.max(pl[q].lv, x.O(k2)) : x.C(k2));
      const stopLv = pl.stop.t === "cltma" ? x.M(pl.stop.n, r.ent) : pl.stop.lv;
      const plan = KINDS.map((q) => {
        const k2 = x.ev[q], lvl = q === "stop" ? stopLv : pl[q].t === "cltma" ? null : pl[q].lv;
        const tx = (q === "ex1" && cx.e1mid ? T2.ex1mid : T2[q]).replace("{vol}", hasVol ? W.vol : "").replace(/\{lv\}/g, lvl == null ? "" : fpx(fx(lvl))).replace(/\{(m\d)\}/g, (z, y) => nm[y]);
        const row = { kind: q, name: PNAME[q], k: k2, cond: tx, level: lvl == null ? null : fx(lvl) };
        const px = k2 != null ? (q === "entry" ? e : fill(q, k2)) : lvl;
        if (px != null) row.p = fx(px);
        if (k2 != null) { row.t = sim[k2 - NA].t; row.note = sim[k2 - NA].note || ""; }
        if (q === "entry") { if (hasVol) row.vmul = x.V(k2) / x.vavg(k2); }
        else if (px != null) { row.pnl = Number((px - e).toFixed(dd)); row.pct = ((px - e) / real(e)) * 100; }
        return row;
      });
      return { id: sc.id, name: names[si], seed, n, sim: dir === 1 ? sim : sim.map((b) => ({ ...fl(b), note: b.note })), plan };
    }
    return null;
  });
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return { dir, names, K, tick, A, lv, list, ms: t1 - t0 };
}
const fpx = (x) => (x == null || !Number.isFinite(Number(x)) ? "—" : Number(x).toLocaleString("en-US", { maximumFractionDigits: 4 }));
