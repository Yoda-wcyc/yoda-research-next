"use client";
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { normParams, backtest, chartMarks, exitLine, ruleText, maName, smaSeq, PRESETS, explainEntry, explainExit, fpx, fpc, statsOf, hasVolume, effParams, keyKEvents, volMult, KEYK_N, KEYK_TOP } from "../../lib/ta-trade";
import { presetStart } from "../../lib/ta-rs";
import { fourStep, info4, l2Info4, step4Name } from "../../lib/ta-4step";
import { OPT_GROUPS, optSym, dte, fmtTs, candidates, cost as optCost, pnl as optPnl, retPct, maxGain, lots } from "../../lib/ta-opt";

// 會員技術分析（獨立網站版·2026-11-08 Yoda 定）
//
//   會員登入（/api/member-login，票存 localStorage）→ /api/ta-live 每次都重驗：站長（OWNER_PUB_IDS）或 ta_access 有開通
//   左 1/4：輸入代號（點輸入框下拉最近查過，11-13）＋今日額度（會員每天 30 檔、站長不限）；輸入框下的代號說明 11-13 永久刪（守門見 tests/ta_client_regress.cjs）
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
//   右上分頁「指數位階」「區間強弱」「趨勢樣板」（11-17：多空樣板檔數占比折線＋今天多空名單，/api/ta-rs op:'tt'；台股｜美股切換跟區間強弱共用）
//           「選擇權」（11-23）：下拉 11 檔美股／ETF（不跟 K 線代號連動）→ 看漲買 Call／看跌買 Put 的到期損益表＋試算（/api/ta-opt，CBOE 延遲報價；計算在 lib/ta-opt.js）
//   週期列共振閃爍（11-23）：背景另抓同一檔的 1H、4H（跟點週期共用同一次請求），用面板規則回測、只看定案 K；同方向最近一次進場都在 8 小時內 → 1H／4H 鈕一起閃
//           （多紅空綠，跟訊號篩選連動；hover 列兩邊進場時間；過 8 小時或點過那次就停，新訊號再閃；減少動態＝不閃、改外框）
//   關鍵K（11-23）：工具列「關鍵K」鈕（記 localStorage yoda_ta_kk，預設開）；大量 K＝每根之前 120 根量最大 5 根（「當時可得」，跟面板進場選項
//           「突破／跌破關鍵 K」同一份 lib/ta-trade.js keyKEvents，不跟可見區間走）；K 棒加白框＋名次，收盤第一次站上最高標「破①↑」（紅）、跌破最低「破①↓」（綠）
//   空方四步／多方四步（11-24）：工具列兩顆鈕（記 localStorage yoda_ta_s4／yoda_ta_l4，預設關）；規則在 lib/ta-4step.js（整段已收完的 K、point-in-time），
//           作廢的序列不畫；不是交易訊號：不進左側面板、回測統計、共振閃爍
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
const volUnit = (market) => (market === "idx" ? "量（Yahoo 指數量）" : market === "tw" ? "量（張）" : market === "fut" ? "量（口）" : "量（股）");
// 指數（^TWII，11-19）的量是 Yahoo 自己的指數量：不是股、張、筆（單位未公開，只看相對大小）→ 不換算張、照原值 M 顯示
const volMkt = (d) => (g(d, "symbol", "type") === "INDEX" ? "idx" : g(d, "symbol", "market"));
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
// 輸入框下拉的最近查過（11-13，取代左欄底部清單）：整塊 onMouseDown 擋掉，輸入框才不會先 blur 把清單收掉
// 台股（數字開頭的代號）名稱改用 zh（台股面板的中文名，/api/ta-rs op:names）；面板沒有的（ETF 等）只顯示代號，不用引擎的英文名
// 標題列（11-14）：台股有 zh 中文名就用，沒有照舊用引擎回的名稱；美股、期貨不變
const titleName = (s, code, zh) => (s.market === "tw" && zh && typeof zh[code] === "string" && zh[code] ? zh[code] : s.name || "");
const recentName = (r, zh) => (/^\d/.test(r.s) ? (zh && typeof zh[r.s] === "string" ? zh[r.s] : "") : r.n);
function RecentDrop({ items, hi, cur, onPick, onClear, zh }) {
  return (
    <div id="ta-dd" className="ta-dd" role="listbox" aria-label="最近查過" onMouseDown={(e) => e.preventDefault()}>
      {items.map((r, i) => { const n = recentName(r, zh); return (
        <div key={r.s} id={"ta-dd-" + i} role="option" aria-selected={i === hi} className={"ta-li" + (r.s === cur ? " on" : "") + (i === hi ? " hi" : "")} onClick={() => onPick(r.s)}>
          <div className="l1"><b className="mono">{r.s}</b><span className="nm" title={n}>{n}</span></div>
        </div>
      ); })}
      <div className="ta-ddfoot"><button type="button" className="ta-link" onClick={onClear}>清除紀錄</button></div>
    </div>
  );
}

// 共振閃爍（Yoda 11-23）：同一檔的 1H、4H 用面板規則回測（只用定案 K），同方向最近一次進場都在 8 小時內（以現在時間）→ 1H／4H 鈕一起閃
const MTF_WIN = 8 * 3600e3, MTF_TFS = ["1H", "4H"], GONE_KEY = "yoda_ta_blink_gone";
// 交易所當地時間 "YYYY-MM-DD HH:MM"（引擎契約）→ epoch 毫秒；兩次修正夏令時間
function tzMs(t, tz) {
  const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)/.exec(String(t || ""));
  if (!m) return NaN;
  const u = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
    const off = (x) => { const q = {}; for (const p of f.formatToParts(x)) q[p.type] = +p.value; return Date.UTC(q.year, q.month - 1, q.day, q.hour % 24, q.minute) - x; };
    return u - off(u - off(u));
  } catch (e) { return NaN; }
}
// 那根 K 收完的時間（11-23）：開始＋週期小時，遇收盤那段取收盤（台股 4H 13:00 那根到 13:30、美股 1H 15:30 到 16:00），不超過當天收盤
// 期貨（market fut，同引擎 _fut_1h／bars_4h）：18:00 開、隔天 17:00 收 → 上限 17:00，且只套在 17:00 前開始的 K（18:00 後的屬隔天交易日）
// shortcut: 美股提早收盤日（13:00 收）不認得，12:30／09:30 那根算到 13:30（多閃 30 分，跟引擎 end 一樣），要準得接休市日曆
const MTF_CLOSE = { "Asia/Taipei": "13:30", "America/New_York": "16:00" };
function barEnd(t, h, tz, mkt) {
  const s = tzMs(t, tz), e = s + h * 3600e3, cl = mkt === "fut" ? "17:00" : MTF_CLOSE[tz];
  const c = cl ? tzMs(String(t).slice(0, 10) + " " + cl, tz) : NaN;
  return c > s && c < e ? c : e;
}
function lastEntry(r, s) {   // 某方向最近一次進場的 K 時間（持倉中的那筆一定最新）
  if (r.open && r.open.side === s) return r.open.entry_t;
  for (let k = r.trades.length - 1; k >= 0; k--) if (r.trades[k].side === s) return r.trades[k].entry_t;
  return null;
}
// r1／r4＝backtest 結果；side＝訊號篩選（all 兩邊都看，同時成立取比較新的）→ {s, key, tip}｜null
function mtfBlink(r1, r4, tz, side, now, mkt) {
  if (!r1 || !r4) return null;
  let best = null;
  for (const s of side === "long" ? [1] : side === "short" ? [-1] : [1, -1]) {
    const t1 = lastEntry(r1, s), t4 = lastEntry(r4, s);
    if (!t1 || !t4) continue;
    const a = barEnd(t1, 1, tz, mkt), b = barEnd(t4, 4, tz, mkt);
    if (!(now - a <= MTF_WIN && now - b <= MTF_WIN)) continue;
    const nm = s === 1 ? "多進" : "空進", hm = (t) => String(t).slice(5, 16).replace("-", "/");
    if (!best || Math.min(a, b) > best.m) best = { s, m: Math.min(a, b), key: s + "|" + t1 + "|" + t4, tip: "1H " + nm + " " + hm(t1) + "、4H " + nm + " " + hm(t4) };
  }
  return best;
}
function readGone() { try { const a = JSON.parse(lsGet(GONE_KEY) || "[]"); return Array.isArray(a) ? a.filter((x) => typeof x === "string") : []; } catch (e) { return []; } }

function TfTabs({ tf, tfs, onPick, blink }) {
  const ok = Array.isArray(tfs) && tfs.length ? tfs : null;
  return (
    <div className="ta-seg" role="tablist" aria-label="週期">
      {TFS.map(([k, nm]) => {
        const off = !!ok && !ok.includes(k);
        const bl = !!blink && !off && MTF_TFS.includes(k);
        return (
          <button key={k} type="button" role="tab" aria-selected={tf === k} className={"ta-tab" + (tf === k ? " on" : "") + (bl ? " ta-blink " + (blink.s === 1 ? "b-up" : "b-dn") : "")} disabled={off}
            title={off ? TWF_ONLY_TXT : bl ? blink.tip : undefined} onClick={() => onPick(k)}>{nm}</button>
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
// 票過了一半壽命（或不是 aud:'ta' 長效票、或讀不出期限）→ 該問 status 續票；只看期限、不驗簽（驗簽在伺服器）
function pastHalf(t) {
  try {
    const p = JSON.parse(atob(String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return p.aud !== "ta" || !(p.iat && p.exp) || Date.now() / 1000 - p.iat >= (p.exp - p.iat) / 2;
  } catch (e) { return !!t; }
}
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
function SortTable({ cols, rows, rowKey, className, rowClass, onRow, init }) {   // init＝[第幾欄, 1 升／-1 降]：一開始就照這欄排（表頭帶箭頭）
  const [sk, setSk] = useState(init ? init[0] : null);
  const [dir, setDir] = useState(init ? init[1] : 1);
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
          <tr key={rowKey ? rowKey(r) : ri} className={rowClass ? rowClass(r) : ""} onClick={onRow ? () => onRow(r) : undefined}>
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
// 四步顏色（11-24 demo）：①② 中性、空3 綠／多3 紅、4 灰、利＝淡色；line＝L2／H2 虛線
const S4C = {
  s: { nm: "空方四步 ", r2: "L2", line: "#8fcfb0", col: { 1: "#d6dde6", 2: "#d6dde6", 3: "#6fd6a0", 4: "#8b95a3", x: "#b9ecd2" } },
  l: { nm: "多方四步 ", r2: "H2", line: "#f0a0a8", col: { 1: "#eadbc8", 2: "#eadbc8", 3: "#ff8f96", 4: "#8b95a3", x: "#ffc6cb" } },
};
const MA_COL = ["#ff4d4f", "#f5c518", "#3d8bfd"];   // 均線由短到長：紅、黃、藍（Yoda 2026-11-09）
const EMA_COL = "#ff5ce1";
const YR_COL = "#b9a3ff";   // 年線 SMA240（11-19）：日K 常駐細線；週K 對應 52 週線 SMA52（11-19）；不屬於均線組、不進交易計算
const TR_STOP = "#ff4d4d", TR_ENT = "#9ad0ff";
const LINE_STYLE = { stop: [TR_STOP, "5 3"], open_entry: [TR_ENT, ""], open_stop: [TR_STOP, "5 3"] };
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

// 關鍵K（11-23）：已定案 K 的 keyKEvents（ev）＋目前（最後定案那根之後）的前五大量（cur，還沒突破／跌破的也框）；j／k＝history 絕對位置
function keyKAll(full, nf) {
  const n = Math.min(nf, full.bars.length), col = (f) => full.bars.slice(0, n).map((x) => (x[f] == null ? NaN : Number(x[f])));
  const H = col("h"), L = col("l"), C = col("c"), V = col("v");
  const js = [];
  for (let j = Math.max(0, n - KEYK_N); j < n; j++) if (V[j] > 0) js.push(j);
  js.sort((x, y) => V[y] - V[x] || y - x);
  return { ev: keyKEvents(H, L, C, V, n), cur: js.slice(0, KEYK_TOP).map((j, r) => ({ j, rank: r + 1 })), H, L, V };
}

// K 線圖畫整段歷史的 [a, b) 這一段；Y 軸依區間內高低。K 棒與量柱併成幾條 path（1H 五千根拖曳才不卡）
// 框選放大／滾輪縮放（11-23，只桌機）：KW／KL／KR＝K 線圖 viewBox 寬與價格區左右留白，ChartArea 用來把滑鼠位置換成第幾根
const KW = 1000, KL = 62, KR = 178, ZOOM_MIN = 10;
// 以 c（絕對位置，可帶小數）為中心縮放 f 倍（>1 縮小、<1 放大），游標下那根留在原處；最少 10 根、最多全段；每次至少動 1 根（觸控板一格很小）
function zoomAt(a, b, N, c, f) {
  const w0 = b - a, mn = Math.min(ZOOM_MIN, N);
  const w = Math.max(mn, Math.min(N, f > 1 ? Math.max(w0 + 1, Math.round(w0 * f)) : Math.min(w0 - 1, Math.round(w0 * f))));
  if (w === w0) return [a, b];
  const a1 = Math.max(0, Math.min(N - w, Math.round(c - ((c - a) * w) / w0)));
  return [a1, a1 + w];
}

function KChart({ d, full, smas, yr, a, b, onTip, gaps, islands, top, rolls, brush, srOn = true, kk = null, s4 = null }) {
  const ch = d.chart || {};
  const bars = full.bars.slice(a, b), n = bars.length;
  if (n < 2) return <div className="ta-nochart">沒有 K 線資料</div>;
  const market = volMkt(d);
  const intra = d.tf === "1H" || d.tf === "4H";
  const oi = (i) => (i == null ? null : i - a);   // 缺口、島、前五大量的 i 都是整段 history 的絕對位置
  const sr = g(d, "signals", "sr_levels") || {};
  const srl = !srOn ? [] : [...(sr.support || []).slice(0, 1).map((x) => [x, "sup"]), ...(sr.resistance || []).slice(0, 1).map((x) => [x, "res"])];
  const trd = d.trade || {};
  const tlines = (trd.lines || []).filter((ln) => (ln.i1 == null || ln.i1 >= a) && (ln.i0 == null || ln.i0 < b));
  const marks = (trd.markers || []).filter((m) => m.i != null && m.i >= a && m.i < b);
  const W = KW, L = KL, R = KR, T = 16, PH = 400, GP = 14, VH = 72, B = 24;
  const H = T + PH + GP + VH + B, pw = W - L - R, xr = L + pw;
  const vals = [];
  for (const x of bars) { if (x.h != null) vals.push(x.h); if (x.l != null) vals.push(x.l); }
  if (!vals.length) return <div className="ta-nochart">沒有 K 線資料</div>;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  // 撐壓、進出場的線離 K 棒太遠就不撐大座標：線裁掉、右側標籤貼邊加 ↑／↓
  const reach = (hi - lo) * 0.2;
  // 四步（11-24）：L2／H2 虛線＝②到出場（未出場畫到右緣）；②在區間右邊或出場在區間左邊的不畫
  const s4L = s4 ? ["s", "l"].flatMap((sd) => (s4[sd] || []).filter((q) => q.s2 && q.s2.i < b && (!q.ex || q.ex.i >= a)).map((q) => [sd, q])) : [];
  for (const y of [...srl.map(([x]) => x.price), ...tlines.map((ln) => ln.y), ...s4L.map(([, q]) => q.L2)]) {
    if (y != null && y >= lo - reach && y <= hi + reach) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
  }
  const pad = (hi - lo) * 0.05 || hi * 0.01 || 1;
  // 四步開著：空方那顆開→頂端多留空間、多方那顆開→底部多留（標籤只放 K 外側，貼頂／貼底的 K 才放得下）；關著時跟原本一樣
  lo -= pad * (s4 && s4.l ? 3 : 1); hi += pad * (s4 && s4.s ? 3 : 1);
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
  else els.push(<text key="vl" className="ax" x={L - 6} y={T + PH + GP + 10} textAnchor="end">{market === "idx" ? "指數量" : market === "tw" ? "量（張）" : market === "fut" ? "量（口）" : "量"}</text>);
  // 圖上文字／記號佔的位置（缺口代號、島狀反轉的字、前五大量編號、圖左上線名、進出場記號先放，進出場標籤再找不撞的位置）；tw＝字寬估計（中文 12、英數 6.8）
  const placed = [];
  const tw = (s) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 12 : 6.8), 0);
  // 重疊面積（四邊各多留 1px，字的描邊才不會貼在一起）
  const hitArea = (bx) => placed.reduce((z, r) => z + Math.max(0, Math.min(bx[2], r[2] + 1) - Math.max(bx[0], r[0] - 1)) * Math.max(0, Math.min(bx[3], r[3] + 1) - Math.max(bx[1], r[1] - 1)), 0);
  const busyAt = (bx) => placed.some((p) => bx[0] < p[2] && bx[2] > p[0] && bx[1] < p[3] && bx[3] > p[1]);
  // 圖左上線名（三條均線、出場線、停損）：先佔位，後面的島狀反轉、盤中未定、進出場標籤才會避開；字最後才畫（蓋在 K 棒上面）
  const yrOn = !!yr && yr.slice(a, b).some(Number.isFinite);   // 不足 240／52 根那段 NaN 不畫；整個區間都不足就連線名都不寫
  const yrW = d.tf === "W", yrName = yrW ? "52 週線" : "年線";
  const ckey = [...smas.map(([m], k) => ["SMA" + m, MA_COL[k], ""]), ...(yrOn ? [[yrName, YR_COL, ""]] : []),
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
  if (yrOn) poly(yr, yrW ? "sma52" : "sma240", YR_COL, 1.2, true);
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
    // 兩個標籤滑過都出這筆持倉的進場說明（含停損怎麼來的）
    const tip = { "data-tip": "entry", onMouseEnter: (e) => onTip && onTip("entry", op, e, false), onMouseLeave: () => onTip && onTip(null),
      onClick: (e) => { e.stopPropagation(); onTip && onTip("entry", op, e, true); }, "aria-hidden": "true" };
    for (const [kind, w, col] of [["open_entry", tag + "單進場 ", TR_ENT], ["open_stop", "停損 ", TR_STOP]]) {
      const v = ly(kind);
      if (v != null) lab.push({ y: Y(v), t: w + fpx(v), col, nt: "", tip });
    }
  }
  // 進出場：每筆一條 2.5px 實線，從進場三角中心連到 ✕ 中心，顏色＝這筆的進場色（多紅、空綠），底下墊深色描邊浮在 K 棒上。
  // 11-17 Yoda：淡色框跟缺口框同色易混、價差小時只剩一條，改成跟進場同色的線才對得回去。持倉中的不畫
  const byEntry = new Map(), byExit = new Map(), sideCol = (s) => (s === 1 ? K_UP : K_DN);
  for (const t of trd.trades || []) {
    byEntry.set(t.entry_i, t); byExit.set(t.exit_i, t);
    if (t.exit_i < a || t.entry_i >= b) continue;
    const eb = full.bars[t.entry_i], s = t.side;
    const y1 = eb ? (s === 1 ? Y(eb.l) + 12 : Y(eb.h) - 12) : Y(t.entry); // 進場三角中心（同下面記號的位置）
    const lk = { x1: X(t.entry_i - a), y1, x2: X(t.exit_i - a), y2: Y(t.exit_px), clipPath: clip, strokeLinecap: "round", "data-side": s };
    els.push(<line key={"trh" + t.entry_i} className="trlink-bg" {...lk} stroke="#0b0f15" strokeWidth="6" strokeOpacity=".85" />,
      <line key={"trk" + t.entry_i} className="trlink" {...lk} stroke={sideCol(s)} strokeWidth="2.5" />);
  }
  if (op) byEntry.set(op.entry_i, op);
  // 記號：▲多進（紅大三角，K 低點下）／▼空進（綠大三角，K 高點上）、✕出場（同進場色）；旁邊標「多進 價格」「多出（或多停損） 價格 報酬%」（空單同理），原因滑過看。
  // 可見根數 > 250 只留圖形。標籤依序試幾個靠近記號的位置（原位→記號左右→另一側→往外錯開），選第一個不撞任何字／記號的；
  // 都撞就選重疊最少的。標籤夾在價格區內（右緣不超過 xr，不會蓋到右側撐壓標籤）
  // ✕ 先畫、▲▼ 後畫（entMk 最後才放進 els），出場隔一兩根就碰到下一筆進場時 ✕ 不會蓋掉三角
  const showLab = n <= 250, tlab = [], want = [], entMk = [];
  const s4At = els.length;   // 四步 L2／H2 虛線與感應線插在這裡：壓在進出場記號、關鍵K、各種字下面，不搶它們的滑鼠說明
  marks.forEach((m) => {
    const li = m.i - a, bb = bars[li], x = X(li);
    const t = m.kind === "entry" ? byEntry.get(m.i) : byExit.get(m.i);
    if (!t) return;
    const hit = { "data-tip": m.kind, "data-i": m.i, onMouseEnter: (e) => onTip && onTip(m.kind, t, e, false), onMouseLeave: () => onTip && onTip(null),
      onClick: (e) => { e.stopPropagation(); onTip && onTip(m.kind, t, e, true); }, onFocus: (e) => onTip && onTip(m.kind, t, e, false),
      onBlur: () => onTip && onTip(null), tabIndex: 0, role: "button",
      "aria-label": (t.side === 1 ? "多單" : "空單") + (m.kind === "entry" ? "進場 " + t.entry_t : "出場 " + t.exit_t) };
    // 旁邊的字（多進 價格／原因 價格 報酬%）滑過也出同一個說明；不另給 tabIndex（鍵盤焦點留在記號上，免得一筆聚焦兩次）
    const lt = { "data-tip": m.kind, "data-i": m.i, onMouseEnter: hit.onMouseEnter, onMouseLeave: hit.onMouseLeave, onClick: hit.onClick, "aria-hidden": "true" };
    if (m.kind === "entry") {
      const s = t.side, y = s === 1 ? Y(bb.l) + 5 : Y(bb.h) - 5, col = s === 1 ? K_UP : K_DN;
      entMk.push(<g key={"me" + m.i} className="mk-hit" {...hit}>
        <circle cx={x} cy={y + s * 7} r="12" fill="transparent" />
        <path className="mk-entry" d={`M${x.toFixed(1)} ${y.toFixed(1)} l-7 ${s * 12} h14 z`} fill={col} stroke="#0b0f15" strokeWidth="1" />
      </g>);
      placed.push([x - 7, Math.min(y, y + s * 12), x + 7, Math.max(y, y + s * 12)]);
      const y0 = s === 1 ? y + 26 : y - 16, ym = y + s * 6 + 4;
      want.push([(s === 1 ? "多進 " : "空進 ") + fpx(t.entry), col, "te", [[x, y0, "middle"], [x + 10, ym, "start"], [x - 10, ym, "end"],
        [x, y0 + s * 13, "middle"], [x + 10, ym + s * 13, "start"], [x - 10, ym + s * 13, "end"], [x, y0 + s * 26, "middle"], [x, y0 + s * 39, "middle"]], lt, t, x, y + s * 7]);
    } else {
      const col = sideCol(t.side), y = Y(m.px); // ✕ 和字都用這筆的進場色，一眼對回它的多進／空進
      // ✕ 縮回 10px、描邊 2.4（墊底 4.5）：加大版會蓋到隔壁 K 的 ▲
      els.push(<g key={"mx" + m.i} className="mk-hit" {...hit}>
        <circle cx={x} cy={y} r="11" fill="transparent" />
        <path className="mk-exit-bg" d={`M${(x - 5).toFixed(1)} ${(y - 5).toFixed(1)}l10 10m0 -10l-10 10`} stroke="#0b0f15" strokeWidth="4.5" strokeLinecap="round" />
        <path className="mk-exit" d={`M${(x - 5).toFixed(1)} ${(y - 5).toFixed(1)}l10 10m0 -10l-10 10`} stroke={col} strokeWidth="2.4" strokeLinecap="round" />
      </g>);
      placed.push([x - 6, y - 6, x + 6, y + 6]);
      const dy = t.side === 1 ? 13 : -13, yb = y + (t.side === 1 ? 16 : -9), yo = y + (t.side === 1 ? -9 : 16);
      const sd = t.side === 1 ? "多" : "空", stop = m.tone === "stop";
      want.push([sd + (stop ? "停損 " : "出 ") + fpx(t.exit_px) + " " + fpc(t.pct), col, "tx", [[x + 9, yb, "start"], [x - 9, yb, "end"],
        [x + 10, y + 4, "start"], [x - 10, y + 4, "end"], [x + 9, yo, "start"], [x - 9, yo, "end"],
        [x + 9, yb + dy, "start"], [x - 9, yb + dy, "end"], [x + 9, yb + 2 * dy, "start"], [x - 9, yb + 2 * dy, "end"], [x + 9, yb + 3 * dy, "start"]], lt, t, x, y,
        sd + (stop ? "停損 " : " ") + fpx(t.entry) + "→" + fpx(t.exit_px) + " " + fpc(t.pct)]);   // 跟進場字合併時用
    }
  });
  els.push(...entMk);
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
  // 關鍵K：大量 K 白框＋名次（框下方）、突破那根「破①↑」（紅，K 上方）／跌破「破①↓」（綠，K 下方）；滑過看日期價位量倍數；超過 250 根只留框和小點
  const kkEls = [];
  if (kk) {
    const dt = (i) => md(full.bars[i].t).replace("-", "/"), mul = (j) => { const m = volMult(kk.V, j); return m ? "（量 " + m.toFixed(1) + " 倍）" : ""; };
    const rk = new Map();
    for (const e of [...kk.ev, ...kk.cur]) { if (!rk.has(e.j)) rk.set(e.j, new Set()); rk.get(e.j).add(e.rank); }
    for (const [j, rs] of rk) {
      if (j < a || j >= b) continue;
      const x = X(j - a), y0 = Y(kk.H[j]) - 3, y1 = Y(kk.L[j]) + 3, lab = [...rs].sort().map(mark).join("");
      kkEls.push(<rect key={"kb" + j} className="kk-box" x={x - step / 2 - 1} y={y0} width={step + 2} height={Math.max(2, y1 - y0)} fill="none" stroke="#ffffff"
        strokeWidth="1.2" strokeOpacity=".85" clipPath={clip} data-j={j}><title>{dt(j) + " 大量 K 最高 " + fpx(kk.H[j]) + " 最低 " + fpx(kk.L[j]) + mul(j)}</title></rect>);
      if (!showLab) continue;
      let ly = y1 + 13;
      for (let k = 0; k < 4 && busyAt([x - 8, ly - 11, x + 8, ly + 2]); k++) ly += 13;
      placed.push([x - 8, ly - 11, x + 8, ly + 2]);
      kkEls.push(<text key={"kn" + j} className="kk-n" x={x} y={ly} textAnchor="middle">{lab}</text>);
    }
    for (const e of kk.ev) {
      if (e.k < a || e.k >= b) continue;
      const bk = full.bars[e.k], x = X(e.k - a), up = e.dir === 1, s = "破" + mark(e.rank) + (up ? "↑" : "↓");
      const tip = <title>{(up ? "突破 " : "跌破 ") + dt(e.j) + " 大量 K " + (up ? "最高 " + fpx(kk.H[e.j]) : "最低 " + fpx(kk.L[e.j])) + mul(e.j)}</title>;
      if (!showLab) { kkEls.push(<circle key={"kd" + e.k + "_" + e.dir + "_" + e.j} className={"kk-b " + (up ? "up" : "dn")} cx={x} cy={up ? Y(bk.h) - 5 : Y(bk.l) + 5} r="2.5" fill={up ? K_UP : K_DN}>{tip}</circle>); continue; }
      // 位置：K 外側往外疊 5 層 × 原位／右／左，第一個不撞的；都撞就選重疊最少的（夾在價格區內，貼底貼頂時才不會兩個疊在一起）
      const w = tw(s), y0 = up ? Y(bk.h) - 6 : Y(bk.l) + 15, cands = [];
      for (let k = 0; k < 5; k++) for (const dx of [0, w * 0.6, -w * 0.6]) cands.push([Math.min(xr - w / 2, Math.max(L + w / 2, x + dx)), Math.min(T + PH - 2, Math.max(T + 12, y0 + (up ? -13 : 13) * k))]);
      const bx = ([cx, cy]) => [cx - w / 2, cy - 11, cx + w / 2, cy + 2];
      const [lx, ly] = cands.find((c) => !busyAt(bx(c))) || cands.reduce((u, c) => (hitArea(bx(c)) < hitArea(bx(u)) ? c : u), cands[0]);
      placed.push(bx([lx, ly]));
      kkEls.push(<text key={"kt" + e.k + "_" + e.dir + "_" + e.j} className={"kk-b " + (up ? "up" : "dn")} x={lx} y={ly} textAnchor="middle" data-k={e.k} data-dir={e.dir}>{s}{tip}</text>);
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
      for (const v of [bj.h, bj.l, bj.c, ch.exit_line ? ch.exit_line[a + j] : null, yr ? yr[a + j] : null, ...smas.map(([, arr]) => (arr ? arr[a + j] : null))]) {
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
  // 同一筆的出場字若貼到（8px 內）它的進場字、或進出只隔 ≤2 根：拿掉進場字（▲ 留著），出場處改寫一個「多 進價→出價 報酬%」（停損：「多停損 …」）
  const near = (p, q, g) => p[0] < q[2] + g && p[2] > q[0] - g && p[1] < q[3] + g && p[3] > q[1] - g;
  const ents = new Map(), labs = [];
  if (showLab) want.forEach(([s0, col, cls0, cands, lt, t, mx, my, ms]) => {
    const fit = (s) => {
      const w = tw(s);
      let best = null;
      for (const [x, y, anchor] of cands) {
        const x0 = Math.min(xr - 2 - w, Math.max(L + 2, anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x));
        const yy = Math.min(T + PH - 2, Math.max(T + 12, y)), bx = [x0, yy - 12, x0 + w, yy + 4], o = hitArea(bx);
        if (!best || o < best[2]) best = [x0, yy, o, bx];
        if (o === 0) break;
      }
      return best;
    };
    let s = s0, cls = cls0, best = fit(s);
    const e = cls0 === "tx" ? ents.get(t.entry_i) : null;
    if (e && !e.gone && (t.exit_i - t.entry_i <= 2 || near(best[3], e.bx, 8))) {
      e.gone = true; placed[e.pi] = [-1e9, -1e9, -1e9, -1e9]; tlab[e.ti] = null;
      s = ms; cls = "tx tm"; best = fit(s);
    }
    const r = { bx: best[3], pi: placed.length, ti: tlab.length, mx, my, col };
    if (cls0 === "te") ents.set(t.entry_i, r);
    labs.push(r);
    placed.push(best[3]);
    tlab.push(<text key={"tlb" + tlab.length} className={cls + " mk-lab"} {...lt} x={best[0]} y={best[1]} textAnchor="start" style={{ fill: col }} data-ov={best[2] ? Math.round(best[2]) : undefined}>{s}</text>);
  });
  // 四步（11-24，不是交易訊號）：空方標 K 上方、多方標 K 下方，只寫「空1～空4、空利／多1～多4、多利」；①② 中性色、空3 綠／多3 紅、4 灰、利＝淡色空心框。
  // 標籤最後放（避開進出場記號與字、關鍵K、線名）：一律放 K 外側，外側往外疊、往左右錯開找空位；字離 K 太遠拉引線。
  // 可見區間外的步驟不畫字；超過 250 根只畫小點（滑過照樣有說明）
  const s4Els = [], s4Late = [];
  if (s4) {
    const tipOf = (info) => ({ "data-tip": "s4", onMouseEnter: (e) => onTip && onTip("s4", info, e, false), onMouseLeave: () => onTip && onTip(null),
      onClick: (e) => { e.stopPropagation(); onTip && onTip("s4", info, e, true); } });
    const s4Lines = [];
    for (const [sd, q] of s4L) {
      const S = S4C[sd], ex = q.s4 || q.sx, x0 = XL(q.s2.i - a), x1 = ex ? X(ex.i - a) : xr, y = Y(q.L2), h = tipOf(l2Info4(sd, q, full.bars));
      s4Lines.push(<line key={"s4l" + sd + q.s1.i} className="s4l" x1={x0} x2={x1} y1={y} y2={y} stroke={S.line} strokeWidth="1.3" strokeDasharray="5 4" strokeOpacity=".85"
        clipPath={clip} data-l2={q.L2} data-side={sd} />,
        <line key={"s4h" + sd + q.s1.i} className="s4hit" x1={x0} x2={x1} y1={y} y2={y} stroke="transparent" strokeWidth="9" clipPath={clip} {...h} />);
      if (!ex) lab.push({ y, t: S.r2 + " " + fpx(q.L2), col: S.line, nt: "", tip: h });
    }
    els.splice(s4At, 0, ...s4Lines);
    const evs = [];
    for (const sd of ["s", "l"]) for (const q of s4[sd] || []) for (const k of [1, 2, 3, 4, "x"]) { const e = q["s" + k]; if (e && e.i >= a && e.i < b) evs.push([sd, q, k, e.i]); }
    evs.sort((u, v) => u[3] - v[3] || (u[2] === "x" ? 4 : u[2]) - (v[2] === "x" ? 4 : v[2]));
    const cl = (y) => Math.min(T + PH - 2, Math.max(T + 12, y));
    for (const [sd, q, k, i] of evs) {
      const S = S4C[sd], bk = full.bars[i], x = X(i - a), up = sd === "s", col = S.col[k], str = step4Name(sd, k), h = tipOf(info4(sd, q, k, full.bars));
      const aria = { tabIndex: 0, role: "button", "aria-label": S.nm + str + " " + bk.t, onFocus: h.onMouseEnter, onBlur: h.onMouseLeave, "data-side": sd, "data-step": k, "data-i": i };
      if (!showLab) { s4Els.push(<circle key={"s4d" + sd + q.s1.i + k} className="s4t" cx={x} cy={up ? Y(bk.h) - 5 : Y(bk.l) + 5} r="2.5" fill={col} {...h} {...aria} />); continue; }
      // 只放 K 外側（空方上、多方下，不翻到另一側）：往外、往左右錯開的位置照離 K 的距離由近到遠試，第一個不撞的；都撞就選外側重疊最少的；離 K 遠拉引線。
      // 夾在圖頂／圖底時幾層會落在同一高度，靠左右錯開找位置；四步開著時座標頂／底多留邊，夾住的字仍在 K 外側
      const w = tw(str) * 1.05 + (k === "x" ? 8 : 2), dir = up ? -1 : 1, yo = up ? Y(bk.h) - 6 : Y(bk.l) + 15, cands = [];
      const cx = (dx) => Math.min(xr - w / 2, Math.max(L + w / 2, x + dx * w));
      for (let r = 0; r < 17; r++) for (const dx of [0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1, 2.8, -2.8, 3.5, -3.5, 4.2, -4.2, 5, -5]) cands.push([cx(dx), cl(yo + dir * 11 * r), r * 11 + Math.abs(dx * w) * 1.5]);
      cands.sort((u, v) => u[2] - v[2]);   // 離 K 近的先試；往旁邊錯開比往外疊更容易讓人對錯 K，算重一點（往旁 1px＝往外 1.5px）
      // 找位置用「實際字框（12.5px 字高 18，含利的框）四周再留 3px」：別的字的佔位框比它的字框小一點，留邊才不會擦到；佔位只記實際字框
      const bx = ([u, v]) => [u - w / 2 - 3, v - 17, u + w / 2 + 3, v + 8];
      const free = cands.find((c) => !busyAt(bx(c))), [lx, ly] = free || cands.reduce((u, c) => (hitArea(bx(c)) < hitArea(bx(u)) ? c : u), cands[0]);
      placed.push([lx - w / 2, ly - 14, lx + w / 2, ly + 4]);
      const ay = up ? Y(bk.h) - 2 : Y(bk.l) + 2, py = up ? ly + 2 : ly - 11;
      if (Math.abs(py - ay) > 16 || Math.abs(lx - x) > 10) s4Late.unshift(<line key={"s4ld" + sd + q.s1.i + k} className="s4lead" x1={lx} y1={py} x2={x} y2={ay} stroke={col} strokeWidth="1" strokeOpacity=".7" />);
      if (k === "x") s4Els.push(<rect key={"s4b" + sd + q.s1.i} className="s4box" x={lx - w / 2} y={ly - 12} width={w} height={16} rx="3" stroke={S.col[3]} />);
      s4Els.push(<text key={"s4t" + sd + q.s1.i + k} className="s4t" x={lx} y={ly} textAnchor="middle" style={{ fill: col }} data-t={bk.t} data-ov={free ? undefined : 1} {...h} {...aria}>{str}</text>);
    }
  }
  // 字被擠到離記號 >20px：畫 1px 同色細引線，從字框最近的點連到記號（停在記號外 8px，不蓋到記號）
  const leads = [];
  for (const { bx, mx, my, col, gone } of labs) {
    if (gone) continue;
    const px = Math.min(bx[2], Math.max(bx[0], mx)), py = Math.min(bx[3], Math.max(bx[1], my)), dd = Math.hypot(mx - px, my - py);
    if (dd <= 20) continue;
    const f = (dd - 8) / dd;
    leads.push(<line key={"ld" + leads.length} className="mk-lead" x1={px} y1={py} x2={px + (mx - px) * f} y2={py + (my - py) * f} stroke={col} strokeWidth="1" />);
  }
  els.push(...kkEls, ...rkEls, ...islEls, ...unfEls, ...leads, ...tlab, ...s4Late, ...s4Els);  // 右側標籤避讓（由上到下排、不重疊、不超出價格區）；圖外的價位貼邊、加 ↑／↓
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
    els.push(<text key={"lt" + k} className={"srl" + (z.tip ? " mk-lab" : "")} {...z.tip} x={xr + 10} y={ty + 4} style={{ fill: z.col }}>{z.t}</text>);
    if (z.nt) els.push(<text key={"ln" + k} className="srn" x={xr + 10} y={ty + 17}>{z.nt}</text>);
  });
  const lc = bars[n - 1].c;
  if (lc != null && b === full.bars.length) els.push(<circle key="lc" className="lastc" cx={X(n - 1)} cy={Y(lc)} r="3" fill="#ffffff" />);
  // 框選中：半透明框＋「起～迄，共 N 根」；不到 10 根（放開不會放大）框改灰
  if (brush) {
    const u0 = Math.max(0, brush[0] - a), u1 = Math.min(n - 1, brush[1] - a), cnt = u1 - u0 + 1, ok = cnt >= ZOOM_MIN;
    const bx0 = X(u0) - step / 2, bx1 = X(u1) + step / 2;
    const s = String(bars[u0].t || "").slice(0, 16) + "～" + String(bars[u1].t || "").slice(0, 16) + "，共 " + cnt + " 根";
    const cx = Math.min(xr - tw(s) / 2 - 4, Math.max(L + tw(s) / 2 + 4, (bx0 + bx1) / 2));
    els.push(<rect key="brush" className="brush" x={bx0} y={T} width={Math.max(1, bx1 - bx0)} height={VB - T} fill={ok ? "#3d8bfd" : "#8b95a3"} fillOpacity=".16"
      stroke={ok ? "#9ad0ff" : "#8b95a3"} strokeWidth="1" data-n={cnt} />);
    els.push(<text key="brusht" className="brush-t" x={cx} y={T + 30} textAnchor="middle" style={{ fill: ok ? "#ffffff" : "#9aa4b2" }}>{s}</text>);
  }
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
  const N = bars.length, MIN = Math.min(ZOOM_MIN, N);   // 跟框選／滾輪同一個下限
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
function ChartArea({ d, maSet, srOn, kkOn = true, s4On = false, l4On = false }) {
  const ch = d.chart || {};
  const full = useMemo(() => fullSeries(d), [d.history, ch.bars, d.bars_completed]);   // eslint-disable-line react-hooks/exhaustive-deps
  const N = full.bars.length;
  const smas = useMemo(() => (g(ch, "ma_sets", maSet) || []).map((m) => [m, smaSeq(full.c, Number(m))]), [full, ch.ma_sets, maSet]);   // eslint-disable-line react-hooks/exhaustive-deps
  const yr = useMemo(() => (d.tf === "D" ? smaSeq(full.c, 240) : d.tf === "W" ? smaSeq(full.c, 52) : null), [full, d.tf]);   // 日K 年線＝240 日線、週K 52 週線；1H/4H 不畫
  const def0 = Math.max(0, Math.min(full.k0, N - 2));
  const [rng, setRng] = useState(() => [def0, N]);   // 預設＝引擎的圖視窗（近 120 根）
  const b = Math.min(rng[1], N), a = Math.max(0, Math.min(rng[0], b - 2));
  // 框選放大＋滾輪縮放＋雙擊／重設（只桌機：pointer: fine；框選另外只認滑鼠）。位移不到 5px 當點擊，標記的 hover／點擊照舊
  const [fine, setFine] = useState(false);
  useEffect(() => { try { setFine(window.matchMedia("(pointer: fine)").matches); } catch (er) {} }, []);
  const [brush, setBrush] = useState(null);
  const kref = useRef(null), drg = useRef(null), ate = useRef(false), live = useRef(null);
  live.current = { a, b, N };
  const kAt = (e) => {   // 滑鼠 → 第幾根（絕對位置、帶小數）；viewBox 是 meet 縮放，用 getScreenCTM 換算
    const svg = kref.current && kref.current.querySelector("svg.ta-k"), m = svg && svg.getScreenCTM && svg.getScreenCTM();
    if (!m || !m.a) return null;
    const { a: a0, b: b0 } = live.current, w = b0 - a0;
    return a0 + Math.max(0, Math.min(w - 1e-6, (((e.clientX - m.e) / m.a - KL) * w) / (KW - KL - KR)));
  };
  const span = (s, c) => [Math.floor(Math.min(s.c, c)), Math.floor(Math.max(s.c, c))];
  const kDown = (e) => {
    ate.current = false;
    if (!fine || e.pointerType !== "mouse" || e.button !== 0) return;
    const c = kAt(e);
    if (c != null) drg.current = { x: e.clientX, c, on: false, el: e.currentTarget, id: e.pointerId };
  };
  const kMove = (e) => {
    if (drg.current && !(e.buttons & 1)) { drg.current = null; setBrush(null); return; }   // 在圖外放開、圖沒收到 pointerup
    const s = drg.current, c = s && kAt(e);
    if (c == null) return;
    if (!s.on) {
      if (Math.abs(e.clientX - s.x) < 5) return;
      s.on = true;
      try { s.el.setPointerCapture(s.id); } catch (er) {}
    }
    setBrush(span(s, c));
  };
  const kUp = (e) => {
    const s = drg.current;
    drg.current = null;
    setBrush(null);
    if (!s || !s.on) return;
    ate.current = true;   // 放開後的 click 不要再觸發標記
    const c = kAt(e), r = c == null ? null : span(s, c);
    if (r && r[1] - r[0] + 1 >= ZOOM_MIN) setRng([r[0], r[1] + 1]);
  };
  useEffect(() => {
    if (!brush) return undefined;
    const esc = (e) => {
      if (e.key !== "Escape" || !drg.current) return;
      try { drg.current.el.releasePointerCapture(drg.current.id); } catch (er) {}
      drg.current = null; setBrush(null);
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [brush]);
  useEffect(() => {   // React 的 onWheel 是 passive、擋不住頁面捲動，改掛原生
    const el = kref.current;
    if (!fine || !el) return undefined;
    const wh = (e) => {
      const c = kAt(e);
      if (c == null || !e.deltaY) return;
      const { a: a0, b: b0, N: n0 } = live.current, r = zoomAt(a0, b0, n0, c, Math.min(2, Math.max(0.5, Math.exp(e.deltaY * (e.deltaMode ? 0.05 : 0.0015)))));
      if (r[0] === a0 && r[1] === b0) return;   // 已全段再縮小／已 10 根再放大：不攔，頁面照常捲（zoomAt 每次至少動 1 根，只有到頭才會不變）
      e.preventDefault();
      setRng(r);
    };
    el.addEventListener("wheel", wh, { passive: false });
    return () => el.removeEventListener("wheel", wh);
  }, [fine]);   // eslint-disable-line react-hooks/exhaustive-deps
  const reset = () => setRng([def0, N]);
  const nf = d.bars_completed != null ? Math.min(d.bars_completed, N) : N;
  const gapsAll = useMemo(() => decodeGaps(g(ch, "overlays", "gaps"), full.bars), [ch.overlays, full]);   // eslint-disable-line react-hooks/exhaustive-deps
  const islAll = g(ch, "overlays", "islands") || [];
  const rollsAll = Array.isArray(g(ch, "overlays", "rolls")) ? ch.overlays.rolls : [];   // 舊回應沒有 rolls
  const top = useMemo(() => topVolume(full, a, b, nf, g(d, "signals", "top_volume", "items")), [full, a, b, nf, d.signals]);   // eslint-disable-line react-hooks/exhaustive-deps
  const kk = useMemo(() => (kkOn && !noVolume(d) ? keyKAll(full, nf) : null), [kkOn, full, nf]);   // eslint-disable-line react-hooks/exhaustive-deps
  // 四步（11-24）：只用已收完的 K、整段 history 算（不跟可見區間走）；不進回測、面板、共振閃爍
  const s4 = useMemo(() => {
    if (!s4On && !l4On) return null;
    const fb = full.bars.slice(0, nf);
    return { s: s4On ? fourStep(fb, "s") : null, l: l4On ? fourStep(fb, "l") : null };
  }, [s4On, l4On, full, nf]);
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
  const info = !tip ? null : tip.kind === "s4" ? tip.t : trd.ctx && trd.p ? (tip.kind === "entry" ? explainEntry(trd, trd.p, tip.t) : explainExit(trd, trd.p, tip.t)) : null;
  return (
    <>
      <div ref={kref} className={"ta-kwrap" + (fine ? " fine" : "")} onPointerDown={kDown} onPointerMove={kMove} onPointerUp={kUp} onPointerCancel={kUp}
        onClickCapture={(e) => { if (ate.current) { ate.current = false; e.stopPropagation(); } }} onDoubleClick={fine ? reset : undefined}>
        <KChart d={d} full={full} smas={smas} yr={yr} a={a} b={b} onTip={onTip} gaps={gapsAll} islands={islAll} top={top} rolls={rollsAll} brush={brush} srOn={srOn} kk={kk} s4={s4} />
        {fine && (a !== def0 || b !== N) ? <button type="button" className="ta-kreset" onPointerDown={(e) => e.stopPropagation()} onClick={reset}>重設</button> : null}
      </div>
      {N > NAV_MIN ? <RangeNav bars={full.bars} a={a} b={b} onChange={setRng} /> : null}
      <BlockTabs d={d} view={view} />
      {info ? (
        <div ref={box} className={"ta-tipbox " + (tip.kind === "s4" ? "s4t-" + info.cls : tip.t.side === 1 ? "long" : "short")} role="tooltip" style={{ left: 0, top: 0, visibility: "hidden" }}>
          <div className="tt">{info.title}{tip.kind === "entry" && trd.open && trd.open.entry_i === tip.t.entry_i ? <span className="hold">持倉中</span>
            : tip.kind === "s4" && info.status ? <span className="hold">{info.status}</span> : null}</div>
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
  exit: <><b style={{ color: K_UP }}>✕</b><b style={{ color: K_DN }}>✕</b></>,
  open: <i className="sw" style={{ color: TR_ENT }} />,
  link: <><i className="sw" style={{ color: K_UP }} /><i className="sw" style={{ color: K_DN }} /></>,
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
        {d.tf === "D" ? <div className="ta-rule"><dt><span className="lg"><i className="sw" style={{ color: YR_COL }} /></span>年線</dt><dd>SMA240（240 日均線），日K 常駐；不屬於均線組、不進交易規則；不足 240 根那段不畫</dd></div>
          : d.tf === "W" ? <div className="ta-rule"><dt><span className="lg"><i className="sw" style={{ color: YR_COL }} /></span>52 週線</dt><dd>SMA52（52 週均線），週K 常駐；不屬於均線組、不進交易規則；不足 52 根那段不畫</dd></div> : null}
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
  const market = volMkt(d);
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
    { key: "exit", label: "✕ 出場", desc: "整筆出場，✕ 和旁邊的字跟它那筆進場同色（多單紅、空單綠），寫「多出／空出 出場價 這筆報酬%」，停損出場寫「多停損／空停損」；進出只隔一兩根（兩串字會黏在一起）時併成一串寫在 ✕ 旁：「多 進場價→出場價 報酬%」（停損「多停損 進場價→出場價 報酬%」），三角旁不再寫字；字被擠遠時有一條細線連回記號；原因（破N線／爆量反K／到期）滑過記號或字看；畫面超過 250 根時只留記號、不寫字" },
    { key: "link", label: "進→出", desc: "每筆一條實線從進場三角連到它的 ✕，顏色跟進場同色（多單紅、空單綠）；賺賠看 ✕ 旁的報酬%；還沒出場的持倉不畫" },
    { key: "keyk", label: "關鍵K", desc: "白框＝大量 K（該根之前 " + KEYK_N + " 根量最大 " + KEYK_TOP + " 根），框下是名次；收盤第一次站上它的最高標「破①↑」（紅）、第一次跌破最低標「破①↓」（綠），各只標一次；滑過看日期、價位、量倍數" },
    { key: "island", label: "島狀反轉", desc: "金色虛線框＝懸空的那幾根 K，框上方標頂部島狀反轉、框下方標底部島狀反轉" },
    { key: "open", label: "持倉中", desc: "還沒出場的線延伸到右緣，右側標進場價與停損價" },
    { key: "tip", label: "滑過記號", desc: "滑鼠停在三角、✕ 或旁邊的字上（含右側持倉中的進場／停損標籤；手機點一下）會列出這筆進出場每個條件的實際數值；停損出場另列停損怎麼來的" },
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
// 撐壓線開關（11-23）：關掉＝圖上兩條線、右側價位標籤都不畫，也不再撐大價格座標；預設開
const SR_KEY = "yoda_ta_sr";
function readSr() { return lsGet(SR_KEY) !== "0"; }
// 關鍵K 開關（11-23）：同撐壓線，只有 "0" 算關
const KK_KEY = "yoda_ta_kk";
function readKk() { return lsGet(KK_KEY) !== "0"; }
// 空方四步／多方四步開關（11-24）：預設關，只有 "1" 算開（讀不到＝關）
const S4_KEY = "yoda_ta_s4", L4_KEY = "yoda_ta_l4";
function readS4() { return lsGet(S4_KEY) === "1"; }
function readL4() { return lsGet(L4_KEY) === "1"; }
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
  const Rad = (k, x, text, dis) => (
    <label key={String(x)} className={dis ? "off" : undefined}><input type="radio" name={"tr-" + k} checked={draft[k] === x} onChange={() => put(k, x)} disabled={!!dis} data-k={k + "-" + x} />{text}</label>
  );
  const KK = draft.entry === "keyk";   // 關鍵 K 進場：排列剛成立、進場量比、收在均線同側不看（均線照樣給出場用）
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
        <RuleOpt errors={errors} warn={noVol ? NOVOL_TXT + "：突破／跌破關鍵 K 不可用" : ""}>{Rad("entry", "ma", "均線排列")}{Rad("entry", "keyk", "突破／跌破關鍵 K", noVol)}</RuleOpt>
        <RuleOpt errors={errors} hint="EMA 對最近的價格反應快；SMA 每一根一樣重">均線 {Rad("ma", "ema", "EMA")}{Rad("ma", "sma", "SMA")}</RuleOpt>
        <RuleOpt errors={errors} k="ma_n" hint="由短到長三條；排列＝三條照順序排好（多：短＞中＞長）">
          週期
          {[0, 1, 2].map((j) => (
            <input key={j} type="text" inputMode="numeric" className={"ta-n" + (errors.ma_n ? " bad" : "")} value={v(draft.ma_n[j])} aria-label={"第 " + (j + 1) + " 條均線週期"}
              aria-invalid={!!errors.ma_n} data-k={"ma_n" + j} onChange={(e) => { const a = draft.ma_n.slice(); a[j] = e.target.value; put("ma_n", a); }} />
          ))}
        </RuleOpt>
        <RuleOpt errors={errors} k="fresh_n" hint="本根排好、前 N 根還沒全排好，才算「剛成立」">排列剛成立：回看 {N("fresh_n", "排列剛成立回看根數", null, KK)} 根</RuleOpt>
        <RuleOpt errors={errors} k={["vol_in", "vol_n"]} hint="量比＝本根量 ÷ 前 N 根平均量；不勾＝不看量" warn={NV}>
          {Chk("vol_on", "量比 ≥", noVol || KK)}{N("vol_in", "進場量比門檻", null, noVol || KK)}，比前 {N("vol_n", "量比比較根數", null, noVol)} 根
        </RuleOpt>
        <RuleOpt errors={errors} hint={"多單收盤要在 " + man(0) + " 上方、空單在下方"}>{Chk("side_ma", "收在第一條均線同側（" + man(0) + "）", KK)}</RuleOpt>
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

// ───────── 指數位階分頁（2026-11-11）：最新美股報告「02 指數位階」整章原樣（/api/ta-idx）─────────
// 章內腳本靠 document.currentScript／inline onclick，只能跑在自己的文件裡 → iframe srcdoc（同源：父頁直接量高度、換深淺）
const VIEW_KEY = "yoda_ta_view";
function readView() { const v = lsGet(VIEW_KEY); return v === "idx" || v === "rs" || v === "tt" || v === "opt" ? v : "chart"; }
const isLight = () => document.documentElement.getAttribute("data-theme") === "light";
function IdxView({ x }) {
  const ifr = useRef(null);
  const doc = useMemo(() => x.html.replace("<body>", isLight() ? '<body class="light">' : "<body>"), [x]);
  useEffect(() => {   // 站內深淺切換：報告用 body.light，直接改 iframe 裡的 class，不重載（TAB 選到哪不跑掉）
    const mo = new MutationObserver(() => { const b = g(ifr.current, "contentDocument", "body"); if (b) b.classList.toggle("light", isLight()); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  const onLoad = () => {   // 高度跟內容走（切 TAB 會變高變矮），iframe 自己不出捲軸
    const f = ifr.current, w = f && f.contentWindow;
    if (!w || !w.document.body) return;
    const b = w.document.body;
    b.classList.toggle("light", isLight());
    const fit = () => { f.style.height = Math.ceil(b.scrollHeight) + "px"; };
    new w.ResizeObserver(fit).observe(b);
    fit();
  };
  return (
    <div className="ta-idx">
      <div className="ta-notes">內容同美股報告 {x.date} 第 02 章</div>
      <iframe ref={ifr} className="ta-idxf" title="指數位階" srcDoc={doc} onLoad={onLoad} />
    </div>
  );
}

// ───────── 區間強弱分頁（2026-11-13 本機 demo）：任選起迄日，台股／美股族群、個股相對大盤（/api/ta-rs，lib/ta-rs.js 現算）─────────
const pc1 = (x) => (x === null || x === undefined || !Number.isFinite(Number(x)) ? "—" : (x > 0 ? "+" : "") + Number(x).toFixed(1) + "%");
const yi = (m) => (Number.isFinite(Number(m)) ? (m / 100).toFixed(2) : "—");   // 百萬 → 億
const mdd = (s) => String(s || "").slice(5).replace("-", "/");
const RS_PRE = [["1w", "近 1 週"], ["1m", "近 1 月"], ["3m", "近 3 月"], ["ytd", "今年以來"]];
const RS_MKT_KEY = "yoda_ta_rs_mkt";
const RS_MKTS = [["tw", "台股"], ["us", "美股"]];
function readRsMkt() { return lsGet(RS_MKT_KEY) === "us" ? "us" : "tw"; }
// 每個市場的字：門檻單位（輸入值 × mul ＝ API 要的元／美元）、大盤、註腳
const RS_M = {
  tw: { wan: "5000", unit: "萬", mul: 1e4, bench: ["加權報酬指數", "加權指數（價格，參考）"], uni: "上市＋上櫃普通股", mktCol: "市場", amtCol: "日均成交值（億）", amt: (m) => yi(m),
    note: "相對大盤＝區間報酬 − 加權報酬指數同期報酬；股價已還原除權息與減資；族群＝台股報告現行 v6 分類回頭套用，生技、資訊服務這類近期才成群的族群，在過去區間的強弱帶有事後歸類的成分；成分股等權平均。" },
  us: { wan: "0", unit: "百萬美元", mul: 1e6, bench: ["SPY 含息", "SPY 不含息（參考）"], uni: "標普 500 成分股", mktCol: "交易所", amtCol: "日均成交值（百萬美元）", amt: (m) => (Number.isFinite(Number(m)) ? Math.round(m).toLocaleString("en-US") : "—"),
    note: "相對大盤＝區間報酬 − SPY 含息同期報酬；股價已還原拆股與股利；族群＝美股報告熱力圖 13 族群，成分股等權平均；成分只含現在的標普 500，期間內被剔除的公司不在其中。" },
};
function rsCols(onCode, rank, M = RS_M.tw) {
  const c = [
    { label: "代號", render: (x) => <button type="button" className="ta-link mono" title="看 K 線" onClick={(e) => { e.stopPropagation(); onCode(x.code); }}>{x.code}</button>, sort: (x) => x.code },
    { label: "名稱", render: (x) => x.name || "—", sort: (x) => x.name },
    { label: M.mktCol, render: (x) => x.mkt || "—", sort: (x) => x.mkt },
    { label: "區間報酬", num: 1, render: (x) => <span className={ud(x.ret)}>{pc1(x.ret)}</span>, sort: (x) => x.ret },
    { label: "相對大盤", num: 1, render: (x) => <span className={ud(x.rel)}>{pc1(x.rel)}</span>, sort: (x) => x.rel },
    { label: M.amtCol, num: 1, render: (x) => M.amt(x.avgAmt), sort: (x) => x.avgAmt },
  ];
  if (!rank) return c;
  return [{ label: "名次", num: 1, render: (x) => x.rk, sort: (x) => x.rk }, ...c.slice(0, 3),
    { label: "族群", cls: "wrap", render: (x) => (x.groups || []).join("、") || "—", sort: (x) => (x.groups || []).join("、") }, ...c.slice(3)];
}
function RsView({ rs, run, onCode, mk = "tw" }) {
  const M = RS_M[mk] || RS_M.tw;
  const d = rs.data, rg = (d && d.range) || rs.range || {};
  const [f, setF] = useState(() => ({ start: d ? d.start : "", end: d ? d.end : "", wan: M.wan, n: "20" }));
  const [open, setOpen] = useState(null);   // 展開成分股的族群
  const num = (v) => (v === "" ? undefined : Number(v));   // 打錯的數字送 NaN（JSON 變 null）→ 伺服器回錯誤訊息
  const go = (o) => { const g = { ...f, ...o }; setF(g); run({ start: g.start, end: g.end, minAmt: g.wan === "" ? undefined : num(g.wan) * M.mul, n: num(g.n) }); };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const gcols = useMemo(() => [
    { label: "族群", render: (x) => <>{open === x.name ? "▾ " : "▸ "}{x.name}</>, sort: (x) => x.name },
    { label: "相對大盤", num: 1, render: (x) => <span className={ud(x.rel)}>{pc1(x.rel)}</span>, sort: (x) => x.rel },
    { label: "區間報酬", num: 1, render: (x) => <span className={ud(x.ret)}>{pc1(x.ret)}</span>, sort: (x) => x.ret },
    { label: "檔數", num: 1, render: (x) => x.n + "／" + x.total, sort: (x) => x.n },
  ], [open]);
  const scols = useMemo(() => rsCols(onCode, true, M), [onCode, M]);
  const mcols = useMemo(() => rsCols(onCode, false, M), [onCode, M]);
  const og = d && d.groups.find((x) => x.name === open);
  const rk = (a) => a.map((x, i) => ({ ...x, rk: i + 1 }));
  return (
    <div className="ta-rs">
      <form className="ta-rs-form" onSubmit={(e) => { e.preventDefault(); go({}); }}>
        <label>起日 <input type="date" className="ta-q" min={rg.min} max={rg.max} value={f.start} onChange={set("start")} required /></label>
        <label>迄日 <input type="date" className="ta-q" min={rg.min} max={rg.max} value={f.end} onChange={set("end")} required /></label>
        <span className="ta-rs-pre">{RS_PRE.map(([k, nm]) => (
          <button key={k} type="button" className="ta-btn" disabled={!rg.max || rs.busy} onClick={() => go({ start: presetStart(rg.max, k), end: rg.max })}>{nm}</button>))}</span>
        <label>日均成交值 ≥ <input type="number" className="ta-q ta-rs-num" min="0" step="any" value={f.wan} onChange={set("wan")} /> {M.unit}</label>
        <label>前後各 <input type="number" className="ta-q ta-rs-num" min="5" max="100" step="1" value={f.n} onChange={set("n")} /> 名</label>
        <button type="submit" className="ta-btn ta-go" disabled={rs.busy}>{rs.busy ? "計算中…" : "計算"}</button>
      </form>
      {rs.error ? <div className="ta-err" role="alert"><span>{rs.error}</span>{!d ? <button type="button" className="ta-btn" onClick={() => run({})}>重試</button> : null}</div> : null}
      {d ? (
        <>
          <div className="ta-rs-sum">
            <b>{d.start}（基準 {mdd(d.base)} 收盤）→ {d.end}</b>，共 {d.days} 個交易日
            <span className="sep">｜</span>{M.bench[0]} <b className={ud(d.bench.tr)}>{pc1(d.bench.tr)}</b>
            <span className="sep">｜</span>{M.bench[1]} <span className={ud(d.bench.px)}>{pc1(d.bench.px)}</span>
            <span className="sep">｜</span>符合成交值門檻 {d.universe.eligible}／{d.universe.total} 檔
          </div>
          <div className="ta-cap">族群強弱 <span className="mut">{d.groups.length} 個族群，依相對大盤由強到弱；點一列看成分股</span></div>
          <div className="ta-hs"><SortTable className="ta-dt ta-rs-g" cols={gcols} rows={d.groups} rowKey={(x) => x.name}
            rowClass={(x) => (x.name === open ? "sel" : "")} onRow={(x) => setOpen(open === x.name ? null : x.name)} /></div>
          {og ? (
            <div className="ta-rs-mem">
              <div className="ta-cap">{og.name} 成分股 <span className="mut">{og.n}／{og.total} 檔有基準日與迄日價格；族群不套成交值門檻</span></div>
              <div className="ta-hs"><SortTable className="ta-dt" cols={mcols} rows={og.members} rowKey={(x) => x.code} /></div>
            </div>
          ) : null}
          <div className="ta-rs-two">
            {[["最強", d.strong], ["最弱", d.weak]].map(([t, a]) => (
              <div key={t}>
                <div className="ta-cap">相對大盤{t} {a.length} 檔 <span className="mut">{M.uni}，日均成交值 ≥ 門檻</span></div>
                <div className="ta-hs"><SortTable className="ta-dt" cols={scols} rows={rk(a)} rowKey={(x) => x.code} /></div>
              </div>
            ))}
          </div>
          <div className="ta-notes ta-rs-foot">{M.note}資料到 {d.through}。</div>
        </>
      ) : !rs.error ? <div className="ta-ph">讀取中…</div> : null}
    </div>
  );
}

// ───────── 趨勢樣板分頁（2026-11-17）：面板 tt（Skill tw_minervini／us_tt）＝每日多空樣板檔數占比折線＋今天的多空名單（/api/ta-rs op:'tt'）─────────
const TT_M = {
  tw: { uni: "上市＋上櫃普通股，近 20 日日均成交值 ≥ 5,000 萬元、上市滿 120 個交易日", rs: "RS＝近四季加權報酬在全部上市櫃普通股（滿 253 個交易日、不設成交值門檻）裡的百分位（1–99）" },
  us: { uni: "標普 500 現任成分股，近 20 日日均成交值 ≥ 80 百萬美元、上市滿 120 個交易日", rs: "RS＝近四季加權報酬在標普 500 內的百分位（1–99，與美股報告的全市場 RS 不同）；52 週高低用收盤價；歷史檔數用現任成分往回算" },
};
const TT_DEF = "多方樣板＝收盤在 50／150／200 日均線之上、50＞150＞200、200 日線上升、高於 52 週低點三成以上、距 52 週高點兩成五以內、RS ≥ 70，八條全部符合；空方樣板＝收盤在 50／150／200 日均線之下、50＜150＜200、200 日線下彎、離 52 週高點三成以上、距 52 週低點兩成五以內、RS ≤ 30，八條全部符合";
const isoD = (d) => (/^\d{8}$/.test(String(d)) ? d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6) : String(d || "—"));
// 進出訊號（11-17，Skill tw_minervini.signals）：名單每檔 since／days（今天新進＝1）／chg（／trunc＝往回算到資料頭，days 只是下限）；exits_*＝今天跳出＋why（今天沒過的條件代號，U＝掉出母體）
const TT_WHY = {
  // 條件不過的字面（tw_minervini.COND／SCOND 的否定；兩條的只要破一條就不過）
  C1: "沒站上 150 或 200 日線", C2: "150 日線沒在 200 日線之上", C3: "200 日線不再上升", C4: "50 日線沒在 150 或 200 日線之上",
  C5: "沒站上 50 日線", C6: "離 52 週低不到三成", C7: "距 52 週高超過兩成五", C8: "RS 不足 70",
  S1: "站上 150 或 200 日線", S2: "150 日線沒在 200 日線之下", S3: "200 日線不再下彎", S4: "50 日線沒在 150 或 200 日線之下",
  S5: "沒跌破 50 日線", S6: "離 52 週高不到三成", S7: "距 52 週低超過兩成五", S8: "RS 高於 30", U: "掉出母體", X: "今天沒有收盤",
};
const ttNew = (x) => x.days === 1 && !x.trunc;
const ttDays = (x) => (!has(x.days) ? "" : ttNew(x) ? <span className="ta-tt-new">新進</span> : (x.trunc ? "≥" : "") + x.days);
const ttChg = (x) => (has(x.days) ? <span className={ud(x.chg)}>{pc1(x.chg)}</span> : "");   // 舊面板沒訊號欄位＝留空
function ttCols(onCode, exit) {
  const base = [
    { label: "代號", render: (x) => <button type="button" className="ta-link mono" title="看 K 線" onClick={(e) => { e.stopPropagation(); onCode(x.code); }}>{x.code}</button>, sort: (x) => x.code },
    { label: "名稱", render: (x) => x.name || "—", sort: (x) => x.name },
    { label: "族群", render: (x) => x.group || "—", sort: (x) => x.group },
    { label: "收盤", num: 1, render: (x) => fnum(x.close), sort: (x) => x.close },
  ];
  if (exit) return base.concat([
    { label: "符合天數", num: 1, render: (x) => (has(x.days) ? (x.trunc ? "≥" : "") + x.days : "—"), sort: (x) => x.days },   // 跳出的 days 算到前一天：1＝只符合一天，不標新進
    { label: "符合期間 %", num: 1, render: ttChg, sort: (x) => x.chg },
    { label: "跳出原因", render: (x) => (Array.isArray(x.why) ? x.why.map((c) => TT_WHY[c] || c).join("、") : "—"), sort: (x) => (Array.isArray(x.why) ? x.why.join() : null) },
  ]);
  return base.concat([
    { label: "距 52 週高", num: 1, render: (x) => pc1(x.dhi), sort: (x) => x.dhi },
    { label: "離 52 週低", num: 1, render: (x) => pc1(x.dlo), sort: (x) => x.dlo },
    { label: "RS", num: 1, render: (x) => (has(x.rs) ? x.rs : "—"), sort: (x) => x.rs },
    { label: "天數", num: 1, render: ttDays, sort: (x) => x.days },
    { label: "符合以來 %", num: 1, render: ttChg, sort: (x) => x.chg },
  ]);
}
// 折線：x＝日期、y＝檔數 ÷ 母體 %；滑過（手機按住拖）看當天多方／空方／母體幾檔
function TtChart({ hist }) {
  const [hi, setHi] = useState(null);
  const pts = hist.filter((h) => h && h.n > 0).map((h) => ({ d: String(h.d), nl: h.nl, ns: h.ns, n: h.n, pl: (h.nl / h.n) * 100, ps: (h.ns / h.n) * 100 }));
  const N = pts.length;
  if (N < 2) return <div className="ta-nochart">歷史天數不足</div>;
  const W = 1000, H = 260, L = 44, R = 12, T = 22, B = 24, pw = W - L - R, ph = H - T - B;
  const top = Math.max(5, Math.ceil(Math.max(...pts.map((p) => Math.max(p.pl, p.ps))) / 5) * 5);
  const X = (i) => L + (pw * i) / (N - 1), Y = (v) => T + ph - (v / top) * ph;
  const line = (k) => pts.map((p, i) => X(i).toFixed(1) + "," + Y(p[k]).toFixed(1)).join(" ");
  const step = top <= 20 ? 5 : 10, grid = [];
  for (let v = 0; v <= top; v += step) grid.push(v);
  const ticks = [];
  let lastX = -1e9;
  pts.forEach((p, i) => { if ((i === 0 || p.d.slice(0, 6) !== pts[i - 1].d.slice(0, 6)) && X(i) - lastX >= 70 && X(i) < W - R - 30) { ticks.push(i); lastX = X(i); } });
  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    setHi(Math.max(0, Math.min(N - 1, Math.round((((e.clientX - r.left) / r.width) * W - L) / pw * (N - 1)))));
  };
  const p = hi === null ? null : pts[hi];
  return (
    <div className="ta-tt-ch">
      <svg viewBox={`0 0 ${W} ${H}`} className="ta-tt-svg" role="img" aria-label="多方與空方樣板檔數占比" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHi(null)}>
        {grid.map((v) => <g key={v}><line className="grid" x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} /><text className="ax" x={L - 6} y={Y(v) + 4} textAnchor="end">{v}%</text></g>)}
        {ticks.map((i) => <text key={i} className="ax" x={X(i)} y={H - 6} textAnchor="middle">{pts[i].d.slice(0, 4) + "/" + pts[i].d.slice(4, 6)}</text>)}
        <polyline className="tt-l" points={line("pl")} fill="none" />
        <polyline className="tt-s" points={line("ps")} fill="none" />
        <text className="tt-k tt-kl" x={L + 6} y={13}>多方樣板檔數占比 %</text>
        <text className="tt-k tt-ks" x={L + 150} y={13}>空方樣板檔數占比 %</text>
        {p ? <g>
          <line className="tt-hl" x1={X(hi)} x2={X(hi)} y1={T} y2={T + ph} />
          <circle className="tt-dl" cx={X(hi)} cy={Y(p.pl)} r="4" /><circle className="tt-ds" cx={X(hi)} cy={Y(p.ps)} r="4" />
        </g> : null}
      </svg>
      {p ? (
        <div className={"ta-tt-tip" + (hi > N / 2 ? " l" : "")} style={hi > N / 2 ? { right: (100 - (X(hi) / W) * 100) + "%" } : { left: (X(hi) / W) * 100 + "%" }}>
          <b>{isoD(p.d)}</b><br /><span className="up">多方 {p.nl} 檔（{p.pl.toFixed(1)}%）</span><br /><span className="dn">空方 {p.ns} 檔（{p.ps.toFixed(1)}%）</span><br />母體 {p.n} 檔
        </div>
      ) : null}
    </div>
  );
}
function TtView({ x, mk = "tw", onCode }) {
  const M = TT_M[mk] || TT_M.tw;
  const hist = Array.isArray(x.history) ? x.history : [];
  const last = hist.filter((h) => h && h.n > 0).pop() || {};
  const arr = (k) => (Array.isArray(x[k]) ? x[k].filter((r) => r && typeof r === "object") : []);
  const nf = (a) => a.filter(ttNew).concat(a.filter((r) => !ttNew(r)));   // 預設：新進排最前，其餘照原排序（RS）
  const long = nf(arr("long")), short = nf(arr("short")), exL = arr("exits_long"), exS = arr("exits_short");
  const sig = Array.isArray(x.exits_long) || Array.isArray(x.exits_short);   // 舊面板沒訊號欄位：不顯示新進／跳出
  const cols = useMemo(() => ttCols(onCode), [onCode]);
  const xcols = useMemo(() => ttCols(onCode, 1), [onCode]);
  const pct = (k) => (last.n > 0 ? "（" + ((k / last.n) * 100).toFixed(1) + "%）" : "");
  return (
    <div className="ta-tt">
      <div className="ta-rs-sum">
        <b>資料日 {isoD(x.day)}</b>
        <span className="sep">｜</span>母體 {has(last.n) ? last.n : "—"} 檔
        <span className="sep">｜</span>多方 <b className="up">{long.length} 檔{pct(long.length)}</b>
        <span className="sep">｜</span>空方 <b className="dn">{short.length} 檔{pct(short.length)}</b>
        {sig ? <>
          <span className="sep">｜</span>多方新進 {long.filter(ttNew).length}／跳出 {exL.length}
          <span className="sep">｜</span>空方新進 {short.filter(ttNew).length}／跳出 {exS.length}
        </> : null}
      </div>
      <TtChart hist={hist} />
      <div className="ta-rs-two">
        {[["多方樣板", long], ["空方樣板", short]].map(([t, a]) => (
          <div key={t}>
            <div className="ta-cap">{t} {a.length} 檔</div>
            {a.length ? <div className="ta-win10"><SortTable className="ta-dt" cols={cols} rows={a} rowKey={(r) => r.code} /></div> : <div className="ta-empty">今天沒有符合的個股</div>}
          </div>
        ))}
        {sig ? [["多方", exL], ["空方", exS]].map(([t, a]) => (
          <div key={"x" + t}>
            <div className="ta-cap">今日跳出・{t} {a.length} 檔</div>
            {a.length ? <div className="ta-win10"><SortTable className="ta-dt" cols={xcols} rows={a} rowKey={(r) => r.code} /></div> : <div className="ta-empty">今天沒有</div>}
          </div>
        )) : null}
      </div>
      <div className="ta-notes ta-rs-foot">資料到 {isoD(x.day)}；母體＝{M.uni}；{TT_DEF}；{M.rs}。{sig ? "新進＝今天八條全部符合、前一個交易日沒有；跳出＝前一個交易日符合、今天不符合（原因＝今天沒過的條件）；天數＝連續符合的交易日數（≥＝往回算到資料起點）；符合以來 %／符合期間 %＝連續符合第一天收盤到今天收盤的還原報酬。" : ""}</div>
    </div>
  );
}

// ───────── 選擇權分頁（2026-11-23 Yoda 定案）：只做看漲買 Call／看跌買 Put、一次算一個（/api/ta-opt；數字全在 lib/ta-opt.js）─────────
// ⛔ 不放：賣出、價差、Covered Call、Roll、隱含波動率／Delta 等欄位（機率欄除外）、說明段落
const OPT_KEY = "yoda_ta_opt_sym";
function readOptSym() { return optSym(lsGet(OPT_KEY)) || "QQQ"; }
const usd0 = (v, sign) => (typeof v === "number" && Number.isFinite(v) ? (v < 0 ? "−" : sign && v > 0 ? "+" : "") + "$" + Math.round(Math.abs(v)).toLocaleString("en-US") : "—");
const cpName = (cp) => (cp === "C" ? "Call" : "Put");
function optionCols(cp) {
  return [
    { label: "選擇", render: (r) => "買 " + fnum(r.k) + " " + cpName(cp), sort: (r) => r.k },
    { label: "成本", num: 1, render: (r) => usd0(r.cost), sort: (r) => r.cost },
    { label: "看對時賺賠", num: 1, render: (r) => <span className={ud(r.pnl)}>{usd0(r.pnl, 1)}</span>, sort: (r) => r.pnl },
    { label: "報酬 %", num: 1, render: (r) => <span className={ud(r.ret)}>{pc1(r.ret)}</span>, sort: (r) => r.ret },
    { label: "市場估的賺錢機率（用隱含波動率估）", num: 1, render: (r) => (r.prob === null ? "—" : (r.prob * 100).toFixed(0) + "%"), sort: (r) => r.prob },
    { label: "最多虧", num: 1, render: (r) => usd0(r.cost), sort: (r) => r.cost },
    { label: "損益兩平", num: 1, render: (r) => fnum(r.be), sort: (r) => r.be },
  ];
}
function niceStep(span, n) { const s = span / n, p = Math.pow(10, Math.floor(Math.log10(s))); return [1, 2, 5, 10].map((m) => m * p).find((v) => v >= s) || p * 10; }
// 到期損益圖：橫軸到期價格（現價 ±40%）、縱軸賺賠；賺的那段紅、賠的那段綠；按住拖（或拉下面的拖拉條）移動價格點
function PayChart({ r, n, price, tgt, S, onS }) {
  const lo = price * 0.6, hi = price * 1.4;
  const f = (s) => optPnl(r.cp, r.k, r.ask, s, n);
  const xs = [lo, r.k, hi].filter((s) => s >= lo && s <= hi).sort((a, b) => a - b);
  const W = 1000, H = 260, L = 78, R = 14, T = 40, B = 26, pw = W - L - R, ph = H - T - B;
  let y0 = Math.min(0, ...xs.map(f)), y1 = Math.max(0, ...xs.map(f));
  if (y1 === y0) y1 = y0 + 1;
  const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
  const X = (s) => L + ((s - lo) / (hi - lo)) * pw, Y = (v) => T + ((y1 - v) / (y1 - y0)) * ph;
  const ys = niceStep(y1 - y0, 5), xt = niceStep(hi - lo, 8), gy = [], gx = [];
  for (let v = Math.ceil(y0 / ys) * ys; v <= y1; v += ys) gy.push(v);
  for (let v = Math.ceil(lo / xt) * xt; v <= hi; v += xt) gx.push(v);
  const pts = xs.map((s) => X(s).toFixed(1) + "," + Y(f(s)).toFixed(1)).join(" ");
  const vx = [[price, "現價 " + fnum(price), "now"], [r.be, "損益兩平 " + fnum(r.be), "be"], [tgt, "目標價 " + fnum(tgt), "tg"]].filter(([s]) => Number.isFinite(s) && s >= lo && s <= hi);
  const hasS = Number.isFinite(S) && S >= lo && S <= hi, vS = hasS ? f(S) : null;
  const move = (e) => {
    if (e.type === "pointermove" && !e.buttons) return;
    const b = e.currentTarget.getBoundingClientRect();
    if (!b.width) return;
    const s = lo + ((((e.clientX - b.left) / b.width) * W - L) / pw) * (hi - lo);
    onS(Math.max(lo, Math.min(hi, s)).toFixed(2));
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ta-tt-svg ta-pay" role="img" aria-label="到期損益圖" onPointerDown={move} onPointerMove={move}>
      <defs>
        <clipPath id="ta-pay-up"><rect x={L} y={T} width={pw} height={Math.max(0, Y(0) - T)} /></clipPath>
        <clipPath id="ta-pay-dn"><rect x={L} y={Y(0)} width={pw} height={Math.max(0, T + ph - Y(0))} /></clipPath>
      </defs>
      {gy.map((v) => <g key={"y" + v}><line className="grid" x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} /><text className="ax" x={L - 6} y={Y(v) + 4} textAnchor="end">{usd0(v)}</text></g>)}
      {gx.map((v) => <text key={"x" + v} className="ax" x={X(v)} y={H - 7} textAnchor="middle">{fnum(v)}</text>)}
      <line className="zero" x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} />
      {vx.map(([s, t, c], i) => <g key={c} data-vx={c}><line className={"vx " + c} x1={X(s)} x2={X(s)} y1={T} y2={T + ph} /><text className={"vxt " + c} x={X(s)} y={12 + i * 13} textAnchor="middle">{t}</text></g>)}
      <polyline className="pay-up" fill="none" clipPath="url(#ta-pay-up)" points={pts} />
      <polyline className="pay-dn" fill="none" clipPath="url(#ta-pay-dn)" points={pts} />
      {hasS ? <g data-vx="s"><line className="vx s" x1={X(S)} x2={X(S)} y1={T} y2={T + ph} /><circle className={"pay-pt " + (ud(vS) || "flat")} cx={X(S)} cy={Y(vS)} r="6" />
        <text className={"pay-ptt " + ud(vS)} x={X(S) + (X(S) > W - 160 ? -10 : 10)} y={Math.max(T + 12, Y(vS) - 10)} textAnchor={X(S) > W - 160 ? "end" : "start"}>{fnum(S)}：{usd0(vS, 1)}</text></g> : null}
    </svg>
  );
}
// 試算：點表格一列帶入；口數、到期價格（輸入框＋拖拉條）即時算
function OptTry({ r, price, tgt, n, setN, S, setS }) {
  const N = lots(n), lo = price * 0.6, hi = price * 1.4;
  const Sv = S === "" ? NaN : Math.max(0, Number(S));   // 打負數當 0（min=0 擋不住打字）
  const c = optCost(r.ask, N), v = Number.isFinite(Sv) ? optPnl(r.cp, r.k, r.ask, Sv, N) : null, mg = maxGain(r.cp, r.k, r.ask, N);
  return (
    <div className="ta-opt-try">
      <div className="ta-cap">試算</div>
      <div className="ta-rs-form">
        <label>買 <input type="number" className="ta-q ta-opt-n" min="1" step="1" value={n} onChange={(e) => setN(e.target.value)} onBlur={() => setN(String(N))} aria-label="口數" /> 口 {fnum(r.k)} {cpName(r.cp)}</label>
        <label>到期價格 <input type="number" className="ta-q ta-rs-num" step="any" value={S} onChange={(e) => setS(e.target.value)} /></label>
        <input type="range" className="ta-opt-rg" min={lo} max={hi} step={(hi - lo) / 800} value={Number.isFinite(Sv) ? Math.max(lo, Math.min(hi, Sv)) : price}
          onChange={(e) => setS(Number(e.target.value).toFixed(2))} aria-label="拖拉到期價格" />
      </div>
      <dl className="ta-opt-dl">
        <dt>到期在 {Number.isFinite(Sv) ? fnum(Sv) : "—"} 的賺賠</dt><dd className={"big " + ud(v)}>{usd0(v, 1)}<span className="sep">｜</span>{pc1(v === null ? null : retPct(v, c))}</dd>
        <dt>損益兩平</dt><dd>{fnum(r.be)}</dd>
        <dt>最多虧</dt><dd>{usd0(c)}</dd>
        <dt>最多賺</dt><dd>{mg === Infinity ? "無上限" : usd0(mg)}</dd>
      </dl>
      <PayChart r={r} n={N} price={price} tgt={tgt} S={Sv} onS={setS} />
    </div>
  );
}
// 看法＋表格＋試算；換商品＝整份重來（key），換到期日保留方向、目標價
function OptCalc({ x, exp, busy, onExp }) {
  const defT = (cp) => (x.price * (cp === "C" ? 1.05 : 0.95)).toFixed(2);
  const [cp, setCp] = useState("C");
  const [tg, setTg] = useState(() => defT("C"));
  const [sel, setSel] = useState(null);   // {e, cp, k}
  const [n, setN] = useState("1");
  const [S, setS] = useState("");
  const tgt = tg === "" ? NaN : Math.max(0, Number(tg));
  const days = Math.max(1, dte(x.expiry));   // 今天到期也照 1 天估機率（盤中還有幾小時，不當 0 直接判 0／1）
  const rows = useMemo(() => candidates(x.rows, cp, x.price, tgt, days), [x, cp, tgt, days]);
  const cols = useMemo(() => optionCols(cp), [cp]);
  const r = sel && sel.e === x.expiry && sel.cp === cp ? rows.find((y) => y.k === sel.k) || null : null;
  const pickDir = (v) => { setCp(v); setTg(defT(v)); setSel(null); };
  const pick = (y) => { setSel({ e: x.expiry, cp, k: y.k }); setS(Number.isFinite(tgt) ? tg : x.price.toFixed(2)); };
  return (
    <>
      <div className="ta-rs-form ta-opt-view">
        <b>你的看法</b>
        <label>方向 <select className="ta-q" value={cp} onChange={(e) => pickDir(e.target.value)}><option value="C">看漲</option><option value="P">看跌</option></select></label>
        <label>目標價 <input type="number" className="ta-q ta-rs-num" min="0" step="any" value={tg} onChange={(e) => setTg(e.target.value)} /></label>
        <label>到期日 <select className="ta-q" value={exp} onChange={(e) => onExp(e.target.value)}>{x.expiries.map((e) => <option key={e} value={e}>{e}（{dte(e) ? "剩 " + dte(e) + " 天" : "今天到期"}）</option>)}</select></label>
      </div>
      <div className="ta-cap">符合的選擇 <span className="mut">{x.expiry} 到期的{cp === "C" ? "買權" : "賣權"}，履約價在現價 ±25% 內、有買賣報價的 {rows.length} 檔；點一列帶入試算</span></div>
      <div className={busy ? "ta-opt-busy" : ""}>
        {rows.length ? <div className="ta-win10"><SortTable className="ta-dt ta-opt-tbl" cols={cols} rows={rows} rowKey={(y) => cp + y.k} init={[3, -1]}
          rowClass={(y) => (r && y.k === r.k ? "sel" : "")} onRow={pick} /></div> : <div className="ta-empty">資料不足：這個到期日沒有符合的報價</div>}
      </div>
      {r ? <OptTry r={r} price={x.price} tgt={tgt} n={n} setN={setN} S={S} setS={setS} /> : null}
    </>
  );
}
function OptView({ opt, run }) {
  const d = opt.data;
  const err = opt.error ? (String(opt.error).startsWith("資料不足") ? opt.error : "資料不足：" + opt.error) : "";
  return (
    <div className="ta-optv">
      <div className="ta-rs-form">
        <label>商品 <select className="ta-q" value={opt.sym} onChange={(e) => run(e.target.value, "")}>
          {OPT_GROUPS.map(([gn, a]) => <optgroup key={gn} label={gn}>{a.map(([s, nm]) => <option key={s} value={s}>{s}{nm ? "（" + nm + "）" : ""}</option>)}</optgroup>)}
        </select></label>
        {d ? <span>現價 <b className="mono">{fnum(d.price)}</b>{d.off ? <span className="mut">（非正規盤時段，用上一個正規盤收盤價，跟選擇權報價同一時間）</span> : null}</span> : null}
        {d ? <span className="mut">CBOE 延遲報價（約 15 分鐘）<span className="sep">｜</span>資料時間 {fmtTs(d.ts, "Asia/Taipei") || "—"}（台灣）</span> : null}
      </div>
      {err ? <div className="ta-err" role="alert"><span>{err}</span><button type="button" className="ta-btn" onClick={() => run(opt.sym, opt.exp)}>重試</button></div>
        : !d ? <div className="ta-ph">讀取中…</div>
        : <OptCalc key={d.symbol} x={d} exp={opt.exp || d.expiry} busy={!!opt.busy} onExp={(e) => run(opt.sym, e)} />}
    </div>
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
  const [dd, setDd] = useState(null);           // 最近查過下拉：null＝收起；-1＝打開沒反白；0…＝↑↓反白第幾筆
  const [zh, setZh] = useState(null);           // 台股代號 → 中文名（下拉用）；null＝還沒拿到
  const zhAsk = useRef(false);
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
  const [view, setView] = useState(readView);   // chart＝K 線｜idx＝指數位階
  const pickView = (v) => { setView(v); lsSet(VIEW_KEY, v); };
  const [idx, setIdx] = useState(null);         // {date, html}｜{error}；整個分頁期間只抓一次（失敗的下次打開再抓）
  const [rs, setRs] = useState({});             // 區間強弱：市場 → {data（最後一次成功的結果）, error, busy, range}
  const [rsMkt, setRsMkt] = useState(readRsMkt); // tw｜us，記在 localStorage
  const pickRsMkt = (k) => { setRsMkt(k); lsSet(RS_MKT_KEY, k); };
  const rsSeq = useRef({});
  const [tt, setTt] = useState({});             // 趨勢樣板：市場 → {busy}｜{data}｜{error}；市場切換跟區間強弱共用 rsMkt
  const [opt, setOpt] = useState({});           // 選擇權：{sym, exp, busy, data（同商品換到期日時留著上一份）}｜{sym, exp, error}
  const optSeq = useRef(0);
  const pickSide = (k) => { setSide(k); lsSet(SIDE_KEY, k); pickView("chart"); };
  const [srOn, setSrOn] = useState(readSr);
  const pickSr = () => { setSrOn(!srOn); lsSet(SR_KEY, srOn ? "0" : "1"); pickView("chart"); };
  const [kkOn, setKkOn] = useState(readKk);
  const pickKk = () => { setKkOn(!kkOn); lsSet(KK_KEY, kkOn ? "0" : "1"); pickView("chart"); };
  const [s4On, setS4On] = useState(readS4);
  const pickS4 = () => { setS4On(!s4On); lsSet(S4_KEY, s4On ? "0" : "1"); pickView("chart"); };
  const [l4On, setL4On] = useState(readL4);
  const pickL4 = () => { setL4On(!l4On); lsSet(L4_KEY, l4On ? "0" : "1"); pickView("chart"); };
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
    if (j.reason === "need-login") { if (lsGet(TOK_KEY) === tok.current) lsSet(TOK_KEY, null); tok.current = ""; setMsg("登入已過期，請重新登入。"); setPhase("login"); return true; }
    if (j.reason === "not-enabled") { setPhase("denied"); return true; }
    return false;
  }, []);

  // 查代號／指數位階／區間強弱：回 need-login 先換票重試一次（票可能剛過期、還在 7 天寬限內，或別的分頁已換了新票），換不到才交給閘門
  const call = useCallback(async (url, body) => {
    const j = await post(url, body, tok.current);
    if (j.reason !== "need-login") return j;
    tok.current = lsGet(TOK_KEY) || tok.current;
    const s = await post("/api/ta-live", { action: "status" }, tok.current);
    if (!s.ok) return s;   // need-login／not-enabled 走閘門；連線或伺服器錯誤只顯示錯誤、不清票
    if (typeof s.token === "string" && s.token) { tok.current = s.token; lsSet(TOK_KEY, s.token); if (s.wm) setWm(s.wm); }
    return post(url, body, tok.current);
  }, []);

  // 查一個週期：快取有就用；同一個 sym|tf 正在抓就共用那一次（共振的背景 1H／4H 跟使用者點週期不重複打）
  const fly = useRef(new Map());
  const fetchTf = useCallback((s, t) => {
    const ck = s + "|" + t;
    if (cache.current.has(ck)) return Promise.resolve({ ok: true, data: cache.current.get(ck) });
    if (!fly.current.has(ck)) {
      fly.current.set(ck, call("/api/ta-live", { symbol: s, tf: t }).then((j) => {
        fly.current.delete(ck);
        if (j.ok) cache.current.set(ck, j.data);
        return j;
      }));
    }
    return fly.current.get(ck);
  }, [call]);

  const load = useCallback(async (s, t) => {
    s = String(s || "").trim().toUpperCase();
    if (!s) return;
    setSym(s); setTf(t); setErr(null);
    try { history.replaceState(null, "", location.pathname + location.search + "#s=" + encodeURIComponent(s) + "&tf=" + t); } catch (e) {}
    const ck = s + "|" + t;
    if (cache.current.has(ck)) { setData(cache.current.get(ck)); return; }
    const my = ++seq.current;
    setBusy(true);
    const j = await fetchTf(s, t);
    if (my !== seq.current) return;
    setBusy(false);
    if (j.quota) setQuota(j.quota);
    if (!j.ok) {
      if (gate(j)) return;
      if (j.reason === "daily-only" && t !== "D") { load(s, "D"); return; }   // 台指期／費半期只有日K、週K：選著 1H／4H 查就自動改日K
      setErr({ reason: j.reason, error: j.error || "讀取失敗" }); setData(null); return;
    }
    setData(j.data);
    const code = g(j.data, "symbol", "code") || s;
    const nx = cleanRecent([{ s: String(code), n: g(j.data, "symbol", "name") }, ...readRecent().filter((x) => x.s !== code && x.s !== s)]).slice(0, RECENT_MAX);
    lsSet(RECENT_KEY, JSON.stringify(nx)); setRecent(nx);
  }, [gate, fetchTf]);

  // 共振閃爍：主圖查好（不在讀、沒錯）才在背景抓同一檔的 1H、4H；期交所只有日資料的不抓
  const [mtf, setMtf] = useState(null);         // {s, h1, h4}
  const [now, setNow] = useState(() => Date.now());
  const [gone, setGone] = useState([]);         // 使用者點掉的那幾次共振（sym|方向|1H 時間|4H 時間）
  useEffect(() => setGone(readGone()), []);
  useEffect(() => {
    if (phase !== "app" || !sym || !data || busy || err) return;
    const tfs = g(data, "symbol", "tfs");
    if (Array.isArray(tfs) && tfs.length && !MTF_TFS.every((k) => tfs.includes(k))) { setMtf(null); return; }
    let live = true;
    Promise.all(MTF_TFS.map((k) => fetchTf(sym, k))).then(([a, b]) => {
      if (!live) return;
      setNow(Date.now());
      setMtf(a.ok && b.ok ? { s: sym, h1: a.data, h4: b.data } : null);   // 背景抓失敗就不閃，不打斷畫面
    });
    return () => { live = false; };
  }, [phase, sym, data, busy, err, fetchTf]);
  useEffect(() => {   // 每分鐘看一次現在時間：過 8 小時自己停
    if (!mtf) return;
    const id = setInterval(() => setNow(Date.now()), 60e3);
    return () => clearInterval(id);
  }, [mtf]);
  const mtfRes = useMemo(() => {   // 面板規則一改就重算；只用定案 K（backtest 只吃前 bars_completed 根）
    if (!mtf || mtf.s !== sym || !g(mtf.h1, "history", "c") || !g(mtf.h4, "history", "c")) return null;
    try {
      return { r1: backtest(mtf.h1.history, mtf.h1.bars_completed, applied), r4: backtest(mtf.h4.history, mtf.h4.bars_completed, applied), tz: g(mtf.h1, "symbol", "timezone") || "Asia/Taipei", mkt: g(mtf.h1, "symbol", "market") };
    } catch (e) { console.error("[ta] 共振計算失敗", e); return null; }
  }, [mtf, sym, applied]);
  const bl0 = mtfRes ? mtfBlink(mtfRes.r1, mtfRes.r4, mtfRes.tz, side, now, mtfRes.mkt) : null;
  const blink = bl0 && !gone.includes(sym + "|" + bl0.key) ? bl0 : null;
  const dropBlink = () => {   // 點過 1H 或 4H 就停這一次；新的一次訊號（時間不同）會再閃
    if (!blink) return;
    const nx = [sym + "|" + blink.key, ...gone].slice(0, 50);
    setGone(nx); lsSet(GONE_KEY, JSON.stringify(nx));
  };

  const start = useCallback(async () => {
    const j = await post("/api/ta-live", { action: "status" }, tok.current);
    if (!j.ok) {
      if (gate(j)) return;
      setMsg(j.error || "讀取失敗"); setPhase("error"); return;
    }
    if (typeof j.token === "string" && j.token) { tok.current = j.token; lsSet(TOK_KEY, j.token); }   // 伺服器換發的長效票（只能用在 /ta）；密碼從不存
    setOwner(!!j.owner); setQuota(j.quota || null); setWm(j.wm || ""); setPhase("app");
    const h = readHash();
    if (h.s) load(h.s, TFS.some(([k]) => k === h.tf) ? h.tf : "D");
  }, [gate, load]);

  useEffect(() => {
    setRecent(readRecent());
    tok.current = lsGet(TOK_KEY) || "";
    if (!tok.current) { setPhase("login"); return; }
    start();   // 票過期也先問伺服器（過期 7 天內 status 會現查付費＋開通、換新票），不在這裡自己判過期
  }, [start]);

  useEffect(() => {   // 分頁開很久：切回來時票過半壽命就問一次 status 續票（失敗不打斷畫面，只有 need-login／not-enabled 走閘門）
    if (phase !== "app") return;
    const f = () => {
      if (document.visibilityState !== "visible" || !tok.current || !pastHalf(tok.current)) return;
      post("/api/ta-live", { action: "status" }, tok.current).then((j) => {
        if (j.ok && typeof j.token === "string" && j.token) { tok.current = j.token; lsSet(TOK_KEY, j.token); if (j.wm) setWm(j.wm); }
        else if (!j.ok) gate(j);
      });
    };
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, [phase, gate]);

  useEffect(() => {   // 下拉與標題列的台股中文名：清單裡有台股才抓一次（查到新台股會進清單＝也會觸發）；失敗（沒登入、網路、Blob 沒資料）就只顯示代號，下次清單變了再試；不走 gate，不影響查圖
    if (phase !== "app" || zh || zhAsk.current || !recent.some((r) => /^\d/.test(r.s))) return;
    zhAsk.current = true;
    call("/api/ta-rs", { op: "names" }).then((j) => {
      if (j.ok && j.names && typeof j.names === "object") setZh(j.names); else zhAsk.current = false;
    });
  }, [phase, recent, zh, call]);

  useEffect(() => {   // 指數位階：第一次打開才抓（idx 故意不放進相依：拿到了就不再抓）
    if (phase !== "app" || view !== "idx" || (idx && !idx.error)) return;
    let live = true;
    setIdx(null);
    call("/api/ta-idx", {}).then((j) => {
      if (!live || gate(j)) return;
      setIdx(j.ok ? { date: j.date, html: j.html } : { error: j.error || "讀取失敗" });
    });
    return () => { live = false; };
  }, [phase, view, gate, call]);

  const runRs = useCallback(async (mk, body) => {   // 區間強弱：每按一次「計算」打一次；每個市場只收自己最後一次的回應
    const my = (rsSeq.current[mk] = (rsSeq.current[mk] || 0) + 1);
    const up = (fn) => setRs((a) => ({ ...a, [mk]: fn(a[mk]) }));
    up((o) => ({ ...(o || {}), busy: true, error: "" }));
    const j = await call("/api/ta-rs", { ...body, market: mk });
    if (my !== rsSeq.current[mk]) return;
    if (gate(j)) { setRs({}); return; }   // 登入過期：清掉 busy，重新登入後 !rs[市場] 會自動重算
    up((o) => (j.ok ? { data: j, busy: false, error: "" } : { ...(o || {}), busy: false, error: j.error || "讀取失敗", range: j.range }));
  }, [gate, call]);
  useEffect(() => { if (phase === "app" && view === "rs" && !rs[rsMkt]) runRs(rsMkt, {}); }, [phase, view, rs, rsMkt, runRs]);   // 每個市場第一次打開＝近 1 月
  const rsCode = useCallback((c) => { pickView("chart"); load(c, "D"); }, [load]);
  useEffect(() => {   // 趨勢樣板：每個市場第一次打開抓一次（失敗按重試＝清掉該市場再抓）
    if (phase !== "app" || view !== "tt" || tt[rsMkt]) return;
    const mk = rsMkt;
    setTt((a) => ({ ...a, [mk]: { busy: true } }));
    call("/api/ta-rs", { op: "tt", market: mk }).then((j) => {
      if (gate(j)) { setTt({}); return; }
      setTt((a) => ({ ...a, [mk]: j.ok ? { data: j } : { error: j.error || "讀取失敗" } }));
    });
  }, [phase, view, tt, rsMkt, gate, call]);
  const runOpt = useCallback(async (s, e) => {   // 選擇權：只收最後一次的回應；商品選擇記在 localStorage
    const my = ++optSeq.current;
    lsSet(OPT_KEY, s);
    setOpt((o) => ({ sym: s, exp: e, busy: true, data: o.sym === s ? o.data : null }));
    const j = await call("/api/ta-opt", e ? { symbol: s, expiry: e } : { symbol: s });
    if (my !== optSeq.current) return;
    if (gate(j)) { setOpt({}); return; }   // 重新登入後 !opt.sym 會自動再抓
    setOpt(j.ok ? { sym: s, exp: j.expiry, data: j } : { sym: s, exp: e, error: j.error || "讀取失敗" });
  }, [gate, call]);
  useEffect(() => { if (phase === "app" && view === "opt" && !opt.sym) runOpt(readOptSym(), ""); }, [phase, view, opt.sym, runOpt]);
  const mktSeg = (
    <div className="ta-seg ta-rs-mkt" role="group" aria-label="市場">
      {RS_MKTS.map(([k, nm]) => <button key={k} type="button" aria-pressed={rsMkt === k} className={"ta-tab" + (rsMkt === k ? " on" : "")} onClick={() => pickRsMkt(k)}>{nm}</button>)}
    </div>
  );

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
  const logout = () => { lsSet(TOK_KEY, null); tok.current = ""; cache.current.clear(); fly.current.clear(); setMtf(null); setData(null); setSym(""); setMsg(""); setPhase("login"); };
  const submit = (e) => { e.preventDefault(); const s = q.trim(); if (s) { setDd(null); pickView("chart"); load(s, tf); setQ(""); } };
  const pickRecent = (s) => { setDd(null); pickView("chart"); load(s, tf); };
  const ddKey = (e) => {   // 只有輸入框空著（下拉打開）時 ↑↓Enter 才管清單；打了字 Enter 照舊查打的代號
    if (e.key === "Escape") { setDd(null); return; }
    if (q || !recent.length || !["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
    const n = recent.length, x = dd === null ? -1 : dd;
    if (e.key === "Enter") { if (x >= 0) { e.preventDefault(); pickRecent(recent[x].s); } return; }
    e.preventDefault(); setDd(e.key === "ArrowDown" ? (x + 1) % n : x <= 0 ? n - 1 : x - 1);
  };

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
          {phase === "error" ? <button type="button" className="ta-btn ta-go" onClick={() => { setPhase("init"); start(); }}>重試</button> : null}
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
          <h1 className="ta-h1">技術分析<span className="sep">｜</span><span className="ta-sub2">台股上市櫃・美股・ETF・美國期貨・台指期・加權指數・費半，1H／4H／日K／週K</span></h1>
        </div>
      </header>

      <div className="ta-split">
        {/* ── 左 1/4：輸入（點一下下拉最近查過）＋額度 ── */}
        <aside className="ta-left" aria-label="查詢">
          <form className="ta-ltools" onSubmit={submit}>
            <label className="ta-lab" htmlFor="ta-in">輸入代號</label>
            <div className="ta-inrow">
              <input id="ta-in" type="search" className="ta-q" placeholder="2330、00878、NVDA、NQ1!、台指期" value={q}
                onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false} enterKeyHint="search"
                role="combobox" aria-expanded={dd !== null && !q && recent.length > 0} aria-controls="ta-dd"
                aria-activedescendant={dd !== null && dd >= 0 && !q && dd < recent.length ? "ta-dd-" + dd : undefined}
                onFocus={() => setDd(-1)} onClick={() => setDd((x) => (x === null ? -1 : x))} onBlur={() => setDd(null)} onKeyDown={ddKey} />
              <button type="submit" className="ta-btn ta-go" disabled={busy || !q.trim()}>查</button>
              {dd !== null && !q && recent.length ? <RecentDrop items={recent} hi={dd} cur={symInfo.code || sym} onPick={pickRecent} zh={zh}
                onClear={() => { lsSet(RECENT_KEY, null); setRecent([]); setDd(null); }} /> : null}
            </div>
          </form>
          <div className="ta-quota" data-left={quota && !quota.unlimited ? quota.left : ""}>
            <button type="button" className="ta-link ta-out" onClick={logout}>登出</button>
            {owner || (quota && quota.unlimited) ? <>站長：不限檔數</> : quota ? (
              <>今日已查 <b>{quota.used}</b>／{quota.max} 檔，剩 <b className={quota.left ? "" : "warn"}>{quota.left}</b> 檔
                <div className="mut">同一檔換週期、均線組不另計；台灣時間 0 點重算</div></>
            ) : "—"}
          </div>
        </aside>

        <RulePanel draft={draft} set={setDraft} errors={norm.errors} status={rstatus} saved={saved} active={active}
          nm={nm} setNm={setNm} rn={rn} setRn={setRn} msg={pmsg} onSave={saveS} onApply={applyS} onDel={delS} onRen={renS} onReset={resetS}
          noVol={noVolume(dv)} />

        {/* ── 右 3/4：週期＋均線組＋圖＋表 ── */}
        <div className="ta-right">
          <div className="ta-tabs" data-view={view}>
            <TfTabs tf={tf} tfs={symInfo.tfs} blink={blink} onPick={(k) => { if (MTF_TFS.includes(k)) dropBlink(); pickView("chart"); if (sym) load(sym, k); else setTf(k); }} />
            <div className="ta-seg" role="group" aria-label="均線組">
              <span className="ta-seglab">均線</span>
              {MA_SETS.map(([k, nm]) => (
                <button key={k} type="button" aria-pressed={maSet === k} className={"ta-tab" + (maSet === k ? " on" : "")} onClick={() => { setMaSet(k); pickView("chart"); }}
                  title={MA_NM[k]}>{nm}</button>
              ))}
            </div>
            <div className="ta-seg" role="group" aria-label="訊號篩選">
              <span className="ta-seglab">訊號</span>
              {SIDES.map(([k, nm]) => (
                <button key={k} type="button" aria-pressed={side === k} className={"ta-tab" + (side === k ? " on" : "")} onClick={() => pickSide(k)} data-side={k}>{nm}</button>
              ))}
            </div>
            <div className="ta-seg" role="group" aria-label="圖上線條">
              <button type="button" aria-pressed={srOn} className={"ta-tab" + (srOn ? " on" : "")} onClick={pickSr} data-sr>撐壓線</button>
              <button type="button" aria-pressed={kkOn} className={"ta-tab" + (kkOn ? " on" : "")} onClick={pickKk} data-kk>關鍵K</button>
              <button type="button" aria-pressed={s4On} className={"ta-tab" + (s4On ? " on" : "")} onClick={pickS4} data-s4>空方四步</button>
              <button type="button" aria-pressed={l4On} className={"ta-tab" + (l4On ? " on" : "")} onClick={pickL4} data-l4>多方四步</button>
            </div>
            <div className="ta-seg ta-vseg">
              <button type="button" aria-pressed={view === "idx"} className={"ta-tab" + (view === "idx" ? " on" : "")}
                onClick={() => pickView(view === "idx" ? "chart" : "idx")}>指數位階</button>
              <button type="button" aria-pressed={view === "rs"} className={"ta-tab" + (view === "rs" ? " on" : "")}
                onClick={() => pickView(view === "rs" ? "chart" : "rs")}>區間強弱</button>
              <button type="button" aria-pressed={view === "tt"} className={"ta-tab" + (view === "tt" ? " on" : "")}
                onClick={() => pickView(view === "tt" ? "chart" : "tt")}>趨勢樣板</button>
              <button type="button" aria-pressed={view === "opt"} className={"ta-tab" + (view === "opt" ? " on" : "")}
                onClick={() => pickView(view === "opt" ? "chart" : "opt")}>選擇權</button>
            </div>
            {busy ? <span className="ta-kbd">計算中…</span> : null}
          </div>
          {view === "idx" ? (
            <div className="ta-pane">
              <Boundary reset={idx}>
                {!idx ? <div className="ta-ph">讀取中…</div> : idx.error ? <div className="ta-err"><span>{idx.error}</span></div> : <IdxView x={idx} />}
              </Boundary>
            </div>
          ) : null}
          {view === "rs" ? (
            <div className="ta-pane">
              {mktSeg}
              {RS_MKTS.map(([k]) => (   // 兩個市場都留著（只藏起來）＝各自的輸入與結果切回來還在
                <div key={k} hidden={rsMkt !== k}>
                  <Boundary reset={rs[k]}>{rs[k] ? <RsView key={rs[k].data ? "ok" : "init"} mk={k} rs={rs[k]} run={(b) => runRs(k, b)} onCode={rsCode} /> : <div className="ta-ph">讀取中…</div>}</Boundary>
                </div>
              ))}
            </div>
          ) : null}
          {view === "tt" ? (
            <div className="ta-pane">
              {mktSeg}
              <Boundary reset={tt[rsMkt]}>
                {!tt[rsMkt] || tt[rsMkt].busy ? <div className="ta-ph">讀取中…</div>
                  : tt[rsMkt].error ? <div className="ta-err" role="alert"><span>{tt[rsMkt].error}</span><button type="button" className="ta-btn" onClick={() => setTt((a) => ({ ...a, [rsMkt]: undefined }))}>重試</button></div>
                  : <TtView x={tt[rsMkt].data} mk={rsMkt} onCode={rsCode} />}
              </Boundary>
            </div>
          ) : null}
          {view === "opt" ? (
            <div className="ta-pane">
              <Boundary reset={opt}>{opt.sym ? <OptView opt={opt} run={runOpt} /> : <div className="ta-ph">讀取中…</div>}</Boundary>
            </div>
          ) : null}
          <div className="ta-pane" hidden={view !== "chart"}>
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
                  <h2><span className="mono">{symInfo.code || sym}</span>{titleName(symInfo, symInfo.code || sym, zh)}</h2>
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
                <Boundary reset={bkey}><ChartArea key={(symInfo.yahoo || sym) + "|" + d.tf} d={d} maSet={maSet} srOn={srOn} kkOn={kkOn} s4On={s4On} l4On={l4On} /></Boundary>
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
