"use client";
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { normParams, backtest, chartMarks, exitLine, ruleText, maName, smaSeq, PRESETS, explainEntry, explainExit, fpx, fpc, statsOf, hasVolume, effParams } from "../../lib/ta-trade";

// 會員技術分析（獨立網站版·2026-11-08 Yoda 定）
//
//   會員登入（/api/member-login，票存 localStorage）→ /api/ta-live 每次都重驗：站長（OWNER_PUB_IDS）或 ta_access 有開通
//   左 1/4：輸入代號（台股上市櫃、美股、ETF、美國期貨連續月 ES1!／NQ1!…、指數只收 ^SOX）＋最近查過＋今日額度（會員每天 30 檔、站長不限）
//   期貨（11-10）：換月那根圖上標「換月」（引擎 chart.overlays.rolls）；沒有成交量的標的（^SOX）量的條件停用、量柱與 ③ 前五大量改寫「此標的沒有成交量」。
//   台指期／費半期（11-10，期交所日資料）：只有日K／週K（symbol.tfs → 1H／4H 停用、寫「期交所只有日資料」；選著 1H 查會自動改日K）、
//           標題列「含夜盤（夜盤算到隔天）」、期交所讀不到時的黃色註記、費半期旁「^SOX 是指數版」可一鍵改看。
//   新欄位（has_volume、rolls、symbol.contract／tfs／session／stale／see_also）一律可缺：舊引擎回應照舊畫。
//   右 3/4：週期分頁 1H／4H／日K／週K ＋ 均線組 短（5/10/20）中（8/13/34）長（20/60/120）＋ K 線圖（撐壓、前五大量、缺口、島狀反轉、
//           進出場、停損、出場 ✕；均線紅黃藍＝短到長；圖下「時間區間導覽列」拖曳看整段歷史）
//           ＋ 緊貼圖下三個大分頁 ①進出場 ②跳空缺口 ③前五大量（11-09；原本的均線排列分頁已永久刪除，守門見 Skill\tests\ta_engine_check.py）＋ 圖例（預設收合）＋ 支撐壓力
//   左欄「交易規則」面板（11-09）：勾選／填數字 → 瀏覽器用 lib/ta-trade.js 即時重算進出場與回測（不打伺服器、不扣額度）；
//           5 組內建策略（唯讀）＋自己存的策略，只存在自己的瀏覽器（localStorage）。手機寬（≤760px）面板排到圖下方。
//   圖上進出場記號：滑過（手機點一下）出自製浮動說明，逐條列進出場條件的實際數值（lib/ta-trade.js explainEntry／explainExit）。
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
  if (market === "fut") return Math.round(x).toLocaleString("en-US");        // 口
  return (x / 1e6).toFixed(1) + "M";
}
const volUnit = (market) => (market === "tw" ? "量（張）" : market === "fut" ? "量（口）" : "量（股）");
// 沒有成交量（^SOX 指數）：引擎 has_volume=false，或舊回應沒這欄但定案 K 的量全是 null／0
const NOVOL_TXT = "此標的沒有成交量";
function noVolume(d) {
  if (!d || typeof d !== "object") return false;
  if (d.has_volume === false) return true;
  const v = g(d, "history", "v");
  return Array.isArray(v) && v.length > 0 && !hasVolume(v, d.bars_completed != null ? d.bars_completed : v.length);
}
// 標題列的市場標籤：台股／美股（·交易所·ETF）、美國期貨・CME、台灣期貨・TAIFEX、指數
function mktBadge(s) {
  if (!s || typeof s !== "object") return "";
  if (s.market === "fut") return (s.exchange === "TAIFEX" ? "台灣期貨・" : "美國期貨・") + (s.exchange || "CME");
  if (s.type === "INDEX") return "指數";
  return (s.market === "tw" ? "台股" : "美股") + (s.exchange ? "·" + s.exchange : "") + (s.type === "ETF" ? "·ETF" : "");
}
// 週期分頁：引擎有給 symbol.tfs（台指期／費半期＝["D","W"]）時其他週期停用並註明；舊回應沒有 tfs＝全部可用
const TWF_ONLY_TXT = "期交所只有日資料";
function TfTabs({ tf, tfs, onPick }) {
  const ok = Array.isArray(tfs) && tfs.length ? tfs : null;
  return (
    <div className="ta-seg" role="tablist" aria-label="週期">
      {TFS.map(([k, nm]) => {
        const off = !!ok && !ok.includes(k);
        return (
          <button key={k} type="button" role="tab" aria-selected={tf === k} className={"ta-tab" + (tf === k ? " on" : "")} disabled={off}
            title={off ? TWF_ONLY_TXT : undefined} onClick={() => onPick(k)}>{nm}</button>
        );
      })}
      {ok && TFS.some(([k]) => !ok.includes(k)) ? <span className="ta-seglab ta-tfnote">{TWF_ONLY_TXT}</span> : null}
    </div>
  );
}
// 標題列下的期交所說明（台指期／費半期才有，欄位都可缺）：盤別、期交所暫時讀不到、同標的的指數版（費半期 → ^SOX）
function FutInfo({ s, onPick }) {
  if (!s || typeof s !== "object" || s.exchange !== "TAIFEX") return null;
  const see = s.see_also && typeof s.see_also === "object" && typeof s.see_also.code === "string" ? s.see_also : null;
  if (!see && !(typeof s.stale === "string" && s.stale)) return null;
  return (
    <div className="ta-finfo">
      {typeof s.stale === "string" && s.stale ? <span className="ta-chip warn">{s.stale}</span> : null}
      {see ? <span className="ta-fsee">{typeof see.text === "string" ? see.text : see.code}<button type="button" className="ta-link" onClick={() => onPick(see.code)}>改看 {see.code}</button></span> : null}
    </div>
  );
}
function ud(x) { const v = Number(x); return x === null || x === undefined || !Number.isFinite(v) || v === 0 ? "" : v > 0 ? "up" : "dn"; }
function g(o, ...path) { let x = o; for (const p of path) { if (!x || typeof x !== "object") return undefined; x = x[p]; } return x; }
function nz(x) { return x === null || x === undefined || x === "" ? null : Number(x); }
const has = (v) => v !== null && v !== undefined && v !== "";
const txt = (v) => (has(v) ? (typeof v === "object" ? JSON.stringify(v) : String(v)) : "—");
const md = (t) => String(t || "").slice(5);   // 2026-11-06 → 11-06；2026-11-06 13:00 → 11-06 13:00
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
// 最近查過：s／n 一律收成字串（物件直接放進 JSX 會讓整頁崩潰＝React #31）
function cleanRecent(a) { return Array.isArray(a) ? a.filter((x) => x && typeof x.s === "string" && x.s).map((x) => ({ s: x.s, n: typeof x.n === "string" ? x.n : "" })) : []; }
function readRecent() { try { return cleanRecent(JSON.parse(lsGet(RECENT_KEY) || "[]")); } catch (e) { return []; } }
// 圖表區的保險：某一塊 render 丟例外時只把那一塊換成錯誤摘要，登入框、左欄、其他區塊照常；reset 一換（新資料／新參數）就重試
class Boundary extends Component {
  constructor(props) { super(props); this.state = { err: null, reset: props.reset }; }
  static getDerivedStateFromError(err) { return { err }; }
  static getDerivedStateFromProps(p, s) { return p.reset !== s.reset ? { err: null, reset: p.reset } : null; }
  componentDidCatch(err) { console.error("[ta] 區塊顯示失敗", err); }
  render() {
    const e = this.state.err;
    if (!e) return this.props.children;
    return <div className="ta-err" role="alert"><span>這一塊顯示失敗：{String((e && e.message) || e).slice(0, 200)}（重新整理頁面，或換一檔再試）</span></div>;
  }
}
// 標題列用的數字；在所有 Boundary 外面算，所以資料格式怪也不能丟例外（bars 不是陣列、symbol 不是物件）
function headInfo(d) {
  const bars = (Array.isArray(g(d, "chart", "bars")) ? d.chart.bars : []).filter((b) => b && typeof b === "object");
  const fin = bars.filter((b) => b.final !== false);
  const lastB = fin[fin.length - 1], prevB = fin[fin.length - 2];
  const chg = lastB && prevB && prevB.c ? (lastB.c / prevB.c - 1) * 100 : null;
  const unfB = bars.length && bars[bars.length - 1].final === false ? bars[bars.length - 1] : null;
  const symInfo = d && d.symbol && typeof d.symbol === "object" ? d.symbol : {};
  return { lastB, chg, unfB, symInfo };
}
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
const MA_COL = ["#ff4d4f", "#f5c518", "#3d8bfd"];   // 均線由短到長：紅、黃、藍（Yoda 2026-11-09）
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

// 整段歷史（history 每欄一個陣列）→ 圖用的 K；沒有 history 就只有引擎的 chart.bars。k0＝chart.bars[0] 在整段裡的位置
function fullSeries(d) {
  const cb = g(d, "chart", "bars") || [], h = d.history;
  if (!h || !Array.isArray(h.c) || h.c.length < cb.length) return { bars: cb, c: cb.map((b) => Number(b.c)), k0: 0 };
  const N = h.c.length, nf = d.bars_completed != null ? d.bars_completed : N, bars = new Array(N);
  for (let i = 0; i < N; i++) bars[i] = { t: h.t[i], o: h.o[i], h: h.h[i], l: h.l[i], c: h.c[i], v: h.v ? h.v[i] : null, final: i < nf };
  return { bars, c: h.c.map(Number), k0: N - cb.length };
}

// 引擎 overlays.gaps（cols＋enums＋rows，整段歷史、i＝history 絕對位置）→ 每筆一個物件，補上日期
function decodeGaps(G, bars) {
  if (!G || !Array.isArray(G.cols) || !Array.isArray(G.rows)) return [];
  const en = G.enums || {}, tAt = (i) => (i != null && bars[i] ? bars[i].t : null);
  return G.rows.map((r) => {
    const x = {};
    G.cols.forEach((c, k) => { const v = r[k]; x[c] = en[c] && v != null ? en[c][v] : v; });
    x.date = tAt(x.i); x.fill_date = tAt(x.fill_i);
    return x;
  });
}

// 前五大量（Yoda 11-09）：[a, b) 可見區間裡「已定案」的 K 量最大 5 根（同量取較近）；量倍數＝這根量 ÷ 之前 20 根均量（整段 history 算、缺量不計）
function topVolume(full, a, b, nf, eng) {
  const bars = full.bars, idx = [];
  for (let i = a; i < Math.min(b, nf); i++) if (Number(bars[i].v) > 0) idx.push(i);
  idx.sort((x, y) => Number(bars[y].v) - Number(bars[x].v) || y - x);
  const C = nf > 0 ? Number(bars[nf - 1].c) : NaN, pct = (p) => (Number.isFinite(C) && C ? (p / C - 1) * 100 : null);
  const byDate = new Map((eng || []).map((x) => [x.date, x]));   // 近 120 根才有引擎的 K 棒型態、趨勢位置、解讀
  return idx.slice(0, 5).map((i, k) => {
    const x = bars[i], pv = [];
    for (let j = Math.max(0, i - 20); j < i; j++) if (bars[j].v != null) pv.push(Number(bars[j].v));
    const avg = i >= 20 && pv.length ? pv.reduce((s0, v) => s0 + v, 0) / pv.length : null;
    const e = byDate.get(x.t) || {};
    return {
      rank: k + 1, i, date: x.t, days_ago: nf - 1 - i, volume: Number(x.v), vol_ratio: avg ? Number(x.v) / avg : null,
      chg_pct: i > 0 && bars[i - 1].c ? (x.c / bars[i - 1].c - 1) * 100 : null, high: x.h, low: x.l,
      dist_high_pct: pct(x.h), dist_low_pct: pct(x.l), relation: C > x.h ? "在上方" : C < x.l ? "在下方" : "區間內",
      candle: e.candle, close_pos: e.close_pos, close_pos_ratio: e.close_pos_ratio, trend: e.trend, position_zh: e.position_zh || e.position, read: e.read,
    };
  });
}

// K 線圖畫整段歷史的 [a, b) 這一段；Y 軸依區間內高低。K 棒與量柱併成幾條 path（1H 五千根拖曳才不卡）
function KChart({ d, full, smas, a, b, onTip, gaps, islands, top, rolls }) {
  const ch = d.chart || {};
  const bars = full.bars.slice(a, b), n = bars.length;
  if (n < 2) return <div className="ta-nochart">沒有 K 線資料</div>;
  const market = g(d, "symbol", "market");
  const intra = d.tf === "1H" || d.tf === "4H";
  const oi = (i) => (i == null ? null : i - a);   // 缺口、島、前五大量的 i 都是整段 history 的絕對位置
  const sr = g(d, "signals", "sr_levels") || {};
  const srl = [...(sr.support || []).slice(0, 1).map((x) => [x, "sup"]), ...(sr.resistance || []).slice(0, 1).map((x) => [x, "res"])];
  const trd = d.trade || {};
  const tlines = (trd.lines || []).filter((ln) => (ln.i1 == null || ln.i1 >= a) && (ln.i0 == null || ln.i0 < b));
  const marks = (trd.markers || []).filter((m) => m.i != null && m.i >= a && m.i < b);
  const W = 1000, L = 62, R = 178, T = 16, PH = 400, GP = 14, VH = 72, B = 24;
  const H = T + PH + GP + VH + B, pw = W - L - R, xr = L + pw;
  const vals = [];
  for (const x of bars) { if (x.h != null) vals.push(x.h); if (x.l != null) vals.push(x.l); }
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
  const XL = (i) => (i == null || i < 0 ? L : X(i));   // 在區間左邊 → 從左緣畫起
  let vmax = 1;
  for (const x of bars) { const v = Number(x.v) || 0; if (v > vmax) vmax = v; }
  const VB = T + PH + GP + VH;
  const VY = (v) => VB - (v / vmax) * VH;
  const cid = "tac-" + String(g(d, "symbol", "yahoo") || "x").replace(/[^0-9A-Za-z]/g, "_") + d.tf;
  const clip = "url(#" + cid + ")";
  const els = [];
  // 格線＋價格軸＋時間軸（標籤間距跟著區間根數變）
  for (let k = 0; k < 6; k++) {
    const p = lo + ((hi - lo) * (k + 0.5)) / 6, y = Y(p);
    els.push(<line key={"g" + k} className="grid" x1={L} x2={xr} y1={y} y2={y} />);
    els.push(<text key={"gt" + k} className="ax" x={L - 6} y={y + 4} textAnchor="end">{fnum(p, hi - lo < 50 ? 1 : 0)}</text>);
  }
  els.push(<line key="vbase" className="grid" x1={L} x2={xr} y1={VB} y2={VB} />);
  const longD = !intra && n > 250;
  const tl = (i) => { const t = String(bars[i].t || ""); return intra ? (n > 200 ? t.slice(2, 10) : md(t)) : longD ? t.slice(0, 7) : i === 0 ? t.slice(2) : md(t); };
  const every = Math.max(1, Math.ceil((n * 100) / pw));
  for (let i = 0; i < n - every; i += every) els.push(<text key={"d" + i} className="ax" x={X(i)} y={H - 7} textAnchor="middle">{tl(i)}</text>);
  els.push(<text key="dl" className="ax" x={xr} y={H - 7} textAnchor="end">{longD ? String(bars[n - 1].t).slice(0, 10) : md(bars[n - 1].t)}</text>);
  const noVol = noVolume(d);
  if (noVol) els.push(<text key="nov" className="ax" data-novol="" x={L + pw / 2} y={T + PH + GP + VH / 2 + 4} textAnchor="middle">{NOVOL_TXT}</text>);
  else els.push(<text key="vl" className="ax" x={L - 6} y={T + PH + GP + 10} textAnchor="end">{market === "tw" ? "量（張）" : market === "fut" ? "量（口）" : "量"}</text>);
  // 圖上文字／記號佔的位置（缺口代號、島狀反轉的字、前五大量編號、圖左上線名、進出場記號先放，進出場標籤再找不撞的位置）；tw＝字寬估計（中文 12、英數 6.8）
  const placed = [];
  const tw = (s) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 12 : 6.8), 0);
  // 重疊面積（四邊各多留 1px，字的描邊才不會貼在一起）
  const hitArea = (bx) => placed.reduce((z, r) => z + Math.max(0, Math.min(bx[2], r[2] + 1) - Math.max(bx[0], r[0] - 1)) * Math.max(0, Math.min(bx[3], r[3] + 1) - Math.max(bx[1], r[1] - 1)), 0);
  const busyAt = (bx) => placed.some((p) => bx[0] < p[2] && bx[2] > p[0] && bx[1] < p[3] && bx[3] > p[1]);
  // 圖左上線名（三條均線、出場線、停損）：先佔位，後面的島狀反轉、盤中未定、進出場標籤才會避開；字最後才畫（蓋在 K 棒上面）
  const ckey = [...smas.map(([m], k) => ["SMA" + m, MA_COL[k], ""]),
    ...(ch.exit_line ? [["出場線 " + (trd.p ? maName(trd.p, trd.p.exit_k) : ""), EMA_COL, ""]] : []), ...(marks.length || trd.open ? [["停損", TR_STOP, "4 3"]] : [])];
  const kels = [];
  let kx = L + 6;
  ckey.forEach(([s, col, dash], k) => {
    if (!s) return;
    kels.push(<line key={"ky" + k} x1={kx} x2={kx + 14} y1={T + 9} y2={T + 9} stroke={col} strokeWidth="2" strokeDasharray={dash || undefined} />);
    kels.push(<text key={"kyt" + k} className="ckey" x={kx + 18} y={T + 13} style={{ fill: col }}>{s}</text>);
    placed.push([kx, T + 1, kx + 18 + tw(s), T + 15]);
    kx += 26 + tw(s);
  });
  // 缺口框（整段歷史，只畫跟區間有交集的）：未補／部分回補＝剩下的區間畫到右緣（部分回補的原缺口淡淡畫到回補那根）；已補＝缺口那根畫到回補那根。
  // 缺口旁的類型字：區間超過 250 根就不寫（同進出場 ✕ 的規則，十年日K 五百多個缺口字會糊成一片），框照畫
  (gaps || []).forEach((x, k) => {
    if (x.top == null || x.bottom == null || x.i >= b) return;
    const gi = oi(x.i), fi = x.fill_i != null ? oi(x.fill_i) : null;
    const fill = x.dir === "up" ? K_UP : K_DN;
    const x0 = gi < 0 ? L : X(gi) - step / 2;
    if (x0 > xr) return;
    const xf = fi != null ? X(fi) + step / 2 : x0 + step;
    if (x.fill === "full") {
      if (xf < L) return;
      els.push(<rect key={"gf" + k} className="gapbox0" x={x0} y={Y(x.top)} width={Math.max(1, xf - x0)} height={Math.max(1, Y(x.bottom) - Y(x.top))}
        fill={fill} fillOpacity=".10" clipPath={clip} data-t={x.date} />);
    } else {
      if (x.fill === "partial" && fi != null && xf >= L) {
        els.push(<rect key={"ga" + k} className="gapbox0" x={x0} y={Y(x.top)} width={Math.max(1, xf - x0)} height={Math.max(1, Y(x.bottom) - Y(x.top))}
          fill={fill} fillOpacity=".10" clipPath={clip} />);
      }
      if (x.open_top != null && x.open_bottom != null) {
        els.push(<rect key={"gb" + k} className="gapbox" x={x0} y={Y(x.open_top)} width={Math.max(1, xr - x0)} height={Math.max(1, Y(x.open_bottom) - Y(x.open_top))}
          fill={fill} fillOpacity=".22" clipPath={clip} data-t={x.date} data-dir={x.dir} data-fill={x.fill} />);
      }
    }
    const ts = x.type_short;   // 島狀反轉的兩個缺口引擎已改成「島」
    if (ts && gi >= 0 && gi < n && n <= 250) {
      const gy = (Y(x.top) + Y(x.bottom)) / 2 + 4;
      placed.push([x0 - 3 - tw(String(ts)), gy - 11, x0 - 3, gy + 3]);
      els.push(<text key={"gl" + k} className={"gl " + (x.dir === "up" ? "up" : "dn") + (x.fill === "full" ? " filled" : "")} x={x0 - 3}
        y={(Y(x.top) + Y(x.bottom)) / 2 + 4} textAnchor="end">{String(ts)}{x.type ? <title>{x.type}</title> : null}</text>);
    }
  });
  const islWant = [];
  // 島狀反轉：金色虛線框＋直接標字（頂部島標在框上方、底部島標在框下方；沒有 kind 時看島開頭那個缺口：向上＝頂部）
  (islands || []).forEach((x, k) => {
    if (x.high == null || x.low == null || x.i0 == null || x.i1 == null || x.i1 < a || x.i0 >= b) return;   // 跟區間沒交集
    const i0 = oi(x.i0), i1 = oi(x.i1);
    const x0 = i0 < 0 ? L : X(i0) - step / 2;
    const top = x.kind ? x.kind === "top" : ((gaps || []).find((gp) => gp.i === x.i0) || {}).dir === "up";
    const yt = Y(x.high) - 3, yb = Y(x.low) + 3, x1 = X(i1) + step / 2;
    els.push(<rect key={"is" + k} className="isl" x={x0} y={yt} width={Math.max(2, x1 - x0)} height={Math.max(2, yb - yt)}
      fill="none" stroke={GOLD} strokeWidth="1.2" strokeDasharray="3 3" clipPath={clip} data-kind={top ? "top" : "bottom"} />);
    islWant.push([x0, x1, yt, yb, top, k]);   // 字等進出場記號放好再找位置（不會被 ▲▼✕ 蓋住）
  });
  // 期貨換月（引擎 chart.overlays.rolls，i＝history 絕對位置）：灰色細虛直線＋底部小字「換月」；字太擠（相鄰 < 30px）只畫線
  let lastRx = -1e9;
  (rolls || []).forEach((r, k) => {
    if (!r || !Number.isFinite(Number(r.i)) || r.i < a || r.i >= b) return;
    const x = X(r.i - a);
    els.push(<line key={"rl" + k} className="roll" x1={x} x2={x} y1={T} y2={T + PH} stroke="#8b95a3" strokeWidth="1" strokeDasharray="2 3" data-roll={r.t} />);
    if (x - lastRx >= 30) {
      const lab = r.label || "換月";
      els.push(<text key={"rlt" + k} className="roll-t" x={x + 3} y={T + PH - 4}>{lab}{r.step_pct != null ? <title>{"換到下一個合約，價差 " + fpct(r.step_pct)}</title> : null}</text>);
      placed.push([x + 3, T + PH - 15, x + 3 + tw(lab), T + PH]);
      lastRx = x;
    }
  });
  // K 棒（收 ≥ 開＝紅）＋量柱：一般的併成 path；前五大量（金框＋金色量柱＋①～⑤）與盤中未定那根單獨畫
  const topI = {};
  for (const t of top || []) topI[t.i - a] = t.rank;
  const pth = { wu: "", wd: "", bu: "", bd: "", vu: "", vd: "" };
  const one = [], unfAt = [], rkAt = [];
  const f1d = (x) => x.toFixed(1);
  const addBar = (x, w, op, h, l, c, v) => {
    const s = c >= op ? "u" : "d", y1 = Y(Math.max(op, c)), bh = Math.max(1, Y(Math.min(op, c)) - y1);
    pth["w" + s] += "M" + f1d(x) + " " + f1d(Y(h)) + "V" + f1d(Y(l));
    pth["b" + s] += "M" + f1d(x - w / 2) + " " + f1d(y1) + "h" + w.toFixed(2) + "v" + f1d(bh) + "h" + (-w).toFixed(2) + "z";
    if (v > 0) pth["v" + s] += "M" + f1d(x - w / 2) + " " + f1d(VY(v)) + "h" + w.toFixed(2) + "v" + Math.max(0.5, VB - VY(v)).toFixed(1) + "h" + (-w).toFixed(2) + "z";
  };
  // 一個寬度單位塞超過一根時，每 grp 根併成一根（開＝第一根開、收＝最後一根收、高低取極值、量取最大），path 才不會長到拖曳卡頓
  const grp = Math.max(1, Math.floor(1 / step));
  if (grp > 1) {
    for (let i0 = 0; i0 < n; i0 += grp) {
      const i9 = Math.min(n, i0 + grp);
      let o = null, h = -Infinity, l = Infinity, c = null, v = 0;
      for (let i = i0; i < i9; i++) {
        const x = bars[i];
        if (x.c == null) continue;
        const op = x.o != null ? x.o : x.c;
        if (o == null) o = op;
        c = x.c; h = Math.max(h, x.h != null ? x.h : Math.max(op, x.c)); l = Math.min(l, x.l != null ? x.l : Math.min(op, x.c));
        v = Math.max(v, Number(x.v) || 0);
      }
      if (c != null) addBar(L + step * ((i0 + i9) / 2), Math.max(1, (i9 - i0) * step * 0.7), o, h, l, c, v);
    }
  }
  bars.forEach((x0b, i) => {
    const c = x0b.c;
    if (c == null) return;
    const op = x0b.o != null ? x0b.o : c;
    const h = x0b.h != null ? x0b.h : Math.max(op, c);
    const l = x0b.l != null ? x0b.l : Math.min(op, c);
    const up = c >= op, col = up ? K_UP : K_DN;
    const x = X(i), rk = topI[i], unf = x0b.final === false;
    const y1 = Y(Math.max(op, c)), bh = Math.max(1, Y(Math.min(op, c)) - y1);
    const v = Number(x0b.v);
    if (!rk && !unf) { if (grp === 1) addBar(x, bw, op, h, l, c, v); return; }
    one.push(<line key={"w" + i} x1={x} x2={x} y1={Y(h)} y2={Y(l)} stroke={col} strokeWidth="1" opacity={unf ? 0.55 : 1} />);
    one.push(<rect key={"b" + i} className={"bd" + (rk ? " top" : "") + (unf ? " unf" : "")} x={x - bw / 2} y={y1} width={bw} height={bh}
      fill={col} fillOpacity={unf ? 0.35 : 1} stroke={rk ? GOLD : unf ? col : undefined} strokeWidth={rk ? 1.6 : unf ? 1 : undefined}
      strokeDasharray={unf && !rk ? "2 2" : undefined} data-t={x0b.t} data-rank={rk || undefined} />);
    if (v > 0) {
      one.push(<rect key={"v" + i} className={"vb" + (rk ? " top" : "")} x={x - bw / 2} y={VY(v)} width={bw} height={Math.max(0.5, VB - VY(v))}
        fill={rk ? GOLD : col} fillOpacity={rk ? 1 : 0.3} />);
    }
    if (rk) rkAt.push([i, x, h, v, rk]);   // 編號等進出場記號放好再找位置
    if (unf) unfAt.push([i, x]);
  });
  els.push(<path key="wu" d={pth.wu} stroke={K_UP} strokeWidth="1" fill="none" />, <path key="wd" d={pth.wd} stroke={K_DN} strokeWidth="1" fill="none" />);
  els.push(<path key="bu" className="bd" d={pth.bu} fill={K_UP} />, <path key="bd" className="bd" d={pth.bd} fill={K_DN} />);
  els.push(<path key="vu" className="vb" d={pth.vu} fill={K_UP} fillOpacity=".55" />, <path key="vd" className="vb" d={pth.vd} fill={K_DN} fillOpacity=".55" />);
  els.push(...one);
  // 均線（所選那組三條 SMA，紅黃藍＝短到長，底下墊一條深色描邊才不會跟紅 K 糊在一起）＋ 出場線（面板選的那條，細線）
  const poly = (arr, key, col, w, casing) => {
    const segs = []; let cur = [];
    for (let i = 0; i < n; i = i + grp < n || i === n - 1 ? i + grp : n - 1) {   // K 棒有合併時線也每 grp 根取一點（含最後一根）
      const v = arr ? arr[a + i] : null;
      if (v == null || !Number.isFinite(v)) { if (cur.length > 1) segs.push(cur); cur = []; }
      else cur.push(f1d(X(i)) + "," + f1d(Y(v)));
    }
    if (cur.length > 1) segs.push(cur);
    segs.forEach((sg, k) => {
      const pts = sg.join(" ");
      if (casing) els.push(<polyline key={key + "c" + k} points={pts} fill="none" stroke="#0b0f15" strokeWidth={w + 2} strokeOpacity=".7" clipPath={clip} />);
      els.push(<polyline key={key + k} className="ma" data-ma={key} points={pts} fill="none" stroke={col} strokeWidth={w} strokeOpacity=".95" clipPath={clip} />);
    });
  };
  smas.forEach(([m, arr], k) => poly(arr, "sma" + m, MA_COL[k], 1.6, true));
  poly(ch.exit_line, "exit_ma", EMA_COL, 1, false);
  // 支撐（白實線）／壓力（白虛線）
  const lab = [];   // {y, t, col, nt}
  srl.forEach(([x, side]) => {
    if (x.price == null) return;
    const y = Y(x.price);
    els.push(<line key={"sr" + side} className={"sr-line " + side} x1={L} x2={xr} y1={y} y2={y} stroke="#ffffff" strokeWidth="1.8"
      strokeDasharray={side === "res" ? "7 5" : undefined} clipPath={clip} data-kind={side} data-price={x.price} />);
    lab.push({ y, t: (side === "sup" ? "撐 " : "壓 ") + fnum(x.price) + (srcAbbr(x.sources) ? " " + srcAbbr(x.sources) : "") + (x.testing ? " 測" : ""),
      col: "#ffffff", nt: x.pick_scope === "beyond" ? SR_BEYOND : "" });
  });
  // 進出場的線：停損紅虛線（抱著期間不動）；持倉中的線 i1=null → 延伸到右緣
  tlines.forEach((ln, k) => {
    if (ln.y == null) return;
    const [col, dash] = LINE_STYLE[ln.kind] || ["#ffffff", ""];
    const open = String(ln.kind).startsWith("open_");
    const x0 = XL(ln.i0 == null ? null : ln.i0 - a), x1 = ln.i1 == null ? xr : X(ln.i1 - a);
    if (x1 <= x0 && ln.i1 != null) return;
    els.push(<line key={"tl" + k} className={"trl " + ln.kind} x1={x0} x2={x1} y1={Y(ln.y)} y2={Y(ln.y)} stroke={col} strokeWidth={open ? 1.6 : 1.3}
      strokeDasharray={dash || undefined} clipPath={clip} data-kind={ln.kind} />);
  });
  // 持倉中：右側標籤（跟撐壓一起避讓）
  const op = trd.open;
  if (op) {
    const ly = (kind) => { const ln = (trd.lines || []).find((x) => x.kind === kind); return ln && ln.y != null ? ln.y : null; };
    const tag = op.side === 1 ? "多" : "空";
    for (const [kind, w, col] of [["open_entry", tag + "單進場 ", TR_ENT], ["open_stop", "停損 ", TR_STOP]]) {
      const v = ly(kind);
      if (v != null) lab.push({ y: Y(v), t: w + fpx(v), col, nt: "" });
    }
  }
  // 進出場：每筆進場到出場一條細虛線（這筆賺＝紅、賠＝綠）
  const byEntry = new Map(), byExit = new Map();
  for (const t of trd.trades || []) {
    byEntry.set(t.entry_i, t); byExit.set(t.exit_i, t);
    if (t.exit_i < a || t.entry_i >= b) continue;
    els.push(<line key={"trk" + t.entry_i} className="trlink" x1={X(t.entry_i - a)} y1={Y(t.entry)} x2={X(t.exit_i - a)} y2={Y(t.exit_px)}
      stroke={t.pct > 0 ? K_UP : K_DN} strokeWidth="1" strokeDasharray="4 3" strokeOpacity=".9" clipPath={clip} />);
  }
  if (op) byEntry.set(op.entry_i, op);
  // 記號：▲多進（紅大三角，K 低點下）／▼空進（綠大三角，K 高點上）、✕出場；旁邊標「多進 價格」「原因 價格 報酬%」。
  // 可見根數 > 250 只留圖形。標籤依序試幾個靠近記號的位置（原位→記號左右→另一側→往外錯開），選第一個不撞任何字／記號的；
  // 都撞就選重疊最少的。標籤夾在價格區內（右緣不超過 xr，不會蓋到右側撐壓標籤）
  const showLab = n <= 250, tlab = [], want = [];
  marks.forEach((m) => {
    const li = m.i - a, bb = bars[li], x = X(li);
    const t = m.kind === "entry" ? byEntry.get(m.i) : byExit.get(m.i);
    if (!t) return;
    const hit = { "data-tip": m.kind, "data-i": m.i, onMouseEnter: (e) => onTip && onTip(m.kind, t, e, false), onMouseLeave: () => onTip && onTip(null),
      onClick: (e) => { e.stopPropagation(); onTip && onTip(m.kind, t, e, true); }, onFocus: (e) => onTip && onTip(m.kind, t, e, false),
      onBlur: () => onTip && onTip(null), tabIndex: 0, role: "button",
      "aria-label": (t.side === 1 ? "多單" : "空單") + (m.kind === "entry" ? "進場 " + t.entry_t : "出場 " + t.exit_t) };
    if (m.kind === "entry") {
      const s = t.side, y = s === 1 ? Y(bb.l) + 5 : Y(bb.h) - 5, col = s === 1 ? K_UP : K_DN;
      els.push(<g key={"me" + m.i} className="mk-hit" {...hit}>
        <circle cx={x} cy={y + s * 7} r="12" fill="transparent" />
        <path className="mk-entry" d={`M${x.toFixed(1)} ${y.toFixed(1)} l-7 ${s * 12} h14 z`} fill={col} stroke="#0b0f15" strokeWidth="1" />
      </g>);
      placed.push([x - 7, Math.min(y, y + s * 12), x + 7, Math.max(y, y + s * 12)]);
      const y0 = s === 1 ? y + 26 : y - 16, ym = y + s * 6 + 4;
      want.push([(s === 1 ? "多進 " : "空進 ") + fpx(t.entry), col, "te", [[x, y0, "middle"], [x + 10, ym, "start"], [x - 10, ym, "end"],
        [x, y0 + s * 13, "middle"], [x + 10, ym + s * 13, "start"], [x - 10, ym + s * 13, "end"], [x, y0 + s * 26, "middle"], [x, y0 + s * 39, "middle"]]]);
    } else {
      const col = TONE[m.tone] || "#ffffff", y = Y(m.px);
      els.push(<g key={"mx" + m.i} className="mk-hit" {...hit}>
        <circle cx={x} cy={y} r="11" fill="transparent" />
        <path className="mk-exit" d={`M${(x - 5.5).toFixed(1)} ${(y - 5.5).toFixed(1)}l11 11m0 -11l-11 11`} stroke={col} strokeWidth="2.6" strokeLinecap="round" />
      </g>);
      placed.push([x - 6, y - 6, x + 6, y + 6]);
      const dy = t.side === 1 ? 13 : -13, yb = y + (t.side === 1 ? 16 : -9), yo = y + (t.side === 1 ? -9 : 16);
      want.push([(t.label || t.why) + " " + fpx(t.exit_px) + " " + fpc(t.pct), col, "tx", [[x + 9, yb, "start"], [x - 9, yb, "end"],
        [x + 10, y + 4, "start"], [x - 10, y + 4, "end"], [x + 9, yo, "start"], [x - 9, yo, "end"],
        [x + 9, yb + dy, "start"], [x - 9, yb + dy, "end"], [x + 9, yb + 2 * dy, "start"], [x - 9, yb + 2 * dy, "end"], [x + 9, yb + 3 * dy, "start"]]]);
    }
  });
  // 前五大量編號：相鄰幾根都上榜、或碰到 ▲▼✕ 時往上錯開，不疊在一起（量區的編號同樣錯開）
  const rkEls = [];
  for (const [i, x, h, v, rk] of rkAt) {
    let my = Y(h) - 5;
    for (let k = 0; k < 5 && busyAt([x - 7, my - 12, x + 7, my + 3]); k++) my -= 14;
    placed.push([x - 7, my - 12, x + 7, my + 3]);
    rkEls.push(<text key={"m" + i} className="mk" x={x} y={my} textAnchor="middle" data-rank={rk}>{mark(rk)}</text>);
    if (v > 0) {
      // 量區編號只在量區內找位置（量柱頂上方→往上錯開到量區頂→往下壓進量柱），不會跑進價格區或換月那一列；都撞就選重疊最少的
      const VT = T + PH + GP + 14, vy0 = Math.max(VT, VY(v) - 3), vbx = (y) => [x - 7, y - 12, x + 7, y + 3];
      const vc = [vy0];
      for (let y = vy0 - 13; y >= VT; y -= 13) vc.push(y);
      for (let y = vy0 + 13; y <= VB - 1; y += 13) vc.push(y);
      const vy = vc.find((y) => !busyAt(vbx(y))) ?? vc.reduce((u, y) => (hitArea(vbx(y)) < hitArea(vbx(u)) ? y : u), vy0);
      placed.push(vbx(vy));
      rkEls.push(<text key={"mv" + i} className="mk mkv" x={x} y={vy} textAnchor="middle">{mark(rk)}</text>);
    }
  }
  // 島狀反轉的字：進出場記號放好之後才放，畫在 K 棒和記號上面
  const islEls = [];
  for (const [x0, x1, yt, yb, top, k] of islWant) {
    // 島挨太近或碰到左上線名：字先往外疊開，外面沒位置（貼到圖頂／圖底）就改放框的另一側、再左右挪；都撞就選重疊最少的
    const cl = (y) => Math.min(T + PH - 3, Math.max(T + 11, y));
    const out = top ? [yt - 5, yt - 19, yt - 33, yt - 47] : [yb + 14, yb + 28, yb + 42, yb + 56], inn = top ? [yb + 14, yb + 28, yb + 42] : [yt - 5, yt - 19, yt - 33];
    const cx = Math.min(xr - 40, Math.max(L + 40, (x0 + x1) / 2));
    let best = null;
    for (const dx of [0, 76, -76]) {
      const lx0 = Math.min(xr - 40, Math.max(L + 40, cx + dx));
      for (const y of [...out, ...inn].map(cl)) {
        const bx = [lx0 - 36, y - 12, lx0 + 36, y + 4], o = hitArea(bx);
        if (!best || o < best[2]) best = [lx0, y, o, bx];
        if (!o) break;
      }
      if (!best[2]) break;
    }
    const [lx, ly] = best;
    placed.push(best[3]);
    islEls.push(<text key={"ist" + k} className="isl-t" x={lx} y={ly} textAnchor="middle">{top ? "頂部島狀反轉" : "底部島狀反轉"}</text>);
  }
  // 盤中未定（進出場記號放好之後才找位置，不會蓋到 ▲▼✕）：字往左寫會蓋到前幾根 K 和均線 → 放在字底下那幾根的最高點（含均線）上方，沒位置就放最低點下方；墊一塊底色、最後才畫
  const unfEls = [];
  for (const [i, x] of unfAt) {
    const s = d.unfinished_label || "盤中未定", w = tw(s) + 4;
    let hiP = -Infinity, loP = Infinity;
    for (let j = Math.max(0, Math.floor(i - (w + step) / step)); j <= i; j++) {
      const bj = bars[j];
      for (const v of [bj.h, bj.l, bj.c, ch.exit_line ? ch.exit_line[a + j] : null, ...smas.map(([, arr]) => (arr ? arr[a + j] : null))]) {
        if (v != null && Number.isFinite(v)) { hiP = Math.max(hiP, v); loP = Math.min(loP, v); }
      }
    }
    if (!Number.isFinite(hiP)) continue;
    const cl = (y) => Math.min(T + PH - 3, Math.max(T + 12, y));
    const cands = [Y(hiP) - 6, Y(hiP) - 20, Y(hiP) - 34, Y(loP) + 16, Y(loP) + 30].map(cl);
    const box = (y) => [x - w + 2, y - 12, x + 2, y + 3];
    const uy = cands.reduce((u, y) => (hitArea(box(y)) < hitArea(box(u)) ? y : u), cands[0]);   // 第一個不撞的；都撞就選重疊最少的
    placed.push(box(uy));
    unfEls.push(<rect key={"ufb" + i} className="unf-bg" x={x - w + 2} y={uy - 12} width={w} height={15} rx="2" fill="#0b0f15" fillOpacity=".85" />,
      <text key={"uf" + i} className="unf" x={x} y={uy} textAnchor="end">{s}</text>);
  }
  els.push(...kels);   // 圖上直接寫線的名字（不用點開圖例；位置上面已佔好）
  if (trd.sideLabel && !marks.length) els.push(<text key="sidenone" className="ckey" data-side-empty="" x={xr - 6} y={T + 13} textAnchor="end" style={{ fill: "#ffffff" }}>{"區間內沒有" + trd.sideNone + "訊號"}</text>);
  if (showLab) want.forEach(([s, col, cls, cands]) => {
    const w = tw(s);
    let best = null;
    for (const [x, y, anchor] of cands) {
      const x0 = Math.min(xr - 2 - w, Math.max(L + 2, anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x));
      const yy = Math.min(T + PH - 2, Math.max(T + 12, y)), bx = [x0, yy - 12, x0 + w, yy + 4], o = hitArea(bx);
      if (!best || o < best[2]) best = [x0, yy, o, bx];
      if (o === 0) break;
    }
    placed.push(best[3]);
    tlab.push(<text key={"tlb" + tlab.length} className={cls} x={best[0]} y={best[1]} textAnchor="start" style={{ fill: col }} data-ov={best[2] ? Math.round(best[2]) : undefined}>{s}</text>);
  });
  els.push(...rkEls, ...islEls, ...unfEls, ...tlab);  // 右側標籤避讓（由上到下排、不重疊、不超出價格區）；圖外的價位貼邊、加 ↑／↓
  for (const z of lab) {
    if (z.y < T) { z.y = T; z.t = "↑" + z.t; }
    else if (z.y > T + PH) { z.y = T + PH; z.t = "↓" + z.t; }
  }
  lab.sort((u, w) => u.y - w.y);
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
  if (lc != null && b === full.bars.length) els.push(<circle key="lc" className="lastc" cx={X(n - 1)} cy={Y(lc)} r="3" fill="#ffffff" />);
  return (
    <svg className="ta-k" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={TF_ZH[d.tf] + "線圖"} data-n={n} data-a={a} data-b={b}>
      <rect x="0" y="0" width={W} height={H} fill="#0b0f15" />
      <defs><clipPath id={cid}><rect x={L} y={T} width={pw} height={PH} /></clipPath></defs>
      {els}
    </svg>
  );
}

// 時間區間導覽列：整段收盤縮圖＋可拖的視窗（拖中間＝平移、拖兩邊把手＝縮放、點軌道＝跳過去）；鍵盤 ←→、Shift 加大步距
const NAV_MIN = 20;
function RangeNav({ bars, a, b, onChange }) {
  const N = bars.length, MIN = Math.min(NAV_MIN, N);
  const box = useRef(null), drag = useRef(null), raf = useRef(0), pend = useRef(null);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const line = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const x of bars) { const c = Number(x.c); if (Number.isFinite(c)) { if (c < lo) lo = c; if (c > hi) hi = c; } }
    const st = Math.max(1, Math.ceil(N / 600)), pts = [];
    for (let i = 0; i < N; i += st) {
      const c = Number(bars[i].c);
      if (Number.isFinite(c)) pts.push(((i / Math.max(1, N - 1)) * 1000).toFixed(1) + "," + (38 - ((c - lo) / (hi - lo || 1)) * 34).toFixed(1));
    }
    return pts.join(" ");
  }, [bars, N]);
  const fix = (m, x, y) => {
    if (m === "p") { const w = y - x; x = Math.max(0, Math.min(x, N - w)); return [x, x + w]; }
    if (m === "l") return [Math.max(0, Math.min(x, y - MIN)), y];
    return [x, Math.min(N, Math.max(y, x + MIN))];
  };
  const push = (r) => {   // 拖曳時每個畫面最多重畫一次
    pend.current = r;
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; onChange(pend.current); });
  };
  const down = (e) => {
    if (e.button !== 0 || !box.current) return;
    const rc = box.current.getBoundingClientRect();
    let m = e.target.dataset ? e.target.dataset.nav : undefined, a0 = a, b0 = b;
    if (m) e.target.focus({ preventScroll: true });
    else {   // 點在軌道上：視窗中心跳過去，接著可以直接拖
      const w = b - a, c = Math.round(((e.clientX - rc.left) / rc.width) * N) - Math.round(w / 2);
      [a0, b0] = fix("p", c, c + w);
      onChange([a0, b0]); m = "p";
    }
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (er) {}
    drag.current = { m, x: e.clientX, a: a0, b: b0, w: rc.width || 1 };
  };
  const move = (e) => {
    const s = drag.current;
    if (!s) return;
    const db = Math.round(((e.clientX - s.x) / s.w) * N);
    push(fix(s.m, s.a + (s.m !== "r" ? db : 0), s.b + (s.m !== "l" ? db : 0)));
  };
  const up = () => { drag.current = null; };
  const key = (m) => (e) => {
    const dir = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (!dir) return;
    e.preventDefault(); e.stopPropagation();
    const st = dir * Math.max(1, Math.round((b - a) / 20)) * (e.shiftKey ? 5 : 1);
    onChange(fix(m, a + (m !== "r" ? st : 0), b + (m !== "l" ? st : 0)));
  };
  const dt = (i) => String(bars[Math.max(0, Math.min(N - 1, i))].t || "").slice(0, 10);
  const pa = (a / N) * 100, pb = (b / N) * 100;
  const tip = "（左右鍵調整，Shift 加大步距）";
  return (
    <div className="ta-navw">
      <div ref={box} className="ta-nav" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <svg viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={line} fill="none" stroke="#6d8196" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="ta-navwin" data-nav="p" role="slider" tabIndex={0} aria-label={"平移時間區間" + tip} aria-valuemin={0} aria-valuemax={N - (b - a)}
          aria-valuenow={a} aria-valuetext={dt(a) + " 到 " + dt(b - 1)} onKeyDown={key("p")} style={{ left: pa + "%", width: pb - pa + "%" }}>
          <span className="ta-navh l" data-nav="l" role="slider" tabIndex={0} aria-label={"區間起點" + tip} aria-valuemin={0} aria-valuemax={b - MIN}
            aria-valuenow={a} aria-valuetext={dt(a)} onKeyDown={key("l")} />
          <span className="ta-navh r" data-nav="r" role="slider" tabIndex={0} aria-label={"區間終點" + tip} aria-valuemin={a + MIN} aria-valuemax={N}
            aria-valuenow={b} aria-valuetext={dt(b - 1)} onKeyDown={key("r")} />
        </div>
      </div>
      <div className="ta-navt" data-range>區間 {dt(a)} ～ {dt(b - 1)}，{b - a} 根 <span className="mut">拖中間平移、拖兩邊縮放；① 進出場的回測統計仍算整段歷史</span></div>
    </div>
  );
}

// 圖＋導覽列＋圖下三個分頁：區間狀態放這裡（② 缺口、③ 前五大量的表跟著區間變）；父層用 key＝代號|週期，換代號或週期就重新掛載＝回到預設區間
function ChartArea({ d, maSet }) {
  const ch = d.chart || {};
  const full = useMemo(() => fullSeries(d), [d.history, ch.bars, d.bars_completed]);   // eslint-disable-line react-hooks/exhaustive-deps
  const N = full.bars.length;
  const smas = useMemo(() => (g(ch, "ma_sets", maSet) || []).map((m) => [m, smaSeq(full.c, Number(m))]), [full, ch.ma_sets, maSet]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [rng, setRng] = useState(() => [Math.max(0, Math.min(full.k0, N - 2)), N]);   // 預設＝引擎的圖視窗（近 120 根）
  const b = Math.min(rng[1], N), a = Math.max(0, Math.min(rng[0], b - 2));
  const nf = d.bars_completed != null ? Math.min(d.bars_completed, N) : N;
  const gapsAll = useMemo(() => decodeGaps(g(ch, "overlays", "gaps"), full.bars), [ch.overlays, full]);   // eslint-disable-line react-hooks/exhaustive-deps
  const islAll = g(ch, "overlays", "islands") || [];
  const rollsAll = Array.isArray(g(ch, "overlays", "rolls")) ? ch.overlays.rolls : [];   // 舊回應沒有 rolls
  const top = useMemo(() => topVolume(full, a, b, nf, g(d, "signals", "top_volume", "items")), [full, a, b, nf, d.signals]);   // eslint-disable-line react-hooks/exhaustive-deps
  const view = useMemo(() => ({
    a, b, from: full.bars[a] ? full.bars[a].t : "", to: full.bars[b - 1] ? full.bars[b - 1].t : "", top,
    gaps: gapsAll.filter((x) => x.i >= a && x.i < b), islands: islAll.filter((x) => x.i1 >= a && x.i0 < b),
  }), [a, b, full, top, gapsAll, islAll]);
  // 進出場記號的浮動說明：滑鼠移上去／鍵盤聚焦就出現、離開就收；點一下（手機）會釘住，點別處或 Esc 才關
  const [tip, setTip] = useState(null);   // {kind, t, x, y, pin}
  const box = useRef(null);
  const onTip = useCallback((kind, t, e, pin) => {
    if (!kind) { setTip((v) => (v && v.pin ? v : null)); return; }
    let x = e.clientX, y = e.clientY;
    if (!x && !y && e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); x = r.right; y = r.bottom; }
    setTip({ kind, t, x, y, pin });
  }, []);
  useEffect(() => {
    if (!tip) return undefined;
    const off = (e) => { if (!(e.target.closest && (e.target.closest("[data-tip]") || e.target.closest(".ta-tipbox")))) setTip(null); };
    const esc = (e) => { if (e.key === "Escape") setTip(null); };
    const gone = () => setTip(null);
    document.addEventListener("pointerdown", off);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", gone, true);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", gone, true); };
  }, [tip]);
  // 量好框的大小再擺：預設在游標右下，超出畫面就翻到左／上，再不行貼邊。
  // 用 visualViewport＝實際看得到的那塊（手機 viewport 1200、放大後只看得到一部分，框要落在看得到的範圍）
  useLayoutEffect(() => {
    const el = box.current;
    if (!tip || !el) return;
    const vv = window.visualViewport;
    const ox = vv ? vv.offsetLeft : 0, oy = vv ? vv.offsetTop : 0;
    const vw = vv ? vv.width : document.documentElement.clientWidth, vh = vv ? vv.height : window.innerHeight;
    el.style.maxWidth = Math.max(160, Math.min(440, vw - 16)) + "px";
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = tip.x + 14, y = tip.y + 14;
    if (x + w > ox + vw - 8) x = tip.x - 14 - w;
    if (y + h > oy + vh - 8) y = tip.y - 14 - h;
    el.style.left = Math.max(ox + 8, Math.min(x, ox + vw - w - 8)) + "px";
    el.style.top = Math.max(oy + 8, Math.min(y, oy + vh - h - 8)) + "px";
    el.style.visibility = "visible";
  }, [tip]);
  const trd = d.trade || {};
  useEffect(() => setTip(null), [d.trade]);   // 參數一改、交易就換了，舊的說明作廢
  const info = tip && trd.ctx && trd.p ? (tip.kind === "entry" ? explainEntry(trd, trd.p, tip.t) : explainExit(trd, trd.p, tip.t)) : null;
  return (
    <>
      <KChart d={d} full={full} smas={smas} a={a} b={b} onTip={onTip} gaps={gapsAll} islands={islAll} top={top} rolls={rollsAll} />
      {N > NAV_MIN ? <RangeNav bars={full.bars} a={a} b={b} onChange={setRng} /> : null}
      <BlockTabs d={d} view={view} />
      {info ? (
        <div ref={box} className={"ta-tipbox " + (tip.t.side === 1 ? "long" : "short")} role="tooltip" style={{ left: 0, top: 0, visibility: "hidden" }}>
          <div className="tt">{info.title}{tip.kind === "entry" && trd.open && trd.open.entry_i === tip.t.entry_i ? <span className="hold">持倉中</span> : null}</div>
          <div className="ts">{info.sub}</div>
          <dl>{info.rows.map(([k, v], j) => <div key={j} className="ta-rule"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </div>
      ) : null}
    </>
  );
}

// 圖例：預設收合（點「圖例」才展開）；引擎給的 legend 逐項列（兩欄：記號→說明）＋目前畫的三條均線
const SW = {
  support: <i className="sw" style={{ color: "#fff" }} />,
  resistance: <i className="sw dash" style={{ color: "#fff" }} />,
  top_volume: <i className="bx gold" />,
  gap: <><i className="bx" style={{ background: K_UP }} /><i className="bx" style={{ background: K_DN }} /></>,
  exit_ma: <i className="sw" style={{ color: EMA_COL }} />,
  entry: <><b style={{ color: K_UP }}>▲</b><b style={{ color: K_DN }}>▼</b></>,
  stop: <i className="sw dash" style={{ color: TR_STOP }} />,
  exit: <><b style={{ color: TR_STOP }}>✕</b><b>✕</b></>,
  open: <i className="sw" style={{ color: TR_ENT }} />,
  link: <><i className="sw dash" style={{ color: K_UP }} /><i className="sw dash" style={{ color: K_DN }} /></>,
  island: <i className="bx isl" />,
  unfinished: <i className="bx unf" />,
  roll: <i className="sw dash" style={{ color: "#8b95a3" }} />,
};
function Legend({ d, maSet }) {
  const set = g(d, "chart", "ma_sets", maSet) || [];
  const eng = (g(d, "chart", "legend") || []).filter((x) => x.key !== "unfinished" || d.unfinished);
  const items = [...eng.filter((x) => x.key !== "unfinished"), ...(d.trade_legend || []), ...eng.filter((x) => x.key === "unfinished")];
  return (
    <details className="ta-legend">
      <summary>圖例</summary>
      <dl>
        <div className="ta-rule"><dt><span className="lg">{set.map((m, k) => <i key={m} className="sw" style={{ color: MA_COL[k] }} />)}</span>均線</dt>
          <dd>{set.map((m) => "SMA" + m).join("／")}（紅→黃→藍＝短到長；簡單均線，上方「均線組」切換）；K 棒紅漲綠跌，下方是成交量</dd></div>
        {items.map((x) => (
          <div key={x.key} className="ta-rule"><dt><span className="lg">{SW[x.key] || null}</span>{x.label}</dt><dd>{x.desc}</dd></div>
        ))}
        <div className="ta-rule"><dt>右側標籤</dt><dd>撐／壓價位＋來源：量＝前五大量 K 的高低、缺＝未補缺口邊緣、觸N＝觸及 N 根、測＝正在測試；缺口旁的一個字＝缺口類型（滑過看全名）</dd></div>
      </dl>
    </details>
  );
}

// ───────── 圖下的表 ─────────
const FILL_ZH = { none: "未補", partial: "部分回補", full: "已補" };
const REL_CLS = { "在上方": "up", "在下方": "dn" };
function optCols(rows, specs) {
  return specs.filter((c) => rows.some((x) => has(x[c.f]))).map((c) => ({
    label: c.label, title: c.title, num: c.num, cls: c.cls,
    render: c.render || ((x) => txt(x[c.f])),
    sort: c.sort || ((x) => (has(x[c.f]) ? (typeof x[c.f] === "number" ? x[c.f] : String(x[c.f])) : null)),
  }));
}
function islandText(x) {
  if (!x || typeof x !== "object") return txt(x);
  return [x.name, (x.start || "?") + "～" + (x.end || "?"), has(x.bars) ? x.bars + " 根" : ""].filter(Boolean).join(" ");
}

const rangeTxt = (v) => (v.from === v.to ? v.from : v.from + " ～ " + v.to) + "（" + (v.b - v.a) + " 根）";
function TopVolume({ d, view }) {
  const market = g(d, "symbol", "market");
  if (noVolume(d)) {
    return (
      <div className="ta-block" data-blk="vol">
        <div className="ta-cap">③ 前五大量</div>
        <div className="ta-empty" data-novol="">{NOVOL_TXT}（Yahoo 不給指數的量），沒有前五大量可列</div>
      </div>
    );
  }
  const rows = view.top;
  const cols = [
    { label: "#", render: (x) => mark(x.rank), sort: (x) => x.rank },
    { label: "時間", render: (x) => x.date, sort: (x) => x.date },
    { label: "幾根前", num: true, render: (x) => x.days_ago, sort: (x) => nz(x.days_ago) },
    { label: volUnit(market), num: true, render: (x) => fvol(x.volume, market), sort: (x) => nz(x.volume) },
    { label: "量倍數", num: true, title: "這根量 ÷ 之前 20 根均量", render: (x) => (x.vol_ratio == null ? "—" : f1(x.vol_ratio) + "x"), sort: (x) => nz(x.vol_ratio) },
    { label: "漲跌", num: true, render: (x) => <span className={ud(x.chg_pct)}>{fpct(x.chg_pct)}</span>, sort: (x) => nz(x.chg_pct) },
    ...optCols(rows, [{ f: "candle", label: "K 棒" }, { f: "close_pos", label: "收在", title: "收盤落在這根區間的哪一段", sort: (x) => nz(x.close_pos_ratio) }]),
    { label: "最高＝關卡", num: true, render: (x) => <>{fnum(x.high)} <span className="mut">({fpct(x.dist_high_pct)})</span></>, sort: (x) => nz(x.high) },
    { label: "最低＝關卡", num: true, render: (x) => <>{fnum(x.low)} <span className="mut">({fpct(x.dist_low_pct)})</span></>, sort: (x) => nz(x.low) },
    { label: "現價在", render: (x) => <b className={REL_CLS[x.relation] || ""}>{x.relation || "—"}</b>, sort: (x) => ({ "在上方": 1, "區間內": 0, "在下方": -1 })[x.relation] },
    ...(rows.some((x) => has(x.trend) || has(x.position_zh)) ? [{ label: "趨勢／位置", render: (x) => txt(x.trend) + "／" + txt(x.position_zh), sort: (x) => txt(x.trend) + txt(x.position_zh) }] : []),
  ];
  const reads = rows.filter((x) => has(x.read));
  return (
    <div className="ta-block" data-blk="vol">
      <div className="ta-cap">③ 前五大量 <span className="mut">區間 {rangeTxt(view)} 已定案 K 量最大的 {rows.length} 根（拖導覽列會重算）；那根的最高／最低就是關卡，括號＝關卡距現價；K 棒、趨勢位置與解讀只有近 120 根有</span></div>
      {rows.length ? <div className="ta-hs"><SortTable className="ta-dt" cols={cols} rows={rows} rowKey={(x) => "v" + x.rank} /></div>
        : <div className="ta-empty">區間內沒有成交量資料</div>}
      {reads.length ? (
        <dl className="ta-reads">{reads.map((x) => <div key={x.rank} className="ta-rule"><dt>{mark(x.rank)} {x.date}</dt><dd>{txt(x.read)}</dd></div>)}</dl>
      ) : null}
    </div>
  );
}

function Gaps({ view }) {
  const rows = view.gaps, isl = view.islands;   // 整段歷史裡落在區間的缺口；順序同引擎（未補依離現價近到遠、已補依時間新到舊）
  const nOpen = rows.filter((x) => x.fill !== "full").length;
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
      <div className="ta-cap">② 跳空缺口 <span className="mut">區間 {rangeTxt(view)} 全部 {rows.length} 個（未補／部分回補 {nOpen}、已補 {rows.length - nOpen}）；未補依離現價近到遠、已補依時間新到舊；回補狀態算到最後一根</span></div>
      {rows.length ? (
        <div className="ta-win10"><SortTable className="ta-dt" cols={cols} rows={rows} rowKey={(x) => x.date + x.dir} rowClass={(x) => (x.fill === "full" ? "filled" : "")} /></div>
      ) : <div className="ta-empty">區間內沒有跳空缺口</div>}
      {isl.length ? (
        <div className="ta-islands">區間內島狀反轉 {isl.length} 個：{isl.map((x, i) => <span key={i}>{i ? "；" : ""}{islandText(x)}</span>)}</div>
      ) : null}
    </div>
  );
}

const MA_NM = { short: "短（SMA5／10／20）", mid: "中（SMA8／13／34）", long: "長（SMA20／60／120）" };

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
    { label: "#", num: true, render: (t) => t.no || t.k + 1, sort: (t) => t.k },
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
      <div className="ta-cap">① 進出場 <span className="mut">依左邊「交易規則」面板即時回測（在你的瀏覽器算，不扣額度）</span></div>
      {d.rules ? (
        <div className="ta-cur" data-rules>
          <div className="ta-curh">目前套用的規則</div>
          <dl>
            <div className="ta-rule"><dt>進場</dt><dd>{d.rules.entry}</dd></div>
            <div className="ta-rule"><dt>停損</dt><dd>{d.rules.stop}</dd></div>
            <div className="ta-rule"><dt>出場</dt><dd>{d.rules.exit}</dd></div>
            <div className="ta-rule"><dt>成本</dt><dd>{d.rules.cost}</dd></div>
          </dl>
        </div>
      ) : null}
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
          <thead><tr><th>回測期間</th><th className="r">筆數</th><th className="r">勝率</th><th className="r">總報酬</th><th className="r" title="各筆報酬累加（不複利）從高點回落最多幾個百分點">最大回撤</th><th className="r">平均賺</th><th className="r">平均賠</th><th className="r" title="平均賺 ÷ 平均賠（絕對值）">賺賠比</th><th className="r">最大連續虧損</th></tr></thead>
          <tbody><tr>
            <td>{st.start || "—"}～{st.end || "—"}（{st.bars || "—"} 根{TF_ZH[d.tf]}）</td>
            <td className="r" data-stat="n">{trd.sideLabel ? trd.sideLabel + "：" + (st.n || 0) + " 筆" : <>{st.n || 0}（多 {st.n_long || 0}／空 {st.n_short || 0}）</>}</td>
            <td className="r">{st.n ? fpct(st.win_rate, false) + "（" + st.wins + "/" + st.n + "）" : "—"}</td>
            <td className={"r " + ud(st.sum_pct)} data-stat="sum">{fpct(st.sum_pct)}</td>
            <td className="r" data-stat="mdd">{st.n ? (st.mdd_pct > 0 ? "−" : "") + fnum(st.mdd_pct) + "%" : "—"}</td>
            <td className="r up">{fpct(st.avg_win_pct)}</td><td className="r dn">{fpct(st.avg_loss_pct)}</td>
            <td className="r">{st.payoff == null ? "—" : fnum(st.payoff)}</td>
            <td className="r">{st.max_consec_loss || 0} 筆</td>
          </tr></tbody>
        </table>
      </div>
      <div className="ta-note">{trd.note || "樣本內統計，不代表未來；未計手續費與滑價"}</div>
      <div className="ta-cap ta-sub">最近 10 筆 <span className="mut">新到舊；#＝全期第幾筆；損益＝（出場價 − 進場價）÷ 進場價（空單反過來）</span></div>
      {recent.length ? <div className="ta-win10"><SortTable className="ta-dt" cols={cols} rows={recent} rowKey={(t) => "t" + t.k} /></div>
        : <div className="ta-empty" data-side-empty={trd.sideLabel ? "" : undefined}>{trd.sideLabel ? "區間內沒有" + trd.sideNone + "訊號" : "期間內沒有成交"}</div>}
    </div>
  );
}

// 圖下三個大分頁（Yoda 2026-11-09）：[key, 分頁名, 區塊]；預設 ①。舊存的 vol／gap／trade 照對應，其他（含已刪的 ma）回預設
const BLOCKS = [
  ["trade", "① 進出場", Trade],
  ["gap", "② 跳空缺口", Gaps],
  ["vol", "③ 前五大量", TopVolume],
];
const BLK_KEY = "yoda_ta_blk";

function BlockTabs({ d, view }) {
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
  const Blk = BLOCKS.find(([k]) => k === cur)[2];
  return (
    <div className="ta-blks">
      <div className="ta-blktabs" role="tablist" aria-label="圖下資料" onKeyDown={onKey}>
        {BLOCKS.map(([k, nm]) => (
          <button key={k} id={"ta-blk-tab-" + k} type="button" role="tab" aria-selected={cur === k} aria-controls="ta-blk-panel"
            tabIndex={cur === k ? 0 : -1} className={"ta-blktab" + (cur === k ? " on" : "")} onClick={() => pick(k)}>{nm}</button>
        ))}
      </div>
      <div id="ta-blk-panel" role="tabpanel" aria-labelledby={"ta-blk-tab-" + cur} tabIndex={0}>
        <Blk d={d} view={view} />
      </div>
    </div>
  );
}

// ───────── 交易規則面板（11-09）：參數 → 瀏覽器回測 ─────────
const RULES_KEY = "yoda_ta_rules_v1";   // {cur, saved:[{name, p}], active}；只在這台瀏覽器
const SAVED_MAX = 30, NAME_MAX = 24;
const copyP = (p) => ({ ...p, ma_n: p.ma_n.slice() });
const sameP = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const DEF_P = normParams({}).p;
const BI = "內建：";   // active＝"內建：名稱"＝目前套用內建策略；自己存的名稱不能用這個開頭
const BUILTINS = PRESETS.map((x) => ({ name: x.name, p: normParams(x.p).p }));
// 讀回來的東西不信任：壞欄位回預設、壞策略丟掉；JSON 壞掉整個回預設
function cleanRules(o) {
  const x = o && typeof o === "object" ? o : {};
  const saved = (Array.isArray(x.saved) ? x.saved : [])
    .filter((s) => s && typeof s.name === "string" && s.name.trim() && !s.name.trim().startsWith(BI))
    .map((s) => ({ name: s.name.trim().slice(0, NAME_MAX), p: normParams(s.p).p }))
    .filter((s, i, a) => a.findIndex((y) => y.name === s.name) === i).slice(0, SAVED_MAX);
  const active = typeof x.active === "string" && (saved.some((s) => s.name === x.active) || BUILTINS.some((s) => BI + s.name === x.active)) ? x.active : null;
  return { cur: normParams(x.cur).p, saved, active };
}
function readRules() { try { return cleanRules(JSON.parse(lsGet(RULES_KEY) || "null")); } catch (e) { return cleanRules(null); } }

// 引擎回應＋參數 → 給圖與 ① 進出場用的 trade（記號、線、統計、橫幅、白話規則、圖例）
function withTrade(d, p0) {
  if (!d || !g(d, "history", "c")) return d;
  const nf = d.bars_completed;
  const p = effParams(p0, !noVolume(d));   // 沒有成交量：量的條件不套用（規則文字、浮動說明也用這份；面板上存的參數不改）
  const r = backtest(d.history, nf, p);
  const rt = ruleText(p);
  const exLab = p.exit_ma ? maName(p, p.exit_k) + "（出場線）" : null;
  const legend = [
    exLab ? { key: "exit_ma", label: exLab, desc: "收盤跌破（空單站上）就整筆出場" + (p.exit_delay ? "；進場後第 " + (p.exit_delay + 1) + " 根起才看" : "") } : null,
    { key: "entry", label: "多進／空進", desc: "紅色大三角多進、綠色大三角空進，旁邊標進場價：" + rt.entry },
    { key: "stop", label: "停損", desc: "紅虛線：" + rt.stop },
    { key: "exit", label: "✕ 出場", desc: "整筆出場，✕ 旁邊寫「原因 出場價 這筆報酬%」：停損（紅）／破N線／爆量反K／到期（白）；畫面超過 250 根時只留記號、不寫字" },
    { key: "link", label: "進→出", desc: "細虛線連進場與出場：這筆賺錢紅、賠錢綠" },
    { key: "island", label: "島狀反轉", desc: "金色虛線框＝懸空的那幾根 K，框上方標頂部島狀反轉、框下方標底部島狀反轉" },
    { key: "open", label: "持倉中", desc: "還沒出場的線延伸到右緣，右側標進場價與停損價" },
    { key: "tip", label: "滑過記號", desc: "滑鼠停在三角或 ✕ 上（手機點一下）會列出這筆進出場每個條件的實際數值" },
  ].filter(Boolean);
  return {
    ...d,
    // 記號與出場線用 history 的絕對位置（k0=0），圖依時間區間自己切
    chart: { ...d.chart, exit_line: exitLine(d.history, p, 0) },
    trade: { ...r, ...chartMarks(r, 0), p, note: "樣本內統計，不代表未來；" + rt.cost },
    rules: rt, trade_legend: legend,
  };
}

// 訊號顯示篩選（Yoda 11-10）：只篩圖上記號／線／標籤／浮動說明和 ① 進出場的清單與統計，回測本身不變（方向設定在面板）
const SIDES = [["all", "全部", 0], ["long", "只看多方", 1], ["short", "只看空方", -1]];
const SIDE_KEY = "yoda_ta_side";
function readSide() { const v = lsGet(SIDE_KEY); return SIDES.some(([k]) => k === v) ? v : "all"; }
function sideTrade(d, side) {
  const S = SIDES.find(([k]) => k === side), trd = d && d.trade;
  if (!S || !S[2] || !trd) return d;
  const s = S[2], st = trd.stats || {};
  const trades = (trd.trades || []).map((t, k) => ({ ...t, no: k + 1 })).filter((t) => t.side === s);   // no＝全期第幾筆
  const open = trd.open && trd.open.side === s ? trd.open : null;
  const r = { trades, open };
  return { ...d, trade: { ...trd, ...r, ...chartMarks(r, 0), stats: statsOf(trades, st.start, st.end, st.bars), sideLabel: S[1], sideNone: S[1].replace("只看", "") } };
}

// 模組層元件：寫在 RulePanel 裡面的話每次重繪都是新元件，輸入框會掉焦點
function RuleOpt({ children, hint, k, errors, warn }) {
  const ks = k ? [].concat(k).filter((x) => errors[x]) : [];
  return (
    <div className="ta-opt">
      <div className="row">{children}</div>
      {warn ? <div className="hint warn" data-novol="">{warn}</div> : null}
      {hint ? <div className="hint">{hint}</div> : null}
      {ks.map((x) => <div key={x} className="ta-ferr" role="alert">{errors[x]}（這格沒套用）</div>)}
    </div>
  );
}

function RulePanel({ draft, set, errors, status, saved, active, nm, setNm, rn, setRn, msg, onSave, onApply, onDel, onRen, onReset, noVol }) {
  const v = (x) => (x === undefined || x === null ? "" : String(x));
  const put = (k, x) => set({ ...draft, [k]: x });
  const M = draft.ma === "sma" ? "SMA" : "EMA";
  const man = (j) => M + v(draft.ma_n[j]);
  const N = (k, label, w, dis) => (
    <input type="text" inputMode="decimal" className={"ta-n" + (errors[k] ? " bad" : "")} style={w ? { width: w } : undefined}
      value={v(draft[k])} onChange={(e) => put(k, e.target.value)} aria-label={label} aria-invalid={!!errors[k]} data-k={k} disabled={!!dis} />
  );
  const NV = noVol ? NOVOL_TXT + "：量的條件不套用" : "";   // 這檔不套用，但勾選照存（換回有量的標的就恢復）
  const Rad = (k, x, text) => (
    <label key={String(x)}><input type="radio" name={"tr-" + k} checked={draft[k] === x} onChange={() => put(k, x)} />{text}</label>
  );
  const Chk = (k, text, dis) => <label className={dis ? "off" : undefined}><input type="checkbox" checked={!!draft[k]} onChange={(e) => put(k, e.target.checked)} data-k={k} disabled={!!dis} />{text}</label>;
  return (
    <section className="ta-rp" aria-label="交易規則">
      <h3>交易規則 <span className="ta-rpst" data-status>{status}</span></h3>
      <div className="ta-hint0">改任何一格，圖上的進出場、停損線、出場線和 ① 進出場的回測立刻重算；只在你的瀏覽器算，不扣額度。</div>

      <div className="ta-strats">
        <div className="row">
          <input type="text" className="ta-n ta-nm" placeholder="策略名稱" aria-label="策略名稱" maxLength={NAME_MAX} value={nm} onChange={(e) => setNm(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSave(); } }} />
          <button type="button" className="ta-btn" onClick={onSave}>存成策略</button>
          <button type="button" className="ta-btn" onClick={onReset} title="回到站方現行規則">還原預設</button>
        </div>
        {msg ? <div className="ta-ferr ok">{msg}</div> : null}
        <ul className="ta-slist ta-blist" aria-label="內建策略">
          {BUILTINS.map((s) => (
            <li key={s.name} className={BI + s.name === active ? "on" : ""}>
              <span className="ta-bi">內建</span>
              <button type="button" className="ta-sname" onClick={() => onApply(s, true)} aria-label={"套用內建策略：" + s.name}>{s.name}</button>
            </li>
          ))}
        </ul>
        <div className="hint">內建策略唯讀；套用後改任何一格就是「未存的修改」，可以填名字另存成自己的。</div>
        {saved.length ? (
          <ul className="ta-slist">
            {saved.map((s) => (
              <li key={s.name} className={s.name === active ? "on" : ""}>
                {rn && rn.old === s.name ? (
                  <>
                    <input type="text" className="ta-n ta-nm" aria-label="新名稱" maxLength={NAME_MAX} value={rn.val} autoFocus
                      onChange={(e) => setRn({ old: s.name, val: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") onRen(s.name, rn.val); if (e.key === "Escape") setRn(null); }} />
                    <button type="button" className="ta-link" onClick={() => onRen(s.name, rn.val)}>確定</button>
                    <button type="button" className="ta-link" onClick={() => setRn(null)}>取消</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="ta-sname" onClick={() => onApply(s)} aria-label={"套用策略：" + s.name}>{s.name}</button>
                    <button type="button" className="ta-link" onClick={() => setRn({ old: s.name, val: s.name })}>改名</button>
                    <button type="button" className="ta-link" onClick={() => onDel(s.name)}>刪除</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : <div className="hint">還沒有存過策略；調好參數、取個名字按「存成策略」。</div>}
      </div>

      <fieldset>
        <legend>進場</legend>
        <RuleOpt errors={errors} hint="EMA 對最近的價格反應快；SMA 每一根一樣重">均線 {Rad("ma", "ema", "EMA")}{Rad("ma", "sma", "SMA")}</RuleOpt>
        <RuleOpt errors={errors} k="ma_n" hint="由短到長三條；排列＝三條照順序排好（多：短＞中＞長）">
          週期
          {[0, 1, 2].map((j) => (
            <input key={j} type="text" inputMode="numeric" className={"ta-n" + (errors.ma_n ? " bad" : "")} value={v(draft.ma_n[j])} aria-label={"第 " + (j + 1) + " 條均線週期"}
              aria-invalid={!!errors.ma_n} data-k={"ma_n" + j} onChange={(e) => { const a = draft.ma_n.slice(); a[j] = e.target.value; put("ma_n", a); }} />
          ))}
        </RuleOpt>
        <RuleOpt errors={errors} k="fresh_n" hint="本根排好、前 N 根還沒全排好，才算「剛成立」">排列剛成立：回看 {N("fresh_n", "排列剛成立回看根數")} 根</RuleOpt>
        <RuleOpt errors={errors} k={["vol_in", "vol_n"]} hint="量比＝本根量 ÷ 前 N 根平均量；不勾＝不看量" warn={NV}>
          {Chk("vol_on", "量比 ≥", noVol)}{N("vol_in", "進場量比門檻", null, noVol)}，比前 {N("vol_n", "量比比較根數", null, noVol)} 根
        </RuleOpt>
        <RuleOpt errors={errors} hint={"多單收盤要在 " + man(0) + " 上方、空單在下方"}>{Chk("side_ma", "收在第一條均線同側（" + man(0) + "）")}</RuleOpt>
      </fieldset>

      <fieldset>
        <legend>停損</legend>
        <RuleOpt errors={errors} k="stop_n" hint="進場那根往前數 N 根（含進場根）的最低點；空單用最高點">{Rad("stop", "low_n", "近")}{N("stop_n", "停損近幾根")} 根極值</RuleOpt>
        <RuleOpt errors={errors} k="stop_pct" hint="多單＝進場價 ×（1 − X%）；空單＝進場價 ×（1 + X%）">{Rad("stop", "pct", "固定")}{N("stop_pct", "固定停損百分比")} %</RuleOpt>
        <RuleOpt errors={errors} k={["atr_k", "atr_n"]} hint="ATR＝平均真實波幅（Wilder）；停損＝進場價往不利方向 K 倍 ATR">
          {Rad("stop", "atr", "ATR")}{N("atr_n", "ATR 根數")} 的 {N("atr_k", "ATR 倍數")} 倍
        </RuleOpt>
        <RuleOpt errors={errors} hint="盤中碰到＝最低（空單最高）碰到就出；收盤破＝收盤價破了才出、用收盤價">
          觸發 {Rad("stop_on", "touch", "盤中碰到")}{Rad("stop_on", "close", "收盤破")}
        </RuleOpt>
      </fieldset>

      <fieldset>
        <legend>出場</legend>
        <RuleOpt errors={errors} hint="收盤跌破這條（空單站上）就整筆出；圖上桃紅細線就是它">
          {Chk("exit_ma", "收破第")}
          <select className="ta-n ta-sel2" value={draft.exit_k} onChange={(e) => put("exit_k", Number(e.target.value))} aria-label="出場看第幾條均線" data-k="exit_k">
            {[1, 2, 3].map((k) => <option key={k} value={k}>{k}（{man(k - 1)}）</option>)}
          </select> 條線
        </RuleOpt>
        <RuleOpt errors={errors} k="exit_delay" hint="0＝進場後下一根就開始看；3＝先放 3 根不看，第 4 根起才看">進場後 {N("exit_delay", "出場線延遲根數")} 根才開始看這條</RuleOpt>
        <RuleOpt errors={errors} k="vol_out" hint={"量比達門檻＋收反向 K（多單收黑）＋收破 " + man(0) + " → 收盤整筆出"} warn={NV}>{Chk("vol_exit", "爆量反向 K，量比 ≥", noVol)}{N("vol_out", "爆量反向K量比門檻", null, noVol)}</RuleOpt>
        <RuleOpt errors={errors} k="max_hold" hint="抱滿 N 根還沒出，就在第 N 根收盤整筆出">{Chk("max_hold_on", "最多持有")}{N("max_hold", "最多持有根數")} 根</RuleOpt>
      </fieldset>

      <fieldset>
        <legend>方向＋成本</legend>
        <RuleOpt errors={errors} hint="雙向＝多頭排列做多、空頭排列做空">{Rad("dir", "both", "雙向")}{Rad("dir", "long", "只做多")}{Rad("dir", "short", "只做空")}</RuleOpt>
        <RuleOpt errors={errors} k={["fee", "slip"]} hint="每筆來回扣 2 ×（手續費＋滑價）個百分點；0＝不計（站方現行規則未計）">
          手續費 {N("fee", "手續費百分比（每邊）")} %　滑價 {N("slip", "滑價百分比（每邊）")} %（每邊）
        </RuleOpt>
      </fieldset>
    </section>
  );
}

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
  // 交易規則：draft＝面板上看到的（可能有打錯的格子）；applied＝實際套用（打錯的格子沿用上一個好的值）
  const [draft, setDraft] = useState(() => copyP(DEF_P));
  const [saved, setSaved] = useState([]);
  const [active, setActive] = useState(null);
  const [rulesReady, setRulesReady] = useState(false);
  const [nm, setNm] = useState("");
  const [rn, setRn] = useState(null);           // 改名中 {old, val}
  const [pmsg, setPmsg] = useState("");
  const good = useRef(DEF_P);
  const norm = useMemo(() => normParams(draft, good.current), [draft]);
  const applied = norm.p;
  const hasErr = Object.keys(norm.errors).length > 0;
  useEffect(() => { good.current = applied; }, [applied]);
  useEffect(() => {
    const r = readRules();
    good.current = r.cur;
    setDraft(copyP(r.cur)); setSaved(r.saved); setActive(r.active); setRulesReady(true);
  }, []);
  useEffect(() => {
    if (rulesReady) lsSet(RULES_KEY, JSON.stringify({ cur: applied, saved, active }));
  }, [rulesReady, applied, saved, active]);
  const dv = useMemo(() => {
    const x = data && data.tf === tf ? data : null;
    try { return withTrade(x, applied); } catch (e) { console.error("[ta] 進出場計算失敗", e); return x; }   // 在 Boundary 外面，丟例外會整頁崩
  }, [data, tf, applied]);
  const [side, setSide] = useState(readSide);
  const pickSide = (k) => { setSide(k); lsSet(SIDE_KEY, k); };
  const dvs = useMemo(() => sideTrade(dv, side), [dv, side]);
  const bkey = useMemo(() => [dvs, maSet], [dvs, maSet]);   // Boundary 重試鍵：資料、交易參數、均線組、訊號篩選任一換了就重試
  const actB = BUILTINS.find((x) => BI + x.name === active);
  const actS = actB || saved.find((x) => x.name === active);
  const rstatus = actS ? (actB ? "內建・" : "") + actS.name + (sameP(actS.p, applied) ? "" : "（未存的修改）") : sameP(applied, DEF_P) ? "預設（站方現行規則）" : "自訂（未存）";
  const badName = (n) => (n.startsWith(BI) ? "「" + BI + "」開頭的名稱保留給內建策略" : "");
  const saveS = () => {
    const n = nm.trim().slice(0, NAME_MAX);
    if (!n) { setPmsg("先填策略名稱"); return; }
    if (badName(n)) { setPmsg(badName(n)); return; }
    if (hasErr) { setPmsg("有格子不合法，先改好再存"); return; }
    if (!saved.some((x) => x.name === n) && saved.length >= SAVED_MAX) { setPmsg("最多存 " + SAVED_MAX + " 組，先刪掉幾組"); return; }
    setSaved((a) => [{ name: n, p: copyP(applied) }, ...a.filter((x) => x.name !== n)]);
    setActive(n); setNm(""); setPmsg("已存成「" + n + "」");
  };
  const applyS = (x, bi) => { setDraft(copyP(x.p)); setActive((bi ? BI : "") + x.name); setRn(null); setPmsg("已套用" + (bi ? "內建" : "") + "「" + x.name + "」"); };
  const delS = (n) => { setSaved((a) => a.filter((x) => x.name !== n)); if (active === n) setActive(null); setPmsg("已刪除「" + n + "」"); };
  const renS = (old, val) => {
    const n = String(val || "").trim().slice(0, NAME_MAX);
    if (!n) { setPmsg("名稱不能空白"); return; }
    if (badName(n)) { setPmsg(badName(n)); return; }
    if (n !== old && saved.some((x) => x.name === n)) { setPmsg("已經有叫「" + n + "」的策略"); return; }
    setSaved((a) => a.map((x) => (x.name === old ? { ...x, name: n } : x)));
    if (active === old) setActive(n);
    setRn(null); setPmsg("已改名為「" + n + "」");
  };
  const resetS = () => { setDraft(copyP(DEF_P)); setActive(null); setRn(null); setPmsg("已還原預設"); };

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
      if (j.reason === "daily-only" && t !== "D") { load(s, "D"); return; }   // 台指期／費半期只有日K、週K：選著 1H／4H 查就自動改日K
      setErr({ reason: j.reason, error: j.error || "讀取失敗" }); setData(null); return;
    }
    cache.current.set(ck, j.data);
    setData(j.data);
    const code = g(j.data, "symbol", "code") || s;
    const nx = cleanRecent([{ s: String(code), n: g(j.data, "symbol", "name") }, ...readRecent().filter((x) => x.s !== code && x.s !== s)]).slice(0, RECENT_MAX);
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

  const d = dvs;
  const { lastB, chg, unfB, symInfo } = headInfo(d);

  return (
    <main className="ta-root ta-app">
      <div className="ta-wm" aria-hidden="true">{Array.from({ length: 36 }, (_, i) => <span key={i}>{wm || "會員專屬"}</span>)}</div>
      <header className="ta-head">
        <div className="ta-hrow">
          <span className="ta-badge">會員專屬</span>
          <h1 className="ta-h1">技術分析<span className="sep">｜</span><span className="ta-sub2">台股上市櫃・美股・ETF・美國期貨・台指期・費半，1H／4H／日K／週K</span></h1>
        </div>
      </header>

      <div className="ta-split">
        {/* ── 左 1/4：輸入＋最近查過＋額度 ── */}
        <aside className="ta-left" aria-label="查詢">
          <form className="ta-ltools" onSubmit={submit}>
            <label className="ta-lab" htmlFor="ta-in">輸入代號</label>
            <div className="ta-inrow">
              <input id="ta-in" type="search" className="ta-q" placeholder="2330、00878、NVDA、NQ1!、台指期" value={q}
                onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false} enterKeyHint="search" />
              <button type="submit" className="ta-btn ta-go" disabled={busy || !q.trim()}>查</button>
            </div>
            <div className="ta-hint">台股打數字代號（先找上市、再找上櫃）、美股打英文代號；美國期貨打 ES1!、NQ1!、YM1!、RTY1!、GC1!、CL1!（也可打 小那、小道、黃金期、原油期）；台指期打 TXF1!（或 台指期）、費半期打 SXF1!（或 費半期），只有日K／週K；指數只收 ^SOX（費半）</div>
          </form>
          <div className="ta-quota" data-left={quota && !quota.unlimited ? quota.left : ""}>
            {owner || (quota && quota.unlimited) ? <>站長：不限檔數</> : quota ? (
              <>今日已查 <b>{quota.used}</b>／{quota.max} 檔，剩 <b className={quota.left ? "" : "warn"}>{quota.left}</b> 檔
                <div className="mut">同一檔換週期、均線組不另計；台灣時間 0 點重算</div></>
            ) : "—"}
          </div>
        </aside>

        <RulePanel draft={draft} set={setDraft} errors={norm.errors} status={rstatus} saved={saved} active={active}
          nm={nm} setNm={setNm} rn={rn} setRn={setRn} msg={pmsg} onSave={saveS} onApply={applyS} onDel={delS} onRen={renS} onReset={resetS}
          noVol={noVolume(dv)} />

        <div className="ta-left ta-recent">
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
        </div>

        {/* ── 右 3/4：週期＋均線組＋圖＋表 ── */}
        <div className="ta-right">
          <div className="ta-tabs">
            <TfTabs tf={tf} tfs={symInfo.tfs} onPick={(k) => (sym ? load(sym, k) : setTf(k))} />
            <div className="ta-seg" role="group" aria-label="均線組">
              <span className="ta-seglab">均線</span>
              {MA_SETS.map(([k, nm]) => (
                <button key={k} type="button" aria-pressed={maSet === k} className={"ta-tab" + (maSet === k ? " on" : "")} onClick={() => setMaSet(k)}
                  title={MA_NM[k]}>{nm}</button>
              ))}
            </div>
            <div className="ta-seg" role="group" aria-label="訊號篩選">
              <span className="ta-seglab">訊號</span>
              {SIDES.map(([k, nm]) => (
                <button key={k} type="button" aria-pressed={side === k} className={"ta-tab" + (side === k ? " on" : "")} onClick={() => pickSide(k)} data-side={k}>{nm}</button>
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
              <Boundary reset={bkey}>
              <div className="ta-one" data-sym={symInfo.yahoo}>
                <div className="ta-ch">
                  <h2><span className="mono">{symInfo.code || sym}</span>{symInfo.name || ""}</h2>
                  <span className="ta-px mono">{fnum(lastB && lastB.c)} <span className={ud(chg)}>{fpct(chg)}</span></span>
                  <span className="ta-chip asof">{TF_ZH[d.tf]}・最後定案 {d.asof || "—"}</span>
                  {unfB ? <span className="ta-chip warn">{d.unfinished_label || "盤中未定"} {fnum(unfB.c)}</span> : null}
                  <span className="ta-chip" data-mkt={symInfo.market || ""}>{mktBadge(symInfo)}</span>
                  {symInfo.market === "fut" && typeof symInfo.contract === "string" && symInfo.contract ? <span className="ta-chip" title="連續月目前接的合約">連續月・{symInfo.contract}</span> : null}
                  {typeof symInfo.session === "string" && symInfo.session ? <span className="ta-chip" data-k="session">{symInfo.session}</span> : null}
                </div>
                <FutInfo s={symInfo} onPick={(c) => load(c, "D")} />
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
                <Boundary reset={bkey}><ChartArea key={(symInfo.yahoo || sym) + "|" + d.tf} d={d} maSet={maSet} /></Boundary>
                <Boundary reset={bkey}><Legend d={d} maSet={maSet} /></Boundary>
                {(d.notes || []).length ? <div className="ta-notes">資料註記：{d.notes.join("；")}</div> : null}
                <Boundary reset={bkey}><SrLevels d={d} /></Boundary>
              </div>
              </Boundary>
            ) : null}
            <div className="ta-foot">
              資料來源 {g(d, "symbol", "exchange") === "TAIFEX" ? "臺灣期貨交易所（近月連續，價格不還原）" : "Yahoo Finance（開高低收依除息事件還原）"}；以上數字全由寫死的規則計算，只描述過去的價量位置與這套規則的歷史表現，不是買賣建議。
              本頁為會員專屬，請勿轉傳。
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
