/* Yoda Research 遊戲：每畫面商標 ＋ 結尾安裝鈕 · 集中正本(改這一支→全遊戲同步) · 2026-08-08
   遊戲用<script src="yoda-game-badge.js" defer>載入(同源相對路徑)。 色=C靛藍#6366f1 */
(function(){
  if(document.getElementById('yoda-gb-style'))return;
  var st=document.createElement('style');st.id='yoda-gb-style';
  st.textContent=
    /* 商標（fixed·每畫面·低調） */
    ".yoda-wm{position:fixed;left:11px;top:11px;z-index:9998;display:inline-flex;align-items:center;gap:5px;font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif;font-size:11px;font-weight:700;letter-spacing:.03em;color:rgba(255,255,255,.4);text-decoration:none;text-shadow:0 1px 3px rgba(0,0,0,.45);transition:color .15s;pointer-events:auto}"
    +".yoda-wm:hover{color:rgba(255,255,255,.78)}"
    +".yoda-wm .dot{width:6px;height:6px;border-radius:50%;background:#6366f1;box-shadow:0 0 6px rgba(99,102,241,.7);flex:0 0 auto}"
    /* 結尾安裝鈕 */
    +".yoda-ginstall{display:flex;align-items:center;justify-content:center;gap:6px;width:-moz-fit-content;width:fit-content;max-width:90%;margin:24px auto 20px;padding:10px 24px;font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif;font-size:14px;font-weight:700;letter-spacing:.02em;color:#fff;background:#6366f1;border:none;border-radius:9999px;text-decoration:none;box-shadow:0 5px 18px rgba(99,102,241,.45);cursor:pointer;transition:filter .15s,transform .15s}"
    +".yoda-ginstall:hover{filter:brightness(1.1);transform:translateY(-1px)}"
    +".yoda-ginstall .ic{font-weight:800;font-size:1.05em}";
  document.head.appendChild(st);
  // 商標：每一個畫面都在（fixed）
  if(!document.querySelector('.yoda-wm')){
    var wm=document.createElement('a');wm.className='yoda-wm';wm.href='https://yoda-research-next.vercel.app/';wm.target='_blank';wm.rel='noopener';
    wm.innerHTML='<span class="dot"></span>Yoda Research';document.body.appendChild(wm);
  }
  // 安裝鈕：放遊戲最後（append 到 body 末端，內容流的最下方）
  if(!document.querySelector('.yoda-ginstall')){
    var a=document.createElement('a');a.className='yoda-ginstall';a.href='https://yoda-research-next.vercel.app/?from=install';a.target='_blank';a.rel='noopener';
    a.innerHTML='<span class="ic">⊕</span>安裝 Yoda Research 到桌面';document.body.appendChild(a);
  }
})();
