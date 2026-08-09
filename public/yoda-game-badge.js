/* Yoda Research 遊戲：每畫面商標 ＋ 結尾安裝鈕 · 集中正本(改這一支→全遊戲同步) · 2026-08-08
   遊戲用<script src="yoda-game-badge.js" defer>載入(同源相對路徑)。 色=C靛藍#6366f1 */
(function(){
  if(document.getElementById('yoda-gb-style'))return;
  var st=document.createElement('style');st.id='yoda-gb-style';
  st.textContent=
    /* 浮水印（wordmark 圖·大·置中·最上層·幾乎透明·pointer-events:none 不擋不影響·每一幕都在） */
    ".yoda-wm{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483000;width:min(64vw,780px);max-width:84vw;height:auto;opacity:.04;pointer-events:none;user-select:none}"
    /* 結尾安裝鈕 */
    +".yoda-ginstall{display:flex;align-items:center;justify-content:center;gap:6px;width:-moz-fit-content;width:fit-content;max-width:90%;margin:24px auto 20px;padding:10px 24px;font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif;font-size:14px;font-weight:700;letter-spacing:.02em;color:#fff;background:#6366f1;border:none;border-radius:9999px;text-decoration:none;box-shadow:0 5px 18px rgba(99,102,241,.45);cursor:pointer;transition:filter .15s,transform .15s}"
    +".yoda-ginstall:hover{filter:brightness(1.1);transform:translateY(-1px)}"
    +".yoda-ginstall .ic{font-weight:800;font-size:1.05em}";
  document.head.appendChild(st);
  // 浮水印：wordmark 圖·置中·最上層·幾乎透明（每一幕都在）
  if(!document.querySelector('.yoda-wm')){
    var wm=document.createElement('img');wm.className='yoda-wm';wm.alt='';wm.setAttribute('aria-hidden','true');
    wm.src='https://yoda-research-next.vercel.app/yoda-research-title-dark.png';
    document.body.appendChild(wm);
  }
  // 安裝鈕：放遊戲最後（append 到 body 末端，內容流的最下方）
  if(!document.querySelector('.yoda-ginstall')){
    var a=document.createElement('a');a.className='yoda-ginstall';a.href='https://yoda-research-next.vercel.app/?from=install';a.target='_blank';a.rel='noopener';
    a.innerHTML='<span class="ic">⊕</span>安裝 Yoda Research 到桌面';document.body.appendChild(a);
  }
})();
