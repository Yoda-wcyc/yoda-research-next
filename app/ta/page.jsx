"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// 會員技術分析（獨立網站版·2026-11-08 Yoda 定）
//
//   會員登入（/api/member-login，票存 localStorage）→ /api/ta-live 每次都重驗：站長（OWNER_PUB_IDS）或 ta_access 有開通
//   左 1/4：輸入代號（台股上市櫃、美股、ETF；不收指數）＋最近查過＋今日額度（會員每天 30 檔、站長不限）
//   右 3/4：週期分頁 1H／4H／日K／週K ＋ 均線組 短（5/10/20）中（8/13/34）長（20/60/120）＋ K 線圖（撐壓、前五大量、缺口、
//           進出場、停損、出場 ✕）＋ ①～④ 四個分頁（前五大量／跳空缺口／多空排列／進出場，所有開通者都看得到）＋ 支撐壓力
// 資料全部來自 Python 計算引擎（ta-engine，契約見 docs/ta-engine-contract.md）；最後一根盤中未定只上圖，不進訊號與回測。

const TOK_KEY = "yoda_ta_jwt";
const RECENT_KEY = "yoda_ta_recent";
const RECENT_MAX = 15;
const TFS = [["1H", "1H"], ["4H", "4H"], ["D", "日K"], ["W", "週K"]];
const TF_ZH = { "1H": "1 小時 K", "4H": "4 小時 K", D: "日 K", W: "週 K" };
const MA_SETS = [["short", "短"], ["mid", "中"], ["long", "長"]];

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
function g(o, ...path) { let x = o; for (const p of path) { if (!x || typeof x !== "object") return undefined; x = x[p]; } return x; }
function nz(x) { return x === null || x === undefined || x === "" ? null : Number(x); }
const has = (v) => v !== null && v !== undefined && v !== "";
const txt = (v) => (has(v) ? (typeof v === "object" ? JSON.stringify(v) : String(v)) : "—");
const md = (t) => String(t || "").slice(5);   // 2026-11-06 → 11-06；2026-11-06 13:00 → 11-06 13:00
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
function readRecent() { try { const a = JSON.parse(lsGet(RECENT_KEY) || "[]"); return Array.isArray(a) ? a.filter((x) => x && x.s) : []; } catch (e) { return []; } }
function readHash() {
  try {
    const q = new URLSearchParams((location.hash || "").replace(/^#/, ""));
    return { s: (q.get("s") || "").trim().toUpperCase(), tf: q.get("tf") || "" };
  } catch (e) { return { s: "", tf: "" }; }
}

// ───────── 可排序表格（每一欄都能排序）─────────
function SortTable({ cols, rows, rowKey, className, rowClass }) {
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
  const click = (i) => {
    if (sk === i) setDir(-dir);
    else { setSk(i); setDir(cols[i].num ? -1 : 1); }
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
          <tr key={rowKey ? rowKey(r) : ri} className={rowClass ? rowClass(r) : ""}>
            {cols.map((c, i) => (
              <td key={i} className={(c.num ? "r " : "") + (c.cls || "")}>{c.render(r)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ───────── K 線圖（同 ta_local 的記號語言；底色固定深色，白色撐壓線才看得見）─────────
const K_UP = "#e0525e", K_DN = "#3fae7a", GOLD = "#ffc94a";
const MA_COL = ["#f0c040", "#56c1d6", "#c78be8"];
const EMA_COL = "#ff5ce1";
const TR_STOP = "#ff4d4d", TR_ENT = "#9ad0ff";
const LINE_STYLE = { stop: [TR_STOP, "5 3"], open_entry: [TR_ENT, ""], open_stop: [TR_STOP, "5 3"] };
const TONE = { stop: TR_STOP, exit: "#ffffff" };
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

function KChart({ d, maSet }) {
  const ch = d.chart || {};
  const bars = ch.bars || [];
  const n = bars.length;
  if (n < 2) return <div className="ta-nochart">沒有 K 線資料</div>;
  const market = g(d, "symbol", "market");
  const intra = d.tf === "1H" || d.tf === "4H";
  const ov = ch.overlays || {};
  const sr = g(d, "signals", "sr_levels") || {};
  const srl = [...(sr.support || []).slice(0, 1).map((x) => [x, "sup"]), ...(sr.resistance || []).slice(0, 1).map((x) => [x, "res"])];
  const trd = d.trade || {};
  const tlines = trd.lines || [];
  const marks = trd.markers || [];
  const W = 1000, L = 62, R = 178, T = 16, PH = 400, GP = 14, VH = 72, B = 24;
  const H = T + PH + GP + VH + B, pw = W - L - R, xr = L + pw;
  const vals = [];
  for (const b of bars) { if (b.h != null) vals.push(b.h); if (b.l != null) vals.push(b.l); }
  if (!vals.length) return <div className="ta-nochart">沒有 K 線資料</div>;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  // 撐壓、進出場的線離 K 棒太遠就不撐大座標：線裁掉、右側標籤貼邊加 ↑／↓
  const reach = (hi - lo) * 0.2;
  for (const y of [...srl.map(([x]) => x.price), ...tlines.map((ln) => ln.y)]) {
    if (y != null && y >= lo - reach && y <= hi + reach) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
  }
  const pad = (hi - lo) * 0.05 || hi * 0.01 || 1;
  lo -= pad; hi += pad;
  const step = pw / n, bw = Math.max(1.2, step * 0.62);
  const Y = (p) => T + ((hi - p) / (hi - lo)) * PH;
  const X = (i) => L + step * (i + 0.5);
  const XL = (i) => (i == null || i < 0 ? L : X(i));   // i=-1＝在視窗左邊 → 從左緣畫起
  const vmax = Math.max(1, ...bars.map((b) => Number(b.v) || 0));
  const VB = T + PH + GP + VH;
  const VY = (v) => VB - (v / vmax) * VH;
  const cid = "tac-" + String(g(d, "symbol", "yahoo") || "x").replace(/[^0-9A-Za-z]/g, "_") + d.tf;
  const clip = "url(#" + cid + ")";
  const els = [];
  // 格線＋價格軸＋時間軸
  for (let k = 0; k < 6; k++) {
    const p = lo + ((hi - lo) * (k + 0.5)) / 6, y = Y(p);
    els.push(<line key={"g" + k} className="grid" x1={L} x2={xr} y1={y} y2={y} />);
    els.push(<text key={"gt" + k} className="ax" x={L - 6} y={y + 4} textAnchor="end">{fnum(p, hi - lo < 50 ? 1 : 0)}</text>);
  }
  els.push(<line key="vbase" className="grid" x1={L} x2={xr} y1={VB} y2={VB} />);
  const tl = (i) => { const t = String(bars[i].t || ""); return intra ? md(t) : i === 0 ? t.slice(2) : md(t); };
  for (let i = 0; i < n - 10; i += 20) els.push(<text key={"d" + i} className="ax" x={X(i)} y={H - 7} textAnchor="middle">{tl(i)}</text>);
  els.push(<text key="dl" className="ax" x={xr} y={H - 7} textAnchor="end">{md(bars[n - 1].t)}</text>);
  els.push(<text key="vl" className="ax" x={L - 6} y={T + PH + GP + 10} textAnchor="end">{market === "tw" ? "量（張）" : "量"}</text>);
  // 缺口框：未補／部分回補＝剩下的區間畫到右緣（部分回補的原缺口淡淡畫到回補那根）；已補＝缺口那根畫到回補那根
  (ov.gaps || []).forEach((x, k) => {
    if (x.top == null || x.bottom == null) return;
    const fill = x.dir === "up" ? K_UP : K_DN;
    const x0 = x.i == null || x.i < 0 ? L : X(x.i) - step / 2;
    const xf = x.fill_i != null ? X(x.fill_i) + step / 2 : x0 + step;
    if (x.fill === "full") {
      els.push(<rect key={"gf" + k} className="gapbox0" x={x0} y={Y(x.top)} width={Math.max(1, xf - x0)} height={Math.max(1, Y(x.bottom) - Y(x.top))}
        fill={fill} fillOpacity=".10" clipPath={clip} data-t={x.t} />);
    } else {
      if (x.fill === "partial" && x.fill_i != null) {
        els.push(<rect key={"ga" + k} className="gapbox0" x={x0} y={Y(x.top)} width={Math.max(1, xf - x0)} height={Math.max(1, Y(x.bottom) - Y(x.top))}
          fill={fill} fillOpacity=".10" clipPath={clip} />);
      }
      if (x.open_top != null && x.open_bottom != null) {
        els.push(<rect key={"gb" + k} className="gapbox" x={x0} y={Y(x.open_top)} width={Math.max(1, xr - x0)} height={Math.max(1, Y(x.open_bottom) - Y(x.open_top))}
          fill={fill} fillOpacity=".22" clipPath={clip} data-t={x.t} data-dir={x.dir} data-fill={x.fill} />);
      }
    }
    if (x.type_short && x.i >= 0) {
      els.push(<text key={"gl" + k} className={"gl " + (x.dir === "up" ? "up" : "dn") + (x.fill === "full" ? " filled" : "")} x={x0 - 3}
        y={(Y(x.top) + Y(x.bottom)) / 2 + 4} textAnchor="end">{String(x.type_short)}{x.type ? <title>{x.type}</title> : null}</text>);
    }
  });
  // 島狀反轉：金色虛線框
  (ov.islands || []).forEach((x, k) => {
    if (x.high == null || x.low == null || x.i1 == null) return;
    const x0 = x.i0 == null || x.i0 < 0 ? L : X(x.i0) - step / 2;
    els.push(<rect key={"is" + k} className="isl" x={x0} y={Y(x.high) - 3} width={Math.max(2, X(x.i1) + step / 2 - x0)} height={Math.max(2, Y(x.low) - Y(x.high) + 6)}
      fill="none" stroke={GOLD} strokeWidth="1" strokeDasharray="3 3" clipPath={clip}>{x.name ? <title>{x.name}</title> : null}</rect>);
  });
  // K 棒（收 ≥ 開＝紅）＋量柱；前五大量：金框 K 棒＋金色量柱＋①～⑤；盤中未定那根淡色＋標字
  const topI = {};
  for (const t of ov.top_volume || []) if (t.i >= 0) topI[t.i] = t.rank;
  bars.forEach((b, i) => {
    const c = b.c;
    if (c == null) return;
    const op = b.o != null ? b.o : c;
    const h = b.h != null ? b.h : Math.max(op, c);
    const l = b.l != null ? b.l : Math.min(op, c);
    const col = c >= op ? K_UP : K_DN;
    const x = X(i);
    const rk = topI[i];
    const unf = b.final === false;
    els.push(<line key={"w" + i} x1={x} x2={x} y1={Y(h)} y2={Y(l)} stroke={col} strokeWidth="1" opacity={unf ? 0.55 : 1} />);
    const y1 = Y(Math.max(op, c)), y2 = Y(Math.min(op, c));
    els.push(<rect key={"b" + i} className={"bd" + (rk ? " top" : "") + (unf ? " unf" : "")} x={x - bw / 2} y={y1} width={bw} height={Math.max(1, y2 - y1)}
      fill={col} fillOpacity={unf ? 0.35 : 1} stroke={rk ? GOLD : unf ? col : undefined} strokeWidth={rk ? 1.6 : unf ? 1 : undefined}
      strokeDasharray={unf && !rk ? "2 2" : undefined} data-t={b.t} data-rank={rk || undefined} />);
    const v = Number(b.v);
    if (v > 0) {
      els.push(<rect key={"v" + i} className={"vb" + (rk ? " top" : "")} x={x - bw / 2} y={VY(v)} width={bw} height={Math.max(0.5, VB - VY(v))}
        fill={rk ? GOLD : col} fillOpacity={rk ? 1 : unf ? 0.3 : 0.55} />);
    }
    if (rk) {
      els.push(<text key={"m" + i} className="mk" x={x} y={Y(h) - 5} textAnchor="middle" data-rank={rk}>{mark(rk)}</text>);
      if (v > 0) els.push(<text key={"mv" + i} className="mk mkv" x={x} y={VY(v) - 3} textAnchor="middle">{mark(rk)}</text>);
    }
    if (unf) els.push(<text key={"uf" + i} className="unf" x={x} y={Y(h) - (rk ? 20 : 6)} textAnchor="end">{d.unfinished_label || "盤中未定"}</text>);
  });
  // 均線（所選那組三條 SMA）＋ EMA10（出場線，細線）
  const poly = (arr, key, col, w) => {
    const segs = []; let cur = [];
    (arr || []).slice(0, n).forEach((v, i) => {
      if (v == null) { if (cur.length > 1) segs.push(cur); cur = []; }
      else cur.push(X(i).toFixed(1) + "," + Y(v).toFixed(1));
    });
    if (cur.length > 1) segs.push(cur);
    segs.forEach((sg, k) => els.push(<polyline key={key + k} className="ma" data-ma={key} points={sg.join(" ")} fill="none" stroke={col}
      strokeWidth={w} strokeOpacity=".9" clipPath={clip} />));
  };
  const set = g(ch, "ma_sets", maSet) || [];
  set.forEach((m, k) => poly(g(ch, "sma", String(m)), "sma" + m, MA_COL[k], 1.2));
  poly(ch.ema10, "ema10", EMA_COL, 1);
  // 支撐（白實線）／壓力（白虛線）
  const lab = [];   // {y, t, col, nt}
  srl.forEach(([x, side]) => {
    if (x.price == null) return;
    const y = Y(x.price);
    els.push(<line key={"sr" + side} className={"sr-line " + side} x1={L} x2={xr} y1={y} y2={y} stroke="#ffffff" strokeWidth="1.8"
      strokeDasharray={side === "res" ? "7 5" : undefined} data-kind={side} data-price={x.price} />);
    lab.push({ y, t: (side === "sup" ? "撐 " : "壓 ") + fnum(x.price) + (srcAbbr(x.sources) ? " " + srcAbbr(x.sources) : "") + (x.testing ? " 測" : ""),
      col: "#ffffff", nt: x.pick_scope === "beyond" ? SR_BEYOND : "" });
  });
  // 進出場的線：停損紅虛線（抱著期間不動）；持倉中的線 i1=null → 延伸到右緣
  tlines.forEach((ln, k) => {
    if (ln.y == null) return;
    const [col, dash] = LINE_STYLE[ln.kind] || ["#ffffff", ""];
    const open = String(ln.kind).startsWith("open_");
    const x0 = XL(ln.i0), x1 = ln.i1 == null ? xr : X(ln.i1);
    if (x1 <= x0 && ln.i1 != null) return;
    els.push(<line key={"tl" + k} className={"trl " + ln.kind} x1={x0} x2={x1} y1={Y(ln.y)} y2={Y(ln.y)} stroke={col} strokeWidth={open ? 1.6 : 1.3}
      strokeDasharray={dash || undefined} clipPath={clip} data-kind={ln.kind} />);
  });
  // 持倉中：右側標籤（跟撐壓一起避讓）
  const p = trd.open;
  if (p) {
    const ly = (kind) => { const ln = tlines.find((x) => x.kind === kind); return ln && ln.y != null ? ln.y : null; };
    const tag = p.side === 1 ? "多" : "空";
    for (const [kind, w, col] of [["open_entry", tag + "單進場 ", TR_ENT], ["open_stop", "停損 ", TR_STOP]]) {
      const v = ly(kind);
      if (v != null) lab.push({ y: Y(v), t: w + fnum(v), col, nt: "" });
    }
  }
  // 記號：▲多進（紅，K 低點下）／▼空進（綠，K 高點上）、✕出場（字＝原因）
  marks.forEach((m, k) => {
    if (m.i == null || m.i < 0 || m.i >= n) return;
    const b = bars[m.i], x = X(m.i);
    if (m.kind === "entry") {
      if (m.side === 1) {
        const y = Y(b.l) + 6;
        els.push(<path key={"me" + k} className="mk-entry" d={`M${x.toFixed(1)} ${y.toFixed(1)} l-4 7 h8 z`} fill={K_UP} />);
        els.push(<text key={"met" + k} className="te" x={x} y={y + 18} textAnchor="middle" style={{ fill: K_UP }}>{m.label || "多進"}</text>);
      } else {
        const y = Y(b.h) - 6;
        els.push(<path key={"me" + k} className="mk-entry" d={`M${x.toFixed(1)} ${y.toFixed(1)} l-4 -7 h8 z`} fill={K_DN} />);
        els.push(<text key={"met" + k} className="te" x={x} y={y - 10} textAnchor="middle" style={{ fill: K_DN }}>{m.label || "空進"}</text>);
      }
    } else if (m.kind === "exit") {
      const col = TONE[m.tone] || "#ffffff", y = Y(m.px);
      els.push(<path key={"mx" + k} className="mk-exit" d={`M${(x - 3.5).toFixed(1)} ${(y - 3.5).toFixed(1)}l7 7m0 -7l-7 7`} stroke={col} strokeWidth="1.8" />);
      els.push(<text key={"mxt" + k} className="tx" x={x + 5} y={y + (m.side === 1 ? 12 : -6)} style={{ fill: col }}>{m.label || m.why}</text>);
    }
  });
  // 右側標籤避讓（由上到下排、不重疊、不超出價格區）；圖外的價位貼邊、加 ↑／↓
  for (const z of lab) {
    if (z.y < T) { z.y = T; z.t = "↑" + z.t; }
    else if (z.y > T + PH) { z.y = T + PH; z.t = "↓" + z.t; }
  }
  lab.sort((a, b) => a.y - b.y);
  const hs = lab.map((z) => 14 + (z.nt ? 13 : 0));
  const ys = []; let last = -1e9, lh = 0;
  lab.forEach((z, k) => { const ny = Math.max(z.y, last + lh); ys.push(ny); last = ny; lh = hs[k]; });
  const over = ys.length ? ys[ys.length - 1] + hs[hs.length - 1] - 14 - (T + PH) : 0;
  if (over > 0) {
    for (let k = 0; k < ys.length; k++) ys[k] -= over;
    for (let k = ys.length - 2; k >= 0; k--) ys[k] = Math.min(ys[k], ys[k + 1] - hs[k]);
  }
  lab.forEach((z, k) => {
    const ty = ys[k];
    els.push(<line key={"lk" + k} x1={xr} x2={xr + 7} y1={z.y} y2={ty} stroke={z.col} strokeWidth="1" strokeOpacity=".6" />);
    els.push(<text key={"lt" + k} className="srl" x={xr + 10} y={ty + 4} style={{ fill: z.col }}>{z.t}</text>);
    if (z.nt) els.push(<text key={"ln" + k} className="srn" x={xr + 10} y={ty + 17}>{z.nt}</text>);
  });
  const lc = bars[n - 1].c;
  if (lc != null) els.push(<circle key="lc" className="lastc" cx={X(n - 1)} cy={Y(lc)} r="3" fill="#ffffff" />);
  return (
    <svg className="ta-k" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={TF_ZH[d.tf] + "線圖"} data-n={n}>
      <rect x="0" y="0" width={W} height={H} fill="#0b0f15" />
      <defs><clipPath id={cid}><rect x={L} y={T} width={pw} height={PH} /></clipPath></defs>
      {els}
    </svg>
  );
}

// 圖例：引擎給的 legend 逐項列（兩欄：記號→說明）＋目前畫的三條均線
const SW = {
  support: <i className="sw" style={{ color: "#fff" }} />,
  resistance: <i className="sw dash" style={{ color: "#fff" }} />,
  top_volume: <i className="bx gold" />,
  gap: <><i className="bx" style={{ background: K_UP }} /><i className="bx" style={{ background: K_DN }} /></>,
  ema10: <i className="sw" style={{ color: EMA_COL }} />,
  entry: <><b style={{ color: K_UP }}>▲</b><b style={{ color: K_DN }}>▼</b></>,
  stop: <i className="sw dash" style={{ color: TR_STOP }} />,
  exit: <><b style={{ color: TR_STOP }}>✕</b><b>✕</b></>,
  open: <i className="sw" style={{ color: TR_ENT }} />,
  unfinished: <i className="bx unf" />,
};
function Legend({ d, maSet }) {
  const set = g(d, "chart", "ma_sets", maSet) || [];
  const items = (g(d, "chart", "legend") || []).filter((x) => x.key !== "unfinished" || d.unfinished);
  return (
    <div className="ta-legend">
      <dl>
        <div className="ta-rule"><dt><span className="lg">{set.map((m, k) => <i key={m} className="sw" style={{ color: MA_COL[k] }} />)}</span>均線</dt>
          <dd>{set.map((m) => "SMA" + m).join("／")}（簡單均線，上方「均線組」切換）；K 棒紅漲綠跌，下方是成交量</dd></div>
        {items.map((x) => (
          <div key={x.key} className="ta-rule"><dt><span className="lg">{SW[x.key] || null}</span>{x.label}</dt><dd>{x.desc}</dd></div>
        ))}
        <div className="ta-rule"><dt>右側標籤</dt><dd>撐／壓價位＋來源：量＝前五大量 K 的高低、缺＝未補缺口邊緣、觸N＝觸及 N 根、測＝正在測試；缺口旁的一個字＝缺口類型（滑過看全名）</dd></div>
      </dl>
    </div>
  );
}

// ───────── 圖下的表 ─────────
const FILL_ZH = { none: "未補", partial: "部分回補", full: "已補" };
const REL_CLS = { "在上方": "up", "在下方": "dn" };
function optCols(rows, specs) {
  return specs.filter((c) => rows.some((x) => has(x[c.f]))).map((c) => ({
    label: c.label, title: c.title, num: c.num, cls: c.cls,
    render: c.render || ((x) => txt(x[c.f])),
    sort: (x) => (has(x[c.f]) ? (typeof x[c.f] === "number" ? x[c.f] : String(x[c.f])) : null),
  }));
}
function islandText(x) {
  if (!x || typeof x !== "object") return txt(x);
  return [x.name, (x.start || "?") + "～" + (x.end || "?"), has(x.bars) ? x.bars + " 根" : ""].filter(Boolean).join(" ");
}

function TopVolume({ d }) {
  const tv = g(d, "signals", "top_volume") || {};
  const market = g(d, "symbol", "market");
  const rows = tv.items || [];
  const wb = g(d, "signals", "window_bars") || "—";
  const cols = [
    { label: "#", render: (x) => mark(x.rank), sort: (x) => x.rank },
    { label: "時間", render: (x) => x.date, sort: (x) => x.date },
    { label: "幾根前", num: true, render: (x) => x.days_ago, sort: (x) => nz(x.days_ago) },
    { label: market === "tw" ? "量（張）" : "量（股）", num: true, render: (x) => fvol(x.volume, market), sort: (x) => nz(x.volume) },
    { label: "量倍數", num: true, title: "這根量 ÷ 之前 20 根均量", render: (x) => (x.vol_ratio == null ? "—" : f1(x.vol_ratio) + "x"), sort: (x) => nz(x.vol_ratio) },
    { label: "漲跌", num: true, render: (x) => <span className={ud(x.chg_pct)}>{fpct(x.chg_pct)}</span>, sort: (x) => nz(x.chg_pct) },
    { label: "K 棒", render: (x) => x.candle || "—", sort: (x) => x.candle || "" },
    { label: "收在", title: "收盤落在這根區間的哪一段", render: (x) => x.close_pos || "—", sort: (x) => nz(x.close_pos_ratio) },
    { label: "最高＝關卡", num: true, render: (x) => <>{fnum(x.high)} <span className="mut">({fpct(x.dist_high_pct)})</span></>, sort: (x) => nz(x.high) },
    { label: "最低＝關卡", num: true, render: (x) => <>{fnum(x.low)} <span className="mut">({fpct(x.dist_low_pct)})</span></>, sort: (x) => nz(x.low) },
    { label: "現價在", render: (x) => <b className={REL_CLS[x.relation] || ""}>{x.relation || "—"}</b>, sort: (x) => ({ "在上方": 1, "區間內": 0, "在下方": -1 })[x.relation] },
    { label: "趨勢／位置", render: (x) => txt(x.trend) + "／" + txt(x.position_zh || x.position), sort: (x) => txt(x.trend) + txt(x.position_zh) },
  ];
  const reads = rows.filter((x) => has(x.read));
  return (
    <div className="ta-block" data-blk="vol">
      <div className="ta-cap">① 前五大量 <span className="mut">近 {wb} 根量最大的 5 根；那根的最高／最低就是關卡，括號＝關卡距現價</span></div>
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
  const wb = g(d, "signals", "window_bars") || "—";
  const cols = [
    { label: "時間", render: (x) => x.date, sort: (x) => x.date },
    { label: "方向", render: (x) => <span className={x.dir === "up" ? "up" : "dn"}>{x.dir === "up" ? "向上" : "向下"}</span>, sort: (x) => x.dir },
    ...optCols(rows, [
      { f: "trend", label: "趨勢" },
      { f: "position_zh", label: "位置" },
      { f: "seq", label: "第幾個", num: true },
      { f: "type", label: "類型", render: (x) => (has(x.type) ? (
        <span className={x.notes && x.notes.length ? "ta-tip" : ""} title={x.notes && x.notes.length ? [].concat(x.notes).join("；") : undefined}>{has(x.type_short) ? <b className="ta-gt">{txt(x.type_short)}</b> : null}{txt(x.type)}</span>
      ) : "—") },
    ]),
    { label: "缺口（下緣～上緣）", num: true, title: "缺口原本的區間；排序依下緣", render: (x) => fnum(x.bottom) + "～" + fnum(x.top), sort: (x) => nz(x.bottom) },
    { label: "幅度", num: true, render: (x) => fpct(x.size_pct, false), sort: (x) => nz(x.size_pct) },
    { label: "量倍數", num: true, title: "缺口那根量 ÷ 之前 20 根均量", render: (x) => (x.vol_ratio == null ? "—" : f1(x.vol_ratio) + "x"), sort: (x) => nz(x.vol_ratio) },
    { label: "回補（時間）", title: "部分回補＝第一次碰進缺口那根；已補＝完全補上那根", render: (x) => (
      <>{FILL_ZH[x.fill] || x.fill || "—"}{x.fill_date ? <span className="mut"> {x.fill_date}</span> : null}</>
    ), sort: (x) => ({ none: 0, partial: 1, full: 2 })[x.fill] * 1e13 + (x.fill_date ? Number(String(x.fill_date).replace(/\D/g, "")) : 0) },
    { label: "未補區間", num: true, render: (x) => (x.fill !== "full" && x.open_bottom != null ? fnum(x.open_bottom) + "～" + fnum(x.open_top) : "—"), sort: (x) => (x.fill !== "full" ? nz(x.open_bottom) : null) },
    { label: "距現價", num: true, render: (x) => <span className={ud(x.dist_pct)}>{fpct(x.dist_pct)}</span>, sort: (x) => (x.dist_pct == null ? null : Math.abs(Number(x.dist_pct))) },
  ];
  return (
    <div className="ta-block" data-blk="gap">
      <div className="ta-cap">② 跳空缺口 <span className="mut">近 {wb} 根全部 {gp.n || 0} 個（未補／部分回補 {gp.n_open || 0}、已補 {gp.n_filled || 0}）；未補依離現價近到遠、已補依時間新到舊</span></div>
      {rows.length ? (
        <div className="ta-win10"><SortTable className="ta-dt" cols={cols} rows={rows} rowKey={(x) => x.date + x.dir} rowClass={(x) => (x.fill === "full" ? "filled" : "")} /></div>
      ) : <div className="ta-empty">近 {wb} 根沒有跳空缺口</div>}
      {Array.isArray(gp.islands) && gp.islands.length ? (
        <div className="ta-islands">島狀反轉 {gp.islands.length} 個：{gp.islands.map((x, i) => <span key={i}>{i ? "；" : ""}{islandText(x)}</span>)}</div>
      ) : null}
    </div>
  );
}

const MA_NM = { short: "短（SMA5／10／20）", mid: "中（SMA8／13／34）", long: "長（SMA20／60／120）" };
function MaAlign({ d, maSet }) {
  const ma = g(d, "signals", "ma_align") || {};
  const rows = ["short", "mid", "long"].map((k) => ({ k, nm: MA_NM[k], ...(ma[k] || {}) }));
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
    { label: "組", render: (x) => <>{x.nm}{x.k === maSet ? <span className="ta-on">圖上</span> : null}</>, sort: (x) => x.k },
    { label: "狀態", render: (x) => <b className={stCls(x.state)}>{stZh(x.state)}</b>, sort: (x) => ({ "多頭排列": 1, "糾結": 0, "空頭排列": -1 })[x.state] },
    { label: "已成立", title: "目前狀態連續第幾根（含最後一根定案 K）", render: (x) => (x.days == null ? "—" : <>第 {x.days_capped ? "≥" : ""}{x.days} 根 <span className="mut">（{x.since} 起）</span></>), sort: (x) => nz(x.days) },
    { label: "不成立原因／最接近被破壞", cls: "wrap", render: note, sort: (x) => x.why || "" },
    { label: "均線值（本根−前根）", cls: "wrap", render: (x) => (
      <span className="ta-mas">收盤 <b>{fnum(x.close)}</b>{(x.lines || []).map((l) => (
        <span key={l.name}>{l.name} <b>{fnum(l.value)}</b> <span className={ud(l.slope)}>({Number(l.slope) > 0 ? "+" : ""}{fnum(l.slope, 4)})</span></span>
      ))}</span>
    ), sort: (x) => nz(x.close) },
  ];
  return (
    <div className="ta-block" data-blk="ma">
      <div className="ta-cap">③ 多空排列 <span className="mut">多頭＝收盤 &gt; 第一條 &gt; 第二條 &gt; 第三條，且三條都往上；空頭相反；其他＝糾結</span></div>
      <div className="ta-hs"><SortTable className="ta-dt" cols={cols} rows={rows} rowKey={(x) => x.k} rowClass={(x) => (x.k === maSet ? "sel" : "")} /></div>
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
    { label: "強度", num: true, title: "大量 K 量倍數（上限 5）＋每個缺口 2＋觸及根數", render: (x) => fnum(x.strength, 1), sort: (x) => nz(x.strength) },
    { label: "觸及", num: true, render: (x) => ((x.touch_dates || []).length ? <span title={(x.touch_dates || []).join("、")}>{x.touches} 根</span> : "0"), sort: (x) => nz(x.touches) },
    { label: "最後觸及", render: (x) => x.last_touch_date || "—", sort: (x) => x.last_touch_date || "" },
    { label: "來源", cls: "wrap", render: (x) => (x.sources || []).join("｜") || "—", sort: (x) => (x.sources || []).join("") },
    { label: "註", cls: "wrap warn", render: (x) => [x.testing ? "正在測試" : "", x.pick_scope === "beyond" ? SR_BEYOND : ""].filter(Boolean).join("、"), sort: (x) => (x.pick_scope === "beyond" ? 1 : 0) + (x.testing ? 2 : 0) },
  ];
  const miss = [!(sr.resistance || []).length ? "上方沒有壓力候選" : "", !(sr.support || []).length ? "下方沒有支撐候選" : ""].filter(Boolean);
  return (
    <div className="ta-block" data-blk="sr">
      <div className="ta-cap">支撐／壓力 <span className="mut">各只一條：先在今收 ±10% 內挑強度最高的，該側 10% 內沒線才取範圍外最強；容差 {fnum(sr.tol)}（ATR14 {fnum(sr.atr14)}）</span></div>
      {rows.length ? <div className="ta-hs"><SortTable className="ta-dt" cols={cols} rows={rows} rowKey={(x) => x.kind} /></div> : null}
      {miss.length ? <div className="ta-empty">{miss.join("、")}</div> : null}
    </div>
  );
}

function BadBanner({ d }) {
  const b = g(d, "trade", "banner");
  return b && b.bad && b.text ? <div className="ta-bad" role="note">{b.text}</div> : null;
}

function Trade({ d }) {
  const trd = d.trade;
  if (!trd) return null;
  const st = trd.stats || {};
  const p = trd.open;
  const tt = trd.trades || [];
  const bars = g(d, "chart", "bars") || [];
  const lastFinal = [...bars].reverse().find((b) => b.final !== false);
  const close = lastFinal ? lastFinal.c : null;
  const side = (s) => <b className={s === 1 ? "up" : "dn"}>{s === 1 ? "多" : "空"}</b>;
  const recent = [];
  for (let k = tt.length - 1; k >= Math.max(0, tt.length - 10); k--) recent.push({ k, ...tt[k] });
  const cols = [
    { label: "#", num: true, render: (t) => t.k + 1, sort: (t) => t.k },
    { label: "方向", render: (t) => side(t.side), sort: (t) => t.side },
    { label: "進場", render: (t) => t.entry_t, sort: (t) => t.entry_t },
    { label: "進場價", num: true, render: (t) => fnum(t.entry), sort: (t) => nz(t.entry) },
    { label: "停損", num: true, render: (t) => fnum(t.stop), sort: (t) => nz(t.stop) },
    { label: "出場（價 原因）", cls: "wrap small", render: (t) => fnum(t.exit_px) + " " + (t.label || t.why), sort: (t) => t.why },
    { label: "出場", render: (t) => t.exit_t, sort: (t) => t.exit_t },
    { label: "損益", num: true, render: (t) => <span className={ud(t.pct)}>{fpct(t.pct)}</span>, sort: (t) => nz(t.pct) },
  ];
  return (
    <div className="ta-block" data-blk="trade">
      <div className="ta-cap">④ 進出場 <span className="mut">EMA5／10／20 排列剛成立＋量比 ≥1.2 進場；停損＝進場時近 3 根低（高），抱著期間不動；收破 EMA10 或爆量反向 K 整筆出</span></div>
      <BadBanner d={d} />
      <div className="ta-hs">
        <table className="ta-tbl ta-dt">
          <thead><tr><th>目前持倉</th><th>進場</th><th className="r">進場價</th><th className="r">停損</th><th className="r">停損距今收</th></tr></thead>
          <tbody>
            {p ? (
              <tr>
                <td>{side(p.side)}</td><td>{p.entry_t}</td><td className="r">{fnum(p.entry)}</td>
                <td className="r">{fnum(p.stop)}</td><td className="r">{close ? fpct((p.stop / close - 1) * 100) : "—"}</td>
              </tr>
            ) : <tr><td colSpan={5} className="mut">目前無持倉</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="ta-hs">
        <table className="ta-tbl ta-dt">
          <thead><tr><th>回測期間</th><th className="r">筆數</th><th className="r">勝率</th><th className="r">合計</th><th className="r">平均賺</th><th className="r">平均賠</th><th className="r">最大連續虧損</th></tr></thead>
          <tbody><tr>
            <td>{st.start || "—"}～{st.end || "—"}（{st.bars || "—"} 根{TF_ZH[d.tf]}）</td>
            <td className="r">{st.n || 0}（多 {st.n_long || 0}／空 {st.n_short || 0}）</td>
            <td className="r">{st.n ? fpct(st.win_rate, false) + "（" + st.wins + "/" + st.n + "）" : "—"}</td>
            <td className={"r " + ud(st.sum_pct)}>{fpct(st.sum_pct)}</td>
            <td className="r up">{fpct(st.avg_win_pct)}</td><td className="r dn">{fpct(st.avg_loss_pct)}</td>
            <td className="r">{st.max_consec_loss || 0} 筆</td>
          </tr></tbody>
        </table>
      </div>
      <div className="ta-note">{trd.note || "樣本內統計，不代表未來；未計手續費與滑價"}</div>
      <div className="ta-cap ta-sub">最近 10 筆 <span className="mut">新到舊；#＝全期第幾筆；損益＝（出場價 − 進場價）÷ 進場價（空單反過來）</span></div>
      {recent.length ? <div className="ta-win10"><SortTable className="ta-dt" cols={cols} rows={recent} rowKey={(t) => "t" + t.k} /></div>
        : <div className="ta-empty">期間內沒有成交</div>}
    </div>
  );
}

// 圖下 ①～④ 四個分頁：[key, 分頁名, 區塊, 怎麼看]
const BLOCKS = [
  ["vol", "① 前五大量", TopVolume, "近 120 根裡成交量最大的 5 根。量倍數＝這根量 ÷ 這根「之前」20 根的平均量。那根的最高、最低就是關卡：現價高過最高＝在上方、低過最低＝在下方，其餘＝區間內。"],
  ["gap", "② 跳空缺口", Gaps, "近 120 根的全部跳空，不設門檻。向上＝這根最低高過前一根最高；向下＝這根最高低過前一根最低。之後有 K 碰進缺口＝部分回補，碰到另一邊＝已補。類型看缺口前的趨勢與位置：突＝突破、破＝跌破、逃＝逃逸、竭＝竭盡、彈＝空頭裡的反彈、回＝多頭裡的回檔、一＝一般、島＝島狀反轉。"],
  ["ma", "③ 多空排列", MaAlign, "三組均線可切換：短 SMA5／10／20、中 SMA8／13／34、長 SMA20／60／120。多頭排列＝收盤 > 第一條 > 第二條 > 第三條，而且三條都往上；空頭排列完全相反；其他叫糾結，並寫出哪個條件不成立。"],
  ["trade", "④ 進出場", Trade, "EMA＝指數均線，全部等收盤才算。EMA5／10／20 剛排好（前 3 根還沒全排好）、量比前 10 根均量 ≥1.2、收在 EMA5 同側＝收盤進場。停損＝進場時近 3 根最低（空單最高），抱著的期間都不動，盤中碰到就整筆出。沒碰停損就一直抱，收盤破 EMA10（空單站上）整筆出；或爆量反向 K（量比 ≥2、反向 K、收破 EMA5）整筆出。同一根同時碰停損和其他出場，算停損。"],
];
const BLK_KEY = "yoda_ta_blk";

function BlockTabs({ d, maSet }) {
  const [cur, setCur] = useState(() => { const v = lsGet(BLK_KEY); return BLOCKS.some(([k]) => k === v) ? v : BLOCKS[0][0]; });
  const pick = (k) => { setCur(k); lsSet(BLK_KEY, k); };
  const onKey = (e) => {   // ←／→／Home／End 換分頁（WAI-ARIA tabs）
    const i = BLOCKS.findIndex(([k]) => k === cur), n = BLOCKS.length;
    const j = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    pick(BLOCKS[j][0]);
    document.getElementById("ta-blk-tab-" + BLOCKS[j][0])?.focus();
  };
  const [, label, Blk, rule] = BLOCKS.find(([k]) => k === cur);
  return (
    <div className="ta-blks">
      <div className="ta-seg ta-blktabs" role="tablist" aria-label="圖下資料" onKeyDown={onKey}>
        {BLOCKS.map(([k, nm]) => (
          <button key={k} id={"ta-blk-tab-" + k} type="button" role="tab" aria-selected={cur === k} aria-controls="ta-blk-panel"
            tabIndex={cur === k ? 0 : -1} className={"ta-tab" + (cur === k ? " on" : "")} onClick={() => pick(k)}>{nm}</button>
        ))}
      </div>
      <div id="ta-blk-panel" role="tabpanel" aria-labelledby={"ta-blk-tab-" + cur} tabIndex={0}>
        <Blk d={d} maSet={maSet} />
        <div className="ta-block ta-rules"><dl><div className="ta-rule"><dt>怎麼看</dt><dd>{rule}</dd></div></dl></div>
      </div>
    </div>
  );
}

const RULES = [
  ["支撐／壓力", "候選價位：前五大量 K 的高與低、未補缺口的邊緣、反覆打到又回來的價位（觸及 ≥3 根）。差距在容差內的併成一條；強度＝大量 K 量倍數（上限 5）＋每個缺口 2＋觸及根數。今收下方＝支撐（白實線）、上方＝壓力（白虛線），各只留一條。"],
  ["盤中未定", "最後一根還在交易中（收盤那根要收盤後 15 分鐘才定案）：只畫在圖上，訊號、排列、回測都只用定案的 K。"],
  ["距離 %", "(價位 ÷ 今收 − 1) × 100：正數在現價上方、負數在下方。"],
];

// ───────── 主頁 ─────────
async function post(url, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  let res;
  try { res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" }); }
  catch (e) { return { ok: false, reason: "network", error: "連線失敗，請再試一次" }; }
  try { return await res.json(); } catch (e) { return { ok: false, reason: "error", error: "伺服器回應無法解析（HTTP " + res.status + "）" }; }
}

export default function TaPage() {
  const [phase, setPhase] = useState("init");   // init | login | denied | app | error
  const [msg, setMsg] = useState("");
  const [owner, setOwner] = useState(false);
  const [quota, setQuota] = useState(null);
  const [wm, setWm] = useState("");
  const [q, setQ] = useState("");
  const [sym, setSym] = useState("");
  const [tf, setTf] = useState("D");
  const [maSet, setMaSet] = useState("short");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);         // {reason, error}
  const [recent, setRecent] = useState([]);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const tok = useRef("");
  const cache = useRef(new Map());              // sym|tf → data（頁面記憶體）
  const seq = useRef(0);

  // 共用的閘門處理：票失效 → 登入；沒開通 → 未開通畫面
  const gate = useCallback((j) => {
    if (j.reason === "need-login") { lsSet(TOK_KEY, null); tok.current = ""; setMsg("登入已過期，請重新登入。"); setPhase("login"); return true; }
    if (j.reason === "not-enabled") { setPhase("denied"); return true; }
    return false;
  }, []);

  const load = useCallback(async (s, t) => {
    s = String(s || "").trim().toUpperCase();
    if (!s) return;
    setSym(s); setTf(t); setErr(null);
    try { history.replaceState(null, "", location.pathname + location.search + "#s=" + encodeURIComponent(s) + "&tf=" + t); } catch (e) {}
    const ck = s + "|" + t;
    if (cache.current.has(ck)) { setData(cache.current.get(ck)); return; }
    const my = ++seq.current;
    setBusy(true);
    const j = await post("/api/ta-live", { symbol: s, tf: t }, tok.current);
    if (my !== seq.current) return;
    setBusy(false);
    if (j.quota) setQuota(j.quota);
    if (!j.ok) {
      if (gate(j)) return;
      setErr({ reason: j.reason, error: j.error || "讀取失敗" }); setData(null); return;
    }
    cache.current.set(ck, j.data);
    setData(j.data);
    const code = g(j.data, "symbol", "code") || s;
    const nx = [{ s: code, n: g(j.data, "symbol", "name") || "" }, ...readRecent().filter((x) => x.s !== code && x.s !== s)].slice(0, RECENT_MAX);
    lsSet(RECENT_KEY, JSON.stringify(nx)); setRecent(nx);
  }, [gate]);

  const start = useCallback(async () => {
    const j = await post("/api/ta-live", { action: "status" }, tok.current);
    if (!j.ok) {
      if (gate(j)) return;
      setMsg(j.error || "讀取失敗"); setPhase("error"); return;
    }
    setOwner(!!j.owner); setQuota(j.quota || null); setWm(j.wm || ""); setPhase("app");
    const h = readHash();
    if (h.s) load(h.s, TFS.some(([k]) => k === h.tf) ? h.tf : "D");
  }, [gate, load]);

  useEffect(() => {
    setRecent(readRecent());
    tok.current = lsGet(TOK_KEY) || "";
    if (!tok.current) { setPhase("login"); return; }
    start();
  }, [start]);

  const login = async (e) => {
    e.preventDefault();
    if (loginBusy) return;
    setLoginBusy(true); setMsg("");
    const j = await post("/api/member-login", { email: email.trim(), password: pw });
    setLoginBusy(false);
    if (j && j.allow && j.token) {
      tok.current = j.token; lsSet(TOK_KEY, j.token); setPw("");
      start();
    } else setMsg((j && j.error) || "登入失敗，請確認 email 與密碼");
  };
  const logout = () => { lsSet(TOK_KEY, null); tok.current = ""; cache.current.clear(); setData(null); setSym(""); setMsg(""); setPhase("login"); };
  const submit = (e) => { e.preventDefault(); const s = q.trim(); if (s) { load(s, tf); setQ(""); } };

  // ───── 閘門畫面 ─────
  if (phase === "init") return <main className="ta-root"><div className="ta-gate"><p>讀取中…</p></div></main>;
  if (phase === "login") {
    return (
      <main className="ta-root">
        <form className="ta-gate ta-login" onSubmit={login}>
          <h1>會員技術分析</h1>
          <p>請用會員帳號登入。此功能需另外開通。</p>
          <input type="email" className="ta-q" placeholder="會員 email" aria-label="會員 email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" className="ta-q" placeholder="密碼" aria-label="密碼" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
          <button type="submit" className="ta-btn ta-go" disabled={loginBusy}>{loginBusy ? "登入中…" : "登入"}</button>
          {msg ? <p className="ta-msg">{msg}</p> : null}
        </form>
      </main>
    );
  }
  if (phase === "denied" || phase === "error") {
    return (
      <main className="ta-root">
        <div className="ta-gate">
          <h1>{phase === "denied" ? "技術分析未開通" : "暫時讀不到資料"}</h1>
          <p>{phase === "denied" ? "這個會員帳號還沒有開通技術分析。需要使用請洽站方。" : msg}</p>
          <button type="button" className="ta-btn" onClick={logout}>換一個帳號登入</button>
        </div>
      </main>
    );
  }

  const d = data && data.tf === tf ? data : null;
  const bars = g(d, "chart", "bars") || [];
  const fin = bars.filter((b) => b.final !== false);
  const lastB = fin[fin.length - 1], prevB = fin[fin.length - 2];
  const chg = lastB && prevB && prevB.c ? (lastB.c / prevB.c - 1) * 100 : null;
  const unfB = bars.length && bars[bars.length - 1].final === false ? bars[bars.length - 1] : null;
  const symInfo = (d && d.symbol) || {};

  return (
    <main className="ta-root ta-app">
      <div className="ta-wm" aria-hidden="true">{Array.from({ length: 36 }, (_, i) => <span key={i}>{wm || "會員專屬"}</span>)}</div>
      <header className="ta-head">
        <div className="ta-hrow">
          <span className="ta-badge">會員專屬</span>
          <h1 className="ta-h1">技術分析<span className="sep">｜</span><span className="ta-sub2">台股上市櫃・美股・ETF，1H／4H／日K／週K</span></h1>
        </div>
      </header>

      <div className="ta-split">
        {/* ── 左 1/4：輸入＋最近查過＋額度 ── */}
        <aside className="ta-left" aria-label="查詢">
          <form className="ta-ltools" onSubmit={submit}>
            <label className="ta-lab" htmlFor="ta-in">輸入代號</label>
            <div className="ta-inrow">
              <input id="ta-in" type="search" className="ta-q" placeholder="2330、00878、6488、NVDA、SPY" value={q}
                onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false} enterKeyHint="search" />
              <button type="submit" className="ta-btn ta-go" disabled={busy || !q.trim()}>查</button>
            </div>
            <div className="ta-hint">台股打數字代號（先找上市、再找上櫃）、美股打英文代號；不收指數</div>
          </form>
          <div className="ta-quota" data-left={quota && !quota.unlimited ? quota.left : ""}>
            {owner || (quota && quota.unlimited) ? <>站長：不限檔數</> : quota ? (
              <>今日已查 <b>{quota.used}</b>／{quota.max} 檔，剩 <b className={quota.left ? "" : "warn"}>{quota.left}</b> 檔
                <div className="mut">同一檔換週期、均線組不另計；台灣時間 0 點重算</div></>
            ) : "—"}
          </div>
          <div className="ta-rhead">最近查過</div>
          <div className="ta-list" role="list">
            {recent.map((r) => (
              <div key={r.s} role="listitem" className={"ta-li" + (r.s === (symInfo.code || sym) ? " on" : "")} onClick={() => load(r.s, tf)}>
                <div className="l1"><b className="mono">{r.s}</b><span className="nm" title={r.n}>{r.n}</span></div>
              </div>
            ))}
            {!recent.length ? <div className="ta-lempty">還沒有查過的代號</div> : null}
          </div>
          <div className="ta-lfoot">
            {recent.length ? <button type="button" className="ta-link" onClick={() => { lsSet(RECENT_KEY, null); setRecent([]); }}>清除紀錄</button> : null}
            <button type="button" className="ta-link" onClick={logout}>登出</button>
          </div>
        </aside>

        {/* ── 右 3/4：週期＋均線組＋圖＋表 ── */}
        <div className="ta-right">
          <div className="ta-tabs">
            <div className="ta-seg" role="tablist" aria-label="週期">
              {TFS.map(([k, nm]) => (
                <button key={k} type="button" role="tab" aria-selected={tf === k} className={"ta-tab" + (tf === k ? " on" : "")}
                  onClick={() => (sym ? load(sym, k) : setTf(k))}>{nm}</button>
              ))}
            </div>
            <div className="ta-seg" role="group" aria-label="均線組">
              <span className="ta-seglab">均線</span>
              {MA_SETS.map(([k, nm]) => (
                <button key={k} type="button" aria-pressed={maSet === k} className={"ta-tab" + (maSet === k ? " on" : "")} onClick={() => setMaSet(k)}
                  title={MA_NM[k]}>{nm}</button>
              ))}
            </div>
            {busy ? <span className="ta-kbd">計算中…</span> : null}
          </div>
          <div className="ta-pane">
            {err ? (
              <div className={"ta-err r-" + err.reason}>
                <span>{err.reason === "quota-exceeded" ? "額度用完：" : err.reason === "symbol-not-found" ? "查無資料：" : err.reason === "upstream" ? "行情暫時抓不到：" : ""}{err.error}</span>
                {err.reason === "upstream" || err.reason === "network" || err.reason === "error" ? <button type="button" className="ta-btn" onClick={() => load(sym, tf)}>重試</button> : null}
              </div>
            ) : null}
            {!d && !err ? <div className="ta-ph">{busy ? "計算中…（第一次查一檔約需幾秒）" : "從左邊輸入代號開始。"}</div> : null}
            {d ? (
              <div className="ta-one" data-sym={symInfo.yahoo}>
                <div className="ta-ch">
                  <h2><span className="mono">{symInfo.code || sym}</span>{symInfo.name || ""}</h2>
                  <span className="ta-px mono">{fnum(lastB && lastB.c)} <span className={ud(chg)}>{fpct(chg)}</span></span>
                  <span className="ta-chip asof">{TF_ZH[d.tf]}・最後定案 {d.asof || "—"}</span>
                  {unfB ? <span className="ta-chip warn">{d.unfinished_label || "盤中未定"} {fnum(unfB.c)}</span> : null}
                  <span className="ta-chip">{symInfo.market === "tw" ? "台股" : "美股"}{symInfo.exchange ? "·" + symInfo.exchange : ""}{symInfo.type === "ETF" ? "·ETF" : ""}</span>
                </div>
                {g(d, "signals", "badges") ? (
                  <div className="ta-bds full">
                    <span className="ta-bd"><i>量</i>{d.signals.badges.vol || "—"}</span>
                    <span className="ta-bd"><i>缺</i>{d.signals.badges.gap || "—"}{d.signals.badges.gap_type ? "｜" + d.signals.badges.gap_type : ""}</span>
                    <span className="ta-bd"><i>排</i>{String(d.signals.badges.ma || "—").split("・").map((x, i) => (
                      <span key={i} className={/多/.test(x) ? "up" : /空/.test(x) ? "dn" : ""}>{i ? "・" : ""}{x}</span>))}</span>
                    <span className="ta-bd"><i>撐壓</i>{d.signals.badges.sr || "—"}</span>
                  </div>
                ) : null}
                <BadBanner d={d} />
                <KChart d={d} maSet={maSet} />
                <Legend d={d} maSet={maSet} />
                {(d.notes || []).length ? <div className="ta-notes">資料註記：{d.notes.join("；")}</div> : null}
                <BlockTabs d={d} maSet={maSet} />
                <SrLevels d={d} />
                <div className="ta-block ta-rules">
                  <div className="ta-cap">怎麼看 <span className="mut">規則寫死、每一根都可以手算</span></div>
                  <dl>{RULES.map(([k, v]) => <div key={k} className="ta-rule"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
                </div>
              </div>
            ) : null}
            <div className="ta-foot">
              資料來源 Yahoo Finance（開高低收依除息事件還原）；以上數字全由寫死的規則計算，只描述過去的價量位置與這套規則的歷史表現，不是買賣建議。
              本頁為會員專屬，請勿轉傳。
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
