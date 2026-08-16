import crypto from 'crypto';

// 綠界設定：全部從環境變數讀，金鑰絕不寫進碼庫。
// Vercel 專案 → Settings → Environment Variables 設定：
//   ECPAY_MERCHANT_ID / ECPAY_HASHKEY / ECPAY_HASHIV
//   ECPAY_ENV = stage | production   （預設 stage 沙盒）
//   ECPAY_RETURN_URL（可省，預設用當前網域 /api/ecpay-notify）
//   ECPAY_CLIENT_BACK_URL（付款後導回頁）
//   GAS_URL（Apps Script /exec 網址）
//   GAS_SHARED_SECRET（與 Code.gs CONFIG.PAY_SECRET 相同）
export function ecpayConfig() {
  const env = (process.env.ECPAY_ENV || 'stage').toLowerCase();
  const isProd = env === 'production';
  return {
    env,
    MerchantID: (process.env.ECPAY_MERCHANT_ID || '').trim(),
    HashKey: (process.env.ECPAY_HASHKEY || '').trim(),
    HashIV: (process.env.ECPAY_HASHIV || '').trim(),
    aioUrl: isProd
      ? 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5'
      : 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5',
    periodActionUrl: isProd
      ? 'https://ecpayment.ecpay.com.tw/1.0.0/Cashier/CreditCardPeriodAction'
      : 'https://ecpayment-stage.ecpay.com.tw/1.0.0/Cashier/CreditCardPeriodAction',
  };
}

// ── 綠界新版加密 API（ecpayment.*/1.0.0）用 AES-128-CBC：key=HashKey, iv=HashIV, PKCS7 ──
// 實測(stage)加解密握手正確：encodeURIComponent → AES → base64；回應反向。
function aesEncrypt(plain, HashKey, HashIV) {
  const enc = encodeURIComponent(plain);
  const c = crypto.createCipheriv('aes-128-cbc', Buffer.from(HashKey), Buffer.from(HashIV));
  return Buffer.concat([c.update(enc, 'utf8'), c.final()]).toString('base64');
}
function aesDecrypt(b64, HashKey, HashIV) {
  const d = crypto.createDecipheriv('aes-128-cbc', Buffer.from(HashKey), Buffer.from(HashIV));
  const out = Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
  return decodeURIComponent(out.replace(/\+/g, ' '));
}

// 信用卡定期定額訂單作業：Action='Cancel'(停用後續扣款/終止訂閱) 或 'ReAuth'(補授權)
export async function creditCardPeriodAction(merchantTradeNo, action) {
  const cfg = ecpayConfig();
  if (!cfg.MerchantID || !cfg.HashKey || !cfg.HashIV) throw new Error('ECPay 環境變數未設定');
  const inner = { MerchantID: cfg.MerchantID, MerchantTradeNo: String(merchantTradeNo), Action: action };
  const body = { MerchantID: cfg.MerchantID, RqHeader: { Timestamp: Math.floor(Date.now() / 1000) }, Data: aesEncrypt(JSON.stringify(inner), cfg.HashKey, cfg.HashIV) };
  const r = await fetch(cfg.periodActionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  let data = {};
  try { if (j.Data) data = JSON.parse(aesDecrypt(j.Data, cfg.HashKey, cfg.HashIV)); } catch (e) {}
  return { env: cfg.env, httpStatus: r.status, rtnCode: data.RtnCode, rtnMsg: data.RtnMsg, merchantTradeNo: data.MerchantTradeNo, raw: data };
}

// 綠界 .NET HttpUtility.UrlEncode 相容編碼（供 CheckMacValue 用）
function ecpayUrlEncode(str) {
  return encodeURIComponent(str)
    .replace(/%20/g, '+')
    .replace(/%21/g, '!')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
    .replace(/%2A/g, '*')
    .replace(/%2D/g, '-')
    .replace(/%2E/g, '.')
    .replace(/%5F/g, '_');
}

// 計算 CheckMacValue：參數字典序 → 前後夾 HashKey/HashIV → URLencode → 轉小寫 → SHA256 → 轉大寫
export function checkMacValue(params, HashKey, HashIV) {
  const keys = Object.keys(params)
    .filter((k) => k !== 'CheckMacValue' && params[k] !== undefined && params[k] !== null)
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
  let raw = `HashKey=${HashKey}`;
  keys.forEach((k) => { raw += `&${k}=${params[k]}`; });
  raw += `&HashIV=${HashIV}`;
  const encoded = ecpayUrlEncode(raw).toLowerCase();
  return crypto.createHash('sha256').update(encoded, 'utf8').digest('hex').toUpperCase();
}

// 產生 ≤20 碼、只含英數的訂單編號
export function makeTradeNo() {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return ('YR' + t + r).slice(0, 20);
}

// 綠界要求的交易時間格式 yyyy/MM/dd HH:mm:ss
export function tradeDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
