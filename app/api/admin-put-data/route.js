import { J, preflight } from '../../../lib/cors';
import { put, get } from '../../../lib/data-blob';
import { checkPart, partsComplete, assemble, partPath, latestPath } from '../../../lib/data-parts';
import { gunzipSync } from 'zlib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() { return preflight(); }

// 本機每天上傳資料檔的一段到私有 Blob（2026-11-13；Skill\tw_rs_export.py --upload 呼叫）。以 ADMIN_KEY 保護，同 /api/admin-put-report。
//   POST  x-yoda-encoding: gzip，body＝gzip 過的 JSON {key, name, ver, part, parts, through, bytes, sha256, data(base64 這一段)}
//   → {ok, part, parts, done}；最後一段且所有段都到齊、接起來 sha256 對得上、資料日不比現在 latest 舊（force:true 例外）才寫 latest.json（done:true）。不碰 reports/ 與報告索引。
export async function POST(req) {
  let body = {};
  try {
    if ((req.headers.get('x-yoda-encoding') || '').toLowerCase() === 'gzip') {
      body = JSON.parse(gunzipSync(Buffer.from(await req.arrayBuffer()), { maxOutputLength: 8e6 }).toString('utf8'));
    } else {
      body = await req.json();
    }
  } catch (e) {
    return J({ ok: false, error: '請求內容無法解析：' + String((e && e.message) || e) }, 400);
  }

  if (!process.env.ADMIN_KEY || !body || body.key !== process.env.ADMIN_KEY) {
    return J({ ok: false, error: '管理密碼錯誤' }, 403);
  }
  const c = checkPart(body);
  if (c.error) return J({ ok: false, error: c.error }, 400);
  const m = c.meta;

  try {
    await put(partPath(m.name, m.ver, m.part), c.buf, {
      access: 'private', contentType: 'application/octet-stream', addRandomSuffix: false, allowOverwrite: true,
    });
    if (m.part !== m.parts - 1) return J({ ok: true, part: m.part, parts: m.parts, done: false });

    // 所有段讀回來接起來驗 sha256 才換 latest：latest 永遠不會指到壞的一版
    const bufs = await Promise.all(Array.from({ length: m.parts }, (_, i) =>
      get(partPath(m.name, m.ver, i), { access: 'private', useCache: false })
        .then(async (r) => (r ? Buffer.from(await new Response(r.stream).arrayBuffer()) : null), () => null)));
    const sizes = bufs.map((b) => (b ? b.length : null));
    if (!partsComplete(sizes, m)) return J({ ok: false, error: '段沒到齊或大小對不上，不更新 latest', sizes, bytes: m.bytes }, 409);
    if (!assemble(bufs, m.sha256)) return J({ ok: false, error: '各段接起來 sha256 對不上，不更新 latest', sha256: m.sha256 }, 409);
    // 不准倒退：新 through 比現在 latest 舊 → 409（body.force===true 才放行）。latest 壞掉讀不懂＝當作沒有
    const cr = await get(latestPath(m.name), { access: 'private', useCache: false });
    let cur = null;
    try { cur = cr ? JSON.parse(await new Response(cr.stream).text()) : null; } catch (e) { cur = null; }
    if (cur && typeof cur.through === 'string' && m.through < cur.through && body.force !== true) {
      return J({ ok: false, error: '資料日比現在 latest 舊（' + m.through + ' < ' + cur.through + '），不倒退；要強制請帶 force:true', latest: cur }, 409);
    }
    const latest = { ver: m.ver, parts: m.parts, through: m.through, bytes: m.bytes, sha256: m.sha256, uploadedAt: new Date().toISOString() };
    await put(latestPath(m.name), JSON.stringify(latest), {
      access: 'private', contentType: 'application/json; charset=utf-8', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60,
    });
    return J({ ok: true, part: m.part, parts: m.parts, done: true, latest });
  } catch (e) {
    return J({ ok: false, error: 'Blob 上傳失敗：' + String((e && e.message) || e) }, 502);
  }
}
