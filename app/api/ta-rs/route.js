import { authOf, owners, store } from '../../../lib/ta-live';
import { load, loaded, compute, presetStart, range } from '../../../lib/ta-rs';
import { get } from '../../../lib/data-blob';
import { latestPath, partPath, assemble } from '../../../lib/data-parts';
import { gunzipSync } from 'zlib';

// 市場 → Blob 資料名、本機 dev 檔的環境變數、預設成交值門檻（台股 5,000 萬元；美股 0＝S&P 500 成分本來就夠大）
// maxTxt＝上限 1e11 用頁面輸入框的單位講（台股輸入「萬」、美股輸入「百萬美元」）
const MKT = {
  tw: { name: 'tw_rs_panel', env: 'TA_RS_LOCAL_FILE', minAmt: 5e7, maxTxt: '10,000,000 萬（＝1,000 億元）' },
  us: { name: 'us_rs_panel', env: 'TA_RS_US_LOCAL_FILE', minAmt: 0, maxTxt: '100,000 百萬美元' },
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// /ta「區間強弱」分頁（2026-11-13 本機 demo）：任選起迄日 → 族群／個股相對大盤強弱（lib/ta-rs.js 現算）。
//   POST  Authorization: Bearer <會員登入票>  body {market?（'tw'｜'us'，預設 tw）, start?, end?（YYYY-MM-DD）,
//         minAmt?（該市場貨幣，0..1e11，預設 tw 5e7／us 0）, n?（5..100，預設 20）}
//   → {ok, market, currency, ...compute 結果（含 groups_ver）, range:{min,max}}；沒給日期＝近 1 月。失敗 → {ok:false, reason, error}；閘門同 /api/ta-idx
function R(data, status) {
  return Response.json(data, { status: status || 200, headers: { 'Cache-Control': 'private, no-store' } });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 資料來源（2026-11-13 Yoda 定）：私有 Blob，本機每天 python tw_rs_export.py／us_rs_export.py --upload 分段上傳（見 lib/data-parts.js）。
//   讀 data/<name>/latest.json（最多每 10 分鐘回源看一次）→ 版本變了才下載各段、接起來驗 sha256、解 gzip。
//   回 panel；null＝還沒有 latest.json；'updating'＝段跟 latest 對不上（不快取，下一個請求重看 latest；記憶體有舊的好面板就回舊的、帶它自己的資料日）
//   latest.json 讀失敗（Blob 錯、JSON 壞）或下載段丟錯，而記憶體已有好面板 → 先用舊的，不回 500
//   同一版同時多個請求只下載／解一次（INFLIGHT）。本機另可用 TA_RS_LOCAL_FILE／TA_RS_US_LOCAL_FILE 直接指到 .json.gz（正式站不看）
const LATEST_MS = 10 * 60 * 1000;
const LATEST = {}, LAST = {}, INFLIGHT = new Map();   // 市場 → {t, meta}；市場 → 最近一次載好的面板；name|ver → 下載中的 promise
async function panel(mk) {
  const { name, env } = MKT[mk];
  const f = process.env.NODE_ENV !== 'production' && process.env[env];
  if (f) {
    const fs = await import('fs');
    return load(f + '|' + fs.statSync(f).mtimeMs, () => gunzipSync(fs.readFileSync(f)).toString('utf8'), mk);
  }
  const L = LATEST[mk];
  if (!L || !L.t || Date.now() - L.t > LATEST_MS) {
    try {
      const r = await get(latestPath(name), { access: 'private', useCache: false });
      LATEST[mk] = { t: r ? Date.now() : 0, meta: r ? JSON.parse(await new Response(r.stream).text()) : null };   // 沒有 latest 不快取：第一次上傳後馬上看得到
    } catch (e) {
      if (LAST[mk]) return LAST[mk];
      throw e;
    }
  }
  const m = LATEST[mk].meta;
  if (!m) return null;
  if (loaded(m.ver, mk)) return load(m.ver, () => '', mk);
  const k = name + '|' + m.ver;
  if (!INFLIGHT.has(k)) {
    INFLIGHT.set(k, (async () => {
      let bufs;
      try {
        bufs = await Promise.all(Array.from({ length: m.parts }, async (_, i) => {
          const r = await get(partPath(name, m.ver, i), { access: 'private' });   // 段路徑帶版本、不覆寫＝可以吃 CDN 快取
          return r ? Buffer.from(await new Response(r.stream).arrayBuffer()) : Buffer.alloc(0);
        }));
      } catch (e) {   // 下載段出錯（Blob 錯）：同壞版，有舊的好面板就先用、下一個請求重看 latest；沒有才往外丟（500）
        LATEST[mk] = { t: 0, meta: null };
        if (LAST[mk]) return LAST[mk];
        throw e;
      }
      const gz = assemble(bufs, m.sha256);
      let p = null;
      try { p = gz && load(m.ver, () => gunzipSync(gz).toString('utf8'), mk); } catch (e) { p = null; }   // 解不開／schema 不符＝同壞版
      if (!p) { LATEST[mk] = { t: 0, meta: null }; return LAST[mk] || 'updating'; }   // 壞版：有舊的好面板就先用（through 是舊的）
      return (LAST[mk] = p);
    })().finally(() => INFLIGHT.delete(k)));
  }
  return INFLIGHT.get(k);
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
    if (b.op === 'names') {   // 查代號下拉顯示台股中文名（11-14）：台股面板的代號 → 名稱；記憶體已有面板就不重讀 Blob
      const tw = await panel('tw');
      if (!tw || tw === 'updating') return R({ ok: false, reason: tw ? 'updating' : 'no-source', error: tw ? '資料更新中' : '資料來源尚未設定' }, 503);
      const names = {};
      tw.codes.forEach((c, i) => { if (typeof tw.names[i] === 'string' && tw.names[i]) names[c] = tw.names[i]; });
      return R({ ok: true, names });
    }
    const mk = b.market === undefined ? 'tw' : b.market;
    if (!Object.prototype.hasOwnProperty.call(MKT, mk)) return R({ ok: false, reason: 'bad-input', error: '市場要是 tw 或 us' }, 400);
    for (const k of ['start', 'end']) if (b[k] !== undefined && b[k] !== '' && !(typeof b[k] === 'string' && DATE_RE.test(b[k]) && new Date(Date.parse(b[k]) || 0).toISOString().slice(0, 10) === b[k])) return R({ ok: false, reason: 'bad-input', error: '日期格式要 YYYY-MM-DD' }, 400);
    const minAmt = b.minAmt === undefined ? MKT[mk].minAmt : b.minAmt;   // 只收數字（null、字串都擋）
    if (typeof minAmt !== 'number' || !Number.isFinite(minAmt) || minAmt < 0 || minAmt > 1e11) return R({ ok: false, reason: 'bad-input', error: '成交值門檻要在 0 ～ ' + MKT[mk].maxTxt + ' 之間' }, 400);
    const n = b.n === undefined ? 20 : b.n;
    if (!Number.isInteger(n) || n < 5 || n > 100) return R({ ok: false, reason: 'bad-input', error: '名次要是 5 ～ 100 的整數' }, 400);

    const pn = await panel(mk);
    if (!pn) return R({ ok: false, reason: 'no-source', error: '資料來源尚未設定' }, 503);
    if (pn === 'updating') return R({ ok: false, reason: 'updating', error: '資料更新中' }, 503);
    const rg = range(pn);
    const end = b.end || rg.max;
    const start = b.start || presetStart(end, '1m');
    const out = compute(pn, { start, end, minAmt, n });
    if (out.error) return R({ ok: false, reason: 'bad-range', error: out.error, range: rg }, 400);
    return R({ ok: true, market: mk, currency: pn.currency || 'TWD', ...out });
  } catch (e) {
    return R({ ok: false, reason: 'error', error: '伺服器錯誤：' + String((e && e.message) || e).slice(0, 200) }, 500);
  }
}
export async function GET() { return R({ ok: false, error: 'POST only' }, 405); }
