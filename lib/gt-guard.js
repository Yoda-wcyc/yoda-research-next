// React × Google 網頁翻譯 相容防護（layout.jsx 以內聯 <script> 放進 <head>，React 動 DOM 之前就生效）· 2026-10-09
//
// 問題：讀者切 English 後，Google 翻譯（以及 yoda-lang.js 的專有名詞對照）會把 React 擁有的文字節點換掉——
//   Google：insertBefore(<font>譯文</font>, 原文字節點) 再 removeChild(原文字節點)
//   對照表：replaceChild(片段, 原文字節點)
// React 手上還握著原文字節點，之後：
//   ① 改字（nodeValue = 新字）→ 改到已脫離畫面的節點，畫面停在舊譯文（文字「被還原」／不更新）
//   ② 移除／插在它前面 → 找不到父節點，丟 NotFoundError（removeChild／insertBefore）整頁掛掉
// 防護（業界通用作法 facebook/react#11538 的加強版）：
//   - 記下「原文字節點 → 取代它的節點」對照（只記 <font> 與對照表片段，其他一律不碰）
//   - React 改脫離節點的字 → 先把原節點放回取代物的位置、拿掉取代物，再改字（Google 會自動重翻新字）
//   - React 移除脫離節點 → 改移除取代物；插在脫離節點前 → 改插在取代物前；都找不到就安靜略過，不丟錯
// 繁中模式不會產生對照，所有呼叫照原本行為走，零影響。
export const GT_GUARD = `(function(){
if(typeof Node!=='function'||!Node.prototype||Node.prototype.__yodaGt)return;
var P=Node.prototype,rc=P.removeChild,ib=P.insertBefore,rp=P.replaceChild,M=new WeakMap();
P.__yodaGt=1;
function live(n,d){if(n.parentNode)return[n];if(d>8||!M.has(n))return[];var o=[];M.get(n).forEach(function(x){o=o.concat(live(x,d+1))});return o}
function back(t){var r=live(t,0);if(!r.length||t.parentNode)return;var p=r[0].parentNode;ib.call(p,t,r[0]);r.forEach(function(x){if(x.parentNode)rc.call(x.parentNode,x)});M.delete(t)}
P.insertBefore=function(n,ref){
  if(ref&&ref.parentNode!==this){var r=live(ref,0);if(r.length&&r[0].parentNode===this)return ib.call(this,n,r[0]);if(r.length)return ib.call(r[0].parentNode,n,r[0]);return n}
  if(ref&&ref.nodeType===3&&n&&n.nodeName==='FONT'){var a=M.get(ref);if(a&&ref.parentNode)a.push(n);else M.set(ref,[n])}
  return ib.apply(this,arguments)};
P.removeChild=function(c){
  if(c&&c.parentNode!==this){var r=live(c,0);r.forEach(function(x){if(x.parentNode)rc.call(x.parentNode,x)});return c}
  return rc.apply(this,arguments)};
P.replaceChild=function(n,o){
  if(o&&o.parentNode===this&&o.nodeType===3&&n){M.set(o,n.nodeType===11?Array.prototype.slice.call(n.childNodes):[n])}
  else if(o&&o.parentNode!==this){var r=live(o,0);if(r.length){ib.call(r[0].parentNode,n,r[0]);r.forEach(function(x){if(x.parentNode)rc.call(x.parentNode,x)})}return o}
  return rp.apply(this,arguments)};
var nv=Object.getOwnPropertyDescriptor(P,'nodeValue');
if(nv&&nv.set&&nv.configurable){Object.defineProperty(P,'nodeValue',{configurable:true,enumerable:nv.enumerable,get:nv.get,set:function(v){if(this.nodeType===3&&!this.parentNode&&M.has(this))back(this);nv.set.call(this,v)}})}
})();`;
