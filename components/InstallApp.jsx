"use client";
import { useEffect, useState } from "react";

export default function InstallApp() {
  const [deferred, setDeferred] = useState(null); // Android/Chrome 安裝事件
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // 已在 App 內或已安裝 → 不顯示
    if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
      setInstalled(true);
      return;
    }
    const ua = window.navigator.userAgent;
    setIsIOS(/iPhone|iPad|iPod/i.test(ua));
    if (window.__bip) setDeferred(window.__bip); // 補收 React 掛載前就發出的事件
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;
  if (!deferred && !isIOS) return null; // 環境不支援就整顆隱藏

  const click = async () => {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") setInstalled(true);
      setDeferred(null);
    } else {
      setShowIOSGuide(true);
    }
  };

  return (
    <>
      <button className="btn btn-gold breathe install-btn" onClick={click}>
        📲 安裝 App 到主畫面
      </button>
      {showIOSGuide && (
        <div className="ios-guide" role="dialog" aria-label="加入主畫面教學" onClick={() => setShowIOSGuide(false)}>
          <div className="ios-card" onClick={(e) => e.stopPropagation()}>
            <h3>兩步驟加到主畫面</h3>
            <ol>
              <li>點 Safari 下方的 <b>分享</b> 按鈕(方框加向上箭頭)</li>
              <li>往下捲,點 <b>「加入主畫面」</b></li>
            </ol>
            <p className="ios-note">之後從桌面的 Yoda 圖示開啟,就是全螢幕 App 體驗。</p>
            <button className="btn btn-gold" onClick={() => setShowIOSGuide(false)}>知道了</button>
          </div>
        </div>
      )}
    </>
  );
}
