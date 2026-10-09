/* Yoda Research 遊戲：商標浮水印(共用 yoda-wm.js)＋結尾安裝鈕 · 集中正本(改這一支→全遊戲同步) · 2026-08-10
   遊戲用<script src="yoda-game-badge.js" defer>載入(同源相對路徑)。
   浮水印濃淡/大小統一由 yoda-wm.js 管(報告/遊戲同一支正本);安裝鈕樣式來自共用 yoda-btn.css。 */
(function(){
  // 商標浮水印:注入全站共用正本(濃淡/大小改 yoda-wm.js 一處即同步報告+遊戲)
  if(!document.querySelector('script[data-yoda-wm]')){
    var wj=document.createElement('script');wj.src='https://yoda-research-next.vercel.app/yoda-wm.js';wj.defer=true;wj.setAttribute('data-yoda-wm','1');
    document.head.appendChild(wj);
  }
  // 語言切換「繁體中文｜English」(2026-10-09)：遊戲沒有功能列 → 共用 yoda-lang.js 的小浮動鈕，放左下角
  // (31 頁實測:右上是靜音鈕、左上有重來鈕/計數器,左下全空)。英文模式的機翻提示改貼在按鈕上方、10 秒後自動淡出,不擋遊戲。
  // 載入器先載 hub 共用正本,載不到退回 B 網域鏡像;頁面若自己已載 yoda-lang.js 就不重複。
  if(!window.YodaLang && !document.querySelector('script[data-yoda-lang-boot]')){
    var lb=document.createElement('script');lb.src='https://yoda-research-next.vercel.app/yoda-lang-boot.js';lb.async=true;
    lb.setAttribute('data-yoda-lang-boot','1');lb.setAttribute('data-float','bottom-left');lb.setAttribute('data-game','1');
    document.head.appendChild(lb);
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
