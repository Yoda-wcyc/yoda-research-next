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

// 與 GAS 的 ACTIVE_GRACE_DAYS 保持一致：active 但扣款日已過的寬限天數
export const ACTIVE_GRACE_DAYS = 3;

// 台北時區的今天（yyyy-MM-dd）。Vercel 跑 UTC，直接用本地日期會在深夜差一天。
function todayTaipei() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
// 取出 yyyy-MM-dd（Neon 的 next_charge_date 可能是 "2026-09-16" 或 "2026-09-16 00:00:00"）
function ymd(v) {
  const m = String(v || '').match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : '';
}
function shiftDays(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 真付費（與 GAS isPaidActive 同準則·必須同步修改）：
//   active    → 有到期日，且尚未逾期超過寬限（逾期太久＝綠界端自行取消/扣款失敗沒對帳）
//   cancelled → 有到期日，且還沒過期（權益用到期末，不給寬限）
// 這裡判 false 不代表擋人：呼叫端一律 fallback 回 GAS 正本複查，鏡像過舊也不會誤鎖。
export function isPaidActive(m) {
  if (!m) return false;
  const st = String(m.status || '').trim(), nc = ymd(m.next_charge_date);
  if (!nc) return false;
  const today = todayTaipei();
  if (st === 'active') return nc >= shiftDays(today, -ACTIVE_GRACE_DAYS);
  if (st === 'cancelled') return nc >= today;
  return false;
}

export function watermarkOf(m) {
  return (m.pub_id || m.member_id) + ' · ' + maskEmail(m.email);
}
