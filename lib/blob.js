import crypto from 'crypto';

// 報告在 Blob 的路徑 = reports/<encoded reportId>~<hmac16>.html
// 加一段用 JWT_SECRET 算的 HMAC → 路徑不可猜(外人沒密鑰算不出)、又是「確定性」(上傳/讀取都算得出同一路徑，免另存對照表)。
export function blobPath(reportId) {
  const id = String(reportId || '').replace(/\.html?$/i, '').trim();
  const h = crypto.createHmac('sha256', process.env.JWT_SECRET || '').update(id).digest('hex').slice(0, 16);
  return 'reports/' + encodeURIComponent(id) + '~' + h + '.html';
}

// 從 Blob pathname 反解回 reportId（給清單用）。
export function reportIdFromPath(pathname) {
  const m = String(pathname || '').match(/^reports\/(.+)~[0-9a-f]{16}\.html$/i);
  try { return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; }
}
