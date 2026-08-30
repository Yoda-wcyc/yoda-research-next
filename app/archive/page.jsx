"use client";
import { useEffect, useState } from "react";

const BASE = "https://yoda-wcyc.github.io";
// 會員系統 GAS：讀報告覆蓋（軟下架 / 改標題）供前端合併
const GAS = "https://script.google.com/macros/s/AKfycbwQQ02EzseXtzvHxH3yegvgvQKncv7ReoGaqqsVxzco6cdagOCW13Tr7KlwX2UJtPc7/exec";
const TABS = ["全部", "付費版", "關鍵報告", "市場觀察", "美股", "台股", "AI泡沫", "總經", "簡報", "專題", "使用手冊"];
// 付費版判定：該筆明確標 paid，或分類為付費旗艦「關鍵報告」
const isPaidRow = (x) => x.paid === true || x.cat === "關鍵報告";

export default function Archive() {
  const [all, setAll] = useState(null); // null=載入中, []=空, false=失敗
  const [f, setF] = useState("全部");

  // 支援深連結：首頁「付費報告總覽」帶 ?tab=付費版 進來就預選該頁籤
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && TABS.includes(t)) setF(t);
  }, []);

  useEffect(() => {
    const norm = (f) => String(f || "").replace(/\.html?$/i, "").replace(/^付費[_-]?/, ""); // 正規化檔名供去重
    // 由三份資料組出清單(over=隱藏/改標題覆蓋)
    const build = (d, pd, over) => {
      const pub = (d.history || [])
        .filter((x) => !(over[x.file] && over[x.file].hidden))
        .map((x) => { const o = over[x.file]; return o && o.title ? { ...x, _title: o.title } : x; });
      const have = new Set(pub.map((x) => norm(x.file)));
      const paid = ((pd && pd.reports) || [])
        .filter((x) => !(over[x.file] && over[x.file].hidden))
        .filter((x) => !have.has(norm(x.file)));
      return pub.concat(paid).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    };

    let dRef = null, pdRef = null;
    // 快路徑：reports.json(靜態) + 付費清單(Vercel Blob) → 立即顯示，完全不等 Google
    Promise.all([
      fetch(BASE + "/-/reports.json", { cache: "no-store" }).then((r) => { if (!r.ok) throw 0; return r.json(); }),
      fetch("/api/public-paid-list", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ reports: [] })),
    ])
      .then(([d, pd]) => { dRef = d; pdRef = pd; setAll(build(d, pd, {})); })
      .catch(() => setAll(false));

    // 慢路徑(非阻塞)：GAS 覆蓋(隱藏/改標題)——來了才重套一次，拖不到主要清單的顯示
    fetch(GAS, { method: "POST", body: JSON.stringify({ action: "reportOverrides" }), signal: AbortSignal.timeout(8000) })
      .then((r) => r.json())
      .then((ov) => { const over = (ov && ov.overrides) || {}; if (dRef && Object.keys(over).length) setAll(build(dRef, pdRef, over)); })
      .catch(() => {});
  }, []);

  const rows = Array.isArray(all)
    ? f === "全部"
      ? all
      : f === "付費版"
      ? all.filter(isPaidRow)
      : all.filter((x) => x.cat === f)
    : [];

  return (
    <>
      <div className="awrap">
        <a className="aback" href="https://yoda-research-next.vercel.app/">← 回 Yoda Research</a>
        <div className="eyebrow">Archive</div>
        <h1>研究總覽</h1>
        <div className="sub">
          {all === null
            ? "載入中…"
            : all === false
            ? "暫時載入不了清單,稍後再試,或直接到研究報告中心"
            : `共 ${all.length} 篇報告,持續更新`}
        </div>
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t} className={"tab" + (f === t ? " on" : "")} onClick={() => setF(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="list">
          {all === false ? (
            <div className="empty">
              <a href="https://yoda-wcyc.github.io/-/">前往研究報告中心 →</a>
            </div>
          ) : Array.isArray(all) && rows.length === 0 && all.length >= 0 && all !== null ? (
            <div className="empty">這個分類還沒有報告</div>
          ) : (
            rows.map((x) => {
              const title = x._title || x.file.replace(/\.html$/, "").replace(/_/g, " ");
              const showSum = x.summary && x.summary.indexOf("占位") === -1;
              const isPaid = isPaidRow(x);
              return (
                <a
                  key={x.file}
                  className="item"
                  href={
                    x.drive
                      ? BASE + "/-/report-shell.html?id=" + encodeURIComponent(x.reportId) // Drive 付費檔：導去報告頁(輸一次密碼即讀)
                      : BASE + "/-/" + encodeURIComponent(x.file)
                  }
                >
                  {isPaid && <span className="paid-badge">付費版</span>}
                  <div className="meta">
                    <span className="cat">{x.cat}</span>
                    <span className="date">{x.date}</span>
                  </div>
                  <div className="title">{title}</div>
                  {showSum && <div className="summary">{x.summary}</div>}
                </a>
              );
            })
          )}
        </div>
      </div>
      <footer className="afoot">
        <a className="afoot-home" href="https://yoda-research-next.vercel.app/">← 回 Yoda Research</a>
        <div>© 2026 Yoda Research｜本站內容不構成投資建議</div>
      </footer>
    </>
  );
}
