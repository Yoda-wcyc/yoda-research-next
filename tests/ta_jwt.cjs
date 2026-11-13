// /ta 長效登入票（2026-11-13）：aud:'ta' 票只有 /ta 的 API 收，報告／報告清單一律當無效票。跑法：node tests/ta_jwt.cjs（失敗 exit 1）
//  1. verifyJwt 預設拒收 aud:'ta'（＝/api/report、/api/report-list 的驗法），普通會員票照收；authOf（/api/ta-live、ta-idx、ta-rs）兩種都收
//  2. 兩支報告 API 的原始碼都是 verifyJwt(token, secret) 兩個參數（沒有偷開 allowAud）；全 repo 只有 lib/ta-live.js 開 allowAud（lib/jwt.js 只讀 opts.allowAud）
//  3. tokenExp：不傳 maxSec＝12 小時不變；30 天被權益到期日 23:59 台北截短；寬限期（到期日已過）只給 12 小時
//  4. renewTa（mock store）：普通票→換發 aud:'ta'、約 30 天；新的 TA 票不重發；過半壽命才重發；查會員失敗不續；wm＝現查會員重算
//  5. 寬限續票（11-13）：aud:'ta' 票過期 7 天內只有 /api/ta-live status 能換新票（現查付費＋開通，不過 → need-login）；
//     過期超過 7 天、查代號、/api/ta-idx、/api/ta-rs、報告式驗票一律拒；aud 白名單嚴格相等（['ta']、'TA'、'ta ' 都拒）
const fs = require("fs"), path = require("path"), assert = require("assert"), Mod = require("module");
const ROOT = path.join(__dirname, "..");
process.env.JWT_SECRET = "test-secret-only";
process.env.TA_MOCK_STORE = "1"; delete process.env.VERCEL; delete process.env.TA_MOCK_NCD;
const { transformSync } = require(path.join(ROOT, "node_modules", "next", "dist", "build", "swc"));
const opts = { jsc: { parser: { syntax: "ecmascript", jsx: false }, target: "es2020" }, module: { type: "commonjs" } };
const ld = (rel) => { const f = path.join(ROOT, "lib", rel), m = new Mod(f); m.filename = f; m.paths = Mod._nodeModulePaths(ROOT); m._compile(transformSync(fs.readFileSync(f, "utf8"), opts).code, f); require.cache[f] = m; m.loaded = true; return m.exports; };
const J = ld("jwt.js"), LV = ld("ta-live.js"), RT = ld("../app/api/ta-live/route.js");
process.env.TA_MOCK_ACCESS = "MTEST1:1";
const call = async (tok, body) => { const r = await RT.POST(new Request("http://t/api/ta-live", { method: "POST", headers: { authorization: "Bearer " + tok }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() }; };
let fails = 0;
async function t(name, fn) { try { await fn(); console.log("ok  ", name); } catch (e) { fails++; console.log("FAIL", name, "→", e && e.message); } }
const S = process.env.JWT_SECRET, now = () => Math.floor(Date.now() / 1000);
const req = (tok) => ({ headers: { get: (k) => (k.toLowerCase() === "authorization" ? "Bearer " + tok : null) } });

(async () => {
  const normal = J.signJwt({ sub: "MTEST1", wm: "W", iat: now(), exp: now() + 12 * 3600 }, S);
  const ta = J.signJwt({ sub: "MTEST1", wm: "W", iat: now(), exp: now() + 30 * 86400, aud: "ta" }, S);
  await t("報告式驗票（verifyJwt 不帶選項）：拒收 aud:'ta'，普通票照收", async () => {
    assert.strictEqual(J.verifyJwt(ta, S), null);
    assert.strictEqual(J.verifyJwt(ta, S, {}), null);
    assert.strictEqual(J.verifyJwt(ta, S, { allowAud: "report" }), null);
    assert.strictEqual(J.verifyJwt(normal, S).sub, "MTEST1");
  });
  await t("authOf（/ta API）：aud:'ta' 與普通票都收；過期、簽錯、沒 sub 不收", async () => {
    assert.strictEqual(LV.authOf(req(ta)).aud, "ta");
    assert.strictEqual(LV.authOf(req(normal)).sub, "MTEST1");
    assert.strictEqual(LV.authOf(req(J.signJwt({ sub: "X", exp: now() - 1, aud: "ta" }, S))), null);
    assert.strictEqual(LV.authOf(req(J.signJwt({ sub: "X", aud: "ta" }, "other"))), null);
    assert.strictEqual(LV.authOf(req(J.signJwt({ wm: "x", aud: "ta" }, S))), null);
    assert.strictEqual(J.verifyJwt(J.signJwt(null, S), S), null);   // payload 不是物件也不崩
  });
  await t("原始碼：報告／報告清單沒開 allowAud；全 repo 只有 lib/ta-live.js 開", async () => {
    for (const f of ["app/api/report/route.js", "app/api/report-list/route.js"]) {
      const s = fs.readFileSync(path.join(ROOT, f), "utf8");
      assert.ok(/verifyJwt\(body\.token, process\.env\.JWT_SECRET \|\| ''\)/.test(s) && !s.includes("allowAud"), f);
    }
    const hits = [];
    const scan = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!["node_modules", ".next", ".git", "tests"].includes(e.name)) scan(p); }
      else if (/\.(js|jsx|mjs|cjs|ts)$/.test(e.name) && /allowAud\s*:/.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(ROOT, p).replace(/\\/g, "/"));
    } };
    scan(ROOT);
    assert.deepStrictEqual(hits.sort(), ["lib/ta-live.js"]);
  });
  await t("tokenExp：預設 12 小時不變；30 天被到期日截短；寬限期 12 小時；沒到期日（內部帳號）吃 maxSec", async () => {
    const n = 1_800_000_000;   // 2027-01-15 08:00 UTC
    const d = (s) => new Date(s * 1000 + 8 * 3600e3).toISOString().slice(0, 10);
    assert.strictEqual(J.tokenExp({ next_charge_date: "2027-03-01" }, n), n + 12 * 3600);
    assert.strictEqual(J.tokenExp({ next_charge_date: "2027-03-01" }, n, 30 * 86400), n + 30 * 86400);
    const cut = J.tokenExp({ next_charge_date: "2027-01-20 00:00:00" }, n, 30 * 86400);
    assert.strictEqual(cut, Math.floor(new Date("2027-01-20T23:59:59+08:00").getTime() / 1000)); assert.strictEqual(d(cut), "2027-01-20");
    assert.strictEqual(J.tokenExp({ next_charge_date: "2027-01-10" }, n, 30 * 86400), n + 12 * 3600);   // 寬限期
    assert.strictEqual(J.tokenExp({ plan: "內部" }, n, 30 * 86400), n + 30 * 86400);
    assert.strictEqual(J.tokenExp(null, n), n + 12 * 3600);
  });
  await t("renewTa：普通票 → aud:'ta' 約 30 天；新 TA 票不重發；過半壽命重發；權益到期日截短", async () => {
    const tk = await LV.renewTa(J.verifyJwt(normal, S));
    const p = J.verifyJwt(tk, S, { allowAud: "ta" });
    assert.ok(p && p.aud === "ta" && p.sub === "MTEST1" && p.wm === "MTEST1 · mock" && Math.abs(p.exp - now() - 30 * 86400) < 5, JSON.stringify(p));
    assert.strictEqual(J.verifyJwt(tk, S), null, "換發的票不能開報告");
    assert.strictEqual(await LV.renewTa(p), "", "新的 TA 票不該重發");
    const half = { sub: "MTEST1", aud: "ta", iat: now() - 16 * 86400, exp: now() + 14 * 86400 };
    assert.ok(await LV.renewTa(half), "過半壽命要重發");
    process.env.TA_MOCK_NCD = new Date(Date.now() + 8 * 3600e3 + 3 * 86400e3).toISOString().slice(0, 10);
    const q = J.verifyJwt(await LV.renewTa(J.verifyJwt(normal, S)), S, { allowAud: "ta" });
    assert.ok(q.exp - now() < 4 * 86400 && q.exp - now() > 2 * 86400, "要被到期日截短：" + (q.exp - now()));
    delete process.env.TA_MOCK_NCD;
  });
  await t("renewTa：查會員失敗或不是付費會員 → 不續（回空字串、不丟例外）", async () => {
    const st = await LV.store(), orig = st.paidMember;
    st.paidMember = async () => { throw new Error("db down"); };
    assert.strictEqual(await LV.renewTa(J.verifyJwt(normal, S)), "");
    st.paidMember = async () => null;
    assert.strictEqual(await LV.renewTa(J.verifyJwt(normal, S)), "");
    st.paidMember = orig;
  });
  const ex = (days, extra) => J.signJwt({ sub: "MTEST1", wm: "W", iat: now() - 30 * 86400, exp: now() - days * 86400, aud: "ta", ...extra }, S);
  await t("寬限續票：過期 6 天的 TA 票 status → 現查後換新票（aud:'ta'、wm 重算）", async () => {
    const { status, j } = await call(ex(6), { action: "status" });
    assert.strictEqual(status, 200, JSON.stringify(j));
    const q = J.verifyJwt(j.token, S, { allowAud: "ta" });
    assert.ok(q && q.aud === "ta" && q.exp - now() > 29 * 86400 && q.wm === "MTEST1 · mock" && j.wm === q.wm, JSON.stringify(q));
  });
  await t("寬限續票：過期 8 天 → need-login；過期票查代號 → need-login（不碰引擎）", async () => {
    let r = await call(ex(8), { action: "status" });
    assert.strictEqual(r.status, 401); assert.strictEqual(r.j.reason, "need-login");
    r = await call(ex(1), { symbol: "2330", tf: "D" });
    assert.strictEqual(r.status, 401); assert.strictEqual(r.j.reason, "need-login");
    r = await call(ex(1), {});
    assert.strictEqual(r.status, 401);
  });
  await t("寬限只在 status：authOf（ta-idx／ta-rs 用）與報告式驗票都拒過期 TA 票；寬限不放普通票", async () => {
    assert.strictEqual(LV.authOf(req(ex(1))), null);
    assert.strictEqual(J.verifyJwt(ex(1), S), null);
    assert.strictEqual(J.verifyJwt(ex(1), S, { allowAud: "ta" }), null);
    assert.ok(LV.authOf(req(ex(1)), LV.TA_GRACE_SEC));
    assert.strictEqual(LV.authOf(req(ex(8)), LV.TA_GRACE_SEC), null);
    const oldNormal = J.signJwt({ sub: "MTEST1", iat: now() - 2 * 86400, exp: now() - 86400 }, S);
    assert.strictEqual(LV.authOf(req(oldNormal), LV.TA_GRACE_SEC), null);
    assert.strictEqual((await call(oldNormal, { action: "status" })).status, 401);
    for (const f of ["app/api/ta-idx/route.js", "app/api/ta-rs/route.js"]) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      assert.ok(/authOf\(req\)/.test(src) && !/TA_GRACE_SEC|graceSec/.test(src), f);
    }
  });
  await t("aud 白名單：['ta']、'TA'、'ta '、''、null 一律拒（含寬限）；沒 aud 的票不變", async () => {
    for (const aud of [["ta"], "TA", "ta ", "", null]) {
      const tk = J.signJwt({ sub: "MTEST1", iat: now(), exp: now() + 3600, aud }, S);
      assert.strictEqual(J.verifyJwt(tk, S, { allowAud: "ta" }), null, JSON.stringify(aud));
      assert.strictEqual(LV.authOf(req(tk)), null, JSON.stringify(aud));
      assert.strictEqual(LV.authOf(req(tk), LV.TA_GRACE_SEC), null, JSON.stringify(aud));
      assert.strictEqual(J.verifyJwt(tk, S), null, JSON.stringify(aud));
    }
    assert.strictEqual(J.verifyJwt(normal, S, { allowAud: "ta" }).sub, "MTEST1");
  });
  await t("寬限續票：不是付費會員／查會員出錯／沒開通 → need-login（不發票）", async () => {
    const st = await LV.store(), orig = st.paidMember;
    st.paidMember = async () => null;
    let r = await call(ex(2), { action: "status" });
    assert.strictEqual(r.status, 401); assert.strictEqual(r.j.reason, "need-login"); assert.ok(!r.j.token);
    st.paidMember = async () => { throw new Error("db down"); };
    r = await call(ex(2), { action: "status" });
    assert.strictEqual(r.status, 401);
    st.paidMember = orig;
    process.env.TA_MOCK_ACCESS = "MTEST1:0";
    r = await call(ex(2), { action: "status" });
    assert.strictEqual(r.status, 401); assert.strictEqual(r.j.reason, "need-login");
    r = await call(ta, { action: "status" });   // 沒過期的票沒開通 → 照舊 not-enabled
    assert.strictEqual(r.status, 403);
    process.env.TA_MOCK_ACCESS = "MTEST1:1";
  });
  await t("body 是 null 不丟例外（沒票 401）；頁面查代號／指數位階／區間強弱都走 call（need-login 先換票重試）", async () => {
    const r = await RT.POST(new Request("http://t/api/ta-live", { method: "POST", body: "null" }));
    assert.strictEqual(r.status, 401);
    const pg = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
    assert.ok(!/post\("\/api\/ta-(idx|rs)"|post\("\/api\/ta-live", \{ symbol/.test(pg));
    assert.ok(/call\("\/api\/ta-live", \{ symbol/.test(pg) && /call\("\/api\/ta-idx"/.test(pg) && /call\("\/api\/ta-rs"/.test(pg));
  });
  console.log(fails ? "\n" + fails + " FAIL" : "\nall ok");
  process.exit(fails ? 1 : 0);
})();
