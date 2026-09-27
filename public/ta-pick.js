/* ═══════════════════════════════════════════════════════════════
   Yoda 名單挑股器 · ta-pick.js（正本，v1.3／2026-09-27；v1.2／2026-09-27；v1.1／2026-09-14）

   ── v1.3 新增：不是 table 的清單（div 格線／flex 列；台股 §05 法人籌碼四型態）──
   **table 的行為完全不變**（仍是 table[data-ta] ＋ tbody tr[data-sym]）；新增的是：
     容器＝任何元素帶 data-ta="tw|us"（不限 table）
     列  ＝容器內任何帶 data-sym 的元素（純代號，規則同 table 版）
   報告端（例：chip-render.js 四型態卡片）要加的屬性：
   <div class="c3-body" data-ta="tw" data-ta-date="20260924">   ← 容器：data-ta 必填；data-ta-date 選填（純顯示，同 table 版）
     <div class="c3-hrow" data-ta-pad>個股｜相對強度(價)｜…</div>  ← 選填但格線對齊要靠它：表頭列（不是名單列）
                                                                     加 data-ta-pad，會拿到跟名單列一樣的左側留位
     <div class="c3-rows">
       <div class="c3-srow" data-sym="2330">…六格…</div>         ← 列：data-sym 必填
   本模組對 div 容器做的事：
     · 每列最前面插 <span class="ta-pick-cell"><input type="checkbox" class="ta-pick-cb"></span>（冪等，已插就跳過）
     · 容器最前面插一條 <div class="ta-pick-head">：「全選」＋「整張表送出」（語意同 table 版：全選只勾可見列、
       受上限；整張表送出＝該容器全部列、照 DOM 順序截到上限）。容器裡 0 列有 data-sym 時整條隱藏。
     · 容器上選填 data-ta-cell="overlay|prepend"（**預設 overlay**）：
         overlay＝勾選格絕對定位在列左側（不佔 grid／flex 的格子），列加 class ta-pick-ov、
                  padding-left＝原本的值＋26px（原本的值：每個容器讀第一列一次 getComputedStyle，之後快取）；
                  data-ta-pad 的表頭列同樣加 26px（讀它自己的原值），所以**每一欄**都跟表頭對齊。
                  為什麼預設 overlay：§05 的 .c3-srow 是 display:grid、六條固定軌道
                  （minmax(150px,1fr) 82px 82px 92px 82px 74px），桌機寬度下第一軌已頂在 150px 下限；
                  prepend 會多出第 7 個 grid item → 直接換到第二行，整張格線垮掉。
         prepend＝勾選格是列的第一個子元素（inline-flex、28px 寬、flex:none），列加 class ta-pick-pre、
                  data-ta-pad 的表頭列插一個同寬的空白格。適合 flex／block 列；
                  grid 列要用 prepend 的話，自己在 .ta-pick-pre 的 grid-template-columns 最前面補一條 28px 軌道。
     · 列被重畫（innerHTML、整張卡重建都算）→ MutationObserver 自動重掛、從狀態重打勾，不必呼叫 mount。
       只動到 div 容器的變動只重掛那幾個容器（不跑全頁 mountAll；§05 每點一列 chip-render 就整個重建，
       實測 0924 台股 1,020 列重掛 5 個容器 10～17ms）；有 table 相關的變動才照 v1.2 跑全頁。
     · 狀態、上限、浮動列跟 table 完全共用：同一個 key tapick:<市場>:<報告日>，div 勾的跟 table 勾的合併、上限一起算。
     · §05 建議：data-ta 放在每張卡的 .c3-body（頂端列落在欄名列上方；收合的卡 display:none，全選不會勾到它）。
   ⚠ overlay 的版面成本：每列一個絕對定位格，Chrome 的 layout 隨「單一容器列數」超線性
     （無頭實測：400 列約 20ms、1,000 列約 70ms、3,000 列 0.5～0.9 秒；prepend 3,000 列約 120ms）。
     §05 單卡最多約 380 列、收合的卡不排版，無感；單一容器上千列的清單改用 prepend 或拆成多個容器。
   ⚠ overlay 讓列的內容往右移 26px：列若本來就比容器寬（§05 窄卡 532.5px 時六欄已超出、右側被 overflow 裁掉），
     會多裁 26px——那是版面本身的問題，要在列樣板的欄寬處理，不是這支檔能補的。
   ⚠ 容器不可巢狀、列不可巢狀（一個 data-sym 列只屬於一個容器）；div 容器裡的 <tr> 不算列。
   ⚠ 列的第一個子元素會變成勾選格：列內樣式若用 >:first-child／:nth-child(n) 定位欄位會整排位移（同 table 版坑③）。
   ⚠ 列上的 click（例：chip-render 點列展開明細）不會被勾選格觸發：容器在 capture 階段把勾選格／全選的 click 吃掉。
   ⚠ data-ta-autotag／data-ta-auto="tw" 的自動補標**只對 table**；div 清單一律靠列樣板自己帶 data-sym。

   ── v1.2 新增（script 標籤上的選填屬性；**一個都沒給＝行為跟 v1.1 一樣**，本機 /r 靠這點）──
   <script src="…/ta-pick.js?v=1.2" data-ta-url="…/ta"
           data-ta-max="200"          一次最多幾檔（預設 15，範圍 1～200）
           data-ta-k="<TA 通行票>"    放進連結的 hash：…#k=<票>（**只放 hash、不放 query**：不進伺服器紀錄）
           data-ta-rid="<reportId>"   放進連結 query：&r=<reportId>
           data-ta-autotag            （或 data-ta-auto="tw"）台股表自動打標：thead 第一格純文字＝「代號」、
                                      tbody 列第一格符合 ^\d{4,6}[A-Z]?$ → 補 table[data-ta="tw"]＋tr[data-sym]
                                      （規則同 token_server.py tw_tag_tables；已有 data-ta 的表不動；
                                      自動打標的表之後 tbody 重畫，新列也會再補標）
   ></script>
   · 連結：${TA_URL}?t=A,B&d=YYYYMMDD[&r=<rid>][#k=<票>]；TA_URL 本身已含 ? 時用 & 接。
   · 每張名單表上方多一顆「整張表送出」（table caption 裡的 <a target=_blank>）：送該表**所有**列的代號
     （含捲到視窗外、被收合的列），照目前排序取前 MAX 檔；超過上限時按鈕文字直接寫「前 N 檔（本表 M 檔）」。
     不動勾選狀態。表只有 0～1 列、或沒設 TA 頁網址時不顯示。
   · MAX > 15 時，全選格的說明改成「勾選本表目前排序的前 N 檔」（捲動容器裡視窗外的列也算可見）。
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
   TAPick.mount(el)        單表／單一 div 容器掛載／重掛（冪等，tbody 重畫後呼叫這個）
   TAPick.mountAll()       掃全頁 [data-ta]（table 與 div 容器；自動跑，也可手動）
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

/* script 標籤上的設定只能在同步執行期讀（currentScript 之後會變 null），先一次抓住 */
var CFG=(function(){
  var o={url:"",k:"",rid:"",max:"",auto:false};
  try{
    var s=document.currentScript, ds=s&&s.dataset;
    if(ds){
      if(ds.taUrl) o.url=String(ds.taUrl).trim();
      if(ds.taK) o.k=String(ds.taK).trim();
      if(ds.taRid) o.rid=String(ds.taRid).trim();
      if(ds.taMax) o.max=String(ds.taMax).trim();
      var av=s.hasAttribute("data-ta-autotag")?String(ds.taAutotag||"tw"):(ds.taAuto!=null?String(ds.taAuto):"");
      av=av.trim().toLowerCase();
      o.auto=(av==="tw"||av==="1"||av==="true");
    }
  }catch(e){}
  return o;
})();
var DS_URL=CFG.url;

/* 上限：data-ta-max（1～200），沒給＝15（v1.1）。下面三句提示一定要在 MAX 定好之後才組 */
var MAX=(function(){ var n=parseInt(CFG.max,10); return (n>0)?Math.min(200,n):15; })();
var CAP="一次最多 "+MAX+" 檔，先取消或清除";        /* 達上限時的 hover 說明 */
var CAPBAR="已達上限 "+MAX+" 檔：取消或清除後才能再勾";  /* 浮動列獨立一行的提示 */
var HINT="勾選後用右下角按鈕丟到技術分析頁（一次最多 "+MAX+" 檔）";
/* MAX>15 時全選的真實行為＝照目前排序（DOM 順序）勾前 MAX 列；捲動容器裡視窗外的列也算可見 */
var ALLHINT=MAX>15?"勾選本表目前排序的前 "+MAX+" 檔":"";
var SS="tapick:";                                  /* sessionStorage key 前綴 */
var STORE=new Map();                               /* 狀態真相：Map<key,Set<sym>>，key=tapick:市場:報告日 */
var warned=false;                                  /* TA 頁網址沒設定只警告一次 */
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
  /* v1.2 整張表送出：放在 table 的 caption（不動 thead／tbody，母板 sortTbl 的欄號不受影響）；
     包一層 sticky 的 span，表格橫向捲動時按鈕留在左邊 */
  +"table[data-ta]>caption.ta-pick-caption{caption-side:top;text-align:left;padding:2px 0 5px;margin:0;border:0;background:none}"
  +"table[data-ta]>caption .ta-pick-sendwrap{display:inline-block;position:sticky;left:0}"
  +"table[data-ta]>caption .ta-pick-sendwrap[hidden]{display:none}"
  +"table[data-ta]>caption a.ta-pick-sendall{display:inline-block;font-family:var(--fm,ui-monospace,Consolas,monospace);font-size:11.5px;font-weight:600;line-height:1.5;"
   +"color:var(--accent,#7f9fc6);text-decoration:none;white-space:nowrap;padding:1px 9px;border-radius:6px;"
   +"border:1px solid color-mix(in srgb,var(--accent,#7f9fc6) 45%,transparent);background:transparent;cursor:pointer}"
  +"table[data-ta]>caption a.ta-pick-sendall:hover{background:color-mix(in srgb,var(--accent,#7f9fc6) 13%,transparent)}"
  +"@media print{#ta-pick-bar{display:none}table[data-ta]>caption .ta-pick-sendwrap{display:none}}"
  /* v1.3 div 清單：勾選格（prepend＝列的第一個 flex／inline 子元素） */
  +".ta-pick-cell{display:inline-flex;align-items:center;justify-content:center;flex:none;box-sizing:border-box;"
   +"width:28px;min-width:28px;margin:0;padding:0}"
  /* overlay：格子絕對定位在列左側、不佔 grid／flex 的格子；寬度＝列的新 padding-left（原值＋26px），勾選框置中 */
  +".ta-pick-cell.ta-pick-cell--ov{position:absolute;left:0;top:0;bottom:0;width:var(--ta-ovpad,34px);min-width:0;z-index:1}"
  +".ta-pick-ov{position:relative}"      /* 刻意低特異度：列本身已是 sticky／absolute 就沿用（同樣能當定位基準） */
  /* --ta-ovpad 由本模組寫在容器（列用）與 data-ta-pad 表頭列自己身上；!important 才壓得過母板 #id .class{padding:…} */
  +"[data-ta] .ta-pick-ov{padding-left:var(--ta-ovpad,34px)!important}"
  +"[data-ta] [data-sym].ta-pick-on{background:color-mix(in srgb,var(--accent,#7f9fc6) 9%,transparent)}"
  /* 頂端列：全選＋整張表送出。grid-column:1/-1＝容器本身是 grid 時也獨佔一整列 */
  +".ta-pick-head{display:flex;align-items:center;gap:10px;grid-column:1/-1;box-sizing:border-box;margin:0;padding:5px 0;"
   +"font-family:var(--fm,ui-monospace,Consolas,monospace);font-size:11.5px;line-height:1.5;color:var(--dim,#8a95a4)}"
  +".ta-pick-head[hidden]{display:none}"
  +".ta-pick-head .ta-pick-hall{display:inline-flex;align-items:center;cursor:pointer;user-select:none;white-space:nowrap}"
  /* 全選框的格寬跟列的 overlay 格同寬（同一個 --ta-ovpad），兩者中心對齊 */
  +".ta-pick-head .ta-pick-hbox{display:inline-flex;align-items:center;justify-content:center;flex:none;width:var(--ta-ovpad,28px)}"
  +".ta-pick-head .ta-pick-sendwrap[hidden]{display:none}"
  +".ta-pick-head a.ta-pick-sendall{display:inline-block;font-family:var(--fm,ui-monospace,Consolas,monospace);font-size:11.5px;font-weight:600;line-height:1.5;"
   +"color:var(--accent,#7f9fc6);text-decoration:none;white-space:nowrap;padding:1px 9px;border-radius:6px;"
   +"border:1px solid color-mix(in srgb,var(--accent,#7f9fc6) 45%,transparent);background:transparent;cursor:pointer}"
  +".ta-pick-head a.ta-pick-sendall:hover{background:color-mix(in srgb,var(--accent,#7f9fc6) 13%,transparent)}"
  +"@media print{.ta-pick-head{display:none}}";
  (document.head||document.documentElement).appendChild(st);
}

/* ---------- 事件委派（每張表／每個容器只掛兩個 listener）---------- */
function isTable(el){ return el.nodeName==="TABLE"; }
function wire(table){
  /* table：勾選欄；v1.3 div 容器：列的勾選格＋頂端列的全選（整張表送出的 <a> 不在這裡擋，它要跑自己的 click） */
  var HIT=isTable(table)?".ta-pick-td,.ta-pick-th":".ta-pick-cell,.ta-pick-hall";
  var ROW=isTable(table)?"tr[data-sym]":"[data-sym]";
  /* capture 階段先吃掉勾選欄的 click：母板 sortTbl 可能綁在 th 上或祖先上；div 列上的 onclick（點列展開）同理 */
  table.addEventListener("click",function(e){
    var t=e.target;
    if(t&&t.closest&&t.closest(HIT)){
      e.stopPropagation(); e.stopImmediatePropagation();
    }
  },true);
  table.addEventListener("change",function(e){
    var t=e.target; if(!t||!t.classList) return;
    if(t.classList.contains("ta-pick-cb")){
      e.stopPropagation();
      var tr=t.closest(ROW); if(!tr) return;
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

/* ---------- 名單列：table＝tbody tr[data-sym]（v1.2 原樣）；div 容器＝容器內的 [data-sym]（不含 <tr>、不含巢狀容器的列）---------- */
function rowsOf(el){
  if(isTable(el)) return el.querySelectorAll("tbody tr[data-sym]");
  var all=el.querySelectorAll("[data-sym]"), out=[];
  var nested=!!el.querySelector("[data-ta]");          /* 絕大多數容器沒有巢狀，省掉每列一次 closest */
  for(var i=0;i<all.length;i++){
    var r=all[i];
    if(r.nodeName==="TR") continue;
    if(nested&&r.parentNode.closest("[data-ta]")!==el) continue;
    out.push(r);
  }
  return out;
}

/* ---------- 掛載單表（冪等）---------- */
function mount(table,prep){
  if(!table||table.nodeType!==1) return;
  if(!isTable(table)){ mountList(table,prep); return; } /* v1.3：div 容器走自己的路，table 以下原樣 */
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
    all.setAttribute("aria-label",ALLHINT||"全選本表可見列");
    th.appendChild(all);
    hr.insertBefore(th,hr.firstChild);
  }

  /* ①b v1.2「整張表送出」鈕（caption 內；已有 caption 就附在後面）。顯示與否、文字在 paint() 更新 */
  if(!table.__taSend||!table.contains(table.__taSend)){
    var capEl=table.caption;
    if(!capEl){ capEl=table.createCaption(); capEl.className="ta-pick-caption"; }
    var wrap=document.createElement("span"); wrap.className="ta-pick-sendwrap"; wrap.hidden=true;
    var sa=document.createElement("a");
    sa.className="ta-pick-sendall"; sa.target="_blank"; sa.rel="noopener";
    sa.setAttribute("data-ta-market",market);
    var arm=function(){ var h=hrefAll(table); if(h) sa.href=h; else sa.removeAttribute("href"); return h; };
    /* href 在按下前一刻才組（mousedown／focus 先寫好，ctrl+click、中鍵也拿得到）：
       不在每次重畫時掃整張表，3,000 列才不會變慢 */
    sa.addEventListener("mousedown",arm);
    sa.addEventListener("focus",arm);
    sa.addEventListener("click",function(e){ if(!arm()) e.preventDefault(); });
    wrap.appendChild(sa);
    capEl.appendChild(wrap);
    table.__taSend=sa;
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

/* ---------- v1.3 div 容器（冪等）----------
   分兩段：prepList() 只讀、mountList() 只寫。overlay 要的原 padding-left（每個容器第一次一回、data-ta-pad
   表頭列各一回）在任何 DOM 寫入之前讀完；一次掛多個容器時（mountAll／觀察者重掛）先把每個容器都 prep 完
   再一起寫——不然第二個容器的讀取會逼瀏覽器當場重算第一個容器剛插的格子（§05 實測一次 15～30ms）。
   插格迴圈裡不讀任何樣式／layout。 */
var OVGAP=26;                                        /* overlay 在列左側多留的寬度（px） */
function cellMode(el){ return ((el.getAttribute("data-ta-cell")||"").trim().toLowerCase()==="prepend")?"prepend":"overlay"; }
function padOf(el){
  try{ var v=getComputedStyle(el).paddingLeft, n=parseFloat(v); return (/px$/.test(v)&&n>=0)?n:0; }catch(e){ return 0; }
}
var CELL={};                                          /* 勾選格原型（cloneNode 複製，同 table 版 td） */
function cellProto(ov){
  var k=ov?"ov":"pre";
  if(CELL[k]) return CELL[k];
  var c=document.createElement("span"); c.className=ov?"ta-pick-cell ta-pick-cell--ov":"ta-pick-cell";
  var cb=document.createElement("input"); cb.type="checkbox"; cb.className="ta-pick-cb";
  c.appendChild(cb);
  CELL[k]=c;
  return c;
}
/* ① 讀：還沒插格的列、還沒處理的表頭列（data-ta-pad）、overlay 的原 padding-left */
function prepList(box){
  if(!box||!marketOf(box)) return null;
  var ov=cellMode(box)==="overlay", i, r, f;
  var rows=rowsOf(box), need=[];
  for(i=0;i<rows.length;i++){
    r=rows[i]; f=r.firstElementChild;
    if(f&&f.classList&&f.classList.contains("ta-pick-cell")) continue;
    if(!(r.getAttribute("data-sym")||"").trim()) continue;
    need.push(r);
  }
  var pads=[], ps=box.querySelectorAll("[data-ta-pad]");
  for(i=0;i<ps.length;i++) if(!ps[i].classList.contains("ta-pick-padded")) pads.push(ps[i]);
  if(ov&&need.length&&box.__taPad==null) box.__taPad=padOf(need[0]);
  var padv=[];
  if(ov) for(i=0;i<pads.length;i++) padv.push(padOf(pads[i]));
  return {ov:ov,need:need,pads:pads,padv:padv};
}
function mountList(box,prep){
  var market=marketOf(box); if(!market) return;
  if(!prep||!prep.need) prep=prepList(box);
  ensureCss();
  if(!box.__taWired){ box.__taWired=true; wire(box); }
  var ov=prep.ov, need=prep.need, pads=prep.pads, padv=prep.padv;
  var i,r,sym;

  /* ② 寫：留位寬度（容器上一個變數，列繼承） */
  if(ov&&box.__taPad!=null){
    var w=(box.__taPad+OVGAP)+"px";
    if(box.style.getPropertyValue("--ta-ovpad")!==w) box.style.setProperty("--ta-ovpad",w);
  }

  /* ③ 頂端列：全選＋整張表送出（容器被 innerHTML 重畫掉就重建）。顯示與否、文字在 paint() 更新 */
  if(!box.__taHead||box.__taHead.parentNode!==box){
    var head=document.createElement("div"); head.className="ta-pick-head"; head.hidden=true;
    var lab=document.createElement("label"); lab.className="ta-pick-hall";
    var hb=document.createElement("span"); hb.className="ta-pick-hbox";
    var all=document.createElement("input"); all.type="checkbox"; all.className="ta-pick-all";
    all.setAttribute("aria-label",ALLHINT||"全選本表可見列");
    hb.appendChild(all); lab.appendChild(hb); lab.appendChild(document.createTextNode("全選"));
    var wrap=document.createElement("span"); wrap.className="ta-pick-sendwrap"; wrap.hidden=true;
    var sa=document.createElement("a");
    sa.className="ta-pick-sendall"; sa.target="_blank"; sa.rel="noopener";
    sa.setAttribute("data-ta-market",market);
    var arm=function(){ var h=hrefAll(box); if(h) sa.href=h; else sa.removeAttribute("href"); return h; };
    sa.addEventListener("mousedown",arm);
    sa.addEventListener("focus",arm);
    sa.addEventListener("click",function(e){ if(!arm()) e.preventDefault(); });
    wrap.appendChild(sa);
    head.appendChild(lab); head.appendChild(wrap);
    /* 頂端列上的 click 不往外冒：容器外層若有點擊行為（收合卡片之類）不會被誤觸 */
    head.addEventListener("click",function(e){ e.stopPropagation(); });
    box.insertBefore(head,box.firstChild);
    box.__taHead=head; box.__taSend=sa;
  }

  /* ④ 表頭列留位（data-ta-pad）：overlay＝同樣多 26px（用它自己的原值）；prepend＝插一個同寬空白格 */
  for(i=0;i<pads.length;i++){
    var p=pads[i];
    if(p.classList.contains("ta-pick-padded")) continue;        /* prep 之後被別條路處理過（純 DOM 讀，不碰樣式） */
    if(ov){
      p.style.setProperty("--ta-ovpad",(padv[i]+OVGAP)+"px");
      p.classList.add("ta-pick-ov");
    }else{
      var sp=document.createElement("span"); sp.className="ta-pick-cell ta-pick-cell--pad"; sp.setAttribute("aria-hidden","true");
      p.insertBefore(sp,p.firstChild);
    }
    p.classList.add("ta-pick-padded");
  }

  /* ⑤ 每列最前面插勾選格。迴圈內只寫 DOM、不讀 layout。 */
  var proto=cellProto(ov), rc=ov?"ta-pick-ov":"ta-pick-pre";
  for(i=0;i<need.length;i++){
    r=need[i];
    var f0=r.firstElementChild; if(f0&&f0.classList&&f0.classList.contains("ta-pick-cell")) continue;   /* 同上 */
    sym=(r.getAttribute("data-sym")||"").trim();
    var c=proto.cloneNode(true);
    c.firstChild.value=sym;
    r.insertBefore(c,r.firstChild);
    r.classList.add(rc);
  }

  /* ⑥ 重打勾 ＋ 套上限 */
  paint(box);
  renderBar();
}

/* ---------- 依 state 重畫某表（或 div 容器）的勾選／disabled／上限說明 ---------- */
function paint(table){
  var market=marketOf(table); if(!market) return;
  var set=bucket(keyOf(market));
  var full=set.size>=MAX;
  var rows=rowsOf(table);
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
  /* v1.3 div 容器：全選在自己插的頂端列裡（不用 querySelector，免得抓到巢狀的別張表）；0 列就整條藏起來 */
  var head=isTable(table)?null:table.__taHead;
  if(head&&head.hidden!==(n===0)) head.hidden=(n===0);
  var allCb=head?head.querySelector("input.ta-pick-all"):isTable(table)?table.querySelector("input.ta-pick-all"):null;
  if(allCb){
    /* 不讀 layout：全選格狀態用「本表列數 vs 已勾數」算，不看可見性 */
    var everything=n>0&&on===n;
    if(allCb.checked!==everything) allCb.checked=everything;
    var mid=on>0&&on<n;
    if(allCb.indeterminate!==mid) allCb.indeterminate=mid;
    if(allCb.disabled!==(n===0)) allCb.disabled=(n===0);
    var t=full?CAP:(ALLHINT?ALLHINT+"｜"+hintOf(table):hintOf(table));
    if(allCb.title!==t) allCb.title=t;
    var pth=allCb.parentNode;
    if(pth&&pth.title!==t) pth.title=t;                 /* 全選格本身也帶同一個說明 */
  }
  /* v1.2 整張表送出：只更新文字與顯示（比對後才寫），不掃表、不組 href */
  var sa=table.__taSend;
  if(sa){
    var hide=(n<2)||!taUrl();
    var w=sa.parentNode;
    if(w&&w.hidden!==hide) w.hidden=hide;
    if(!hide){
      var lab=n>MAX?"整張表送出前 "+MAX+" 檔（本表 "+n+" 檔）↗":"整張表送出 "+n+" 檔 ↗";
      var tt=n>MAX?"本表 "+n+" 檔，一次最多 "+MAX+" 檔：照目前排序送前 "+MAX+" 檔（想換一批先排序）。不影響勾選。"
                  :"把本表全部 "+n+" 檔（含捲到外面的列）一次丟到技術分析頁。不影響勾選。";
      if(sa.textContent!==lab) sa.textContent=lab;
      if(sa.title!==tt) sa.title=tt;
    }
  }
}

/* ---------- v1.2 整張表送出：該表所有列（不看可見性），目前 DOM 順序、去重、截到 MAX ---------- */
function symsAll(table){
  var rows=rowsOf(table), out=[], seen={};
  for(var i=0;i<rows.length&&out.length<MAX;i++){
    var s=(rows[i].getAttribute("data-sym")||"").trim();
    if(!s||seen[s]) continue;
    seen[s]=1; out.push(s);
  }
  return out;
}
function hrefAll(table){ return buildHref(symsAll(table)); }

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
  /* v1.2：列數比上限多的表，全選後格子是「半勾」，再按一下瀏覽器會把它當「全選」——但已經滿了、什麼都加不進去，
     看起來像按鈕壞掉。滿了而且本表有勾 → 當成「取消本表」。 */
  if(on&&set.size>=MAX&&table.querySelector("input.ta-pick-cb:checked")) on=false;
  if(on){
    /* 勾：掃列，勾到上限就 break——最多讀 15 列的 offsetParent */
    var rows=rowsOf(table);
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
      var tr=isTable(table)?table.querySelector('tbody tr[data-sym="'+sym.replace(/["\\]/g,"\\$&")+'"]')
                           :ownRow(table,sym);
      if(tr&&tr.offsetParent!==null) set["delete"](sym);
    });
  }
  mirror(key);
  refresh();
}
/* v1.3 div 容器裡找某代號的列（跳過 <tr> 與巢狀容器的列） */
function ownRow(box,sym){
  var rs=box.querySelectorAll('[data-sym="'+sym.replace(/["\\]/g,"\\$&")+'"]');
  for(var i=0;i<rs.length;i++){
    var r=rs[i];
    if(r.nodeName!=="TR"&&r.parentNode.closest("[data-ta]")===box) return r;
  }
  return null;
}

/* ---------- 頁面上有哪些市場（依表格／容器出現順序）---------- */
function groups(){
  var out=[],seen={};
  var ts=document.querySelectorAll("[data-ta]");
  for(var i=0;i<ts.length;i++){
    var m=marketOf(ts[i]); if(!m||seen[m]) continue; seen[m]=1;
    out.push({market:m,key:keyOf(m),syms:Array.from(bucket(keyOf(m)))});
  }
  return out;
}

/* ---------- 浮動按鈕 ---------- */
function ensureBar(){
  if(!document.querySelector("[data-ta]")) return null;         /* 沒名單表／名單容器的頁面不注入 */
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
/* 連結：${TA_URL}?t=…&d=…[&r=rid][#k=票]。TA_URL 已含 ? 就用 & 接；TA_URL 自帶的 #… 先拿掉（不然參數會落進 hash）。
   通行票只放 hash：hash 不會送到伺服器、不進存取紀錄，/ta 頁讀完就用 replaceState 抹掉。 */
function buildHref(syms){
  var u=taUrl(); if(!u||!syms||!syms.length) return "";
  var hi=u.indexOf("#"); if(hi>=0) u=u.slice(0,hi);
  var h=u+(u.indexOf("?")<0?"?":"&")+"t="+syms.map(encodeURIComponent).join(",")+"&d="+encodeURIComponent(repDate());
  if(CFG.rid) h+="&r="+encodeURIComponent(CFG.rid);
  if(CFG.k) h+="#k="+encodeURIComponent(CFG.k);
  return h;
}
function hrefFor(g){ return g?buildHref(g.syms):""; }
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

/* ---------- v1.2 台股表自動打標（script 有 data-ta-autotag 或 data-ta-auto="tw" 才跑）----------
   規則同 token_server.py tw_tag_tables：
     · 表：沒有 data-ta，且 thead 第一列第一格是 th、純文字剛好是「代號」
     · 列：tbody 的直屬列、沒有 data-sym、第一格是 td 且純文字符合 ^\d{4,6}[A-Z]?$ → 補 data-sym
     · 至少一列符合才把表標成 data-ta="tw"
   自動打標過的表（本模組標的，或伺服器端補標並帶 data-ta-autotagged 的）之後 tbody 重畫，新列會再補標；
   報告作者自己寫 data-ta 的表一律不碰。只寫屬性、不讀 layout。 */
var TW_CODE=/^\d{4,6}[A-Z]?$/;
function tagRows(t){
  var n=0, bs=t.tBodies;
  for(var b=0;b<bs.length;b++){
    var rs=bs[b].rows;
    for(var i=0;i<rs.length;i++){
      var tr=rs[i];
      if(tr.hasAttribute("data-sym")) continue;
      var f=tr.firstElementChild;
      if(!f||f.nodeName!=="TD") continue;
      var code=(f.textContent||"").trim();
      if(TW_CODE.test(code)){ tr.setAttribute("data-sym",code); n++; }
    }
  }
  return n;
}
function autoTag(){
  if(!CFG.auto) return;
  var ts=document.querySelectorAll("table");
  for(var i=0;i<ts.length;i++){
    var t=ts[i];
    if(t.__taAuto||t.hasAttribute("data-ta-autotagged")){ t.__taAuto=true; tagRows(t); continue; }
    if(t.hasAttribute("data-ta")) continue;
    var hr=t.tHead&&t.tHead.rows[0], c=hr&&hr.firstElementChild;
    if(!c||c.nodeName!=="TH"||(c.textContent||"").trim()!=="代號") continue;
    if(tagRows(t)>0){ t.setAttribute("data-ta","tw"); t.__taAuto=true; }
  }
}

/* ---------- 對外 ---------- */
function mountAll(){
  autoTag();                                   /* 自動補標只對 table（v1.3 div 清單靠列樣板自己帶 data-sym） */
  var ts=document.querySelectorAll("[data-ta]"), preps=[], i;
  for(i=0;i<ts.length;i++) preps.push(isTable(ts[i])?null:prepList(ts[i]));   /* v1.3：div 容器先讀完再開始寫 */
  for(i=0;i<ts.length;i++) mount(ts[i],preps[i]);
  renderBar();
}
function refresh(){
  var ts=document.querySelectorAll("[data-ta]");
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

/* ---------- 後來才出現的表／div 容器（§02 重畫、chip-render 延遲插入、四型態卡片重畫）----------
   v1.3：只動到 div 容器的變動（例：§05 每點一列、每排序一次，chip-render 就整個四型態重建）只重掛
   「那幾個容器」，不跑全頁 mountAll——報告有 150 多張名單表，全頁掃一輪要 30ms 上下，每點一下都付不值得。
   只要有任何 table 相關的變動，照 v1.2 跑全頁 mountAll（table 行為不變）。 */
var pending=false, pendAll=false, pendList=[];
function schedule(list){
  if(list){ for(var i=0;i<list.length;i++) if(pendList.indexOf(list[i])<0) pendList.push(list[i]); }
  else pendAll=true;
  if(pending) return; pending=true;
  var run=function(){
    pending=false;
    var all=pendAll, l=pendList; pendAll=false; pendList=[];
    if(all){ mountAll(); return; }
    mountMany(l);
  };
  /* 分頁在背景時 rAF 會被凍住（實測 hidden tab 完全不觸發），改用 timer 收尾；
     不然背景分頁裡渲染完成的表要等使用者切回來才掛上。 */
  if(document.hidden||!window.requestAnimationFrame) setTimeout(run,32);
  else requestAnimationFrame(run);
}
/* 一次重掛多個 div 容器：先全部讀完、再一起寫（還在頁面上的才掛） */
function mountMany(l){
  var live=[], preps=[], k;
  for(k=0;k<l.length;k++) if(l[k]&&document.documentElement.contains(l[k])) live.push(l[k]);
  for(k=0;k<live.length;k++) preps.push(isTable(live[k])?null:prepList(live[k]));
  for(k=0;k<live.length;k++) mount(live[k],preps[k]);
}
var OWN=/(^|\s)ta-pick-(td|th|caption|sendwrap|cell|head)(\s|$)/;
function watch(){
  if(!window.MutationObserver) return;
  new MutationObserver(function(muts){
    var divs=[];
    for(var i=0;i<muts.length;i++){
      var add=muts[i].addedNodes; if(!add||!add.length) continue;
      for(var j=0;j<add.length;j++){
        var n=add[j]; if(!n||n.nodeType!==1) continue;
        /* v1.3：本模組自己插的格子／頂端列不算（不然每次插完都白跑一輪） */
        if(typeof n.className==="string"&&OWN.test(n.className)) continue;
        /* 只認「是名單表／含名單表／在名單表裡」的節點：否則自己插 td 也會觸發，rAF 打不完（v1.2 原樣） */
        if((n.matches&&n.matches("table[data-ta]"))
          ||(n.querySelector&&n.querySelector("table[data-ta]"))
          ||(n.closest&&n.closest("table[data-ta]"))){ schedule(); return; }
        /* v1.3 div 容器：是容器／在容器裡 → 記下那個容器；含容器 → 記下裡面每一個（到這裡已確定沒有 table[data-ta]） */
        var c=n.closest&&n.closest("[data-ta]");
        if(c) divs.push(c);
        if(n.querySelectorAll){ var cs=n.querySelectorAll("[data-ta]"); for(var k=0;k<cs.length;k++) divs.push(cs[k]); }
        /* v1.2 自動打標開著時，後來才渲染出來、還沒標的表（含 thead 的 table）也要吃到 */
        if(CFG.auto&&((n.matches&&n.matches("table"))||(n.querySelector&&n.querySelector("table thead")))){ schedule(); return; }
      }
    }
    if(divs.length) schedule(divs);
  }).observe(document.documentElement,{subtree:true,childList:true});
}

window.TAPick={mount:function(el){ mount(el); },mountAll:mountAll,refresh:refresh,state:state,clear:clear,MAX:MAX,
               _date:repDate,_url:taUrl,_href:buildHref,_hrefAll:hrefAll,
               _mountMany:function(l){ mountMany(Array.prototype.slice.call(l||[])); },version:"1.3"};

if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",function(){ mountAll(); watch(); });
else { mountAll(); watch(); }
})();
