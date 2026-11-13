import { authOf, TA_GRACE_SEC, owners, store, todayTaipei, cleanSym, symKey, callEngine, renewTa, TFS, DAILY_MAX } from '../../../lib/ta-live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 獨立技術分析頁 /ta 的唯一資料來源（同網域呼叫，不開 CORS）。
//
//   POST  Authorization: Bearer <會員登入票>
//     {action:'status'}            → {ok, owner, quota, wm, token?}   （頁面一進來先問：開通了沒、今天剩幾檔；token＝換發的 aud:'ta' 長效票）
//     {symbol:'2330', tf:'D'}      → {ok, owner, quota, wm, data:<引擎回應>}
//   失敗 → {ok:false, reason, error, quota?}
//     reason：need-login 401｜not-enabled 403｜bad-request 400｜quota-exceeded 429｜symbol-not-found 404/422｜coming-soon 422｜
//             daily-only 422（台指期／費半期只有日K／週K，選 1H／4H 時；頁面自動改查日K）｜upstream 502｜error 500
//             （過期票寬限續票時 DB 出錯＝error 503：暫時錯誤，頁面不清票）
function R(data, status) {
  return Response.json(data, { status: status || 200, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req) {
  let body = {};
  try { body = (await req.json()) || {}; } catch (e) {}
  const NL = () => R({ ok: false, reason: 'need-login', error: '請先登入會員' }, 401);
  let p = authOf(req), expired = false;
  // 過期 7 天內的 aud:'ta' 票只能拿來 status 換新票（下面現查開通＋付費，不過就 need-login）；查代號等其他動作照樣拒
  if (!p && body.action === 'status') { p = authOf(req, TA_GRACE_SEC); expired = !!p; }
  if (!p) return NL();
  const sub = String(p.sub);
  const wm = p.wm || sub;

  try {
    const st = await store();
    const owner = owners().includes(sub) || (await st.isOwner(sub, expired));   // 過期票：DB 出錯要丟到下面回 503，不能當沒開通
    if (!owner && !(await st.allowed(sub, expired))) {
      if (expired) return NL();
      return R({ ok: false, reason: 'not-enabled', error: '技術分析未開通' }, 403);
    }
    const day = todayTaipei();
    const used = owner ? [] : await st.used(sub, day);
    const quota = (n) => (owner ? { unlimited: true } : { used: n, max: DAILY_MAX, left: Math.max(0, DAILY_MAX - n) });

    if (body.action === 'status') {   // 已確認開通才續長效票（token 空＝沒換，頁面沿用舊票）
      const token = await renewTa(p, expired);
      if (expired && !token) return NL();   // 過期票續不了（沒付費／查不到）＝重新登入；DB 出錯 renewTa 會丟例外 → 下面 503
      const nwm = token ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).wm : wm;   // 換了票＝浮水印跟新票（現查會員重算）
      return R({ ok: true, owner, quota: quota(used.length), wm: nwm, ...(token ? { token } : {}) });
    }

    const sym = cleanSym(body.symbol);
    const tf = TFS.includes(body.tf) ? body.tf : '';
    if (!sym || !tf) return R({ ok: false, reason: 'bad-request', error: '代號或週期格式不對', quota: quota(used.length) }, 400);

    const key = symKey(sym);
    const fresh = !owner && !used.includes(key);
    // shortcut: 同一會員同時送多檔時可能多算過 30 檔一兩檔（先查後寫、沒鎖），人工操作不會發生
    if (fresh && used.length >= DAILY_MAX) {
      return R({ ok: false, reason: 'quota-exceeded', error: '今天的 ' + DAILY_MAX + ' 檔額度用完了（台灣時間午夜重算）；今天查過的代號仍可再看', quota: quota(used.length) }, 429);
    }

    const { status, body: eb } = await callEngine(sym, tf);
    if (status === 200 && eb && eb.ok) {
      const k2 = symKey((eb.symbol && eb.symbol.yahoo) || sym);
      let n = used.length;
      if (!owner && !used.includes(k2)) { await st.add(sub, day, k2); n++; }
      return R({ ok: true, owner, quota: quota(n), wm, data: eb });
    }
    const msg = (eb && eb.error && eb.error.message) || '';
    if (status === 400 || status === 404 || status === 422) {   // 查無／不支援（指數、加密貨幣、資料太少）：不扣額度
      const code = eb && eb.error && eb.error.code;
      const reason = code === 'coming_soon' ? 'coming-soon' : code === 'daily_only' ? 'daily-only' : 'symbol-not-found';
      return R({ ok: false, reason, error: msg || '查無此代號', quota: quota(used.length) }, status === 422 ? 422 : 404);
    }
    return R({ ok: false, reason: 'upstream', error: status === 401 ? '計算引擎設定有誤（金鑰不符）' : msg || '行情來源暫時沒有回應，請稍後再試', quota: quota(used.length) }, 502);
  } catch (e) {
    // 過期票寬限續票時查會員／開通出錯＝暫時錯誤：503、不是 need-login（頁面保留票、顯示錯誤＋重試）
    if (expired) return R({ ok: false, reason: 'error', error: '會員資料暫時查不到，請稍後再試（登入沒有失效）' }, 503);
    return R({ ok: false, reason: 'error', error: '伺服器錯誤：' + String((e && e.message) || e).slice(0, 200) }, 500);
  }
}
export async function GET() { return R({ ok: false, error: 'POST only' }, 405); }
