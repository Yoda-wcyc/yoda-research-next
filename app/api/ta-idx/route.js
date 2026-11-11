import { authOf, owners, store } from '../../../lib/ta-live';
import { blobPath } from '../../../lib/blob';
import { readIndex } from '../../../lib/report-index';
import { newestUs, extractIdxPos } from '../../../lib/ta-idx';
import { get } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// /ta「指數位階」分頁（2026-11-11）：最新一份已發佈美股報告的「02 指數位階」整章原樣搬過來（不重算）。
//   POST  Authorization: Bearer <會員登入票>  → {ok, date, html}（html＝給 iframe srcdoc 的完整小文件）
//   失敗 → {ok:false, reason, error}；閘門同 /api/ta-live（站長或 ta_access 開通）
function R(data, status) {
  return Response.json(data, { status: status || 200, headers: { 'Cache-Control': 'private, no-store' } });
}

// shortcut: 快取只在這個函式實例的記憶體（同 lib/ta-live.js CACHE），冷啟動就重抓一次 4MB 報告
const CACHE = new Map();   // blob 路徑 → {t, html}（抽完的章節；null＝這份報告裡沒有這一章）
const CACHE_MS = 15 * 60 * 1000;

async function readReport(reportId) {
  // shortcut: dev-only fixture（本機沒 Blob 金鑰時預覽用），prod always reads Blob
  if (process.env.NODE_ENV !== 'production' && process.env.TA_IDX_LOCAL_FILE) {
    return (await import('fs')).readFileSync(process.env.TA_IDX_LOCAL_FILE, 'utf8');
  }
  const r = await get(blobPath(reportId), { access: 'private' });
  return r ? await new Response(r.stream).text() : null;
}

export async function POST(req) {
  const p = authOf(req);
  if (!p) return R({ ok: false, reason: 'need-login', error: '請先登入會員' }, 401);
  const sub = String(p.sub);
  try {
    const st = await store();
    const owner = owners().includes(sub) || (await st.isOwner(sub));
    if (!owner && !(await st.allowed(sub))) return R({ ok: false, reason: 'not-enabled', error: '技術分析未開通' }, 403);

    const local = process.env.NODE_ENV !== 'production' && process.env.TA_IDX_LOCAL_FILE;
    const hit = local ? newestUs([{ reportId: local.split(/[\\/]/).pop().replace(/\.html$/i, '') }]) || { reportId: 'local', date: '本機檔' } : newestUs((await readIndex()).entries);
    if (!hit) return R({ ok: false, reason: 'not-found', error: '還沒有已發佈的美股報告' }, 404);

    const key = blobPath(hit.reportId);
    let c = CACHE.get(key);
    if (!c || Date.now() - c.t > CACHE_MS) {
      const html = await readReport(hit.reportId);
      if (html === null) return R({ ok: false, reason: 'not-found', error: '找不到美股報告：' + hit.reportId }, 404);
      c = { t: Date.now(), html: extractIdxPos(html) };
      CACHE.set(key, c);
      while (CACHE.size > 4) CACHE.delete(CACHE.keys().next().value);
    }
    if (!c.html) return R({ ok: false, reason: 'not-found', error: '美股報告裡找不到指數位階這一章' }, 404);
    // 逐人浮水印，同 /api/report
    return R({ ok: true, date: hit.date, html: c.html.split('{{WATERMARK}}').join(p.wm || '會員專屬') });
  } catch (e) {
    return R({ ok: false, reason: 'error', error: '伺服器錯誤：' + String((e && e.message) || e).slice(0, 200) }, 500);
  }
}
export async function GET() { return R({ ok: false, error: 'POST only' }, 405); }
