/* Yoda Research 安裝按鈕 · 報告載入器(樣式來自共用 yoda-btn.css → 全站統一) · 2026-08-08
   報告用<script src="yoda-install.js" defer>載入(同源相對路徑)。
   樣式不寫在這裡：載入 https://yoda-research-next.vercel.app/yoda-btn.css(首頁/報告/遊戲同一支)。
   跨網域無法直接觸發安裝→本鈕連到官網PWA,由官網 InstallApp 一鍵裝。 */
(function(){
  var CSS='https://yoda-research-next.vercel.app/yoda-btn.css';
  if(!document.querySelector('link[data-yoda-btn]')){
    var l=document.createElement('link');l.rel='stylesheet';l.href=CSS;l.setAttribute('data-yoda-btn','1');
    document.head.appendChild(l);
  }
  if(document.querySelector('.yoda-btn'))return;
  var a=document.createElement('a');
  a.className='yoda-btn';a.href='https://yoda-research-next.vercel.app/?from=install';a.target='_blank';a.rel='noopener';
  a.innerHTML='<span class="ic">⊕</span>安裝 Yoda Research 到桌面';
  var cb=document.querySelector('.controls-bar');
  if(cb&&cb.parentNode){
    var row=document.createElement('div');row.className='yoda-btn-row';row.appendChild(a);
    cb.parentNode.insertBefore(row,cb.nextSibling);
  }else{
    a.classList.add('yoda-btn-fix');document.body.appendChild(a);
  }
})();
