/* ═══════════════════════════════════════════════════════════════
   Yoda 名單挑股器 · ta-pick.js（正本，v1.1／2026-09-14）
   名單表格最左邊長出一欄核取方塊 → 右下角浮動鈕 → 新視窗開技術分析頁。
   純 vanilla、零依賴、mount 冪等（母板那種重畫 tbody 的表也吃得住）。

   ── 用法①：母板要加的一行（放 </body> 前，由 gen 的 {{TA_PICK}} 佔位符填）──
   <script src="https://yoda-research-next.vercel.app/ta-pick.js"
           data-ta-url="https://yoda-research-next.vercel.app/ta"></script>
   ⚠ 一律用**絕對網址**：報告經 /api/report 供頁時，相對路徑解析不到。
   ⚠ 正式檔位置 `_deploy\yoda-research-next\public\ta-pick.js`（本檔是正本，
     改完複製過去重新部署）。→ **修 bug 只改這支、報告不用重產**，
     因為報告端只有上面那一行 script 標籤，行為全在這支檔裡。

   ── 用法②：報告端（gen_*.py 產表時）要加的屬性 ────────────────
   <table data-ta="us" data-ta-sticky data-ta-date="20260911">
     └ data-ta        必填，市場＝"us" 或 "tw"（狀態分桶只看這個）
     └ data-ta-sticky 選填，表格會橫向捲動時加，勾選欄會黏在最左邊
     └ data-ta-date   選填，**純顯示用**（hover 提示「此表資料日 …」），
                      不進 key、不進 URL——美股 §02 快照日比報告日早一天，
                      若按表格日期分桶，同一份報告會被拆成兩份清單。
     <thead><tr><th>代號</th>…        ← 本模組自己在最左插 th[data-nosort]
     <tbody><tr data-sym="NVDA">…     ← 純代號：US 大寫字母、TW 4 碼數字
   ⚠ **達上限提示在浮動列**（右下角），不在表格裡：勾滿 15 檔時浮動列自己多長
     一行「已達上限 15 檔：取消或清除後才能再勾」，整條同時轉警示配色
     （`#ta-pick-bar.ta-pick-bar--cap`）。報告端不用加任何東西。
   狀態 key 與 URL 的 d= 一律用**報告日**，順序：
     <body data-report-date> → <html data-report-date>（去連字號）
     → location.pathname 抓 8 碼 → 'nodate'

   ── 用法③：JS API ─────────────────────────────────────────────
   TAPick.mount(tableEl)   單表掛載／重掛（冪等，tbody 重畫後呼叫這個）
   TAPick.mountAll()       掃全頁 table[data-ta]（自動跑，也可手動）
   TAPick.state('us')      → Set 的拷貝（目前勾選的代號）
   TAPick.clear('us')      清掉該市場勾選（不傳市場＝清全部）
   TAPick.refresh()        重畫所有表的勾選與 disabled ＋ 浮動鈕

   ── 設計決定（規格二選一處，這裡選了哪個）────────────────────
   1. 多市場同時有勾選：**同一條浮動列、每個市場一顆鈕**，文字變成
      「分析 US 3 檔」「分析 TW 5 檔」；只有一個市場有勾選時則是
      規格原文的「分析勾選的 N 檔」。（不做兩條按鈕列。）
   2. 主鈕是真的 <a target="_blank" rel="noopener">：報告在會員區 iframe
      內嵌，window.open 會被擋。href 在 click 當下重組一次，同時也在每次
      重畫時就先寫好——不然 ctrl+click／滑鼠中鍵開新分頁會拿到空 href。
   3. 15 檔上限**每個市場各自算**（桶＝market＋報告日）。勾滿就把該市場
      其餘 checkbox disabled，並且讓讀者看得到原因：被停用的 checkbox 帶
      title＋`.ta-pick-cb--cap` 淡化、每張表的全選格帶同一個 title、
      浮動列**獨立一行**顯示「已達上限 15 檔：取消或清除後才能再勾」（浮動列改直向
      排：第一列 `.ta-pick-row` 放主鈕＋清除，`.ta-pick-cap` 自己一列，不再跟
      主鈕文字黏成「分析勾選的 15 檔一次最多 15 檔」），整條浮動列再加
      `.ta-pick-bar--cap` 轉暖色邊框＋提示微亮。從 §02 捲到 §03 看到整片
      不能點，右下角那條就是線索，一眼知道為什麼。
   4. 事件用**委派**：3,680 列的 §02 表不可能每格掛 listener。table 上
      掛兩個——capture 階段的 click（吃掉母板 sortTbl）＋ bubble 的 change。
      capture ＋ stopPropagation ＋ stopImmediatePropagation 雙保險，連綁在
      同一個 th 上的 listener 都不會跑到；th 另標 data-nosort="1"，
      母板新版掛鉤會直接跳過它。
   5. 效能鐵則：插欄與重畫迴圈內**不准讀 layout**（offsetParent／
      getBoundingClientRect 都不行，一讀就是每列一次 reflow）。「可見列」
      只在按下全選那一刻讀一次。td 用原型 cloneNode 複製，屬性寫入全部
      先比對再寫（值沒變就不碰，省掉整棵樹的 style 重算）。
   6. 插欄不會弄壞母板 sortTbl：sortTbl 用 `ths.indexOf(th)` 取欄號、
      再讀 `row.cells[col]`——th 與 td **同時**都往右移一格，欄號對齊不變。
      ⚠ 反面：同一個 tbody 裡沒有 data-sym 的列（純備註列、colspan 列）
      不會被插 td，那一列會少一格。名單表請把備註放 tfoot 或表外。
   ═══════════════════════════════════════════════════════════════ */
(function(){
"use strict";

var MAX=15;                                        /* 一次最多丟幾檔 */
var CAP="一次最多 "+MAX+" 檔，先取消或清除";        /* 達上限時的 hover 說明 */
var CAPBAR="已達上限 "+MAX+" 檔：取消或清除後才能再勾";  /* 浮動列獨立一行的提示 */
var HINT="勾選後用右下角按鈕丟到技術分析頁（一次最多 "+MAX+" 檔）";
var SS="tapick:";                                  /* sessionStorage key 前綴 */
var STORE=new Map();                               /* 狀態真相：Map<key,Set<sym>>，key=tapick:市場:報告日 */
var warned=false;                                  /* TA 頁網址沒設定只警告一次 */

/* data-ta-url 只能在 script 同步執行期讀（currentScript 之後會變 null），先抓住 */
var DS_URL=(function(){
  try{ var s=document.currentScript; if(s&&s.dataset&&s.dataset.taUrl) return String(s.dataset.taUrl).trim(); }catch(e){}
  return "";
})();
/* window.TA_PICK_URL 可能比本檔晚設定，所以每次要用的時候才解析 */
function taUrl(){
  if(DS_URL) return DS_URL;
  try{ if(window.TA_PICK_URL) return String(window.TA_PICK_URL).trim(); }catch(e){}
  return "";
}

/* ---------- 報告日（整頁一個，跟表格資料日無關）---------- */
function eight(v){ var m=String(v==null?"":v).replace(/[^0-9]/g,""); return /^\d{8}/.test(m)?m.slice(0,8):""; }
var DATE=null;
function repDate(){
  if(DATE) return DATE;
  var d=eight(document.body&&document.body.getAttribute("data-report-date"));
  if(!d) d=eight(document.documentElement&&document.documentElement.getAttribute("data-report-date"));
  if(!d){ var m=String(location.pathname||"").match(/(\d{8})/); if(m) d=m[1]; }
  DATE=d||"nodate";
  return DATE;
}
function marketOf(t){ return ((t&&t.getAttribute("data-ta"))||"").trim(); }
/* data-ta-date 不進 key，只在跟報告日不同時當 hover 說明（美股 §02 快照日會早一天） */
function hintOf(table){
  var d=eight(table.getAttribute("data-ta-date"));
  return HINT+(d&&d!==repDate()?"｜此表資料日 "+d:"");
}
function keyOf(market){ return SS+market+":"+repDate(); }

/* ---------- 狀態桶（記憶體為真相，sessionStorage 只是鏡射）---------- */
function bucket(key){
  if(STORE.has(key)) return STORE.get(key);
  var s=new Set();
  try{
    var raw=sessionStorage.getItem(key);
    if(raw){
      var arr=JSON.parse(raw);
      if(Array.isArray(arr)) arr.slice(0,MAX).forEach(function(v){ if(typeof v==="string"&&v) s.add(v); });
    }
  }catch(e){ /* 隱私模式／被關掉 → 只留記憶體 */ }
  STORE.set(key,s);
  return s;
}
function mirror(key){
  try{ sessionStorage.setItem(key,JSON.stringify(Array.from(bucket(key)))); }catch(e){}
}

/* ---------- CSS（只注一次）---------- */
function ensureCss(){
  if(document.getElementById("ta-pick-css")) return;
  var st=document.createElement("style"); st.id="ta-pick-css";
  st.textContent=
  /* 選擇器刻意寫長：母板有 `.us-tbl td:first-child{text-align:left}` 這種規則（0,2,1），
     只寫 .ta-pick-td（0,1,0）會被壓掉、勾選欄變左靠。這裡寫成 (0,2,2) 穩贏。 */
   "table[data-ta] th.ta-pick-th,table[data-ta] td.ta-pick-td{width:28px;min-width:28px;max-width:28px;"
   +"text-align:center;vertical-align:middle;padding:2px 0;box-sizing:border-box;font-weight:400}"
  +"table[data-ta] th.ta-pick-th{cursor:default}"
  +".ta-pick-cb,.ta-pick-all{width:15px;height:15px;margin:0;vertical-align:middle;cursor:pointer;accent-color:var(--accent,#7f9fc6)}"
  +".ta-pick-cb:disabled,.ta-pick-all:disabled{cursor:not-allowed}"
  /* 達上限被停用：淡化，讓「不是壞了、是滿了」看得出來（title 寫原因） */
  +".ta-pick-cb--cap{opacity:.28;cursor:help}"
  /* 表格會橫向捲時把勾選欄黏住；底色吃母板變數，換深／淺色都跟著走 */
  /* 底色順序：--bg2（若母板有）→ --surface（mw/us/tw 母板的表格底色就是這個）→ --bg → inherit */
  +"table[data-ta-sticky] th.ta-pick-th,table[data-ta-sticky] td.ta-pick-td{position:sticky;left:0;z-index:2;background:var(--bg2,var(--surface,var(--bg,inherit)))}"
  +"table[data-ta-sticky] th.ta-pick-th{z-index:3}"
  +"tr.ta-pick-on>td{background:color-mix(in srgb,var(--accent,#7f9fc6) 9%,transparent)}"
  /* 浮動列：右下角，z-index 壓過報告內容與 tablet-hint 遮罩 */
  /* 直向排：第一列是按鈕＋清除，上限提示自己一列。
     ⚠ 別改回 flex-wrap 讓提示自己換行——浮動列是 fixed、寬度 shrink-to-fit，
       一開 wrap 連「清除」都會被推下去（實測 09-14）。 */
  +"#ta-pick-bar{position:fixed;right:18px;bottom:18px;z-index:99999;display:flex;flex-direction:column;align-items:flex-end;gap:7px;"
   +"padding:9px 12px;border-radius:11px;border:1px solid var(--border,#1c2330);background:var(--surface,#0d1118);"
   +"box-shadow:0 6px 22px rgba(0,0,0,.42);font-family:var(--fm,ui-monospace,Consolas,monospace);font-size:13.5px}"
  +"#ta-pick-bar .ta-pick-row{display:flex;align-items:center;gap:10px}"
  +"#ta-pick-bar .ta-pick-btns{display:flex;align-items:center;gap:8px}"
  +"#ta-pick-bar .ta-pick-go{display:inline-block;padding:7px 14px;border-radius:8px;font-weight:700;text-decoration:none;white-space:nowrap;"
   +"background:var(--accent,#7f9fc6);color:var(--bg,#080b10);border:1px solid var(--accent,#7f9fc6);cursor:pointer}"
  +"#ta-pick-bar .ta-pick-go:hover{filter:brightness(1.12)}"
  +"#ta-pick-bar .ta-pick-go.off{background:transparent;color:var(--dim,#405060);border-color:var(--border,#1c2330);cursor:not-allowed;font-weight:500}"
  /* 上限提示：自己一個 block、自己一列，才不會跟主鈕文字黏成
     「分析勾選的 15 檔一次最多 15 檔」（v1.0 的 bug）。 */
  +"#ta-pick-bar .ta-pick-cap{display:block;margin:0;"
   +"font-size:11.5px;line-height:1.4;text-align:right;color:var(--yellow,#f0c040);white-space:nowrap}"
  /* display:block 的 (1,1,0) 會壓掉瀏覽器內建的 [hidden]{display:none}(0,1,0)，
     不補這條的話「未達上限要隱藏」就失效——提示會一直掛在那裡。 */
  +"#ta-pick-bar .ta-pick-cap[hidden]{display:none}"
  /* 達上限：整條浮動列轉暖色，讓人從別張表捲過來也看得到原因 */
  +"#ta-pick-bar.ta-pick-bar--cap{border-color:var(--yellow,#f0c040);"
   +"box-shadow:0 6px 22px rgba(0,0,0,.42),0 0 0 1px color-mix(in srgb,var(--yellow,#f0c040) 34%,transparent)}"
  +"#ta-pick-bar.ta-pick-bar--cap .ta-pick-cap{font-weight:700;color:color-mix(in srgb,var(--yellow,#f0c040) 80%,#fff)}"
  +"#ta-pick-bar .ta-pick-clear{font-size:11.5px;color:var(--dim,#405060);background:none;border:0;padding:2px 4px;cursor:pointer;text-decoration:underline;font-family:inherit}"
  +"#ta-pick-bar .ta-pick-clear:hover{color:var(--text,#b8c8d8)}"
  +"@media print{#ta-pick-bar{display:none}}";
  (document.head||document.documentElement).appendChild(st);
}

/* ---------- 事件委派（每張表只掛兩個 listener）---------- */
function wire(table){
  /* capture 階段先吃掉勾選欄的 click：母板 sortTbl 可能綁在 th 上或祖先上 */
  table.addEventListener("click",function(e){
    var t=e.target;
    if(t&&t.closest&&t.closest(".ta-pick-td,.ta-pick-th")){
      e.stopPropagation(); e.stopImmediatePropagation();
    }
  },true);
  table.addEventListener("change",function(e){
    var t=e.target; if(!t||!t.classList) return;
    if(t.classList.contains("ta-pick-cb")){
      e.stopPropagation();
      var tr=t.closest("tr[data-sym]"); if(!tr) return;
      pick(table,(tr.getAttribute("data-sym")||"").trim(),t.checked);
    }else if(t.classList.contains("ta-pick-all")){
      e.stopPropagation();
      toggleAll(table,t.checked);
    }
  });
}

/* td 原型：3,000 列用 cloneNode 複製，比每列 createElement 快一截 */
var TD=null;
function tdProto(){
  if(TD) return TD;
  TD=document.createElement("td"); TD.className="ta-pick-td";
  var cb=document.createElement("input"); cb.type="checkbox"; cb.className="ta-pick-cb";
  TD.appendChild(cb);
  return TD;
}

/* ---------- 掛載單表（冪等）---------- */
function mount(table){
  if(!table||table.nodeName!=="TABLE") return;
  var market=marketOf(table); if(!market) return;
  ensureCss();
  if(!table.__taWired){ table.__taWired=true; wire(table); }

  /* ① thead 第一列最左插 th（沒有 thead 就不插表頭，只插 td） */
  var hr=table.querySelector("thead tr");
  if(hr&&!hr.querySelector("th.ta-pick-th")){
    var th=document.createElement("th");
    th.className="ta-pick-th";
    th.setAttribute("data-nosort","1");
    th.title=hintOf(table);
    var all=document.createElement("input");
    all.type="checkbox"; all.className="ta-pick-all";
    all.setAttribute("aria-label","全選本表可見列");
    th.appendChild(all);
    hr.insertBefore(th,hr.firstChild);
  }

  /* ② 每列最左插 td（已有就跳過）。迴圈內只寫 DOM、不讀 layout。 */
  var proto=tdProto();
  var rows=table.querySelectorAll("tbody tr[data-sym]");
  for(var i=0;i<rows.length;i++){
    var tr=rows[i];
    var f=tr.firstElementChild;
    if(f&&f.className&&f.className.indexOf("ta-pick-td")>=0) continue;
    var sym=(tr.getAttribute("data-sym")||"").trim(); if(!sym) continue;
    var td=proto.cloneNode(true);
    td.firstChild.value=sym;
    tr.insertBefore(td,tr.firstChild);
  }

  /* ③④ 重打勾 ＋ 套上限 */
  paint(table);
  renderBar();
}

/* ---------- 依 state 重畫某表的勾選／disabled／上限說明 ---------- */
function paint(table){
  var market=marketOf(table); if(!market) return;
  var set=bucket(keyOf(market));
  var full=set.size>=MAX;
  var rows=table.querySelectorAll("tbody tr[data-sym]");
  var n=0,on=0;
  for(var i=0;i<rows.length;i++){
    var tr=rows[i], f=tr.firstElementChild, cb=f&&f.firstElementChild;
    if(!cb||!cb.className||cb.className.indexOf("ta-pick-cb")<0) continue;
    n++;
    var sel=set.has((tr.getAttribute("data-sym")||"").trim());
    if(sel) on++;
    var cap=full&&!sel;
    /* 先比再寫：值沒變就不碰，3,680 列才不會每次重畫都整棵樹重算樣式 */
    if(cb.checked!==sel) cb.checked=sel;
    if(cb.disabled!==cap) cb.disabled=cap;
    var want=cap?"ta-pick-cb ta-pick-cb--cap":"ta-pick-cb";
    if(cb.className!==want) cb.className=want;
    if(cap){ if(cb.title!==CAP) cb.title=CAP; }
    else if(cb.title) cb.removeAttribute("title");
    if(tr.className.indexOf("ta-pick-on")>=0!==sel) tr.classList[sel?"add":"remove"]("ta-pick-on");
  }
  var allCb=table.querySelector("input.ta-pick-all");
  if(allCb){
    /* 不讀 layout：全選格狀態用「本表列數 vs 已勾數」算，不看可見性 */
    var everything=n>0&&on===n;
    if(allCb.checked!==everything) allCb.checked=everything;
    var mid=on>0&&on<n;
    if(allCb.indeterminate!==mid) allCb.indeterminate=mid;
    if(allCb.disabled!==(n===0)) allCb.disabled=(n===0);
    var t=full?CAP:hintOf(table);
    if(allCb.title!==t) allCb.title=t;
    var pth=allCb.parentNode;
    if(pth&&pth.title!==t) pth.title=t;                 /* 全選格本身也帶同一個說明 */
  }
}

/* ---------- 勾／取消單檔 ---------- */
function pick(table,sym,on){
  var market=marketOf(table); if(!market||!sym) return;
  var key=keyOf(market), set=bucket(key);
  if(on){ if(set.size>=MAX&&!set.has(sym)){ refresh(); return; } set.add(sym); }
  else set["delete"](sym);
  mirror(key);
  refresh();                     /* 同市場的每一張表一起重畫（跨表合併） */
}

/* ---------- 全選／全不選：只動「該表目前可見」的列 ----------
   這是整支檔唯一讀 layout（offsetParent）的地方，而且只在按下的那一刻
   跑一次；迴圈內純讀不寫，所以只 reflow 一次。 */
function toggleAll(table,on){
  var market=marketOf(table); if(!market) return;
  var key=keyOf(market), set=bucket(key), i;
  if(on){
    /* 勾：掃列，勾到上限就 break——最多讀 15 列的 offsetParent */
    var rows=table.querySelectorAll("tbody tr[data-sym]");
    for(i=0;i<rows.length;i++){
      var tr=rows[i];
      if(tr.offsetParent===null) continue;             /* 收起來／被篩掉的列不算 */
      var sym=(tr.getAttribute("data-sym")||"").trim(); if(!sym) continue;
      if(set.size>=MAX&&!set.has(sym)) break;          /* 勾到上限就停 */
      set.add(sym);
    }
  }else{
    /* 取消：反過來走「已勾的那 15 個」去找列，不要掃 3,680 列
       （掃全表等於把整張表的 layout 逼出來，實測 3,000 列要 200ms 以上） */
    Array.from(set).forEach(function(sym){
      /* 代號進選擇器前把 " 與 \ 轉義：正常代號不會有，但別讓髒資料炸掉整個功能 */
      var tr=table.querySelector('tbody tr[data-sym="'+sym.replace(/["\\]/g,"\\$&")+'"]');
      if(tr&&tr.offsetParent!==null) set["delete"](sym);
    });
  }
  mirror(key);
  refresh();
}

/* ---------- 頁面上有哪些市場（依表格出現順序）---------- */
function groups(){
  var out=[],seen={};
  var ts=document.querySelectorAll("table[data-ta]");
  for(var i=0;i<ts.length;i++){
    var m=marketOf(ts[i]); if(!m||seen[m]) continue; seen[m]=1;
    out.push({market:m,key:keyOf(m),syms:Array.from(bucket(keyOf(m)))});
  }
  return out;
}

/* ---------- 浮動按鈕 ---------- */
function ensureBar(){
  if(!document.querySelector("table[data-ta]")) return null;   /* 沒名單表的頁面不注入 */
  var bar=document.getElementById("ta-pick-bar");
  if(bar) return bar;
  if(!document.body) return null;
  ensureCss();
  bar=document.createElement("div");
  bar.id="ta-pick-bar";
  var btns=document.createElement("div"); btns.className="ta-pick-btns";
  var cap=document.createElement("span"); cap.className="ta-pick-cap"; cap.textContent=CAPBAR; cap.hidden=true;
  var clr=document.createElement("button"); clr.type="button"; clr.className="ta-pick-clear"; clr.textContent="清除";
  clr.addEventListener("click",function(e){ e.preventDefault(); clear(); });
  /* 第一列＝主鈕＋清除（同一列），第二列＝上限提示（獨立一行） */
  var row=document.createElement("div"); row.className="ta-pick-row";
  row.appendChild(btns); row.appendChild(clr);
  bar.appendChild(row); bar.appendChild(cap);
  document.body.appendChild(bar);
  return bar;
}
function hrefFor(g){
  var u=taUrl(); if(!u||!g||!g.syms.length) return "";
  return u+(u.indexOf("?")<0?"?":"&")+"t="+g.syms.map(encodeURIComponent).join(",")+"&d="+encodeURIComponent(repDate());
}
function goBtn(g,label,live){
  var a=document.createElement("a");
  a.className="ta-pick-go"+(live?"":" off");
  a.target="_blank"; a.rel="noopener";
  a.textContent=label;
  if(!live){ a.setAttribute("aria-disabled","true"); a.tabIndex=-1; return a; }
  a.setAttribute("data-ta-market",g.market);
  a.href=hrefFor(g);                       /* 先寫好，ctrl+click／中鍵才有東西可開 */
  a.addEventListener("click",function(e){
    var h=hrefFor(g);                      /* click 當下再組一次，拿最新勾選 */
    if(!h){ e.preventDefault(); return; }
    a.href=h;
  });
  return a;
}
function renderBar(){
  var bar=ensureBar(); if(!bar) return;
  var gs=groups(), sel=gs.filter(function(g){ return g.syms.length; });
  var btns=bar.querySelector(".ta-pick-btns");
  var url=taUrl();
  if(!url&&!warned){ warned=true; console.warn("[ta-pick] 未設定 TA 頁網址"); }
  btns.textContent="";
  if(!sel.length||!url){
    var n=sel.reduce(function(a,g){ return a+g.syms.length; },0);
    btns.appendChild(goBtn(null,"分析勾選的 "+n+" 檔",false));   /* N=0 或沒網址 → disabled */
  }else if(sel.length===1){
    btns.appendChild(goBtn(sel[0],"分析勾選的 "+sel[0].syms.length+" 檔",true));
  }else{
    sel.forEach(function(g){ btns.appendChild(goBtn(g,"分析 "+g.market.toUpperCase()+" "+g.syms.length+" 檔",true)); });
  }
  /* 任一市場勾滿 → 提示那一行現身、整條浮動列轉警示配色 */
  var atCap=gs.some(function(g){ return g.syms.length>=MAX; });
  var capEl=bar.querySelector(".ta-pick-cap");
  if(capEl&&capEl.hidden!==!atCap) capEl.hidden=!atCap;
  if(bar.classList.contains("ta-pick-bar--cap")!==atCap) bar.classList[atCap?"add":"remove"]("ta-pick-bar--cap");
}

/* ---------- 對外 ---------- */
function mountAll(){
  var ts=document.querySelectorAll("table[data-ta]");
  for(var i=0;i<ts.length;i++) mount(ts[i]);
  renderBar();
}
function refresh(){
  var ts=document.querySelectorAll("table[data-ta]");
  for(var i=0;i<ts.length;i++) paint(ts[i]);
  renderBar();
}
function state(market){
  var m=(market||"").trim(), out=new Set();
  groups().forEach(function(g){ if(!m||g.market===m) g.syms.forEach(function(s){ out.add(s); }); });
  return out;                              /* 拷貝，外面怎麼改都動不到真相 */
}
function clear(market){
  var m=(market||"").trim();
  groups().forEach(function(g){
    if(m&&g.market!==m) return;
    bucket(g.key).clear(); mirror(g.key);
  });
  refresh();
}

/* ---------- 後來才出現的表（§02 重畫、chip-render 延遲插入）---------- */
var pending=false;
function schedule(){
  if(pending) return; pending=true;
  var run=function(){ pending=false; mountAll(); };
  /* 分頁在背景時 rAF 會被凍住（實測 hidden tab 完全不觸發），改用 timer 收尾；
     不然背景分頁裡渲染完成的表要等使用者切回來才掛上。 */
  if(document.hidden||!window.requestAnimationFrame) setTimeout(run,32);
  else requestAnimationFrame(run);
}
function watch(){
  if(!window.MutationObserver) return;
  new MutationObserver(function(muts){
    for(var i=0;i<muts.length;i++){
      var add=muts[i].addedNodes; if(!add||!add.length) continue;
      for(var j=0;j<add.length;j++){
        var n=add[j]; if(!n||n.nodeType!==1) continue;
        /* 只認「是名單表／含名單表／在名單表裡」的節點：否則自己插 td 也會觸發，rAF 打不完 */
        if((n.matches&&n.matches("table[data-ta]"))
          ||(n.querySelector&&n.querySelector("table[data-ta]"))
          ||(n.closest&&n.closest("table[data-ta]"))){ schedule(); return; }
      }
    }
  }).observe(document.documentElement,{subtree:true,childList:true});
}

window.TAPick={mount:mount,mountAll:mountAll,refresh:refresh,state:state,clear:clear,MAX:MAX,
               _date:repDate,_url:taUrl};

if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",function(){ mountAll(); watch(); });
else { mountAll(); watch(); }
})();
