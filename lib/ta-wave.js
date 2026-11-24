// /ta「波浪」分頁（2026-11-24）：從最新一份會員版「專題研究_波浪理論」整份 HTML 只切「互動波浪圖表」
// （四指數 tab 列、數法按鈕、上下兩張圖、時間軸、ⓘ 說明、圖例與圖下提示句），組成給 <iframe srcdoc> 的完整小文件。
// 不帶：tab 列上方「四個指數一起看」文字框、01 哪一種、02 鐵律、頁首頁尾、訂閱／分享鈕（Yoda 11-24「只搬圖表」）。
// 不重算：報告裡是哪一版就顯示哪一版。錨點切不到就 throw（訊息講清楚缺哪個錨點），呼叫端回錯誤，不回空頁。

// 會員版 reportId：付費_專題研究_波浪理論_YYYYMMDD；錨定結尾，_預覽／_v2 這類同日副本不算
export const WAVE_RE = /^付費_專題研究_波浪理論_(\d{8})$/;

export function newestWave(entries) {
  let best = null, bd = '';
  for (const e of entries || []) {
    const m = String((e && e.reportId) || '').match(WAVE_RE);
    if (m && m[1] > bd) { best = e.reportId; bd = m[1]; }
  }
  return best ? { reportId: best, date: bd.slice(0, 4) + '-' + bd.slice(4, 6) + '-' + bd.slice(6, 8) } : null;
}

// 同 lib/ta-idx.js：由左到右掃，註解、<script> 整塊跳過，只收 <style>
function stylesOf(s) {
  const out = [];
  const re = /<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi;
  let m;
  while ((m = re.exec(s))) if (/^<style/i.test(m[0])) out.push(m[0]);
  return out.join('\n');
}

function fail(what) { throw new Error('波浪報告切片失敗：找不到' + what); }

// 給父頁（app/ta/WaveView.jsx）的橋：回報高度、收深淺切換。iframe 只開 allow-scripts（opaque origin），父頁碰不到 contentDocument，只能 postMessage
const BRIDGE = '<script>(function(){'
  + "addEventListener('message',function(e){var d=e.data;if(d&&d.type==='ta-wave-theme')document.documentElement.setAttribute('data-theme',d.theme==='light'?'light':'dark');});"
  + "var last=-1;function rep(){var h=Math.ceil(document.body.scrollHeight);if(h!==last){last=h;parent.postMessage({type:'ta-wave-h',h:h},'*');}}"
  + "try{new ResizeObserver(rep).observe(document.body);}catch(e){addEventListener('resize',rep);}"
  + "addEventListener('load',rep);rep();"
  + '})();</script>';

export function extractWave(html) {
  const s = String(html || '');
  const b = s.search(/<body\b/i);
  if (b < 0) fail(' <body>');
  const h = s.indexOf('<div class="wv-tabs"', b);
  if (h < 0) fail('四指數 tab 列（div.wv-tabs）');
  const endRe = /<div\b[^>]*\bid="sec-rank"/g;
  endRe.lastIndex = h;
  const m = endRe.exec(s);
  if (!m) fail('圖表區的結尾錨點（#sec-rank）');
  const body = s.slice(h, m.index).trimEnd().replace(/\bdata-tip\b/g, 'data-wv-tip');
  for (const k of ['ndx', 'spx', 'sox', 'twii']) {
    if (!body.includes('id="wv-tab-' + k + '"')) fail(' tab #wv-tab-' + k);
    if (!body.includes('id="wv-chart-' + k + '"')) fail('圖表 #wv-chart-' + k);
  }
  if (/context-box|id="sec-(rank|rules)"/.test(body)) fail('乾淨的圖表區（切片混進文字框或 01／02 章節）');

  const head = s.slice(0, b);
  if (!/<style\b[^>]*\bid="wv-css"/.test(head)) fail('圖表樣式 <style id="wv-css">');
  const j = s.indexOf('<script id="wv-js">', h);
  const je = j < 0 ? -1 : s.indexOf('</script>', j);
  if (je < 0) fail('圖表腳本 <script id="wv-js">');
  // data-tip 跟 /ta 的說明框撞名 → data-wv-tip（同總經 1203 的做法）
  const js = s.slice(j, je + 9).replace(/\bdata-tip\b/g, 'data-wv-tip');

  // 報告 body 是「左側 nav＋主欄」的 flex、html 強制捲軸、body 至少 100vh、字級 24px：單獨放要拿掉，iframe 才量得到真實高度、塞得進 /ta 右側窗格
  const fit = '<style>html{overflow:hidden!important}body{display:block!important;min-height:0!important;margin:0;padding:0 2px 8px;font-size:16px!important}.wv-tabs{margin-top:0!important}</style>';
  return '<!doctype html><html lang="zh-TW" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + stylesOf(head) + fit + '</head><body>' + body + js + BRIDGE + '</body></html>';
}
