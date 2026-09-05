import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 元素總覽頁：每個拉桿控制什麼，一頁看完。給視覺控制台的 iframe 用，CONSOLE_TOKEN 保護。
// 正本 Skill\viz-specimen.html，由 `python Skill\yoda_tokens.py sync-console` 複製到 app/api/viz/。
const HTML_PATH = path.join(process.cwd(), 'app', 'api', 'viz', 'viz-specimen.html');

export async function GET(req) {
  const k = new URL(req.url).searchParams.get('k') || '';
  if (!process.env.CONSOLE_TOKEN || k !== process.env.CONSOLE_TOKEN) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (e) {
    return new Response('總覽頁讀取失敗：' + String((e && e.message) || e), { status: 500 });
  }
}
