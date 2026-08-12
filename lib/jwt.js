import crypto from 'crypto';

// 驗證 GAS 用 HS256 簽發的會員登入票。回傳 payload（有效）或 null（無效/過期）。
function b64urlToBuf(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function verifyJwt(token, secret) {
  if (!token || typeof token !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = parts[0] + '.' + parts[1];
  const expected = b64url(crypto.createHmac('sha256', secret).update(data).digest());
  const a = Buffer.from(expected), b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null; // 簽章不符
  let payload;
  try { payload = JSON.parse(b64urlToBuf(parts[1]).toString('utf8')); } catch (e) { return null; }
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null; // 過期
  return payload;
}
