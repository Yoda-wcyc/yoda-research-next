/* Yoda Research 遊戲：商標浮水印(共用 yoda-wm.js)＋結尾安裝鈕 · 集中正本(改這一支→全遊戲同步) · 2026-08-10
   遊戲用<script src="yoda-game-badge.js" defer>載入(同源相對路徑)。
   浮水印濃淡/大小統一由 yoda-wm.js 管(報告/遊戲同一支正本);安裝鈕樣式來自共用 yoda-btn.css。 */
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
  // 安裝鈕：放遊戲最後（append 到 body 末端，內容流的最下方）·置中容器
  if(!document.querySelector('.yoda-btn')){
    var row=document.createElement('div');row.className='yoda-btn-center';
    var a=document.createElement('a');a.className='yoda-btn';a.href='https://yoda-research-next.vercel.app/?from=install';a.target='_blank';a.rel='noopener';
    a.innerHTML='<span class="ic">⊕</span>安裝 Yoda Research 到桌面';
    row.appendChild(a);document.body.appendChild(row);
  }
})();
