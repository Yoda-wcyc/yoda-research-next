import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;   // GAS 可能冷啟動＋等鎖 20 秒，預設 10 秒不夠

// Resend 投遞異常 webhook：驗 Svix 簽章 → 轉給 GAS 寫進 MailEvents 分頁。
// 要驗章才放這層：GAS 的 doPost 讀不到 request header。
// 驗章規格 https://docs.svix.com/receiving/verifying-payloads/how-manual
const RECORDED = new Set(['email.bounced', 'email.complained', 'email.failed', 'email.suppressed', 'email.delivery_delayed']);
const TOLERANCE_SEC = 300;

const text = (body, status) => new Response(body, { status, headers: { 'content-type': 'text/plain' } });

function validSignature(secret, id, ts, rawBody, header) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const want = crypto.createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`, 'utf8').digest();
  // 標頭可能同時帶多組（換金鑰期間）：空白分隔的 "v1,<base64>"，任一組對就算過
  return header.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  });
}

// 退信原因在 data.bounce、失敗在 data.failed、抑制在 data.suppressed；客訴與延遲官方 payload 沒有原因欄
function reasonOf(data) {
  const r = data.bounce || data.failed || data.suppressed || {};
  return [r.type, r.subType, r.reason, r.message, ...[].concat(r.diagnosticCode || [])].filter(Boolean).join(' | ');
}

export async function POST(req) {
  const secret = (process.env.RESEND_WEBHOOK_SECRET || '').trim();
  if (!secret) return text('webhook secret not configured', 503);

  const rawBody = await req.text();   // ★簽章是對原始字串算的，不可先 parse 再 stringify
  const id = req.headers.get('svix-id');
  const ts = req.headers.get('svix-timestamp');
  const sig = req.headers.get('svix-signature');
  if (!id || !ts || !sig || !/^\d+$/.test(ts)) return text('invalid signature', 401);
  if (Math.abs(Date.now() / 1000 - Number(ts)) > TOLERANCE_SEC) return text('invalid signature', 401);
  if (!validSignature(secret, id, ts, rawBody, sig)) return text('invalid signature', 401);

  let event;
  try { event = JSON.parse(rawBody); } catch (e) { return text('bad json', 400); }
  if (!RECORDED.has(event && event.type)) return text('ignored', 200);

  const gasUrl = (process.env.GAS_URL || '').trim();
  if (!gasUrl) return text('GAS_URL not configured', 503);   // 回 5xx 讓 Resend 之後重送，事件才不會掉

  const data = event.data || {};
  let error = '';
  try {
    const r = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'recordMailEvent',
        secret: (process.env.GAS_SHARED_SECRET || '').trim(),
        svixId: id,
        eventType: event.type,
        occurredAt: event.created_at || '',
        to: data.to || [],
        subject: data.subject || '',
        reason: reasonOf(data),
        emailId: data.email_id || '',
      }),
    });
    const j = await r.json();
    if (j && j.ok === true) return text('ok', 200);
    error = (j && j.error) || `HTTP ${r.status}`;
  } catch (e) {
    error = String((e && e.message) || e);
  }
  console.error('[resend-webhook] GAS 寫入失敗，交由 Resend 重送', { svixId: id, type: event.type, error });
  return text('forward failed', 502);
}
