import { ecpayConfig, checkMacValue } from '../../../lib/ecpay';
import { upsertMember, logEcpayNotify, updateEcpayNotifyResult } from '../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 重試最多等 3+6+12=21 秒，預設 10 秒會被砍在半路（log 已先落地，但 attempts 會停在 0）
export const maxDuration = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRY_WAITS = [3000, 6000, 12000];   // 第 1/2/3 次重試前各等這麼久

// 綠界付款結果背景通知（ServerPOST，application/x-www-form-urlencoded）
// 驗章 → 一律先留痕 → 付款成功則通知 GAS 標記會員已付費（失敗自動重試）→ 一定回純文字「1|OK」給綠界。
//
// ★2026-09-10 的教訓：同一分鐘十幾筆回拋打進來，其中兩筆 GAS 沒寫成
//   （最可能是 withLock_ 的 waitLock(20s) 逾時），而這支端點既不看 GAS 回應、也沒有自己的紀錄，
//   照樣回 1|OK —— 結果那兩期在我們系統裡完全無痕，連「綠界通知過」都查不到。
//   現在：①不管成功失敗都先寫 ecpay_notify_log ②GAS 失敗/忙碌就重試 ③仍失敗就大聲 console.error。
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
    // 驗章不過＝來路不明，不寫進 log（免得任何人都能往我們的資料表塞東西）
    return new Response('0|CheckMacValue', { headers: { 'content-type': 'text/plain' } });
  }

  // email 拆兩段送：CustomField 單欄上限 50 字，超長 email 會被綠界截斷而對不到會員
  const email = ((params.CustomField1 || '') + (params.CustomField2 || '')).trim();
  // ★每期扣款的金額欄位叫 Amount（本次授權金額），不是 TradeAmt——
  //   只讀 TradeAmt 的話，續扣那幾筆會記成 0 元，累計入帳就會低報
  const amount = params.TradeAmt || params.Amount || params.PeriodAmount || '';
  const tradeNo = params.MerchantTradeNo || '';
  const gwsr = params.Gwsr || params.gwsr || '';   // 定期定額通知是小寫 gwsr
  const rtnCode = String(params.RtnCode || '');
  const isPaid = rtnCode === '1';                 // RtnCode=1 才是付款/授權成功（首期與每期成功都回 1）

  // raw 留整包，但拿掉 CheckMacValue（那是憑證，沒有保留價值）
  const raw = { ...params };
  delete raw.CheckMacValue;

  // ①先留痕。寫失敗不能影響主流程——留痕是為了查案，不是為了擋錢。
  let logId = null;
  try {
    logId = await logEcpayNotify({
      rtn_code: rtnCode,
      rtn_msg: params.RtnMsg || '',
      merchant_trade_no: tradeNo,
      gwsr,
      email,
      amount,
      total_success_times: params.TotalSuccessTimes || '',
      gas_ok: null,          // 還沒打 GAS；非付款成功的通知就永遠留 null
      gas_error: '',
      attempts: 0,
      raw,
    });
  } catch (e) {
    console.error('[ecpay-notify] 留痕寫入失敗', { tradeNo, gwsr, rtnCode, err: String((e && e.message) || e) });
  }

  const gasUrl = (process.env.GAS_URL || '').trim();
  if (isPaid && gasUrl) {
    // ②通知 GAS 入帳。失敗（ok!==true / busy / fetch 拋錯）就重試，最多 3 次。
    let attempts = 0, gasOk = false, gasError = '';
    for (let i = 0; i <= RETRY_WAITS.length; i++) {
      if (i > 0) await sleep(RETRY_WAITS[i - 1]);
      attempts++;
      try {
        const r = await fetch(gasUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'markPaid',
            secret: (process.env.GAS_SHARED_SECRET || '').trim(),
            email,
            amount,
            tradeNo,
            gwsr,
            payDate: params.PaymentDate || params.ProcessDate || '',
            // 首期＝1；續扣時綠界會帶累計成功次數，交給 GAS 判斷這是第幾期
            totalSuccessTimes: params.TotalSuccessTimes || '',
          }),
        });
        let j = null;
        try { j = await r.json(); } catch (e2) { j = null; }
        if (j && j.ok === true) { gasOk = true; gasError = ''; break; }
        // busy＝GAS 拿不到鎖（withLock_ 逾時），這種等一下重打就會成功，最值得重試
        gasError = (j && j.busy) ? ('busy: ' + String(j.error || '')) : String((j && j.error) || ('HTTP ' + r.status));
      } catch (e) {
        gasError = String((e && e.message) || e);
      }
    }

    if (!gasOk) {
      // ③仍失敗：大聲留下痕跡（log 那列的 gas_ok=false 也查得到），但照舊回 1|OK 給綠界
      //   避免重試風暴——這是既有決策；未入帳的靠 ecpay_notify_log ＋ adminBackfillPayment 補。
      console.error('[ecpay-notify] GAS markPaid 失敗', { logId, tradeNo, gwsr, email, amount, attempts, gasError });
    }
    try { await updateEcpayNotifyResult(logId, { gas_ok: gasOk, gas_error: gasError, attempts }); }
    catch (e) { console.error('[ecpay-notify] 留痕更新失敗', { logId, err: String((e && e.message) || e) }); }

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
