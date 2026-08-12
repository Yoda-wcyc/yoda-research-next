import crypto from 'crypto';

// 報告在 Blob 的路徑 = reports/<reportId>~<hmac16>.html
// HMAC(用 JWT_SECRET) → 路徑不可猜(外人沒密鑰算不出)、又確定性(上傳/讀取算得出同一路徑，免對照表)。
// ★不 encodeURIComponent：Vercel Blob 支援 unicode 路徑；先前編碼會被 Vercel 再編一次(雙重編碼) → get 對不上。
export function blobPath(reportId) {
  const id = String(reportId || '').replace(/\.html?$/i, '').trim();
  const h = crypto.createHmac('sha256', process.env.JWT_SECRET || '').update(id).digest('hex').slice(0, 16);
  return 'reports/' + id + '~' + h + '.html';
}

// 從 Blob pathname 反解回 reportId（給清單用）。
export function reportIdFromPath(pathname) {
  const m = String(pathname || '').match(/^reports\/(.+)~[0-9a-f]{16}\.html$/i);
  return m ? m[1] : null;
}
