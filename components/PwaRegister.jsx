"use client";
import { useEffect } from "react";
export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // 新版 SW 接手（controllerchange）時重新載入，換掉舊版程式；全新安裝（原本沒有 controller）不重載。
    // sessionStorage 記上次重載時間，30 秒內不再重載，避免來回重載。
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!had) return;
      try {
        const last = Number(sessionStorage.getItem("yoda_sw_reload") || 0);
        if (Date.now() - last < 30000) return;
        sessionStorage.setItem("yoda_sw_reload", String(Date.now()));
      } catch (e) { return; }
      location.reload();
    });
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
