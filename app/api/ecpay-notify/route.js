import { ecpayConfig, checkMacValue } from '../../../lib/ecpay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 綠界付款結果背景通知（ServerPOST，application/x-www-form-urlencoded）
// 驗章 → 付款成功則通知 GAS 標記會員已付費 → 一定回純文字「1|OK」給綠界。
export async function POST(req) {
  const cfg = ecpayConfig();
  let params = {};
  try {
    const f = await req.formData();
    for (const [k, v] of f.entries()) params[k] = String(v);
  } catch (e) {
    return new Response('0|NoData', { headers: { 'content-type': 'text/plain' } });
  }

  const received = String(params.CheckMacValue || '').toUpperCase();
  const calc = checkMacValue(params, cfg.HashKey, cfg.HashIV);
  if (!received || received !== calc) {
    return new Response('0|CheckMacValue', { headers: { 'content-type': 'text/plain' } });
  }

  // RtnCode=1 才是付款/授權成功（定期定額首期與每期成功都會回 1）
  if (String(params.RtnCode) === '1' && process.env.GAS_URL) {
    try {
      await fetch(process.env.GAS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'markPaid',
          secret: process.env.GAS_SHARED_SECRET || '',
          email: params.CustomField1 || '',
          amount: params.TradeAmt || params.PeriodAmount || '',
          tradeNo: params.MerchantTradeNo || '',
          gwsr: params.Gwsr || '',
          payDate: params.PaymentDate || '',
        }),
      });
    } catch (e) {
      // 即使通知 GAS 失敗，仍回 1|OK 給綠界避免重試風暴；未入帳的可從綠界後台/Payments 對帳補。
    }
  }

  return new Response('1|OK', { headers: { 'content-type': 'text/plain' } });
}
