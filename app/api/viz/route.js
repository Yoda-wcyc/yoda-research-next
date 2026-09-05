import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 視覺控制台由 Vercel 供頁（?k=CONSOLE_TOKEN 才吐·私密），跟 /api/console 同一把鑰匙、同一種做法：
// 直接讀原始檔，不做 base64 快照，改了原始檔就一定同步（主控台 2026-08-21 吃過快照沒更新的虧）。
//
// 正本在 G:\Yoda x Claude\視覺實驗室\視覺控制台.html，
// 由 `python Skill\yoda_tokens.py sync-console` 複製過來這裡再 push。
// 同一份 HTML 本機（token_server.py, http://localhost:8777）與雲端都能跑，
// 差別只在後端：本機讀寫 Skill\tokens\ 且能 apply；雲端讀寫 Blob、不能 apply。
const HTML_PATH = path.join(process.cwd(), 'app', 'api', 'viz', 'viz-console.html');

export async function GET(req) {
  const k = new URL(req.url).searchParams.get('k') || '';
  if (!process.env.CONSOLE_TOKEN || k !== process.env.CONSOLE_TOKEN) {
    return new Response('Not found', { status: 404 });
  }
  let html;
  try {
    html = fs.readFileSync(HTML_PATH, 'utf8');
  } catch (e) {
    return new Response('視覺控制台原始檔讀取失敗：' + String((e && e.message) || e), { status: 500 });
  }
  const hash = crypto.createHash('sha1').update(html, 'utf8').digest('hex').slice(0, 7);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Yoda-Build': hash,
    },
  });
}
