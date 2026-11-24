// 空方／多方四步（Yoda 11-24 定）：純函式，只吃已收完的 K、收盤判定；MA5／10／20＝收盤 SMA。
// 對照 Python 參考實作 seq.py find_sequences(reset='new_s2', tol=0.005)＋exit_ma5.py apply_exit，黃金比對見 tests/ta_4step.cjs。
// 不是交易訊號：不進左側面板、回測統計、共振閃爍，只畫在 K 線圖上（app/ta/page.jsx）。
//   空 ① 收盤 > MA5 且 > MA10 且 < MA20（前一根沒同時站上 MA5、MA10），L1＝①低
//      ② ①後第一根 low 在 L1±0.5% 且收盤 > L1，L2＝②低；②前收盤 < L1 → 作廢
//      ③ ②後第一根收盤 < L2；之後逐根：收盤 > L2 → 空4（停損），否則收盤 > MA5 → 空利；同根都成立算空4
//   多＝鏡像（K 棒上下翻轉後跑空方）：① 收盤 < MA5、< MA10、> MA20，H1＝①高；② high 在 H1±0.5%、收盤 < H1；③ 收盤 > H2；收盤 < H2 → 多4，否則 < MA5 → 多利
//   重置：新序列走到②才作廢還沒到③的舊序列；已到③的繼續到出場。整段已載入資料 point-in-time 算，不跟可見區間走。
import { smaSeq, fpx } from "./ta-trade";

export const TOL4 = 0.005;
const SD = { s: { nm: "空方", pre: "空", r1: "L1", r2: "L2" }, l: { nm: "多方", pre: "多", r1: "H1", r2: "H2" } };
export const step4Name = (sd, k) => SD[sd].pre + (k === "x" ? "利" : k);
const isLive = (st) => st === "wait2" || st === "wait3";

// 全部序列（含作廢，黃金比對用）。bars＝[{h,l,c}]（只放已收完的 K）；sd＝"s" 空方｜"l" 多方。
// 回 [{status, L1, L2, s1:{i,p,c,ma5,ma10,ma20}, s2, s3, s4（停損出場）, sx（利出場）, ex:{type,i,p,ma5,entry,pnl,pct}}]（缺的步驟 null；L1／L2 多方放 H1／H2）
// status：wait2／wait3／wait4（③後持有中）／done／void_close_below_L1（②前收盤破 L1）／void_newer_s2（較新序列走到②）
export function fourStepAll(bars, sd, tol = TOL4) {
  const g = sd === "l" ? -1 : 1, n = bars.length;
  const lo = bars.map((b) => (g === 1 ? Number(b.l) : -Number(b.h))), c = bars.map((b) => g * Number(b.c));
  const m5 = smaSeq(c, 5), m10 = smaSeq(c, 10), m20 = smaSeq(c, 20);
  const above = c.map((x, i) => Number.isFinite(m20[i]) && x > m5[i] && x > m10[i]);
  const seqs = [];
  let open = [];
  for (let k = 0; k < n; k++) {
    for (const s of seqs) {   // ③後：先看停損再看 MA5（同根＝停損）
      if (s.status !== "wait4") continue;
      const type = c[k] > s.L2 ? "stop" : c[k] > m5[k] ? "profit" : null;
      if (type) { s.status = "done"; s.ex = { type, i: k, p: c[k], ma5: m5[k] }; }
    }
    for (const s of open) {
      if (!isLive(s.status)) continue;
      if (!s.s2) {
        if (Math.abs(lo[k] - s.L1) <= Math.abs(s.L1) * tol && c[k] > s.L1) {
          s.s2 = { i: k, p: lo[k] }; s.L2 = lo[k]; s.status = "wait3";
          for (const o of open) if (o !== s && o.s1.i < s.s1.i && isLive(o.status)) o.status = "void_newer_s2";
        } else if (c[k] < s.L1) s.status = "void_close_below_L1";
      } else if (c[k] < s.L2) { s.s3 = { i: k, p: c[k] }; s.status = "wait4"; }
    }
    open = open.filter((s) => isLive(s.status));
    if (k > 0 && above[k] && c[k] < m20[k] && !above[k - 1]) {
      const s = { status: "wait2", L1: lo[k], L2: null, s1: { i: k, p: lo[k], c: c[k], ma5: m5[k], ma10: m10[k], ma20: m20[k] }, s2: null, s3: null, ex: null };
      seqs.push(s); open.push(s);
    }
  }
  // 翻回原價；損益照實算（「利」出場也可能是負的）
  return seqs.map((s) => {
    const f = (q) => (q ? { ...q, p: g * q.p } : null), s1 = s.s1;
    const o = { status: s.status, L1: g * s.L1, L2: s.L2 == null ? null : g * s.L2,
      s1: { i: s1.i, p: g * s1.p, c: g * s1.c, ma5: g * s1.ma5, ma10: g * s1.ma10, ma20: g * s1.ma20 }, s2: f(s.s2), s3: f(s.s3), s4: null, sx: null, ex: null };
    if (s.ex) {
      const e = o.s3.p, p = g * s.ex.p, pnl = g * (e - p);
      o.ex = { type: s.ex.type, i: s.ex.i, p, ma5: g * s.ex.ma5, entry: e, pnl, pct: (pnl / e) * 100 };
      o[s.ex.type === "stop" ? "s4" : "sx"] = { i: s.ex.i, p };
    }
    return o;
  });
}

// 圖上用：作廢的序列完全不畫
export const fourStep = (bars, sd) => fourStepAll(bars, sd).filter((s) => !s.status.startsWith("void"));

// ───────── 浮動說明（bars＝整段 K，含 t；時間照引擎給的商品當地時間） ─────────
const KS = [1, 2, 3, 4, "x"];
const sgn = (x) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pnl4 = (ex) => sgn(ex.pnl) + " 點（" + sgn(ex.pct) + "%）";
const md = (t) => String(t || "").slice(5);
function status4(sd, s) {
  const p = SD[sd].pre;
  return s.status === "wait4" ? p + "3 後持有中" : s.status === "wait3" ? p + "2 後等" + p + "3" : s.status === "wait2" ? p + "1 後等" + p + "2" : "";
}
const f2 = (x) => fpx(Number(x).toFixed(2));

// 某一步 → {title, sub, rows, status, cls}；k＝1～4 或 "x"（利）
export function info4(sd, s, k, bars) {
  const S = SD[sd], e = s["s" + k], b = bars[e.i], sh = sd === "s", m = s.s1;
  let px, why;
  if (k === 1) {
    px = S.r1 + " " + fpx(s.L1);
    why = "收盤 " + fpx(b.c) + (sh ? " 站上" : " 跌破") + " MA5 " + f2(m.ma5) + "、MA10 " + f2(m.ma10) + "，仍在 MA20 " + f2(m.ma20) + (sh ? " 下；" : " 上；") + S.r1 + "＝這根" + (sh ? "最低 " : "最高 ") + fpx(s.L1);
  } else if (k === 2) {
    const x = sh ? b.l : b.h, d = (x / s.L1 - 1) * 100;
    px = S.r2 + " " + fpx(s.L2);
    why = (sh ? "最低 " : "最高 ") + fpx(x) + " 回測 " + S.r1 + " " + fpx(s.L1) + "（" + (d >= 0 ? "+" : "−") + Math.abs(d).toFixed(2) + "%），收盤 " + fpx(b.c) + (sh ? " 守在 " : " 壓在 ") + S.r1 + (sh ? " 上；" : " 下；") + S.r2 + "＝這根" + (sh ? "最低" : "最高");
  } else if (k === 3) {
    px = "收盤 " + fpx(b.c); why = "收盤 " + fpx(b.c) + (sh ? " 跌破 " : " 突破 ") + S.r2 + " " + fpx(s.L2);
  } else if (k === 4) {
    px = "收盤 " + fpx(b.c); why = "收盤 " + fpx(b.c) + (sh ? " 站回 " : " 跌回 ") + S.r2 + " " + fpx(s.L2) + (sh ? "" : " 下");
  } else {
    px = "收盤 " + fpx(b.c); why = "收盤 " + fpx(b.c) + (sh ? " 站上" : " 跌破") + " MA5 " + f2(s.ex.ma5);
  }
  const rows = [["價位", px], ["條件", why]];
  if (k === 4 || k === "x") rows.unshift(["出場", k === 4 ? "停損" : "獲利出場"]), rows.push(["損益", pnl4(s.ex) + "，" + step4Name(sd, 3) + " 進場 " + fpx(s.ex.entry)]);
  rows.push(["序列", KS.filter((j) => s["s" + j]).map((j) => step4Name(sd, j) + " " + md(bars[s["s" + j].i].t)).join(" → ")]);
  return { title: S.nm + "四步 " + step4Name(sd, k), sub: String(b.t), rows, status: status4(sd, s), cls: sd + k };
}

// L2／H2 虛線 → {title, sub, rows, status, cls}
export function l2Info4(sd, s, bars) {
  const S = SD[sd], sh = sd === "s", x = s.s4 || s.sx;
  const end = s.s4 ? step4Name(sd, 4) + " 收盤 " + fpx(bars[s.s4.i].c) + (sh ? " 站回" : " 跌回")
    : s.sx ? step4Name(sd, "x") + " 收盤 " + fpx(bars[s.sx.i].c) + (sh ? " 站上" : " 跌破") + " MA5 " + f2(s.ex.ma5)
    : s.s3 ? "還沒出場（持有中）" : (sh ? "還沒跌破" : "還沒突破") + "（等" + step4Name(sd, 3) + "）";
  const rows = [["來源", step4Name(sd, 2) + " " + md(bars[s.s2.i].t) + " 那根" + (sh ? "最低" : "最高")], ["結束", end]];
  if (x) rows.push(["損益", pnl4(s.ex)]);
  return { title: S.r2 + " " + fpx(s.L2), sub: bars[s.s2.i].t + " 起" + (x ? "，到 " + bars[x.i].t : "，到最新一根"), rows, status: status4(sd, s),
    cls: sd + (s.s4 ? 4 : s.sx ? "x" : s.s3 ? 3 : 2) };
}
