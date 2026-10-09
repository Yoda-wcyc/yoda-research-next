import { ecpayConfig, checkMacValue, makeTradeNo, tradeDate } from '../../../lib/ecpay';
import { priceOf } from '../../../lib/pricing';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 創始會員換新卡專用：用「創始價 459」幫指定會員的【新卡】建一筆綠界定期定額，
// 讓創始會員換卡時不會被現行 589 一般價套走。admin 簽章保護，外人拿不到 459。
//
//  產生客戶連結（你用）：GET ?email=X&key=<ADMIN_KEY>&link=1  → 回 { url }（客戶專屬·不含 key，預設 7 天到期）
//  客戶付款（她點）    ：GET ?email=X&exp=YYYYMMDD&sig=<hmac> → 導向綠界，用新卡刷 459
//
// 這條路是「創始價的唯一活口」，所以三道門都必須 fail closed：
//   ① 密鑰：JWT_SECRET／ECPAY_HASHKEY 都沒值就 500，絕不退回空字串當密鑰
//   ② 連結：簽章綁到期日，過期一律 403
//   ③ 會員：退訂過（ex_founding 非空）或不是 active 一律 403；查不到／查不動一律 503
//
// ★②③ 兩道門「產生連結」與「客戶點擊」兩個模式都要過。產生時先擋，才不會把一條
//   注定被擋的連結交到客戶手上（2026-10-09 補）。

// ★密鑰缺失不可以退回空字串。空字串是公開可知的，任何人都能自算任一 email 的簽章，
//   等於創始價 459 對全世界開放 —— 寧可整支 500 停擺，也不能用空密鑰放行。
function signSecret() {
  return String(process.env.JWT_SECRET || process.env.ECPAY_HASHKEY || '').trim();
}

// ★簽章一定要綁到期日。只簽 email 的舊版等於「一次發出、永久有效、可無限重複點」：
//   2026-08 發出的連結到今天還刷得過，那是創始價的長期後門。
function sigFor(email, exp, secret) {
  return crypto.createHmac('sha256', secret)
    .update('founding-reswipe:' + String(email || '').trim().toLowerCase() + ':' + String(exp || ''))
    .digest('hex').slice(0, 32);
}

// 到期日一律用【台北時區】的日期（YYYYMMDD）比，不用伺服器時區——Vercel 跑 UTC，
// 用 UTC 會讓台灣的凌晨 0~8 點算成前一天，連結會早一天失效。
function ymdTaipei(offsetDays) {
  const t = Date.now() + 8 * 3600 * 1000 + (Number(offsetDays) || 0) * 86400 * 1000;
  return new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
}
const LINK_VALID_DAYS = 7;

// 唯讀問 GAS（會員名冊正本）拿 status 與 ex_founding。GAS 端的 action 是 memberGateInfo，
// 只回 { ok, email, status, ex_founding, plan }，不回密碼雜湊也不回 pub_id、不做任何寫入。
//
// ★fail closed：超時、非 200、JSON 壞掉、ok!==true、欄位形狀不對、查不到這個 email ——
//   一律回 { ok:false } 讓呼叫端擋下來。「查不到就放行」是絕對不可以的：
//   放行的代價是退訂者拿回創始價，而且帳面上完全看不出來。
async function memberGate(email) {
  const gasUrl = (process.env.GAS_URL || '').trim();
  const gasSecret = (process.env.GAS_SHARED_SECRET || '').trim();
  if (!gasUrl || !gasSecret) return { ok: false, error: 'GAS_URL／GAS_SHARED_SECRET 未設定' };
  try {
    const r = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'memberGateInfo', secret: gasSecret, email }),
      signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(15000) : undefined,
    });
    if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
    let j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    if (!j || j.ok !== true || typeof j.status !== 'string' || typeof j.ex_founding !== 'string') {
      return { ok: false, error: '回傳不合預期' };
    }
    return { ok: true, status: j.status, ex_founding: j.ex_founding, plan: String(j.plan || '') };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// 產生模式一律回 JSON（主控台／curl 都在讀 .error），所以錯誤也要是 JSON，
// 訊息要直接寫清楚「為什麼不產生」，Yoda 才不用再去翻名冊對照。
function genErr(error, status) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status, headers: { 'content-type': 'application/json' },
  });
}

export async function GET(req) {
  const u = new URL(req.url);
  const email = String(u.searchParams.get('email') || '').trim();
  const key = u.searchParams.get('key') || '';
  const sig = u.searchParams.get('sig') || '';
  const exp = String(u.searchParams.get('exp') || '').trim();
  const gen = u.searchParams.get('link');

  if (!email || !/.+@.+\..+/.test(email)) return new Response('缺有效 email', { status: 400 });

  // ①密鑰門：兩個環境變數都沒值就停擺，不用空字串當密鑰（見 signSecret 的註解）
  const secret = signSecret();
  if (!secret) return new Response('伺服器未設定簽章密鑰', { status: 500 });

  // 產生模式：admin 換得客戶專屬簽章連結（連結本身不含 admin key，可安全轉發給客戶）
  if (gen) {
    if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
      return new Response(JSON.stringify({ ok: false, error: '管理密碼錯誤' }), { status: 403, headers: { 'content-type': 'application/json' } });
    }

    // ★產生連結前也要過同一道會員門（③）。舊版只在客戶點擊時才擋，等於把一條
    //   「注定被擋」的連結交到客戶手上：Yoda 以為已經發出去了，客戶點了卻吃 403，
    //   兩邊都要再來回一次客服。擋在產生這一刻，錯誤訊息才會進到 Yoda 眼裡。
    //   fail closed 的理由跟客戶模式一樣：查不到／查不動都不產生連結。
    const g = await memberGate(email);
    if (!g.ok) {
      return genErr('會員資料查詢失敗（' + g.error + '），不產生連結。請稍後再試。', 503);
    }
    if (String(g.ex_founding || '').trim() !== '') {
      return genErr('此帳號已退訂過（ex_founding=' + String(g.ex_founding).trim()
        + '），創始價已不適用，不產生連結。', 403);
    }
    if (String(g.status || '').trim() !== 'active') {
      // 名冊查無此人時 memberGateInfo 回全空 → 這裡顯示「（空白）」比顯示 status= 好懂
      return genErr('此帳號目前不是訂閱中狀態（status='
        + (String(g.status || '').trim() || '（空白）') + '），不產生連結。', 403);
    }

    const newExp = ymdTaipei(LINK_VALID_DAYS);
    const url = u.origin + '/api/founding-reswipe?email=' + encodeURIComponent(email)
      + '&exp=' + newExp + '&sig=' + sigFor(email, newExp, secret);
    return new Response(JSON.stringify({ ok: true, email, price: priceOf('創始'), exp: newExp, validDays: LINK_VALID_DAYS, url }), { headers: { 'content-type': 'application/json' } });
  }

  // 客戶模式：驗簽（admin key 也放行，方便你自己測）
  const okAdmin = process.env.ADMIN_KEY && key === process.env.ADMIN_KEY;
  if (!okAdmin) {
    // ②連結門：先看到期日。沒帶 exp 的舊連結（2026-08 那批）也會落在這裡 —— 那正是目的。
    if (!/^\d{8}$/.test(exp) || exp < ymdTaipei(0)) {
      return new Response('連結已過期，請向我索取新連結。', { status: 403 });
    }
    if (sig !== sigFor(email, exp, secret)) {
      return new Response('連結無效或已失效，請向客服索取新的換卡連結。', { status: 403 });
    }
  }

  // ③會員門：退訂過的人永久排除創始價；不是訂閱中的人也不該走換卡補刷。
  //   這兩件事只有會員名冊（GAS）知道，連結本身看不出來——所以一定要回頭問一次。
  const gate = await memberGate(email);
  if (!gate.ok) return new Response('會員資料查詢失敗，請稍後再試。', { status: 503 });
  if (String(gate.ex_founding || '').trim() !== '') {
    return new Response('此帳號已退訂過，創始價已不適用。請改走一般訂閱。', { status: 403 });
  }
  if (String(gate.status || '').trim() !== 'active') {
    return new Response('此帳號目前不是訂閱中狀態，無法使用換卡補刷連結。', { status: 403 });
  }

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
