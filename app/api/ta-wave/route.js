import { authOf, owners, store } from '../../../lib/ta-live';
import { blobPath } from '../../../lib/blob';
import { readIndex } from '../../../lib/report-index';
import { newestWave, extractWave } from '../../../lib/ta-wave';
import { get } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// /ta「波浪」分頁（2026-11-24）：最新一份會員版「專題研究_波浪理論」只搬互動波浪圖表（不重算），寫法同 /api/ta-idx。
//   POST  Authorization: Bearer <會員登入票>  → {ok, date, html}（html＝給 iframe srcdoc 的完整小文件）
//   失敗 → {ok:false, reason, error}；閘門同 /api/ta-live（站長或 ta_access 開通），閘門過了才讀索引／Blob
function R(data, status) {
  return Response.json(data, { status: status || 200, headers: { 'Cache-Control': 'private, no-store' } });
}

// shortcut: 快取只在這個函式實例的記憶體（同 /api/ta-idx），冷啟動就重抓一次報告
const CACHE = new Map();   // blob 路徑 → {t, html}
const CACHE_MS = 15 * 60 * 1000;

async function readReport(reportId) {
  // shortcut: dev-only fixture（本機沒 Blob 金鑰時預覽用），prod always reads Blob
  if (process.env.NODE_ENV !== 'production' && process.env.TA_WAVE_LOCAL_FILE) {
    return (await import('fs')).readFileSync(process.env.TA_WAVE_LOCAL_FILE, 'utf8');
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

    const local = process.env.NODE_ENV !== 'production' && process.env.TA_WAVE_LOCAL_FILE;
    const ld = local && (local.match(/(\d{8})\.html?$/i) || [])[1];
    const hit = local ? { reportId: 'local-wave', date: ld ? ld.slice(0, 4) + '-' + ld.slice(4, 6) + '-' + ld.slice(6, 8) : '本機檔' } : newestWave((await readIndex()).entries);
    if (!hit) return R({ ok: false, reason: 'not-found', error: '還沒有已發佈的波浪理論會員版報告' }, 404);

    const key = blobPath(hit.reportId);
    let c = CACHE.get(key);
    if (!c || Date.now() - c.t > CACHE_MS) {
      const html = await readReport(hit.reportId);
      if (html === null) return R({ ok: false, reason: 'not-found', error: '找不到波浪理論報告：' + hit.reportId }, 404);
      try { c = { t: Date.now(), html: extractWave(html) }; }
      catch (e) { return R({ ok: false, reason: 'not-found', error: String((e && e.message) || e) }, 404); }
      CACHE.set(key, c);
      while (CACHE.size > 4) CACHE.delete(CACHE.keys().next().value);
    }
    return R({ ok: true, date: hit.date, html: c.html });
  } catch (e) {
    return R({ ok: false, reason: 'error', error: '伺服器錯誤：' + String((e && e.message) || e).slice(0, 200) }, 500);
  }
}
export async function GET() { return R({ ok: false, error: 'POST only' }, 405); }
