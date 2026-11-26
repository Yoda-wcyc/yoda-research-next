"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { dte, fmtTs } from "../../lib/ta-opt";
import { calc, checkStruct, checkGlobal, nearExp, nearPut, atmIv, b76Put, putDelta, ivUp, futOf, XS } from "../../lib/ta-short";

// /ta「選擇權 → 作空試算」子分頁（2026-11-26 Yoda）：範本 demo\ta_選擇權作空試算_demo.html；數字全在 lib/ta-short.js
// Yoda 11-26：這個技術分析網站是自己要看的、只對這個子分頁放寬（可以有價差、Theta、轉倉、指引卡，不放尾句）。原本的選擇權試算（page.jsx OptView）不動。
// 報價走 /api/ta-opt（CBOE 延遲）：XND 借 NDX ÷ 100；NQ／MNQ 沒有報價 → Black-76 估（期貨價＝NDX × e^(r·T)，IV 預設 QQQ 價平 IV）
// props：call／gate＝page.jsx 的同名函式；SortTable＝page.jsx 的可排序表格
const SY = {
  QQQ: { k: "eq", m: 100, spec: "合約：每口 100 股；美式（可提前履約），履約時交割 QQQ 股票。標的 Invesco QQQ，追蹤那斯達克 100。" },
  SMH: { k: "eq", m: 100, spec: "合約：每口 100 股；美式，履約時交割 SMH 股票。標的 VanEck 半導體 ETF。" },
  SOXX: { k: "eq", m: 100, spec: "合約：每口 100 股；美式，履約時交割 SOXX 股票。標的 iShares 半導體 ETF（Burry 2023 年申報過它的賣權）。" },
  NQ: { k: "fut", m: 20, spec: "合約：E-mini 那斯達克 100 期貨選擇權（CME），每點 20 美元；履約後變成一口 NQ 期貨。標的是到期日之後最近的季月期貨（3／6／9／12 月）。" },
  MNQ: { k: "fut", m: 2, spec: "合約：Micro E-mini 那斯達克 100 期貨選擇權（CME），每點 2 美元（NQ 的 1/10）；履約後變成一口 MNQ 期貨。" },
  NDX: { k: "idx", m: 100, spec: "合約：那斯達克 100 指數選擇權（Cboe），每點 100 美元；現金交割、歐式（不能提前履約）。代號 NDX＝到期日開盤結算（AM），NDXP＝收盤結算（PM）。" },
  XND: { k: "idx", m: 100, spec: "合約：Nasdaq-100 Micro 指數選擇權（XND），指數＝NDX 的 1/100、每點 100 美元（等於 NDX 每點 1 美元）；現金交割、歐式、收盤結算。" },
  NVDA: { k: "eq", m: 100, spec: "合約：每口 100 股；美式，履約時交割 NVDA 股票。" },
};
const ORDER = ["QQQ", "SMH", "SOXX", "NQ", "MNQ", "NDX", "XND", "NVDA"];
const SYM_KEY = "yoda_ta_short_sym", CK_KEY = "yoda_ta_short_batch";
const srcOf = (s) => (s === "XND" || SY[s].k === "fut" ? "NDX" : s);
const NAMES = ["① 長天期價外賣權", "② 賣權價差", "③ 短天期滾動"], COLORS = ["var(--accent)", "var(--orange)", "var(--sh-purple)"];
const DEF = { cap: "1000000", bp: "5", rf: "4.0", ivA: "10", ivB: "25", nqiv: "", k1: "80", k2a: "90", k2b: "65", k3: "90", e1: "", e2: "", e3: "" };
const DEF_DAYS = [182, 182, 91];
let FORM0 = null;          // 切回原試算再切回來，輸入還在（這個分頁的記憶體）
let IV_SEEDED = false;     // NQ／MNQ 估算 IV 已用 QQQ 價平 IV 預填過
export const MEMO = {};    // 代號 → {base, by:{到期日: rows}}；shortcut: 抓到就留著，要新報價重新整理頁面

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
const rnd = (v) => Math.round(v);
const usd = (v) => (rnd(v) < 0 ? "−" : "") + "$" + Math.abs(rnd(v)).toLocaleString("en-US");
const sgn = (v) => (rnd(v) > 0 ? "+" : rnd(v) < 0 ? "−" : "") + "$" + Math.abs(rnd(v)).toLocaleString("en-US");
const ud = (v) => (rnd(v) > 0 ? "up" : rnd(v) < 0 ? "dn" : "");
const pct = (v, d = 1) => (Number.isFinite(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + "%" : "—");
const fx = (v, d = 2) => (+v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const kx = (K) => fx(K, K < 1000 && K % 1 ? 2 : 0);
const Tip = ({ t, children }) => <span className="ta-tip ta-sh-i" title={t}>{children}</span>;
const Sw = ({ i }) => <span className="ta-sh-sw" style={{ background: COLORS[i] }} />;

// 接檢查表分批：11-25 快照（每日條件分數帳本另一軌在做，接好再換成即時）
const CK_DATE = "11-25";
const CK = [
  { it: "股債溢價落在兩季前 10%", now: "兩個口徑都列：FactSet 日頻 +0.99（兩季前 10%）、長歷史口徑 −0.89（兩季前 10%，成立；Shiller trailing E 延後 3 個月，延後 5 個月 −1.19 也成立）。長歷史「創兩季新高」11-05、11-20 觸發過，今天不成立。Shiller 新版最近幾個月 E 可能含 S&P 預估，有輕微估計污染", st: 2, gr: "長歷史口徑：「創兩季新高」SPX 有效但 2012 年後失效、NDX 偏有效；「前 10%」SPX／NDX／TWII 偏有效。FactSet 口徑：資料不足", g: 3 },
  { it: "HY 利差從兩季高點回落 ≥30bp", now: "3.72%（11/20 高點 3.76%），只回落 4bp；要 ≤3.46% 才成立", st: 0, gr: "NDX 有效、台股偏有效、SPX 無效（50bp 版 NDX、台股有效）", g: 3 },
  { it: "NQ 4H 恐慌爆量", now: "11-03、11-05、11-20 出現（創 20 根新低、量 ≥2 倍、收在下半部）；11-25 沒有", st: 1, gr: "NQ 4H 有效（之後 5～10 根偏漲；20 根不顯著）、ES 4H 偏有效", g: 3 },
  { it: "十年期殖利率從 10/5 高點回落 ≥50bp", now: "已回落 46bp，差 4bp", st: 1, gr: "未回測", g: 0 },
  { it: "美元指數從高點回落確認", now: "11/23 高點 104.32 未確認，約 100.15 才算", st: 0, gr: "未回測", g: 0 },
  { it: "BTC 與黃金同步止跌", now: "11/20 同日低點，還沒確認", st: 0, gr: "未回測", g: 0 },
  { it: "#11 多：指數在高點附近、新低家數偏多", warn: "頂部警訊，不是止跌訊號", now: "不成立：指數離高點遠（NDX 離一年高點 −16.6%）", st: 0, gr: "NDX 有效、台股有效（只在 20 日）、SPX 偏有效；這裡的「有效」是之後偏跌：NDX 之後 20 日中位數 −0.90%，同樣在高點附近的日子 +1.27%", g: 3 },
];
const ST = ["未亮", "接近／亮過", "亮"];

export default function ShortView({ call, gate, SortTable }) {
  const [sym, setSymS] = useState(() => { const s = lsGet(SYM_KEY); return ORDER.includes(s) ? s : "QQQ"; });
  const [f, setF] = useState(() => FORM0 || DEF);
  const [db, setDb] = useState(() => ({ ...MEMO }));
  const [err, setErr] = useState({});          // 代號 → 錯誤字
  const [ckv, setCkv] = useState({});
  const tgt = useRef(DEF_DAYS.slice());          // 換標的時保留三個到期日的天數
  const burry = useRef({});
  useEffect(() => { FORM0 = f; }, [f]);
  useEffect(() => { try { setCkv(JSON.parse(lsGet(CK_KEY) || "{}") || {}); } catch (e) {} }, []);
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const put = (s, v) => { MEMO[s] = { ...(MEMO[s] || {}), ...v, by: { ...((MEMO[s] || {}).by || {}), ...(v.by || {}) } }; setDb({ ...MEMO }); };

  const def = SY[sym], fut = def.k === "fut", src = srcOf(sym), sc = sym === "XND" ? 0.01 : 1;
  const need = fut ? [src, "QQQ"] : [src];
  // ① 每個要用的代號抓一次（到期日清單＋價平 IV 用的預設到期日）
  useEffect(() => {   // err[s]：「…」＝抓取中、其他字＝失敗（按重試清掉才再抓）；結果收進 MEMO，換標的途中回來的也照收
    for (const s of need) {
      if ((db[s] && db[s].base) || err[s]) continue;
      setErr((e) => ({ ...e, [s]: "…" }));
      call("/api/ta-opt", { symbol: s }).then((j) => {
        if (gate(j)) { setErr((e) => ({ ...e, [s]: "" })); return; }
        if (j.ok) { put(s, { base: j, by: { [j.expiry]: j.rows } }); setErr((e) => ({ ...e, [s]: "" })); }
        else setErr((e) => ({ ...e, [s]: j.error || "讀取失敗" }));
      });
    }
  }, [need.join(","), db, err, call, gate]);   // eslint-disable-line react-hooks/exhaustive-deps

  const base = db[src] && db[src].base, by = (db[src] && db[src].by) || {};
  const list = useMemo(() => {
    if (!base) return [];
    const rt = base.root || {};
    return base.expiries.filter((e) => !fut || rt[e] === "NDX").map((e) => ({ e, n: dte(e), root: rt[e], fut: fut ? futOf(e) : null })).filter((x) => x.n >= 1);
  }, [base, fut]);
  // ② 到期日不在清單（第一次、換標的）＝取天數最接近的（直接算，不另存，第一次畫就有）
  const E = {};
  ["e1", "e2", "e3"].forEach((k, i) => { E[k] = list.some((x) => x.e === f[k]) ? f[k] : list.length ? nearExp(list, tgt.current[i]).e : ""; });
  // ③ 選到的到期日還沒有報價列 → 一次抓（伺服器 60 秒快取，CBOE 只打一次）
  const miss = [...new Set([E.e1, E.e2, E.e3])].filter((e) => e && list.some((x) => x.e === e) && !by[e]);
  const missKey = src + "|" + miss.join(",");
  useEffect(() => {
    if (!miss.length || err[src]) return;   // 失敗後等重試（清掉 err）才再抓
    call("/api/ta-opt", { symbol: src, expiries: miss }).then((j) => {
      if (gate(j)) return;
      if (j.ok) put(src, { by: j.by || {} }); else setErr((e) => ({ ...e, [src]: j.error || "讀取失敗" }));
    });
  }, [missKey, err[src]]);   // eslint-disable-line react-hooks/exhaustive-deps
  // NQ／MNQ 估算 IV 預設＝QQQ 價平 IV（使用者改過就不蓋）
  const qb = db.QQQ && db.QQQ.base;
  const qIv = qb ? atmIv(qb.rows, qb.price) : null;
  // 只回填一次（審查 3a0dc3a：清空後不再被填回）
  useEffect(() => { if (!fut || IV_SEEDED || !qIv) return; IV_SEEDED = true; if (f.nqiv === "") set("nqiv", (qIv * 100).toFixed(2)); }, [fut, qIv]);   // eslint-disable-line react-hooks/exhaustive-deps

  const setSym = (k) => {
    if (k === sym) return;
    tgt.current = ["e1", "e2", "e3"].map((id, i) => { const x = list.find((y) => y.e === E[id]); return x ? x.n : DEF_DAYS[i]; });
    const nx = { e1: "", e2: "", e3: "" };
    if (burry.current.e1) tgt.current[0] = DEF_DAYS[0];
    if (burry.current.k1) nx.k1 = DEF.k1;   // Burry 那組只屬於 NVDA，離開就把沒手動改過的欄位回預設
    burry.current = {};
    setF((o) => ({ ...o, ...nx })); setSymS(k); lsSet(SYM_KEY, k);
  };
  const inp = (k) => (e) => { delete burry.current[k]; set(k, e.target.value); };

  // ───── 計算 ─────
  const r = (+f.rf || 0) / 100, S = base ? base.price * sc : null, ndx = fut && base ? base.price : null;
  const tick = fut ? 0.25 : 0.01, unit = fut ? " 點" : " 美元";
  const exOf = (e) => list.find((x) => x.e === e);
  const leg = (ex, p) => {
    if (!ex || !(p >= 30 && p <= 105)) return null;
    if (fut) {
      if (!ex.fut) return null;
      const F = ndx * Math.exp((r * dte(ex.fut.fe)) / 365), K = Math.round((F * p) / 100 / 50) * 50, iv = (+f.nqiv || 0) / 100;
      const rl = nearPut(by[ex.e], (K / F) * ndx), ref = rl && Math.abs(rl.K / ((K / F) * ndx) - 1) < 0.03 ? rl.iv : null;
      return { K, iv, mid: b76Put(F, K, ex.n / 365, iv, r), est: 1, S0: F, ref };
    }
    const l = nearPut(by[ex.e], (S * p) / 100, sc);
    return l && { ...l, S0: S };
  };
  const defs = [["e1", ["k1"]], ["e2", ["k2a", "k2b"]], ["e3", ["k3"]]];
  const gErr = base ? checkGlobal({ ...f, fut }) : [];
  const sts = defs.map(([ek, ks], i) => {
    const ex = exOf(E[ek]);
    const legs = ks.map((k, j) => { const l = leg(ex, +f[k]); return l && { ...l, q: j ? -1 : 1 }; });
    const e = !ex ? [NAMES[i] + "：讀取中"] : !fut && !by[ex.e] ? [NAMES[i] + "：報價讀取中"] : checkStruct(NAMES[i], legs, ex.n, tick, unit);
    return { ex, legs, e, st: e.length ? null : { legs, n: ex.n, S0: legs[0].S0, e: ex.e } };
  });
  const cap = +f.cap, B = (cap * +f.bp) / 100;
  const ctx = { m: def.m, r, fut, ivA: (+f.ivA || 0) / 100, ivB: (+f.ivB || 0) / 100 };
  const res = sts.map((x) => (gErr.length || !x.st ? null : calc(x.st, cap, B, ctx)));
  const ivBad = fut && !(+f.nqiv > 0);   // 估算 IV 不對時「權利金是 0」是同一個原因，不重複列
  const errs = [...gErr, ...sts.flatMap((x) => x.e.filter((s) => !s.endsWith("讀取中") && !(ivBad && s.includes("權利金是 0"))))];
  const mny = (l) => pct((l.K / l.S0 - 1) * 100);
  const futName = (ex) => (sym === "MNQ" ? "MNQ" : "NQ") + ex.fut.code;
  const legTxt = (ex, l, p) => {
    if (!(p >= 30 && p <= 105)) return "履約價要在現價的 30%～105% 之間";
    if (!ex || (!fut && !by[ex.e])) return "讀取中…";
    if (!l) return "資料不足：這個到期日沒有報價";
    const dl = putDelta(fut, l.S0, l.K, ex.n / 365, l.iv, r).toFixed(2);
    if (l.est) return `履約價 ${fx(l.K, 0)}（比 ${futName(ex)} ${mny(l)}）｜估算 ${fx(l.mid)} 點｜IV ${(l.iv * 100).toFixed(1)}%｜Delta ${dl}` + (l.ref ? `｜NDX 同條件報價 IV ${(l.ref * 100).toFixed(1)}%` : "");
    return `履約價 ${kx(l.K)}（${mny(l)}）｜買 ${fx(l.b)}／賣 ${fx(l.a)}｜中價 ${fx(l.mid)}｜IV ${(l.iv * 100).toFixed(1)}%｜Delta ${dl}｜未平倉 ${l.oi.toLocaleString("en-US")}`;
  };
  const expLabel = (x) => `${x.e}（剩 ${x.n} 天）` + (sym === "XND" ? "｜借 " + x.root + (x.root === "NDX" ? "（AM 結算）" : "") + " 報價" : sym === "NDX" && x.root === "NDXP" ? " NDXP" : "") + (x.fut ? " → " + futName(x) : "");
  const burryGo = () => {
    burry.current = { e1: 1, k1: 1 };
    const ex = list.find((x) => x.e === "2027-01-15") || list.find((x) => x.e.startsWith("2027-01"));
    setF((o) => ({ ...o, ...(ex ? { e1: ex.e } : {}), k1: ((115 / S) * 100).toFixed(2) }));
  };

  // ───── 表格欄 ─────
  const rows = res.map((o, i) => ({ i, o, st: sts[i].st }));
  const nm = (x) => <><Sw i={x.i} />{NAMES[x.i]}</>;
  const v = (fn, srt) => ({ render: (x) => (x.o ? fn(x.o, x.st) : "—"), sort: (x) => (x.o ? srt(x.o) : null), num: 1 });
  const colsA = [
    { label: "結構", render: (x) => <>{nm(x)}<small>{x.st ? `${x.st.e}（${x.st.n} 天）${x.st.legs.map((l) => (l.q > 0 ? "買 " : "賣 ") + kx(l.K)).join("／")} P` : <span className="warn">資料不足或輸入有誤，見上方</span>}</small></>, sort: (x) => x.i },
    { label: "口數", ...v((o) => <>{o.N.toLocaleString("en-US")}{o.demo ? <small className="warn">預算不夠，以 1 口示意</small> : null}</>, (o) => o.N) },
    { label: <Tip t="買一次（口數 × 每口權利金 × 合約乘數）。用 CBOE 延遲報價的買賣中價；NQ／MNQ 是估算。">每次成本</Tip>, ...v((o) => <>{usd(o.cost)}<small>每口 {usd(o.costC)}</small></>, (o) => o.cost) },
    { label: "一年換幾次", ...v((o) => o.cycles + " 次", (o) => o.cycles) },
    { label: <Tip t="假設每次換倉的價錢都跟今天一樣、每次都到期歸零，一年總共花掉的錢。這不是最大虧損：標的有跌但一直沒跌破履約價時，每張都歸零，換倉時 IV 又比較高、新買的更貴，會虧得比這格多，見「試算最大虧損」。">沒崩一年花掉</Tip>, ...v((o) => <span className="dn">{sgn(-o.annual)}</span>, (o) => o.annual) },
    { label: "占總資金", ...v((o) => <>{((o.annual / cap) * 100).toFixed(2)}%{o.demo ? <small className="warn">買 1 口要總資金 {usd(o.need)}</small> : null}</>, (o) => o.annual / cap) },
    { label: <Tip t="本頁模型裡最差的一格：12 個月內跌 0%～60%（每 1% 算一次，就是下面那張圖）、6 個月跌 20%、沒崩全部歸零，取虧最多的那個，小字標它出現在哪個情境。跌勢走法、IV 加點跟情境表同一套假設；換一套走法（例如先漲再跌、IV 加更多）可能虧更多。">試算最大虧損</Tip>, ...v((o) => <><span className={ud(o.worst)}>{sgn(o.worst)}</span><small>{o.worstAt}</small></>, (o) => o.worst) },
    { label: <Tip t="第一次買的部位，到期時最多賺多少。單買賣權＝標的跌到 0；價差＝跌破賣出那腳之後就不再多賺。">最大獲利（單次）</Tip>, ...v((o) => <span className="up">{sgn(o.maxG)}</span>, (o) => o.maxG) },
    { label: <Tip t="第一次買的部位持有到到期，標的要跌到這裡才回本（買進履約價 − 淨權利金）。">損益兩平</Tip>, ...v((o, st) => <>{kx(o.be)}{fut ? " 點" : ""}<small>比{fut ? " " + futName(exOf(st.e)) + " " : "現價 "}{pct((o.be / st.S0 - 1) * 100)}</small></>, (o) => o.be) },
    { label: <Tip t="其他條件不變，多過一天、整個部位價值少多少（Black-Scholes／Black-76 算今天與明天的差，IV 不變）。">Theta／天</Tip>, ...v((o) => <span className={ud(o.theta)}>{sgn(o.theta)}</span>, (o) => o.theta) },
    { label: <Tip t="整個部位的 Delta × 合約乘數：標的（期貨）每漲 1 點，部位價值變多少美元。">Delta（每 1 點）</Tip>, ...v((o) => sgn(o.delta), (o) => o.delta) },
  ];
  const SCN = ["6 個月跌 20%", "12 個月跌 35%", "12 個月腰斬 −50%", "沒崩、到期歸零"];
  const colsB = [
    { label: "結構", render: (x) => <>{nm(x)}{x.o ? <small>{x.o.N.toLocaleString("en-US")} 口，一年換 {x.o.cycles} 次</small> : null}</>, sort: (x) => x.i },
    ...SCN.map((label, j) => ({ label, ...v((o) => <><span className={ud(o.sc[j])}>{sgn(o.sc[j])}</span><small>占總資金 {pct((o.sc[j] / cap) * 100, 2)}</small></>, (o) => o.sc[j]) })),
  ];
  const ckRows = CK.map((c, i) => ({ ...c, i }));
  const ckNum = (i) => { const x = +ckv[i] || 0; return x < 0 ? 0 : x; };
  const ckSum = CK.reduce((a, _, i) => a + ckNum(i), 0);
  const setCk = (i, val) => { const nx = { ...ckv, [i]: val }; setCkv(nx); lsSet(CK_KEY, JSON.stringify(nx)); };
  const colsC = [
    { label: "項目", render: (c) => <>{c.it}{c.warn ? <small className="warn">{c.warn}</small> : null}</>, sort: (c) => c.it, cls: "l" },
    { label: "目前（" + CK_DATE + "）", render: (c) => c.now, sort: (c) => c.now, cls: "l" },
    { label: "狀態", render: (c) => <span className={"ta-sh-pill" + (c.st === 2 ? " on" : c.st === 1 ? " near" : "")}>{ST[c.st]}</span>, sort: (c) => c.st, num: 1 },
    { label: <Tip t="檢查表回測（2026-11-26）。有效＝方向對、20 日 p<0.05、去重後 ≥8 次；偏有效＝方向對、p<0.15（次數少時 p<0.3，標事件少）；無效＝跟同情境的一般日子沒差或方向反；未回測＝這一輪沒做。">回測分級</Tip>, render: (c) => c.gr, sort: (c) => c.g, cls: "l" },
    { label: "這批金額（美元）", render: (c) => <input type="number" className="ta-q ta-sh-amt" min="0" step="1000" value={ckv[c.i] || ""} placeholder="自己填" onChange={(e) => setCk(c.i, e.target.value)} aria-label={"這批金額：" + c.it} />, sort: (c) => ckNum(c.i), num: 1 },
    { label: "占總資金", render: (c) => (+ckv[c.i] < 0 ? <span className="warn">不能是負的，不計入</span> : ckNum(c.i) && cap > 0 ? ((ckNum(c.i) / cap) * 100).toFixed(1) + "%" : ""), sort: (c) => ckNum(c.i), num: 1 },
  ];

  const anyErr = need.map((s) => err[s]).find((x) => x && x !== "…");
  const ts = base ? fmtTs(base.ts, "Asia/Taipei") : "";
  const note = fut ? "沒有期貨選擇權報價：權利金全部用 Black-76、所有履約價同一個 IV 估出來（預設＝QQQ 價平 IV）。各到期對應的季月期貨價＝NDX 現價 × e^(無風險利率 × 到期天數)，沒扣股利；實際買賣價差、波動率微笑都沒算進去，價外賣權實際 IV 通常比較高，每腳附 NDX 同到期、同價外程度的報價 IV 對照。"
    : sym === "XND" ? "XND 自己的 CBOE 報價停在 11-20 收盤、跟其他標的不同時間，所以這頁用 NDX 報價 ÷ 100 換算；XND 實際成交量小、買賣價差通常比 NDX 寬。到期選單標「借 NDX（AM 結算）」的那幾天，NDX 是開盤結算、XND 是收盤結算，結算價會不一樣；XND 實際有沒有掛這些到期日，本頁沒查。"
    : sym === "NDX" ? "報價含 NDX（AM 結算月選）與 NDXP（PM 結算）兩種代號，到期選單上標 NDXP 的是後者。指數不配息但成分股有，本頁 Black-Scholes 沒放股利，價外賣權估值會略低於報價。"
    : "美式選擇權可以提前履約，本頁 Black-Scholes 是歐式公式、也沒放股利，深價內時會略低估。";

  return (
    <div className="ta-sh">
      <div className="ta-seg ta-sh-sym" role="group" aria-label="標的">
        {ORDER.map((k) => <button key={k} type="button" aria-pressed={k === sym} className={"ta-tab" + (k === sym ? " on" : "")} onClick={() => setSym(k)} data-s={k}>{SY[k].k === "fut" ? k + " 期貨" : k}</button>)}
      </div>
      <div className="ta-sh-meta">
        <span>{sym}{fut ? <><span className="mut">（期貨價由 NDX 估）</span><span className="ta-sh-est">估算，非報價</span></> : null}</span>
        {S ? <b className="mono">{fx(fut ? ndx : S)}</b> : null}
        {fut && S ? <span className="mut">NDX 現價</span> : null}
        {base ? <span className="mut">CBOE 延遲報價（約 15 分鐘）｜資料時間 {ts || "—"}（台灣）{base.off ? "｜非正規盤時段，用上一個正規盤收盤價" : ""}</span> : null}
      </div>
      <p className="ta-sh-spec">{def.spec}</p>
      <p className="ta-notes">{note}</p>
      {anyErr ? <div className="ta-err" role="alert"><span>{anyErr.startsWith("資料不足") ? anyErr : "資料不足：" + anyErr}</span><button type="button" className="ta-btn" onClick={() => setErr({})}>重試</button></div>
        : !base ? <div className="ta-ph">讀取中…</div> : (
        <>
          <div className="ta-cap">情境：AI 泡沫破裂、指數一年內腰斬<span className="mut">三種結構都用同一筆年保險費預算；標 ⓘ 的字，滑鼠移上去看說明。</span></div>
          <div className="ta-sh-ctl">
            <div className="ta-sh-glob">
              <label>總資金 <input type="number" className="ta-q ta-sh-n" step="10000" value={f.cap} onChange={inp("cap")} /> <span className="mut">美元</span></label>
              <label><Tip t="一年願意花在保險（買賣權）上的錢，占總資金的百分比。各結構能買幾口＝這筆錢 ÷ 一年換幾次 ÷ 每口成本，無條件捨去。">年保險費</Tip> <input type="number" className="ta-q ta-sh-s" step="0.5" value={f.bp} onChange={inp("bp")} /> <span className="mut">% ＝ <b className="mono">{cap > 0 && +f.bp > 0 ? usd(B) : "—"}</b>／年</span></label>
              <label>無風險利率 <input type="number" className="ta-q ta-sh-s" step="0.1" value={f.rf} onChange={inp("rf")} /> <span className="mut">%（假設值）</span></label>
              <label><Tip t="崩跌時選擇權的隱含波動率通常會上升，賣權因此更值錢。這裡設定標的從今天算起跌多少、IV 加幾個百分點；中間用直線內插，跌超過 50% 照同斜率外推。漲或不跌時不加。">IV 隨下跌上升</Tip> <span className="mut">跌 20% 加</span><input type="number" className="ta-q ta-sh-s" step="1" value={f.ivA} onChange={inp("ivA")} /><span className="mut">點、跌 50% 加</span><input type="number" className="ta-q ta-sh-s" step="1" value={f.ivB} onChange={inp("ivB")} /><span className="mut">點</span></label>
              {fut ? <label><Tip t="NQ／MNQ 期貨選擇權沒有免費報價，預設用 QQQ 價平賣權 IV（約一個月到期）當所有履約價的 IV，再用 Black-76 估價。可以自己改。">估算 IV</Tip> <input type="number" className="ta-q ta-sh-s" step="0.1" value={f.nqiv} onChange={inp("nqiv")} /> <span className="mut">%（預設 QQQ 價平 IV{qIv ? " " + (qIv * 100).toFixed(2) : "，讀取中"}）</span></label> : null}
            </div>
            {defs.map(([ek, ks], i) => (
              <div key={ek} className="ta-sh-leg">
                <h4><Sw i={i} />{NAMES[i]}{i === 1 ? "（買高賣低）" : i === 2 ? "（約 3 個月一換）" : ""}</h4>
                <label>到期 <select className="ta-q" value={E[ek]} onChange={inp(ek)}>{list.map((x) => <option key={x.e} value={x.e}>{expLabel(x)}</option>)}</select></label>
                {ks.map((k, j) => (
                  <div key={k}>
                    <label>{ks.length > 1 ? (j ? "賣出履約價" : "買進履約價") : "履約價"} <input type="number" className="ta-q ta-sh-s" step="1" value={f[k]} onChange={inp(k)} /> <span className="mut">% × 現價</span></label>
                    <div className="ta-sh-q mono" data-q={k}>{legTxt(sts[i].ex, sts[i].legs[j], +f[k])}</div>
                  </div>
                ))}
                {i === 0 && sym === "NVDA" ? <button type="button" className="ta-btn" onClick={burryGo}>帶入 Burry 2026-04 那組（2027-01、$115）</button> : null}
                {i === 2 ? <p className="ta-notes">每次換倉照同樣的 % 重設履約價。</p> : null}
              </div>
            ))}
          </div>
          {errs.length ? <div className="ta-sh-err" role="alert">輸入有誤：{errs.join("；")}</div> : null}
          <div className="ta-cap ta-sh-h">成本與風險</div>
          <div className="ta-sh-wrap"><SortTable className="ta-dt ta-sh-tbl" cols={colsA} rows={rows} rowKey={(x) => "a" + x.i} /></div>
          <div className="ta-cap ta-sh-h">情境損益（一年計畫，含換倉）</div>
          <SortTable className="ta-dt ta-sh-tbl" cols={colsB} rows={rows} rowKey={(x) => "b" + x.i} />
          <ShortChart res={res} />
          <p className="ta-notes">橫軸＝12 個月後標的比今天跌多少（跌勢平均分布在 12 個月內），縱軸＝三種結構一整年的損益（含換倉）。虛線＝情境 −35%、−50%。</p>
          <p className="ta-notes">算法：今天用 CBOE 延遲報價中價{fut ? "（NQ／MNQ 為估算）" : ""}買表上的口數，每 365÷換倉次數 天換一次（賣掉舊的、照同樣價外比例買新的，新買的用 Black-Scholes{fut ? "／Black-76" : ""} 估價）；跌勢在期間內等比例走完；IV＝各腳今天的 IV＋隨跌幅上升（跌 20% +{+f.ivA} 點、跌 35% +{(ivUp(0.35, ctx.ivA, ctx.ivB) * 100).toFixed(1)} 點、跌 50% +{+f.ivB} 點）。6 個月情境算到第 182 天、12 個月算到第 365 天。沒崩那欄＝假設每次換倉價錢跟今天一樣、全部歸零。有跌的格子可能比「沒崩」虧更多：跌得慢、每張到期時都還沒跌破履約價就歸零，換倉時履約價照新價格的 % 重設、IV 又加點，新買的賣權比今天貴。</p>
          <p className="ta-sh-no">不放裸賣買權與三倍反向 ETF：裸賣買權只收得到權利金，大漲時虧損沒有上限，還會被追保證金；三倍反向 ETF 每天重設槓桿，來回震盪就會耗損，持有一年的結果跟「指數跌幅 × 3」差很多。</p>
        </>
      )}

      <div className="ta-cap ta-sh-h2">接檢查表分批<span className="mut">多方波段檢查表 {CK_DATE} 快照的狀態與回測分級（每日分數帳本接好後改成即時）；每一批要放多少自己填，本頁不判斷什麼時候買。</span></div>
      <SortTable className="ta-dt ta-sh-tbl ta-sh-ck" cols={colsC} rows={ckRows} rowKey={(c) => "c" + c.i} />
      <div className="ta-sh-sum">合計 <b className="mono">{usd(ckSum)}</b><span className={"mono" + (ckSum > cap ? " warn" : "")}>（占總資金 {cap > 0 ? ((ckSum / cap) * 100).toFixed(1) + "%" : "—"}）</span></div>
      <p className="ta-notes">金額只存在這台瀏覽器（重新整理還在）。狀態：亮＝{CK_DATE} 成立；接近／亮過＝差一點或最近出現過；未亮＝不成立。</p>

      <div className="ta-cap ta-sh-h2">Burry 怎麼做（公開資料整理）<span className="mut">2025-11-10 Scion 終止投資顧問登記之後，持倉只剩他 Substack 自述，沒有申報文件可以驗證。</span></div>
      <div className="ta-sh-bc">
        <div><h3>1. NVDA 這筆用 Put</h3>
          <p>2025 年申報的 NVDA、PLTR 部位都是買進賣權。2026 年 4 月他說考慮過直接放空 NVDA，最後還是用 Put，理由是最大損失有限。別檔他也直接放空：2026 年放空過 Oracle、Tesla、Caterpillar 等股票。</p>
          <p className="src"><Tip t="【一手】SEC 13F（2025-09-30 持倉，2025-11-03 申報）；【主流】CNBC 2026-04-10 轉述 Burry Substack；直接放空 Oracle【主流】Bloomberg 2026-01-10、Tesla／Caterpillar【主流】CNBC 2026-07-24。2026-06 他在 NVDA $198.09 建的空方部位用什麼工具，報導沒講清楚。">13F、CNBC 2026-04／07、Bloomberg 2026-01</Tip></p></div>
        <div><h3>2. 13F 上的金額是名目，不是付的錢</h3>
          <p>13F 申報 PLTR 賣權 5,000,000 股、申報值 $912,100,000；據報導他說實際是 50,000 口、每口 $1.84、履約價 $50，共付 $9,200,000。申報值＝股價 × 股數（NVDA $186,580,000 ÷ 1,000,000 股＝$186.58）。</p>
          <p className="src"><Tip t="【一手】SEC 13F 2025-11-03；Scion 2023-09-30 那份 13F 附註寫明賣權按標的證券申報。PLTR 成本是 Burry 在 X 的更正，【二手】Stocktwits 轉述，X 原文未讀到。">SEC 13F、Stocktwits 轉述 X</Tip></p></div>
        <div><h3>3. 長天期、深度價外</h3>
          <p>PLTR 那批：股價 $182.42 時買 $50 履約、2027 年到期。2026 年 4 月他又買的 NVDA Put：2027 年 1 月到期、履約價 $115、每口 3.30。NVDA 分頁的「帶入 Burry 2026-04 那組」用同一個到期月和履約價，權利金換成今天的報價。</p>
          <p className="src"><Tip t="PLTR 股價＝13F 申報值 ÷ 股數【一手】；履約價與到期【二手】Stocktwits；NVDA 2027-01／$115／3.30【主流】CNBC 2026-04-10。">13F、CNBC 2026-04-10</Tip></p></div>
        <div><h3>4. 到期前兩個月就處理</h3>
          <p>他說時間價值要到到期前約兩個月才流失得明顯，在那之前會考慮轉倉；PLTR 部位一直轉倉。據報導 2026 年 9 月把 12 月到期的 NVDA、PLTR Put 出清、沒有轉倉（未經主流媒體確認）。</p>
          <p className="src"><Tip t="【主流】CNBC 2026-04-10；2026-09 出清是【二手】Stocktwits、Benzinga。">CNBC 2026-04-10、Stocktwits 2026-09</Tip></p></div>
        <div><h3>5. 用權利金算部位，看錯會停損</h3>
          <p>NVDA、PLTR 兩筆實際成本各約 $10M，名目合計約 $1.1B。2026 年 4 月 Put 約占組合 5%。2026 年 8 月他說走勢明確對他不利就停損。</p>
          <p className="src"><Tip t="【主流】Business Insider 2025-11-26；CNBC 2026-04-24；CNBC 2026-08-04。他公開講過的單一部位上限百分比：查不到。">BI 2025-11-26、CNBC 2026-04-24／08-04</Tip></p></div>
        <div><h3>6. 他也看錯過</h3>
          <p>2023 年初在 X 只發一個字「Sell」，3-30 就發文「I was wrong to say sell」。2023 年第 2 季 13F 上的 SPY、QQQ 賣權，到第 3 季就不在表上了，這批賺賠多少他沒說明過。</p>
          <p className="src"><Tip t="【主流】Bloomberg 2023-03-30、Kitco 2023-03-31；【一手】SEC 13F 2023-08-14、2023-11-14。「Sell」原推文確切日期未直接查到。">Bloomberg 2023-03-30、SEC 13F 2023</Tip></p></div>
        <div className="wide"><h3>7. 他 2026 年的近況</h3>
          <ul>
            <li><b>2026-05</b>：說現在買賣權普遍很貴，放空不是答案；一般人能做的是降低持股（尤其科技股）、留現金。<span className="mut">CNBC 2026-05-11</span></li>
            <li><b>2026-08</b>：所有空方部位裡只有 NVDA 是虧錢的；說自己「I must short. Most should not.」<span className="mut">CNBC 2026-08-04</span></li>
            <li><b>2026-11-20</b>：據報導，NVDA 賣權先賣一半、再賣 25%，合計砍約 75%；出清 SMH 賣權、2027-04 到期的 Nasdaq-100 賣權賣一半；另買少量長天期、深度價外的 NVDA 買權。<span className="mut">GuruFocus（Yahoo 轉載）、Seeking Alpha 2026-11-24</span></li>
            <li><b>2026-11-23</b>：黃仁勳復職、NVDA 單日大漲後，他說 NVDA 接近或越過 $200 之前不會再空。<span className="mut">CNBC 2026-11-23</span></li>
            <li><b>2026-11-25</b>：據報導，剩下的 Nasdaq-100 賣權也賣掉，現金約 25%；PLTR、MetLife 賣權還在。<span className="mut">investingLive 2026-11-25</span></li>
          </ul>
          <p className="src"><Tip t="05、08、11-23 三則是【主流】CNBC 轉述 Burry Substack；11-20、11-25 兩則是【二手】報導轉述 Substack，未經主流媒體或原文交叉確認。Substack 付費原文未直接讀取。">05／08／11-23 主流轉述；11-20、11-25 二手報導</Tip></p></div>
      </div>
    </div>
  );
}

// 情境折線：橫軸 12 個月跌 0～60%、縱軸一年損益（含換倉）；放在情境表正下方
export function ShortChart({ res }) {
  const W = 1300, H = 340, ml = 100, mr = 24, mt = 14, mb = 30;
  const lines = res.map((o) => (o ? o.line : null)), all = lines.filter(Boolean).flat();
  if (!all.length) return null;
  let y0 = Math.min(...all, 0), y1 = Math.max(...all, 0);
  const pad = (y1 - y0) * 0.08 || 1; y0 -= pad; y1 += pad;
  const X = (d) => ml + (d / 60) * (W - ml - mr), Y = (v) => mt + ((y1 - v) / (y1 - y0)) * (H - mt - mb);
  const raw = (y1 - y0) / 5, p = Math.pow(10, Math.floor(Math.log10(raw))), mm = raw / p, step = (mm < 1.5 ? 1 : mm < 3.5 ? 2 : mm < 7.5 ? 5 : 10) * p;
  const gy = []; for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) gy.push(v);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ta-sh-chart" role="img" aria-label="三種結構的情境損益折線">
      {gy.map((v) => <g key={v}><line className="gl" x1={ml} x2={W - mr} y1={Y(v)} y2={Y(v)} /><text x={ml - 6} y={Y(v) + 4} textAnchor="end">{sgn(v)}</text></g>)}
      {[0, 10, 20, 30, 40, 50, 60].map((d) => <text key={"x" + d} x={X(d)} y={H - 10} textAnchor="middle">{d ? "−" + d + "%" : "不跌"}</text>)}
      <line className="zero" x1={ml} x2={W - mr} y1={Y(0)} y2={Y(0)} />
      {[35, 50].map((d) => <line key={"v" + d} className="vx" x1={X(d)} x2={X(d)} y1={mt} y2={H - mb} />)}
      {lines.map((L, i) => (L ? <g key={i} data-line={i}>
        <path d={L.map((v, j) => (j ? "L" : "M") + X(XS[j]).toFixed(1) + " " + Y(v).toFixed(1)).join("")} fill="none" stroke={COLORS[i]} strokeWidth="2.2" />
        <text x={X(60) + 2} y={Y(L[60]) + 4} style={{ fill: COLORS[i], fontSize: 17 }}>{NAMES[i].slice(0, 1)}</text>
      </g> : null))}
    </svg>
  );
}
