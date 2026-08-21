import { queryCreditCardPeriodInfo } from '../../../lib/ecpay';
import { J, preflight } from '../../../lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function OPTIONS() { return preflight(); }

// 查某張定期定額訂單在綠界那邊的真實狀態（唯讀·不會動到訂閱）。ADMIN_KEY 保護。
// body: { key, merchantTradeNo } → { ok, execStatus, stillActive, terminated, finished, totalSuccessTimes }
// 給 GAS 的「綠界狀態比對」用：抓出會員自己在綠界取消、但我們這邊還記成訂閱中的人。
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}
  if (!process.env.ADMIN_KEY || body.key !== process.env.ADMIN_KEY) return J({ ok: false, error: '管理密碼錯誤' }, 403);
  const mtn = String(body.merchantTradeNo || '').trim();
  if (!mtn) return J({ ok: false, error: 'merchantTradeNo 必填' });
  try {
    const r = await queryCreditCardPeriodInfo(mtn);
    const ok = Number(r.rtnCode) === 1;
    return J({
      ok, env: r.env, rtnCode: r.rtnCode, execStatus: r.execStatus,
      stillActive: r.stillActive, terminated: r.terminated, finished: r.finished,
      totalSuccessTimes: r.totalSuccessTimes, periodAmount: r.periodAmount,
      merchantTradeNo: r.merchantTradeNo,
    });
  } catch (e) {
    return J({ ok: false, error: String((e && e.message) || e) });
  }
}
