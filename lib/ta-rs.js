// /ta「區間強弱」分頁（2026-11-13 本機 demo，待 Yoda 核可）：任選起迄日，看台股族群／個股相對大盤的強弱。
// 面板＝Skill\tw_rs_export.py 匯出的 tw_rs_panel.json.gz（schema tw-rs-1：還原收盤、成交值百萬、加權報酬指數、價格指數、v6 族群）。
// 純函式、不碰檔案與網路、不用 Node 模組（頁面也 import presetStart）；呼叫端（app/api/ta-rs/route.js）負責讀檔與解 gzip。
//   區間報酬＝還原收盤(迄) ÷ 還原收盤(基準) − 1；基準＝起日前一個交易日收盤（起日當天的漲跌算進來）
//   相對大盤＝區間報酬 − 加權報酬指數同期報酬；族群＝成分股等權平均（期初等權、不每日再平衡），只算基準日與迄日都有價的成分
// 美股（2026-11-13）：Skill\us_rs_export.py 的 us_rs_panel.json.gz（schema us-rs-1：欄位同 tw-rs-1，currency USD、amt 百萬美元、bench＝SPY）
export const SCHEMA = 'tw-rs-1';
export const SCHEMAS = { tw: 'tw-rs-1', us: 'us-rs-1' };

// shortcut: 快取只在這個函式實例的記憶體、每個市場只留一份（台股面板解開約 14MB）；冷啟動就重讀一次
const MEMO = {};   // 市場 → {key, panel}；key＝來源＋mtime／版本，read()＝解完 gzip 的 JSON 文字（只在沒快取時呼叫）
export function load(key, read, market = 'tw') {
  const m = MEMO[market], want = SCHEMAS[market];
  if (m && m.key === key) return m.panel;
  const p = JSON.parse(String(read()));
  if (!p || !want || p.schema !== want || !Array.isArray(p.dates) || !Array.isArray(p.px)) throw new Error('面板格式不符（要 ' + want + '）');
  MEMO[market] = { key, panel: p };
  return p;
}
export const loaded = (key, market = 'tw') => !!MEMO[market] && MEMO[market].key === key;   // 呼叫端先問：快取裡已是這版就不必下載

const iso = (d) => d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
const ymd = (s) => String(s || '').replace(/-/g, '');

// 可選的範圍：起日最早＝面板第二個交易日（要有前一天當基準），迄日最晚＝面板最後一天
export function range(p) {
  return { min: iso(p.dates[1]), max: iso(p.dates[p.dates.length - 1]) };
}

// 快捷鈕的起日：迄日往回一段再加一天（基準剛好落在一段之前那天收盤）；今年以來＝1/1。'1w'｜'1m'｜'3m'｜'ytd'
export function presetStart(max, k) {
  if (k === 'ytd') return max.slice(0, 4) + '-01-01';
  const d = new Date(max + 'T00:00:00Z');
  if (k === '1w') d.setUTCDate(d.getUTCDate() - 7);
  else {
    const day = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() - (k === '3m' ? 3 : 1));
    if (d.getUTCDate() !== day) d.setUTCDate(0);   // 3/31 往回一月會溢位成 3/3 → 改成 2 月最後一天
  }
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// 起日往後吸到交易日、迄日往前吸；不合法回 {error}
export function snap(p, start, end) {
  const ds = p.dates, s = ymd(start), e = ymd(end), rg = range(p);
  if (s < ymd(rg.min) || e > ymd(rg.max)) return { error: '日期要在 ' + rg.min + ' ～ ' + rg.max + ' 之間' };
  if (s > e) return { error: '起日晚於迄日' };
  let i = 0;
  while (i < ds.length && ds[i] < s) i++;
  let j = ds.length - 1;
  while (j >= 0 && ds[j] > e) j--;
  if (i > j) return { error: '這段期間沒有交易日' };
  return { i, j };
}

const r4 = (x) => Math.round(x * 1e4) / 1e4;   // 百分點留兩位小數
const byRel = (a, b) => (a.rel === null || b.rel === null ? (a.rel === null) - (b.rel === null) : b.rel - a.rel);   // 強到弱，沒值的排最後

// opt：{start, end（YYYY-MM-DD）, minAmt（元，日均成交值門檻）, n（前後各幾名）}
export function compute(p, { start, end, minAmt = 5e7, n = 20 }) {
  const sn = snap(p, start, end);
  if (sn.error) return { error: sn.error };
  const { i, j } = sn, b = i - 1;
  const tr = (p.bench_tr[j] / p.bench_tr[b] - 1) * 100;
  const px = (p.bench_px[j] / p.bench_px[b] - 1) * 100;
  const grpOf = {};
  for (const [g, mem] of Object.entries(p.groups || {})) for (const c of mem) (grpOf[c] = grpOf[c] || []).push(g);
  const rows = {};   // 代號 → 該檔結果（基準日與迄日都有價才有）
  const minM = minAmt / 1e6, all = [];
  for (let k = 0; k < p.codes.length; k++) {
    const a = p.px[k][b], z = p.px[k][j];
    if (!(a > 0) || !(z > 0)) continue;
    let s = 0;
    for (let t = i; t <= j; t++) s += p.amt[k][t] || 0;
    const ret = (z / a - 1) * 100, c = p.codes[k];
    const r = { code: c, name: p.names[k], mkt: p.mkt[k], ret: r4(ret), rel: r4(ret - tr), avgAmt: Math.round((s / (j - i + 1)) * 10) / 10, groups: grpOf[c] || [] };
    rows[c] = r;
    if (r.avgAmt >= minM) all.push(r);
  }
  all.sort(byRel);
  const groups = Object.entries(p.groups || {}).map(([name, mem]) => {
    const ms = mem.map((c) => rows[c]).filter(Boolean).sort(byRel);
    const avg = (f) => (ms.length ? r4(ms.reduce((x, m) => x + m[f], 0) / ms.length) : null);
    return { name, rel: avg('rel'), ret: avg('ret'), n: ms.length, total: mem.length, members: ms };
  }).sort(byRel);
  return {
    start: iso(p.dates[i]), end: iso(p.dates[j]), base: iso(p.dates[b]), days: j - i + 1,
    bench: { tr: r4(tr), px: r4(px) }, groups,
    strong: all.slice(0, n), weak: all.slice(-n).reverse(),
    universe: { eligible: all.length, total: Object.keys(rows).length },
    range: range(p), through: iso(p.through), groups_ver: p.groups_ver,
  };
}
