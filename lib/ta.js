import crypto from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';
import { get, put, head } from '@vercel/blob';
import { sql } from './db';
import { signJwt, verifyJwt } from './jwt';

// ====== 會員技術分析（少數指定付費會員·2026-09-27）======
//
// 資料流：
//   本機 ta_publish.py → POST /api/admin-put-ta（分片先傳、summary 最後傳）→ 私有 Blob ta/<rid>~<hmac16>/*.json.gz
//   會員開報告 /api/report → 名單內＋summary 在 → 注入 ta-pick.js（帶 TA 通行票）→ 勾選開 /ta → /api/ta-data 讀資料
//
// 名單：獨立的 ta_access 表（不是 members 的欄位——db-mirror 每次都 TRUNCATE members，新欄位會被洗掉）。
// 名單判斷用 member_id 或 pub_id 比對 JWT 的 sub，不 JOIN members（GAS 保底登入的人可能暫時不在 Neon）。

// 只有付費的美股／台股分析才有 TA 資料
export const TA_RID_RE = /^付費_(美股|台股)分析_(\d{8})[^/~]*$/;
export function taMarket(rid) {
  const m = TA_RID_RE.exec(String(rid || ''));
  return m ? (m[1] === '美股' ? 'us' : 'tw') : null;
}
export function taReportDate(rid) {
  const m = TA_RID_RE.exec(String(rid || ''));
  return m ? m[2] : '';
}

// TA 通行票：用 JWT_SECRET 衍生的鑰匙簽 → 拿去 /api/report 驗不過（票外流也開不了報告），不用新增環境變數。
// 有效期 24 小時，但不超過發票當下那張登入票的 exp（登入票本身不超過權益到期日）→ 票不會比會員權益活得久。
const TA_TTL = 24 * 3600;
function taKey() {
  return crypto.createHmac('sha256', process.env.JWT_SECRET || '').update('ta-ticket-v1').digest('hex');
}
export function signTaTicket({ sub, wm, loginExp }) {
  const now = Math.floor(Date.now() / 1000);
  let exp = now + TA_TTL;
  if (Number(loginExp) > now) exp = Math.min(exp, Number(loginExp));
  return signJwt({ sub, wm: wm || '', aud: 'ta', iat: now, exp }, taKey());
}
export function verifyTaTicket(k) {
  if (!process.env.JWT_SECRET) return null;
  const p = verifyJwt(k, taKey());
  return (p && p.aud === 'ta' && p.sub) ? p : null;
}

// Blob 路徑：ta/<rid>~<hmac16>/<part>.json.gz（part = summary | s000..s999）
// 不放 reports/ 底下：報告索引重建會 list 整個 reports/。
export const TA_PART_RE = /^(summary|s\d{3})$/;
export function taPath(rid, part) {
  const id = String(rid || '').trim();
  const h = crypto.createHmac('sha256', process.env.JWT_SECRET || '').update('ta|' + id).digest('hex').slice(0, 16);
  return 'ta/' + id + '~' + h + '/' + part + '.json.gz';
}

// 名單判斷：任何錯誤（含 ta_access 表還沒建）一律 false → 不注入、不擋報告
export async function taAllowed(sub) {
  if (!sub) return false;
  try {
    const r = await sql`SELECT 1 FROM ta_access WHERE enabled AND (member_id=${String(sub)} OR pub_id=${String(sub)}) LIMIT 1`;
    return r.length > 0;
  } catch (e) { return false; }
}

// summary 在不在（＝這份報告的 TA 資料齊了）。head 是簡單操作；同一實例 60 秒內不重查。
const READY = new Map();   // rid → {t, ok}
const READY_MS = 60_000;
export async function taReady(rid) {
  const now = Date.now();
  const c = READY.get(rid);
  if (c && now - c.t < READY_MS) return c.ok;
  let ok = false;
  try { await head(taPath(rid, 'summary')); ok = true; } catch (e) { ok = false; }
  READY.set(rid, { t: now, ok });
  if (READY.size > 200) READY.delete(READY.keys().next().value);
  return ok;
}

// 讀一個分片（或 summary）：私有 Blob → gunzip → JSON。同一實例 60 秒快取，最多留 24 份。
const CACHE = new Map();   // path → {t, data}
const CACHE_MS = 60_000, CACHE_MAX = 24;
export async function readTaPart(rid, part) {
  const path = taPath(rid, part);
  const now = Date.now();
  const c = CACHE.get(path);
  if (c && now - c.t < CACHE_MS) return c.data;
  const res = await get(path, { access: 'private' });
  if (!res || !res.stream) return null;
  let buf = Buffer.from(await new Response(res.stream).arrayBuffer());
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);   // 萬一中途被解壓過就直接用
  const data = JSON.parse(buf.toString('utf8'));
  CACHE.delete(path);
  CACHE.set(path, { t: now, data });
  while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  return data;
}

export async function writeTaPart(rid, part, obj) {
  const body = gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'));
  const res = await put(taPath(rid, part), body, {
    access: 'private', contentType: 'application/gzip',
    addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60,
  });
  if (part === 'summary') READY.delete(rid);
  CACHE.delete(taPath(rid, part));
  return { url: res.url, bytes: body.length };
}

function attr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 在報告 HTML 的 </body> 前注入 ta-pick.js（先拿掉報告裡既有的 ta-pick 標籤，避免重複掛載）。
export const TA_SITE = 'https://yoda-research-next.vercel.app';
// 拿掉報告裡既有的 ta-pick 標籤：名單外會員一律拿掉（就算哪天報告烤進了標籤，名單外也看不到任何技術分析 UI）
const TA_PICK_TAG_RE = /<script\b[^>]*ta-pick\.js[^>]*>\s*<\/script>/gi;
export function stripTaPick(html) {
  return String(html || '').replace(TA_PICK_TAG_RE, '');
}
export function injectTaPick(html, { ticket, rid, market }) {
  html = stripTaPick(html);
  const tag = '<script src="' + TA_SITE + '/ta-pick.js?v=1.2" data-ta-url="' + TA_SITE + '/ta"'
    + ' data-ta-k="' + attr(ticket) + '" data-ta-rid="' + attr(rid) + '" data-ta-max="200"'
    + (market === 'tw' ? ' data-ta-auto="tw"' : '') + '></script>';
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i >= 0 ? html.slice(0, i) + tag + '\n' + html.slice(i) : html + tag;
}
