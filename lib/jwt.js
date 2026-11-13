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

// 簽發 HS256 票（與 GAS signJwt_ 相容）。
export function signJwt(payload, secret) {
  const h = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const data = h + '.' + p;
  const sig = b64url(crypto.createHmac('sha256', secret).update(data).digest());
  return data + '.' + sig;
}

// 登入票有效期：預設 12 小時，但不超過「權益到期日當天結束」（與 GAS tokenExp_ 同規則）。
// active 但在寬限期內的人維持 12 小時——他們很可能只是綠界通知延遲，不該被擋。
// maxSec：/ta 長效票傳 30 天（lib/ta-live.js renewTa），其他呼叫端不傳＝12 小時不變；寬限期內一律 12 小時。
export function tokenExp(m, now, maxSec = 12 * 3600) {
  const full = now + maxSec;
  const mm = String((m && m.next_charge_date) || '').match(/\d{4}-\d{2}-\d{2}/);
  if (!mm) return full;
  const endTs = Math.floor(new Date(mm[0] + 'T23:59:59+08:00').getTime() / 1000);
  if (!endTs || Number.isNaN(endTs) || endTs <= now) return now + 12 * 3600;
  return Math.min(full, endTs);
}

// 帶 aud 的票（目前只有 /ta 長效票 aud:'ta'，最長 30 天）預設一律拒收：報告、報告清單等其他入口拿到它＝無效票。
// 白名單：票有 aud 時只有 aud === opts.allowAud（嚴格相等，'TA'／'ta '／['ta'] 都不算）才收；沒 aud 的票照舊。
// opts.graceSec：過期 graceSec 秒內仍收——只給 aud 等於 allowAud 的票，且只有 /api/ta-live 的 status 續票用（lib/ta-live.js authOf）。
export function verifyJwt(token, secret, opts) {
  if (!token || typeof token !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = parts[0] + '.' + parts[1];
  const expected = b64url(crypto.createHmac('sha256', secret).update(data).digest());
  const a = Buffer.from(expected), b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null; // 簽章不符
  let payload;
  try { payload = JSON.parse(b64urlToBuf(parts[1]).toString('utf8')); } catch (e) { return null; }
  if (!payload || typeof payload !== 'object') return null;
  const allow = opts && opts.allowAud;
  if ('aud' in payload && !(allow && payload.aud === allow)) return null; // TA 長效票不能開 TA 以外的東西
  const grace = 'aud' in payload && opts && opts.graceSec > 0 ? opts.graceSec : 0;
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp + grace) return null; // 過期
  return payload;
}
