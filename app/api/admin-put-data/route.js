import { J, preflight } from '../../../lib/cors';
import { put, head } from '../../../lib/data-blob';
import { checkPart, partsComplete, partPath, latestPath } from '../../../lib/data-parts';
import { gunzipSync } from 'zlib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() { return preflight(); }

// 本機每天上傳資料檔的一段到私有 Blob（2026-11-13；Skill\tw_rs_export.py --upload 呼叫）。以 ADMIN_KEY 保護，同 /api/admin-put-report。
//   POST  x-yoda-encoding: gzip，body＝gzip 過的 JSON {key, name, ver, part, parts, through, bytes, sha256, data(base64 這一段)}
//   → {ok, part, parts, done}；最後一段且所有段都到齊、大小合計＝bytes 才寫 latest.json（done:true）。不碰 reports/ 與報告索引。
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

    const sizes = await Promise.all(Array.from({ length: m.parts }, (_, i) =>
      head(partPath(m.name, m.ver, i)).then((h) => (h && h.size) || null, () => null)));
    if (!partsComplete(sizes, m)) return J({ ok: false, error: '段沒到齊或大小對不上，不更新 latest', sizes, bytes: m.bytes }, 409);
    const latest = { ver: m.ver, parts: m.parts, through: m.through, bytes: m.bytes, sha256: m.sha256, uploadedAt: new Date().toISOString() };
    await put(latestPath(m.name), JSON.stringify(latest), {
      access: 'private', contentType: 'application/json; charset=utf-8', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60,
    });
    return J({ ok: true, part: m.part, parts: m.parts, done: true, latest });
  } catch (e) {
    return J({ ok: false, error: 'Blob 上傳失敗：' + String((e && e.message) || e) }, 502);
  }
}
