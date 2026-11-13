import { put as vput, get as vget, head as vhead } from '@vercel/blob';
import fs from 'fs';
import path from 'path';

// admin-put-data／ta-rs 用的 Blob put/get/head。正式站＝@vercel/blob 原樣。
// shortcut: 本機端到端測試用的假 Blob（NODE_ENV≠production 且設 TA_BLOB_LOCAL_DIR 才開，Vercel 上一律關）：檔案寫進那個資料夾；只支援這兩支路由用到的參數
const DIR = process.env.NODE_ENV !== 'production' && !process.env.VERCEL && process.env.TA_BLOB_LOCAL_DIR;
const file = (p) => path.join(DIR, ...String(p).split('/'));
const miss = () => Object.assign(new Error('BlobNotFoundError'), { name: 'BlobNotFoundError' });

export const put = DIR ? async (p, body) => {
  fs.mkdirSync(path.dirname(file(p)), { recursive: true });
  fs.writeFileSync(file(p), body);
  return { url: 'local:' + p, pathname: p };
} : vput;
export const get = DIR ? async (p) => (fs.existsSync(file(p)) ? { stream: fs.readFileSync(file(p)), blob: { pathname: p } } : null) : vget;
export const head = DIR ? async (p) => { if (!fs.existsSync(file(p))) throw miss(); return { size: fs.statSync(file(p)).size, pathname: p }; } : vhead;
