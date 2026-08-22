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

// ====== 內部帳號（站方自己的）：永久權益，但不算付費會員 ======
// 與 GAS 的 INTERNAL_PLAN 一致。
export const INTERNAL_PLAN = '內部';
export function isInternal(m) {
  return String((m && m.plan) || '').trim() === INTERNAL_PLAN;
}

// ====== 綠界留痕：付費的唯一憑據 ======
// 一次撈出鏡像裡所有付款過的 email。
// ★同時回報「這份鏡像可不可信」：members 有人、payments 卻一筆都沒有 →
//   那是鏡像壞了或還沒跑，不是「大家都沒付錢」。這種時候必須放行，
//   否則會把全部付費會員關在門外（2026-08-22 在 GAS 端就是這樣出事的）。
let _payCache = null, _payCacheAt = 0;
const PAY_CACHE_MS = 60_000;
export async function paidEmailScan() {
  const now = Date.now();
  if (_payCache && (now - _payCacheAt) < PAY_CACHE_MS) return _payCache;
  let set = new Set(), rows = 0, members = 0;
  try {
    const r = await sql`SELECT lower(email) AS e FROM payments WHERE email <> ''`;
    rows = r.length;
    for (const x of r) if (x.e) set.add(x.e);
    members = (await sql`SELECT count(*)::int AS n FROM members`)[0].n;
  } catch (e) {
    return { set: new Set(), trusted: false, rows: 0 };   // 查不到 → 放行
  }
  const out = { set, trusted: !(members > 0 && set.size === 0), rows };
  _payCache = out; _payCacheAt = now;
  return out;
}

// ====== 真正的付費門：狀態 + 到期日 + 綠界留痕 ======
// ★Vercel 這邊自己判 true 就會發 token，所以這道門一定要跟 GAS 的 isPaidMember_ 同一把尺；
//   只判 isPaidActive（狀態＋到期日）等於讓沒付過錢的人從這裡繞過去。
export async function isPaidMember(m) {
  if (!m) return false;
  if (isInternal(m)) return true;
  if (!isPaidActive(m)) return false;
  const em = String((m && m.email) || '').trim().toLowerCase();
  if (!em) return true;
  const scan = await paidEmailScan();
  if (!scan.trusted) return true;   // 鏡像不可信 → 放行，不誤鎖
  return scan.set.has(em);
}

export function watermarkOf(m) {
  return (m.pub_id || m.member_id) + ' · ' + maskEmail(m.email);
}

// 登入票有效期：預設 12 小時，但不超過「權益到期日當天結束」（與 GAS tokenExp_ 同規則）。
// active 但在寬限期內的人維持 12 小時——他們很可能只是綠界通知延遲，不該被擋。
export function tokenExp(m, now) {
  const full = now + 12 * 3600;
  const mm = String((m && m.next_charge_date) || '').match(/\d{4}-\d{2}-\d{2}/);
  if (!mm) return full;
  const endTs = Math.floor(new Date(mm[0] + 'T23:59:59+08:00').getTime() / 1000);
  if (!endTs || Number.isNaN(endTs) || endTs <= now) return full;
  return Math.min(full, endTs);
}
