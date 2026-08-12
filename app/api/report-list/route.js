import { verifyJwt } from '../../../lib/jwt';
import { reportIdFromPath } from '../../../lib/blob';
import { list } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 會員「我的付費報告」清單：驗票 → 列 Blob 的 reports/ → 回 reportId 陣列（依日期降序）。
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}

  const payload = verifyJwt(body.token, process.env.JWT_SECRET || '');
  if (!payload) return Response.json({ ok: true, auth: false, error: '請重新登入' });

  let reports = [];
  try {
    const { blobs } = await list({ prefix: 'reports/' }); // 憑證由 SDK 自動偵測
    const seen = {};
    for (const b of (blobs || [])) {
      const id = reportIdFromPath(b.pathname);
      if (!id || seen[id]) continue;
      seen[id] = 1;
      reports.push({ reportId: id, uploadedAt: b.uploadedAt });
    }
    reports.sort((a, b) => {
      const da = (a.reportId.match(/(\d{8})/) || ['', '0'])[1];
      const db = (b.reportId.match(/(\d{8})/) || ['', '0'])[1];
      if (da !== db) return db.localeCompare(da);        // 報告日期降序
      return b.reportId.localeCompare(a.reportId);
    });
  } catch (e) {}

  return Response.json({ ok: true, auth: true, active: true, reports });
}
