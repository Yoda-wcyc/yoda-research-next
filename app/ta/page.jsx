"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// 會員技術分析頁（少數指定付費會員·2026-09-27）
//
// 進來的路：報告 iframe 裡的 ta-pick.js 勾選 → 開新分頁 /ta?r=<reportId>&t=A,B,…&d=YYYYMMDD#k=<TA通行票>
//   ① 從 #k 讀票 → 存 sessionStorage（重新整理還在）→ replaceState 抹掉 hash（網址列、分享、瀏覽紀錄都不留票）
//   ② POST /api/ta-data mode:'summary'（一次載入）→ 左 1/4 固定清單（搜尋／排序／↑↓ 切換，自己捲動）
//   ③ 右 3/4 只顯示選中那一檔的明細：選到才去拿（mode:'detail'，連同清單上前後幾檔、一次最多 25 檔），取過的留在頁面記憶體
//      右欄頂部分頁「單檔明細｜全部總表」：總表每欄可排序、點一列＝切到那檔明細；網址 #s=<代號> 記住目前選的（重新整理回同一檔）
// 沒票、票過期、不在名單 → 只顯示一句話，不透露功能細節。
//
// 內容（Yoda 2026-09-27 定案「三訊號」，資料 v:2／schema 'sig3-1'，算法全在 Skill\analyze_symbol.py 檔頭）：
//   ① 前五大量 ② 跳空缺口 ③ 多空排列 ＋ 日線支撐／壓力各一條（今收 ±10% 內最強，無則範圍外最強＝pick_scope 'beyond'）。
//   不給停損／目標價／信心分／ADX／布林。
//   讀到舊版（v1）資料：頁首與右欄顯示「此報告的技術分析資料是舊版，更新中」，清單照常列代號，不去拿明細。
//   預留欄位（引擎之後才加；資料有就顯示、沒有就整欄不出現）：gaps.items[].trend／position／seq／type／type_short／notes
//   → 缺口表「趨勢・位置・第幾個・類型」四欄＋圖上缺口旁一個字（突／逃／竭／彈／島）；gaps.islands[] → 缺口表下一行；
//   top_volume.items[].trend／position → 大量表「趨勢／位置」欄、read → 表下逐根列；summary badge.gap_type → 左欄「缺」徽章改顯示它。

const SS_KEY = "yoda_ta_k";
const PAGE = 25;
const OLD_MSG = "此報告的技術分析資料是舊版，更新中";

// ───────── 小工具 ─────────
function fnum(x, nd = 2) {
  if (x === null || x === undefined || x === "") return "—";
  const v = Number(x);
  if (!Number.isFinite(v)) return String(x);
  if (Math.abs(v - Math.round(v)) < 1e-9 && Math.abs(v) >= 1) return String(Math.round(v));
  const s = v.toFixed(nd);
  return s.indexOf(".") >= 0 ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}
function fpct(x, sign = true) {
  if (x === null || x === undefined || x === "") return "—";
  const v = Number(x);
  if (!Number.isFinite(v)) return "—";
  return (sign && v > 0 ? "+" : "") + fnum(v) + "%";
}
function f1(x) { const v = Number(x); return x === null || x === undefined || !Number.isFinite(v) ? "—" : v.toFixed(1); }
function fvol(v, market) {
  const x = Number(v);
  if (v === null || v === undefined || !Number.isFinite(x)) return "—";
  if (market === "tw") return Math.round(x / 1000).toLocaleString("en-US");   // 股 → 張
  return (x / 1e6).toFixed(1) + "M";
}
function ud(x) { const v = Number(x); return x === null || x === undefined || !Number.isFinite(v) || v === 0 ? "" : v > 0 ? "up" : "dn"; }
function d8(s) { const m = String(s || "").match(/(\d{4})-?(\d{2})-?(\d{2})/); return m ? m[1] + "-" + m[2] + "-" + m[3] : ""; }
function g(o, ...path) { let x = o; for (const p of path) { if (!x || typeof x !== "object") return undefined; x = x[p]; } return x; }
function nz(x) { return x === null || x === undefined || x === "" ? null : Number(x); }
const chgOf = (r) => (r ? (r.chg_1d_pct !== undefined ? r.chg_1d_pct : r.chg1d) : null);   // v2 chg_1d_pct／v1 chg1d
const isSig = (r) => !!(r && (r.badge || r.key));                                            // v2 的 summary 列

// ───────── 徽章（清單／總表／明細頂部共用）─────────
// 量：今收相對最大量那根 K（上方紅、下方綠、區間灰）；缺：上／下最近未補缺口（顏色看較近那個：向上缺口紅、向下缺口綠）；
// 排：短線・中長線排列（多紅、空綠、糾／資料不足灰）；撐壓：選中那條壓力／支撐的距離（距離不分多空，灰）。
const REL_TXT = { 1: "上方", 0: "區間", "-1": "下方" };
function toneN(v) { return v === 1 ? "up" : v === -1 ? "dn" : ""; }
function volWord(r) {
  const k = g(r, "key", "vol_rel");
  if (k === 1 || k === 0 || k === -1) return REL_TXT[k];
  const t = String(g(r, "badge", "vol") || "");
  return t.indexOf("上方") >= 0 ? "上方" : t.indexOf("下方") >= 0 ? "下方" : t.indexOf("區間") >= 0 ? "區間" : "無";
}
const squeeze = (t) => String(t || "—").replace(/(上|下|壓|撐) /g, "$1").replace(/｜/g, " ");
function gapTone(r) { const v = nz(g(r, "key", "gap_near_pct")); return v === null || v === 0 ? "" : v < 0 ? "up" : "dn"; }
function maHalves(r) {
  const t = String(g(r, "badge", "ma") || "短—・中—");
  const [a, b] = t.split("・");
  return [[a || "短—", toneN(g(r, "key", "ma_short"))], [b || "中—", toneN(g(r, "key", "ma_mid"))]];
}
function Badges({ r, full }) {
  const b = r.badge || {};
  const [ms, mm] = maHalves(r);
  return (
    <div className={"ta-bds" + (full ? " full" : "")}>
      <span className={"ta-bd v " + toneN(g(r, "key", "vol_rel"))} title={"量：" + (b.vol || "—")}><i>量</i>{full ? b.vol || "—" : volWord(r)}</span>
      <span className={"ta-bd gp " + gapTone(r)} title={"缺：" + (b.gap || "—") + (b.gap_type ? "｜" + b.gap_type : "") + "（上＝上方最近未補缺口、下＝下方最近未補缺口，距現價）"}>
        <i>缺</i>{full ? (b.gap || "—") + (b.gap_type ? "｜" + b.gap_type : "") : b.gap_type ? String(b.gap_type) : squeeze(b.gap)}
      </span>
      <span className="ta-bd ma" title={"排：" + (b.ma || "—") + "（短＝SMA5／10／20、中＝SMA20／60／120）"}><i>排</i><span className={ms[1]}>{ms[0]}</span>・<span className={mm[1]}>{mm[0]}</span></span>
      <span className="ta-bd sr" title={"撐壓：" + (b.sr || "—") + "（選中那條壓力／支撐距現價）"}><i>撐壓</i>{full ? b.sr || "—" : squeeze(b.sr)}</span>
    </div>
  );
}

async function api(body) {
  const res = await fetch("/api/ta-data", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
  });
  let j = null;
  try { j = await res.json(); } catch (e) { j = { ok: false, reason: "error", error: "伺服器回應無法解析（HTTP " + res.status + "）" }; }
  return j;
}

// ───────── 可排序表格（B-13：每一欄都能排序）─────────
function SortTable({ cols, rows, rowKey, className, onRowClick, rowClass }) {
  const [sk, setSk] = useState(null);
  const [dir, setDir] = useState(1);
  const sorted = useMemo(() => {
    if (sk === null) return rows;
    const c = cols[sk];
    const val = (r) => (c.sort ? c.sort(r) : null);
    const out = rows.slice();
    out.sort((a, b) => {
      const x = val(a), y = val(b);
      const xn = x === null || x === undefined || x === "" || (typeof x === "number" && !Number.isFinite(x));
      const yn = y === null || y === undefined || y === "" || (typeof y === "number" && !Number.isFinite(y));
      if (xn && yn) return 0;
      if (xn) return 1;           // 空值一律排最後
      if (yn) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return String(x).localeCompare(String(y), "zh-Hant", { numeric: true }) * dir;
    });
    return out;
  }, [rows, cols, sk, dir]);
  const click = (i) => {   // 第一次點：欄位有 first 用 first（1 升冪／−1 降冪），否則數字欄降冪、文字欄升冪
    if (sk === i) setDir(-dir);
    else { setSk(i); setDir(cols[i].first || (cols[i].num ? -1 : 1)); }
  };
  return (
    <table className={"ta-tbl " + (className || "")}>
      <thead>
        <tr>
          {cols.map((c, i) => (
            <th key={i} className={c.num ? "r" : ""} onClick={() => click(i)} title={c.title || "點一下排序"}>
              {c.label}
              {sk === i ? <span className="arr">{dir > 0 ? "▲" : "▼"}</span> : null}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r, ri) => (
          <tr key={rowKey ? rowKey(r) : ri} className={rowClass ? rowClass(r) : ""} onClick={onRowClick ? () => onRowClick(r) : undefined}>
            {cols.map((c, i) => (
              <td key={i} className={(c.num ? "r " : "") + (c.cls || "")}>{c.render(r)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ───────── K 線圖（120 根＋量；底色固定深色，白色撐壓線才看得見）─────────
const MA_COLORS = [["sma5", "MA5", "#f0c040"], ["sma10", "MA10", "#ff8a4c"], ["sma20", "MA20", "#56c1d6"], ["sma60", "MA60", "#8fa8ff"], ["sma120", "MA120", "#c78be8"]];
const K_UP = "#e0525e", K_DN = "#3fae7a", GOLD = "#ffc94a";
const MARKS = "①②③④⑤";
const SR_BEYOND = "10% 內無，取範圍外最強";
function mark(rank) { return rank >= 1 && rank <= MARKS.length ? MARKS[rank - 1] : String(rank || "?"); }
function srcAbbr(sources) {
  const out = [];
  for (const s0 of sources || []) {
    const s = String(s0);
    let a;
    if (s.startsWith("大量K")) a = "量";
    else if (s.startsWith("缺口")) a = "缺";
    else { const m = s.match(/觸及\s*(\d+)/); a = m ? "觸" + m[1] : s.slice(0, 2); }
    if (!out.includes(a)) out.push(a);
  }
  return out.join("·");
}

function KChart({ d }) {
  const raw = g(d, "chart", "bars") || [];
  const bars = raw.map((b) => (Array.isArray(b) ? { date: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] } : b));
  const n = bars.length;
  if (n < 2) return <div className="ta-nochart">沒有 K 線資料</div>;
  const market = g(d, "meta", "market");
  const sig = d.signals || {};
  const sr = sig.sr_levels || {};
  const lines = [...(sr.support || []).slice(0, 1).map((x) => [x, "sup"]), ...(sr.resistance || []).slice(0, 1).map((x) => [x, "res"])];
  const gaps = (g(sig, "gaps", "items") || []).filter((x) => x.fill !== "full");
  const tv = g(sig, "top_volume", "items") || [];
  const W = 1000, L = 62, R = 178, T = 16, PH = 310, GP = 14, VH = 72, B = 24;
  const H = T + PH + GP + VH + B, pw = W - L - R;
  const vals = [];
  for (const b of bars) { if (b.h != null) vals.push(b.h); if (b.l != null) vals.push(b.l); }
  for (const [x] of lines) if (x.price != null) vals.push(x.price);
  for (const x of gaps) for (const p of [x.open_top, x.open_bottom]) if (p != null) vals.push(p);
  if (!vals.length) return <div className="ta-nochart">沒有 K 線資料</div>;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.05 || hi * 0.01 || 1;
  lo -= pad; hi += pad;
  const step = pw / n, bw = Math.max(1.2, step * 0.62);
  const Y = (p) => T + ((hi - p) / (hi - lo)) * PH;
  const X = (i) => L + step * (i + 0.5);
  const dateI = {};
  bars.forEach((b, i) => { dateI[String(b.date)] = i; });
  const vmax = Math.max(1, ...bars.map((b) => Number(b.v) || 0));
  const VB = T + PH + GP + VH;
  const VY = (v) => VB - (v / vmax) * VH;
  const cid = "tac-" + String(g(d, "meta", "symbol") || "x").replace(/[^0-9A-Za-z]/g, "_");
  const els = [];
  // 格線＋價格軸
  for (let k = 0; k < 6; k++) {
    const p = lo + ((hi - lo) * (k + 0.5)) / 6, y = Y(p);
    els.push(<line key={"g" + k} className="grid" x1={L} x2={L + pw} y1={y} y2={y} />);
    els.push(<text key={"gt" + k} className="ax" x={L - 6} y={y + 4} textAnchor="end">{fnum(p, hi - lo < 50 ? 1 : 0)}</text>);
  }
  els.push(<line key="vbase" className="grid" x1={L} x2={L + pw} y1={VB} y2={VB} />);
  for (let i = 0; i < n; i += 20) {
    const dd = String(bars[i].date || "");
    els.push(<text key={"d" + i} className="ax" x={X(i)} y={H - 7} textAnchor="middle">{i === 0 ? dd.slice(2) : dd.slice(5)}</text>);
  }
  els.push(<text key="dl" className="ax" x={L + pw} y={H - 7} textAnchor="end">{String(bars[n - 1].date || "").slice(5)}</text>);
  els.push(<text key="vl" className="ax" x={L - 6} y={T + PH + GP + 10} textAnchor="end">{market === "tw" ? "量（張）" : "量"}</text>);
  // 未補缺口色塊（紅＝向上缺口、綠＝向下缺口）：未補＝從缺口日畫到右緣；部分回補＝原缺口畫到第一次回補那天，剩下沒補的區間續畫到右緣
  gaps.forEach((x, k) => {
    const i = dateI[String(x.date)];
    if (i === undefined || x.open_top == null || x.open_bottom == null) return;
    const fill = x.dir === "up" ? K_UP : K_DN;
    const x0 = X(i) - step / 2;
    let xs = x0;
    if (x.fill === "partial" && x.fill_date && dateI[String(x.fill_date)] !== undefined && x.top != null && x.bottom != null) {
      const xj = X(dateI[String(x.fill_date)]);
      const y1 = Y(x.top), y2 = Y(x.bottom);
      els.push(<rect key={"ga" + k} className="gapbox0" x={x0} y={y1} width={Math.max(1, xj - x0)} height={Math.max(1, y2 - y1)}
        fill={fill} fillOpacity=".12" clipPath={"url(#" + cid + ")"} data-date={x.date} data-top={x.top} data-bottom={x.bottom} />);
      xs = xj;
    }
    const y1 = Y(x.open_top), y2 = Y(x.open_bottom);
    els.push(<rect key={"gb" + k} className="gapbox" x={xs} y={y1} width={Math.max(1, L + pw - xs)} height={Math.max(1, y2 - y1)}
      fill={fill} fillOpacity=".22" clipPath={"url(#" + cid + ")"}
      data-date={x.date} data-dir={x.dir} data-fill={x.fill} data-top={x.open_top} data-bottom={x.open_bottom} />);
  });
  // K 棒（收 ≥ 開＝紅）＋量柱；前五大量：金框 K 棒＋金色量柱＋①～⑤
  const topI = {};
  for (const t of tv) { const i = dateI[String(t.date)]; if (i !== undefined) topI[i] = t.rank; }
  let prev = null;
  bars.forEach((b, i) => {
    const c = b.c;
    if (c == null) return;
    const op = b.o != null ? b.o : prev != null ? prev : c;
    const h = b.h != null ? b.h : Math.max(op, c);
    const l = b.l != null ? b.l : Math.min(op, c);
    const col = c >= op ? K_UP : K_DN;
    const x = X(i);
    const rk = topI[i];
    els.push(<line key={"w" + i} className="wk" x1={x} x2={x} y1={Y(h)} y2={Y(l)} stroke={col} strokeWidth="1" />);
    const y1 = Y(Math.max(op, c)), y2 = Y(Math.min(op, c));
    els.push(<rect key={"b" + i} className={"bd" + (rk ? " top" : "")} x={x - bw / 2} y={y1} width={bw} height={Math.max(1, y2 - y1)} fill={col}
      stroke={rk ? GOLD : undefined} strokeWidth={rk ? 1.6 : undefined} data-date={b.date} data-rank={rk || undefined} />);
    const v = Number(b.v);
    if (v > 0) {
      els.push(<rect key={"v" + i} className={"vb" + (rk ? " top" : "")} x={x - bw / 2} y={VY(v)} width={bw} height={Math.max(0.5, VB - VY(v))}
        fill={rk ? GOLD : col} fillOpacity={rk ? 1 : 0.55} data-date={rk ? b.date : undefined} />);
    }
    if (rk) {
      els.push(<text key={"m" + i} className="mk" x={x} y={Y(h) - 5} textAnchor="middle" data-date={b.date} data-rank={rk}>{mark(rk)}</text>);
      if (v > 0) els.push(<text key={"mv" + i} className="mk mkv" x={x} y={VY(v) - 3} textAnchor="middle">{mark(rk)}</text>);
    }
    prev = c;
  });
  // 均線（裁在價格區內）
  for (const [key, nm, col] of MA_COLORS) {
    const arr = g(d, "chart", key) || [];
    const segs = []; let cur = [];
    arr.slice(0, n).forEach((v, i) => {
      if (v == null) { if (cur.length > 1) segs.push(cur); cur = []; }
      else cur.push(X(i).toFixed(1) + "," + Y(v).toFixed(1));
    });
    if (cur.length > 1) segs.push(cur);
    segs.forEach((sg, k) => els.push(<polyline key={key + k} className={"ma " + key} data-ma={nm} points={sg.join(" ")} fill="none" stroke={col}
      strokeWidth="1.2" strokeOpacity=".9" clipPath={"url(#" + cid + ")"} />));
  }
  // 缺口類型（欄位 type_short 有才畫）：缺口日位置、色塊左側標一個字（突／逃／竭／彈／島）；已補的缺口淡一點
  let typed = 0;
  (g(sig, "gaps", "items") || []).forEach((x, k) => {
    const i = dateI[String(x.date)];
    const ts = x.type_short;
    if (i === undefined || !ts) return;
    const top = x.top != null ? x.top : x.open_top, bot = x.bottom != null ? x.bottom : x.open_bottom;
    if (top == null || bot == null) return;
    typed++;
    els.push(<text key={"gl" + k} className={"gl " + (x.dir === "up" ? "up" : "dn") + (x.fill === "full" ? " filled" : "")} x={X(i) - step / 2 - 3}
      y={(Y(top) + Y(bot)) / 2 + 4} textAnchor="end" data-date={x.date} data-type={ts}>
      {String(ts)}{x.type ? <title>{x.type + (x.notes ? "：" + x.notes : "")}</title> : null}
    </text>);
  });
  // 支撐（白實線）／壓力（白虛線）：各只一條；線尾標價位＋來源縮寫（量／缺／觸N；測＝正在測試），pick_scope＝beyond 多一行註記
  const lab = [];
  lines.forEach(([x, side]) => {
    if (x.price == null) return;
    const y = Y(x.price);
    els.push(<line key={"sr" + side} className={"sr-line " + side} x1={L} x2={L + pw} y1={y} y2={y} stroke="#ffffff" strokeWidth="1.8"
      strokeDasharray={side === "res" ? "7 5" : undefined} data-kind={side} data-price={x.price} data-scope={x.pick_scope || ""} />);
    const t = (side === "sup" ? "撐 " : "壓 ") + fnum(x.price) + (srcAbbr(x.sources) ? " " + srcAbbr(x.sources) : "") + (x.testing ? " 測" : "");
    lab.push([y, t, side, x.pick_scope === "beyond" ? SR_BEYOND : ""]);
  });
  lab.sort((a, b) => a[0] - b[0]);
  const hs = lab.map((z) => 14 + (z[3] ? 13 : 0));
  const ys = []; let last = -1e9, lh = 0;
  lab.forEach(([y], k) => { const ny = Math.max(y, last + lh); ys.push(ny); last = ny; lh = hs[k]; });
  const over = ys.length ? ys[ys.length - 1] + hs[hs.length - 1] - 14 - (T + PH) : 0;
  if (over > 0) {
    for (let k = 0; k < ys.length; k++) ys[k] -= over;
    for (let k = ys.length - 2; k >= 0; k--) ys[k] = Math.min(ys[k], ys[k + 1] - hs[k]);
  }
  lab.forEach(([y, t, side, nt], k) => {
    const ty = ys[k];
    els.push(<line key={"lk" + side} x1={L + pw} x2={L + pw + 7} y1={y} y2={ty} stroke="#ffffff" strokeWidth="1" strokeOpacity=".6" />);
    els.push(<text key={"lt" + side} className={"srl " + side} x={L + pw + 10} y={ty + 4}>{t}</text>);
    if (nt) els.push(<text key={"ln" + side} className={"srn " + side} x={L + pw + 10} y={ty + 17}>{nt}</text>);
  });
  const lc = bars[n - 1].c;
  if (lc != null) els.push(<circle key="lc" className="lastc" cx={X(n - 1)} cy={Y(lc)} r="3" fill="#ffffff" />);
  return (
    <>
      <svg className="ta-k" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="日 K 線圖" data-n={n}>
        <rect x="0" y="0" width={W} height={H} className="kbg" fill="#0b0f15" />
        <defs><clipPath id={cid}><rect x={L} y={T} width={pw} height={PH} /></clipPath></defs>
        {els}
      </svg>
      <div className="ta-cnote">
        怎麼看：最近 {n} 根日 K（紅漲綠跌），下方是成交量；均線
        {MA_COLORS.map(([k, nm, col]) => <span key={k}><i className="sw" style={{ color: col }}></i>{nm}</span>)}；
        <span className="lg"><i className="sw" style={{ color: "#fff" }}></i></span>白實線＝支撐、
        <span className="lg"><i className="sw dash" style={{ color: "#fff" }}></i></span>白虛線＝壓力
        （各只畫一條：今收 ±10% 內強度最高的，該側 10% 內沒線才取範圍外最強並加註），右側標價位與來源：量＝前五大量 K 的高低、缺＝未補缺口邊緣、觸N＝觸及 N 天、測＝正在測試；
        <i className="bx" style={{ background: K_UP }}></i>向上缺口<i className="bx" style={{ background: K_DN }}></i>向下缺口
        （色塊＝還沒補的區間，畫到右緣；部分回補的原缺口畫到第一次回補那天）；
        {typed ? <>缺口旁的一個字＝缺口類型（突／逃／竭／彈／島，完整名稱與說明見跳空缺口表「類型」欄；淡色＝已補）；</> : null}
        <span className="gd">金框 K 棒／金色量柱</span>＋①～⑤＝前五大量 K（① 量最大）。
      </div>
    </>
  );
}

// ───────── 圖下四張表 ─────────
const FILL_ZH = { none: "未補", partial: "部分回補", full: "已補" };
const REL_CLS = { "在上方": "up", "在下方": "dn" };
const has = (v) => v !== null && v !== undefined && v !== "";
const txt = (v) => (has(v) ? (typeof v === "object" ? JSON.stringify(v) : String(v)) : "—");
// 預留欄位（引擎之後才加）：資料裡任一列有這個欄位才出現該欄，沒有就整欄不顯示
function optCols(rows, specs) {
  return specs.filter((c) => rows.some((x) => has(x[c.f]))).map((c) => ({
    label: c.label, title: c.title, num: c.num, cls: c.cls,
    render: c.render || ((x) => txt(x[c.f])),
    sort: (x) => (has(x[c.f]) ? (typeof x[c.f] === "number" ? x[c.f] : String(x[c.f])) : null),
  }));
}
// 島狀（signals.gaps.islands[]）：格式未定，先通用顯示——有說明文字就用說明，否則拼日期／方向／天數，再不行列出簡單欄位
const ISLAND_KEYS = { start: "起", end: "迄", from: "起", to: "迄", dir: "方向", days: "天數", bars: "根數", date: "日期", type: "類型" };
function islandText(x) {
  if (!x || typeof x !== "object") return txt(x);
  for (const k of ["text", "note", "notes", "desc", "read"]) if (typeof x[k] === "string" && x[k]) return x[k];
  const a = x.start || x.from || x.start_date, b = x.end || x.to || x.end_date;
  const dir = x.dir === "up" ? "向上" : x.dir === "down" ? "向下" : x.dir;
  if (a || b) return [(a || "?") + "～" + (b || "?"), dir, has(x.days) ? x.days + " 天" : has(x.bars) ? x.bars + " 根" : ""].filter(Boolean).join("，");
  return Object.entries(x).filter(([, v]) => has(v) && typeof v !== "object").map(([k, v]) => (ISLAND_KEYS[k] || k) + " " + v).join("，") || "—";
}

function TopVolume({ d }) {
  const tv = g(d, "signals", "top_volume") || {};
  const market = g(d, "meta", "market");
  const rows = tv.items || [];
  const cols = [
    { label: "#", render: (x) => mark(x.rank), sort: (x) => x.rank },
    { label: "日期", render: (x) => x.date, sort: (x) => x.date },
    { label: "幾天前", num: true, render: (x) => x.days_ago, sort: (x) => nz(x.days_ago) },
    { label: market === "tw" ? "量（張）" : "量（股）", num: true, render: (x) => fvol(x.volume, market), sort: (x) => nz(x.volume) },
    { label: "量倍數", num: true, title: "當天量 ÷ 當天之前 20 天均量", render: (x) => (x.vol_ratio == null ? "—" : f1(x.vol_ratio) + "x"), sort: (x) => nz(x.vol_ratio) },
    { label: "漲跌", num: true, render: (x) => <span className={ud(x.chg_pct)}>{fpct(x.chg_pct)}</span>, sort: (x) => nz(x.chg_pct) },
    { label: "K 棒", render: (x) => x.candle || "—", sort: (x) => x.candle || "" },
    { label: "收在", title: "收盤落在當天區間的哪一段", render: (x) => x.close_pos || "—", sort: (x) => nz(x.close_pos_ratio) },
    { label: "最高＝關卡", num: true, render: (x) => <>{fnum(x.high)} <span className="mut">({fpct(x.dist_high_pct)})</span></>, sort: (x) => nz(x.high) },
    { label: "最低＝關卡", num: true, render: (x) => <>{fnum(x.low)} <span className="mut">({fpct(x.dist_low_pct)})</span></>, sort: (x) => nz(x.low) },
    { label: "現價在", render: (x) => <b className={REL_CLS[x.relation] || ""}>{x.relation || "—"}</b>, sort: (x) => ({ "在上方": 1, "區間內": 0, "在下方": -1 })[x.relation] },
    ...(rows.some((x) => has(x.trend) || has(x.position)) ? [{   // 預留：趨勢／位置（有才出現）
      label: "趨勢／位置", render: (x) => txt(x.trend) + "／" + txt(x.position), sort: (x) => (has(x.trend) || has(x.position) ? txt(x.trend) + txt(x.position) : null),
    }] : []),
  ];
  const reads = rows.filter((x) => has(x.read));   // 預留：解讀（有才出現；文字長，放表下逐根列）
  return (
    <div className="ta-block" data-blk="vol">
      <div className="ta-cap">① 前五大量 <span className="mut">近 {g(d, "signals", "window_bars") || "—"} 根日 K 量最大的 5 根；那根的最高／最低就是關卡，括號＝關卡距現價</span></div>
      {rows.length ? <div className="ta-hs"><SortTable className="ta-dt" cols={cols} rows={rows} rowKey={(x) => "v" + x.rank} /></div>
        : <div className="ta-empty">視窗內沒有成交量資料</div>}
      {reads.length ? (
        <dl className="ta-reads">{reads.map((x) => <div key={x.rank} className="ta-rule"><dt>{mark(x.rank)} {x.date}</dt><dd>{txt(x.read)}</dd></div>)}</dl>
      ) : null}
    </div>
  );
}

function Gaps({ d }) {
  const gp = g(d, "signals", "gaps") || {};
  const rows = gp.items || [];
  const cols = [
    { label: "日期", render: (x) => x.date, sort: (x) => x.date },
    { label: "方向", render: (x) => <span className={x.dir === "up" ? "up" : "dn"}>{x.dir === "up" ? "向上" : "向下"}</span>, sort: (x) => x.dir },
    ...optCols(rows, [
      { f: "trend", label: "趨勢" },
      { f: "position", label: "位置" },
      { f: "seq", label: "第幾個", num: true },
      { f: "type", label: "類型", render: (x) => (has(x.type) ? (
        <span className={x.notes ? "ta-tip" : ""} title={has(x.notes) ? txt(x.notes) : undefined}>{has(x.type_short) ? <b className="ta-gt">{txt(x.type_short)}</b> : null}{txt(x.type)}</span>
      ) : "—") },
    ]),
    { label: "缺口（下緣～上緣）", num: true, title: "缺口原本的區間；排序依下緣", render: (x) => fnum(x.bottom) + "～" + fnum(x.top), sort: (x) => nz(x.bottom) },
    { label: "幅度", num: true, render: (x) => fpct(x.size_pct, false), sort: (x) => nz(x.size_pct) },
    { label: "量倍數", num: true, title: "缺口當天量 ÷ 之前 20 天均量", render: (x) => (x.vol_ratio == null ? "—" : f1(x.vol_ratio) + "x"), sort: (x) => nz(x.vol_ratio) },
    { label: "回補（日期）", title: "部分回補＝第一次碰進缺口那天；已補＝完全補上那天", render: (x) => (
      <>{FILL_ZH[x.fill] || x.fill || "—"}{x.fill_date ? <span className="mut"> {x.fill_date}</span> : null}</>
    ), sort: (x) => ({ none: 0, partial: 1, full: 2 })[x.fill] * 1e9 + (x.fill_date ? Number(String(x.fill_date).replace(/\D/g, "")) : 0) },
    { label: "未補區間", num: true, render: (x) => (x.fill !== "full" && x.open_bottom != null ? fnum(x.open_bottom) + "～" + fnum(x.open_top) : "—"), sort: (x) => (x.fill !== "full" ? nz(x.open_bottom) : null) },
    { label: "距現價", num: true, render: (x) => <span className={ud(x.dist_pct)}>{fpct(x.dist_pct)}</span>, sort: (x) => (x.dist_pct == null ? null : Math.abs(Number(x.dist_pct))) },
  ];
  return (
    <div className="ta-block" data-blk="gap">
      <div className="ta-cap">② 跳空缺口 <span className="mut">近 {g(d, "signals", "window_bars") || "—"} 根全部 {gp.n || 0} 個（未補／部分回補 {gp.n_open || 0}、已補 {gp.n_filled || 0}）；未補依離現價近到遠、已補依日期新到舊</span></div>
      {rows.length ? (
        <div className="ta-win10"><SortTable className="ta-dt" cols={cols} rows={rows} rowKey={(x) => x.date + x.dir} rowClass={(x) => (x.fill === "full" ? "filled" : "")} /></div>
      ) : <div className="ta-empty">近 {g(d, "signals", "window_bars") || "—"} 根沒有跳空缺口</div>}
      {Array.isArray(gp.islands) && gp.islands.length ? (
        <div className="ta-islands">島狀 {gp.islands.length} 個：{gp.islands.map((x, i) => <span key={i}>{i ? "；" : ""}{islandText(x)}</span>)}</div>
      ) : null}
    </div>
  );
}

function MaAlign({ d }) {
  const ma = g(d, "signals", "ma_align") || {};
  const rows = [["short", "短線（SMA5／10／20）"], ["mid", "中長線（SMA20／60／120）"]].map(([k, nm]) => ({ k, nm, ...(ma[k] || {}) }));
  const stZh = (s) => (s === "insufficient" ? "資料不足" : s || "—");
  const stCls = (s) => (s === "多頭排列" ? "up" : s === "空頭排列" ? "dn" : "mut");
  const note = (x) => {
    if ((x.state === "多頭排列" || x.state === "空頭排列") && x.nearest_break) {
      const nb = x.nearest_break;
      return <>最接近被破壞：{nb.a} {fnum(nb.a_value)} 與 {nb.b} {fnum(nb.b_value)}（差 {fpct(nb.gap_pct, false)}）</>;
    }
    return x.why || "—";
  };
  const cols = [
    { label: "組", render: (x) => x.nm, sort: (x) => x.k },
    { label: "狀態", render: (x) => <b className={stCls(x.state)}>{stZh(x.state)}</b>, sort: (x) => ({ "多頭排列": 1, "糾結": 0, "空頭排列": -1 })[x.state] },
    { label: "已成立", title: "目前狀態連續第幾天（含今天）", render: (x) => (x.days == null ? "—" : <>第 {x.days_capped ? "≥" : ""}{x.days} 天 <span className="mut">（{x.since} 起）</span></>), sort: (x) => nz(x.days) },
    { label: "不成立原因／最接近被破壞", cls: "wrap", render: note, sort: (x) => x.why || "" },
    { label: "均線值（今−昨）", cls: "wrap", render: (x) => (
      <span className="ta-mas">收盤 <b>{fnum(x.close)}</b>{(x.lines || []).map((l) => (
        <span key={l.name}>{l.name} <b>{fnum(l.value)}</b> <span className={ud(l.slope)}>({Number(l.slope) > 0 ? "+" : ""}{fnum(l.slope, 4)})</span></span>
      ))}</span>
    ), sort: (x) => nz(x.close) },
  ];
  return (
    <div className="ta-block" data-blk="ma">
      <div className="ta-cap">③ 多空排列 <span className="mut">多頭＝收盤 &gt; 第一條 &gt; 第二條 &gt; 第三條，且三條都比昨天高；空頭相反；其他＝糾結</span></div>
      <div className="ta-hs"><SortTable className="ta-dt" cols={cols} rows={rows} rowKey={(x) => x.k} /></div>
    </div>
  );
}

function SrLevels({ d }) {
  const sr = g(d, "signals", "sr_levels") || {};
  const rows = [...(sr.resistance || []).slice(0, 1), ...(sr.support || []).slice(0, 1)];
  const cols = [
    { label: "種類", render: (x) => <b className={x.kind === "resistance" ? "dn" : "up"}>{x.kind === "resistance" ? "壓力" : "支撐"}</b>, sort: (x) => x.kind },
    { label: "價位", num: true, render: (x) => <b>{fnum(x.price)}</b>, sort: (x) => nz(x.price) },
    { label: "距現價", num: true, render: (x) => fpct(x.dist_pct), sort: (x) => nz(x.dist_pct) },
    { label: "強度", num: true, title: "大量 K 量倍數（上限 5）＋每個缺口 2＋觸及天數", render: (x) => fnum(x.strength, 1), sort: (x) => nz(x.strength) },
    { label: "觸及", num: true, render: (x) => ((x.touch_dates || []).length ? <span title={(x.touch_dates || []).join("、")}>{x.touches} 天</span> : "0"), sort: (x) => nz(x.touches) },
    { label: "最後觸及", render: (x) => x.last_touch_date || "—", sort: (x) => x.last_touch_date || "" },
    { label: "來源", cls: "wrap", render: (x) => (x.sources || []).join("｜") || "—", sort: (x) => (x.sources || []).join("") },
    { label: "註", cls: "wrap warn", render: (x) => [x.testing ? "正在測試" : "", x.pick_scope === "beyond" ? SR_BEYOND : ""].filter(Boolean).join("、"), sort: (x) => (x.pick_scope === "beyond" ? 1 : 0) + (x.testing ? 2 : 0) },
  ];
  return (
    <div className="ta-block" data-blk="sr">
      <div className="ta-cap">④ 支撐／壓力 <span className="mut">各只一條：先在今收 ±10% 內挑強度最高的，該側 10% 內沒線才取範圍外最強；容差 {fnum(sr.tol)}（ATR14 {fnum(sr.atr14)}）</span></div>
      {rows.length ? <div className="ta-hs"><SortTable className="ta-dt" cols={cols} rows={rows} rowKey={(x) => x.kind} rowClass={(x) => (x.kind === "resistance" ? "sr-res" : "sr-sup")} /></div>
        : <div className="ta-empty">沒有候選價位</div>}
    </div>
  );
}

const RULES = [
  ["① 前五大量", "近 120 根日 K 裡成交量最大的 5 根（同量取較近的）。量倍數＝當天量 ÷ 當天「之前」20 天的平均量。K 棒：實體占全距 ≥0.6 叫長紅／長黑、≤0.1 叫十字，其餘紅K／黑K。收在：收盤落在當天區間上 1/3＝高檔、下 1/3＝低檔，其餘中間。那根的最高、最低就是關卡：今收高過最高＝在上方、低過最低＝在下方，其餘＝區間內。"],
  ["② 跳空缺口", "近 120 根的全部跳空，不設門檻。向上＝今天最低高過昨天最高；向下＝今天最高低過昨天最低。之後有 K 碰進缺口＝部分回補（沒碰到的那段叫未補區間），碰到另一邊＝已補。距現價只算還沒補完的：向上缺口一定在現價下方、向下缺口一定在上方。"],
  ["③ 多空排列", "短線看 SMA5／10／20、中長線看 SMA20／60／120。多頭排列＝收盤 > 第一條 > 第二條 > 第三條，而且三條均線今天都比昨天高；空頭排列完全相反；其他都叫糾結，並寫出是哪個條件不成立。已成立＝目前狀態連續第幾天（含今天）；最接近被破壞＝收盤–第一條、第一條–第二條、第二條–第三條三組裡差距最小的一組。"],
  ["④ 支撐／壓力", "候選價位三種：前五大量 K 的高與低、未補缺口的邊緣、K 線反覆打到又回來的價位（觸及 ≥3 天）。差距在容差內的併成一條；強度＝大量 K 量倍數（上限 5）＋每個缺口 2＋觸及天數。在今收下方＝支撐（白實線）、上方＝壓力（白虛線），離今收不到 1/4 容差標「正在測試」。支撐、壓力各只留一條：先在今收 ±10% 內挑強度最高的，該側 10% 內一條都沒有才取範圍外最強，並標「10% 內無，取範圍外最強」。"],
  ["容差", "max(0.5 × ATR14, 0.5% × 今收)；ATR14 是近 14 天平均真實波幅（Wilder）。"],
  ["距離 %", "(價位 ÷ 今收 − 1) × 100：正數在現價上方、負數在下方。"],
  ["清單徽章", "量＝今收相對最大量那根 K（上方紅、下方綠、區間灰）；缺＝上方／下方最近的未補缺口距現價（顏色看較近那個：向上缺口紅、向下缺口綠）；排＝短線・中長線排列（多紅、空綠、糾灰）；撐壓＝選中那條壓力／支撐距現價（灰）。"],
];

function Detail({ d }) {
  return (
    <>
      <KChart d={d} />
      <TopVolume d={d} />
      <Gaps d={d} />
      <MaAlign d={d} />
      <SrLevels d={d} />
      <div className="ta-block ta-rules" data-blk="rules">
        <div className="ta-cap">怎麼看 <span className="mut">規則寫死、可逐日手算</span></div>
        <dl>{RULES.map(([k, v]) => <div key={k} className="ta-rule"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </div>
    </>
  );
}

// ───────── 右欄：單檔明細 ─────────
function One({ row, item, onRetry, old }) {
  const sym = row.sym;
  const d = item && !item.error ? item : null;
  const m = (d && d.meta) || {};
  const chg = chgOf(row) != null ? chgOf(row) : g(d, "price", "chg_1d_pct");
  const close = row.close != null ? row.close : g(d, "price", "close");
  const oldItem = old || (d && !d.signals);
  return (
    <div className="ta-one" id={"c-" + sym} data-sym={sym}>
      <div className="ta-ch">
        <h2><span className="mono">{sym}</span>{row.name || m.name || ""}</h2>
        <span className="ta-px mono">{fnum(close)} <span className={ud(chg)}>{fpct(chg)}</span></span>
        <span className="ta-chip asof">資料截至 {row.asof || m.asof || "—"}</span>
        {m.exchange ? <span className="ta-chip">{m.exchange}</span> : null}
        {row.stale || m.stale ? <span className="ta-chip warn">資料可能過期</span> : null}
      </div>
      {oldItem ? (
        <div className="ta-old">{OLD_MSG}。</div>
      ) : (
        <>
          {isSig(row) ? <Badges r={row} full /> : null}
          {d && m.notes && m.notes.length ? (
            <div className="ta-notes">資料註記：{m.notes.join("；")}｜來源 {m.source || "—"}</div>
          ) : null}
          {d ? <Detail key={sym} d={d} /> : item && item.error ? (
            <div className="ta-err">
              <span>這檔明細讀不到：{item.error}</span>
              <button type="button" className="ta-btn" onClick={onRetry}>重試</button>
            </div>
          ) : (
            <div className="ta-ph"><span>明細載入中…</span></div>
          )}
        </>
      )}
    </div>
  );
}

// ───────── 左欄清單的排序 ─────────
// 預設「送來的順序」＝報告表格勾選／送出的順序。val 回 null＝排最後；同值照送來的順序。
// lab：[正向（dir=1）的說明, 反向（dir=−1）的說明]
const K = (r, f) => nz(g(r, "key", f));
const SORTS = [
  { key: "orig", label: "送來的順序", dir: 1, lab: ["正序", "倒序"], v1: true, val: (r, i) => i },
  { key: "chg", label: "1D%", dir: -1, lab: ["低→高", "高→低"], v1: true, val: (r) => nz(chgOf(r)) },
  { key: "vol", label: "大量關係", dir: -1, lab: ["下方→上方", "上方→下方"], val: (r) => K(r, "vol_rel") },
  { key: "gap", label: "最近未補缺口距離", dir: 1, lab: ["近→遠", "遠→近"], val: (r) => (K(r, "gap_near_pct") === null ? null : Math.abs(K(r, "gap_near_pct"))) },
  { key: "mas", label: "短線排列", dir: -1, lab: ["空→多", "多→空"], val: (r) => K(r, "ma_short") },
  { key: "mam", label: "中長線排列", dir: -1, lab: ["空→多", "多→空"], val: (r) => K(r, "ma_mid") },
  { key: "res", label: "壓力距離", dir: 1, lab: ["近→遠", "遠→近"], val: (r) => (K(r, "sr_res_pct") === null ? null : Math.abs(K(r, "sr_res_pct"))) },
  { key: "sup", label: "支撐距離", dir: 1, lab: ["近→遠", "遠→近"], val: (r) => (K(r, "sr_sup_pct") === null ? null : Math.abs(K(r, "sr_sup_pct"))) },
  { key: "sym", label: "代號", dir: 1, lab: ["A→Z", "Z→A"], v1: true, val: (r) => r.sym },
];
const SORT_BY = Object.fromEntries(SORTS.map((s) => [s.key, s]));
function hashSym() {
  try {
    const m = (location.hash || "").match(/[#&]s=([^&]+)/);
    return m ? decodeURIComponent(m[1]).trim().toUpperCase() : "";
  } catch (e) { return ""; }
}
const MA_ZH = { 1: "多頭", 0: "糾結", "-1": "空頭" };
function maCell(v) { return v === 1 || v === 0 || v === -1 ? <span className={toneN(v) || "mut"}>{MA_ZH[v]}</span> : <span className="mut">資料不足</span>; }
function srCell(v) {
  if (v === null) return <span className="mut">無</span>;
  return <>{fpct(v)}{Math.abs(v) > 10 ? <span className="ta-out" title={SR_BEYOND}>外</span> : null}</>;
}

// ───────── 主頁 ─────────
export default function TaPage() {
  const [phase, setPhase] = useState("init");   // init | gate | loading | ok | error
  const [gateMsg, setGateMsg] = useState("");
  const [err, setErr] = useState("");
  const [ctx, setCtx] = useState(null);         // {k, rid, syms, d}
  const [sum, setSum] = useState(null);
  const [items, setItems] = useState({});       // sym → dict 或 {error}（頁面記憶體快取）
  const [sel, setSel] = useState("");           // 目前選中的代號（網址 #s= 記住）
  const [tab, setTab] = useState("one");        // one＝單檔明細｜all＝全部總表
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("orig");
  const [sortDir, setSortDir] = useState(1);
  const inflight = useRef(new Set());           // 正在向 /api/ta-data 取明細的代號
  const itemsRef = useRef({});
  const selRef = useRef("");
  const visRef = useRef([]);
  const hashSel = useRef("");
  const listRef = useRef(null);
  const paneRef = useRef(null);
  const firstScroll = useRef(true);

  const toGate = useCallback((reason, msg) => {
    setPhase("gate");
    if (reason === "ticket") setGateMsg("通行票已過期或無效。請回到會員報告，重新勾選後再開啟。");
    else setGateMsg(msg || "此功能僅限指定會員。請從會員報告進入。");
  }, []);

  // 網址 #s=<代號>：重新整理後回到同一檔（要在下面讀票、抹 hash 之前先記下來）
  useEffect(() => { hashSel.current = hashSym(); }, []);

  useEffect(() => {
    let k = "";
    try {
      const m = (location.hash || "").match(/[#&]k=([^&]+)/);
      if (m) {
        k = decodeURIComponent(m[1]);
        try { sessionStorage.setItem(SS_KEY, k); } catch (e) {}
        history.replaceState(null, "", location.pathname + location.search);
      } else {
        try { k = sessionStorage.getItem(SS_KEY) || ""; } catch (e) {}
      }
    } catch (e) {}
    const q = new URLSearchParams(location.search);
    const rid = (q.get("r") || "").trim();
    const syms = (q.get("t") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!k || !rid) { toGate("", "此功能僅限指定會員。請從會員報告進入。"); return; }
    if (!syms.length) { toGate("", "沒有收到任何代號。請回到會員報告勾選股票後再開啟。"); return; }
    setCtx({ k, rid, syms, d: q.get("d") || "" });
    setPhase("loading");
    api({ k, rid, syms, mode: "summary" }).then((j) => {
      if (!j || !j.ok) {
        if (j && (j.reason === "ticket" || j.reason === "revoked")) { toGate(j.reason); return; }
        setErr((j && j.error) || "讀取失敗"); setPhase("error"); return;
      }
      setSum(j); setPhase("ok");
    }).catch((e) => { setErr(String(e && e.message || e)); setPhase("error"); });
  }, [toGate]);

  const rows = useMemo(() => (sum && sum.rows) || [], [sum]);
  // 新版（三訊號）資料：summary 標 v≥2／schema sig3-*，或列上有 badge／key；舊版（v1：信心分／停損）只列代號清單
  const v2 = useMemo(() => {
    if (!sum) return false;
    if (Number(sum.v) >= 2 || /^sig3/.test(String(sum.schema || ""))) return true;
    return rows.length > 0 && rows.some(isSig);
  }, [sum, rows]);
  const sorts = useMemo(() => SORTS.filter((s) => v2 || s.v1), [v2]);

  // 左欄：搜尋（代號／名稱）＋排序；空值一律排最後，同值照送來的順序
  const vis = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let out = rows.map((r, i) => [r, i]);
    if (qq) out = out.filter(([r]) => r.sym.toLowerCase().includes(qq) || String(r.name || "").toLowerCase().includes(qq));
    const sd = SORT_BY[sortKey] || SORTS[0];
    out.sort((a, b) => {
      const x = sd.val(a[0], a[1]), y = sd.val(b[0], b[1]);
      const xn = x === null || x === undefined || x === "" || (typeof x === "number" && !Number.isFinite(x));
      const yn = y === null || y === undefined || y === "" || (typeof y === "number" && !Number.isFinite(y));
      if (xn && yn) return a[1] - b[1];
      if (xn) return 1;
      if (yn) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "zh-Hant", { numeric: true });
      return c ? c * sortDir : a[1] - b[1];
    });
    return out.map((x) => x[0]);
  }, [rows, q, sortKey, sortDir]);
  visRef.current = vis;
  selRef.current = sel;

  // 明細按需取：選中那檔＋清單上它後面 20 檔、前面 4 檔（還沒取過的），一次最多 25 檔；取過的留在 items（頁面記憶體）
  // 舊版資料不取明細（格式對不上，右欄只顯示「舊版，更新中」）
  const loadFor = useCallback(async (sym) => {
    if (!ctx || !sum || !sym || !v2) return;
    if (itemsRef.current[sym] || inflight.current.has(sym)) return;
    const ord = visRef.current.some((r) => r.sym === sym) ? visRef.current.map((r) => r.sym) : rows.map((r) => r.sym);
    const i = ord.indexOf(sym);
    const list = [sym];
    const push = (s) => {
      if (list.length >= PAGE || !s || itemsRef.current[s] || inflight.current.has(s) || list.includes(s)) return;
      list.push(s);
    };
    if (i >= 0) {
      for (let k = 1; k <= 20; k++) push(ord[i + k]);
      for (let k = 1; k <= 4; k++) push(ord[i - k]);
      for (let k = 21; list.length < PAGE && i + k < ord.length; k++) push(ord[i + k]);
    }
    list.forEach((s) => inflight.current.add(s));
    const done = () => list.forEach((s) => inflight.current.delete(s));
    try {
      const j = await api({ k: ctx.k, rid: ctx.rid, syms: list, mode: "detail" });
      if (!j || !j.ok) {
        if (j && (j.reason === "ticket" || j.reason === "revoked")) { done(); toGate(j.reason); return; }
        throw new Error((j && j.error) || "讀取失敗");
      }
      const nx = { ...itemsRef.current, ...(j.items || {}) };
      for (const s of j.missing || []) if (!nx[s]) nx[s] = { error: "資料缺漏" };
      for (const s of list) if (!nx[s]) nx[s] = { error: "資料缺漏" };
      done();
      itemsRef.current = nx; setItems(nx);
    } catch (e) {
      done();   // 只把選中那檔標錯（可按重試）；順帶預取的幾檔等選到時再取
      const nx = { ...itemsRef.current, [sym]: { error: String((e && e.message) || e) } };
      itemsRef.current = nx; setItems(nx);
    }
  }, [ctx, sum, rows, toGate, v2]);

  const retry = useCallback((sym) => {
    const nx = { ...itemsRef.current };
    delete nx[sym];
    itemsRef.current = nx; setItems(nx);
    loadFor(sym);
  }, [loadFor]);

  // 預設選第一檔；網址有 #s= 且在清單裡就選它
  useEffect(() => {
    if (phase !== "ok" || selRef.current || !rows.length) return;
    const h = hashSel.current;
    setSel(h && rows.some((r) => r.sym === h) ? h : (visRef.current[0] || rows[0]).sym);
  }, [phase, rows]);

  // 換股：取明細、網址記住、右欄捲回頂端、左欄把選中列捲進視窗
  useEffect(() => {
    if (phase !== "ok" || !sel) return;
    loadFor(sel);
    try {
      const want = "#s=" + encodeURIComponent(sel);
      if (location.hash !== want) history.replaceState(null, "", location.pathname + location.search + want);
    } catch (e) {}
    if (paneRef.current) paneRef.current.scrollTop = 0;
    const list = listRef.current;
    if (!list) return;
    let el = null;
    try { el = list.querySelector('[data-sym="' + CSS.escape(sel) + '"]'); } catch (e) {}
    if (!el) return;
    if (firstScroll.current) {
      firstScroll.current = false;
      list.scrollTop = Math.max(0, el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2);
    } else if (el.offsetTop < list.scrollTop) {
      list.scrollTop = el.offsetTop;
    } else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight;
    }
  }, [phase, sel, loadFor]);

  // 鍵盤 ↑／↓：在左欄（目前的搜尋＋排序結果）上下切換；下拉選單有焦點時讓給選單
  useEffect(() => {
    if (phase !== "ok") return;
    const onKey = (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target, tag = t && t.tagName;
      if (tag === "SELECT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
      const list = visRef.current;
      if (!list.length) return;
      e.preventDefault();
      const cur = list.findIndex((r) => r.sym === selRef.current);
      const ni = cur < 0 ? 0 : Math.max(0, Math.min(list.length - 1, cur + (e.key === "ArrowDown" ? 1 : -1)));
      if (list[ni].sym !== selRef.current) setSel(list[ni].sym);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  // 手動改網址 #s= 也跟著切
  useEffect(() => {
    if (phase !== "ok") return;
    const onHash = () => {
      const s = hashSym();
      if (s && s !== selRef.current && rows.some((r) => r.sym === s)) { setSel(s); setTab("one"); }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [phase, rows]);

  const pick = useCallback((sym) => { setSel(sym); setTab("one"); }, []);

  const sumCols = useMemo(() => {
    const base = [
      { label: "代號", cls: "code mono", render: (r) => r.sym, sort: (r) => r.sym },
      { label: "名稱", render: (r) => <span className="ta-nm" title={r.name || ""}>{r.name || ""}</span>, sort: (r) => r.name || "" },
      { label: "收盤", num: true, render: (r) => <>{fnum(r.close)}{r.stale ? <span className="warn" title="資料日早於報告日，價位以該檔資料日為準"> ⚠</span> : null}</>, sort: (r) => nz(r.close) },
      { label: "1D%", num: true, render: (r) => <span className={ud(chgOf(r))}>{fpct(chgOf(r))}</span>, sort: (r) => nz(chgOf(r)) },
    ];
    if (!v2) return base;
    return base.concat([
      { label: "量", first: -1, title: "今收相對最大量那根 K：上方／區間／下方（點一下：上方→下方）", render: (r) => <span className={toneN(K(r, "vol_rel")) || "mut"}>{volWord(r)}</span>, sort: (r) => K(r, "vol_rel") },
      { label: "缺", first: 1, title: "上方／下方最近的未補缺口距現價（點一下：較近那個由近到遠）", render: (r) => <span className={gapTone(r) || "mut"}>{squeeze(g(r, "badge", "gap"))}</span>, sort: (r) => (K(r, "gap_near_pct") === null ? null : Math.abs(K(r, "gap_near_pct"))) },
      { label: "排(短)", first: -1, title: "SMA5／10／20 排列（點一下：多→糾→空）", render: (r) => maCell(K(r, "ma_short")), sort: (r) => K(r, "ma_short") },
      { label: "排(中)", first: -1, title: "SMA20／60／120 排列（點一下：多→糾→空）", render: (r) => maCell(K(r, "ma_mid")), sort: (r) => K(r, "ma_mid") },
      { label: "壓距", num: true, first: 1, title: "選中那條壓力距現價（今收 ±10% 內最強；「外」＝10% 內無，取範圍外最強）。點一下：由近到遠", render: (r) => srCell(K(r, "sr_res_pct")), sort: (r) => (K(r, "sr_res_pct") === null ? null : Math.abs(K(r, "sr_res_pct"))) },
      { label: "撐距", num: true, first: 1, title: "選中那條支撐距現價（今收 ±10% 內最強；「外」＝10% 內無，取範圍外最強）。點一下：由近到遠", render: (r) => srCell(K(r, "sr_sup_pct")), sort: (r) => (K(r, "sr_sup_pct") === null ? null : Math.abs(K(r, "sr_sup_pct"))) },
    ]);
  }, [v2]);

  // ───── 閘門／錯誤／載入 ─────
  if (phase === "init" || phase === "loading") {
    return <main className="ta-root"><div className="ta-gate"><p>{phase === "init" ? "" : "讀取中…"}</p></div></main>;
  }
  if (phase === "gate") {
    return (
      <main className="ta-root">
        <div className="ta-gate">
          <h1>此功能僅限指定會員</h1>
          <p>{gateMsg}</p>
        </div>
      </main>
    );
  }
  if (phase === "error") {
    return (
      <main className="ta-root">
        <div className="ta-gate">
          <h1>暫時讀不到資料</h1>
          <p>{err}</p>
        </div>
      </main>
    );
  }

  const asofs = rows.map((r) => r.asof).filter(Boolean).sort();
  const asof = asofs.length ? asofs[asofs.length - 1] : d8(sum.report_date);
  const staleN = rows.filter((r) => r.stale).length;
  const missing = sum.missing || [];
  const errs = sum.errors || {};
  const wm = sum.wm || "會員專屬";
  const selRow = rows.find((r) => r.sym === sel) || null;
  const sd = SORT_BY[sortKey] || SORTS[0];

  return (
    <main className={"ta-root ta-app" + (v2 ? "" : " ta-v1")}>
      <div className="ta-wm" aria-hidden="true">{Array.from({ length: 36 }, (_, i) => <span key={i}>{wm}</span>)}</div>
      <header className="ta-head">
        <div className="ta-hrow">
          <span className="ta-badge">會員專屬</span>
          <h1 className="ta-h1">會員專屬·技術分析資料<span className="sep">｜</span>資料截至 {asof || "—"}</h1>
        </div>
        <div className="ta-meta">
          來源報告：<b>{sum.market === "tw" ? "台股分析" : "美股分析"} {d8(sum.report_date)}</b>
          <span className="sep">　</span>本次 <b>{rows.length}</b> 檔{missing.length ? <>（另有 {missing.length} 檔沒有資料）</> : null}
          {sum.generated_at ? <><span className="sep">　</span>計算時間 {String(sum.generated_at).replace("T", " ").slice(0, 16)}</> : null}
        </div>
        {!v2 ? <div className="ta-notice ta-oldn">{OLD_MSG}（目前只列代號清單）。</div>
          : staleN ? <div className="ta-notice">有 {staleN} 檔的資料日早於報告日（標「⚠過期」），價位以該檔資料日的收盤為準。</div> : null}
      </header>

      <div className="ta-split">
        {/* ── 左 1/4：清單（獨立捲動） ── */}
        <aside className="ta-left" aria-label="股票清單">
          <div className="ta-ltools">
            <input type="search" className="ta-q" placeholder="搜尋代號／名稱" aria-label="搜尋代號或名稱" value={q}
              onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false} />
            <div className="ta-sortrow">
              <span>排序</span>
              <select className="ta-sel" aria-label="排序方式" value={sortKey}
                onChange={(e) => { const k = e.target.value; setSortKey(k); setSortDir((SORT_BY[k] || SORTS[0]).dir); e.target.blur(); }}>
                {sorts.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <button type="button" className="ta-dir" title="反轉排序方向" onClick={() => setSortDir((x) => -x)}>{sd.lab[sortDir > 0 ? 0 : 1]}</button>
            </div>
          </div>
          <div className="ta-list" ref={listRef} role="listbox" aria-label="代號清單">
            {vis.map((r) => {
              const on = r.sym === sel;
              const chg = chgOf(r);
              return (
                <div key={r.sym} className={"ta-li" + (on ? " on" : "")} data-sym={r.sym} role="option" aria-selected={on} onClick={() => pick(r.sym)}>
                  <div className="l1">
                    <b className="mono">{r.sym}</b>
                    <span className="nm" title={r.name || ""}>{r.name || ""}</span>
                    <span className="px mono">{fnum(r.close)}</span>
                    <span className={"pc mono " + ud(chg)}>{fpct(chg)}</span>
                    {r.stale ? <span className="warn" title="資料日早於報告日">⚠</span> : null}
                  </div>
                  {isSig(r) ? <Badges r={r} /> : null}
                </div>
              );
            })}
            {!vis.length ? <div className="ta-lempty">{rows.length ? "沒有符合搜尋的代號" : "這次勾選的代號都沒有資料"}</div> : null}
          </div>
          <div className="ta-lfoot">
            共 <b>{rows.length}</b> 檔{q.trim() ? <>（符合搜尋 {vis.length} 檔）</> : null}｜缺資料 <b>{missing.length}</b> 檔
            {missing.length ? <>（{missing.map((s, i) => <span key={s} title={errs[s] ? String(errs[s]) : "不在這份報告的名單裡，或計算時抓不到行情"}>{i ? "、" : ""}{s}</span>)}）</> : null}
          </div>
        </aside>

        {/* ── 右 3/4：單檔明細｜全部總表（各自捲動） ── */}
        <div className="ta-right">
          <div className="ta-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "one"} className={"ta-tab" + (tab === "one" ? " on" : "")} onClick={() => setTab("one")}>單檔明細</button>
            <span className="sep">｜</span>
            <button type="button" role="tab" aria-selected={tab === "all"} className={"ta-tab" + (tab === "all" ? " on" : "")} onClick={() => setTab("all")}>全部總表</button>
            <span className="ta-kbd">鍵盤 ↑／↓ 切換股票</span>
          </div>
          <div className="ta-pane" ref={paneRef} hidden={tab !== "one"}>
            {selRow ? <One row={selRow} item={items[selRow.sym]} old={!v2} onRetry={() => retry(selRow.sym)} />
              : <div className="ta-ph">{rows.length ? "從左邊清單選一檔。" : "這次勾選的代號都沒有資料。"}</div>}
            <div className="ta-foot">
              以上數字全由寫死的規則計算（成交量、跳空缺口、簡單均線、分形高低點），沒有經過回測校準，只描述過去的價量位置，不是買賣建議。
              本頁為會員專屬資料，請勿轉傳。
            </div>
          </div>
          <div className="ta-pane ta-pane-all" hidden={tab !== "all"}>
            <div className="ta-allcap">數字總表（點欄名排序、點一列看那一檔的明細）</div>
            {!v2 ? <div className="ta-old ta-old-all">{OLD_MSG}（目前只列代號、收盤與 1D%）。</div> : null}
            {rows.length ? (
              <SortTable className="ta-sum" cols={sumCols} rows={rows} rowKey={(r) => r.sym} onRowClick={(r) => pick(r.sym)} rowClass={(r) => (r.sym === sel ? "sel" : "")} />
            ) : <div className="ta-ph">這次勾選的代號都沒有資料。</div>}
            {v2 ? (
              <div className="ta-hint">
                量＝今收相對最大量那根 K；缺＝上方／下方最近的未補缺口距現價；排(短)＝SMA5／10／20、排(中)＝SMA20／60／120 的排列；
                壓距／撐距＝選中那條壓力／支撐距現價（今收 ±10% 內強度最高的；標「外」＝10% 內沒有，取範圍外最強）。距離一律＝(價位 ÷ 今收 − 1)×100。
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
