import { queryCreditCardPeriodInfo } from '../../../lib/ecpay';
import { J, preflight } from '../../../lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function OPTIONS() { return preflight(); }

// 查某張定期定額訂單在綠界那邊的真實狀態（唯讀·不會動到訂閱）。ADMIN_KEY 保護。
// body: { key, merchantTradeNo } → { ok, execStatus, stillActive, terminated, finished, totalSuccessTimes,
//                                    execLog[], totalSuccessAmount, card4no }
// 給 GAS 的「綠界狀態比對」用：抓出會員自己在綠界取消、但我們這邊還記成訂閱中的人。
// ★execLog＝綠界每一期扣款的逐期明細。只回總次數的話，一旦我們的 Payments 少記某一期，
//   只知道「對不上」卻不知道少的是哪一期、那期扣了多少、授權序號是什麼，沒辦法補帳。
//   欄名一律照綠界原樣（RtnCode/amount/gwsr/process_date/auth_code/TradeNo 大小寫不一致是綠界的事）。
// ★卡號只回末四碼 card4no，不回 card6no：前六碼＋末四碼合起來足以辨識卡片，屬於不必要的外流。
function pickExecLog(raw) {
  const arr = (raw && (raw.ExecLog || raw.execLog)) || [];
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => ({
    RtnCode: (x && x.RtnCode !== undefined) ? x.RtnCode : '',
    amount: (x && x.amount !== undefined) ? x.amount : '',
    gwsr: (x && x.gwsr !== undefined) ? x.gwsr : '',
    process_date: (x && x.process_date !== undefined) ? x.process_date : '',
    auth_code: (x && x.auth_code !== undefined) ? x.auth_code : '',
    TradeNo: (x && x.TradeNo !== undefined) ? x.TradeNo : '',
  }));
}

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
      execLog: pickExecLog(r.raw),
      totalSuccessAmount: Number((r.raw && r.raw.TotalSuccessAmount) || 0) || 0,
      card4no: String((r.raw && r.raw.card4no) || ''),
    });
  } catch (e) {
    return J({ ok: false, error: String((e && e.message) || e) });
  }
}
