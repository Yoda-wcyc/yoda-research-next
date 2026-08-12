import { blobPath } from '../../../lib/blob';
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 後台（斷點編輯器）上傳付費檔到 Vercel Blob（選項②：內容存 Vercel 自己家）。以 ADMIN_KEY 保護。
// 路徑用 blobPath（含密鑰 HMAC、確定性）→ 同 reportId 直接覆蓋，免刪舊、免對照表。
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}

  if (!process.env.ADMIN_KEY || body.key !== process.env.ADMIN_KEY) {
    return Response.json({ ok: false, error: '管理密碼錯誤' }, { status: 403 });
  }
  const name = String(body.name || '').replace(/\.html?$/i, '').trim();
  const html = String(body.html || '');
  if (!name) return Response.json({ ok: false, error: 'name（reportId）必填' });
  if (!html) return Response.json({ ok: false, error: 'html 內容為空' });

  try {
    const res = await put(blobPath(name), html, {
      access: 'private',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      contentType: 'text/html; charset=utf-8',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return Response.json({ ok: true, reportId: name, url: res.url });
  } catch (e) {
    return Response.json({ ok: false, error: 'Blob 上傳失敗：' + String((e && e.message) || e) });
  }
}
