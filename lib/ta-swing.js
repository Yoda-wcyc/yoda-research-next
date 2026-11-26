// /ta「多空波段」（2026-11-26 Yoda 定：不放報告，整個搬到 /ta）：外殼（lib/ta-swing-shell.js）＋每天一份資料 swing_data.json。
// 資料合約（compose_swing.py --data）：{v:1, through:'YYYY-MM-DD', built_at, ck:{static:{layers,rows,evn,note_d,note}, dyn:{dates,ndx,m}}, cdt:{...}}
// 純函式、不碰檔案與網路；呼叫端 app/api/ta-swing/route.js。測試 tests/ta_swing.cjs
export const PH_CK = '"__SW_CK_DATA__"', PH_CDT = '"__SW_CDT_DATA__"';

export function valid(d) {
  const ck = d && d.ck, s = ck && ck.static, y = ck && ck.dyn;
  return !!(d && d.v === 1 && typeof d.through === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.through)
    && s && Array.isArray(s.rows) && y && Array.isArray(y.dates) && y.dates.length && y.m && typeof y.m === 'object'
    && d.cdt && typeof d.cdt === 'object');
}

const once = (s, p) => s.indexOf(p) >= 0 && s.indexOf(p) === s.lastIndexOf(p);
// 資料放進 <script> 裡：</ 與 <!-- 改寫成 <（JS 字串／JSON 內等值），資料不會提前關掉 script；compose 本來就擋，這裡再保一次
const js = (o) => JSON.stringify(o).replace(/<(?=\/|!--)/g, '\\u003c');

// 外殼＋資料 → 完整頁；佔位不是剛好各一次 → null
export function inject(shell, d) {
  const s = String(shell || '');
  if (!once(s, PH_CK) || !once(s, PH_CDT)) return null;
  return s.split(PH_CK).join(js(d.ck)).split(PH_CDT).join(js(d.cdt));
}

// 同外殼的條件分數：Σ(權重×當天成立)÷Σ(當天可判斷條件的權重)×100，預設權重；流程規則、帳本沒有的條件不算
export const W = { 有效: 3, 偏有效: 2, 資料不足: 1, 無效: 0.5 };
export const SIDE = { bull: 'top', bear: 'bottom' };   // bull＝頂部訊號、bear＝底部訊號

// op:'ck'：{through, score:{top,bottom}, conds:{bull_1a:{side,no,t,grade,on(true/false/null＝無法判斷),last_on}}}
export function summary(d) {
  const { rows } = d.ck.static, { dates, m } = d.ck.dyn, last = dates.length - 1;
  const conds = {}, acc = { top: [0, 0], bottom: [0, 0] };
  for (const r of rows) for (const s of ['bull', 'bear']) {
    const it = r[s], k = s + '_' + r.no, str = m[k];
    if (!it || it.g === '流程' || typeof str !== 'string') continue;
    const ch = str[last], i = str.lastIndexOf('1');
    conds[k] = { side: SIDE[s], no: r.no, t: it.t, grade: it.g, on: ch === '1' ? true : ch === '0' ? false : null, last_on: i >= 0 ? dates[i] : null };
    if (ch === '-' || ch === undefined) continue;
    const w = W[it.g] || 0, a = acc[SIDE[s]];
    a[1] += w; if (ch === '1') a[0] += w;
  }
  const sc = (a) => (a[1] > 0 ? Math.round((a[0] / a[1]) * 1000) / 10 : null);
  return { through: d.through, built_at: d.built_at || '', day: dates[last], score: { top: sc(acc.top), bottom: sc(acc.bottom) }, conds };
}
