import { J, preflight } from '../../../lib/cors';
import { gunzipSync } from 'zlib';
import { TA_RID_RE, TA_PART_RE, writeTaPart } from '../../../lib/ta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function OPTIONS() { return preflight(); }

// 本機 ta_publish.py 上傳技術分析資料（一次一個分片或 summary）。ADMIN_KEY 保護。
//
//   body：{key, rid, part, data}
//     rid  ＝ 付費_美股分析_YYYYMMDD… 或 付費_台股分析_YYYYMMDD…（必須跟報告 id 一致）
//     part ＝ 'summary' 或 's000'..'s999'
//     data ＝ 物件，且 data.rid === rid
//   支援 x-yoda-encoding: gzip（body 是 gzip 過的那份 JSON，跟 admin-put-report 一樣）。
//   → {ok:true, rid, part, bytes}（bytes＝寫進 Blob 的 gzip 大小）
//
// 寫到私有 Blob ta/<rid>~<hmac16>/<part>.json.gz。
// ★刻意不跟 admin-put-report 合併：那支會自動補「付費_」前綴、會 upsertIndex，TA 分片混進去會變成會員報告清單的一筆。
// ★上傳順序由呼叫端保證：分片全部成功才傳 summary（summary 在＝資料齊全，/api/report 才會注入勾選模組）。
export async function POST(req) {
  let body = {};
  try {
    if ((req.headers.get('x-yoda-encoding') || '').toLowerCase() === 'gzip') {
      const buf = Buffer.from(await req.arrayBuffer());
      body = JSON.parse(gunzipSync(buf).toString('utf8'));
    } else {
      body = await req.json();
    }
  } catch (e) {
    return J({ ok: false, error: '請求內容無法解析：' + String((e && e.message) || e) });
  }

  if (!process.env.ADMIN_KEY || body.key !== process.env.ADMIN_KEY) return J({ ok: false, error: '管理密碼錯誤' }, 403);
  const rid = String(body.rid || '').trim();
  const part = String(body.part || '').trim();
  const data = body.data;
  if (!TA_RID_RE.test(rid)) return J({ ok: false, error: 'rid 格式不符（須為 付費_美股分析_YYYYMMDD 或 付費_台股分析_YYYYMMDD）' });
  if (!TA_PART_RE.test(part)) return J({ ok: false, error: "part 須為 'summary' 或 's000'..'s999'" });
  if (!data || typeof data !== 'object' || Array.isArray(data)) return J({ ok: false, error: 'data 必須是物件' });
  if (data.rid !== rid) return J({ ok: false, error: 'data.rid 與 rid 不一致' });

  try {
    const r = await writeTaPart(rid, part, data);
    return J({ ok: true, rid, part, bytes: r.bytes });
  } catch (e) {
    return J({ ok: false, error: 'Blob 上傳失敗：' + String((e && e.message) || e) });
  }
}
export async function GET() { return J({ ok: false, error: 'POST with admin key' }); }
