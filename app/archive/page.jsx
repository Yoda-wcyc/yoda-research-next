"use client";
import { useEffect, useState } from "react";

const BASE = "https://yoda-wcyc.github.io";
const TABS = ["全部", "市場觀察", "美股", "台股", "AI泡沫", "總經", "簡報", "專題"];

export default function Archive() {
  const [all, setAll] = useState(null); // null=載入中, []=空, false=失敗
  const [f, setF] = useState("全部");

  useEffect(() => {
    fetch(BASE + "/-/reports.json", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw 0;
        return r.json();
      })
      .then((d) => {
        const rows = (d.history || [])
          .slice()
          .sort((a, b) => b.date.localeCompare(a.date));
        setAll(rows);
      })
      .catch(() => setAll(false));
  }, []);

  const rows =
    Array.isArray(all) ? (f === "全部" ? all : all.filter((x) => x.cat === f)) : [];

  return (
    <>
      <div className="awrap">
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
              const title = x.file.replace(/\.html$/, "").replace(/_/g, " ");
              const showSum = x.summary && x.summary.indexOf("占位") === -1;
              return (
                <a
                  key={x.file}
                  className="item"
                  href={BASE + "/-/" + encodeURIComponent(x.file)}
                >
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
      <footer className="afoot">© 2026 Yoda Research｜本站內容不構成投資建議</footer>
    </>
  );
}
