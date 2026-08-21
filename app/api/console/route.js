import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 主控台由 Vercel 供頁（?k=CONSOLE_TOKEN 才吐·私密）。讀名單走 Neon，寄信等操作仍走 GAS(fetch)。
//
// ★ 這裡「直接讀 console.html 原始檔」，不再用 base64 快照。
//   舊做法是把 HTML base64 內嵌在 html.js，改了原始檔卻忘記重新產生時，
//   Vercel 會靜默供出舊版——沒有錯誤、只是畫面少東西，非常難查（2026-08-21 就中過）。
//   現在原始檔就是唯一來源，不可能不同步。
//
// 同一份 console.html 也要貼回 GAS 編輯器（備援入口）。兩邊都會即時算出內容雜湊當版本戳，
// 畫面右上角看到的雜湊一樣＝兩個入口同版；不一樣＝有一邊忘了更新。
const HTML_PATH = path.join(process.cwd(), 'app', 'api', 'console', 'console.html');
const STAMP_RE = /(<span class="build" id="buildStamp"[^>]*>)([^<]*)(<\/span>)/;

// 版本戳＝內容雜湊（先把舊戳清掉、換行正規化再算；GAS 端用同一套算法，兩邊才對得起來）
function stampBuild(html, where) {
  if (!STAMP_RE.test(html)) return html;
  const bare = html.replace(STAMP_RE, '$1$3').split('\r\n').join('\n');
  const hash = crypto.createHash('sha1').update(bare, 'utf8').digest('hex').slice(0, 7);
  return html.replace(STAMP_RE, `$1build ${hash} · ${where}$3`);
}

export async function GET(req) {
  const k = new URL(req.url).searchParams.get('k') || '';
  if (!process.env.CONSOLE_TOKEN || k !== process.env.CONSOLE_TOKEN) {
    return new Response('Not found', { status: 404 });
  }
  let html;
  try {
    html = fs.readFileSync(HTML_PATH, 'utf8');
  } catch (e) {
    // 寧可大聲壞掉，也不要靜默供出舊版
    return new Response('主控台原始檔讀取失敗：' + String((e && e.message) || e), { status: 500 });
  }
  return new Response(stampBuild(html, 'vercel'), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
