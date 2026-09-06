import { get, put, del, list } from '@vercel/blob';
import { gunzipSync } from 'zlib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 報告編輯器的文件儲存（雲端側，Blob）。CONSOLE_TOKEN 保護。
//
// 一份文件＝兩個檔：
//   editor/<slug>/original.html   上傳的原稿，只寫一次（左側唯讀對照）
//   editor/<slug>/state.json      { name, updatedAt, marks:[{id, idx, tag, before, after, approved, at, note}] }
// 右側的「編輯後」不整份存：只存每一處修改（marks），開啟時在瀏覽器把 marks 套回原稿。
// 好處：每次存檔幾 KB、不吃 4.5MB 請求上限、diff 標記天生就是資料本身。
//
// 上傳原稿可 gzip（x-yoda-encoding: gzip，body=gzip 過的 JSON {html}），同 admin-put-report。
// 額度：list() 只在編輯器開啟時 1 次；get/put 各算簡單/進階操作一次。
const PREFIX = 'editor/';
const OPTS = { access: 'private', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 };

function auth(req) {
  const k = new URL(req.url).searchParams.get('k') || '';
  return process.env.CONSOLE_TOKEN && k === process.env.CONSOLE_TOKEN;
}
function J(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function slugOf(name) {
  return String(name || '').replace(/\.html?$/i, '').replace(/[\\/]/g, '_').replace(/\.\./g, '_').trim().slice(0, 120);
}
async function readText(pathname) {
  try {
    const r = await get(pathname, { access: 'private' });
    if (!r) return null;
    return await new Response(r.stream).text();   // get() 回 { stream }
  } catch (e) { return null; }
}

// GET ?k=…                       → { docs:[{slug, updatedAt, kb, marks}] }
// GET ?k=…&name=<slug>&part=original → 原稿 HTML
// GET ?k=…&name=<slug>&part=state    → state.json
export async function GET(req) {
  if (!auth(req)) return new Response('Not found', { status: 404 });
  const u = new URL(req.url);
  const slug = slugOf(u.searchParams.get('name'));
  const part = u.searchParams.get('part') || 'state';
  try {
    if (!slug) {
      const { blobs } = await list({ prefix: PREFIX });
      const docs = {};
      for (const b of blobs || []) {
        const m = b.pathname.match(/^editor\/([^/]+)\/(original\.html|state\.json)$/);
        if (!m) continue;
        const d = docs[m[1]] || (docs[m[1]] = { slug: m[1], kb: 0, updatedAt: '' });
        if (m[2] === 'original.html') d.kb = Math.round((b.size || 0) / 1024);
        if (m[2] === 'state.json') d.updatedAt = b.uploadedAt ? new Date(b.uploadedAt).toISOString() : '';
      }
      return J({ docs: Object.values(docs).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
    }
    if (part === 'original' || part === 'final') {
      const html = await readText(PREFIX + slug + '/' + part + '.html');
      if (html === null) return new Response('找不到' + (part === 'final' ? '定稿' : '原稿') + '：' + slug, { status: 404 });
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    const txt = await readText(PREFIX + slug + '/state.json');
    if (txt === null) return J({ slug, name: slug, marks: [], updatedAt: '' });
    return J(JSON.parse(txt));
  } catch (e) {
    return J({ error: String((e && e.message) || e) }, 500);
  }
}

// POST ?k=…&name=<slug>&part=original   body={html}（可 gzip）→ 寫原稿（第一次上傳）
// POST ?k=…&name=<slug>&part=state      body=state → 寫 state.json
// POST ?k=…&name=<slug>&del=1           → 刪整份
export async function POST(req) {
  if (!auth(req)) return new Response('Not found', { status: 404 });
  const u = new URL(req.url);
  const slug = slugOf(u.searchParams.get('name'));
  if (!slug) return J({ error: '缺少 name' }, 400);
  try {
    if (u.searchParams.get('del')) {
      const { blobs } = await list({ prefix: PREFIX + slug + '/' });
      if (blobs && blobs.length) await del(blobs.map((b) => b.url));
      return J({ ok: true, deleted: slug });
    }
    let body = {};
    if ((req.headers.get('x-yoda-encoding') || '').toLowerCase() === 'gzip') {
      body = JSON.parse(gunzipSync(Buffer.from(await req.arrayBuffer())).toString('utf8'));
    } else {
      body = await req.json();
    }
    const part = u.searchParams.get('part') || 'state';
    if (part === 'original') {
      const html = String(body.html || '');
      if (!html) return J({ error: '缺少 html' }, 400);
      await put(PREFIX + slug + '/original.html', html, { ...OPTS, contentType: 'text/html; charset=utf-8' });
      const state = { slug, name: body.name || slug, updatedAt: new Date().toISOString(), marks: [] };
      await put(PREFIX + slug + '/state.json', JSON.stringify(state), { ...OPTS, contentType: 'application/json; charset=utf-8' });
      return J({ ok: true, slug, bytes: html.length });
    }
    if (part === 'final') {   // 雲端定稿：先存 Blob，回本機 `python Skill/yoda_tokens.py publish <slug>` 落地（存 reports\ → 閘門 → 推 Blob）
      const html = String(body.html || '');
      if (!html) return J({ error: '缺少 html' }, 400);
      await put(PREFIX + slug + '/final.html', html, { ...OPTS, contentType: 'text/html; charset=utf-8' });
      return J({ ok: true, slug, bytes: html.length, next: 'python "G:\\Yoda x Claude\\Skill\\yoda_tokens.py" publish --token <CONSOLE_TOKEN> ' + slug });
    }
    const state = body.state || body;
    state.slug = slug; state.updatedAt = new Date().toISOString();
    if (!Array.isArray(state.marks)) state.marks = [];
    await put(PREFIX + slug + '/state.json', JSON.stringify(state), { ...OPTS, contentType: 'application/json; charset=utf-8' });
    return J({ ok: true, slug, marks: state.marks.length, updatedAt: state.updatedAt });
  } catch (e) {
    return J({ error: '儲存失敗：' + String((e && e.stack) || e).slice(0, 500) }, 500);
  }
}
