"use client";
import { useEffect, useState } from "react";

const BASE = "https://yoda-wcyc.github.io";
// 會員系統 GAS：讀報告覆蓋（軟下架 / 改標題）供前端合併
const GAS = "https://script.google.com/macros/s/AKfycbwQQ02EzseXtzvHxH3yegvgvQKncv7ReoGaqqsVxzco6cdagOCW13Tr7KlwX2UJtPc7/exec";
const TABS = ["全部", "付費版", "關鍵報告", "市場觀察", "美股", "台股", "AI泡沫", "總經", "簡報", "專題"];
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
    Promise.all([
      fetch(BASE + "/-/reports.json", { cache: "no-store" }).then((r) => {
        if (!r.ok) throw 0;
        return r.json();
      }),
      // 覆蓋讀取失敗不擋清單：退回空覆蓋
      fetch(GAS, { method: "POST", body: JSON.stringify({ action: "reportOverrides" }) })
        .then((r) => r.json())
        .catch(() => ({ overrides: {} })),
    ])
      .then(([d, ov]) => {
        const over = (ov && ov.overrides) || {};
        const rows = (d.history || [])
          .filter((x) => !(over[x.file] && over[x.file].hidden)) // 軟下架：隱藏的不進清單
          .map((x) => {
            const o = over[x.file];
            return o && o.title ? { ...x, _title: o.title } : x; // 改標題：覆蓋顯示標題
          })
          .sort((a, b) => b.date.localeCompare(a.date));
        setAll(rows);
      })
      .catch(() => setAll(false));
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
                  href={BASE + "/-/" + encodeURIComponent(x.file)}
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
