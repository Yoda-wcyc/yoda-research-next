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
// 版面改版：Yoda 2026-09-27「股票名單放在左邊 1/4 欄位並且固定……右邊 3/4 欄位顯示被選取的股票技術分析內容」。

const SS_KEY = "yoda_ta_k";
const PAGE = 25;

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
function ud(x) { const v = Number(x); return !Number.isFinite(v) || v === 0 ? "" : v > 0 ? "up" : "dn"; }
function d8(s) { const m = String(s || "").match(/(\d{4})-?(\d{2})-?(\d{2})/); return m ? m[1] + "-" + m[2] + "-" + m[3] : ""; }
function g(o, ...path) { let x = o; for (const p of path) { if (!x || typeof x !== "object") return undefined; x = x[p]; } return x; }
function srcZh(s) {
  return String(s || "")
    .replace(/swing high (\d{4}-\d\d-\d\d)/g, "前高 $1")
    .replace(/swing low (\d{4}-\d\d-\d\d)/g, "前低 $1")
    .replace(/52w 高/g, "52 週高").replace(/52w 低/g, "52 週低");
}
const TREND_ZH = { BUY: "多", SELL: "空", NEUTRAL: "中" };
const TREND_CLS = { BUY: "up", SELL: "dn", NEUTRAL: "mut" };
const METHOD_ZH = { swing: "前波高低點 ± 半個 ATR14", chandelier: "Chandelier（22 根極值 ∓ 3×ATR22）", atr2: "收盤 ∓ 2×ATR14" };
const BREAKDOWN_ZH = {
  trend_long: "長線趨勢", trend_inter: "中線趨勢", trend_short: "短線趨勢", structure: "結構",
  adx: "ADX 趨勢強度", volume: "五日量價", rel20: "REL20 相對強弱", ma_align: "均線排列",
};
const sideZh = (s) => (s === "short" ? "空方" : "多方");
function r2Price(r) { const x = r && r.r2; return x && typeof x === "object" ? x.price : x; }
function trendArr(r) {
  const t = r && r.trend;
  if (Array.isArray(t)) return t;
  if (t && typeof t === "object") return [t.long, t.inter, t.short];
  return [null, null, null];
}
function trendScore(t) { return t.reduce((a, x) => a + (x === "BUY" ? 1 : x === "SELL" ? -1 : 0), 0); }

async function api(body) {
  const res = await fetch("/api/ta-data", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
  });
  let j = null;
  try { j = await res.json(); } catch (e) { j = { ok: false, reason: "error", error: "伺服器回應無法解析（HTTP " + res.status + "）" }; }
  return j;
}

// ───────── 可排序表格（B-13：每一欄都能排序）─────────
function SortTable({ cols, rows, rowKey, className, onRowClick, rowClass, caption }) {
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
      return String(x).localeCompare(String(y), "zh-Hant") * dir;
    });
    return out;
  }, [rows, cols, sk, dir]);
  const click = (i) => {
    if (sk === i) setDir(-dir);
    else { setSk(i); setDir(cols[i].num ? -1 : 1); }
  };
  return (
    <table className={"ta-tbl " + (className || "")}>
      {caption ? <caption className="ta-cap" style={{ textAlign: "left" }}>{caption}</caption> : null}
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

// ───────── K 線圖（120 根，SVG 自畫）─────────
function KChart({ d }) {
  const raw = g(d, "chart", "bars") || [];
  const bars = raw.map((b) => (Array.isArray(b) ? { date: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] } : b));
  if (bars.length < 2) return <div className="ta-nochart">沒有 K 線資料</div>;
  const s20 = g(d, "chart", "sma20") || [];
  const s60 = g(d, "chart", "sma60") || [];
  const W = 1000, H = 360, L = 58, R = 150, T = 14, B = 28;
  const pw = W - L - R, ph = H - T - B;
  const hl = [];
  const dflt = g(d, "risk", "default") || {};
  if (dflt.price != null) hl.push([dflt.price, "停損 " + fnum(dflt.price), "h-stop"]);
  const r2 = g(d, "targets", "r2") || {};
  if (r2.price != null) hl.push([r2.price, "2R " + fnum(r2.price), "h-tgt"]);
  for (const x of (g(d, "levels", "above") || []).slice(0, 3)) if (x.price != null) hl.push([x.price, "壓 " + fnum(x.price), "h-lvl"]);
  for (const x of (g(d, "levels", "below") || []).slice(0, 3)) if (x.price != null) hl.push([x.price, "撐 " + fnum(x.price), "h-lvl"]);
  const vals = [];
  for (const b of bars) { if (b.h != null) vals.push(b.h); if (b.l != null) vals.push(b.l); }
  for (const x of hl) vals.push(x[0]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.04 || hi * 0.01 || 1;
  lo -= pad; hi += pad;
  const n = bars.length, step = pw / n, bw = Math.max(1.2, step * 0.62);
  const Y = (p) => T + ((hi - p) / (hi - lo)) * ph;
  const X = (i) => L + step * (i + 0.5);
  const els = [];
  for (let k = 0; k < 5; k++) {
    const p = lo + ((hi - lo) * (k + 0.5)) / 5, y = Y(p);
    els.push(<line key={"g" + k} className="grid" x1={L} x2={L + pw} y1={y} y2={y} />);
    els.push(<text key={"gt" + k} className="ax" x={L - 6} y={y + 4} textAnchor="end">{fnum(p, hi - lo < 50 ? 1 : 0)}</text>);
  }
  for (let i = 0; i < n; i += 20) {
    const dd = String(bars[i].date || "");
    els.push(<text key={"d" + i} className="ax" x={X(i)} y={H - 8} textAnchor="middle">{i === 0 ? dd.slice(2) : dd.slice(5)}</text>);
  }
  els.push(<text key="dl" className="ax" x={L + pw} y={H - 8} textAnchor="end">{String(bars[n - 1].date || "").slice(5)}</text>);
  let prev = null;
  bars.forEach((b, i) => {
    const c = b.c;
    if (c == null) return;
    const op = b.o != null ? b.o : prev != null ? prev : c;
    const h = b.h != null ? b.h : Math.max(op, c);
    const l = b.l != null ? b.l : Math.min(op, c);
    const cls = c >= op ? "up" : "dn";
    const x = X(i);
    els.push(<line key={"w" + i} className={"wk " + cls} x1={x} x2={x} y1={Y(h)} y2={Y(l)} />);
    const y1 = Y(Math.max(op, c)), y2 = Y(Math.min(op, c));
    els.push(<rect key={"b" + i} className={"bd " + cls} x={x - bw / 2} y={y1} width={bw} height={Math.max(1, y2 - y1)} />);
    prev = c;
  });
  for (const [arr, cls] of [[s20, "ma20"], [s60, "ma60"]]) {
    const segs = []; let cur = [];
    arr.slice(0, n).forEach((v, i) => {
      if (v == null) { if (cur.length > 1) segs.push(cur); cur = []; }
      else cur.push(X(i).toFixed(1) + "," + Y(v).toFixed(1));
    });
    if (cur.length > 1) segs.push(cur);
    segs.forEach((sg, k) => els.push(<polyline key={cls + k} className={cls} points={sg.join(" ")} />));
  }
  // 水平線＋右側標籤（由上往下排、至少隔 13px，避免疊字）
  const lab = hl.map(([p, t, c]) => [Y(p), t, c]).sort((a, b) => a[0] - b[0]);
  const ys = []; let last = -1e9;
  for (const [y] of lab) { const ny = Math.max(y, last + 13); ys.push(ny); last = ny; }
  const over = ys.length ? ys[ys.length - 1] - (H - B) : 0;
  if (over > 0) {
    for (let k = 0; k < ys.length; k++) ys[k] -= over;
    for (let k = ys.length - 2; k >= 0; k--) ys[k] = Math.min(ys[k], ys[k + 1] - 13);
  }
  lab.forEach(([y, t, c], k) => {
    const ty = ys[k];
    els.push(<line key={"h" + k} className={c} x1={L} x2={L + pw} y1={y} y2={y} />);
    els.push(<line key={"hk" + k} className={c + " lk"} x1={L + pw} x2={L + pw + 6} y1={y} y2={ty} />);
    els.push(<text key={"ht" + k} className={"hl " + c} x={L + pw + 9} y={ty + 4}>{t}</text>);
  });
  const lc = bars[n - 1].c;
  if (lc != null) els.push(<circle key="lc" className="lastc" cx={X(n - 1)} cy={Y(lc)} r="3" />);
  return (
    <>
      <svg className="ta-k" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="日 K 線圖">{els}</svg>
      <div className="ta-cnote">
        怎麼看：最近 {n} 根日 K（紅 K 漲、綠 K 跌），黃線 SMA20、藍線 SMA60；
        <i style={{ color: "var(--orange)" }}></i>橘虛線＝預設停損
        <i style={{ color: "var(--ta-cyan)" }}></i>青虛線＝2R 目標
        <i style={{ color: "var(--ta-muted)", borderTopStyle: "dotted" }}></i>灰點線＝上方壓力／下方支撐（右側標價）。
      </div>
    </>
  );
}

// ───────── 明細卡內容 ─────────
function KV({ rows }) {
  return (
    <table className="ta-tbl ta-kv">
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={i}><th>{k}</th><td className="wrap">{v}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function Detail({ d }) {
  const t = d.trend_state || {}, s = d.structure || {}, a = d.adx || {}, vo = d.vol || {}, vl = d.volume || {}, rel = d.rel || {};
  const r = d.risk || {}, tg = d.targets || {}, cf = d.confidence || {}, lv = d.levels || {}, ma = d.ma || {}, pr = d.price || {};
  const side = r.side || "long";
  const ev = s.last_event || {};
  const dflt = r.default || {};

  const kvRows = [
    ["趨勢 長／中／短", <>{[t.long, t.inter, t.short].map((x, i) => <span key={i} className={TREND_CLS[x] || "mut"}>{i ? "／" : ""}{TREND_ZH[x] || "—"}</span>)}<span className="mut">{t.aligned ? "（三層一致）" : "（不一致）"}</span></>],
    ["結構", <>{s.state || "—"} <span className="mut">{s.state_basis || ""}</span></>],
    ["最後突破", ev.type ? <>{ev.type} {ev.dir === "up" ? "向上" : ev.dir === "down" ? "向下" : ""} @ {fnum(ev.level)} <span className="mut">{ev.date || ""}</span></> : "—"],
    ["均線排列", ma.alignment || "—"],
    ["ADX14", a.status === "ok" ? <>{fnum(a.adx14)}（{a.quality || "—"}）+DI {fnum(a.plus_di)}／−DI {fnum(a.minus_di)}</> : <span className="mut">資料不足{a.why ? "：" + a.why : ""}</span>],
    ["ATR14／ATR%", <>{fnum(vo.atr14)}／{fpct(vo.atr_pct, false)}</>],
    ["布林帶寬", <>{fnum(vo.bandwidth)}%{vo.squeeze ? "（壓縮）" : ""}</>],
    ["量價 1 日／5 日", <>{vl.pv_1d || "—"}（{fnum(vl.ratio_1d)}x）／{vl.pv_5d || "—"}（{fnum(vl.ratio_5d)}x）</>],
    ["REL5／20／60", <><span className={ud(rel.rel5)}>{fnum(rel.rel5)}</span>／<span className={ud(rel.rel20)}>{fnum(rel.rel20)}</span>／<span className={ud(rel.rel60)}>{fnum(rel.rel60)}</span> <span className="mut">百分點·近 N 日相對{rel.bench || "大盤"}·非漲幅</span></>],
    ["52 週高／低", <>{fnum(pr.high_52w)}（{fpct(pr.dist_high_52w_pct)}）／{fnum(pr.low_52w)}（{fpct(pr.dist_low_52w_pct)}）</>],
  ];

  // 停損與目標
  const stopRows = [];
  const sideStops = r[side] || {};
  for (const k of ["swing", "chandelier", "atr2"]) {
    const x = sideStops[k] || {};
    stopRows.push({ id: "st-" + k, on: dflt.method === k, item: (dflt.method === k ? "★ " : "") + "停損·" + (METHOD_ZH[k] || k), price: x.price, dist: x.dist_pct, basis: x.basis || "" });
  }
  for (const k of ["r1", "r2", "r3"]) {
    const x = tg[k] || {};
    stopRows.push({ id: "tg-" + k, item: k.slice(1) + "R 目標", price: x.price, dist: x.dist_pct, basis: x.rr != null ? "R:R " + fnum(x.rr) : "" });
  }
  const ns = tg.next_swing;
  stopRows.push({ id: "ns", item: "前波目標", price: ns && ns.price, dist: ns && ns.dist_pct, basis: ns ? fnum(ns.rr) + " R · " + srcZh(ns.source) : "無" });
  const ms = tg.measured;
  stopRows.push({ id: "ms", item: "量測目標", price: ms && ms.price, dist: ms && ms.dist_pct, basis: ms ? fnum(ms.rr) + " R" + (ms.reached ? "（已到）" : "") + " · " + (ms.basis || "") : (tg.measured_why || "無") });
  const stopCols = [
    { label: "項目", render: (x) => x.item, sort: (x) => x.item },
    { label: "價位", num: true, render: (x) => fnum(x.price), sort: (x) => (x.price == null ? null : Number(x.price)) },
    { label: "距離", num: true, render: (x) => <span className={ud(x.dist)}>{fpct(x.dist)}</span>, sort: (x) => (x.dist == null ? null : Number(x.dist)) },
    { label: "依據", cls: "wrap mut", render: (x) => x.basis, sort: (x) => x.basis },
  ];

  // 關鍵價位
  const lvRows = [];
  for (const [nm, key] of [["壓力（上方）", "above"], ["支撐（下方）", "below"]]) {
    (lv[key] || []).forEach((x, i) => lvRows.push({ id: key + i, nm, price: x.price, dist: x.dist_pct, src: (x.sources || []).map(srcZh).join("、") }));
  }
  const lvCols = [
    { label: "上／下", render: (x) => x.nm, sort: (x) => x.nm },
    { label: "價位", num: true, render: (x) => fnum(x.price), sort: (x) => (x.price == null ? null : Number(x.price)) },
    { label: "距離", num: true, render: (x) => <span className={ud(x.dist)}>{fpct(x.dist)}</span>, sort: (x) => (x.dist == null ? null : Number(x.dist)) },
    { label: "來源", cls: "wrap mut", render: (x) => x.src, sort: (x) => x.src },
  ];

  // 信心分
  const bdRows = (cf.breakdown || []).map((b, i) => ({ id: i, item: BREAKDOWN_ZH[b.item] || b.item, pts: b.pts, max: b.max, why: b.why || "" }));
  const bdCols = [
    { label: "項目", render: (x) => x.item, sort: (x) => x.item },
    { label: "得分", num: true, render: (x) => fnum(x.pts) + "／" + fnum(x.max), sort: (x) => Number(x.pts) },
    { label: "依據", cls: "wrap mut", render: (x) => x.why, sort: (x) => x.why },
  ];

  return (
    <>
      <KChart d={d} />
      <div className="ta-cols">
        <div className="ta-block">
          <div className="ta-cap">趨勢與結構</div>
          <KV rows={kvRows} />
        </div>
        <div className="ta-block">
          <div className="ta-cap">停損與目標（{sideZh(side)}視角，R＝{fnum(tg.R)}）</div>
          <SortTable cols={stopCols} rows={stopRows} rowKey={(x) => x.id} rowClass={(x) => (x.on ? "on" : "")} />
          {side === "short" ? (
            <div className="ta-small">空方視角：停損在上方、目標在下方。只做多的對照停損：{["swing", "chandelier", "atr2"].map((k) => METHOD_ZH[k].split("（")[0] + " " + fnum(g(r, "long", k, "price"))).join("；")}。</div>
          ) : null}
        </div>
        <div className="ta-block">
          <div className="ta-cap">關鍵價位</div>
          <SortTable cols={lvCols} rows={lvRows} rowKey={(x) => x.id} />
          <div className="ta-cap" style={{ marginTop: 14 }}>什麼情況判讀失效</div>
          <div className="ta-inv">{d.invalidation || "—"}</div>
        </div>
        <div className="ta-block">
          <div className="ta-cap">信心分 {fnum(cf.score)}（多方 {fnum(cf.score_long)}／空方 {fnum(cf.score_short)}）</div>
          <SortTable cols={bdCols} rows={bdRows} rowKey={(x) => x.id} />
          {cf.conflict ? <div className="ta-small warn">{cf.conflict}</div> : null}
          <div className="ta-small">{cf.notes || "分數不是勝率：只衡量各規則訊號與方向同向的程度，未經回測校準。"}</div>
        </div>
      </div>
    </>
  );
}

// ───────── 右欄：單檔明細 ─────────
function One({ row, item, onRetry }) {
  const sym = row.sym;
  const d = item && !item.error ? item : null;
  const m = (d && d.meta) || {};
  const side = row.side || g(d, "risk", "side") || "long";
  const chg = row.chg1d != null ? row.chg1d : g(d, "price", "chg_1d_pct");
  const close = row.close != null ? row.close : g(d, "price", "close");
  const conflict = g(d, "confidence", "conflict");
  return (
    <div className="ta-one" id={"c-" + sym} data-sym={sym}>
      <div className="ta-ch">
        <h2><span className="mono">{sym}</span>{row.name || m.name || ""}</h2>
        <span className="ta-px mono">{fnum(close)} <span className={ud(chg)}>{fpct(chg)}</span></span>
        <span className={"ta-chip " + side}>{sideZh(side)} · 信心 {fnum(row.conf)}</span>
        <span className="ta-chip">結構 {row.state || "—"}</span>
        <span className="ta-chip">資料 {row.asof || m.asof || "—"}</span>
        {row.stale || m.stale ? <span className="ta-chip warn">資料可能過期</span> : null}
        {conflict ? <span className="ta-chip warn">趨勢與結構打架</span> : null}
      </div>
      {d && m.notes && m.notes.length ? (
        <div className="ta-notes">資料註記：{m.notes.join("；")}｜來源 {m.source || "—"}｜基準 {m.bench || "—"}</div>
      ) : null}
      {d ? <Detail key={sym} d={d} /> : item && item.error ? (
        <div className="ta-err">
          <span>這檔明細讀不到：{item.error}</span>
          <button type="button" className="ta-btn" onClick={onRetry}>重試</button>
        </div>
      ) : (
        <div className="ta-ph"><span>明細載入中…</span></div>
      )}
    </div>
  );
}

// ───────── 左欄清單的排序 ─────────
// 預設「送來的順序」＝報告表格勾選／送出的順序（與改版前總表的預設一致）。
const SORTS = [
  { key: "orig", label: "送來的順序", dir: 1, val: (r, i) => i },
  { key: "conf", label: "信心分", dir: -1, val: (r) => (r.conf == null ? null : Number(r.conf)) },
  { key: "rel20", label: "REL20", dir: -1, val: (r) => (r.rel20 == null ? null : Number(r.rel20)) },
  { key: "atr", label: "ATR%", dir: -1, val: (r) => (r.atr_pct == null ? null : Number(r.atr_pct)) },
  { key: "sym", label: "代號", dir: 1, val: (r) => r.sym },
];
const SORT_BY = Object.fromEntries(SORTS.map((s) => [s.key, s]));
function dirLabel(key, dir) {
  if (key === "orig") return dir > 0 ? "正序" : "倒序";
  if (key === "sym") return dir > 0 ? "A→Z" : "Z→A";
  return dir < 0 ? "高→低" : "低→高";
}
function hashSym() {
  try {
    const m = (location.hash || "").match(/[#&]s=([^&]+)/);
    return m ? decodeURIComponent(m[1]).trim().toUpperCase() : "";
  } catch (e) { return ""; }
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
  const loadFor = useCallback(async (sym) => {
    if (!ctx || !sum || !sym) return;
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
  }, [ctx, sum, rows, toGate]);

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

  const sumCols = useMemo(() => [
    { label: "代號", cls: "code mono", render: (r) => r.sym, sort: (r) => r.sym },
    { label: "名稱", render: (r) => <span className="ta-nm" title={r.name || ""}>{r.name || ""}</span>, sort: (r) => r.name || "" },
    { label: "資料日", render: (r) => <>{r.asof || "—"}{r.stale ? <span className="warn" title="資料可能過期"> ⚠過期</span> : null}</>, sort: (r) => r.asof || "" },
    { label: "收盤", num: true, render: (r) => fnum(r.close), sort: (r) => (r.close == null ? null : Number(r.close)) },
    { label: "1日%", num: true, render: (r) => <span className={ud(r.chg1d)}>{fpct(r.chg1d)}</span>, sort: (r) => (r.chg1d == null ? null : Number(r.chg1d)) },
    { label: "長/中/短", title: "三層趨勢（EMA 規則）：多／中／空。排序依多空淨分", render: (r) => (
      <span className="ta-tr">{trendArr(r).map((x, i) => <span key={i} className={TREND_CLS[x] || "mut"}>{TREND_ZH[x] || "—"}</span>)}</span>
    ), sort: (r) => trendScore(trendArr(r)) },
    { label: "結構", render: (r) => <span className={r.state === "多頭" ? "up" : r.state === "空頭" ? "dn" : ""}>{r.state || "—"}</span>, sort: (r) => r.state || "" },
    { label: "ADX", num: true, render: (r) => fnum(r.adx, 1), sort: (r) => (r.adx == null ? null : Number(r.adx)) },
    { label: "ATR%", num: true, render: (r) => fpct(r.atr_pct, false), sort: (r) => (r.atr_pct == null ? null : Number(r.atr_pct)) },
    { label: "REL20", num: true, title: "近 20 日相對大盤（百分點）·非漲幅", render: (r) => <span className={ud(r.rel20)}>{fnum(r.rel20)}</span>, sort: (r) => (r.rel20 == null ? null : Number(r.rel20)) },
    { label: "預設停損", num: true, title: "價位（距離收盤 %）；排序依距離", render: (r) => r.stop && r.stop.price != null ? <>{fnum(r.stop.price)} <span className="mut">({fpct(r.stop.dist_pct)})</span></> : "—", sort: (r) => (r.stop && r.stop.dist_pct != null ? Number(r.stop.dist_pct) : null) },
    { label: "2R 目標", num: true, render: (r) => fnum(r2Price(r)), sort: (r) => (r2Price(r) == null ? null : Number(r2Price(r))) },
    { label: "信心分", num: true, title: "條件符合幾項（0–100），不是勝率", render: (r) => <><span className={r.side === "short" ? "dn" : "up"}>{r.side === "short" ? "空" : "多"}</span> {fnum(r.conf)}</>, sort: (r) => (r.conf == null ? null : Number(r.conf)) },
  ], []);

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

  return (
    <main className="ta-root ta-app">
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
        {staleN ? <div className="ta-notice">有 {staleN} 檔的資料日早於報告日（標「⚠過期」），價位以該檔資料日的收盤為準。</div> : null}
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
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <button type="button" className="ta-dir" title="反轉排序方向" onClick={() => setSortDir((x) => -x)}>{dirLabel(sortKey, sortDir)}</button>
            </div>
          </div>
          <div className="ta-list" ref={listRef} role="listbox" aria-label="代號清單">
            {vis.map((r) => {
              const on = r.sym === sel;
              const side = r.side === "short" ? "short" : "long";
              return (
                <div key={r.sym} className={"ta-li" + (on ? " on" : "")} data-sym={r.sym} role="option" aria-selected={on} onClick={() => pick(r.sym)}>
                  <div className="l1">
                    <b className="mono">{r.sym}</b>
                    <span className="nm" title={r.name || ""}>{r.name || ""}</span>
                    <span className={"ta-cf " + side} title={(side === "short" ? "空方" : "多方") + "信心分（條件符合幾項，不是勝率）"}>{side === "short" ? "空" : "多"} {fnum(r.conf)}</span>
                  </div>
                  <div className="l2">
                    <span className="mono">{fnum(r.close)}</span>
                    <span className={"mono " + ud(r.chg1d)}>{fpct(r.chg1d)}</span>
                    <span className={r.state === "多頭" ? "up" : r.state === "空頭" ? "dn" : "mut"}>{r.state || "—"}</span>
                    {r.stale ? <span className="warn" title="資料可能過期">⚠過期</span> : null}
                  </div>
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
            {selRow ? <One row={selRow} item={items[selRow.sym]} onRetry={() => retry(selRow.sym)} />
              : <div className="ta-ph">{rows.length ? "從左邊清單選一檔。" : "這次勾選的代號都沒有資料。"}</div>}
            <div className="ta-foot">
              以上數字全由寫死的技術規則計算（均線、結構高低點、ADX、ATR、相對強弱），沒有經過回測校準；信心分是條件符合幾項，不是勝率；
              停損的主要用途是把尾部風險壓住，不是保證獲利。本頁為會員專屬資料，請勿轉傳。
            </div>
          </div>
          <div className="ta-pane ta-pane-all" hidden={tab !== "all"}>
            <div className="ta-allcap">數字總表（點欄名排序、點一列看那一檔的明細）</div>
            {rows.length ? (
              <SortTable className="ta-sum" cols={sumCols} rows={rows} rowKey={(r) => r.sym} onRowClick={(r) => pick(r.sym)} rowClass={(r) => (r.sym === sel ? "sel" : "")} />
            ) : <div className="ta-ph">這次勾選的代號都沒有資料。</div>}
            <div className="ta-hint">
              趨勢「多／中／空」＝長線（EMA50 對 EMA200）、中線（EMA20／50／200）、短線（收盤對 EMA20＋斜率）；REL20＝近 20 日相對大盤的百分點，不是漲幅；
              預設停損括號內是距離收盤的百分比；信心分是條件符合幾項，不是勝率。
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
