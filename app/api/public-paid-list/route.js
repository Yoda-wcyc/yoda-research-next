import { J, preflight, CORS } from '../../../lib/cors';
import { readIndex } from '../../../lib/report-index';

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
// 2026-09-06：改讀 reports/_index.json（簡單操作），不再每個訪客 list() 一次（進階操作，Hobby 每月只有 2,000 次，
// 曾因此整個 Blob 被停用一個月）。回應加 CDN 快取 5 分鐘，同一分鐘一千個訪客也只打一次 Blob。
async function handle() {
  let reports = [];
  try {
    const idx = await readIndex();
    for (const e of idx.entries) {
      const id = e.reportId;
      reports.push({ file: id + '.html', reportId: id, date: dateOf(id), cat: catOf(id), paid: true, drive: true, summary: '', uploadedAt: e.uploadedAt });
    }
    reports.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.reportId).localeCompare(String(a.reportId)));
  } catch (e) {}
  return Response.json({ ok: true, reports }, { status: 200,
    headers: { ...CORS, 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } });
}
export async function GET() { return handle(); }
export async function POST() { return handle(); }
