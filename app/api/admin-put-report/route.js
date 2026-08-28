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
  let name = String(body.name || '').replace(/\.html?$/i, '').trim();
  const html = String(body.html || '');
  if (!name) return J({ ok: false, error: 'name（reportId）必填' });
  if (!html) return J({ ok: false, error: 'html 內容為空' });
  // ★付費檔的 reportId 一律以「付費_」開頭：少了前綴會在 Blob 產生一份「同一天的重複報告」，
  //   而寄送紀錄(NotifyLog)是按 reportId 記的 → 那份重複檔永遠顯示「未寄」，清單也會出現兩筆。
  //   2026-08-28 曾因某批次上傳用原始檔名，一口氣多出 17 份重複。這裡由伺服器統一補上，
  //   不管哪個上傳入口（主控台、腳本、手動 curl）都不會再犯。
  if (!/^付費[_-]/.test(name)) name = '付費_' + name;

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
