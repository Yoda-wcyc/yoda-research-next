// /ta 登入後「Application error」回歸測試（2026-11-10）。跑法：node tests/ta_client_regress.cjs（失敗 exit 1）
//  1. public/sw.js：頁面一律先走網路（舊版先拿快取 → 舊頁面程式配新引擎資料 → overlays.gaps.forEach 崩潰）；
//     /_next/、/api/ 不經手；升版會清掉 yoda-v2 並重載開著的分頁。
//  2. app/ta/page.jsx：最近查過的 s／n 是物件時要收成字串（否則 React #31 整頁崩潰）；Boundary 出錯只顯示那一塊的錯誤摘要。
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const ROOT = path.join(__dirname, "..");
let fails = 0;
async function t(name, fn) { try { await fn(); console.log("ok  ", name); } catch (e) { fails++; console.log("FAIL", name, "→", e && e.message); } }

// ---------- 1. service worker ----------
function loadSW({ online = true, cached = {}, cacheNames = ["yoda-v2"] } = {}) {
  const L = {}, fetched = [], deleted = [], navigated = [];
  const store = { ...cached };
  const cache = { addAll: async () => {}, put: async (req, res) => { store[req.url] = res; } };
  const sb = {
    self: null, URL, Promise, console,
    caches: {
      open: async () => cache, keys: async () => cacheNames.concat("yoda-v3"),
      delete: async (k) => { deleted.push(k); return true; },
      match: async (req) => store[req.url],
    },
    fetch: async (req) => { fetched.push(req.url); if (!online) throw new TypeError("offline"); return { ok: true, body: "NET " + req.url, clone() { return this; } }; },
  };
  sb.self = {
    location: { origin: "https://site.test" },
    addEventListener: (k, fn) => { L[k] = fn; }, skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => [{ url: "https://site.test/ta", navigate: async (u) => { navigated.push(u); } }] },
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "public", "sw.js"), "utf8"), sb);
  const fire = async (url, { method = "GET", mode = "navigate" } = {}) => {
    let p = null;
    L.fetch({ request: { url, method, mode }, respondWith: (x) => { p = x; } });
    return p ? await p : "BYPASS";
  };
  const activate = async () => { let p; L.activate({ waitUntil: (x) => { p = x; } }); await p; };
  return { fire, activate, fetched, deleted, navigated };
}
const OLD = { body: "OLD cached /ta (page-eed625…js)" };

(async () => {
  await t("sw：/ta 有舊快取也先走網路", async () => {
    const s = loadSW({ cached: { "https://site.test/ta": OLD } });
    const r = await s.fire("https://site.test/ta");
    assert.strictEqual(r.body, "NET https://site.test/ta");
  });
  await t("sw：斷線才退回快取", async () => {
    const s = loadSW({ online: false, cached: { "https://site.test/ta": OLD } });
    assert.strictEqual(await s.fire("https://site.test/ta"), OLD);
  });
  await t("sw：/_next/ 程式檔、/api/、POST、外站都不經手", async () => {
    const s = loadSW({ cached: { "https://site.test/_next/static/chunks/app/ta/page-eed625fafa8085b7.js": OLD } });
    assert.strictEqual(await s.fire("https://site.test/_next/static/chunks/app/ta/page-eed625fafa8085b7.js", { mode: "no-cors" }), "BYPASS");
    assert.strictEqual(await s.fire("https://site.test/api/ta-live", { method: "GET", mode: "cors" }), "BYPASS");
    assert.strictEqual(await s.fire("https://site.test/api/ta-live", { method: "POST", mode: "cors" }), "BYPASS");
    assert.strictEqual(await s.fire("https://translate.googleapis.com/x.js", { mode: "no-cors" }), "BYPASS");
  });
  await t("sw：升版清掉 yoda-v2 並重載開著的分頁", async () => {
    const s = loadSW();
    await s.activate();
    assert.deepStrictEqual(s.deleted, ["yoda-v2"]);
    assert.deepStrictEqual(s.navigated, ["https://site.test/ta"]);
  });
  await t("sw：全新安裝（沒有舊快取）不重載", async () => {
    const s = loadSW({ cacheNames: [] });
    await s.activate();
    assert.deepStrictEqual(s.navigated, []);
  });

  // ---------- 2. page.jsx（用 next 內建 swc 轉成 CJS，不需另裝套件） ----------
  const { transformSync } = require(path.join(ROOT, "node_modules", "next", "dist", "build", "swc"));
  const opts = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "classic" } }, target: "es2020" }, module: { type: "commonjs" } };
  const src = 'const React = require("react");\n' + fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8")
    .replace('"../../lib/ta-trade"', JSON.stringify(path.join(ROOT, "lib", "ta-trade.js").replace(/\\/g, "/"))) + "\nexport { cleanRecent, readRecent, Boundary };\n";
  const Mod = require("module");
  const libSrc = transformSync(fs.readFileSync(path.join(ROOT, "lib", "ta-trade.js"), "utf8"), opts).code;
  const lib = new Mod(path.join(ROOT, "lib", "ta-trade.js")); lib.paths = Mod._nodeModulePaths(ROOT); lib._compile(libSrc, lib.id);
  require.cache[lib.id] = lib; lib.loaded = true;
  const m = new Mod(path.join(ROOT, "app", "ta", "page.cjs")); m.paths = Mod._nodeModulePaths(ROOT);
  m._compile(transformSync(src, opts).code, m.id);
  const P = m.exports;
  const React = require(path.join(ROOT, "node_modules", "react"));
  const { renderToString } = require(path.join(ROOT, "node_modules", "react-dom", "server"));

  await t("最近查過：物件 s／n 收成字串或丟掉", async () => {
    const got = P.cleanRecent([{ s: "2330", n: { zh: "x" } }, { s: { code: "2330" } }, { s: "NVDA" }, null, { x: 1 }, { s: "0050", n: "元大台灣50" }]);
    assert.deepStrictEqual(got, [{ s: "2330", n: "" }, { s: "NVDA", n: "" }, { s: "0050", n: "元大台灣50" }]);
    assert.deepStrictEqual(P.cleanRecent("2330"), []);
    assert.deepStrictEqual(P.cleanRecent({ s: "2330" }), []);
  });
  await t("最近查過：localStorage 壞值不崩", async () => {
    const st = {};
    globalThis.localStorage = { getItem: (k) => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); }, removeItem: (k) => { delete st[k]; } };
    for (const v of ['[{"s":"2330","n":{"zh":"x"}}]', '[{"s":{"code":"2330"}}]', "not json", "", '"str"', "{}"]) {
      st.yoda_ta_recent = v;
      const r = P.readRecent();
      assert.ok(Array.isArray(r) && r.every((x) => typeof x.s === "string" && typeof x.n === "string"), v);
    }
  });
  await t("Boundary：子元件丟例外 → 顯示『這一塊顯示失敗』與錯誤摘要", async () => {
    const st = P.Boundary.getDerivedStateFromError(new TypeError("(x.gaps || []).forEach is not a function"));
    const b = new P.Boundary({ reset: 1, children: null }); b.state = { ...b.state, ...st };
    const html = renderToString(b.render());
    assert.ok(html.includes("這一塊顯示失敗") && html.includes("forEach is not a function"), html);
    assert.strictEqual(P.Boundary.getDerivedStateFromProps({ reset: 2 }, { err: st.err, reset: 1 }).err, null);   // 新資料就重試
    assert.strictEqual(P.Boundary.getDerivedStateFromProps({ reset: 1 }, { err: st.err, reset: 1 }), null);
    const ok = renderToString(React.createElement(P.Boundary, { reset: 1 }, React.createElement("b", null, "child")));
    assert.ok(ok.includes("child"));
  });

  console.log(fails ? "FAILED " + fails : "all passed");
  process.exit(fails ? 1 : 0);
})();
