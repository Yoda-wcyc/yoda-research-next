import { get, put, del, list } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 視覺控制台的樣式庫（雲端側）。以 CONSOLE_TOKEN 保護，跟主控台同一把鑰匙。
//
// 樣式存在 Blob：viz-styles/<name>.json；指派表是 viz-styles/assign.json。
// 本機那份正本在 Skill/tokens/，兩邊用 `python Skill/yoda_tokens.py pull|push` 同步。
// 真正把樣式寫進報告檔（apply）只能在本機做——雲端沒有那些 HTML。
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
      .map((b) => (b.pathname.match(/^viz-styles\/(.+)\.json$/) || [])[1])
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
  if (name) {
    const j = await readJson(safe(name));
    if (!j) return J({ error: '找不到樣式 ' + name }, 404);
    return J(j);
  }
  const [styles, assign] = await Promise.all([names(), readJson('assign')]);
  let reports = [];
  try {
    const { blobs } = await list({ prefix: 'viz-samples/' });
    reports = blobs
      .map((b) => {
        const f = (b.pathname.match(/^viz-samples\/(.+)$/) || [])[1];
        return f ? { file: f, kb: Math.round((b.size || 0) / 1024) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.file.localeCompare(b.file));
  } catch (e) {}
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
    const hit = PREF.find(([p]) => r.file.startsWith(p));
    const type = hit ? hit[1] : 'unknown';
    return { ...r, type, family: TYPE_FAMILY[type] || 'fmfb' };
  });
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
  await put(PREFIX + name + '.json', JSON.stringify(data, null, 2), {
    access: 'private', contentType: 'application/json; charset=utf-8', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60,
  });
  return J(isAssign ? { ok: true, assign: data } : { ok: true, name, styles: await names() });
}
