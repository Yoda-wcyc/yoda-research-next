/* Yoda Research 安裝按鈕 · 報告載入器(樣式來自共用 yoda-btn.css → 全站統一) · 2026-08-09
   報告用<script src="yoda-install.js" defer>載入(同源相對路徑)。
   樣式不寫在這裡：載入 https://yoda-research-next.vercel.app/yoda-btn.css(首頁/報告/遊戲同一支)。
   跨網域無法直接觸發安裝→本鈕連到官網PWA,由官網 InstallApp 一鍵裝。
   放置優先：分享列(.share-bar)內→與「分享這份報告給朋友」並排(安裝在左);否則控制列下獨立一行;最後 fixed。 */
(function(){
  // 商標浮水印:注入全站共用正本(濃淡/大小改 yoda-wm.js 一處即同步報告+遊戲)
  if(!document.querySelector('script[data-yoda-wm]')){
    var wj=document.createElement('script');wj.src='https://yoda-research-next.vercel.app/yoda-wm.js';wj.defer=true;wj.setAttribute('data-yoda-wm','1');
    document.head.appendChild(wj);
  }
  var CSS='https://yoda-research-next.vercel.app/yoda-btn.css';
  if(!document.querySelector('link[data-yoda-btn]')){
    var l=document.createElement('link');l.rel='stylesheet';l.href=CSS;l.setAttribute('data-yoda-btn','1');
    document.head.appendChild(l);
  }
  if(document.querySelector('.yoda-btn'))return;
  var a=document.createElement('a');
  a.className='yoda-btn';a.href='https://yoda-research-next.vercel.app/?from=install';a.target='_blank';a.rel='noopener';
  a.innerHTML='<span class="ic">⊕</span>安裝 Yoda Research 到桌面';
  var placed=false;
  function place(){
    if(placed)return true;
    var sb=document.querySelector('.share-bar');
    if(sb){ a.classList.add('yoda-btn-inbar'); sb.insertBefore(a, sb.firstChild); placed=true; return true; }  // 與分享鈕並排(安裝在左)
    var cb=document.querySelector('.controls-bar');
    if(cb&&cb.parentNode){ var row=document.createElement('div');row.className='yoda-btn-row';row.appendChild(a);cb.parentNode.insertBefore(row,cb.nextSibling); placed=true; return true; }
    return false;
  }
  if(!place()){
    var n=0,t=setInterval(function(){ if(place()||++n>20){ clearInterval(t); if(!placed){ a.classList.add('yoda-btn-fix'); document.body.appendChild(a); } } },100);
  }
})();
