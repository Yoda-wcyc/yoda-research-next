"use client";
import { useEffect, useMemo, useRef, useState } from "react";

// /ta「波浪」分頁（2026-11-24）：會員版「專題研究_波浪理論」的互動波浪圖表原樣搬過來（/api/ta-wave，lib/ta-wave.js 切片）
// 跟 IdxView 不同：iframe 只開 allow-scripts（opaque origin，父頁碰不到 contentDocument）→ 高度、深淺都走 postMessage。
//   iframe → 父頁 {type:'ta-wave-h', h}；父頁 → iframe {type:'ta-wave-theme', theme:'light'|'dark'}
// props：call／gate＝page.jsx 的同名函式（need-login 換票重試、閘門處理）
const isLight = () => document.documentElement.getAttribute("data-theme") === "light";
let memo = null;   // shortcut: 抓到一次就留在這個分頁的記憶體，切回 K 線再切回來不重抓；要看新報告重新整理頁面

export default function WaveView({ call, gate }) {
  const [x, setX] = useState(memo);
  const ifr = useRef(null);
  useEffect(() => {
    if (x && !x.error) return;
    let live = true;
    call("/api/ta-wave", {}).then((j) => {
      if (!live || gate(j)) return;
      if (j.ok) memo = { date: j.date, html: j.html };
      setX(j.ok ? memo : { error: j.error || "讀取失敗" });
    });
    return () => { live = false; };
  }, [call, gate]);   // x 故意不放進相依：拿到了就不再抓（同 page.jsx 指數位階）
  const doc = useMemo(() => (x && x.html ? x.html.replace('data-theme="dark"', 'data-theme="' + (isLight() ? "light" : "dark") + '"') : ""), [x]);
  useEffect(() => {
    const onMsg = (e) => {
      const f = ifr.current, d = e.data;
      if (f && e.source === f.contentWindow && d && d.type === "ta-wave-h" && d.h > 0) f.style.height = Math.ceil(d.h) + "px";
    };
    window.addEventListener("message", onMsg);
    const mo = new MutationObserver(() => {   // 站內深淺切換：不重載 iframe（tab、數法、時間區段不跑掉）
      const w = ifr.current && ifr.current.contentWindow;
      if (w) w.postMessage({ type: "ta-wave-theme", theme: isLight() ? "light" : "dark" }, "*");
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { window.removeEventListener("message", onMsg); mo.disconnect(); };
  }, []);
  if (!x) return <div className="ta-ph">讀取中…</div>;
  if (x.error) return <div className="ta-err"><span>{x.error}</span></div>;
  return (
    <div className="ta-idx">
      <div className="ta-notes">內容同專題研究「波浪理論」{x.date} 會員版互動圖</div>
      <iframe ref={ifr} className="ta-idxf" title="波浪" sandbox="allow-scripts" srcDoc={doc} />
    </div>
  );
}
