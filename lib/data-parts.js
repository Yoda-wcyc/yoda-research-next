import crypto from 'crypto';

// 本機每天上傳的資料檔（2026-11-13 起：/ta「區間強弱」面板 tw_rs_panel.json.gz）→ 私有 Blob 分段存放。
// 為什麼分段：Vercel 函式請求體上限約 4.5MB，面板 gzip 後已 5MB 多且每天長大 → 切成 ≤3.5MB 一段，一段一個請求。
//   段：data/<name>/<ver>/part<i>.bin（i 從 0 起；ver 每版不同＝段永不覆寫別版）
//   指標：data/<name>/latest.json {ver, parts, through, bytes, sha256}——最後一段傳完、所有段讀回來接起來 sha256 對得上、through 不倒退才寫
// 純函式（只用 crypto），寫入端 app/api/admin-put-data、讀取端 app/api/ta-rs 共用；測試 tests/data_parts.cjs
export const SCHEMA_OF = { tw_rs_panel: 'tw-rs-1', us_rs_panel: 'us-rs-1' };   // 資料名 → 面板 schema（admin-put-data 組完最後一段時驗）
export const DATASETS = Object.keys(SCHEMA_OF);   // 白名單：只收這些名字（us＝2026-11-13 美股面板）
export const PART_MAX = 3_500_000;                // 每段原始位元組上限（base64＋gzip 包裝後仍在 4.2MB 護欄內）
export const PARTS_MAX = 20;

export const partPath = (name, ver, i) => 'data/' + name + '/' + ver + '/part' + i + '.bin';
export const latestPath = (name) => 'data/' + name + '/latest.json';
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;

// 驗一段上傳的 body（key 另驗）→ {meta, buf} 或 {error}
export function checkPart(b) {
  if (!b || typeof b !== 'object') return { error: 'body 要是物件' };
  if (!DATASETS.includes(b.name)) return { error: '不收這個資料名：' + String(b.name).slice(0, 40) };
  if (typeof b.ver !== 'string' || !/^\d{8}-[0-9a-f]{8,64}$/.test(b.ver)) return { error: 'ver 要是 YYYYMMDD-<hex>' };
  if (!isInt(b.parts, 1, PARTS_MAX)) return { error: 'parts 要是 1..' + PARTS_MAX };
  if (!isInt(b.part, 0, b.parts - 1)) return { error: 'part 要是 0..parts-1' };
  if (typeof b.through !== 'string' || !/^\d{8}$/.test(b.through)) return { error: 'through 要是 YYYYMMDD' };
  if (typeof b.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(b.sha256)) return { error: 'sha256 要是 64 位 hex' };
  if (!isInt(b.bytes, 1, b.parts * PART_MAX)) return { error: 'bytes 不合理' };
  if (typeof b.data !== 'string' || !b.data || b.data.length > Math.ceil(PART_MAX / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b.data)) return { error: 'data 要是 base64 且不超過 ' + PART_MAX + ' bytes' };
  const buf = Buffer.from(b.data, 'base64');
  if (!buf.length || buf.length > PART_MAX) return { error: '這段大小不合理：' + buf.length };
  return { meta: { name: b.name, ver: b.ver, part: b.part, parts: b.parts, through: b.through, bytes: b.bytes, sha256: b.sha256 }, buf };
}

// 各段大小（缺段＝null）是否湊得出 meta.bytes
export function partsComplete(sizes, meta) {
  return sizes.length === meta.parts && sizes.every((s) => Number.isInteger(s) && s > 0) && sizes.reduce((a, s) => a + s, 0) === meta.bytes;
}

// 依序接起來並驗 sha256 → Buffer；對不上回 null（呼叫端不得快取）
export function assemble(bufs, sha) {
  const all = Buffer.concat(bufs.map((b) => Buffer.from(b)));
  return sha256(all) === sha ? all : null;
}
