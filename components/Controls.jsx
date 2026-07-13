"use client";
import { useState } from "react";

const SIZES = [
  ["sm", "小"],
  ["md", "中"],
  ["lg", "大"],
];
const THEMES = [
  ["dark", "深"],
  ["light", "淺"],
];

export default function Controls() {
  const [size, setSize] = useState("md");
  const [theme, setTheme] = useState("dark");

  const applySize = (s) => {
    document.documentElement.setAttribute("data-size", s);
    setSize(s);
  };
  const applyTheme = (t) => {
    document.documentElement.setAttribute("data-theme", t);
    setTheme(t);
  };

  return (
    <nav className="ctrl" aria-label="頁面控制">
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
        粉專
      </a>
<span className="ctrl-sep"></span>
      {SIZES.map(([v, label]) => (
        <button key={v} className={size === v ? "on" : ""} onClick={() => applySize(v)}>
          {label}
        </button>
      ))}
      <span className="ctrl-sep"></span>
      {THEMES.map(([v, label]) => (
        <button key={v} className={theme === v ? "on" : ""} onClick={() => applyTheme(v)}>
          {label}
        </button>
      ))}
    </nav>
  );
}
