import { J, preflight } from '../../../lib/cors';
import { rebuildIndex, readIndex } from '../../../lib/report-index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function OPTIONS() { return preflight(); }

// 報告索引維護（ADMIN_KEY）：POST {key, rebuild:true} 用一次 list() 重建 reports/_index.json；
// POST {key} 只回目前索引摘要。批量用別的方式上傳之後、或懷疑清單少了一筆時用。
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}
  if (!process.env.ADMIN_KEY || body.key !== process.env.ADMIN_KEY) return J({ ok: false, error: '管理密碼錯誤' }, 403);
  try {
    const doc = body.rebuild ? await rebuildIndex() : await readIndex();
    return J({ ok: true, rebuilt: !!body.rebuild, builtAt: doc.builtAt, count: doc.count, sample: doc.entries.slice(0, 5).map((e) => e.reportId) });
  } catch (e) { return J({ ok: false, error: String((e && e.message) || e) }); }
}
