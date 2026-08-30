import { reportIdFromPath } from '../../../lib/blob';
import { J, preflight } from '../../../lib/cors';
import { list } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() { return preflight(); }

function dateOf(id) { const m = String(id).match(/(\d{4})(\d{2})(\d{2})/); return m ? (m[1] + '-' + m[2] + '-' + m[3]) : ''; }
function catOf(id) {
  const s = String(id).replace(/^付費[_-]?/, '');
  if (/^市場觀察/.test(s)) return '市場觀察';
  if (/^美股/.test(s)) return '美股';
  if (/^台股/.test(s)) return '台股';
  if (/^關鍵報告|^關鍵/.test(s)) return '關鍵報告';
  if (/^簡報/.test(s)) return '簡報';
  if (/^總經|^總體經濟/.test(s)) return '總經';
  if (/AI泡沫|泡沫評估/.test(s)) return 'AI泡沫';
  if (/^專題/.test(s)) return '專題';
  if (/使用手冊/.test(s)) return '使用手冊';   // 缺這條時會落入下面的 fallback，被誤標成「關鍵報告」
  return '關鍵報告';
}

// 公開：付費報告清單（只回 檔名/日期/分類·不含內容·免登入）→ 給 archive「付費版」用。
async function handle() {
  let reports = [];
  try {
    const { blobs } = await list({ prefix: 'reports/' });
    const seen = {};
    for (const b of (blobs || [])) {
      const id = reportIdFromPath(b.pathname);
      if (!id || seen[id]) continue;
      seen[id] = 1;
      reports.push({ file: id + '.html', reportId: id, date: dateOf(id), cat: catOf(id), paid: true, drive: true, summary: '', uploadedAt: b.uploadedAt });
    }
    reports.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.reportId).localeCompare(String(a.reportId)));
  } catch (e) {}
  return J({ ok: true, reports });
}
export async function GET() { return handle(); }
export async function POST() { return handle(); }
