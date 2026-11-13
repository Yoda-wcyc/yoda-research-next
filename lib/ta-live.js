import crypto from 'crypto';
import { verifyJwt, signJwt, tokenExp } from './jwt';

// ====== 獨立技術分析網站（/ta，2026-11-08 Yoda 定）======
//
//   瀏覽器 ─(會員 JWT)─▶ /api/ta-live ─(X-TA-Engine-Key)─▶ ta-engine /api/engine（獨立 Vercel 專案，Python）─▶ Yahoo v8
//
// 誰能進：站長（OWNER_PUB_IDS，不看 ta_access、不限額度）；其他人＝登入票有效＋ta_access.enabled（每次呼叫都重查）。
// 額度：會員每天（台北日期）30 檔不同代號；同一檔換週期／均線組不算新的一檔；查無代號不扣。
// 報告裡的舊勾選鏈（ta-pick.js／ta-data／admin-put-ta／lib/ta.js）2026-11-09 已退役並刪除，技術分析只走這條。

// 站長＝plan「內部」且在 ta_access 裡有列的帳號（勾不勾都算；取消勾選只改 enabled、列還在）。
// 每次呼叫都向 Neon 現查（store().isOwner），所以這個常數空著站長也進得來、不吃額度。
// 這裡只是額外的寫死名單（pub_id，不是 email）：members 被 db-mirror 重灌的那幾秒，現查會查不到，填了就不受影響。
export const OWNER_PUB_IDS = [];

export const DAILY_MAX = 30;
export const TFS = ['1H', '4H', 'D', 'W'];
const ENGINE = (process.env.TA_ENGINE_URL || 'https://yoda-ta-engine.vercel.app').replace(/\/+$/, '');
// 代號：英數（可帶 . -）、期貨 ES=F／ES1!／/ES、指數 ^SOX，或 1～8 個中文字（小那、費半…）；認不認得由引擎決定（2026-11-10 加期貨）
const SYM_RE = /^(?:[\^\/]?[A-Z0-9][A-Z0-9.\-=!]{0,11}|[\u4e00-\u9fff]{1,8})$/;

// 本機測試用的假名單／假額度（絕不碰正式 Neon）：.env.local 設 TA_MOCK_STORE=1；Vercel 上一律關閉。
//   TA_MOCK_ACCESS="M001:1,M002:0"（pub_id:是否開通）、TA_MOCK_OWNER="OWNER01"（多加的測試站長）
const MOCK = process.env.TA_MOCK_STORE === '1' && !process.env.VERCEL;

export function owners() {
  return MOCK ? OWNER_PUB_IDS.concat(String(process.env.TA_MOCK_OWNER || '').split(',').filter(Boolean)) : OWNER_PUB_IDS;
}

// 額度用的代號鍵：2330 / 2330.TW / 2330.TWO 同一檔；BRK.B＝BRK-B；期貨 NQ1!／/NQ＝NQ=F（＝引擎回的 symbol.yahoo）。
// shortcut: 中文別名（小那）與純 NQ 的鍵跟 NQ=F 不同，額度滿時先打別名會多擋一次（查完記的是 NQ=F），要精準再請引擎提供別名表
export function symKey(s) {
  return String(s || '').trim().toUpperCase().replace(/\.(TW|TWO)$/, '').replace(/\./g, '-')
    .replace(/^\/([A-Z]+)$/, '$1=F').replace(/^([A-Z]+)1!$/, '$1=F');
}
export function cleanSym(s) {
  const u = String(s || '').trim().toUpperCase();
  return SYM_RE.test(u) ? u : '';
}

// 台北日期 yyyy-MM-dd（Vercel 跑 UTC）
export function todayTaipei() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// graceSec：只有 /api/ta-live 的 status 續票傳 TA_GRACE_SEC（aud:'ta' 票過期 7 天內仍可拿來換新票）；其他呼叫一律不傳＝過期就拒
export const TA_GRACE_SEC = 7 * 86400;
export function authOf(req, graceSec) {
  const h = req.headers.get('authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  const p = verifyJwt(tok, process.env.JWT_SECRET || '', graceSec ? { allowAud: 'ta', graceSec } : { allowAud: 'ta' });   // 全站只有這裡收 aud:'ta' 長效票
  return p && p.sub ? p : null;
}

// ───── 長效登入票（2026-11-13 Yoda：登入一次就不要再問帳號密碼）─────
// 頁面每次進來打 status；票還不是 aud:'ta'、或已過一半壽命 → 現查會員＋付費門（isPaidMember），
// 換發 {sub, wm, iat, exp, aud:'ta'}，exp＝min(30 天, 權益到期日 23:59 台北)，寬限期內只給 12 小時。
// 查不到／沒付費 → 不續（回 ''）；資料庫出錯：一般續票回 ''（舊票照用到它自己的 exp，不會因為 DB 抖一下把人踢出去）。
// force：票已過期（寬限 7 天內）一律現查重發——扣款日 23:59 票到期、到期日還沒往後推的那幾天，不用重新登入；
//   force 時資料庫出錯往外丟（route 回 503 暫時錯誤、頁面不清票），不能當成沒付費。
// wm 用現查會員重算（watermarkOf，store().paidMember 附上），不沿用舊票的。
// 開通與否仍由每次呼叫的 ta_access 現查把關；aud:'ta' 票開不了報告（lib/jwt.js verifyJwt 預設拒收）。
export const TA_MAX_SEC = 30 * 86400;
export async function renewTa(p, force) {
  const now = Math.floor(Date.now() / 1000);
  if (!force && p.aud === 'ta' && p.iat && p.exp && now - p.iat < (p.exp - p.iat) / 2) return '';
  try {
    const m = await (await store()).paidMember(String(p.sub));
    if (!m) return '';
    return signJwt({ sub: String(p.sub), wm: m.wm || p.wm || String(p.sub), iat: now, exp: tokenExp(m, now, TA_MAX_SEC), aud: 'ta' }, process.env.JWT_SECRET || '');
  } catch (e) { if (force) throw e; return ''; }
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
  // 續票用的假會員：一律算付費；TA_MOCK_NCD="2026-11-20" 模擬權益到期日（沒設＝不設上限，只吃 30 天）
  async paidMember(sub) { return { pub_id: sub, member_id: sub, status: 'active', next_charge_date: process.env.TA_MOCK_NCD || '', wm: sub + ' · mock' }; },
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
    // strict（只有過期票寬限續票傳）：出錯往外丟，不當成「不是」——不然 DB 抖一下就把人登出
    async isOwner(sub, strict) {
      try {
        const r = await sql`SELECT 1 FROM ta_access a JOIN members m ON m.member_id = a.member_id
          WHERE (a.member_id=${sub} OR a.pub_id=${sub} OR m.pub_id=${sub}) AND trim(m.plan) = '內部' LIMIT 1`;
        return r.length > 0;
      } catch (e) { if (strict) throw e; return false; }
    },
    // 續票：會員要在、而且是真付費（同 member-login 的付費門）；不是就回 null
    async paidMember(sub) {
      const { memberBySub, isPaidMember, watermarkOf } = await import('./auth');
      const m = await memberBySub(sub);
      return m && (await isPaidMember(m)) ? { ...m, wm: watermarkOf(m) } : null;
    },
    // 任何錯誤（含表不存在）一律當沒開通：寧可擋錯，不放錯（strict 同 isOwner：出錯往外丟）
    async allowed(sub, strict) {
      try {
        const r = await sql`SELECT 1 FROM ta_access WHERE enabled AND (member_id=${sub} OR pub_id=${sub}) LIMIT 1`;
        return r.length > 0;
      } catch (e) { if (strict) throw e; return false; }
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
