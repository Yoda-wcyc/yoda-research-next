import { creditCardPeriodAction } from '../../../lib/ecpay';
import { J, preflight } from '../../../lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function OPTIONS() { return preflight(); }

// 終止某會員的信用卡定期定額（停用後續扣款）。ADMIN_KEY 保護。
// body: { key, merchantTradeNo }。成功 RtnCode=1。
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}
  if (!process.env.ADMIN_KEY || body.key !== process.env.ADMIN_KEY) return J({ ok: false, error: '管理密碼錯誤' }, 403);
  const mtn = String(body.merchantTradeNo || '').trim();
  if (!mtn) return J({ ok: false, error: 'merchantTradeNo 必填' });
  try {
    const r = await creditCardPeriodAction(mtn, 'Cancel');
    const ok = Number(r.rtnCode) === 1;
    return J({ ok, env: r.env, rtnCode: r.rtnCode, rtnMsg: r.rtnMsg, merchantTradeNo: r.merchantTradeNo });
  } catch (e) {
    return J({ ok: false, error: String((e && e.message) || e) });
  }
}
