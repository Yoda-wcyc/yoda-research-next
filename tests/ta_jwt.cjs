// /ta 長效登入票（2026-11-13）：aud:'ta' 票只有 /ta 的 API 收，報告／報告清單一律當無效票。跑法：node tests/ta_jwt.cjs（失敗 exit 1）
//  1. verifyJwt 預設拒收 aud:'ta'（＝/api/report、/api/report-list 的驗法），普通會員票照收；authOf（/api/ta-live、ta-idx、ta-rs）兩種都收
//  2. 兩支報告 API 的原始碼都是 verifyJwt(token, secret) 兩個參數（沒有偷開 allowAud）；全 repo 只有 lib/ta-live.js 開 allowAud
//  3. tokenExp：不傳 maxSec＝12 小時不變；30 天被權益到期日 23:59 台北截短；寬限期（到期日已過）只給 12 小時
//  4. renewTa（mock store）：普通票→換發 aud:'ta'、約 30 天；新的 TA 票不重發；過半壽命才重發；查會員失敗不續
const fs = require("fs"), path = require("path"), assert = require("assert"), Mod = require("module");
const ROOT = path.join(__dirname, "..");
process.env.JWT_SECRET = "test-secret-only";
process.env.TA_MOCK_STORE = "1"; delete process.env.VERCEL; delete process.env.TA_MOCK_NCD;
const { transformSync } = require(path.join(ROOT, "node_modules", "next", "dist", "build", "swc"));
const opts = { jsc: { parser: { syntax: "ecmascript", jsx: false }, target: "es2020" }, module: { type: "commonjs" } };
const ld = (rel) => { const f = path.join(ROOT, "lib", rel), m = new Mod(f); m.filename = f; m.paths = Mod._nodeModulePaths(ROOT); m._compile(transformSync(fs.readFileSync(f, "utf8"), opts).code, f); require.cache[f] = m; m.loaded = true; return m.exports; };
const J = ld("jwt.js"), LV = ld("ta-live.js");
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
    assert.deepStrictEqual(hits.sort(), ["lib/jwt.js", "lib/ta-live.js"].sort());
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
    assert.ok(p && p.aud === "ta" && p.sub === "MTEST1" && p.wm === "W" && Math.abs(p.exp - now() - 30 * 86400) < 5, JSON.stringify(p));
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
  console.log(fails ? "\n" + fails + " FAIL" : "\nall ok");
  process.exit(fails ? 1 : 0);
})();
