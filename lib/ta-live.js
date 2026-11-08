import crypto from 'crypto';
import { verifyJwt } from './jwt';

// ====== 獨立技術分析網站（/ta，2026-11-08 Yoda 定）======
//
//   瀏覽器 ─(會員 JWT)─▶ /api/ta-live ─(X-TA-Engine-Key)─▶ ta-engine /api/engine（獨立 Vercel 專案，Python）─▶ Yahoo v8
//
// 誰能進：站長（OWNER_PUB_IDS，不看 ta_access、不限額度）；其他人＝登入票有效＋ta_access.enabled（每次呼叫都重查）。
// 額度：會員每天（台北日期）30 檔不同代號；同一檔換週期／均線組不算新的一檔；查無代號不扣。
// 跟報告的 ta-pick／ta-data（lib/ta.js）完全無關。

// 站長＝plan「內部」且在 ta_access 裡有列的帳號（勾不勾都算；取消勾選只改 enabled、列還在）。
// 每次呼叫都向 Neon 現查（store().isOwner），所以這個常數空著站長也進得來、不吃額度。
// 這裡只是額外的寫死名單（pub_id，不是 email）：members 被 db-mirror 重灌的那幾秒，現查會查不到，填了就不受影響。
export const OWNER_PUB_IDS = [];

export const DAILY_MAX = 30;
export const TFS = ['1H', '4H', 'D', 'W'];
const ENGINE = (process.env.TA_ENGINE_URL || 'https://yoda-ta-engine.vercel.app').replace(/\/+$/, '');
const SYM_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;

// 本機測試用的假名單／假額度（絕不碰正式 Neon）：.env.local 設 TA_MOCK_STORE=1；Vercel 上一律關閉。
//   TA_MOCK_ACCESS="M001:1,M002:0"（pub_id:是否開通）、TA_MOCK_OWNER="OWNER01"（多加的測試站長）
const MOCK = process.env.TA_MOCK_STORE === '1' && !process.env.VERCEL;

export function owners() {
  return MOCK ? OWNER_PUB_IDS.concat(String(process.env.TA_MOCK_OWNER || '').split(',').filter(Boolean)) : OWNER_PUB_IDS;
}

// 額度用的代號鍵：2330 / 2330.TW / 2330.TWO 同一檔；BRK.B＝BRK-B
export function symKey(s) {
  return String(s || '').trim().toUpperCase().replace(/\.(TW|TWO)$/, '').replace(/\./g, '-');
}
export function cleanSym(s) {
  const u = String(s || '').trim().toUpperCase();
  return SYM_RE.test(u) ? u : '';
}

// 台北日期 yyyy-MM-dd（Vercel 跑 UTC）
export function todayTaipei() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function authOf(req) {
  const h = req.headers.get('authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  const p = verifyJwt(tok, process.env.JWT_SECRET || '');
  return p && p.sub ? p : null;
}

// ───── 名單＋額度儲存 ─────
const mockQuota = new Map();   // day|sub → Set(symKey)
const mockStore = {
  async allowed(sub) {
    for (const x of String(process.env.TA_MOCK_ACCESS || '').split(',')) {
      const [id, on] = x.split(':');
      if (id && id === sub) return on === '1';
    }
    return false;
  },
  // TA_MOCK_INTERNAL="X01"：假裝 plan「內部」且在 ta_access 有列（不管勾沒勾）
  async isOwner(sub) { return String(process.env.TA_MOCK_INTERNAL || '').split(',').includes(sub); },
  async used(sub, day) { return Array.from(mockQuota.get(day + '|' + sub) || []); },
  async add(sub, day, key) {
    const k = day + '|' + sub;
    if (!mockQuota.has(k)) mockQuota.set(k, new Set());
    mockQuota.get(k).add(key);
  },
};

let tableReady = false;
export function neonStore(sql) {
  const ensure = async () => {
    if (tableReady) return;
    await sql`CREATE TABLE IF NOT EXISTS ta_quota (
      day date NOT NULL, sub text NOT NULL, sym text NOT NULL, at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (day, sub, sym))`;
    tableReady = true;
  };
  return {
    // 站長：plan「內部」（同 lib/auth.js INTERNAL_PLAN）且 ta_access 有列，不看 enabled。查不到或出錯＝不是站長
    async isOwner(sub) {
      try {
        const r = await sql`SELECT 1 FROM ta_access a JOIN members m ON m.member_id = a.member_id
          WHERE (a.member_id=${sub} OR a.pub_id=${sub} OR m.pub_id=${sub}) AND trim(m.plan) = '內部' LIMIT 1`;
        return r.length > 0;
      } catch (e) { return false; }
    },
    // 任何錯誤（含表不存在）一律當沒開通：寧可擋錯，不放錯
    async allowed(sub) {
      try {
        const r = await sql`SELECT 1 FROM ta_access WHERE enabled AND (member_id=${sub} OR pub_id=${sub}) LIMIT 1`;
        return r.length > 0;
      } catch (e) { return false; }
    },
    async used(sub, day) {
      await ensure();
      const r = await sql`SELECT sym FROM ta_quota WHERE day=${day} AND sub=${sub}`;
      return r.map((x) => x.sym);
    },
    async add(sub, day, key) {
      await ensure();
      await sql`INSERT INTO ta_quota (day, sub, sym) VALUES (${day}, ${sub}, ${key}) ON CONFLICT DO NOTHING`;
    },
  };
}

export async function store() {
  if (MOCK) return mockStore;
  const { sql } = await import('./db');   // 動態載入：本機沒 DATABASE_URL 時 import 就會丟錯
  return neonStore(sql);
}

// ───── 呼叫引擎（含伺服器端快取）─────
// shortcut: 快取只在這個函式實例的記憶體，冷啟動或換實例就重抓；日K／週K 的「收盤後到下一盤前不重抓」由引擎自己的快取負責。
const CACHE = new Map();   // symKey|tf → {t, status, body}
const CACHE_MS = 15 * 60 * 1000, CACHE_MAX = 200;

// 引擎專用密鑰 TA_ENGINE_KEY（兩個 Vercel 專案設同一個值）；線路上只傳 HMAC 衍生值。沒設就不打引擎、回 502。
function engineKey() {
  const k = String(process.env.TA_ENGINE_KEY || '').trim();
  return k ? crypto.createHmac('sha256', k).update('ta-engine').digest('hex') : '';
}

export async function callEngine(sym, tf) {
  const ck = symKey(sym) + '|' + tf;
  const c = CACHE.get(ck);
  if (c && Date.now() - c.t < CACHE_MS) return { status: c.status, body: c.body, cached: true };
  const key = engineKey();
  if (!key) {
    console.error('[ta-live] TA_ENGINE_KEY 沒設，不呼叫計算引擎（回 502）');
    return { status: 502, body: { ok: false, error: { code: 'no_engine_key', message: '計算引擎設定有誤（金鑰沒設定）' } } };
  }
  let r, body;
  try {
    r = await fetch(ENGINE + '/api/engine?symbol=' + encodeURIComponent(sym) + '&tf=' + tf, {
      headers: { 'X-TA-Engine-Key': key }, cache: 'no-store', signal: AbortSignal.timeout(55000),
    });
    body = await r.json();
  } catch (e) {
    return { status: 502, body: { ok: false, error: { code: 'upstream', message: '計算引擎沒有回應' } } };
  }
  if (r.status === 401) console.error('[ta-live] 計算引擎回 401：兩邊的 TA_ENGINE_KEY 不一致，或引擎沒設 TA_ENGINE_KEY');
  if (r.status === 200 && body && body.ok) {
    CACHE.delete(ck);
    CACHE.set(ck, { t: Date.now(), status: 200, body });
    while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  }
  return { status: r.status, body };
}
