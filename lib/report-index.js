import { get, put, list } from '@vercel/blob';
import { reportIdFromPath } from './blob';

// 報告清單的靜態索引：reports/_index.json
//
// 為什麼要有它（2026-09-06）：Blob 的 list() 是「進階操作」，Hobby 每月只有 2,000 次，
// 而 /archive 頁與 hub 會員專區「每個訪客每次開頁」都 list() 一次 → 一個月幾千次 → 整個 Blob 被停用一個月。
// 改成：唯一會寫 reports/ 的兩個入口（admin-put-report／admin-del-report）順手維護這份索引，
// 所有清單路由改「讀一個檔」（簡單操作，額度 10,000，而且可以被 CDN 快取）。
//
// 自癒：索引不存在或壞掉時，rebuildIndex() 用一次 list() 重建並寫回；之後就不再 list()。
// 手動重建：POST /api/admin-index {key: ADMIN_KEY}（批量用別的方式上傳之後跑一次）。
//
// 已知取捨：兩個上傳同時發生會有「後寫蓋前寫」的機率（索引少一筆）；上傳向來是 Yoda 一個人循序做，
// 真的漏了跑一次重建就好。索引檔本身的路徑不符合 reportIdFromPath 的 ~hmac 格式，不會被當成報告。
const INDEX_PATH = 'reports/_index.json';
const OPTS = { access: 'private', contentType: 'application/json; charset=utf-8', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 };

async function readBlobText(pathname) {
  const r = await get(pathname, { access: 'private' });
  if (!r) return null;
  return await new Response(r.stream).text();   // get() 回 { stream }，同 /api/report 的讀法
}

function normalize(entries) {
  const seen = {};
  const out = [];
  for (const e of entries || []) {
    if (!e || !e.reportId || seen[e.reportId]) continue;
    seen[e.reportId] = 1;
    out.push({ reportId: String(e.reportId), uploadedAt: e.uploadedAt ? String(e.uploadedAt) : '', size: Number(e.size) || 0 });
  }
  out.sort((a, b) => {
    const da = (a.reportId.match(/(\d{8})/) || ['', '0'])[1];
    const db = (b.reportId.match(/(\d{8})/) || ['', '0'])[1];
    if (da !== db) return db.localeCompare(da);
    return b.reportId.localeCompare(a.reportId);
  });
  return out;
}

async function writeIndex(entries) {
  const doc = { builtAt: new Date().toISOString(), count: entries.length, entries };
  await put(INDEX_PATH, JSON.stringify(doc), OPTS);
  return doc;
}

// 用一次 list() 重建（只在索引不存在、壞掉、或手動要求時）
export async function rebuildIndex() {
  const { blobs } = await list({ prefix: 'reports/' });
  const entries = [];
  for (const b of blobs || []) {
    const id = reportIdFromPath(b.pathname);
    if (!id) continue;                       // _index.json 與其他非報告檔在這裡被濾掉
    entries.push({ reportId: id, uploadedAt: b.uploadedAt ? new Date(b.uploadedAt).toISOString() : '', size: b.size || 0 });
  }
  return writeIndex(normalize(entries));
}

// 讀索引；沒有就重建一次。回傳 { builtAt, count, entries:[{reportId, uploadedAt, size}] }
export async function readIndex() {
  try {
    const txt = await readBlobText(INDEX_PATH);
    if (txt) {
      const doc = JSON.parse(txt);
      if (doc && Array.isArray(doc.entries)) return doc;
    }
  } catch (e) { /* 走重建 */ }
  return rebuildIndex();
}

export async function upsertIndex(reportId, size) {
  const doc = await readIndex();
  const rest = doc.entries.filter((e) => e.reportId !== reportId);
  rest.push({ reportId, uploadedAt: new Date().toISOString(), size: Number(size) || 0 });
  return writeIndex(normalize(rest));
}

export async function removeIndex(reportId) {
  const doc = await readIndex();
  return writeIndex(normalize(doc.entries.filter((e) => e.reportId !== reportId)));
}
