import { verifyJwt } from '../../../lib/jwt';
import { reportIdFromPath } from '../../../lib/blob';
import { J, preflight } from '../../../lib/cors';
import { list } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() { return preflight(); }

// 會員「我的付費報告」清單：驗票 → 列 Blob reports/ → reportId 陣列（日期降序）。
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}

  const payload = verifyJwt(body.token, process.env.JWT_SECRET || '');
  if (!payload) return J({ ok: true, auth: false, error: '請重新登入' });

  let reports = [];
  try {
    const { blobs } = await list({ prefix: 'reports/' });
    const seen = {};
    for (const b of (blobs || [])) {
      const id = reportIdFromPath(b.pathname);
      if (!id || seen[id]) continue;
      if (/^免費[_-]/.test(id)) continue; // 免費殼檔不進會員「我的付費報告」清單
      seen[id] = 1;
      reports.push({ reportId: id, uploadedAt: b.uploadedAt });
    }
    reports.sort((a, b) => {
      const da = (a.reportId.match(/(\d{8})/) || ['', '0'])[1];
      const db = (b.reportId.match(/(\d{8})/) || ['', '0'])[1];
      if (da !== db) return db.localeCompare(da);
      return b.reportId.localeCompare(a.reportId);
    });
  } catch (e) {}

  return J({ ok: true, auth: true, active: true, reports });
}
