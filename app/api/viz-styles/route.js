import { get, put, del, list } from '@vercel/blob';
import { reportIdFromPath } from '../../../lib/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 視覺控制台的樣式庫（雲端側）。以 CONSOLE_TOKEN 保護，跟主控台同一把鑰匙。
//
// ★ 這裡（Vercel Blob）是樣式庫的唯一正本（2026-09-06 Yoda 定：跟主控台並列，桌機／筆電都從這裡拉）。
//   viz-styles/<name>.json；指派表 viz-styles/assign.json；每次存檔留 _history/<name>/<時間>.json 最近 20 版。
//   本機 Skill/tokens/ 只是工作副本：出報告／apply 前 `python Skill/yoda_tokens.py pull --token …`。
//   預覽對象＝Blob 上已發佈的付費報告（reports/）＋手動上傳的樣本（viz-samples/）。
const PREFIX = 'viz-styles/';

function auth(req) {
  const k = new URL(req.url).searchParams.get('k') || '';
  return process.env.CONSOLE_TOKEN && k === process.env.CONSOLE_TOKEN;
}
function J(o, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
function safe(name) {
  return String(name || '').replace(/\.json$/i, '').replace(/[^\w.\-]/g, '_').slice(0, 60);
}
async function readJson(name) {
  try {
    const r = await get(PREFIX + name + '.json', { access: 'private' });
    if (!r) return null;
    const txt = typeof r.text === 'function' ? await r.text() : String(r.body || '');
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}
async function names() {
  try {
    const { blobs } = await list({ prefix: PREFIX });
    return blobs
      .map((b) => (b.pathname.match(/^viz-styles\/([^/]+)\.json$/) || [])[1])   // 不含 _history/ 底下的
      .filter(Boolean)
      .filter((n) => n !== 'assign')
      .sort();
  } catch (e) {
    return [];
  }
}

// GET ?k=…                 → { styles:[名], assign:{}, reports:[樣本], types:[], typeFamily:{} }
// GET ?k=…&name=<樣式>      → 該樣式 JSON
export async function GET(req) {
  if (!auth(req)) return new Response('Not found', { status: 404 });
  const u = new URL(req.url);
  const name = u.searchParams.get('name');
  if (name && u.searchParams.get('history')) {
    try {
      const { blobs } = await list({ prefix: PREFIX + '_history/' + safe(name) + '/' });
      return J({ name: safe(name), versions: blobs.map((b) => ({ at: b.pathname.split('/').pop().replace('.json', ''), kb: Math.round((b.size || 0) / 1024) })).sort((a, b) => b.at.localeCompare(a.at)) });
    } catch (e) { return J({ name: safe(name), versions: [] }); }
  }
  if (name && u.searchParams.get('at')) {
    const j = await readJson('_history/' + safe(name) + '/' + u.searchParams.get('at').replace(/[^\w-]/g, ''));
    if (!j) return J({ error: '沒有這一版' }, 404);
    return J(j);
  }
  if (name) {
    const j = await readJson(safe(name));
    if (!j) return J({ error: '找不到樣式 ' + name }, 404);
    return J(j);
  }
  const [styles, assign] = await Promise.all([names(), readJson('assign')]);
  let reports = [];
  try {   // ① 已發佈的付費報告（reports/ 前綴）——線上真貨，不用上傳
    const { blobs } = await list({ prefix: 'reports/' });
    reports = blobs
      .map((b) => { const id = reportIdFromPath(b.pathname); return id ? { file: id, kind: 'published', kb: Math.round((b.size || 0) / 1024) } : null; })
      .filter(Boolean);
  } catch (e) {}
  try {   // ② 手動上傳的樣本（沒發佈成付費的類型：總經／AI泡沫／專題…）
    const { blobs } = await list({ prefix: 'viz-samples/' });
    reports = reports.concat(blobs
      .map((b) => { const f = (b.pathname.match(/^viz-samples\/(.+)$/) || [])[1]; return f ? { file: f, kind: 'sample', kb: Math.round((b.size || 0) / 1024) } : null; })
      .filter(Boolean));
  } catch (e) {}
  reports.sort((a, b) => b.file.localeCompare(a.file));   // 新日期在前
  const TYPE_FAMILY = {
    us_stock: 'fmfb', tw_stock: 'fmfb', mw: 'fmfb', hub: 'fmfb',
    md: 'apple', 'ai-bubble': 'apple', pro: 'apple', topic: 'apple',
    brief: 'brief', key: 'key', forecast: 'forecast', 'free-shell': 'shell',
  };
  const PREF = [
    ['美股分析', 'us_stock'], ['台股分析', 'tw_stock'], ['付費_市場觀察', 'mw'], ['市場觀察', 'mw'],
    ['總經', 'md'], ['AI泡沫', 'ai-bubble'], ['關鍵報告', 'key'], ['專題研究', 'topic'], ['使用手冊', 'topic'],
    ['簡報', 'brief'], ['個股分析', 'pro'], ['Yoda預測', 'forecast'], ['Yoda 研究報告中心', 'hub'],
    ['免費殼', 'free-shell'], ['免費_', 'free-shell'],
  ];
  reports = reports.map((r) => {
    const bare = r.file.replace(/^付費_/, '');            // 付費_美股分析_… → 美股分析
    const hit = PREF.find(([p]) => bare.startsWith(p));
    const type = hit ? hit[1] : 'unknown';
    return { ...r, type, family: TYPE_FAMILY[type] || 'fmfb' };
  });
  // 元素總覽永遠排第一（隨網站部署，不在 Blob）
  reports.unshift({ file: '__specimen__', type: 'specimen', family: 'fmfb', kb: 0 });
  return J({ styles, assign: assign || {}, reports, types: Object.keys(TYPE_FAMILY), typeFamily: TYPE_FAMILY });
}

// POST ?k=…&name=<樣式>            body = {style:{…}} 或直接是樣式物件 → 存檔
// POST ?k=…&name=assign            body = 指派表 → 存檔
// POST ?k=…&name=<樣式>&del=1      → 刪除
export async function POST(req) {
  if (!auth(req)) return new Response('Not found', { status: 404 });
  const u = new URL(req.url);
  const name = safe(u.searchParams.get('name'));
  if (!name) return J({ error: '缺少 name' }, 400);

  if (u.searchParams.get('del')) {
    if (name.startsWith('baseline')) return J({ error: 'baseline 是對照基準，不給刪' }, 400);
    try { await del(PREFIX + name + '.json'); } catch (e) {}
    return J({ ok: true, styles: await names() });
  }

  let body;
  try { body = await req.json(); } catch (e) { return J({ error: '內容無法解析' }, 400); }
  const isAssign = name === 'assign';
  const data = isAssign ? body : (body.style || body);
  if (!data || typeof data !== 'object') return J({ error: '內容不是物件' }, 400);
  if (!isAssign) {
    data.meta = data.meta || {};
    if (!data.meta.name) data.meta.name = name;
  }
  const body_ = JSON.stringify(data, null, 2);
  const opts = { access: 'private', contentType: 'application/json; charset=utf-8', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 };
  await put(PREFIX + name + '.json', body_, opts);
  // 歷史版本：Blob 沒有 git，自己留最近 20 版，可退回
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await put(PREFIX + '_history/' + name + '/' + stamp + '.json', body_, opts);
    const { blobs } = await list({ prefix: PREFIX + '_history/' + name + '/' });
    const old = blobs.map((b) => b.pathname).sort().slice(0, -20);
    if (old.length) await del(old);
  } catch (e) {}
  return J(isAssign ? { ok: true, assign: data } : { ok: true, name, styles: await names() });
}
