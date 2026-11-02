// /api/report 單元測試：stub Blob 與 DB，不連任何外部服務。JWT_SECRET 用測試假值。
// 跑法：node --test tests/report-route.test.mjs（需 Node 22.15+，用 module.registerHooks）
import { registerHooks } from 'node:module';
import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

// 測試狀態由各 test 設定，stub 從 globalThis 讀
const state = (globalThis.__reportTest = {});
const STUBS = {
  '@vercel/blob': `
    const s = globalThis.__reportTest;
    export const get = async (p) => { s.gotPath = p; if (s.getThrows) throw new Error(s.getThrows);
      return s.html == null ? null : { stream: new Response(s.html).body }; };
    export const head = async () => { if (!s.taReady) throw new Error('nope'); return {}; };
    export const put = async () => { throw new Error('測試不准寫 Blob'); };`,
  '@neondatabase/serverless': `
    export const neon = () => async () => (globalThis.__reportTest.taAllowed ? [{}] : []);`,
};
registerHooks({
  resolve(spec, ctx, next) {
    if (STUBS[spec]) return { url: 'stub:' + spec, shortCircuit: true };
    // 專案用無副檔名相對路徑（Next 打包才認得），這裡補 .js
    if (spec.startsWith('.') && !/\.\w+$/.test(spec)) return next(spec + '.js', ctx);
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url.startsWith('stub:')) return { format: 'module', source: STUBS[url.slice(5)], shortCircuit: true };
    // 專案沒有 type:module，.js 要當 ESM 載入
    if (/\/(lib|app)\/.*\.js$/.test(url)) return { ...next(url, { ...ctx, format: 'module' }), format: 'module' };
    return next(url, ctx);
  },
});

process.env.JWT_SECRET = 'test-only-dummy-secret';
process.env.DATABASE_URL = 'postgres://stub';

let POST, signJwt, J, streamJson, signTaTicketCheck;
before(async () => {
  ({ POST } = await import('../app/api/report/route.js'));
  ({ signJwt } = await import('../lib/jwt.js'));
  ({ J, streamJson } = await import('../lib/cors.js'));
  ({ verifyTaTicket: signTaTicketCheck } = await import('../lib/ta.js'));
});
beforeEach(() => { for (const k of Object.keys(state)) delete state[k]; });

const call = (body) => POST(new Request('http://x/api/report', { method: 'POST', body: JSON.stringify(body) }));
const token = (extra) => signJwt({ sub: 'M001', wm: 'WM-TEST', exp: Math.floor(Date.now() / 1000) + 3600, ...extra }, process.env.JWT_SECRET);

test('streamJson：位元組、狀態、標頭都和 J 相同（含跨塊切開的多位元組字）', async () => {
  const data = { ok: true, allow: true, html: 'a中文😀"\\\n'.repeat(40000), watermark: '浮水印', memberId: '' };
  const [a, b] = [J(data), streamJson(data)];
  const chunks = [];
  for await (const c of b.body) chunks.push(c);
  assert.ok(chunks.length > 1 && chunks.every((c) => c.length <= 64 * 1024), '要真的分塊');
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(await a.arrayBuffer()));
  assert.equal(b.status, a.status);
  assert.deepEqual(Object.fromEntries(b.headers), Object.fromEntries(a.headers));
});

test('成功路徑真的走串流：大報告分多塊送', async () => {
  state.html = '報告'.repeat(100000);
  const chunks = [];
  for await (const c of (await call({ reportId: '免費_x_20260101' })).body) chunks.push(c);
  assert.ok(chunks.length > 1);
});

test('未登入：need-login，走 J，不碰 Blob', async () => {
  const r = await (await call({ reportId: '付費_美股分析_20261030' })).json();
  assert.deepEqual(r, { ok: true, allow: false, reason: 'need-login', error: '請重新登入' });
  assert.equal(state.gotPath, undefined);
});

test('假票：need-login', async () => {
  const bad = signJwt({ sub: 'M001' }, 'other-secret');
  assert.equal((await (await call({ reportId: '付費_美股分析_20261030', token: bad })).json()).reason, 'need-login');
});

test('缺 reportId', async () => {
  assert.deepEqual(await (await call({})).json(), { ok: false, error: '缺 reportId' });
});

test('找不到報告', async () => {
  state.html = null;
  const r = await (await call({ reportId: '免費_不存在_20260101' })).json();
  assert.deepEqual(r, { ok: true, allow: true, error: '找不到這份報告：免費_不存在_20260101' });
});

test('Blob 讀取失敗', async () => {
  state.getThrows = 'boom';
  const r = await (await call({ reportId: '免費_x_20260101' })).json();
  assert.deepEqual(r, { ok: true, allow: true, error: '讀取報告失敗：boom' });
});

test('付費：{{WATERMARK}} 全部換成逐人浮水印', async () => {
  state.html = '<body>{{WATERMARK}}中間{{WATERMARK}}</body>';
  const res = await call({ reportId: '付費_綜合_20261030.html', token: token() });
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('content-length'), null);
  assert.deepEqual(await res.json(), { ok: true, allow: true, html: '<body>WM-TEST中間WM-TEST</body>', watermark: 'WM-TEST', memberId: 'M001' });
  assert.match(state.gotPath, /^reports\/付費_綜合_20261030~[0-9a-f]{16}\.html$/);
});

test('免費：通用戳記帶日期、不用票、memberId 空', async () => {
  state.html = '<p>{{WATERMARK}}</p>';
  const r = await (await call({ reportId: '免費_台股分析_20261027' })).json();
  const wm = '免費版 · Yoda Research · 2026-10-27';
  assert.deepEqual(r, { ok: true, allow: true, html: `<p>${wm}</p>`, watermark: wm, memberId: '' });
});

test('TA：名單內且資料齊 → 注入 ta-pick，票有效；既有標籤先拿掉', async () => {
  state.html = '<body>x<script src="old/ta-pick.js"></script></body>';
  state.taAllowed = state.taReady = true;
  const r = await (await call({ reportId: '付費_美股分析_20261030', token: token() })).json();
  assert.equal(r.html.match(/ta-pick\.js/g).length, 1);
  assert.ok(!r.html.includes('old/ta-pick.js'));
  assert.ok(r.html.includes('data-ta-rid="付費_美股分析_20261030"'));
  assert.ok(r.html.indexOf('ta-pick.js') < r.html.indexOf('</body>'));
  assert.equal(signTaTicketCheck(r.html.match(/data-ta-k="([^"]+)"/)[1]).sub, 'M001');
});

test('TA：名單外 → 不注入且拿掉報告裡的標籤', async () => {
  state.html = '<body>x<script src="old/ta-pick.js"></script></body>';
  state.taAllowed = false; state.taReady = true;
  const r = await (await call({ reportId: '付費_台股分析_20261030', token: token() })).json();
  assert.equal(r.html, '<body>x</body>');
});

test('TA：非美台股報告不查名單、原樣回', async () => {
  state.html = '<body>x</body>';
  state.taAllowed = state.taReady = true;
  const r = await (await call({ reportId: '付費_綜合_20261030', token: token() })).json();
  assert.equal(r.html, '<body>x</body>');
});
