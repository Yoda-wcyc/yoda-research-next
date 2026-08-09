/* Yoda Research 遊戲：每畫面浮水印 ＋ 結尾安裝鈕 · 集中正本(改這一支→全遊戲同步) · 2026-08-08
   遊戲用<script src="yoda-game-badge.js" defer>載入(同源相對路徑)。
   安裝鈕樣式來自共用 yoda-btn.css(首頁/報告/遊戲同一支)；本檔只管浮水印＋放置。 */
(function(){
  var CSS='https://yoda-research-next.vercel.app/yoda-btn.css';
  if(!document.querySelector('link[data-yoda-btn]')){
    var l=document.createElement('link');l.rel='stylesheet';l.href=CSS;l.setAttribute('data-yoda-btn','1');
    document.head.appendChild(l);
  }
  if(!document.getElementById('yoda-gb-style')){
    var st=document.createElement('style');st.id='yoda-gb-style';
    /* 浮水印（wordmark 圖·大·置中·最上層·幾乎透明·pointer-events:none 不擋不影響·每一幕都在） */
    st.textContent=".yoda-wm{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483000;width:min(64vw,780px);max-width:84vw;height:auto;opacity:.04;pointer-events:none;user-select:none}";
    document.head.appendChild(st);
  }
  // 浮水印：wordmark 圖·置中·最上層·幾乎透明（每一幕都在）
  if(!document.querySelector('.yoda-wm')){
    var wm=document.createElement('img');wm.className='yoda-wm';wm.alt='';wm.setAttribute('aria-hidden','true');
    wm.src='https://yoda-research-next.vercel.app/yoda-research-title-dark.png';
    document.body.appendChild(wm);
  }
  // 安裝鈕：放遊戲最後（append 到 body 末端，內容流的最下方）·置中容器
  if(!document.querySelector('.yoda-btn')){
    var row=document.createElement('div');row.className='yoda-btn-center';
    var a=document.createElement('a');a.className='yoda-btn';a.href='https://yoda-research-next.vercel.app/?from=install';a.target='_blank';a.rel='noopener';
    a.innerHTML='<span class="ic">⊕</span>安裝 Yoda Research 到桌面';
    row.appendChild(a);document.body.appendChild(row);
  }
})();
