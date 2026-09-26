import { get, put, list, BlobPreconditionFailedError } from '@vercel/blob';
import { reportIdFromPath } from './blob';

// 報告清單的靜態索引：reports/_index.json
//
// 為什麼要有它（2026-09-06）：Blob 的 list() 是「進階操作」，Hobby 每月只有 2,000 次，
// 而 /archive 頁與 hub 會員專區「每個訪客每次開頁」都 list() 一次 → 一個月幾千次 → 整個 Blob 被停用一個月。
// 改成：唯一會寫 reports/ 的兩個入口（admin-put-report／admin-del-report）順手維護這份索引，
// 所有清單路由改「讀一個檔」（簡單操作，額度 10,000，而且可以被 CDN 快取）。
//
// 自癒：索引不存在或壞掉時，rebuildIndex() 用 list() 重建並寫回；之後就不再 list()。
// 手動重建：POST /api/admin-index {key, rebuild:true}；只想先看差異、不寫回：{key, dryRun:true}。
//
// 併發（2026-09-26 改）：原本假設「上傳是一個人循序做，後寫蓋前寫的機率很低」，不成立。
// 索引檔的 CDN 快取 60 秒，循序每 10～28 秒傳一份，讀到的還是舊版，整份寫回就把前一筆蓋掉
// （09-26 批次 48 份只留下 13 份的新 uploadedAt）。現在的做法：
//   ① 讀-改-寫一律回源讀（useCache:false），同時拿 ETag；
//   ② 寫回帶 ifMatch，被別人搶先寫過就重讀重套，最多 6 次＋隨機退避；全失敗才 throw（上傳端回 indexed:false）；
//   ③ 索引還不存在時，第一次建立用 allowOverwrite:false，撞到別人剛建好的就改走重讀重套。
// 訪客讀清單照舊吃 CDN（readIndex()）；後台要看最新版帶 readIndex({fresh:true})。
// 索引檔本身的路徑不符合 reportIdFromPath 的 ~hmac 格式，不會被當成報告。
const INDEX_PATH = 'reports/_index.json';
const OPTS = { access: 'private', contentType: 'application/json; charset=utf-8', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 };
const MAX_TRY = 6;

// 讀索引原文＋ETag；fresh=true 繞過 Blob CDN 直接讀 origin。不存在回 null
async function readRaw(fresh) {
  const r = await get(INDEX_PATH, fresh ? { access: 'private', useCache: false } : { access: 'private' });
  if (!r) return null;
  return { text: await new Response(r.stream).text(), etag: (r.blob && r.blob.etag) || '' };   // get() 回 { stream, blob }，同 /api/report 的讀法
}

function parseDoc(text) {
  try {
    const doc = JSON.parse(text);
    return doc && Array.isArray(doc.entries) ? doc : null;
  } catch (e) { return null; }
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

// cur＝寫之前回源讀到的那份：有 ETag → ifMatch（沒人動過才寫得進去）；null → 第一次建立（已存在就失敗）；
// 讀得到但拿不到 ETag → 退回整份覆蓋（舊行為）
async function writeIndex(entries, cur) {
  const doc = { builtAt: new Date().toISOString(), count: entries.length, entries };
  const opts = !cur ? { ...OPTS, allowOverwrite: false } : cur.etag ? { ...OPTS, ifMatch: cur.etag } : OPTS;
  await put(INDEX_PATH, JSON.stringify(doc), opts);
  return doc;
}

// 被搶先：ifMatch 對不上，或第一次建立時別人已經建好（SDK 的錯誤沒設 name，要用 instanceof／訊息判斷）
function isConflict(e) {
  if (e instanceof BlobPreconditionFailedError) return true;
  return /precondition|already exists/i.test(String((e && e.message) || ''));
}
const backoff = (i) => new Promise((res) => setTimeout(res, 30 + Math.random() * 120 * (i + 1)));

// 用 list() 列出全部報告；一頁最多 1000 筆，超過要跟著 cursor 翻頁（原本只讀第一頁）
async function listReports() {
  const entries = [];
  let cursor;
  for (let page = 0; page < 100; page++) {
    const r = await list({ prefix: 'reports/', cursor });
    for (const b of (r && r.blobs) || []) {
      const id = reportIdFromPath(b.pathname);
      if (!id) continue;                       // _index.json 與其他非報告檔在這裡被濾掉
      entries.push({ reportId: id, uploadedAt: b.uploadedAt ? new Date(b.uploadedAt).toISOString() : '', size: b.size || 0 });
    }
    if (!r || !r.hasMore || !r.cursor) break;
    cursor = r.cursor;
  }
  return normalize(entries);
}

// 共用的「回源讀 → 算新內容 → 帶條件寫回」；被搶先就退避後重讀重套，最多 MAX_TRY 次
// build(doc) 回新的 entries；回 { use: doc } 表示不用寫、直接用現有那份
async function commit(build) {
  let last;
  for (let i = 0; i < MAX_TRY; i++) {
    const cur = await readRaw(true);
    const entries = await build(cur ? parseDoc(cur.text) : null);
    if (entries && entries.use) return entries.use;
    try {
      return await writeIndex(entries, cur);
    } catch (e) {
      // 第一次建立撞到別人剛建好的：錯誤型別不一定是 precondition，重讀看得到索引就當成被搶先
      const raced = isConflict(e) || (!cur && !!(await readRaw(true).catch(() => null)));
      if (!raced) throw e;
      last = e;
      await backoff(i);
    }
  }
  throw new Error('索引寫入連續 ' + MAX_TRY + ' 次被搶先，放棄（' + String((last && last.message) || last) + '）');
}

// 用 list() 重建（只在索引不存在、壞掉、或手動要求時）。寫回也帶 ifMatch：重建途中有人上傳就整輪重來
export async function rebuildIndex() {
  return commit(() => listReports());
}

// 讀索引；沒有就重建一次。回傳 { builtAt, count, entries:[{reportId, uploadedAt, size}] }
// 預設吃 Blob CDN（訪客路徑，最多落後 60 秒）；fresh:true 回源讀（後台剛上傳完要看到最新版）
export async function readIndex({ fresh = false } = {}) {
  try {
    const r = await readRaw(fresh);
    const doc = r && parseDoc(r.text);
    if (doc) return doc;
  } catch (e) { /* 走重建 */ }
  // 自癒：回源再看一次，真的沒有或壞掉才 list() 重建；同時有別人先建好了就直接用，不多花一次 list()
  return commit(async (d) => (d ? { use: d } : listReports()));
}

// 索引不存在或壞掉時，用 list() 當底（報告本體已先寫進／刪出 Blob，list 抓得到最新狀態）
const baseOf = async (doc) => (doc ? doc.entries : await listReports());

export async function upsertIndex(reportId, size) {
  return commit(async (doc) => {
    const rest = (await baseOf(doc)).filter((e) => e.reportId !== reportId);
    rest.push({ reportId, uploadedAt: new Date().toISOString(), size: Number(size) || 0 });
    return normalize(rest);
  });
}

export async function removeIndex(reportId) {
  return commit(async (doc) => normalize((await baseOf(doc)).filter((e) => e.reportId !== reportId)));
}

// 乾跑：list() 算出重建結果，跟目前索引（回源讀）比，不寫回、索引不存在也不自癒。
// uploadedAt 差在 toleranceSec 秒內的不列：upsert 記的是寫索引當下，本來就比 blob 上傳時間晚幾百毫秒
export async function diffIndex({ toleranceSec = 5 } = {}) {
  const cur = await readRaw(true);
  const doc = cur ? parseDoc(cur.text) : null;
  const now = normalize(doc ? doc.entries : []);
  const rebuilt = await listReports();
  const had = new Map(now.map((e) => [e.reportId, e]));
  const got = new Map(rebuilt.map((e) => [e.reportId, e]));
  const changed = [];
  let within = 0;
  for (const e of rebuilt) {
    const o = had.get(e.reportId);
    if (!o || o.uploadedAt === e.uploadedAt) continue;
    const d = (Date.parse(e.uploadedAt) - Date.parse(o.uploadedAt)) / 1000;
    if (Number.isFinite(d) && Math.abs(d) <= toleranceSec) { within++; continue; }
    changed.push({ rid: e.reportId, from: o.uploadedAt, to: e.uploadedAt, delta_s: Number.isFinite(d) ? Math.round(d) : null });
  }
  return {
    current_exists: !!cur, current_valid: !!doc, current_builtAt: doc ? String(doc.builtAt || '') : '',
    current_count: now.length, rebuilt_count: rebuilt.length,
    added: rebuilt.filter((e) => !had.has(e.reportId)).map((e) => e.reportId),
    removed: now.filter((e) => !got.has(e.reportId)).map((e) => e.reportId),
    uploadedAt_changed: changed, uploadedAt_tolerance_s: toleranceSec, uploadedAt_within_tolerance: within,
  };
}
