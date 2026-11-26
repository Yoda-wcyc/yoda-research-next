import { authOf, owners, store } from '../../../lib/ta-live';
import { get } from '../../../lib/data-blob';
import { latestPath, partPath, assemble } from '../../../lib/data-parts';
import { valid, inject, summary } from '../../../lib/ta-swing';
import { SHELL } from '../../../lib/ta-swing-shell';
import { gunzipSync } from 'zlib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// /ta「多空波段」分頁（2026-11-26）：外殼在 repo（lib/ta-swing-shell.js），資料＝私有 Blob 資料集 swing（compose_swing.py --data 的 swing_data.json，
//   gzip 後經 /api/admin-put-data 分段上傳，同 tw_rs_panel）。閘門同 /api/ta-rs（401／403），不扣每天查詢額度。
//   POST  Authorization: Bearer <會員登入票>  body {op:'page'}（預設）→ {ok, through, html}（html＝給 iframe srcdoc 的完整頁）
//                                            body {op:'ck'} → {ok, through, built_at, day, score:{top,bottom}, conds:{<代碼>:{side,no,t,grade,on,last_on}}}
//   Blob 還沒有資料／資料壞 → 503 {ok:false, reason:'no-source'|'updating', error:'資料不足：…'}
function R(data, status) {
  return Response.json(data, { status: status || 200, headers: { 'Cache-Control': 'private, no-store' } });
}

const NAME = 'swing', LATEST_MS = 10 * 60 * 1000;
// shortcut: 快取只在這個函式實例的記憶體（同 ta-rs）；冷啟動就重讀一次（約 0.5MB）
let C = { t: 0, ver: '', d: null, page: null };
async function data() {
  if (C.d && Date.now() - C.t < LATEST_MS) return C.d;
  let m;
  try {
    const r = await get(latestPath(NAME), { access: 'private', useCache: false });
    m = r ? JSON.parse(await new Response(r.stream).text()) : null;
  } catch (e) {
    if (C.d) return C.d;   // Blob 抖一下：有舊的就先用
    throw e;
  }
  if (!m) return null;
  if (m.ver === C.ver && C.d) { C.t = Date.now(); return C.d; }
  let d = null;
  try {
    const bufs = await Promise.all(Array.from({ length: m.parts }, async (_, i) => {
      const r = await get(partPath(NAME, m.ver, i), { access: 'private' });
      return r ? Buffer.from(await new Response(r.stream).arrayBuffer()) : Buffer.alloc(0);
    }));
    const gz = assemble(bufs, m.sha256);
    d = gz && JSON.parse(gunzipSync(gz).toString('utf8'));
  } catch (e) { d = null; }
  if (!valid(d)) {   // 段對不上／解不開／格式不符：有舊的先用（10 分鐘內不再重下壞版），不快取壞版
    if (C.d) { C.t = Date.now(); return C.d; }
    return 'updating';
  }
  C = { t: Date.now(), ver: m.ver, d, page: null };
  return d;
}

// 單獨放進 /ta 的 iframe：外觀由 /ta 的亮暗切換帶（父頁點 iframe 裡的 .sw-th），自己的切換鈕藏起來；
// 外殼桌機版寬 1280 起跳，/ta 右側窗格約 1000px → 拿掉最小寬度讓它照窗格寬排；真的還放不下才橫向捲（不出直向捲軸，高度由父頁量）
const FIT = '<style>.sw-theme{display:none!important}.sw-bar,.sw-wrap,.ck-root .wrap{min-width:0!important}html,body{overflow-y:hidden!important;min-height:0!important}</style>';

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
    const op = b && b.op !== undefined ? b.op : 'page';
    if (op !== 'page' && op !== 'ck') return R({ ok: false, reason: 'bad-input', error: 'op 要是 page 或 ck' }, 400);

    const d = await data();
    if (!d) return R({ ok: false, reason: 'no-source', error: '資料不足：多空波段資料還沒上傳' }, 503);
    if (d === 'updating') return R({ ok: false, reason: 'updating', error: '資料不足：多空波段資料更新中，稍後再試' }, 503);
    if (op === 'ck') return R({ ok: true, ...summary(d) });
    if (!C.page || C.d !== d) {
      const html = inject(SHELL, d);
      if (!html) return R({ ok: false, reason: 'error', error: '資料不足：外殼佔位對不上' }, 500);
      C.page = html.replace('</head>', FIT + '</head>');
    }
    return R({ ok: true, through: d.through, html: C.page });
  } catch (e) {
    // 服務掛掉（Blob／會員庫丟例外）一律寫「資料不足」，原始訊息只進 log
    console.error('ta-swing', e);
    return R({ ok: false, reason: 'error', error: '資料不足：多空波段資料暫時讀不到，稍後再試' }, 503);
  }
}
export async function GET() { return R({ ok: false, error: 'POST only' }, 405); }
