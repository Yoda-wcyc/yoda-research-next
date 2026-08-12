import crypto from 'crypto';
import { sql } from './db';

// 與 GAS hash() 完全一致：SHA-256( SALT + "|" + 密碼 ) 轉小寫 hex。
export function hashPw(password) {
  return crypto.createHash('sha256').update((process.env.SALT || '') + '|' + String(password), 'utf8').digest('hex');
}

// 與 GAS maskEmail() 一致：前2字 + ***@ + 網域
export function maskEmail(e) {
  const p = String(e || '').split('@');
  return (p[0] || '').slice(0, 2) + '***@' + (p[1] || '');
}

// 從 Neon 依 email 找會員（不分大小寫）
export async function memberByEmail(email) {
  const lc = String(email || '').trim().toLowerCase();
  if (!lc) return null;
  const rows = await sql`SELECT * FROM members WHERE lower(email) = ${lc} LIMIT 1`;
  return rows[0] || null;
}

// 真付費：status=active 且有 next_charge_date（與 GAS isPaidActive 同準則）
export function isPaidActive(m) {
  return !!m && String(m.status || '').trim() === 'active' && String(m.next_charge_date || '').trim() !== '';
}

export function watermarkOf(m) {
  return (m.pub_id || m.member_id) + ' · ' + maskEmail(m.email);
}
