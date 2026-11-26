"use client";
import { useEffect, useMemo, useRef, useState } from "react";

// /ta「多空波段」分頁（2026-11-26 Yoda：不放報告，整個搬到 /ta）：/api/ta-swing op:'page' 回完整頁 → iframe srcdoc（同 IdxView：同源、不加 sandbox，父頁量高度、換深淺）
// 外觀：外殼讀 localStorage ck-theme（同源共用）→ 進來前先寫成 /ta 現在的亮暗；之後 /ta 切換就點 iframe 裡的 .sw-th（外殼自己的切換鈕已藏起來）
const isLight = () => document.documentElement.getAttribute("data-theme") === "light";
const theme = () => (isLight() ? "light" : "dark");

function Frame({ html }) {
  const ifr = useRef(null);
  const doc = useMemo(() => { try { localStorage.setItem("ck-theme", theme()); } catch (e) {} return html; }, [html]);
  useEffect(() => {
    const mo = new MutationObserver(() => {
      const d = ifr.current && ifr.current.contentDocument, b = d && d.querySelector('.sw-th[data-v="' + theme() + '"]');
      if (b) b.click();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  const onLoad = () => {   // 高度跟內容走（展開層、切分頁會變高），iframe 自己不出捲軸
    const f = ifr.current, w = f && f.contentWindow;
    if (!w || !w.document.body) return;
    const b = w.document.body;
    const fit = () => { f.style.height = Math.ceil(b.scrollHeight) + "px"; };
    new w.ResizeObserver(fit).observe(b);
    fit();
  };
  return <iframe ref={ifr} className="ta-idxf ta-swf" title="多空波段" srcDoc={doc} onLoad={onLoad} />;
}

export default function SwingView({ call, gate }) {
  const [x, setX] = useState(null);
  useEffect(() => {
    if (x) return;   // 失敗按重試＝清成 null 才再抓
    let live = true;
    call("/api/ta-swing", { op: "page" }).then((j) => {
      if (!live || gate(j)) return;
      setX(j.ok ? { through: j.through, html: j.html } : { error: j.error || "讀取失敗" });
    });
    return () => { live = false; };
  }, [x, call, gate]);
  if (!x) return <div className="ta-ph">讀取中…</div>;
  if (x.error) return <div className="ta-err" role="alert"><span>{x.error}</span><button type="button" className="ta-btn" onClick={() => setX(null)}>重試</button></div>;
  return (
    <div className="ta-idx">
      <div className="ta-notes">資料到 {x.through} 收盤</div>
      <Frame html={x.html} />
    </div>
  );
}
