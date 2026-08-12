import { blobPath } from '../../../lib/blob';
import { J, preflight } from '../../../lib/cors';
import { del, list } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function OPTIONS() { return preflight(); }

// 刪除付費檔（從 Vercel Blob）。ADMIN_KEY 保護。
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}
  if (!process.env.ADMIN_KEY || body.key !== process.env.ADMIN_KEY) return J({ ok: false, error: '管理密碼錯誤' }, 403);
  const reportId = String(body.reportId || '').replace(/\.html?$/i, '').trim();
  if (!reportId) return J({ ok: false, error: 'reportId 必填' });
  try {
    const { blobs } = await list({ prefix: blobPath(reportId) });
    let n = 0;
    for (const b of (blobs || [])) { await del(b.url); n++; }
    return J({ ok: true, reportId, deleted: n });
  } catch (e) { return J({ ok: false, error: String((e && e.message) || e) }); }
}
