/* Yoda Research 商標浮水印 · 全站唯一正本(報告 + 遊戲共用) · 2026-08-10
   ▍改「濃淡 OPACITY / 大小 WFRAC·WMAX」這一支即全站同步(所有報告 + 所有遊戲)。
   載入方式:報告由 yoda-install.js 注入、遊戲由 yoda-game-badge.js 注入(兩者皆載本檔)。
   置中規則:頁面有內容欄(main / .main)→ 置中內容欄(避開左側 NAV);否則 → 置中 viewport。
   主題換圖:深色主題用 title-dark.png(淺色字)、淺色主題用 title-light.png(深色字),切深/淺即時換。
   opt-out:<html data-no-wm> 或 window.__noYodaWm=1 的頁面不顯示浮水印(hub 索引站用此排除)。 */
(function(){
  var OPACITY = 0.02;              // ← 濃淡(全站統一;數字越小越淡)
  var WFRAC   = 0.60;              // ← 大小:寬 = 內容欄寬 × WFRAC
  var WMAX    = 620;              // ← 大小上限(px)
  var BASE='https://yoda-research-next.vercel.app/';
  var IMG_DARK = BASE+'yoda-research-title-dark.png';   // 深色主題(淺色字)
  var IMG_LIGHT= BASE+'yoda-research-title-light.png';  // 淺色主題(深色字)

  function isLight(){
    var h=document.documentElement, b=document.body;
    var dt=h.getAttribute('data-theme');
    if(dt==='light') return true;
    if(dt==='dark')  return false;
    if(b && b.classList.contains('light')) return true;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  }
  function pickSrc(){ return isLight()?IMG_LIGHT:IMG_DARK; }

  function build(){
    if(window.__noYodaWm || document.documentElement.hasAttribute('data-no-wm')) return;   // opt-out(hub;無<html>標籤的頁用 window 旗標)
    if(document.querySelector('.yoda-wm')) return;                     // idempotent
    if(!document.getElementById('yoda-wm-style')){
      var st=document.createElement('style');st.id='yoda-wm-style';
      st.textContent='.yoda-wm{position:fixed;top:50%;transform:translate(-50%,-50%);z-index:40;height:auto;pointer-events:none;user-select:none}';
      document.head.appendChild(st);
    }
    var host=document.querySelector('main,.main')||document.body;      // 內容欄;無則全寬(遊戲)
    var wm=document.createElement('img');
    wm.className='yoda-wm';wm.alt='';wm.setAttribute('aria-hidden','true');
    wm.style.opacity=OPACITY; wm.src=pickSrc();
    document.body.appendChild(wm);
    function place(){
      var r=host.getBoundingClientRect(); if(!r.width) return;
      wm.style.left=(r.left+r.width/2)+'px';
      wm.style.width=Math.min(r.width*WFRAC, WMAX)+'px';
    }
    place(); if(!wm.complete) wm.addEventListener('load',place); addEventListener('resize',place);

    // 主題切換即時換圖(深/淺鈕改 data-theme 或 body.light)
    var mo=new MutationObserver(function(){ var s=pickSrc(); if(wm.src!==s) wm.src=s; });
    mo.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    if(document.body) mo.observe(document.body,{attributes:true,attributeFilter:['class']});
  }

  if(document.body) build(); else document.addEventListener('DOMContentLoaded',build);
})();
