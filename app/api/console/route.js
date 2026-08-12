import { HTML_B64 } from './html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 主控台由 Vercel 供頁（?k=CONSOLE_TOKEN 才吐·私密）。載入快；讀名單走 Neon，寄信等操作仍走 GAS(fetch)。
export async function GET(req) {
  const k = new URL(req.url).searchParams.get('k') || '';
  if (!process.env.CONSOLE_TOKEN || k !== process.env.CONSOLE_TOKEN) {
    return new Response('Not found', { status: 404 });
  }
  const html = Buffer.from(HTML_B64, 'base64').toString('utf8');
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
