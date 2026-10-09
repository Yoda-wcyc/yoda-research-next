"use client";
import { useEffect, useState } from "react";

// 偏好記憶鍵與 A 網域（hub／報告）同名：yoda-size（sm/md/lg）、yoda-theme（dark/light）、yoda-lang（zh/en）
// A、B 兩網域 localStorage 不互通；跨網域靠連結帶 ?lang=（yoda-lang.js 委派處理）。
const K_SIZE = "yoda-size";
const K_THEME = "yoda-theme";

const SIZES = [
  ["sm", "小", "S"],
  ["md", "中", "M"],
  ["lg", "大", "L"],
];
const THEMES = [
  ["dark", "深", "Dark"],
  ["light", "淺", "Light"],
];

function lsGet(k) {
  try { return localStorage.getItem(k); } catch (e) { return null; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, v); } catch (e) {}
}

export default function Controls() {
  const [size, setSize] = useState("md");
  const [theme, setTheme] = useState("dark");
  const [lang, setLang] = useState("zh");

  useEffect(() => {
    // 讀回讀者上次的字級／深淺（layout 的 head 內聯腳本已先套到 <html>，這裡同步按鈕狀態）
    const s = lsGet(K_SIZE), t = lsGet(K_THEME);
    if (s === "sm" || s === "md" || s === "lg") { document.documentElement.setAttribute("data-size", s); setSize(s); }
    if (t === "dark" || t === "light") { document.documentElement.setAttribute("data-theme", t); setTheme(t); }

    // 語言切換：共用 yoda-lang.js（hub 正本，載不到退回本站鏡像）——hydration 之後才載，避免它改 DOM 撞到 React 對帳。
    // 按鈕組由腳本放進下面的 [data-yoda-lang-slot]；?lang= 讀寫、記憶鍵 yoda-lang、跨網域連結帶語言都在腳本裡。
    const onLang = (e) => setLang(e && e.detail && e.detail.lang === "en" ? "en" : "zh");
    document.addEventListener("yoda-lang-change", onLang);
    if (window.YodaLang) setLang(window.YodaLang.get() === "en" ? "en" : "zh");
    else if (!document.querySelector("script[data-yoda-lang-boot]")) {
      const sc = document.createElement("script");
      sc.src = "/yoda-lang-boot.js";
      sc.async = true;
      sc.setAttribute("data-yoda-lang-boot", "1");
      document.head.appendChild(sc);
    }
    return () => document.removeEventListener("yoda-lang-change", onLang);
  }, []);

  const applySize = (s) => {
    document.documentElement.setAttribute("data-size", s);
    lsSet(K_SIZE, s);
    setSize(s);
  };
  const applyTheme = (t) => {
    document.documentElement.setAttribute("data-theme", t);
    lsSet(K_THEME, t);
    setTheme(t);
  };
  const en = lang === "en";

  return (
    <nav className="ctrl notranslate" translate="no" aria-label={en ? "Page controls" : "頁面控制"}>
      <a
        href="https://www.facebook.com/profile.php?id=100069223220386"
        target="_blank"
        rel="noopener"
        className="ctrl-fan"
        title="Facebook粉專"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.791-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.268h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
        </svg>
        <span>{en ? "Facebook" : "粉專"}</span>
      </a>
      <span className="ctrl-sep"></span>
      {SIZES.map(([v, zh, eng]) => (
        <button key={v} className={size === v ? "on" : ""} onClick={() => applySize(v)}>
          {en ? eng : zh}
        </button>
      ))}
      <span className="ctrl-sep"></span>
      {THEMES.map(([v, zh, eng]) => (
        <button key={v} className={theme === v ? "on" : ""} onClick={() => applyTheme(v)}>
          {en ? eng : zh}
        </button>
      ))}
      <span className="ctrl-sep ctrl-lang-sep"></span>
      {/* yoda-lang.js 把「繁體中文｜English」兩顆鈕 append 進來（React 不渲染這格的子節點，不會互相覆蓋） */}
      <span className="ctrl-lang" data-yoda-lang-slot="" data-btn-class="ctrl-lang-btn"></span>
    </nav>
  );
}
