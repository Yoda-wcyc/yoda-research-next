import { authOf, owners, store, callEngine } from '../../../lib/ta-live';
import { cboeSym, cboeCode, parseChain, defaultExpiry } from '../../../lib/ta-opt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// /ta「選擇權」分頁（2026-11-23）：CBOE 延遲報價（同 Skill\opt_cboe.py），閘門同 /api/ta-rs
//   POST  Authorization: Bearer <票>  body {symbol（只收 lib/ta-opt OPT_SYMS 那 11 檔）, expiry?（YYYY-MM-DD；沒給或不在清單＝第一個 ≥ 14 天的）}
//   → {ok, symbol, price, ts（UTC）, last（標的最後成交，美東）, expiries:[…], expiry, rows:[{k, c:{b,a,iv,oi}|null, p:同}]}；失敗 {ok:false, reason, error}
//   作空試算子分頁（11-26）：symbol 另收 SMH、NDX（抓 _NDX）；可選 expiries:[最多 6 個到期日] → 多回 by:{到期日: rows}（不在清單的略過）；NDX 多回 root:{到期日: NDX|NDXP}；symbol:'NQ' 只回 NQ 近月期貨現價（見 nqQuote）
// CBOE 307 轉到 cdn-api.cboe.com，沒帶 Referer／Origin 一律 403（opt_cboe.py 2026-11-20 實測）；值是 CBOE 官網自己的網址，不帶個人資訊
const URL = 'https://cdn.cboe.com/api/global/delayed_quotes/options/';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; market-data-client/1.0)', Accept: 'application/json', Referer: 'https://www.cboe.com/', Origin: 'https://www.cboe.com' };
const TTL = 60 * 1000;
const CACHE = new Map(), INFLIGHT = new Map();   // 代號 → {t, v}；代號 → 抓取中的 promise（同代號同時請求只打一次）；代號只有白名單 13 檔，不會無限長

function R(data, status) {
  return Response.json(data, { status: status || 200, headers: { 'Cache-Control': 'private, no-store' } });
}

async function chain(sym) {
  const c = CACHE.get(sym);
  if (c && Date.now() - c.t < TTL) return c.v;
  if (!INFLIGHT.has(sym)) {
    INFLIGHT.set(sym, (async () => {
      const r = await fetch(URL + cboeCode(sym) + '.json', { headers: HEADERS, cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('CBOE HTTP ' + r.status);
      const v = parseChain(await r.json(), sym);
      if (!v || !v.price || !v.expiries.length) throw new Error('CBOE 回應沒有 ' + sym + ' 的報價');
      CACHE.set(sym, { t: Date.now(), v });
      return v;
    })().finally(() => INFLIGHT.delete(sym)));
  }
  return INFLIGHT.get(sym);
}

// symbol:'NQ'（11-26）：只回 NQ 近月期貨現價 → {ok:true, symbol:'NQ', nq:{price, contract, ts（UTC，引擎抓 Yahoo 的時間）}|null, error?}
// 走網站既有的計算引擎 NQ=F 日K（callEngine 自己有 15 分鐘快取）；不經 /api/ta-live、不寫 ta_quota → 不扣每天 30 檔額度
// 抓不到也回 ok:true、nq:null：頁面退回「NDX × e^(rT)」估算，不擋整頁
async function nqQuote() {
  let e = '';
  try {
    const { status, body } = await callEngine('NQ=F', 'D');
    const bars = status === 200 && body && body.ok && body.chart && body.chart.bars;
    const last = bars && bars[bars.length - 1];
    if (last && last.c > 0) {
      const t = Number(body.fetched_at) > 0 ? new Date(body.fetched_at * 1000).toISOString().slice(0, 19).replace('T', ' ') : '';
      return { ok: true, symbol: 'NQ', nq: { price: last.c, contract: String((body.symbol && body.symbol.contract) || ''), ts: t } };
    }
    e = (body && body.error && body.error.message) || '引擎沒有回 NQ 報價';
  } catch (x) { e = String((x && x.message) || x); }
  return { ok: true, symbol: 'NQ', nq: null, error: '資料不足：NQ 期貨報價暫時抓不到（' + String(e).slice(0, 80) + '）' };
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
    if (b && b.symbol === 'NQ') return R(await nqQuote());
    const sym = cboeSym(b && b.symbol);
    if (!sym) return R({ ok: false, reason: 'bad-input', error: '不支援這個代號' }, 400);
    const e0 = b.expiry;
    if (e0 !== undefined && e0 !== '' && !(typeof e0 === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e0))) return R({ ok: false, reason: 'bad-input', error: '到期日格式要 YYYY-MM-DD' }, 400);
    const ex = b.expiries;
    if (ex !== undefined && !(Array.isArray(ex) && ex.length <= 6 && ex.every((e) => typeof e === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e)))) return R({ ok: false, reason: 'bad-input', error: 'expiries 要是最多 6 個 YYYY-MM-DD' }, 400);
    let v;
    try { v = await chain(sym); } catch (e) { return R({ ok: false, reason: 'upstream', error: '資料不足：CBOE 暫時抓不到（' + String((e && e.message) || e).slice(0, 80) + '）' }, 502); }
    const expiry = v.expiries.includes(e0) ? e0 : defaultExpiry(v.expiries);
    const out = { ok: true, symbol: sym, price: v.price, ts: v.ts, last: v.last, expiries: v.expiries, expiry, rows: v.by[expiry] };
    if (ex) out.by = Object.fromEntries(ex.filter((e) => v.by[e]).map((e) => [e, v.by[e]]));
    if (v.root) out.root = v.root;
    return R(out);
  } catch (e) {
    return R({ ok: false, reason: 'error', error: '伺服器錯誤：' + String((e && e.message) || e).slice(0, 200) }, 500);
  }
}
export async function GET() { return R({ ok: false, error: 'POST only' }, 405); }
