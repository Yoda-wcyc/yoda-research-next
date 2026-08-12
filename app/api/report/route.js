import { verifyJwt } from '../../../lib/jwt';
import { blobPath } from '../../../lib/blob';
import { list } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 會員開付費報告（快路徑）：驗票(HMAC·<1ms) → 從 Vercel Blob 讀報告 → 烤逐人浮水印 → 回 JSON。
// 內容不放公開網址；Blob 路徑含密鑰 HMAC、不可猜，且只在伺服器端使用、不外流；沒票拿不到。
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}

  const payload = verifyJwt(body.token, process.env.JWT_SECRET || '');
  if (!payload) return Response.json({ ok: true, allow: false, reason: 'need-login', error: '請重新登入' });

  const reportId = String(body.reportId || '').replace(/\.html?$/i, '').trim();
  if (!reportId) return Response.json({ ok: false, error: '缺 reportId' });

  let blobUrl = null;
  try {
    const { blobs } = await list({ prefix: blobPath(reportId), token: process.env.BLOB_READ_WRITE_TOKEN });
    if (blobs && blobs.length) blobUrl = blobs[0].url;
  } catch (e) {}
  if (!blobUrl) return Response.json({ ok: true, allow: true, error: '找不到這份報告：' + reportId });

  let html;
  try {
    const r = await fetch(blobUrl, { cache: 'no-store' });
    if (!r.ok) return Response.json({ ok: true, allow: true, error: '讀取報告失敗' });
    html = await r.text();
  } catch (e) {
    return Response.json({ ok: true, allow: true, error: '讀取報告失敗' });
  }

  const wm = payload.wm || '會員專屬';
  html = html.split('{{WATERMARK}}').join(wm); // 逐人浮水印
  return Response.json({ ok: true, allow: true, html, watermark: wm, memberId: payload.sub || '' });
}
