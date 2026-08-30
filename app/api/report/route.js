import { verifyJwt } from '../../../lib/jwt';
import { blobPath } from '../../../lib/blob';
import { CORS, J, preflight } from '../../../lib/cors';
import { get } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() { return preflight(); }

// 會員開付費報告（快路徑）：驗票(HMAC·<1ms) → 私有 Blob 直讀 → 烤逐人浮水印 → 回 JSON。
// 免費通道（2026-08-30）：reportId 以「免費_」開頭的檔不驗票——內容仍放私有 Blob、
// 由 hub 上的免費殼載入，公開 repo 不再存整份正文（撤下＝刪 Blob 一個檔，連結全死）。
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}

  const reportId = String(body.reportId || '').replace(/\.html?$/i, '').trim();
  if (!reportId) return J({ ok: false, error: '缺 reportId' });
  const isFree = /^免費[_-]/.test(reportId);

  let payload = null;
  if (!isFree) {
    payload = verifyJwt(body.token, process.env.JWT_SECRET || '');
    if (!payload) return J({ ok: true, allow: false, reason: 'need-login', error: '請重新登入' });
  }

  let html;
  try {
    const result = await get(blobPath(reportId), { access: 'private' });
    if (result === null) return J({ ok: true, allow: true, error: '找不到這份報告：' + reportId });
    html = await new Response(result.stream).text();
  } catch (e) {
    return J({ ok: true, allow: true, error: '讀取報告失敗：' + String((e && e.message) || e) });
  }

  // 免費浮水印帶報告製作日期（取 reportId 裡的 8 碼日期＝檔名期別）
  const d8 = (reportId.match(/(\d{8})/) || [])[1];
  const dateTag = d8 ? ' · ' + d8.slice(0, 4) + '-' + d8.slice(4, 6) + '-' + d8.slice(6, 8) : '';
  const wm = isFree ? '免費版 · Yoda Research' + dateTag : ((payload && payload.wm) || '會員專屬');
  html = html.split('{{WATERMARK}}').join(wm); // 逐人浮水印（免費檔＝通用戳記）
  return J({ ok: true, allow: true, html, watermark: wm, memberId: (payload && payload.sub) || '' });
}
