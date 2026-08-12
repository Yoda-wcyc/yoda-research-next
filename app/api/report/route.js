import { verifyJwt } from '../../../lib/jwt';
import { blobPath } from '../../../lib/blob';
import { CORS, J, preflight } from '../../../lib/cors';
import { get } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() { return preflight(); }

// 會員開付費報告（快路徑）：驗票(HMAC·<1ms) → 私有 Blob 直讀 → 烤逐人浮水印 → 回 JSON。
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}

  const payload = verifyJwt(body.token, process.env.JWT_SECRET || '');
  if (!payload) return J({ ok: true, allow: false, reason: 'need-login', error: '請重新登入' });

  const reportId = String(body.reportId || '').replace(/\.html?$/i, '').trim();
  if (!reportId) return J({ ok: false, error: '缺 reportId' });

  let html;
  try {
    const result = await get(blobPath(reportId), { access: 'private' });
    if (result === null) return J({ ok: true, allow: true, error: '找不到這份報告：' + reportId });
    html = await new Response(result.stream).text();
  } catch (e) {
    return J({ ok: true, allow: true, error: '讀取報告失敗：' + String((e && e.message) || e) });
  }

  const wm = payload.wm || '會員專屬';
  html = html.split('{{WATERMARK}}').join(wm); // 逐人浮水印
  return J({ ok: true, allow: true, html, watermark: wm, memberId: payload.sub || '' });
}
