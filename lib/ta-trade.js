// 交易規則回測（瀏覽器端，純函式；Yoda 2026-11-09「交易規則控制面板」）
//
//   引擎回應 history（全部 K，前 bars_completed 根＝定案）＋面板參數 → backtest() → trades／open／stats／banner
//   規則正本＝Skill\ta_trade.py（參數化版）；本檔必須與它逐筆一致：
//     python "G:\Yoda x Claude\Skill\tests\ta_trade_parity.py"
//   均線、量比照 pandas 的算法逐位重現：EMA＝ewm(span, adjust=False)；量比＝本根量 ÷ shift(1).rolling(n, min_periods=min(5,n)).mean()
//   （Kahan 加減、同值連續的特例都照抄）；SMA、ATR 是兩邊共用的逐根算法。盤中未定那根不進回測（只用前 nf 根）。
//   整筆進、整筆出，停損固定不動；出場只有：停損、爆量反向K、收破均線、持有到期。

export const WARM = 25;
export const BAD_MIN_N = 8, BAD_WIN_PCT = 25;   // ≥8 筆且（勝率 <25% 或合計 <0）→ 規則不適用
export const DEFAULT_PARAMS = Object.freeze({
  ma: "ema", ma_n: [5, 10, 20], fresh_n: 3, vol_on: true, vol_in: 1.2, vol_n: 10, side_ma: true,
  stop: "low_n", stop_n: 3, stop_pct: 5, atr_n: 14, atr_k: 2, stop_on: "touch",
  exit_ma: true, exit_k: 2, exit_delay: 0, vol_exit: true, vol_out: 2,
  max_hold_on: false, max_hold: 20, dir: "both", fee: 0, slip: 0,
});
// 內建策略（Yoda 2026-11-09；唯讀，面板最上面；名稱只描述規則）。沒寫到的欄位＝DEFAULT_PARAMS。
// tests\ta_trade_parity.py 的 PRESETS 要跟這裡一樣（runner 會輸出這份讓它比）
export const PRESETS = Object.freeze([
  { name: "預設規則", p: {} },
  { name: "短線快出", p: { stop_n: 2, exit_k: 1 } },
  { name: "波段抱長", p: { stop: "atr", atr_n: 14, atr_k: 2, exit_k: 3, exit_delay: 3 } },
  { name: "只做多・固定 5%", p: { stop: "pct", stop_pct: 5, max_hold_on: true, max_hold: 20, dir: "long" } },
  { name: "長線 SMA", p: { ma: "sma", ma_n: [20, 60, 120], stop: "atr", atr_n: 14, atr_k: 3, stop_on: "close", dir: "long" } },
]);
// 數字欄位：[最小, 最大, 整數]
export const LIMITS = {
  ma_n: [2, 250, true], fresh_n: [1, 20, true], vol_in: [0.1, 10], vol_n: [2, 60, true], stop_n: [1, 20, true],
  stop_pct: [0.1, 50], atr_n: [2, 100, true], atr_k: [0.1, 10], exit_delay: [0, 100, true], vol_out: [0.5, 20],
  max_hold: [1, 1000, true], fee: [0, 5], slip: [0, 5],
};
const ENUMS = { ma: ["ema", "sma"], stop: ["low_n", "pct", "atr"], stop_on: ["touch", "close"], dir: ["both", "long", "short"], exit_k: [1, 2, 3] };
const BOOLS = ["vol_on", "side_ma", "exit_ma", "vol_exit", "max_hold_on"];

function num(v, [lo, hi, int]) {
  const x = typeof v === "number" ? v : String(v ?? "").trim() === "" ? NaN : Number(v);
  if (!Number.isFinite(x)) return [null, "要填數字"];
  if (int && !Number.isInteger(x)) return [null, "要填整數"];
  if (x < lo || x > hi) return [null, "範圍 " + lo + "～" + hi];
  return [x, null];
}

// 參數檢查：raw 可以是面板的字串；壞掉的欄位改用 base 的值（預設＝DEFAULT_PARAMS），並在 errors 寫原因。不丟例外。
export function normParams(raw, base = DEFAULT_PARAMS) {
  const r = raw && typeof raw === "object" ? raw : {};
  const p = {}, errors = {};
  for (const k of Object.keys(DEFAULT_PARAMS)) {
    const v = r[k] === undefined ? base[k] : r[k];
    if (k === "ma_n") {
      const a = Array.isArray(v) ? v : [];
      const out = [0, 1, 2].map((j) => num(a[j], LIMITS.ma_n));
      const bad = out.find((x) => x[1]);
      if (bad) { errors.ma_n = bad[1]; p.ma_n = base.ma_n.slice(); }
      else if (!(out[0][0] < out[1][0] && out[1][0] < out[2][0])) { errors.ma_n = "三條要由短到長（第 1 條 < 第 2 條 < 第 3 條）"; p.ma_n = base.ma_n.slice(); }
      else p.ma_n = out.map((x) => x[0]);
    } else if (ENUMS[k]) {
      const x = k === "exit_k" ? Number(v) : v;
      if (ENUMS[k].includes(x)) p[k] = x; else { errors[k] = "選項不對"; p[k] = base[k]; }
    } else if (BOOLS.includes(k)) {
      if (typeof v === "boolean") p[k] = v; else { errors[k] = "選項不對"; p[k] = base[k]; }
    } else {
      const [x, e] = num(v, LIMITS[k]);
      if (e) { errors[k] = e; p[k] = base[k]; } else p[k] = x;
    }
  }
  return { p, errors };
}

// ───── 指標（逐位對 pandas）─────
export function emaPandas(c, n) {
  const a = 1 / (1 + (n - 1) / 2), f = 1 - a, N = c.length, out = new Array(N);
  if (!N) return out;
  let w = c[0], ow = 1;
  out[0] = w;
  for (let i = 1; i < N; i++) {
    const cur = c[i];
    if (w === w) {
      ow *= f;
      if (cur === cur) {
        if (w !== cur) w = (ow * w + a * cur) / (ow + a);
        ow = 1;
      }
    } else if (cur === cur) w = cur;
    out[i] = w;
  }
  return out;
}

export function smaSeq(x, n) {
  const out = new Array(x.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s += x[i];
    if (i >= n) s -= x[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

export function atrSeq(H, L, C, n) {
  const N = C.length, out = new Array(N).fill(NaN);
  if (N < n) return out;
  const tr = [H[0] - L[0]];
  for (let i = 1; i < N; i++) tr.push(Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])));
  let s = 0;
  for (let i = 0; i < n; i++) s += tr[i];
  out[n - 1] = s / n;
  for (let i = n; i < N; i++) out[i] = (out[i - 1] * (n - 1) + tr[i]) / n;
  return out;
}

// pandas window_aggregations.roll_mean（固定窗、Kahan 加減、同值連續直接回該值）
function rollMean(vals, win, minp) {
  const N = vals.length, out = new Array(N);
  let nobs = 0, sum = 0, negCt = 0, compAdd = 0, compRem = 0, same = 0, prev = NaN;
  const add = (v) => {
    if (v !== v) return;
    nobs++;
    const y = v - compAdd, t = sum + y;
    compAdd = t - sum - y; sum = t;
    if (v < 0 || Object.is(v, -0)) negCt++;
    if (v === prev) same++; else same = 1;
    prev = v;
  };
  const rem = (v) => {
    if (v !== v) return;
    nobs--;
    const y = -v - compRem, t = sum + y;
    compRem = t - sum - y; sum = t;
    if (v < 0 || Object.is(v, -0)) negCt--;
  };
  for (let i = 0; i < N; i++) {
    const s = Math.max(0, i + 1 - win), e = i + 1;
    if (i === 0) { prev = vals[s]; same = 0; for (let j = s; j < e; j++) add(vals[j]); }
    else {
      const s0 = Math.max(0, i - win);
      for (let j = s0; j < s; j++) rem(vals[j]);
      add(vals[i]);
    }
    let r = NaN;
    if (nobs >= minp && nobs > 0) {
      r = sum / nobs;
      if (same >= nobs) r = prev;
      else if (negCt === 0 && r < 0) r = 0;
      else if (negCt === nobs && r > 0) r = 0;
    }
    out[i] = r;
  }
  return out;
}

export function volRatio(v, n) {
  const shifted = [NaN, ...v.slice(0, -1)];
  const m = rollMean(shifted, n, Math.min(5, n));
  return v.map((x, i) => x / m[i]);
}

export function maLines(c, p) {
  return p.ma_n.map((n) => (p.ma === "ema" ? emaPandas(c, n) : smaSeq(c, n)));
}

const nums = (a, n) => { const o = new Array(n); for (let i = 0; i < n; i++) o[i] = a[i] == null ? NaN : Number(a[i]); return o; };
const WHY_STOP = "停損", WHY_VOL = "爆量反向K", WHY_HOLD = "持有到期";
export const whyMa = (n) => "收破" + n + "線";
export function legLabel(why) {
  if (why === WHY_VOL) return "爆量反K";
  if (why === WHY_HOLD) return "到期";
  const m = /^收破(\d+)線$/.exec(why || "");
  return m ? "破" + m[1] + "線" : why;
}

// h＝引擎 history {t,o,h,l,c,v}；nf＝定案根數（盤中未定那根不算）；p＝normParams 過的參數
export function backtest(h, nf, p) {
  const N = Math.min(nf, h.c.length);
  const O = nums(h.o, N), H = nums(h.h, N), L = nums(h.l, N), C = nums(h.c, N), V = nums(h.v, N), T = h.t;
  const [M1, M2, M3] = maLines(C, p);
  const XM = [M1, M2, M3][p.exit_k - 1], whyX = whyMa(p.ma_n[p.exit_k - 1]);
  const vr = volRatio(V, p.vol_n);
  const atr = p.stop === "atr" ? atrSeq(H, L, C, p.atr_n) : null;
  const up = new Array(N), dn = new Array(N);
  for (let i = 0; i < N; i++) { up[i] = M1[i] > M2[i] && M2[i] > M3[i]; dn[i] = M1[i] < M2[i] && M2[i] < M3[i]; }
  const sides = [[1, up], [-1, dn]].filter(([s]) => p.dir === "both" || p.dir === (s === 1 ? "long" : "short"));
  const fn = p.fresh_n, sn = p.stop_n, cost = 2 * (p.fee + p.slip);
  const trades = [];
  let pos = null;
  for (let i = WARM; i < N; i++) {
    if (pos) {   // 先查停損（優先），沒碰再看收盤出場；都是整筆出
      const s = pos.side, st = pos.stop, k = i - pos.entry_i;
      const maExit = p.exit_ma && k > p.exit_delay && (s === 1 ? C[i] < XM[i] : C[i] > XM[i]);
      const volExit = p.vol_exit && vr[i] >= p.vol_out && (s === 1 ? C[i] < O[i] && C[i] < M1[i] : C[i] > O[i] && C[i] > M1[i]);
      let hit, px;
      if (p.stop_on === "touch") { hit = s === 1 ? L[i] <= st : H[i] >= st; px = s === 1 ? Math.min(O[i], st) : Math.max(O[i], st); }
      else { hit = s === 1 ? C[i] < st : C[i] > st; px = C[i]; }
      let leg = null;
      if (hit) leg = [px, WHY_STOP];
      else if (volExit || maExit) leg = [C[i], volExit ? WHY_VOL : whyX];
      else if (p.max_hold_on && k >= p.max_hold) leg = [C[i], WHY_HOLD];
      if (leg) {
        let pts = (leg[0] - pos.entry) * s;
        if (cost) pts -= pos.entry * cost / 100;
        trades.push({ ...pos, exit_t: T[i], exit_i: i, exit_px: leg[0], why: leg[1], label: legLabel(leg[1]), pts, pct: pts / pos.entry * 100 });
        pos = null;
        continue;
      }
    }
    if (pos) continue;
    for (const [s, col] of sides) {   // 進場：排列剛成立（前 fresh_n 根不是全部成立）＋本根帶量＋收在第一條線同側
      if (!col[i]) continue;
      let all = true;
      for (let j = i - fn; j < i; j++) if (!col[j]) { all = false; break; }
      if (all) continue;
      if (p.side_ma && !(s === 1 ? C[i] > M1[i] : C[i] < M1[i])) continue;
      if (p.vol_on && !(vr[i] >= p.vol_in)) continue;
      let stop;
      if (p.stop === "low_n") {
        stop = s === 1 ? Infinity : -Infinity;
        for (let j = i - sn + 1; j <= i; j++) stop = s === 1 ? Math.min(stop, L[j]) : Math.max(stop, H[j]);
      } else if (p.stop === "pct") stop = C[i] * (1 - s * p.stop_pct / 100);
      else stop = C[i] - s * p.atr_k * atr[i];
      if (!Number.isFinite(stop) || (C[i] - stop) * s <= 0) continue;
      pos = { side: s, entry: C[i], entry_t: T[i], entry_i: i, stop, vr: vr[i] };
      break;
    }
  }
  const open = pos ? { side: pos.side, entry_t: pos.entry_t, entry: pos.entry, stop: pos.stop, entry_i: pos.entry_i } : null;
  const stats = statsOf(trades, N ? T[0] : null, N ? T[N - 1] : null, N);
  const r2 = (x) => (x == null ? null : Number(x.toFixed(2)));   // 同 Python round(x, 2) 再比門檻
  const bad = stats.n >= BAD_MIN_N && (r2(stats.win_rate) < BAD_WIN_PCT || r2(stats.sum_pct) < 0);
  const banner = {
    bad, min_n: BAD_MIN_N, win_pct: BAD_WIN_PCT,
    text: bad ? "這套規則在這檔的歷史表現不好（" + stats.n + " 筆、勝率 " + r2(stats.win_rate).toFixed(1) + "%、合計 "
      + (stats.sum_pct > 0 ? "+" : "") + r2(stats.sum_pct).toFixed(1) + "%），進出場點不適用" : null,
  };
  // ctx＝浮動說明（explainEntry／explainExit）用的逐根數值；只給畫面，不進比對（parity runner 只取 trades／open／stats／banner）
  return { trades, open, stats, banner, ctx: { O, H, L, C, T, M: [M1, M2, M3], XM, vr, atr, up, dn } };
}

export function statsOf(trades, start, end, bars) {
  let wins = 0, sw = 0, sl = 0, nl = 0, mcl = 0, run = 0, cum = 0, peak = 0, mdd = 0, sumPts = 0, sumPct = 0;
  for (const t of trades) {
    if (t.pts > 0) { wins++; sw += t.pct; run = 0; } else { nl++; sl += t.pct; run++; }
    mcl = Math.max(mcl, run);
    cum += t.pct; peak = Math.max(peak, cum); mdd = Math.max(mdd, peak - cum);
    sumPts += t.pts; sumPct += t.pct;
  }
  const n = trades.length, aw = wins ? sw / wins : null, al = nl ? sl / nl : null;
  return {
    n, wins, win_rate: n ? wins / n * 100 : null, sum_pts: sumPts, sum_pct: sumPct, avg_win_pct: aw, avg_loss_pct: al,
    max_consec_loss: mcl, mdd_pct: mdd, payoff: aw !== null && al !== null && al < 0 ? aw / -al : null,
    start, end, bars, n_long: trades.filter((t) => t.side === 1).length, n_short: trades.filter((t) => t.side === -1).length,
  };
}

// 圖上記號：k0＝圖的第一根在 history 的位置；i=-1＝在圖左邊（線從左緣畫、不畫箭頭）；i1=null＝延伸到右緣
export function chartMarks(res, k0) {
  const markers = [], lines = [];
  const ix = (i) => (i < k0 ? -1 : i - k0);
  const entry = (t, ie) => { if (ie >= 0) markers.push({ kind: "entry", i: ie, side: t.side, px: t.entry, label: t.side === 1 ? "多進" : "空進" }); };
  for (const t of res.trades) {
    const ie = ix(t.entry_i), iz = ix(t.exit_i);
    if (iz < 0) continue;
    lines.push({ kind: "stop", i0: ie, i1: iz, y: t.stop });
    entry(t, ie);
    markers.push({ kind: "exit", i: iz, side: t.side, px: t.exit_px, why: t.why, label: t.label, tone: t.why === WHY_STOP ? "stop" : "exit" });
  }
  const o = res.open;
  if (o) {
    const ie = ix(o.entry_i);
    lines.push({ kind: "open_stop", i0: ie, i1: null, y: o.stop });
    lines.push({ kind: "open_entry", i0: ie, i1: null, y: o.entry });
    entry(o, ie);
  }
  return { markers, lines };
}

// 圖上的出場線（面板選的那條均線；全部 K 含盤中未定那根，從 k0 切）
export function exitLine(h, p, k0) {
  if (!p.exit_ma) return null;
  const c = nums(h.c, h.c.length);
  const a = maLines(c, p)[p.exit_k - 1];
  return a.slice(k0).map((x) => (Number.isFinite(x) ? x : null));
}

// ───── 白話規則（由參數產生；④ 分頁頂端與圖例用）─────
const fx = (x) => String(Number(Number(x).toFixed(4)));
export function maName(p, k) { return (p.ma === "ema" ? "EMA" : "SMA") + p.ma_n[k - 1]; }
export function ruleText(p) {
  const M = p.ma === "ema" ? "EMA" : "SMA";
  const dir = { both: "多空都做（多頭排列做多、空頭排列做空）", long: "只做多（空頭排列不進場）", short: "只做空（多頭排列不進場）" }[p.dir];
  const entry = M + p.ma_n.join("／") + " 排列剛成立（本根排好、前 " + p.fresh_n + " 根還沒全排好）"
    + (p.vol_on ? "＋量比 ≥" + fx(p.vol_in) + "（本根量 ÷ 前 " + p.vol_n + " 根均量）" : "（不看量）")
    + (p.side_ma ? "＋收在 " + maName(p, 1) + " 同側" : "") + "＝收盤進場；" + dir + "。";
  const base = {
    low_n: "進場時近 " + p.stop_n + " 根的最低點（空單最高點）",
    pct: "進場價往不利方向 " + fx(p.stop_pct) + "%",
    atr: "進場價往不利方向 " + fx(p.atr_k) + " 倍 ATR" + p.atr_n,
  }[p.stop];
  const stop = "停損＝" + base + "，抱著的期間都不動；"
    + (p.stop_on === "touch" ? "盤中碰到就整筆出（跳空越過時用開盤價）。" : "收盤破（空單收盤站上）才整筆出、用收盤價。");
  const ex = [];
  if (p.exit_ma) ex.push("收盤破 " + maName(p, p.exit_k) + "（空單站上）整筆出" + (p.exit_delay ? "（進場後先放 " + p.exit_delay + " 根不看，第 " + (p.exit_delay + 1) + " 根起才看）" : "（進場後下一根就開始看）"));
  if (p.vol_exit) ex.push("爆量反向 K（量比 ≥" + fx(p.vol_out) + "、收反向 K、收破 " + maName(p, 1) + "）整筆出");
  if (p.max_hold_on) ex.push("抱滿 " + p.max_hold + " 根還沒出，就在第 " + p.max_hold + " 根收盤整筆出");
  const exit = (ex.length ? "沒碰停損時：" + ex.join("；") + "。" : "沒有其他出場條件，只靠停損出場。") + "同一根同時碰停損和其他出場，算停損。";
  const cost = p.fee || p.slip
    ? "每筆報酬扣 " + fx(2 * (p.fee + p.slip)) + " 個百分點（手續費 " + fx(p.fee) + "%＋滑價 " + fx(p.slip) + "%，進出各算一次）。"
    : "未計手續費與滑價。";
  return { entry, stop, exit, cost };
}

// ───── 圖上記號的浮動說明（滑過／點進出場記號）：用 backtest 的 ctx 寫出實際數值 ─────
export const fpx = (x) => (x == null || !Number.isFinite(Number(x)) ? "—" : Number(x).toLocaleString("en-US", { maximumFractionDigits: 2 }));
const fr2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "—");
export const fpc = (x) => (Number.isFinite(x) ? (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(1) + "%" : "—");
const SIDE = (s) => (s === 1 ? "多單" : "空單");

// e＝一筆交易或 open（side、entry_i、entry、entry_t、stop）→ {title, sub, rows:[[項目, 內容]]}
export function explainEntry(res, p, e) {
  const { C, M, vr, atr, T, up, dn } = res.ctx, i = e.entry_i, s = e.side;
  const gt = s === 1 ? " ＞ " : " ＜ ", col = s === 1 ? up : dn;
  let miss = 0;
  for (let j = i - p.fresh_n; j < i; j++) if (!col[j]) miss++;
  const rows = [
    ["排列", [0, 1, 2].map((k) => maName(p, k + 1) + " " + fpx(M[k][i])).join(gt) + "（" + (s === 1 ? "多頭" : "空頭") + "排列）"],
    ["剛成立", "前 " + p.fresh_n + " 根有 " + miss + " 根還沒排好，本根才排好"],
    ["量比", p.vol_on ? fr2(vr[i]) + " ≥ 門檻 " + fx(p.vol_in) + "（本根量 ÷ 前 " + p.vol_n + " 根均量）" : "不看量（本根量比 " + fr2(vr[i]) + "）"],
  ];
  if (p.side_ma) rows.push(["收盤", fpx(C[i]) + gt + maName(p, 1) + " " + fpx(M[0][i])]);
  const basis = {
    low_n: "進場時近 " + p.stop_n + " 根（含進場根）的" + (s === 1 ? "最低點" : "最高點"),
    pct: "進場價" + (s === 1 ? "往下 " : "往上 ") + fx(p.stop_pct) + "%",
    atr: "ATR" + p.atr_n + " " + fpx(atr && atr[i]) + " × " + fx(p.atr_k) + " 倍 ＝ " + fpx(atr && atr[i] * p.atr_k),
  }[p.stop];
  rows.push(["停損", fpx(e.stop) + "（" + basis + "；" + (p.stop_on === "touch" ? "盤中碰到就出" : "收盤破才出") + "）"]);
  rows.push(["風險", (Math.abs(e.entry - e.stop) / e.entry * 100).toFixed(2) + "%（進場價到停損的距離）"]);
  return { title: SIDE(s) + "進場", sub: T[i] + "　成交 " + fpx(e.entry) + "（收盤價）", rows };
}

// t＝一筆已出場的交易 → {title, sub, rows}
export function explainExit(res, p, t) {
  const { O, H, L, C, T, M, XM, vr } = res.ctx, i = t.exit_i, s = t.side, k = i - t.entry_i;
  const lt = s === 1 ? " ＜ " : " ＞ ", rows = [];
  if (t.why === WHY_STOP) {
    const gap = p.stop_on === "touch" && (s === 1 ? O[i] < t.stop : O[i] > t.stop);
    rows.push(["原因", p.stop_on === "close" ? "停損：收盤 " + fpx(C[i]) + lt + "停損 " + fpx(t.stop) + "（收盤破，用收盤價成交）"
      : gap ? "停損：開盤 " + fpx(O[i]) + " 已跳空越過停損 " + fpx(t.stop) + "（用開盤價成交）"
        : "停損：盤中" + (s === 1 ? "最低 " + fpx(L[i]) : "最高 " + fpx(H[i])) + " 碰到停損 " + fpx(t.stop) + "（用停損價成交）"]);
  } else {
    const why = [];
    const volX = p.vol_exit && vr[i] >= p.vol_out && (s === 1 ? C[i] < O[i] && C[i] < M[0][i] : C[i] > O[i] && C[i] > M[0][i]);
    const maX = p.exit_ma && k > p.exit_delay && (s === 1 ? C[i] < XM[i] : C[i] > XM[i]);
    if (volX) why.push("爆量反向 K：量比 " + fr2(vr[i]) + " ≥ " + fx(p.vol_out) + "、收" + (s === 1 ? "黑" : "紅") + " K（開 " + fpx(O[i]) + " → 收 "
      + fpx(C[i]) + "）、收盤" + lt + maName(p, 1) + " " + fpx(M[0][i]));
    if (maX) why.push("收盤 " + fpx(C[i]) + lt + "出場線 " + maName(p, p.exit_k) + " " + fpx(XM[i]) + (p.exit_delay ? "（進場後第 " + (p.exit_delay + 1) + " 根起才看）" : ""));
    if (t.why === WHY_HOLD) why.push("最多持有 " + p.max_hold + " 根到期，收盤出場");
    why.forEach((w, j) => rows.push([j ? "也成立" : "原因", w]));
  }
  rows.push(["進場", T[t.entry_i] + "　" + fpx(t.entry)]);
  rows.push(["持有", k + " 根"]);
  const cost = 2 * (p.fee + p.slip);
  rows.push(["報酬", fpc(t.pct) + (cost ? "（已扣成本 " + fx(cost) + " 個百分點）" : "")]);
  return { title: SIDE(s) + "出場", sub: T[i] + "　成交 " + fpx(t.exit_px), rows };
}
