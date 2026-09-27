import { CORS } from '../../../lib/cors';
import { verifyTaTicket, taAllowed, taMarket, readTaPart } from '../../../lib/ta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// /ta 頁的資料來源。
//
//   POST {k, rid, syms:[...], mode:'summary'|'detail'}
//     k    ＝ TA 通行票（/api/report 注入給名單內會員，經 ta-pick 放在網址 #k= 帶過來）
//     rid  ＝ 付費_美股分析_YYYYMMDD / 付費_台股分析_YYYYMMDD
//     syms ＝ 代號陣列，最多 200 個（detail 一次最多 25 個）
//
//   summary → {ok, rid, market, report_date, generated_at, asof_req, wm, rows:[{sym,...}依請求順序], missing:[...], errors:{...}, v, schema}
//   detail  → {ok, items:{sym: 完整 analyze() 結果}, missing:[...]}
//   失敗    → {ok:false, reason:'ticket'|'revoked'|'bad-request'|'not-ready'|'error', error}
//
// 每次查詢都即時再查 ta_access：主控台撤銷後，對方開著的 /ta 頁下一次查詢就失效。
// detail 要分頁（≤25 檔）：Vercel 函式回應上限 4.5MB，200 檔完整資料約 3～4MB，太貼邊。
const MAX_SYMS = 200, MAX_DETAIL = 25;
const SYM_RE = /^[A-Z0-9.\-^]{1,12}$/;

function R(data, status) {
  return Response.json(data, { status: status || 200, headers: { ...CORS, 'Cache-Control': 'no-store' } });
}
export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}

  const p = verifyTaTicket(body.k);
  if (!p) return R({ ok: false, reason: 'ticket', error: '通行票無效或已過期' }, 401);
  if (!(await taAllowed(p.sub))) return R({ ok: false, reason: 'revoked', error: '此功能僅限指定會員' }, 403);

  const rid = String(body.rid || '').trim();
  const market = taMarket(rid);
  if (!market) return R({ ok: false, reason: 'bad-request', error: '報告代碼不符' }, 400);

  const seen = new Set(), syms = [];
  for (const x of Array.isArray(body.syms) ? body.syms : []) {
    const s = String(x || '').trim().toUpperCase();
    if (!SYM_RE.test(s) || seen.has(s)) continue;
    seen.add(s); syms.push(s);
    if (syms.length >= MAX_SYMS) break;
  }
  const mode = body.mode === 'detail' ? 'detail' : 'summary';

  let sum;
  try { sum = await readTaPart(rid, 'summary'); }
  catch (e) { return R({ ok: false, reason: 'error', error: '讀取失敗：' + String((e && e.message) || e) }, 500); }
  if (!sum || !sum.rows) return R({ ok: false, reason: 'not-ready', error: '這份報告的技術分析資料還沒上傳' }, 404);

  const errors = sum.errors || {};
  if (mode === 'summary') {
    const rows = [], missing = [], errs = {};
    for (const s of syms) {
      const r = sum.rows[s];
      if (r) rows.push({ sym: s, ...r });
      else { missing.push(s); if (errors[s]) errs[s] = errors[s]; }
    }
    return R({
      ok: true, rid, market, report_date: sum.report_date || '', generated_at: sum.generated_at || '',
      asof_req: sum.asof_req || '', wm: p.wm || '', rows, missing, errors: errs,
      v: sum.v || 1, schema: sum.schema || '',   // 資料格式版本（v2＝三訊號 sig3-1；v1＝舊版，/ta 頁只列代號）
    });
  }

  // detail：依 summary 記錄的分片號分組讀
  const want = syms.slice(0, MAX_DETAIL);
  const byShard = new Map(), missing = [];
  for (const s of want) {
    const r = sum.rows[s];
    if (!r || r.s === undefined || r.s === null) { missing.push(s); continue; }
    const part = 's' + String(Number(r.s)).padStart(3, '0');
    if (!byShard.has(part)) byShard.set(part, []);
    byShard.get(part).push(s);
  }
  const items = {};
  try {
    await Promise.all(Array.from(byShard.entries()).map(async ([part, list]) => {
      const sh = await readTaPart(rid, part);
      for (const s of list) {
        const it = sh && sh.items && sh.items[s];
        if (it) items[s] = it; else missing.push(s);
      }
    }));
  } catch (e) {
    return R({ ok: false, reason: 'error', error: '讀取明細失敗：' + String((e && e.message) || e) }, 500);
  }
  return R({ ok: true, items, missing });
}
export async function GET() { return R({ ok: false, error: 'POST only' }, 405); }
