import { get, put, list, del } from '@vercel/blob';
import { gunzipSync } from 'zlib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 視覺控制台的預覽樣本報告（雲端側）。存在 Blob：viz-samples/<檔名>.html
//
// 這些是「拿來看版面」的副本，不是發佈用的報告，也不經過浮水印。
// 讀取要 CONSOLE_TOKEN（跟主控台同一把鑰匙）；上傳要 ADMIN_KEY。
// 上傳走 `python Skill/yoda_tokens.py push-samples`，支援 gzip（Vercel 請求上限 4.5MB）。
const PREFIX = 'viz-samples/';

function J(o, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
function safe(n) {
  return String(n || '').replace(/[\\/]/g, '_').replace(/\.\./g, '_').slice(0, 120);
}

export async function GET(req) {
  const u = new URL(req.url);
  if (!process.env.CONSOLE_TOKEN || (u.searchParams.get('k') || '') !== process.env.CONSOLE_TOKEN) {
    return new Response('Not found', { status: 404 });
  }
  const name = safe(u.searchParams.get('name'));
  if (!name) {
    try {
      const { blobs } = await list({ prefix: PREFIX });
      return J({ samples: blobs.map((b) => ({ file: b.pathname.slice(PREFIX.length), kb: Math.round((b.size || 0) / 1024) })) });
    } catch (e) {
      return J({ samples: [] });
    }
  }
  try {
    const r = await get(PREFIX + name, { access: 'private' });
    if (!r) return new Response('樣本不存在：' + name, { status: 404 });
    const html = typeof r.text === 'function' ? await r.text() : String(r.body || '');
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return new Response('讀取失敗：' + String((e && e.message) || e), { status: 500 });
  }
}

export async function POST(req) {
  let body = {};
  try {
    if ((req.headers.get('x-yoda-encoding') || '').toLowerCase() === 'gzip') {
      body = JSON.parse(gunzipSync(Buffer.from(await req.arrayBuffer())).toString('utf8'));
    } else {
      body = await req.json();
    }
  } catch (e) {
    return J({ ok: false, error: '請求內容無法解析：' + String((e && e.message) || e) }, 400);
  }
  if (!process.env.ADMIN_KEY || body.key !== process.env.ADMIN_KEY) {
    return J({ ok: false, error: '管理密碼錯誤' }, 403);
  }
  const name = safe(body.name);
  if (!name) return J({ ok: false, error: '缺少 name' }, 400);
  if (body.remove) {
    try { await del(PREFIX + name); } catch (e) {}
    return J({ ok: true, removed: name });
  }
  if (typeof body.html !== 'string' || !body.html) return J({ ok: false, error: '缺少 html' }, 400);
  const r = await put(PREFIX + name, body.html, {
    access: 'private', contentType: 'text/html; charset=utf-8', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60,
  });
  return J({ ok: true, name, bytes: body.html.length, pathname: r.pathname });
}
