/* Yoda Research 安裝按鈕 · 集中正本(改這一支→全報告同步) · 2026-08-08
   報告用<script src="yoda-install.js" defer>載入(同源相對路徑)。
   跨網域無法直接觸發安裝→本鈕連到官網PWA,由官網 InstallApp 一鍵裝。 色=C靛藍#6366f1 */
(function(){
  if(document.getElementById('yoda-install-style'))return;
  var st=document.createElement('style');st.id='yoda-install-style';
  st.textContent=
    ".yoda-install{display:flex;align-items:center;gap:5px;width:-moz-fit-content;width:fit-content;margin:10px 0 4px;padding:6px 15px;font-family:var(--fb,'Noto Sans TC',system-ui,sans-serif);font-size:12px;font-weight:700;letter-spacing:.02em;color:#fff;background:rgba(255,255,255,.10);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.24);border-radius:9999px;text-decoration:none;box-shadow:0 4px 16px rgba(0,0,0,.20);white-space:nowrap;transition:background .15s,transform .15s;z-index:60;cursor:pointer}"
    +".yoda-install:hover{background:rgba(255,255,255,.17);transform:translateY(-1px)}"
    +".yoda-install .ic{font-weight:800;font-size:1.05em;color:#a5b4fc}"
    +".yoda-install-fix{position:fixed;bottom:14px;left:14px;top:auto;right:auto;margin:0;font-size:11px;padding:5px 12px;opacity:.92}"
    +".yoda-install-fix:hover{opacity:1}"
    +"@media(max-width:700px){.yoda-install-fix{bottom:10px;left:10px;font-size:10px;padding:4px 11px}}";
  document.head.appendChild(st);
  if(document.querySelector('.yoda-install'))return;
  var a=document.createElement('a');
  a.className='yoda-install';a.href='https://yoda-research-next.vercel.app/?from=install';a.target='_blank';a.rel='noopener';
  a.innerHTML='<span class="ic">⊕</span>安裝 Yoda Research';
  var cb=document.querySelector('.controls-bar');
  if(cb&&cb.parentNode){cb.parentNode.insertBefore(a,cb.nextSibling);}
  else{a.classList.add('yoda-install-fix');document.body.appendChild(a);}
})();
