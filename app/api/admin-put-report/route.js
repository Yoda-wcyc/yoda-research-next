import { blobPath } from '../../../lib/blob';
import { J, preflight } from '../../../lib/cors';
import { put } from '@vercel/blob';
import { gunzipSync } from 'zlib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() { return preflight(); }

// 後台（斷點編輯器）上傳付費檔到 Vercel Blob（選項②·私有）。以 ADMIN_KEY 保護。
//
// ★兩種 body 格式（2026-09-04 加上 gzip）：
//   ① application/json           → 舊格式，{key,name,html} 直接讀
//   ② x-yoda-encoding: gzip      → body 是「gzip 過的那份 JSON」，這裡解壓再 parse
//   為什麼要 gzip：Vercel 函式的請求上限 4.5MB，而美股分析已經 4.2~4.3MB，
//   包成 JSON（引號/反斜線/中文逃脫）就爆表 → Vercel 回純文字 "Request Entity Too Large"，
//   前端 res.json() 解析失敗噴「Unexpected token 'R'」。gzip 後約 1/10，餘裕很大。
export async function POST(req) {
  let body = {};
  try {
    if ((req.headers.get('x-yoda-encoding') || '').toLowerCase() === 'gzip') {
      const buf = Buffer.from(await req.arrayBuffer());
      body = JSON.parse(gunzipSync(buf).toString('utf8'));
    } else {
      body = await req.json();
    }
  } catch (e) {
    return J({ ok: false, error: '請求內容無法解析：' + String((e && e.message) || e) });
  }

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
  // ★「免費_」前綴（2026-08-30 免費殼通道）為唯一例外：免費檔走 /api/report 免驗票分支，
  //   必須刻意以 免費_ 命名才會建立，預設行為（自動補 付費_）不變。
  if (!/^(付費|免費)[_-]/.test(name)) name = '付費_' + name;

  try {
    const res = await put(blobPath(name), html, {
      access: 'private',
      contentType: 'text/html; charset=utf-8',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60, // 同路徑覆寫後，邊緣快取最多 60 秒就換新版（預設一個月，改版會卡舊檔）
    });
    return J({ ok: true, reportId: name, url: res.url });
  } catch (e) {
    return J({ ok: false, error: 'Blob 上傳失敗：' + String((e && e.message) || e) });
  }
}
