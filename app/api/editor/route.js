import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 報告編輯器由 Vercel 供頁（?k=CONSOLE_TOKEN 才吐·私密），跟主控台／視覺控制台同一把鑰匙、同一種做法：
// 直接讀原始檔，不做 base64 快照。正本在 Skill\report-editor.html，
// 用 `python Skill\yoda_tokens.py sync-console` 複製過來這裡再 push。
const HTML_PATH = path.join(process.cwd(), 'app', 'api', 'editor', 'editor.html');

export async function GET(req) {
  const k = new URL(req.url).searchParams.get('k') || '';
  if (!process.env.CONSOLE_TOKEN || k !== process.env.CONSOLE_TOKEN) {
    return new Response('Not found', { status: 404 });
  }
  let html;
  try {
    html = fs.readFileSync(HTML_PATH, 'utf8');
  } catch (e) {
    return new Response('編輯器原始檔讀取失敗：' + String((e && e.message) || e), { status: 500 });
  }
  const hash = crypto.createHash('sha1').update(html, 'utf8').digest('hex').slice(0, 7);
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Yoda-Build': hash },
  });
}
