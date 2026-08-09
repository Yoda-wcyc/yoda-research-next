"use client";
import { useEffect, useState } from "react";

export default function InstallApp() {
  const [deferred, setDeferred] = useState(null); // Android/Chrome/桌面 安裝事件
  const [isIOS, setIsIOS] = useState(false);
  const [showGuide, setShowGuide] = useState(false); // 不支援直接安裝時→顯示手動指引
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
      setInstalled(true);
      return;
    }
    setIsIOS(/iPhone|iPad|iPod/i.test(window.navigator.userAgent));
    if (window.__bip) setDeferred(window.__bip); // 補收 React 掛載前就發出的事件
    const onPrompt = (e) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null; // 已安裝就不再顯示

  const click = async () => {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") setInstalled(true);
      setDeferred(null);
    } else {
      setShowGuide(true); // iOS 或桌面尚未觸發安裝事件→給手動步驟
    }
  };

  return (
    <>
      <button className="install-btn" onClick={click}>
        <span className="ic">⊕</span> 安裝 Yoda Research 到桌面
      </button>
      {showGuide && (
        <div className="ios-guide" role="dialog" aria-label="安裝教學" onClick={() => setShowGuide(false)}>
          <div className="ios-card" onClick={(e) => e.stopPropagation()}>
            {isIOS ? (
              <>
                <h3>兩步驟加到主畫面</h3>
                <ol>
                  <li>點 Safari 下方的 <b>分享</b> 按鈕（方框加向上箭頭）</li>
                  <li>往下捲，點 <b>「加入主畫面」</b></li>
                </ol>
                <p className="ios-note">之後從桌面的 Yoda 圖示開啟，就是全螢幕 App 體驗。</p>
              </>
            ) : (
              <>
                <h3>把 Yoda Research 裝到桌面</h3>
                <ol>
                  <li>看瀏覽器<b>網址列右側</b>的<b>安裝圖示（⊕ 或螢幕圖示）</b>，點它</li>
                  <li>或點瀏覽器 <b>⋮ 選單 → 「安裝 Yoda Research…」</b></li>
                </ol>
                <p className="ios-note">裝好後桌面／開始選單會有 Yoda Research App 圖示，開起來像獨立 App。</p>
              </>
            )}
            <button className="install-btn" onClick={() => setShowGuide(false)}>知道了</button>
          </div>
        </div>
      )}
    </>
  );
}
