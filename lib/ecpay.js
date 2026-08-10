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
    MerchantID: process.env.ECPAY_MERCHANT_ID || '',
    HashKey: process.env.ECPAY_HASHKEY || '',
    HashIV: process.env.ECPAY_HASHIV || '',
    aioUrl: isProd
      ? 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5'
      : 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5',
  };
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
