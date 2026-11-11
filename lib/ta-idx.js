// /ta「指數位階」分頁（2026-11-11 Yoda 定）：從最新一份美股報告整份 HTML 抽出「02 指數位階」這一章，
// 組成一份可以直接塞進 <iframe srcdoc> 的小文件（章內腳本靠 document.currentScript／inline onclick，只能在自己的文件裡跑）。
// 不重算任何東西：報告裡是哪一版就顯示哪一版。找不到章節回 null（呼叫端回錯誤訊息），不 throw。

// 美股報告的 reportId：美股分析_YYYYMMDD 或 付費_美股分析_YYYYMMDD（免費版另有殼，不用）
export const US_RE = /^(?:付費_)?美股分析_(\d{8})/;

// 索引 entries 已依日期降序排好（lib/report-index normalize）；保險起見這裡自己再挑一次最新
export function newestUs(entries) {
  let best = null, bd = '';
  for (const e of entries || []) {
    const m = String((e && e.reportId) || '').match(US_RE);
    if (m && m[1] > bd) { best = e.reportId; bd = m[1]; }
  }
  return best ? { reportId: best, date: bd.slice(0, 4) + '-' + bd.slice(4, 6) + '-' + bd.slice(6, 8) } : null;
}

// 照瀏覽器的切法由左到右掃：註解、<script> 整塊跳過，只收 <style>（避免註解或腳本字串裡的 <style 被誤抓）
function stylesOf(s) {
  const out = [];
  const re = /<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi;
  let m;
  while ((m = re.exec(s))) if (/^<style/i.test(m[0])) out.push(m[0]);
  return out.join('\n');
}

// 報告共用的 sortTbl（點表頭排序）：從 function 開頭數大括號到收尾；沒有就回 ''（表格只是不能排序）
function sortTblOf(s) {
  const i = s.search(/function\s+sortTbl\s*\(/);
  if (i < 0) return '';
  let d = 0;
  for (let j = s.indexOf('{', i); j > 0 && j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}' && --d === 0) return s.slice(i, j + 1);
  }
  return '';
}

export function extractIdxPos(html) {
  try {
    const s = String(html || '');
    const h = s.search(/<div\b[^>]*\bid="sec-idxpos"/);
    if (h < 0) return null;
    const re = /<div\b[^>]*\bclass="section-header\b/g;   // 下一個章首＝這一章的結尾
    re.lastIndex = h + 1;
    const m = re.exec(s);
    if (!m) return null;
    let body = s.slice(h, m.index).trimEnd();
    for (let i; (i = body.lastIndexOf('<!--')) >= 0 && /-->\s*$/.test(body);) body = body.slice(0, i).trimEnd();   // 尾巴是下一章的說明註解
    if (!/data-idxpos-take/.test(body)) return null;
    body = body.replace(/<div class="section-num">[^<]*<\/div>/, '');   // 單獨看時「02」編號沒意義，留標題
    const styles = stylesOf(s.slice(0, h) + s.slice(m.index));        // 章內的 <style> 本來就在 body 裡
    const sort = sortTblOf(s);
    // 報告 body 是「左側 nav 230px＋主欄」的 grid、html 強制捲軸、body 至少 100vh：抽出來單獨放要拿掉，iframe 才量得到真實高度
    // --fs：報告預設 24px 放在 /ta 右側窗格偏大，壓到 18px（只改這一個變數，其餘字級都從它推導）
    const fit = '<style>html{overflow:hidden!important}body{display:block!important;min-height:0!important;padding:0 2px 8px}:root{--fs:18px}#sec-idxpos{margin-top:0!important}</style>';
    return '<!doctype html><html><head><meta charset="utf-8">' + styles + fit + '</head><body>'
      + '<div class="main"><div id="report-root"><div class="wrap">' + body + '</div></div></div>'
      + (sort ? '<script>' + sort + '</script>' : '') + '</body></html>';
  } catch (e) {
    return null;
  }
}
