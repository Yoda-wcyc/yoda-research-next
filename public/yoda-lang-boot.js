/* Yoda 語言切換 · 載入器（B 網域首頁／遊戲共用）· 2026-10-09
   先載 hub 共用正本 https://yoda-wcyc.github.io/-/yoda-lang.js；
   載不到（尚未推上線／暫時故障）才退回本站鏡像 https://yoda-research-next.vercel.app/yoda-lang.js。
   共用版上線後不必改任何頁面——這支會自動用共用版。
   設定：本檔 <script> 上的 data-float / data-mode / data-hosts 會轉交給 yoda-lang.js
   （頁面若已自行設 window.YODA_LANG_CONFIG 則以頁面為準）；data-game="1" 套遊戲版提示位置。
   遊戲：yoda-game-badge.js 會自動載入本檔；沒掛 badge 的遊戲直接放
     <script src="https://yoda-research-next.vercel.app/yoda-lang-boot.js" data-float="bottom-left" data-game="1" defer></script> */
(function () {
  if (window.YodaLang || window.__yodaLangBoot) return;
  window.__yodaLangBoot = 1;
  var me = document.currentScript;
  if (me && !window.YODA_LANG_CONFIG) {
    var c = {};
    ['float', 'mode', 'hosts'].forEach(function (k) { var v = me.getAttribute('data-' + k); if (v) c[k] = v; });
    window.YODA_LANG_CONFIG = c;
  }
  // 遊戲頁（data-game="1"）：浮動鈕貼左下角；英文模式的機翻提示改貼在按鈕上方、10 秒後自動淡出，不擋遊戲操作
  if (me && me.getAttribute('data-game') && !document.getElementById('yoda-game-lang-css')) {
    var gs = document.createElement('style'); gs.id = 'yoda-game-lang-css';
    gs.textContent = '.lt-float.lt-pos-bottom-left{bottom:10px;left:10px}.lt-float.lt-pos-top-left{top:10px;left:10px}'
      + '.lt-note{top:auto!important;bottom:52px;left:10px;right:auto;max-width:min(320px,calc(100vw - 20px))}'
      + '.lt-note.lt-show{animation:ytLtNote .5s ease 10s forwards}'
      + '@keyframes ytLtNote{to{opacity:0;visibility:hidden}}';
    (document.head || document.documentElement).appendChild(gs);
  }
  var SHARED ='https://yoda-wcyc.github.io/-/yoda-lang.js';
  var MIRROR = 'https://yoda-research-next.vercel.app/yoda-lang.js';
  try { if (location.host === 'yoda-research-next.vercel.app' || /^localhost(:\d+)?$/.test(location.host)) MIRROR = '/yoda-lang.js'; } catch (e) {}
  function add(src, onerr) {
    var s = document.createElement('script');
    s.src = src; s.async = true;
    if (onerr) s.onerror = onerr;
    (document.head || document.documentElement).appendChild(s);
  }
  add(SHARED, function () { if (!window.YodaLang) add(MIRROR); });
})();
