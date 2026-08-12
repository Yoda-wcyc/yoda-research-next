import { sql } from '../../../lib/db';
import { J, preflight } from '../../../lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function OPTIONS() { return preflight(); }

function computeEarnedMonths(paidPeriods, referredPaidCount) {
  const P = Number(paidPeriods) || 0, R = Number(referredPaidCount) || 0; let best = 0;
  for (let N = 1; N <= 5; N++) { if (R >= N && P >= (2 * N + 1)) best = Math.max(best, N); }
  if (R >= 5 && P >= 12) best = 6;
  return best;
}
function fmtDate(v) { const s = String(v || ''); const m = s.match(/(\d{4}-\d{2}-\d{2})/); return m ? m[1] : ''; }

// 後台會員名單（讀 Neon·管理密碼保護）。取代 GAS adminData 的讀取，讓名單秒出。
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}
  if (!process.env.ADMIN_KEY || body.key !== process.env.ADMIN_KEY) return J({ ok: false, error: '管理密碼錯誤' }, 403);

  let members = [];
  try {
    const pays = await sql`SELECT DISTINCT lower(email) AS e FROM payments WHERE email <> ''`;
    const paidSet = new Set(pays.map((r) => r.e));
    const rows = await sql`SELECT * FROM members`;
    members = rows.map((m) => {
      const inPay = paidSet.has(String(m.email || '').toLowerCase());
      const active = String(m.status || '').trim() === 'active';
      const hasNext = String(m.next_charge_date || '').trim() !== '';
      const pp = Number(m.paid_periods) || 0, rpc = Number(m.referred_paid_count) || 0;
      return {
        member_id: m.member_id, pub_id: m.pub_id || '', email: m.email, ref_code: m.ref_code,
        referred_by: m.referred_by, status: m.status,
        in_payments: inPay, paid: active && (inPay || hasNext),
        plan: m.plan || '創始', fb_name: m.fb_name || '', start_date: fmtDate(m.start_date),
        paid_periods: m.paid_periods, referred_paid_count: m.referred_paid_count,
        earned_months: computeEarnedMonths(pp, rpc), granted: Number(m.earned_free_months) || 0,
        next_charge_date: fmtDate(m.next_charge_date),
        certs: { mw: fmtDate(m.cert_mw), tw: fmtDate(m.cert_tw), us: fmtDate(m.cert_us), key: fmtDate(m.cert_key), macro: fmtDate(m.cert_macro) },
      };
    });
  } catch (e) { return J({ ok: false, error: String((e && e.message) || e) }); }

  return J({ ok: true, members, opens: [] }); // opens(開啟紀錄)未鏡像→空;會員名單為主
}
