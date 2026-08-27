import { ecpayConfig, checkMacValue, makeTradeNo, tradeDate } from '../../../lib/ecpay';
import { priceOf } from '../../../lib/pricing';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 創始會員換新卡專用：用「創始價 459」幫指定會員的【新卡】建一筆綠界定期定額，
// 讓創始會員換卡時不會被現行 589 一般價套走。admin 簽章保護，外人拿不到 459。
//
//  產生客戶連結（你用）：GET ?email=X&key=<ADMIN_KEY>&link=1  → 回 { url }（客戶專屬·不含 key）
//  客戶付款（她點）    ：GET ?email=X&sig=<hmac>            → 導向綠界，用新卡刷 459
function sigFor(email) {
  const secret = process.env.JWT_SECRET || process.env.ECPAY_HASHKEY || '';
  return crypto.createHmac('sha256', secret)
    .update('founding-reswipe:' + String(email || '').trim().toLowerCase())
    .digest('hex').slice(0, 32);
}

export async function GET(req) {
  const u = new URL(req.url);
  const email = String(u.searchParams.get('email') || '').trim();
  const key = u.searchParams.get('key') || '';
  const sig = u.searchParams.get('sig') || '';
  const gen = u.searchParams.get('link');

  if (!email || !/.+@.+\..+/.test(email)) return new Response('缺有效 email', { status: 400 });

  // 產生模式：admin 換得客戶專屬簽章連結（連結本身不含 admin key，可安全轉發給客戶）
  if (gen) {
    if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
      return new Response(JSON.stringify({ ok: false, error: '管理密碼錯誤' }), { status: 403, headers: { 'content-type': 'application/json' } });
    }
    const url = u.origin + '/api/founding-reswipe?email=' + encodeURIComponent(email) + '&sig=' + sigFor(email);
    return new Response(JSON.stringify({ ok: true, email, price: priceOf('創始'), url }), { headers: { 'content-type': 'application/json' } });
  }

  // 客戶模式：驗簽（admin key 也放行，方便你自己測）
  const okAdmin = process.env.ADMIN_KEY && key === process.env.ADMIN_KEY;
  if (!okAdmin && sig !== sigFor(email)) return new Response('連結無效或已失效，請向客服索取新的換卡連結。', { status: 403 });

  const cfg = ecpayConfig();
  if (!cfg.MerchantID || !cfg.HashKey || !cfg.HashIV) return new Response('ECPay 環境變數未設定', { status: 500 });

  const PRICE = priceOf('創始'); // 459，鎖創始價
  if (!PRICE) return new Response('創始價未設定（lib/pricing 創始 monthly）', { status: 500 });

  const returnURL = (process.env.ECPAY_RETURN_URL || u.origin + '/api/ecpay-notify').trim();
  const clientBack = (process.env.ECPAY_CLIENT_BACK_URL || 'https://yoda-wcyc.github.io/-/subscribe.html?paid=1').trim();

  const params = {
    MerchantID: cfg.MerchantID,
    MerchantTradeNo: makeTradeNo(),
    MerchantTradeDate: tradeDate(),
    PaymentType: 'aio',
    TotalAmount: PRICE,
    TradeDesc: 'Yoda Research 創始會員換卡',
    ItemName: 'Yoda Research 創始會員(每月自動續扣)',
    ReturnURL: returnURL,
    ChoosePayment: 'Credit',
    ClientBackURL: clientBack,
    CustomField1: email.slice(0, 50),
    CustomField2: email.length > 50 ? email.slice(50, 100) : '',
    EncryptType: 1,
    // ── 信用卡定期定額（創始價 459）──
    PeriodAmount: PRICE,
    PeriodType: 'M',
    Frequency: 1,
    ExecTimes: 99,
    PeriodReturnURL: returnURL,
  };
  params.CheckMacValue = checkMacValue(params, cfg.HashKey, cfg.HashIV);

  const inputs = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/"/g, '&quot;')}">`)
    .join('');
  const html = `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><title>創始會員換卡 · 導向綠界…</title></head>
<body style="background:#0b0e14;color:#e8c877;font-family:sans-serif;text-align:center;padding-top:20vh">
<div style="font-size:18px">創始會員換卡 · 正在導向綠界安全付款頁…</div>
<div style="font-size:14px;color:#a1a1a6;margin-top:8px">月費維持 <b>NT$${PRICE}</b>（創始價）· 請用你的新卡完成綁定</div>
<form id="f" method="POST" action="${cfg.aioUrl}">${inputs}</form>
<script>document.getElementById('f').submit();</script>
</body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
