import { blobPath } from '../../../lib/blob';
import { J, preflight } from '../../../lib/cors';
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() { return preflight(); }

// 後台（斷點編輯器）上傳付費檔到 Vercel Blob（選項②·私有）。以 ADMIN_KEY 保護。
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}

  if (!process.env.ADMIN_KEY || body.key !== process.env.ADMIN_KEY) {
    return J({ ok: false, error: '管理密碼錯誤' }, 403);
  }
  const name = String(body.name || '').replace(/\.html?$/i, '').trim();
  const html = String(body.html || '');
  if (!name) return J({ ok: false, error: 'name（reportId）必填' });
  if (!html) return J({ ok: false, error: 'html 內容為空' });

  try {
    const res = await put(blobPath(name), html, {
      access: 'private',
      contentType: 'text/html; charset=utf-8',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return J({ ok: true, reportId: name, url: res.url });
  } catch (e) {
    return J({ ok: false, error: 'Blob 上傳失敗：' + String((e && e.message) || e) });
  }
}
