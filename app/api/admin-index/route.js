import { J, preflight } from '../../../lib/cors';
import { rebuildIndex, readIndex, diffIndex } from '../../../lib/report-index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function OPTIONS() { return preflight(); }

// 報告索引維護（ADMIN_KEY）：POST {key, rebuild:true} 用 list() 重建 reports/_index.json；
// POST {key} 只回目前索引摘要。批量用別的方式上傳之後、或懷疑清單少了一筆時用。
// POST {key, dryRun:true}（2026-09-26）：用 list() 算出重建結果、跟目前索引比，只回差異，不寫回。
//   正式環境重建前先看會多出／少掉／改時間的是哪幾筆。同時帶 rebuild 也一樣只乾跑。
//   可選 tolerance_s（預設 5）：uploadedAt 差在幾秒內不列進 uploadedAt_changed。
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}
  if (!process.env.ADMIN_KEY || body.key !== process.env.ADMIN_KEY) return J({ ok: false, error: '管理密碼錯誤' }, 403);
  try {
    if (body.dryRun) {
      const tol = Number(body.tolerance_s);
      const d = await diffIndex({ toleranceSec: body.tolerance_s !== undefined && Number.isFinite(tol) && tol >= 0 ? tol : 5 });
      return J({ ok: true, dryRun: true, ...d });
    }
    const doc = body.rebuild ? await rebuildIndex() : await readIndex();
    return J({ ok: true, rebuilt: !!body.rebuild, builtAt: doc.builtAt, count: doc.count, sample: doc.entries.slice(0, 5).map((e) => e.reportId) });
  } catch (e) { return J({ ok: false, error: String((e && e.message) || e) }); }
}
