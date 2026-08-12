import { memberByEmail, hashPw, isPaidActive, watermarkOf } from '../../../lib/auth';
import { sql } from '../../../lib/db';
import { signJwt } from '../../../lib/jwt';
import { J, preflight } from '../../../lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function OPTIONS() { return preflight(); }

const GAS = 'https://script.google.com/macros/s/AKfycbwQQ02EzseXtzvHxH3yegvgvQKncv7ReoGaqqsVxzco6cdagOCW13Tr7KlwX2UJtPc7/exec';

function computeEarnedMonths(paidPeriods, referredPaidCount) {
  const P = Number(paidPeriods) || 0, R = Number(referredPaidCount) || 0; let best = 0;
  for (let N = 1; N <= 5; N++) { if (R >= N && P >= (2 * N + 1)) best = Math.max(best, N); }
  if (R >= 5 && P >= 12) best = 6;
  return best;
}
function nextLadderStep(P, R) {
  const cur = computeEarnedMonths(P, R);
  if (cur >= 6) return null;
  const target = cur + 1; let needR, needP;
  if (target <= 5) { needR = target; needP = 2 * target + 1; } else { needR = 5; needP = 12; }
  return { rewardMonths: target, needReferrals: needR, needPeriods: needP, moreReferrals: Math.max(0, needR - R), morePeriods: Math.max(0, needP - P) };
}
function fmtDate(v) { const s = String(v || ''); const m = s.match(/(\d{4}-\d{2}-\d{2})/); return m ? m[1] : s; }
function isTrue(v) { return /^(true|1|yes|on)$/i.test(String(v || '').trim()); }

async function gasFallback(email, password) {
  try { const r = await fetch(GAS, { method: 'POST', body: JSON.stringify({ action: 'memberDashboard', email, password }) }); return await r.json(); }
  catch (e) { return { ok: true, auth: false, error: '連線失敗，請再試一次' }; }
}

export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}
  const email = String(body.email || '').trim(), password = String(body.password || '');
  if (!email || !password) return J({ ok: true, auth: false, error: 'email 與密碼必填' });

  let m = null;
  try { m = await memberByEmail(email); } catch (e) { m = null; }
  if (!m) return J(await gasFallback(email, password));
  if (String(m.password_hash) !== hashPw(password)) return J(await gasFallback(email, password));

  let referredTotal = 0, referredPaid = 0;
  if (m.ref_code) {
    try {
      const rows = await sql`SELECT status, paid_periods FROM members WHERE referred_by = ${m.ref_code}`;
      referredTotal = rows.length;
      for (const r of rows) { if (String(r.status) === 'active' && (Number(r.paid_periods) || 0) >= 1) referredPaid++; }
    } catch (e) {}
  }
  const paidPeriods = Number(m.paid_periods) || 0;
  const certified = ['flag', 'mw', 'tw', 'us', 'key', 'macro'].filter((t) => String(m['cert_' + t] || '').trim() !== '');
  let token = '';
  if (isPaidActive(m)) {
    const wm = watermarkOf(m), now = Math.floor(Date.now() / 1000);
    token = signJwt({ sub: m.pub_id || m.member_id, wm, iat: now, exp: now + 12 * 3600 }, process.env.JWT_SECRET || '');
  }
  return J({
    ok: true, auth: true, token,
    memberId: m.pub_id || m.member_id, email: m.email, status: m.status,
    startDate: fmtDate(m.start_date), paidPeriods, nextChargeDate: fmtDate(m.next_charge_date),
    refCode: m.ref_code, shareLink: 'https://yoda-wcyc.github.io/-/subscribe.html?ref=' + m.ref_code,
    referredTotal, referredPaid,
    earnedMonths: computeEarnedMonths(paidPeriods, referredPaid),
    grantedMonths: Number(m.earned_free_months) || 0,
    nextStep: nextLadderStep(paidPeriods, referredPaid),
    certified, notifyOff: isTrue(m.notify_off), via: 'vercel',
  });
}
