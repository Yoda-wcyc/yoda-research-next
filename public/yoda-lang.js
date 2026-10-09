/* 【B 網域備援鏡像】正本在 hub：https://yoda-wcyc.github.io/-/yoda-lang.js（G:\Yoda x Claude\_deploy\hub\yoda-lang.js）。
   本檔只在共用版載不到時由 yoda-lang-boot.js 退回載入；共用版上線且穩定後可刪除本檔。不要在這裡改邏輯——改 hub 正本再重新複製。 */
/* ============================================================
   Yoda 全站語言切換（繁體中文｜English）· 共用腳本 2026-10-09
   ------------------------------------------------------------
   載入（各網域、各頁面都用同一個網址）：
     <script src="https://yoda-wcyc.github.io/-/yoda-lang.js" defer></script>

   行為
   - 預設繁體中文：不載入任何翻譯 script、不送任何文字出去。
     讀者按 English 才動態載入 Google 網頁翻譯，整頁機器翻譯成英文；
     按「繁體中文」原字放回（還原不完整就整頁重新載入，中文原文是正本）。
   - 記憶鍵 localStorage['yoda-lang'] = 'zh' | 'en'（與 yoda-prefs.js 共用同一個鍵）。
   - 網址帶 ?lang=zh|en（也收 zh-TW／zh-Hant）時以它為準、寫回記憶鍵，
     再用 history.replaceState 把 lang 參數拿掉（之後重新整理就照記憶鍵走）。
   - 跨網域帶語言：點擊（含中鍵、右鍵另開）連到別的 Yoda 網域的 <a href>，
     點下去那一刻自動補上 ?lang=<目前語言>（document 層委派監聽，不必逐一改 href）。
     預設網域：yoda-wcyc.github.io、yoda-research-next.vercel.app；同網域連結不動。

   按鈕放哪裡（依序找，找到就用）
   1) 頁面上有 [data-yoda-lang-slot] 的元素 → 按鈕組 append 進去。
      之後才出現的容器（SPA 換頁、React 晚渲染）也會自動搬進去；容器被移除再出現會重掛。
      容器上可加 data-btn-class="ctrl-btn" 讓兩顆鈕套用頁面自己的按鈕 class。
      （例外：容器值為 "bar" 時，先找頁面控制列，找不到才把這個容器當浮動鈕用。）
   2) 頁面有深淺切換鈕（onclick 含 setTheme 或 [data-theme-btn]）→ 掛在那一列最後，
      樣式跟著那顆鈕的 class；.controls-bar 會多一條 .ctrl-sep 分隔。
   3) 都沒有 → 畫面角落一顆小浮動鈕（預設左下：不蓋到各頁置中的標題列；右下是 Yoda 頭像）。
   有掛到的控制列整列加 translate="no"（深/淺/小/中/大 等按鈕文字不被翻），並加 class "lt-host"：
   手機寬（≤600px）時該列允許換行、寬度不超過畫面（多了兩顆鈕也不會往左跑出螢幕）。

   設定（可選，二擇一；寫在載入本檔之前）
     window.YODA_LANG_CONFIG = { mode:'full'|'relay', float:'top-right'|'top-left'|'top-center'|
                                 'bottom-right'|'bottom-left'|'none', hosts:['額外網域', …] };
     或在 <script> 標籤上：data-mode="relay"、data-float="bottom-left"、data-hosts="a.com b.com"
   - mode 'relay'：不顯示按鈕、不翻譯，只做 ?lang 讀寫與跨網域連結帶語言
     （給外殼頁用：外殼本身不翻，按鈕在 iframe 裡的報告上）。

   全域 API：window.YodaLang
     YodaLang.get()          → 'zh' | 'en'（目前狀態）
     YodaLang.set('en'|'zh') → 切換（等同按鈕）
     YodaLang.mount(el)      → 把按鈕組搬進指定容器
     YodaLang.onChange(fn)   → fn(lang)；同時 document 會發 'yoda-lang-change' 事件（detail.lang）
     YodaLang.decorate(url)  → 回傳補上 ?lang= 的網址字串（給 JS 導頁用：location.href = YodaLang.decorate(u)）
   html 元素在英文模式會有 class "lt-en"（頁面 CSS 可依此切換人工英文字）。
   不想被翻的區塊：加 translate="no" 或 class="notranslate"。
   數字格、純文字圖（<pre> 含框線字）、SVG 圖上的字、分頁標題、常見名詞誤譯——本檔自動處理。
   React／Next.js：Google 翻譯會改動文字節點，React 之後再重繪那一段可能報錯；
   動態區塊請包 translate="no" 或在 onChange 收到 'en' 時避免整段重繪。
   ============================================================ */
(function () {
  if (window.YodaLang) return;
  var KEY = 'yoda-lang';
  var HOSTS = ['yoda-wcyc.github.io', 'yoda-research-next.vercel.app'];
  var me = document.currentScript;
  var cfg = window.YODA_LANG_CONFIG || {};
  function opt(k) { if (cfg[k] != null) return cfg[k]; var v = me && me.getAttribute('data-' + k); return v == null ? null : v; }
  var MODE = opt('mode') === 'relay' ? 'relay' : 'full';
  var FLOAT = opt('float') || 'bottom-left';
  var extra = opt('hosts');
  if (extra) HOSTS = HOSTS.concat(typeof extra === 'string' ? extra.split(/[\s,]+/) : extra);

  function norm(v) {
    v = String(v || '').toLowerCase();
    if (v === 'en' || v.indexOf('en-') === 0) return 'en';
    if (v === 'zh' || v === 'tw' || v.indexOf('zh-') === 0) return 'zh';
    return null;
  }
  function lsGet() {
    if (window.YodaPrefs && window.YodaPrefs.getLang) return window.YodaPrefs.getLang();
    try { return norm(localStorage.getItem(KEY)); } catch (e) { return null; }
  }
  function lsSet(v) {
    if (window.YodaPrefs && window.YodaPrefs.setLang) { window.YodaPrefs.setLang(v); return; }
    try { localStorage.setItem(KEY, v); } catch (e) {}
  }
  (function urlLang() {
    try {
      if (!location.search) return;
      var u = new URL(location.href), q = norm(u.searchParams.get('lang'));
      if (!u.searchParams.has('lang')) return;
      if (q) lsSet(q);
      u.searchParams.delete('lang');
      history.replaceState(history.state, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '') + u.hash);
    } catch (e) {}
  })();
  function cur() { return lsGet() || 'zh'; }

  var baseHost = '';
  try { baseHost = new URL(document.baseURI).host; } catch (e) {}
  function decorate(href) {
    var u;
    try { u = new URL(href, document.baseURI); } catch (e) { return href; }
    if (!/^https?:$/.test(u.protocol) || u.host === baseHost || u.host === location.host) return href;
    if (HOSTS.indexOf(u.hostname) < 0) return href;
    u.searchParams.set('lang', cur());
    return u.toString();
  }
  function onLink(ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a) return;
    var h = a.getAttribute('href');
    if (!h || h.charAt(0) === '#' || /^(javascript|mailto|tel):/i.test(h)) return;
    var d = decorate(h);
    if (d !== h) a.setAttribute('href', d);
  }
  ['mousedown', 'click', 'auxclick', 'contextmenu', 'touchstart', 'keydown'].forEach(function (t) {
    document.addEventListener(t, onLink, { capture: true, passive: true });
  });

  var subs = [];
  var api = {
    version: '2026-10-09',
    get: function () { return MODE === 'relay' ? cur() : want; },
    set: function (l) { l = norm(l); if (!l) return; if (MODE === 'relay') { lsSet(l); fire(l); return; } l === 'en' ? toEn() : toZh(); },
    mount: function (el) { if (el && grp) { if (!el.hasAttribute('data-yoda-lang-slot')) el.setAttribute('data-yoda-lang-slot', ''); place(el); } },
    onChange: function (fn) { if (typeof fn === 'function') subs.push(fn); },
    decorate: function (u) { return decorate(u); }
  };
  window.YodaLang = api;
  var lastFired = null;
  function fire(l) {
    if (l === lastFired) return; lastFired = l;
    subs.forEach(function (f) { try { f(l); } catch (e) {} });
    try { document.dispatchEvent(new CustomEvent('yoda-lang-change', { detail: { lang: l } })); } catch (e) {}
  }
  if (MODE === 'relay') return;
  if (window.__ltReady) { api.get = cur; return; }
  window.__ltReady = 1;

  var CSS = ''
    + '#lt-gte{display:none!important}'
    + '#lt-svgsrc{position:fixed;left:0;top:0;width:100vw;max-height:100vh;overflow:hidden;opacity:0;pointer-events:none;z-index:-1;display:flex;flex-wrap:wrap;gap:1px;font-size:4px;line-height:1}'
    + '.lt-group{display:flex;gap:2px;align-items:center}'
    + '.lt-group .lt-btn{white-space:nowrap;color:#e6ebf2!important}'
    + '.lt-group .lt-btn:hover{color:#fff!important}'
    + '.lt-group.lt-lightbg .lt-btn{color:#39424e!important}'
    + '.lt-group.lt-lightbg .lt-btn:hover{color:#11161d!important}'
    + ':root body .lt-group .lt-btn.lt-on{background:#fff!important;color:#1a1a1a!important;box-shadow:0 1px 3px rgba(0,0,0,.28)!important}'
    + '.lt-btn[aria-busy="true"]{cursor:progress;opacity:.75}'
    + '.lt-group .lt-btn.lt-plain{font:600 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC",sans-serif;background:transparent;border:none;border-radius:5px;padding:5px 9px;cursor:pointer;margin:0}'
    + '.lt-note{display:none;position:fixed;top:60px;right:20px;z-index:9998;max-width:420px;padding:4px 10px;border-radius:6px;font:600 11px/1.5 -apple-system,"Segoe UI",sans-serif;color:#1a1a1a;background:#f3e6b0;border:1px solid #c9a227;box-shadow:0 2px 8px rgba(0,0,0,.25)}'
    + '.lt-note.lt-show{display:block}'
    + '@media(max-width:600px){.lt-note{left:12px;right:12px;max-width:none}.lt-host{flex-wrap:wrap!important;justify-content:flex-end;row-gap:4px;max-width:calc(100vw - 40px)!important}}'
    + '.lt-float{position:fixed;z-index:9999;padding:4px 6px;border-radius:8px;background:rgba(13,17,24,.72);border:1px solid rgba(255,255,255,.14);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}'
    + '.lt-float.lt-pos-top-right{top:10px;right:12px}'
    + '.lt-float.lt-pos-top-left{top:10px;left:12px}'
    + '.lt-float.lt-pos-top-center{top:10px;left:0;right:0;margin:0 auto;width:max-content}'
    + '.lt-float.lt-pos-bottom-right{bottom:12px;right:12px}'
    + '.lt-float.lt-pos-bottom-left{bottom:12px;left:12px}'
    + 'body>.skiptranslate,body>iframe.skiptranslate,iframe.goog-te-banner-frame,.goog-te-banner-frame,#goog-gt-tt,.goog-te-balloon-frame,.goog-tooltip,.VIpgJd-ZVi9od-ORHb-OEVmcd,.VIpgJd-yAWNEb-L7lbkb,.VIpgJd-ZVi9od-aZ2wEe-wOHMyf{display:none!important}'
    + 'html.translated-ltr body,html.translated-rtl body{top:0!important}'
    + '.goog-text-highlight,.VIpgJd-yAWNEb-OQ5Gld{background:none!important;box-shadow:none!important}'
    + 'html.lt-en th{white-space:normal!important}'
    + 'html.lt-en .lt-term{margin:0 .22em}'
    + 'html.lt-en .lt-term.lt-l0{margin-left:0}'
    + 'html.lt-en .lt-term.lt-r0{margin-right:0}'
    + 'html.lt-en #qpf-bar,html.lt-en .pool3-filter.on{flex-wrap:wrap;white-space:normal;max-width:100vw;row-gap:4px}'
    + 'html.lt-en .ai-lcard{min-width:0;overflow-wrap:anywhere}';

  /* 專有名詞對照（唯一正本）：只收機器翻譯實測譯錯、意思單一、不會誤傷的詞；鍵越長越先比對。
     不收「上行／下行」（撞「下行風險」）、Google 本身譯得對的詞（包起來反而把句子切碎）。 */
  var GL = {
    '泡沫': 'bubble', '族群': 'sector', '板塊': 'sector',
    '法人籌碼': 'institutional flows', '籌碼面': 'positioning and flows', '籌碼': 'flows',
    '七雄': 'Magnificent Seven', '等權': 'equal-weight', '量價': 'price-volume', '法人': 'institutional investors',
    '環境判定': 'Market regime', '順風': 'tailwind', '逆風': 'headwind', '偏震盪': 'choppy with a bias', '震盪': 'choppy',
    '升一碼': 'a 25bp hike', '降一碼': 'a 25bp cut', '長端利率': 'long-end yields',
    '2 年期減政策利率': '2-year minus policy rate', '20 年期': '20-year',
    '五日線': '5-day MA', '月線': '20-day MA', '季線': '60-day MA', '年線': '240-day MA',
    '鍊條': 'chain', '領先環': 'leading link', '落後環': 'lagging link', '打滑': 'slipping',
    '名詞解釋': 'Glossary', '動態圖': 'animated chart', '動畫：開': 'Animation: on', '動畫：關': 'Animation: off',
    '開牌日': 'Check date'
  };

  var LIB = 'https://translate.google.com/translate_a/element.js?cb=__ltInit';
  var lib = false, loading = false, queue = [], btnZh, btnEn, want = 'zh', retryT = 0, note = null, grp = null, hostBar = null;
  var CJK = /[㐀-鿿豈-﫿]/, DIGIT = /\d/, BOX = /[─-╿]/;
  var SKIP = 'script,style,svg,textarea,title,noscript,.notranslate,[translate="no"],#lt-gte,#lt-svgsrc,font';
  function translated() { return /\btranslated-(ltr|rtl)\b/.test(document.documentElement.className); }
  function paint() {
    [[btnZh, 'zh'], [btnEn, 'en']].forEach(function (p) {
      if (!p[0]) return; var on = (want === p[1]);
      p[0].classList.toggle('lt-on', on); p[0].setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (note) note.classList.toggle('lt-show', want === 'en');
    document.documentElement.classList.toggle('lt-en', want === 'en');
    fire(want);
  }
  function busy(b) { if (btnEn) { if (b) btnEn.setAttribute('aria-busy', 'true'); else btnEn.removeAttribute('aria-busy'); } }
  function rgba(c) { var m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; var p = m[1].split(',').map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  function bgLum(el) {
    var st = [], solid = false;
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) { var c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) { st.push(c); if (c[3] >= 1) { solid = true; break; } } }
    var r = 255, g = 255, b = 255;
    if (!solid) { var t = rgba(getComputedStyle(document.body).color); if (.2126 * t[0] + .7152 * t[1] + .0722 * t[2] > 128) { r = g = b = 17; } }
    for (var i = st.length - 1; i >= 0; i--) { var c2 = st[i], a = c2[3]; r = c2[0] * a + r * (1 - a); g = c2[1] * a + g * (1 - a); b = c2[2] * a + b * (1 - a); }
    return .2126 * r + .7152 * g + .0722 * b;
  }
  function tone() { if (grp && grp.isConnected) grp.classList.toggle('lt-lightbg', bgLum(grp) > 150); }
  function watchTheme() {
    if (!window.MutationObserver) return;
    var mo = new MutationObserver(function () { [30, 300, 700].forEach(function (t) { setTimeout(tone, t); }); });
    document.body.addEventListener('transitionend', function (ev) { if (ev.target === document.body || ev.target === document.documentElement || (grp && ev.target.contains && ev.target.contains(grp))) tone(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  }
  function themeBtn() { return document.querySelector('[onclick*="setTheme"],[data-theme-btn]'); }
  function autoBar() {
    var t = themeBtn();
    if (!t) return null;
    return (t.closest && t.closest('.controls-bar,.fc')) || t.parentNode;
  }
  function slotEl() {
    var s = document.querySelectorAll('[data-yoda-lang-slot]');
    for (var i = 0; i < s.length; i++) if (s[i].getAttribute('data-yoda-lang-slot') !== 'bar') return s[i];
    return null;
  }
  function barSlot() { return document.querySelector('[data-yoda-lang-slot="bar"]'); }
  function noTr(el) { el.setAttribute('translate', 'no'); el.classList.add('notranslate'); }
  var sep = null;
  function styleBtns(cls) {
    [btnZh, btnEn].forEach(function (b) {
      b.className = (cls ? cls + ' ' : 'lt-plain ') + 'lt-btn' + (b.classList.contains('lt-on') ? ' lt-on' : '');
    });
  }
  function place(target) {
    if (sep && sep.parentNode) sep.parentNode.removeChild(sep);
    if (hostBar) hostBar.classList.remove('lt-host');
    grp.classList.remove('lt-float', 'ctrl-group');
    grp.className = grp.className.replace(/\blt-pos-\S+/g, '').trim();
    hostBar = null;
    if (target === 'float') {
      var pos = /^(top|bottom)-(left|right|center)$/.test(FLOAT) ? FLOAT : 'bottom-left';
      if (pos === 'bottom-center') pos = 'bottom-right';
      grp.classList.add('lt-float', 'lt-pos-' + pos); styleBtns('');
      var bs = barSlot();
      if (bs) { bs.appendChild(grp); noTr(bs); } else document.body.appendChild(grp);
    } else if (target.hasAttribute && target.hasAttribute('data-yoda-lang-slot') && target.getAttribute('data-yoda-lang-slot') !== 'bar') {
      styleBtns(target.getAttribute('data-btn-class') || '');
      target.appendChild(grp); noTr(target); hostBar = target; target.classList.add('lt-host');
    } else {
      var ref = target.querySelector('[onclick*="setTheme"],[data-theme-btn]');
      styleBtns(ref ? String(ref.className).replace(/\b(active|on)\b/g, '').trim() : '');
      if (target.classList.contains('controls-bar')) {
        grp.classList.add('ctrl-group');
        sep = document.createElement('div'); sep.className = 'ctrl-sep'; target.appendChild(sep);
      }
      target.appendChild(grp); noTr(target); hostBar = target; target.classList.add('lt-host');
    }
    tone();
    if (note) {
      note.style.top = '';
      if (hostBar) { var hr = hostBar.getBoundingClientRect(); if (hr.bottom > 0 && hr.bottom < 200) note.style.top = Math.round(hr.bottom + 6) + 'px'; }
    }
  }
  function pickTarget() { return slotEl() || autoBar() || 'float'; }
  function build() {
    var css = document.createElement('style'); css.id = 'yoda-lang-css'; css.textContent = CSS;
    (document.head || document.documentElement).appendChild(css);
    var g = document.createElement('div');
    g.className = 'lt-group';
    g.setAttribute('role', 'group'); g.setAttribute('aria-label', '語言 Language');
    noTr(g);
    function mk(label, lang) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'lt-btn'; b.textContent = label;
      b.setAttribute('lang', lang === 'en' ? 'en' : 'zh-Hant'); b.setAttribute('data-lang', lang);
      b.addEventListener('click', function () { lang === 'en' ? toEn() : toZh(); });
      g.appendChild(b); return b;
    }
    btnZh = mk('繁體中文', 'zh'); btnEn = mk('English', 'en');
    grp = g;
    note = document.createElement('div'); note.className = 'lt-note'; noTr(note); note.setAttribute('lang', 'en');
    note.setAttribute('role', 'note');
    note.textContent = 'Machine-translated by Google. Figures and wording may differ — the Traditional Chinese original prevails.';
    document.body.appendChild(note);
    var box = document.createElement('div'); box.id = 'lt-gte'; box.className = 'notranslate'; box.setAttribute('aria-hidden', 'true');
    document.body.appendChild(box);
    if (FLOAT === 'none' && !slotEl() && !autoBar()) { grp = g; }
    else place(pickTarget());
    watchTheme(); watchSlot();
  }
  function watchSlot() {
    if (!window.MutationObserver) return;
    var pend = false;
    new MutationObserver(function () {
      if (pend) return; pend = true;
      (window.requestAnimationFrame || setTimeout)(function () {
        pend = false;
        var s = slotEl();
        if (s && grp.parentNode !== s) { place(s); return; }
        if (!grp.isConnected) {
          if (FLOAT === 'none' && !autoBar()) return;
          place(pickTarget());
        }
      });
    }).observe(document.body, { childList: true, subtree: true });
  }
  function nt(el) { if (el.getAttribute('translate') !== 'no') el.setAttribute('translate', 'no'); }
  var LEAF = 'td,th,span,b,strong,em,i,small,sup,sub,code,kbd,div,li,a,label';
  function leafNum(el) {
    if (el.childElementCount || el.closest('svg,button,[translate="no"],.notranslate,#lt-gte,#lt-svgsrc')) return false;
    var s = (el.textContent || '').trim();
    return !!s && s.length <= 48 && DIGIT.test(s) && !CJK.test(s);
  }
  function markIn(root) {
    if (!root || root.nodeType !== 1 || root.closest('font,#lt-gte,#lt-svgsrc')) return;
    var all = function (sel) { var a = Array.prototype.slice.call(root.querySelectorAll(sel)); if (root.matches(sel)) a.push(root); return a; };
    all('pre').forEach(function (p) { if (p.classList.contains('ascii-fig') || BOX.test(p.textContent || '')) { nt(p); p.classList.add('notranslate'); } });
    all('.nav-num').forEach(nt);
    all(LEAF).forEach(function (el) { if (leafNum(el)) nt(el); });
  }
  function combo() { return document.querySelector('#lt-gte select.goog-te-combo'); }
  function fail() {
    if (translated()) { lib = true; loading = false; var q = queue; queue = []; q.forEach(function (f) { f(); }); return; }
    loading = false; queue = []; busy(false);
    if (btnEn) btnEn.title = '翻譯服務暫時連不上，請稍後再試';
    want = 'zh'; paint(); titleBack();
  }
  function loadLib(cb) {
    if (lib) return cb();
    queue.push(cb); if (loading) return; loading = true;
    window.__ltInit = function () {
      try { new google.translate.TranslateElement({ pageLanguage: 'zh-TW', includedLanguages: 'en', autoDisplay: false }, 'lt-gte'); }
      catch (e) { return fail(); }
      var n = 0; (function wait() {
        var c = combo();
        if (c && (c.querySelector('option[value="en"]') || translated())) { lib = true; loading = false; var q = queue; queue = []; q.forEach(function (f) { f(); }); return; }
        if (++n > 150) return fail();
        setTimeout(wait, 100);
      })();
    };
    var s = document.createElement('script'); s.src = LIB; s.async = true; s.onerror = fail;
    document.head.appendChild(s);
  }
  function pick() {
    var c = combo(); if (!c) return;
    if (c.value !== 'en') { c.value = 'en'; c.dispatchEvent(new Event('change')); }
    clearTimeout(retryT);
    retryT = setTimeout(function () { if (want === 'en' && !translated()) { var c2 = combo(); if (c2) { c2.value = 'en'; c2.dispatchEvent(new Event('change')); } } }, 1800);
  }
  function watchDone() {
    var n = 0; (function w() { if (translated() || want !== 'en' || ++n > 100) { busy(false); if (want === 'en' && translated()) glossShow(); return; } setTimeout(w, 100); })();
  }
  function clearCookie() {
    var h = location.hostname || baseHost.replace(/:\d+$/, ''), ex = '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
    try { document.cookie = 'googtrans' + ex; if (h) { document.cookie = 'googtrans' + ex + ';domain=' + h; document.cookie = 'googtrans' + ex + ';domain=.' + h; } } catch (e) {}
  }
  var gKeys = Object.keys(GL).sort(function (a, b) { return b.length - a.length; }), gRx = null, gSp = [], gWr = [], gOn = false;
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function rx() { gRx = gRx || new RegExp(gKeys.map(esc).join('|'), 'g'); gRx.lastIndex = 0; return gRx; }
  function wrapText(t, showEn) {
    var p = t.parentElement, s = t.nodeValue;
    if (!p || !s || !CJK.test(s) || p.closest(SKIP)) return;
    var r = rx(); if (!r.test(s)) return;
    var box = /flex|grid/.test(getComputedStyle(p).display);
    var f = box ? document.createElement('span') : document.createDocumentFragment(), k = 0, m; r.lastIndex = 0;
    while ((m = r.exec(s))) {
      if (m.index > k) f.appendChild(document.createTextNode(s.slice(k, m.index)));
      var sp = document.createElement('span'); sp.className = 'lt-term notranslate'; sp.setAttribute('translate', 'no');
      if (!s.slice(0, m.index).trim() && (box || !t.previousSibling)) sp.className += ' lt-l0';
      if (!s.slice(m.index + m[0].length).trim() && (box || !t.nextSibling)) sp.className += ' lt-r0';
      sp.setAttribute('data-zh', m[0]); sp.textContent = showEn ? GL[m[0]] : m[0]; f.appendChild(sp); gSp.push(sp); k = m.index + m[0].length;
    }
    if (k < s.length) f.appendChild(document.createTextNode(s.slice(k)));
    if (box) { f.className = 'lt-wrap'; gWr.push([f, s]); }
    p.replaceChild(f, t);
  }
  function glossIn(root, showEn) {
    if (!gKeys.length || !root) return;
    if (root.nodeType === 3) { wrapText(root, showEn); return; }
    if (root.nodeType !== 1 || root.closest(SKIP)) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = [], t;
    while ((t = w.nextNode())) list.push(t);
    list.forEach(function (x) { wrapText(x, showEn); });
  }
  function glossShow() { gOn = true; gSp.forEach(function (sp) { var z = sp.getAttribute('data-zh'); if (GL[z]) sp.textContent = GL[z]; }); }
  function glossUnwrap() {
    gOn = false; var ps = new Set();
    gSp.forEach(function (sp) { if (sp.parentNode) { ps.add(sp.parentNode); sp.parentNode.replaceChild(document.createTextNode(sp.getAttribute('data-zh')), sp); } });
    gWr.forEach(function (a) { var w = a[0]; if (w.parentNode) { ps.delete(w); ps.add(w.parentNode); w.parentNode.replaceChild(document.createTextNode(a[1]), w); } }); gWr = [];
    gSp = []; ps.forEach(function (p) { try { p.normalize(); } catch (e) {} });
  }
  var svgOn = false, dict = {}, orig = new Map(), pend = new Map(), box2 = null, moP = null, tS = 0, tP = 0;
  var titleZh = null, titleSp = null, titleT = 0;
  function srcSpan(s) {
    var sp = document.createElement('span'), r = gKeys.length ? rx() : null, k = 0, m;
    if (r) {
      r.lastIndex = 0; while ((m = r.exec(s))) {
        if (m.index > k) sp.appendChild(document.createTextNode(s.slice(k, m.index)));
        var q = document.createElement('span'); q.className = 'notranslate'; q.setAttribute('translate', 'no'); q.textContent = ' ' + GL[m[0]] + ' '; sp.appendChild(q); k = m.index + m[0].length;
      }
    }
    if (k < s.length) sp.appendChild(document.createTextNode(s.slice(k)));
    return sp;
  }
  function done1(sp) { var v = (sp.textContent || '').replace(/\s+/g, ' ').trim(); return (v && (sp.querySelector('font') || !CJK.test(v))) ? v : null; }
  function srcStart() {
    if (box2 || !window.MutationObserver) return;
    box2 = document.createElement('div'); box2.id = 'lt-svgsrc'; box2.setAttribute('aria-hidden', 'true'); document.body.appendChild(box2);
    moP = new MutationObserver(function () { clearTimeout(tP); tP = setTimeout(harvest, 120); });
    moP.observe(box2, { subtree: true, childList: true, characterData: true });
  }
  function srcStop() {
    if (moP) moP.disconnect(); moP = null; clearTimeout(tP);
    pend.clear(); titleSp = null; if (box2) { box2.parentNode && box2.parentNode.removeChild(box2); box2 = null; }
  }
  function titleEn() {
    if (titleZh === null) titleZh = document.title;
    if (!box2 || !CJK.test(titleZh)) return;
    titleSp = srcSpan(titleZh); box2.appendChild(titleSp); setTimeout(harvest, 400);
  }
  function titleBack() {
    if (titleZh === null) return; var z = titleZh, n = 0; clearInterval(titleT);
    document.title = z;
    titleT = setInterval(function () { if (want !== 'zh' || ++n > 12) { clearInterval(titleT); if (want === 'zh') titleZh = null; return; } if (document.title !== z) document.title = z; }, 250);
  }
  function svgTexts() {
    return Array.prototype.filter.call(document.querySelectorAll('svg text,svg tspan'), function (t) {
      if (t.firstElementChild) return false;
      if (t.closest('.notranslate,[translate="no"]')) return false;
      return CJK.test(t.textContent || '');
    });
  }
  var keepZh = new WeakSet(), fitted = new Map();
  function bw(t) { try { return t.getBBox().width; } catch (e) { return 0; } }
  function unfit(t) {
    var a = fitted.get(t); if (!a) return;
    if (a[0] === null) t.removeAttribute('textLength'); else t.setAttribute('textLength', a[0]);
    if (a[1] === null) t.removeAttribute('lengthAdjust'); else t.setAttribute('lengthAdjust', a[1]);
    fitted.delete(t);
  }
  function keepSvg(svg) {
    keepZh.add(svg);
    orig.forEach(function (s, t) { if (svg.contains(t)) { unfit(t); t.textContent = s; orig.delete(t); } });
  }
  function put(t, s) {
    var svg = t.closest('svg'); if (svg && keepZh.has(svg)) return;
    var w0 = bw(t);
    if (!orig.has(t)) orig.set(t, s);
    t.textContent = dict[s];
    if (!w0) return;
    var w1 = bw(t);
    if (w1 > w0 * 2.4) { if (svg) keepSvg(svg); else { t.textContent = s; orig.delete(t); } return; }
    if (w1 > w0 * 1.15) {
      if (!fitted.has(t)) fitted.set(t, [t.getAttribute('textLength'), t.getAttribute('lengthAdjust')]);
      t.setAttribute('textLength', (w0 * 1.15).toFixed(1)); t.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
  }
  function svgApply() {
    if (!svgOn) return;
    svgTexts().forEach(function (t) {
      var sv = t.closest('svg'); if (sv && keepZh.has(sv)) return;
      var s = t.textContent;
      if (Object.prototype.hasOwnProperty.call(dict, s)) { put(t, s); return; }
      if (!pend.has(s) && box2) { var sp = srcSpan(s); box2.appendChild(sp); pend.set(s, sp); }
    });
  }
  function harvest() {
    var got = false;
    pend.forEach(function (sp, s) { var v = done1(sp); if (v) { dict[s] = v; got = true; if (sp.parentNode) sp.parentNode.removeChild(sp); pend.delete(s); } });
    if (titleSp && want === 'en') { var tv = done1(titleSp); if (tv) { document.title = tv; if (titleSp.parentNode) titleSp.parentNode.removeChild(titleSp); titleSp = null; } }
    if (got) svgApply();
  }
  function svgStart() { if (svgOn || !box2) return; svgOn = true; svgApply(); setTimeout(harvest, 400); }
  function svgStop() {
    svgOn = false; clearTimeout(tS);
    orig.forEach(function (s, t) { if (t.isConnected && t.textContent !== s) t.textContent = s; }); orig.clear();
    Array.from(fitted.keys()).forEach(unfit); keepZh = new WeakSet();
  }
  var moN = null;
  function liveStart() {
    if (moN || !window.MutationObserver) return;
    moN = new MutationObserver(function (ms) {
      if (want !== 'en') return;
      var svgHit = false;
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i], tg = m.target, el = tg.nodeType === 1 ? tg : tg.parentNode;
        if (el && el.closest && el.closest('svg')) svgHit = true;
        if (m.type !== 'childList') continue;
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType === 1) { if (n.nodeName === 'FONT' || n.classList.contains('lt-term') || n.classList.contains('lt-wrap') || n.closest('font,#lt-gte,#lt-svgsrc')) continue; markIn(n); glossIn(n, gOn); }
          else if (n.nodeType === 3) { glossIn(n, gOn); }
        }
      }
      if (svgHit) { clearTimeout(tS); tS = setTimeout(svgApply, 200); }
    });
    moN.observe(document.body, { subtree: true, childList: true, characterData: true });
  }
  function liveStop() { if (moN) { moN.disconnect(); moN = null; } }
  var zhSig = null;
  function sig() { var s = document.body.textContent || '', n = 0, i, c; for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); if (c >= 0x3400 && c <= 0x9fff) n++; } return n; }
  function toEn() {
    want = 'en'; lsSet('en'); paint(); busy(true);
    /* 開翻前記下中文字數（切回中文時驗證有沒有被吃字）；先清掉上次留下的翻譯 cookie，
       不讓翻譯元件一載入就自動開翻（那會趕在數字格／名詞標記之前，也會讓字數基準落空） */
    if (!lib) clearCookie();
    if (!translated() && zhSig === null) zhSig = sig();
    loadLib(function () { if (want === 'en') { if (!translated() && zhSig === null) zhSig = sig(); markIn(document.body); glossIn(document.body, false); srcStart(); titleEn(); liveStart(); pick(); watchDone(); svgStart(); } });
  }
  function toZh() {
    want = 'zh'; lsSet('zh'); paint(); busy(false); clearTimeout(retryT); liveStop(); svgStop(); srcStop();
    setTimeout(glossUnwrap, 0);
    if (!lib) { clearCookie(); titleBack(); return; }
    var done = false;
    Array.prototype.forEach.call(document.querySelectorAll('iframe'), function (f) {
      if (done) return;
      try { var b = f.contentDocument && f.contentDocument.querySelector('[id$=".restore"]'); if (b) { b.click(); done = true; } } catch (e) {}
    });
    if (!done) { var c = combo(); if (c) { c.value = ''; c.dispatchEvent(new Event('change')); } }
    clearCookie(); titleBack();
    var n = 0;
    setTimeout(function chk() {
      if (want !== 'zh') return;
      if (!translated() && (zhSig === null || sig() >= zhSig)) { zhSig = null; return; }
      if (++n > 10) { clearCookie(); location.reload(); return; }
      setTimeout(chk, 400);
    }, 800);
  }
  function boot() {
    build();
    if (cur() === 'en') toEn(); else { want = 'zh'; paint(); clearCookie(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
