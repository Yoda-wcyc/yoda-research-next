import { ecpayConfig, checkMacValue } from '../../../lib/ecpay';
import { upsertMember } from '../../../lib/db';

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
  const gasUrl = (process.env.GAS_URL || '').trim();
  if (String(params.RtnCode) === '1' && gasUrl) {
    try {
      await fetch(gasUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'markPaid',
          secret: (process.env.GAS_SHARED_SECRET || '').trim(),
          // email 拆兩段送：CustomField 單欄上限 50 字，超長 email 會被綠界截斷而對不到會員
          email: ((params.CustomField1 || '') + (params.CustomField2 || '')).trim(),
          // ★每期扣款的金額欄位叫 Amount（本次授權金額），不是 TradeAmt——
          //   只讀 TradeAmt 的話，續扣那幾筆會記成 0 元，累計入帳就會低報
          amount: params.TradeAmt || params.Amount || params.PeriodAmount || '',
          tradeNo: params.MerchantTradeNo || '',
          gwsr: params.Gwsr || params.gwsr || '',   // 定期定額通知是小寫 gwsr
          payDate: params.PaymentDate || params.ProcessDate || '',
          // 首期＝1；續扣時綠界會帶累計成功次數，交給 GAS 判斷這是第幾期
          totalSuccessTimes: params.TotalSuccessTimes || '',
        }),
      });
    } catch (e) {
      // 即使通知 GAS 失敗，仍回 1|OK 給綠界避免重試風暴；未入帳的可從綠界後台/Payments 對帳補。
    }
    // markPaid 完 → 從 GAS(正本)重抓該會員最新狀態 → 同步進 Neon（付費者立刻走快路徑·不自己算不分歧）
    try {
      const gr = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'exportMemberRow', secret: (process.env.GAS_SHARED_SECRET || '').trim(), email: params.CustomField1 || '' }),
      });
      const gj = await gr.json();
      if (gj && gj.ok && gj.member) await upsertMember(gj.member);
    } catch (e) { /* 同步失敗不影響回綠界；下次全量鏡像/登入 fallback 會補正 */ }
  }

  return new Response('1|OK', { headers: { 'content-type': 'text/plain' } });
}
