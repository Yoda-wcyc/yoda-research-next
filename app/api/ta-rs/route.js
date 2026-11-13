import { authOf, owners, store } from '../../../lib/ta-live';
import { load, loaded, compute, presetStart, range } from '../../../lib/ta-rs';
import { get } from '../../../lib/data-blob';
import { latestPath, partPath, assemble } from '../../../lib/data-parts';
import { gunzipSync } from 'zlib';

const NAME = 'tw_rs_panel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// /ta「區間強弱」分頁（2026-11-13 本機 demo）：任選起迄日 → 台股族群／個股相對大盤強弱（lib/ta-rs.js 現算）。
//   POST  Authorization: Bearer <會員登入票>  body {start?, end?（YYYY-MM-DD）, minAmt?（元，0..1e11，預設 5e7）, n?（5..100，預設 20）}
//   → {ok, ...compute 結果, range:{min,max}}；沒給日期＝近 1 月。失敗 → {ok:false, reason, error}；閘門同 /api/ta-idx
function R(data, status) {
  return Response.json(data, { status: status || 200, headers: { 'Cache-Control': 'private, no-store' } });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 資料來源（2026-11-13 Yoda 定）：私有 Blob，本機每天 python tw_rs_export.py --upload 分段上傳（見 lib/data-parts.js）。
//   讀 data/tw_rs_panel/latest.json（最多每 10 分鐘回源看一次）→ 版本變了才下載各段、接起來驗 sha256、解 gzip。
//   回 panel；null＝還沒有 latest.json；'updating'＝段跟 latest 對不上（不快取，下一個請求重看 latest）
//   本機另可用 TA_RS_LOCAL_FILE 直接指到 tw_rs_panel.json.gz（正式站不看）
const LATEST_MS = 10 * 60 * 1000;
let LATEST = { t: 0, meta: null };
async function panel() {
  const f = process.env.NODE_ENV !== 'production' && process.env.TA_RS_LOCAL_FILE;
  if (f) {
    const fs = await import('fs');
    return load(f + '|' + fs.statSync(f).mtimeMs, () => gunzipSync(fs.readFileSync(f)).toString('utf8'));
  }
  if (!LATEST.t || Date.now() - LATEST.t > LATEST_MS) {
    const r = await get(latestPath(NAME), { access: 'private', useCache: false });
    LATEST = { t: r ? Date.now() : 0, meta: r ? JSON.parse(await new Response(r.stream).text()) : null };   // 沒有 latest 不快取：第一次上傳後馬上看得到
  }
  const m = LATEST.meta;
  if (!m) return null;
  if (loaded(m.ver)) return load(m.ver, () => '');
  const bufs = await Promise.all(Array.from({ length: m.parts }, async (_, i) => {
    const r = await get(partPath(NAME, m.ver, i), { access: 'private' });   // 段路徑帶版本、不覆寫＝可以吃 CDN 快取
    return r ? Buffer.from(await new Response(r.stream).arrayBuffer()) : Buffer.alloc(0);
  }));
  const gz = assemble(bufs, m.sha256);
  if (!gz) { LATEST = { t: 0, meta: null }; return 'updating'; }
  return load(m.ver, () => gunzipSync(gz).toString('utf8'));
}

export async function POST(req) {
  const p = authOf(req);
  if (!p) return R({ ok: false, reason: 'need-login', error: '請先登入會員' }, 401);
  const sub = String(p.sub);
  try {
    const st = await store();
    const owner = owners().includes(sub) || (await st.isOwner(sub));
    if (!owner && !(await st.allowed(sub))) return R({ ok: false, reason: 'not-enabled', error: '技術分析未開通' }, 403);

    let b = {};
    try { b = (await req.json()) || {}; } catch (e) { b = {}; }
    if (typeof b !== 'object' || Array.isArray(b)) b = {};
    for (const k of ['start', 'end']) if (b[k] !== undefined && b[k] !== '' && !(typeof b[k] === 'string' && DATE_RE.test(b[k]) && new Date(Date.parse(b[k]) || 0).toISOString().slice(0, 10) === b[k])) return R({ ok: false, reason: 'bad-input', error: '日期格式要 YYYY-MM-DD' }, 400);
    const minAmt = b.minAmt === undefined ? 5e7 : b.minAmt;   // 只收數字（null、字串都擋）
    if (typeof minAmt !== 'number' || !Number.isFinite(minAmt) || minAmt < 0 || minAmt > 1e11) return R({ ok: false, reason: 'bad-input', error: '成交值門檻要在 0 ～ 1,000 億元之間' }, 400);
    const n = b.n === undefined ? 20 : b.n;
    if (!Number.isInteger(n) || n < 5 || n > 100) return R({ ok: false, reason: 'bad-input', error: '名次要是 5 ～ 100 的整數' }, 400);

    const pn = await panel();
    if (!pn) return R({ ok: false, reason: 'no-source', error: '資料來源尚未設定' }, 503);
    if (pn === 'updating') return R({ ok: false, reason: 'updating', error: '資料更新中' }, 503);
    const rg = range(pn);
    const end = b.end || rg.max;
    const start = b.start || presetStart(end, '1m');
    const out = compute(pn, { start, end, minAmt, n });
    if (out.error) return R({ ok: false, reason: 'bad-range', error: out.error, range: rg }, 400);
    return R({ ok: true, ...out });
  } catch (e) {
    return R({ ok: false, reason: 'error', error: '伺服器錯誤：' + String((e && e.message) || e).slice(0, 200) }, 500);
  }
}
export async function GET() { return R({ ok: false, error: 'POST only' }, 405); }
