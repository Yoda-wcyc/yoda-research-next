// /ta「選擇權」分頁（2026-11-23 Yoda 定案：只做買 Call／買 Put、一次算一個）：CBOE 延遲報價解析＋到期損益試算（純函式，tests/ta_opt.cjs）
// 抓法同 Skill\opt_cboe.py：cdn.cboe.com/api/global/delayed_quotes/options/<SYM>.json；options[].option＝OCC 代碼（代號＋YYMMDD＋C/P＋履約價×1000 八位數）
//   欄位：bid／ask／iv（小數，1.2474＝124.74%）／open_interest；data.current_price；timestamp＝UTC

// 商品下拉（照這個順序、分組）；名稱空字串＝只顯示代號
export const OPT_GROUPS = [
  ["ETF", [["QQQ", "那斯達克 100"], ["SPY", "標普 500"], ["SOXX", "費半"]]],
  ["大型科技股", [["NVDA", ""], ["AAPL", ""], ["MSFT", ""], ["AMZN", ""], ["GOOGL", ""], ["META", ""], ["TSLA", ""], ["AVGO", ""]]],
];
export const OPT_SYMS = OPT_GROUPS.flatMap((g) => g[1].map((x) => x[0]));
export function optSym(s) {
  const v = typeof s === "string" ? s.trim().toUpperCase() : "";
  return OPT_SYMS.includes(v) ? v : null;
}
// 「作空試算」子分頁（11-26）另外要的：SMH、NDX（CBOE 代號 _NDX；XND 自己的鏈 11-21 後沒更新，前端借 NDX ÷ 100）。舊分頁下拉照 OPT_GROUPS 不變
export const SHORT_EXTRA = ["SMH", "NDX"];
const ROOTS = { NDX: ["NDX", "NDXP"] };   // _NDX 的鏈混 NDX（AM 結算）與 NDXP（PM 結算）；同一天兩種都有取 NDX
export const cboeCode = (sym) => (ROOTS[sym] ? "_" + sym : sym);
export function cboeSym(s) {
  const v = typeof s === "string" ? s.trim().toUpperCase() : "";
  return optSym(v) || (SHORT_EXTRA.includes(v) ? v : null);
}

const OCC = /^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
export function parseOcc(code) {
  const m = typeof code === "string" ? OCC.exec(code) : null;
  return m ? { root: m[1], e: "20" + m[2] + "-" + m[3] + "-" + m[4], cp: m[5], k: Number(m[6]) / 1000 } : null;
}

const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
// CBOE 原始 JSON → {symbol, price, ts, last, expiries:[到期日…], by:{到期日: [{k, c:{b,a,iv,oi}|null, p:同}]}}
// 只收代號本身的鏈（NVDA 會混 B1VDA 這種調整後合約，不收）；多個 root 的（NDX）每個到期日只留一個 root，另回 root:{到期日: root}
export function parseChain(raw, sym) {
  const d = raw && raw.data;
  if (!d || !Array.isArray(d.options)) return null;
  const roots = ROOTS[sym] || [sym], pick = {};
  for (const o of d.options) {
    const x = o && parseOcc(o.option);
    if (x && roots.includes(x.root) && !(x.e in pick && roots.indexOf(pick[x.e]) <= roots.indexOf(x.root))) pick[x.e] = x.root;
  }
  const by = new Map();
  for (const o of d.options) {
    const x = o && parseOcc(o.option);
    if (!x || x.root !== pick[x.e]) continue;
    if (!by.has(x.e)) by.set(x.e, new Map());
    const rows = by.get(x.e);
    if (!rows.has(x.k)) rows.set(x.k, { k: x.k, c: null, p: null });
    rows.get(x.k)[x.cp === "C" ? "c" : "p"] = { b: num(o.bid), a: num(o.ask), iv: num(o.iv), oi: num(o.open_interest) };
  }
  const all = [...by.keys()].sort();
  const out = {};
  for (const e of all) out[e] = [...by.get(e).values()].sort((a, b) => a.k - b.k);
  // 可選的到期日＝至少一檔有買賣報價的（剛掛牌、整條都是 0 的到期日不列；全部都沒報價才照列，前端顯示資料不足）
  const live = all.filter((e) => out[e].some((r) => [r.c, r.p].some((q) => q && q.b > 0 && q.a > 0)));
  const expiries = live.length ? live : all;
  for (const e of all) if (!expiries.includes(e)) delete out[e];
  // 非正規盤（盤前、盤後、週末）current_price 是夜盤／盤前價，選擇權買賣報價卻停在上一個正規盤收盤 → 改用 close，兩邊才是同一時間點
  const off = !regular(raw.timestamp), px = off ? num(d.close) || num(d.current_price) : num(d.current_price) || num(d.close);
  const v = { symbol: sym, price: px || null, off, ts: String(raw.timestamp || ""), last: String(d.last_trade_time || ""), expiries, by: out };
  if (roots.length > 1) v.root = Object.fromEntries(expiries.map((e) => [e, pick[e]]));
  return v;
}

function ymd(ms, tz) {
  const p = {};
  for (const x of new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return p;
}
// CBOE timestamp（UTC）是否在美東正規盤（週一到週五 09:30–16:00）；讀不出＝當作正規盤（照用 current_price）
// shortcut: 不認美股假日（假日白天會當正規盤、用 current_price），要準再接交易所假日表
export function regular(ts) {
  const ms = Date.parse(String(ts || "").replace(" ", "T") + "Z");
  if (!Number.isFinite(ms)) return true;
  const p = ymd(ms, "America/New_York"), wd = new Date(p.year + "-" + p.month + "-" + p.day + "T00:00:00Z").getUTCDay(), hm = Number(p.hour) * 60 + Number(p.minute);
  return wd >= 1 && wd <= 5 && hm >= 570 && hm < 960;
}
// CBOE timestamp（UTC "2026-11-23 01:38:43"）→ 指定時區 "2026-11-23 09:38"；讀不出＝""
export function fmtTs(ts, tz) {
  const ms = Date.parse(String(ts || "").replace(" ", "T") + "Z");
  if (!Number.isFinite(ms)) return "";
  const p = ymd(ms, tz);
  return p.year + "-" + p.month + "-" + p.day + " " + p.hour + ":" + p.minute;
}
// 剩餘天數＝美東今天到到期日的日曆天數；今天到期＝0
export function dte(exp, now = Date.now()) {
  const p = ymd(now, "America/New_York");
  const d = (Date.parse(exp + "T00:00:00Z") - Date.parse(p.year + "-" + p.month + "-" + p.day + "T00:00:00Z")) / 864e5;
  return Number.isFinite(d) ? Math.max(0, Math.round(d)) : null;
}
// 預設到期日＝第一個剩 ≥ 14 天的；都不到就取最後一個
export function defaultExpiry(expiries, now = Date.now()) {
  if (!Array.isArray(expiries) || !expiries.length) return null;
  return expiries.find((e) => dte(e, now) >= 14) || expiries[expiries.length - 1];
}

// ───── 買 Call／買 Put 的到期損益（cp＝"C"｜"P"；prem＝每股權利金；一口＝100 股）─────
const ok = (x) => typeof x === "number" && Number.isFinite(x);
export const intrinsic = (cp, k, S) => (cp === "C" ? Math.max(0, S - k) : Math.max(0, k - S));
export const cost = (prem, n = 1) => prem * 100 * n;
export const pnl = (cp, k, prem, S, n = 1) => (intrinsic(cp, k, S) - prem) * 100 * n;
export const breakeven = (cp, k, prem) => (cp === "C" ? k + prem : k - prem);
export const retPct = (v, c) => (c > 0 ? (v / c) * 100 : null);
// 最多賺：Call 無上限（Infinity）；Put＝股價跌到 0
export const maxGain = (cp, k, prem, n = 1) => (cp === "C" ? Infinity : (k - prem) * 100 * n);
// 口數：整數 ≥ 1（打錯、空白、小於 1 一律當 1）
export function lots(v) {
  const x = Math.floor(Number(v));
  return Number.isFinite(x) && x >= 1 ? x : 1;
}

// 標準常態累積分配（Abramowitz–Stegun 7.1.26，誤差 < 1.5e-7）
export function ncdf(x) {
  if (x === Infinity) return 1;
  if (x === -Infinity) return 0;
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
// 市場估的賺錢機率：Black-Scholes（r＝0）下到期價超過損益兩平的機率（Call 要高於、Put 要低於）；iv／天數 0＝照現價直接判
export function probProfit(cp, S, be, iv, days) {
  if (!ok(S) || S <= 0 || !ok(be)) return null;
  if (be <= 0) return cp === "C" ? 1 : 0;
  const sd = ok(iv) && iv > 0 && ok(days) && days > 0 ? iv * Math.sqrt(days / 365) : 0;
  if (sd === 0) return cp === "C" ? (S > be ? 1 : 0) : (S < be ? 1 : 0);
  const d2 = (Math.log(S / be) - (sd * sd) / 2) / sd;
  return cp === "C" ? ncdf(d2) : ncdf(-d2);
}

// 表格列：該到期日的買權（看漲）或賣權（看跌），只收有報價（買價、賣價都 > 0）且履約價在現價 ±25% 內
export function candidates(rows, cp, price, target, days) {
  if (!Array.isArray(rows) || !ok(price) || price <= 0) return [];
  const out = [];
  for (const r of rows) {
    const q = r && (cp === "C" ? r.c : r.p);
    if (!q || !(q.a > 0) || !(q.b > 0) || Math.abs(r.k / price - 1) > 0.25) continue;
    const c = cost(q.a), be = breakeven(cp, r.k, q.a), v = ok(target) ? pnl(cp, r.k, q.a, target) : null;
    out.push({ k: r.k, cp, ask: q.a, cost: c, pnl: v, ret: v === null ? null : retPct(v, c), prob: probProfit(cp, price, be, q.iv, days), be });
  }
  return out;
}
