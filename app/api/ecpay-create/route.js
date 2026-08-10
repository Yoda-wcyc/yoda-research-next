import { ecpayConfig, checkMacValue, makeTradeNo, tradeDate } from '../../../lib/ecpay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 建立綠界「信用卡定期定額」訂單 → 回傳一張自動送出的表單，瀏覽器導向綠界卡片頁。
// 前端用 <form method="POST" action="/api/ecpay-create"> 帶 email 打進來。
export async function POST(req) {
  const cfg = ecpayConfig();
  if (!cfg.MerchantID || !cfg.HashKey || !cfg.HashIV) {
    return new Response('ECPay 環境變數未設定（ECPAY_MERCHANT_ID / ECPAY_HASHKEY / ECPAY_HASHIV）', { status: 500 });
  }

  // 取 email：支援 form-post 與 JSON
  let email = '';
  const ctype = req.headers.get('content-type') || '';
  try {
    if (ctype.includes('application/json')) {
      const b = await req.json();
      email = (b.email || '').trim();
    } else {
      const f = await req.formData();
      email = String(f.get('email') || '').trim();
    }
  } catch (e) {}

  if (!email || !/.+@.+\..+/.test(email)) {
    return new Response('請提供有效的訂閱 email', { status: 400 });
  }

  const origin = new URL(req.url).origin;
  const returnURL = (process.env.ECPAY_RETURN_URL || origin + '/api/ecpay-notify').trim();
  const clientBack = (process.env.ECPAY_CLIENT_BACK_URL || 'https://yoda-wcyc.github.io/-/subscribe.html?paid=1').trim();

  const params = {
    MerchantID: cfg.MerchantID,
    MerchantTradeNo: makeTradeNo(),
    MerchantTradeDate: tradeDate(),
    PaymentType: 'aio',
    TotalAmount: 459,
    TradeDesc: 'Yoda Research 創始會員月費',
    ItemName: 'Yoda Research 創始會員(每月自動續扣)',
    ReturnURL: returnURL,
    ChoosePayment: 'Credit',
    ClientBackURL: clientBack,
    CustomField1: email, // 用來對應會員
    EncryptType: 1,
    // ── 信用卡定期定額 ──
    PeriodAmount: 459,
    PeriodType: 'M',   // 每月
    Frequency: 1,      // 每 1 個月
    ExecTimes: 99,     // 最多 99 期（到期或取消為止）
    PeriodReturnURL: returnURL, // 每期扣款結果也回拋
  };
  params.CheckMacValue = checkMacValue(params, cfg.HashKey, cfg.HashIV);

  const inputs = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/"/g, '&quot;')}">`)
    .join('');
  const html = `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><title>導向綠界付款…</title></head>
<body style="background:#0b0e14;color:#e8c877;font-family:sans-serif;text-align:center;padding-top:22vh">
<div style="font-size:18px">正在導向綠界安全付款頁…</div>
<form id="f" method="POST" action="${cfg.aioUrl}">${inputs}</form>
<script>document.getElementById('f').submit();</script>
</body></html>`;

  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
