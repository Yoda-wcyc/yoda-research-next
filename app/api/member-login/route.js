import { memberByEmail, hashPw, isPaidActive, watermarkOf, tokenExp } from '../../../lib/auth';
import { signJwt } from '../../../lib/jwt';
import { J, preflight } from '../../../lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function OPTIONS() { return preflight(); }

const GAS = 'https://script.google.com/macros/s/AKfycbwQQ02EzseXtzvHxH3yegvgvQKncv7ReoGaqqsVxzco6cdagOCW13Tr7KlwX2UJtPc7/exec';

// Neon 沒命中/密碼不符時退回 GAS（新會員、剛改密碼、只憑密碼的舊流程都靠這條保底）
async function gasFallback(email, password) {
  try {
    const r = await fetch(GAS, { method: 'POST', body: JSON.stringify({ action: 'memberLogin', email, password }) });
    return await r.json();
  } catch (e) { return { ok: true, allow: false, error: '連線失敗，請再試一次' }; }
}

export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}
  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  if (!password) return J({ ok: true, allow: false, error: '請輸入密碼' });

  let m = null;
  try { m = await memberByEmail(email); } catch (e) { m = null; }

  if (m) {
    if (String(m.password_hash) !== hashPw(password)) {
      return J(await gasFallback(email, password)); // Neon 密碼不符 → 可能鏡像過舊 → GAS 確認
    }
    if (!isPaidActive(m)) return J(await gasFallback(email, password)); // Neon 顯示未付費→可能剛付款鏡像未更新→GAS 複查(正本)
    const wm = watermarkOf(m);
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt({ sub: m.pub_id || m.member_id, wm, iat: now, exp: tokenExp(m, now) }, process.env.JWT_SECRET || '');
    return J({ ok: true, allow: true, token, watermark: wm, memberId: m.pub_id || m.member_id, via: 'vercel' });
  }

  return J(await gasFallback(email, password)); // Neon 查無此 email → GAS 保底
}
