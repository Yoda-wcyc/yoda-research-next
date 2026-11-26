// /ta 登入後「Application error」回歸測試（2026-11-10）。跑法：node tests/ta_client_regress.cjs（失敗 exit 1）
//  1. public/sw.js：頁面一律先走網路（舊版先拿快取 → 舊頁面程式配新引擎資料 → overlays.gaps.forEach 崩潰）；
//     /_next/、/api/ 不經手；升版會清掉 yoda-v2 並重載開著的分頁。
//     navigate 不能放在 activate 的 waitUntil 裡（真瀏覽器的導覽要等 SW activated → 互等 5 分鐘），測試裡 navigate 故意永不完成。
//  1b. components/PwaRegister.jsx：controllerchange 重載一次（原本沒 controller 不重載；30 秒內不重複）。
//  2. app/ta/page.jsx：最近查過的 s／n 是物件時要收成字串（否則 React #31 整頁崩潰）；Boundary 出錯只顯示那一塊的錯誤摘要；
//     chart.bars 不是陣列也不崩（標題列在 Boundary 外面算）。
//  3. 訊號篩選（11-10）：全部／只看多方／只看空方只篩顯示（記號、線、清單、統計），統計＝子集重算；localStorage 壞值回「全部」。
//  4. 期貨／費半（11-10）：市場標籤、換月標籤（rolls 缺、壞值都不崩）、沒有成交量（has_volume=false 或量全 null）→ 量柱、③ 前五大量、
//     規則面板寫「此標的沒有成交量」、量的條件不套用（不改面板存的參數）；lib/ta-live.js 代號格式（期貨、^SOX、中文別名）與額度鍵。
//  5. 台指期／費半期（11-10，期交所）：市場標籤「台灣期貨・TAIFEX」、symbol.tfs → 1H／4H 停用＋「期交所只有日資料」、
//     期交所讀不到的註記、費半期「^SOX 是指數版」；欄位缺／壞值不崩；代號 TXF1!／TX／台指期／SXF1!／費半期 收得進來。
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
    clients: { claim: async () => {}, matchAll: async () => [{ url: "https://site.test/ta", navigate: (u) => { navigated.push(u); return new Promise(() => {}); } }] },
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "public", "sw.js"), "utf8"), sb);
  const fire = async (url, { method = "GET", mode = "navigate" } = {}) => {
    let p = null;
    L.fetch({ request: { url, method, mode }, respondWith: (x) => { p = x; } });
    return p ? await p : "BYPASS";
  };
  // waitUntil 的 promise 必須自己完成（navigate 永不完成也一樣），之後再讓 microtask 跑完看有沒有重載
  const activate = async () => {
    let p; L.activate({ waitUntil: (x) => { p = x; } });
    const r = await Promise.race([p.then(() => "done"), new Promise((ok) => setTimeout(() => ok("HANG"), 300))]);
    assert.strictEqual(r, "done", "activate 的 waitUntil 卡住（navigate 被包進去了？）");
    await new Promise((ok) => setTimeout(ok, 20));
  };
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

  // ---------- 1b. PwaRegister.jsx ----------
  const { transformSync: swc } = require(path.join(ROOT, "node_modules", "next", "dist", "build", "swc"));
  const swcOpts = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "classic" } }, target: "es2020" }, module: { type: "commonjs" } };
  const pwaCode = swc(fs.readFileSync(path.join(ROOT, "components", "PwaRegister.jsx"), "utf8"), swcOpts).code;
  function runPwa({ controller, ss = {}, now = 1e12 }) {
    const L = {}, out = { reloads: 0, registered: 0, L };
    const sb = {
      exports: {}, Date: { now: () => now }, Number, String,
      require: (m) => { if (m === "react") return { useEffect: (f) => f() }; throw new Error("unexpected require " + m); },
      navigator: { serviceWorker: { controller, addEventListener: (k, f) => { L[k] = f; }, register: () => { out.registered++; return Promise.resolve(); } } },
      sessionStorage: ss && { getItem: (k) => (k in ss ? ss[k] : null), setItem: (k, v) => { ss[k] = String(v); } },
      location: { reload: () => { out.reloads++; } },
    };
    sb.module = { exports: sb.exports };
    vm.runInNewContext(pwaCode, sb);
    (sb.module.exports.default || sb.exports.default)();
    return out;
  }
  await t("PwaRegister：舊 SW 被換掉（controllerchange）→ 重載一次，30 秒內不重複", async () => {
    const ss = {};
    const a = runPwa({ controller: {}, ss });
    assert.strictEqual(a.registered, 1);
    a.L.controllerchange(); assert.strictEqual(a.reloads, 1);
    const b = runPwa({ controller: {}, ss, now: 1e12 + 5000 });   // 重載後新頁面又收到一次 → 不能再重載（防迴圈）
    b.L.controllerchange(); assert.strictEqual(b.reloads, 0);
    const c = runPwa({ controller: {}, ss, now: 1e12 + 60000 });  // 很久以後的下一次升版照樣重載
    c.L.controllerchange(); assert.strictEqual(c.reloads, 1);
  });
  await t("PwaRegister：全新安裝（原本沒有 controller）不重載；sessionStorage 不能用時不重載", async () => {
    const a = runPwa({ controller: null });
    a.L.controllerchange(); assert.strictEqual(a.reloads, 0);
    const b = runPwa({ controller: {}, ss: null });
    b.L.controllerchange(); assert.strictEqual(b.reloads, 0);
  });

  // ---------- 2. page.jsx（用 next 內建 swc 轉成 CJS，不需另裝套件） ----------
  const { transformSync } = require(path.join(ROOT, "node_modules", "next", "dist", "build", "swc"));
  const opts = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "classic" } }, target: "es2020" }, module: { type: "commonjs" } };
  const src = 'const React = require("react");\n' + fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8")
    .replace('"../../lib/ta-trade"', JSON.stringify(path.join(ROOT, "lib", "ta-trade.js").replace(/\\/g, "/")))
    .replace('"../../lib/ta-rs"', JSON.stringify(path.join(ROOT, "lib", "ta-rs.js").replace(/\\/g, "/")))
    .replace('"../../lib/ta-opt"', JSON.stringify(path.join(ROOT, "lib", "ta-opt.js").replace(/\\/g, "/")))
    .replace('"../../lib/ta-5stage"', JSON.stringify(path.join(ROOT, "lib", "ta-5stage.js").replace(/\\/g, "/")))
    .replace('"../../lib/ta-scenario"', JSON.stringify(path.join(ROOT, "lib", "ta-scenario.js").replace(/\\/g, "/")))
    .replace('"./WaveView"', JSON.stringify(path.join(ROOT, "app", "ta", "WaveView.jsx").replace(/\\/g, "/")))
    .replace('"./ShortView"', JSON.stringify(path.join(ROOT, "app", "ta", "ShortView.jsx").replace(/\\/g, "/")))
    .replace('"./SwingView"', JSON.stringify(path.join(ROOT, "app", "ta", "SwingView.jsx").replace(/\\/g, "/"))) + "\nexport { toggleFs, readPo, ScBtns, nextSc, ScTabs, ScPlan, scInfo, SC_TFS, readB5, readC5, barEndTf, co5Live, oldBuiltin, cleanRecent, readRecent, Boundary, headInfo, sideTrade, readSide, nextSide, Trade, BadBanner, noVolume, mktBadge, KChart, TopVolume, RulePanel, withTrade, fullSeries, TfTabs, FutInfo, RecentDrop, RsView, TtView, ttCols, readView, pastHalf, titleName, ChartArea, OptView, OptTry, optionCols, readOptSym, mtfBlink, tzMs, barEnd, readSr, readKk, keyKAll, dropOld4, maSetOf, pickMaSet, MA_SETS, Legend, migrateRules, cleanRules };\n";
  const Mod = require("module");
  const libSrc = transformSync(fs.readFileSync(path.join(ROOT, "lib", "ta-trade.js"), "utf8"), opts).code;
  const lib = new Mod(path.join(ROOT, "lib", "ta-trade.js")); lib.paths = Mod._nodeModulePaths(ROOT); lib._compile(libSrc, lib.id);
  require.cache[lib.id] = lib; lib.loaded = true;
  const rsLib = new Mod(path.join(ROOT, "lib", "ta-rs.js")); rsLib._compile(transformSync(fs.readFileSync(rsLib.id, "utf8"), opts).code, rsLib.id);   // page.jsx 也 import lib/ta-rs（區間強弱，11-13）
  require.cache[rsLib.id] = rsLib; rsLib.loaded = true;
  const optLib = new Mod(path.join(ROOT, "lib", "ta-opt.js")); optLib._compile(transformSync(fs.readFileSync(optLib.id, "utf8"), opts).code, optLib.id);   // 選擇權（11-23）
  require.cache[optLib.id] = optLib; optLib.loaded = true;
  const s5Lib = new Mod(path.join(ROOT, "lib", "ta-5stage.js")); s5Lib.filename = s5Lib.id; s5Lib.paths = Mod._nodeModulePaths(ROOT);   // 五階段（11-24）；filename＝它 require("./ta-trade") 才解得到
  s5Lib._compile(transformSync(fs.readFileSync(s5Lib.id, "utf8"), opts).code, s5Lib.id); require.cache[s5Lib.id] = s5Lib; s5Lib.loaded = true;
  const scLib = new Mod(path.join(ROOT, "lib", "ta-scenario.js")); scLib.filename = scLib.id; scLib.paths = Mod._nodeModulePaths(ROOT);   // 劇本（11-24）
  scLib._compile(transformSync(fs.readFileSync(scLib.id, "utf8"), opts).code, scLib.id); require.cache[scLib.id] = scLib; scLib.loaded = true;
  const wvMod = new Mod(path.join(ROOT, "app", "ta", "WaveView.jsx")); wvMod.filename = wvMod.id; wvMod.paths = Mod._nodeModulePaths(ROOT);   // 波浪分頁（11-24）
  wvMod._compile(transformSync(fs.readFileSync(wvMod.id, "utf8"), opts).code, wvMod.id); require.cache[wvMod.id] = wvMod; wvMod.loaded = true;
  const shLib = new Mod(path.join(ROOT, "lib", "ta-short.js")); shLib._compile(transformSync(fs.readFileSync(shLib.id, "utf8"), opts).code, shLib.id); require.cache[shLib.id] = shLib; shLib.loaded = true;   // 作空試算子分頁（11-26；測試在 tests/ta_short.cjs）
  const shMod = new Mod(path.join(ROOT, "app", "ta", "ShortView.jsx")); shMod.filename = shMod.id; shMod.paths = Mod._nodeModulePaths(ROOT);
  shMod._compile(transformSync(fs.readFileSync(shMod.id, "utf8"), opts).code, shMod.id); require.cache[shMod.id] = shMod; shMod.loaded = true;
  const swMod = new Mod(path.join(ROOT, "app", "ta", "SwingView.jsx")); swMod.filename = swMod.id; swMod.paths = Mod._nodeModulePaths(ROOT);   // 多空波段分頁（11-26；測試在 tests/ta_swing.cjs）
  swMod._compile(transformSync(fs.readFileSync(swMod.id, "utf8"), opts).code, swMod.id); require.cache[swMod.id] = swMod; swMod.loaded = true;
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
  await t("最近查過：改成輸入框下拉（11-13），點一筆就查；顯示代號＋名稱、反白、目前這檔", async () => {
    const picked = [];
    const el = P.RecentDrop({ items: [{ s: "2330", n: "" }, { s: "NVDA", n: "" }], hi: 1, cur: "2330", onPick: (s) => picked.push(s), onClear: () => {}, zh: { 2330: "台積電" } });
    const html = renderToString(el);
    assert.ok(html.includes("台積電") && html.includes('role="listbox"') && html.includes("清除紀錄"), html);
    assert.ok(html.includes('id="ta-dd-0"') && html.includes('id="ta-dd-1"'), "選項要有 id（輸入框 aria-activedescendant 指過去）");
    assert.ok(/class="ta-li on"[^>]*>.*2330/.test(html) && /aria-selected="true" class="ta-li hi"[^>]*>.*NVDA/.test(html), html);
    el.props.children[0][1].props.onClick(); assert.deepStrictEqual(picked, ["NVDA"]);
    let stopped = 0; el.props.onMouseDown({ preventDefault: () => stopped++ }); assert.strictEqual(stopped, 1, "mousedown 沒擋 → 輸入框 blur 先把清單收掉");
  });
  await t("最近查過下拉：台股用 zh 中文名（舊紀錄的英文名不顯示）、面板沒有的只顯示代號、美股照舊用 n；zh 沒拿到／壞值不崩", async () => {
    const items = [{ s: "2330", n: "Taiwan Semiconductor" }, { s: "00878", n: "Cathay ETF" }, { s: "NVDA", n: "NVIDIA Corporation" }, { s: "TXF1!", n: "台指期" }];
    const html = renderToString(P.RecentDrop({ items, hi: -1, cur: "", onPick: () => {}, onClear: () => {}, zh: { 2330: "台積電", "00878": { x: 1 } } }));
    assert.ok(html.includes("台積電") && html.includes("NVIDIA Corporation") && html.includes("台指期"), html);
    assert.ok(!html.includes("Taiwan Semiconductor") && !html.includes("Cathay") && html.includes("00878"), html);
    for (const zh of [null, undefined, {}]) {
      const h = renderToString(P.RecentDrop({ items, hi: 0, cur: "", onPick: () => {}, onClear: () => {}, zh }));
      assert.ok(h.includes(">2330<") && h.includes("NVIDIA Corporation") && !h.includes("Taiwan Semiconductor"), h);
    }
  });
  await t("標題列名稱（11-14）：台股有 zh 用中文名，沒有退回引擎名；美股、期貨不吃 zh；zh 沒拿到／壞值不崩", async () => {
    const zh = { 2330: "台積電", "0050": "元大台灣50", NVDA: "亂入", TXF1: "亂入", 2317: { x: 1 } };
    assert.strictEqual(P.titleName({ market: "tw", name: "TSMC" }, "2330", zh), "台積電");
    assert.strictEqual(P.titleName({ market: "tw", name: "Yuanta 50" }, "0050", zh), "元大台灣50");
    assert.strictEqual(P.titleName({ market: "tw", name: "Hon Hai" }, "2317", zh), "Hon Hai");
    assert.strictEqual(P.titleName({ market: "tw", name: "X" }, "9999", zh), "X");
    assert.strictEqual(P.titleName({ market: "us", name: "NVIDIA Corporation" }, "NVDA", zh), "NVIDIA Corporation");
    assert.strictEqual(P.titleName({ market: "fut", name: "台指期" }, "TXF1", zh), "台指期");
    for (const z of [null, undefined, {}]) assert.strictEqual(P.titleName({ market: "tw", name: "TSMC" }, "2330", z), "TSMC");
    assert.strictEqual(P.titleName({}, "2330", zh), "");
  });
  // ⛔ 2026-11-13 Yoda 永久刪除，不准重建：輸入框下的代號說明（台股打數字代號…指數只收 ^SOX）＋左欄底部「最近查過」清單
  await t("⛔ 輸入框代號說明、左欄底部最近查過清單已永久刪除", async () => {
    const raw = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
    for (const w of ["台股打數字代號", "指數只收", "美股打英文代號"]) assert.ok(!raw.includes(w), "page.jsx 又出現「" + w + "」");
    assert.ok(!/ta-rhead|ta-recent|>最近查過</.test(raw), "page.jsx 又出現底部最近查過區塊");
    // 換種寫法（{"最近查過"}、「最近查過：」小標）也擋：拿掉註解和下拉的 aria-label 之後，程式裡不准再出現這四個字
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1").replace('aria-label="最近查過"', "");
    assert.ok(!code.includes("最近查過"), "page.jsx 程式裡（註解與下拉 aria-label 以外）又出現「最近查過」字樣");
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

  await t("標題列：chart.bars 不是陣列／有壞元素、symbol 不是物件 → 不崩", async () => {
    for (const bars of [{}, "x", 5, null, [null, 3, { c: 10 }, { c: 11, final: false }]]) {
      const h = P.headInfo({ chart: { bars }, symbol: "2330" });
      assert.deepStrictEqual(h.symInfo, {});
    }
    assert.strictEqual(P.headInfo(null).lastB, undefined);
    const h = P.headInfo({ chart: { bars: [{ c: 100 }, { c: 110 }, { c: 120, final: false }] }, symbol: { code: "2330" } });
    assert.strictEqual(h.lastB.c, 110); assert.ok(Math.abs(h.chg - 10) < 1e-9); assert.strictEqual(h.unfB.c, 120); assert.strictEqual(h.symInfo.code, "2330");
  });

  // ---------- 3. 訊號篩選 ----------
  const lib3 = require(lib.id);
  const mk = (side, entry_i, exit_i, pct) => ({ side, entry_i, exit_i, entry: 100, exit_px: 100 + pct * side, stop: 90, entry_t: "e" + entry_i, exit_t: "x" + exit_i, pts: pct, pct, why: "停損", label: "停損" });
  const TT = [mk(1, 30, 35, 5), mk(-1, 40, 44, -2), mk(1, 50, 55, -3), mk(-1, 60, 62, 4), mk(-1, 70, 71, 1)];
  const OPEN = { side: 1, entry_i: 80, entry: 120, stop: 110, entry_t: "e80" };
  const base = { trades: TT, open: OPEN, stats: lib3.statsOf(TT, "s", "e", 100), banner: { bad: false }, ctx: {}, p: {} };
  const D = { tf: "D", trade: { ...base, ...lib3.chartMarks(base, 0) } };
  await t("訊號篩選：全部＝原樣；只看多方／空方的筆數、記號、持倉、統計子集", async () => {
    assert.strictEqual(P.sideTrade(D, "all"), D);
    const L = P.sideTrade(D, "long").trade, S = P.sideTrade(D, "short").trade;
    assert.strictEqual(L.trades.length, 2); assert.strictEqual(S.trades.length, 3);
    assert.ok(L.trades.every((x) => x.side === 1) && S.trades.every((x) => x.side === -1));
    assert.deepStrictEqual(S.trades.map((x) => x.no), [2, 4, 5]);   // # 仍是全期第幾筆
    assert.strictEqual(L.stats.n, 2); assert.strictEqual(L.stats.n_short, 0); assert.strictEqual(L.stats.wins, 1); assert.strictEqual(L.stats.sum_pct, 2);
    assert.strictEqual(S.stats.n, 3); assert.strictEqual(S.stats.n_long, 0); assert.strictEqual(S.stats.sum_pct, 3); assert.strictEqual(S.stats.start, "s"); assert.strictEqual(S.stats.bars, 100);
    assert.strictEqual(L.open, OPEN); assert.strictEqual(S.open, null);
    assert.strictEqual(L.markers.filter((m) => m.kind === "entry").length, 3);   // 2 筆＋持倉
    assert.strictEqual(S.markers.length, 6); assert.ok(!S.lines.some((x) => String(x.kind).startsWith("open_")));
    assert.strictEqual(L.sideLabel, "只看多方"); assert.strictEqual(S.sideNone, "空方");
    assert.strictEqual(D.trade.trades.length, 5);   // 原資料沒被改
    const html = renderToString(React.createElement(P.Trade, { d: P.sideTrade(D, "short") }));
    assert.ok(html.includes("只看空方：3 筆") && !html.includes("多 0"), html);
    assert.ok(renderToString(React.createElement(P.Trade, { d: D })).replace(/<!-- -->/g, "").includes("5（多 2／空 3）"));
  });
  await t("訊號篩選：沒有該方向 → 0 筆，① 顯示『區間內沒有空方訊號』", async () => {
    const only = TT.filter((x) => x.side === 1), b2 = { ...base, trades: only, stats: lib3.statsOf(only, "s", "e", 100) };
    const S = P.sideTrade({ tf: "D", trade: { ...b2, ...lib3.chartMarks(b2, 0) } }, "short");
    assert.strictEqual(S.trade.trades.length, 0); assert.strictEqual(S.trade.stats.n, 0); assert.strictEqual(S.trade.markers.length, 0);
    const html = renderToString(React.createElement(P.Trade, { d: S }));
    assert.ok(html.includes("區間內沒有空方訊號") && html.includes("只看空方：0 筆"), html);
    assert.strictEqual(P.sideTrade(null, "long"), null);
  });
  await t("訊號篩選：localStorage 壞值／不能用 → 全部", async () => {
    const st = {};
    globalThis.localStorage = { getItem: (k) => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); }, removeItem: (k) => { delete st[k]; } };
    for (const [v, want] of [["long", "long"], ["short", "short"], ["all", "all"], ["LONG", "all"], ["", "all"], ['"long"', "all"], ["null", "all"]]) {
      st.yoda_ta_side = v; assert.strictEqual(P.readSide(), want, v);
    }
    delete st.yoda_ta_side; assert.strictEqual(P.readSide(), "all");
    globalThis.localStorage = { getItem: () => { throw new Error("blocked"); } };
    assert.strictEqual(P.readSide(), "all");
    assert.strictEqual(P.sideTrade(D, "bogus"), D);
  });

  // ---------- 4. 期貨／費半 ----------
  const mkD = (o = {}) => {
    const n = o.n || 60, t = [], O = [], H = [], Lo = [], C = [], V = [];
    for (let i = 0; i < n; i++) {
      const c = 100 + 10 * Math.sin(i / 5) + (i >= 40 ? 6 : 0);   // 第 40 根往上跳（當作換月）
      t.push("2026-0" + (1 + Math.floor(i / 28)) + "-" + String(1 + (i % 28)).padStart(2, "0")); O.push(c - 0.5); H.push(c + 1); Lo.push(c - 1); C.push(c);
      V.push(o.noVol ? null : 1000 + (i % 3) * 800);
    }
    const bars = t.slice(-40).map((x, k) => ({ t: x, o: O[n - 40 + k], h: H[n - 40 + k], l: Lo[n - 40 + k], c: C[n - 40 + k], v: V[n - 40 + k], final: true }));
    const d = { tf: "D", bars_completed: n, history: { n, t, o: O, h: H, l: Lo, c: C, v: V },
      symbol: o.symbol || { market: "fut", exchange: "CME", type: "FUTURE", code: "NQ1!", yahoo: "NQ=F", contract: "Nasdaq 100 Dec 26" },
      chart: { bars, ma_sets: { short: [5, 10, 20] }, overlays: { sr: [], gaps: { cols: [], rows: [] }, islands: [] }, legend: [] }, signals: {} };
    if ("rolls" in o) d.chart.overlays.rolls = o.rolls;
    if ("hv" in o) d.has_volume = o.hv;
    return d;
  };
  const chartHtml = (d) => { const full = P.fullSeries(d); return renderToString(React.createElement(P.KChart, { d, full, smas: [], a: 0, b: full.bars.length, gaps: [], islands: [], top: [], rolls: g4(d) })); };
  const g4 = (d) => (Array.isArray(d.chart.overlays.rolls) ? d.chart.overlays.rolls : []);
  await t("框選放大（11-23）：框選框＋「起～迄，共 N 根」，不到 10 根框變灰；重設鈕、雙擊；滾輪縮放 11-24 取消：滾輪不改變可見區間、不攔頁面捲動", async () => {
    const d = mkD(), full = P.fullSeries(d);
    const h = renderToString(React.createElement(P.KChart, { d, full, smas: [], a: 10, b: 60, gaps: [], islands: [], top: [], rolls: [], brush: [20, 34] })).replace(/<!-- -->/g, "");
    assert.ok(/class="brush"[^>]*data-n="15"/.test(h) && h.includes(full.bars[20].t + "～" + full.bars[34].t + "，共 15 根"), "框選框與根數");
    const h2 = renderToString(React.createElement(P.KChart, { d, full, smas: [], a: 10, b: 60, gaps: [], islands: [], top: [], rolls: [], brush: [20, 25] }));
    assert.ok(/class="brush"[^>]*fill="#8b95a3"/.test(h2), "不到 10 根框變灰");
    assert.ok(!renderToString(React.createElement(P.KChart, { d, full, smas: [], a: 10, b: 60, gaps: [], islands: [], top: [], rolls: [] })).includes('class="brush"'), "沒框選不畫");
    const raw = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
    assert.ok(raw.includes('matchMedia("(pointer: fine)")') && raw.includes('e.pointerType !== "mouse"'), "只桌機（觸控不啟用）");
    assert.ok(raw.includes('onDoubleClick={fine ? reset : undefined}') && raw.includes(">重設</button>"), "雙擊、重設鈕");
    // 滾輪（11-24 取消縮放）：page.jsx 不掛任何 wheel 處理、不 preventDefault 滾輪 → 可見區間不變、頁面照常捲
    assert.ok(!/wheel/i.test(raw) && !raw.includes("passive: false") && !("zoomAt" in P), "不得再有滾輪處理（wheel／onWheel／passive:false／zoomAt）");
  });
  await t("撐壓線開關（11-23）：關掉不畫兩條線與右側「撐／壓」標籤、撐壓不再撐大座標；預設開；localStorage 只有 \"0\" 算關、不能用＝開", async () => {
    const d = mkD(), full = P.fullSeries(d), hi = Math.max(...full.bars.map((x) => x.h));
    d.signals = { sr_levels: { support: [{ price: full.bars[full.bars.length - 1].l }], resistance: [{ price: hi * 1.02 }] } };
    const kc = (o) => renderToString(React.createElement(P.KChart, { d, full, smas: [], a: 0, b: full.bars.length, gaps: [], islands: [], top: [], rolls: [], ...o })).replace(/<!-- -->/g, "");
    const on = kc({}), off = kc({ srOn: false });
    assert.ok((on.match(/class="sr-line/g) || []).length === 2 && on.includes(">撐 ") && on.includes(">壓 "), "預設開：兩條線＋標籤");
    assert.ok(!off.includes("sr-line") && !off.includes(">撐 ") && !off.includes(">壓 "), "關：線和標籤都不畫");
    const axMax = (h) => Math.max(...[...h.matchAll(/class="ax"[^>]*text-anchor="end">([\d.,]+)</g)].map((m) => Number(m[1].replace(/,/g, ""))));
    assert.ok(axMax(off) < axMax(on), "關掉後撐壓不再撐大價格軸");
    const st = {};
    globalThis.localStorage = { getItem: (k) => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); }, removeItem: (k) => { delete st[k]; } };
    assert.strictEqual(P.readSr(), true, "沒存過＝開");
    for (const [v, want] of [["0", false], ["1", true], ["", true], ["false", true]]) { st.yoda_ta_sr = v; assert.strictEqual(P.readSr(), want, v); }
    globalThis.localStorage = { getItem: () => { throw new Error("blocked"); } };
    assert.strictEqual(P.readSr(), true, "localStorage 不能用＝開");
    const raw = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
    assert.ok(raw.includes(">撐壓線</button>") && raw.includes("aria-pressed={srOn}") && raw.includes("srOn={srOn}"), "工具列按鈕接到圖");
  });
  await t("關鍵K（11-23）：大量 K＝之前 120 根前五大量；第一次收盤站上最高「破①↑」、跌破最低「破①↓」各只一次；框＋hover；開關記 localStorage；面板進場選項（沒量不可用）", async () => {
    // 30 根平盤（量 1000）→ 第 30 根爆量 9000（高 104、低 98）→ 第 36 根收 105 第一次站上 → 第 40 根又站上不算 → 第 45 根收 97 第一次跌破
    const n = 60, t = [], O = [], H = [], Lo = [], C = [], V = [];
    const put = (o, h, l, c, v) => { t.push("2026-0" + (1 + Math.floor(t.length / 28)) + "-" + String(1 + (t.length % 28)).padStart(2, "0")); O.push(o); H.push(h); Lo.push(l); C.push(c); V.push(v); };
    for (let i = 0; i < 30; i++) put(100, 100.5, 99.5, 100, 1000);
    put(100, 104, 98, 103, 9000);
    for (let i = 31; i < 36; i++) put(103, 103.4, 102, 103, 1000);
    put(103, 106, 102.5, 105, 1000);
    for (let i = 37; i < 39; i++) put(104, 104.3, 103.2, 103.5, 1000);
    put(103.5, 103.8, 103.1, 103.6, 1000);
    put(103.6, 106, 103.5, 105.5, 1000);
    for (let i = 41; i < 45; i++) put(102, 102.4, 101.5, 102, 1000);
    put(101, 101.2, 96, 97, 1000);
    while (t.length < n) put(97, 97.4, 96.6, 97, 1000);
    const d = { tf: "D", bars_completed: n, history: { n, t, o: O, h: H, l: Lo, c: C, v: V }, symbol: { market: "tw", yahoo: "2330.TW" },
      chart: { bars: [], ma_sets: { short: [5, 10, 20] }, overlays: { gaps: { cols: [], rows: [] }, islands: [] }, legend: [] }, signals: {} };
    const full = P.fullSeries(d), kk = P.keyKAll(full, n), ev30 = kk.ev.filter((e) => e.j === 30);
    assert.deepStrictEqual(ev30.map((e) => [e.k, e.dir, e.rank]), [[36, 1, 1], [45, -1, 1]], JSON.stringify(ev30));
    assert.ok(kk.cur.some((x) => x.j === 30 && x.rank === 1), "目前前五大量也框（第 30 根第 1 大）");
    assert.strictEqual(lib3.volMult(V, 30), 9, "量倍數＝÷前 20 根均量");
    const kc = (o) => renderToString(React.createElement(P.KChart, { d, full, smas: [], a: 0, b: n, gaps: [], islands: [], top: [], rolls: [], ...o })).replace(/<!-- -->/g, "");
    const on = kc({ kk }), off = kc({});
    assert.ok(/class="kk-box"[^>]*data-j="30"/.test(on) && on.includes("02/03 大量 K 最高 104 最低 98（量 9.0 倍）"), "第 30 根白框＋hover");
    assert.ok(/class="kk-b up"[^>]*data-k="36"[^>]*>破①↑<title>突破 02\/03 大量 K 最高 104（量 9.0 倍）<\/title>/.test(on), "第 36 根破①↑（紅）＋hover");
    assert.ok(/class="kk-b dn"[^>]*data-k="45"[^>]*>破①↓<title>跌破 02\/03 大量 K 最低 98（量 9.0 倍）<\/title>/.test(on), "第 45 根破①↓（綠）");
    assert.ok(!off.includes("kk-box") && !off.includes("kk-b"), "關掉不畫");
    // 進場選項：同一份事件 → 第 36 根多進（keyk），預設（均線排列）結果不變
    const pk = lib3.normParams({ entry: "keyk", stop: "pct", exit_ma: false, vol_exit: false }).p, r = lib3.backtest(d.history, n, pk);
    const all = r.trades.concat(r.open ? [r.open] : []), e0 = kk.ev.find((e) => e.k >= lib3.WARM);
    assert.ok(all.length && all[0].entry_i === e0.k && all[0].side === e0.dir && all.every((x) => kk.ev.some((e) => e.k === x.entry_i && e.dir === x.side)), "keyk：進場都在關鍵 K 事件那根、第一筆＝暖身後第一個事件");
    const ex = lib3.explainEntry(r, pk, all[0]);
    assert.ok(ex.rows[0][1].includes("大量 K 最") && !JSON.stringify(ex).match(/NaN|undefined/), JSON.stringify(ex));
    assert.strictEqual(lib3.normParams({}).p.entry, "ma"); assert.ok(lib3.normParams({ entry: "x" }).errors.entry);
    assert.ok(lib3.ruleText(pk).entry.startsWith("突破／跌破關鍵 K"), "規則文字");
    const draft = lib3.normParams({ entry: "keyk" }).p, props = { draft, set: () => {}, errors: {}, status: "", saved: [], active: null, nm: "", setNm: () => {}, rn: null, setRn: () => {}, msg: "" };
    const rp = renderToString(React.createElement(P.RulePanel, { ...props, noVol: false })), rpn = renderToString(React.createElement(P.RulePanel, { ...props, noVol: true }));
    assert.ok(rp.includes("突破／跌破關鍵 K") && /data-k="fresh_n" disabled=""/.test(rp) && /data-k="side_ma" disabled=""/.test(rp) && /data-k="vol_on" disabled=""/.test(rp), "選關鍵 K：排列／量比／同側停用");
    assert.ok(/disabled="" data-k="entry-keyk"/.test(rpn) && rpn.includes("此標的沒有成交量：突破／跌破關鍵 K 不可用"), "沒量：選項不可用");
    const st = {};
    globalThis.localStorage = { getItem: (k) => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); }, removeItem: (k) => { delete st[k]; } };
    assert.strictEqual(P.readKk(), true, "沒存過＝開");
    st.yoda_ta_kk = "0"; assert.strictEqual(P.readKk(), false);
    globalThis.localStorage = { getItem: () => { throw new Error("blocked"); } };
    assert.strictEqual(P.readKk(), true);
    const raw = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
    assert.ok(raw.includes(">關鍵K</button>") && raw.includes("aria-pressed={kkOn}") && raw.includes("kkOn={kkOn}") && raw.includes("kk={kk}"), "工具列按鈕接到圖");
  });
  await t("⛔ 四步永久刪（Yoda 11-24）：page.jsx／lib 不得再有「空方四步」「多方四步」「空1」「多1」標籤、ta-4step 匯入；舊 localStorage key 載入時刪", async () => {
    const files = [path.join(ROOT, "app", "ta", "page.jsx"), ...fs.readdirSync(path.join(ROOT, "lib")).filter((f) => /\.(js|jsx|mjs)$/.test(f)).map((f) => path.join(ROOT, "lib", f))];
    for (const f of files) {
      const x = fs.readFileSync(f, "utf8");
      for (const bad of ["空方四步", "多方四步", "空1", "多1", "ta-4step", "fourStep"]) assert.ok(!x.includes(bad), path.basename(f) + " 不該再有「" + bad + "」");
    }
    assert.ok(!fs.existsSync(path.join(ROOT, "lib", "ta-4step.js")), "lib/ta-4step.js 要刪掉");
    const st = { yoda_ta_s4: "1", yoda_ta_l4: "0", yoda_ta_b5: "1" };
    globalThis.localStorage = { getItem: (k) => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); }, removeItem: (k) => { delete st[k]; } };
    P.dropOld4();
    assert.deepStrictEqual(st, { yoda_ta_b5: "1" }, "只刪四步的兩個 key");
    globalThis.localStorage = { removeItem: () => { throw new Error("blocked"); } };
    P.dropOld4();   // localStorage 不能用不崩
    const raw = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
    assert.ok(raw.includes("useEffect(dropOld4, [])"), "載入時刪");
  });
  await t("反彈／修正五階段（11-24 二改）：圖上 1～5（反彈紅、修正綠，不再寫 彈1／修1）、出場 彈均／修均（空心框）、彈線／修線（同色系暗色）；支撐／防線虛線、停損階梯線；作廢不畫；與關鍵K 不重疊；共振外框；不進回測、共振 1H／4H", async () => {
    const raw = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8"), F5 = require.cache[s5Lib.id].exports;
    for (const fn of ["function withTrade", "function mtfBlink", "function RulePanel", "function sideTrade"]) {
      const i = raw.indexOf(fn), body = raw.slice(i, raw.indexOf("\nfunction ", i + 10));
      assert.ok(i >= 0 && !/fiveStage|b5On|c5On|co5/.test(body), fn + " 不該碰五階段");
    }
    const G = JSON.parse(fs.readFileSync(path.join(__dirname, "ta_5stage_nq4h.json"), "utf8")), n = G.bars.length, col = (k) => G.bars.map((x) => x[k]);
    const d = { tf: "4H", bars_completed: n, history: { n, t: col(0), o: col(1), h: col(2), l: col(3), c: col(4), v: col(5) }, symbol: { market: "fut", yahoo: "NQ=F" },
      chart: { bars: [], overlays: { gaps: { cols: [], rows: [] }, islands: [] }, legend: [] }, signals: {} };
    const full = P.fullSeries(d), fb = full.bars.slice(0, n), lines = F5.smaLines(fb, [5, 10, 20]), kk = P.keyKAll(full, n);
    const f5 = { s: F5.fiveStage(fb, lines, "s"), l: F5.fiveStage(fb, lines, "l"), lines, nm: ["SMA5", "SMA10", "SMA20"] };
    const a = n - 150, kc = (o) => renderToString(React.createElement(P.KChart, { d, full, smas: [], a, b: n, gaps: [], islands: [], top: [], rolls: [], onTip: () => {}, ...o })).replace(/<!-- -->/g, "");
    const off = kc({ kk }), on = kc({ kk, f5 });
    assert.ok(!off.includes("s5l") && !/data-step="[1-5]"/.test(off), "關掉不畫");
    assert.ok(/class="s4t"[^>]*style="fill:#ff5f6b"[^>]*data-side="s" data-step="5"[^>]*>5</.test(on), "反彈 5 紅");
    const ql = f5.l.find((q) => q.s1 && q.s1.i > 30), al = ql.s1.i - 30;   // 這段 NQ 最後 150 根沒有修正序列 → 另開一段有修正的
    const onL = renderToString(React.createElement(P.KChart, { d, full, smas: [], a: al, b: al + 150, gaps: [], islands: [], top: [], rolls: [], onTip: () => {}, kk, f5 })).replace(/<!-- -->/g, "");
    assert.ok(/class="s4t"[^>]*style="fill:#3fd08a"[^>]*data-side="l" data-step="1"[^>]*>1</.test(onL), "修正 1 綠");
    for (const m of (on + onL).matchAll(/class="s4t"[^>]*style="fill:(#[0-9a-f]+)"[^>]*data-side="(s|l)" data-step="([1-5])"[^>]*>([^<]*)</g)) {
      assert.strictEqual(m[4], m[3], "階段只寫數字：" + m[0].slice(0, 80));
      assert.strictEqual(m[1], m[2] === "s" ? "#ff5f6b" : "#3fd08a", "反彈紅、修正綠");
    }
    assert.ok(!/(彈|修)[1-5]/.test(on + onL), "圖上不得再出現 彈1／修1 這類字");
    assert.ok(/data-step="x"[^>]*>(彈|修)均</.test(on + onL) && /style="fill:#b07a80"[^>]*data-side="s" data-step="stop"|style="fill:#7a9e8c"[^>]*data-side="l" data-step="stop"/.test(on + onL), "出場 線＝同色系暗色");
    assert.ok(/aria-label="反彈五階段 ③ 反彈結束|aria-label="反彈五階段 [①-⑤] /.test(on), "aria 用 圈號＋階段名");
    assert.ok(/class="s5l"[^>]*stroke-dasharray="5 4"[^>]*data-kind="sup"/.test(on) && /class="s5l"[^>]*stroke="#b07a80"[^>]*data-kind="stop"/.test(on) && /class="s5l"[^>]*stroke="#f0a0a8"[^>]*data-kind="sup"/.test(on), "支撐虛線（淡紅）、停損階梯（暗紅）：反彈紅系");
    assert.ok(/class="s5l"[^>]*stroke="#7a9e8c"[^>]*data-kind="stop"/.test(onL) && /class="s5l"[^>]*stroke="#8fcfb0"[^>]*data-side="l"/.test(onL), "修正線綠系");
    assert.ok(!/>(彈|修)[①②③④⑤]</.test(on) && !/>(反彈|修正)\d</.test(on), "不寫 彈①／反彈1");
    assert.ok(/<rect[^>]*class="s4box"/.test(on) && /data-step="x"[^>]*>(彈|修)均</.test(on) && /data-step="stop"[^>]*>(彈|修)線</.test(on), "出場標籤 彈均／修均、彈線／修線（11-24 改名）");
    assert.ok(!/>(彈|修)(利|停)</.test(on), "舊名 彈利／彈停／修利／修停 不該再出現");
    const vis = (q) => [1, 2, 3, 4, 5].some((k) => q["s" + k] && q["s" + k].i >= a);
    const ids = new Set([...on.matchAll(/data-side="(s|l)" data-step="1" data-i="(\d+)"[^>]*>1</g)].map((m) => m[1] + m[2]));
    assert.ok(ids.size >= 1, "要有第 1 階段");
    for (const sd of ["s", "l"]) for (const q of F5.fiveStageAll(fb, lines, sd)) if (q.s1.i >= a && F5.HIDE5.includes(q.status)) assert.ok(!ids.has(sd + q.s1.i), "作廢不畫：" + sd + q.s1.i);
    assert.ok(f5.s.concat(f5.l).filter(vis).length >= 3, "區間內要有序列");
    const tw = (s) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 12 : 6.8), 0);
    const boxes = [...on.matchAll(/<text[^>]*class="(s4t[^"]*|kk-b[^"]*|kk-n)"[^>]*x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]+)</g)].map((m) => { const w = tw(m[4]) + (m[4].endsWith("均") ? 8 : 0); return [Number(m[2]) - w / 2, Number(m[3]) - 11, Number(m[2]) + w / 2, Number(m[3]) + 2, m[1] + ":" + m[4] + "@" + m[2] + "," + m[3]]; });
    const f5x = (x) => /:(彈|修)/.test(x[4]) || /^s4t[^:]*:[1-5]@/.test(x[4]);
    const f5n = boxes.filter(f5x).length;
    assert.ok(f5n >= 8, "五階段標籤數 " + f5n);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const p = boxes[i], q = boxes[j];
      if (!f5x(p) && !f5x(q)) continue;
      assert.ok(!(p[0] < q[2] && p[2] > q[0] && p[1] < q[3] && p[3] > q[1]), "重疊：" + p[4] + " ↔ " + q[4]);
    }
    // 共振外框：blink 指到的標記加 s5co 框（字本身不加 class，閃的是框）
    const q5 = f5.s.find((q) => q.s5 && q.s5.i >= a);
    const bl = kc({ kk, f5: { ...f5, blink: new Map([["s|5|" + q5.s5.i, { list: [{ id: "x" }], txt: "共振" }]]) } });
    assert.ok(/class="s5co"/.test(bl) && /class="s4t"[^>]*data-co="1"[^>]*>5</.test(bl) && /class="s5co"[^>]*stroke="#ff5f6b"/.test(bl), "共振外框同數字色：反彈紅框");
    assert.ok(raw.includes('(bl ? " ta-blink b-co5" : "")') && raw.includes('k === "short" || k === "mid"'), "短、中一起閃（紅，同共振框）");
    assert.ok(/\.ta-tab\.ta-blink\.b-co5\{--bc:#ff5f6b\}/.test(fs.readFileSync(path.join(ROOT, "app", "ta", "ta.css"), "utf8")), "b-co5＝#ff5f6b");
  });
  await t("市場標籤：美國期貨・CME／指數／台股／美股·NASDAQ·ETF；怪值不崩", async () => {
    assert.strictEqual(P.mktBadge({ market: "fut", exchange: "CME" }), "美國期貨・CME");
    assert.strictEqual(P.mktBadge({ market: "fut", exchange: "NYMEX" }), "美國期貨・NYMEX");
    assert.strictEqual(P.mktBadge({ market: "us", type: "INDEX", exchange: "Nasdaq" }), "指數");
    assert.strictEqual(P.mktBadge({ market: "tw", exchange: "Taipei Exchange" }), "台股·Taipei Exchange");
    assert.strictEqual(P.mktBadge({ market: "us", exchange: "NasdaqGS", type: "ETF" }), "美股·NasdaqGS·ETF");
    assert.strictEqual(P.mktBadge(null), ""); assert.strictEqual(P.mktBadge("x"), "");
  });
  await t("換月：rolls 在區間內 → 灰色虛線＋「換月」；沒有 rolls（舊回應）或壞值 → 照畫不崩", async () => {
    const html = chartHtml(mkD({ rolls: [{ i: 40, t: "2026-02-13", dir: "up", step_pct: 0.9, label: "換月" }] }));
    assert.ok(html.includes("換月") && html.includes('data-roll="2026-02-13"'), "沒畫換月");
    for (const r of [undefined, null, "x", [null, { i: "a" }, { i: 999 }, { i: -3 }]]) {
      const h = chartHtml(mkD(r === undefined ? {} : { rolls: r }));
      assert.ok(h.includes("<svg") && !h.includes("data-roll"), String(r));
    }
  });
  await t("沒有成交量：has_volume=false 或（舊回應）量全 null → 量區寫「此標的沒有成交量」；有量照舊", async () => {
    assert.strictEqual(P.noVolume(mkD({ hv: false })), true);
    assert.strictEqual(P.noVolume(mkD({ noVol: true })), true);
    assert.strictEqual(P.noVolume(mkD({})), false);
    assert.strictEqual(P.noVolume(mkD({ hv: true })), false);
    assert.strictEqual(P.noVolume({ chart: {} }), false); assert.strictEqual(P.noVolume(null), false);
    const h1 = chartHtml(mkD({ noVol: true, symbol: { market: "us", type: "INDEX" } }));
    assert.ok(h1.includes("此標的沒有成交量") && !h1.includes(">量<"), "量區沒換字");
    const h2 = chartHtml(mkD({}));
    assert.ok(!h2.includes("此標的沒有成交量") && h2.includes("量（口）"), "期貨量單位");
  });
  await t("沒有成交量：③ 前五大量顯示「此標的沒有成交量」；規則面板兩處提示、量的格子停用", async () => {
    const d = mkD({ noVol: true, hv: false });
    const tv = renderToString(React.createElement(P.TopVolume, { d, view: { a: 0, b: 60, from: "a", to: "b", top: [] } }));
    assert.ok(tv.includes("此標的沒有成交量"), tv);
    const draft = lib3.normParams({}).p, props = { draft, set: () => {}, errors: {}, status: "", saved: [], active: null, nm: "", setNm: () => {}, rn: null, setRn: () => {}, msg: "" };
    const on = renderToString(React.createElement(P.RulePanel, { ...props, noVol: true }));
    assert.strictEqual((on.match(/此標的沒有成交量：量的條件不套用/g) || []).length, 2, "提示要在量比進場、爆量出場兩處");
    assert.ok(/data-k="vol_on" disabled=""/.test(on) && /data-k="vol_exit" disabled=""/.test(on), "勾選框要停用");
    const off = renderToString(React.createElement(P.RulePanel, { ...props, noVol: false }));
    assert.ok(!off.includes("此標的沒有成交量") && !/disabled=""/.test(off));
  });
  await t("沒有成交量：回測與規則文字不套用量的條件，面板參數不改；有交易", async () => {
    const p = lib3.normParams({}).p;
    const w = P.withTrade(mkD({ noVol: true }), p);
    assert.strictEqual(w.trade.p.vol_on, false); assert.strictEqual(w.trade.p.vol_exit, false); assert.strictEqual(p.vol_on, true);
    assert.ok(w.rules.entry.includes("不看量") && !w.rules.exit.includes("爆量"), w.rules.entry);
    const raw = lib3.backtest(w.history, w.bars_completed, p), off = lib3.backtest(w.history, w.bars_completed, { ...p, vol_on: false, vol_exit: false });
    assert.deepStrictEqual(raw.trades.map((x) => [x.entry_i, x.exit_i, x.why]), off.trades.map((x) => [x.entry_i, x.exit_i, x.why]));
    assert.strictEqual(lib3.hasVolume([null, 0, NaN]), false); assert.strictEqual(lib3.hasVolume([null, 5]), true); assert.strictEqual(lib3.hasVolume([null, 5], 1), false);
    const w2 = P.withTrade(mkD({}), p);
    assert.strictEqual(w2.trade.p.vol_on, true);
  });
  await t("記號旁的字（多進／出場原因）滑過也出說明：帶 data-tip＋滑鼠事件、aria-hidden、不可 tab（11-13）", async () => {
    const w = P.withTrade(mkD({}), { ...lib3.normParams({}).p, vol_on: false, fresh_n: 1 });
    assert.ok(w.trade.trades.length > 0, "測資沒有交易");
    const tips = [];
    const full = P.fullSeries(w);
    const el = P.KChart({ d: w, full, smas: [], a: 0, b: full.bars.length, gaps: [], islands: [], top: [], rolls: [], onTip: (k, t) => tips.push(k) });
    const flat = [], walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && x.props) { flat.push(x); walk(x.props.children); } };
    walk(el);
    const labs = flat.filter((x) => x.type === "text" && /\bmk-lab\b/.test(x.props.className || ""));
    assert.ok(labs.some((x) => /\bte\b/.test(x.props.className)) && labs.some((x) => /\btx\b/.test(x.props.className)), "進場／出場字沒掛上");
    for (const x of labs) {
      assert.ok(x.props["data-tip"] && x.props["aria-hidden"] === "true" && x.props.tabIndex === undefined, JSON.stringify(Object.keys(x.props)));
      x.props.onMouseEnter({ clientX: 1, clientY: 1 });
    }
    assert.ok(tips.includes("entry") && tips.includes("exit"), tips.join());
  });
  await t("出場跟進場成對（11-17）：字寫多出／空出／多停損／空停損、✕＋字＋連線用進場色；每筆已平倉一條實線、持倉中不畫", async () => {
    const w = P.withTrade(mkD({}), { ...lib3.normParams({}).p, vol_on: false, fresh_n: 1 });
    const full = P.fullSeries(w), tr = w.trade.trades;
    const el = P.KChart({ d: w, full, smas: [], a: 0, b: full.bars.length, gaps: [], islands: [], top: [], rolls: [] });
    const flat = [], walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && x.props) { flat.push(x); walk(x.props.children); } };
    walk(el);
    const col = (s) => (s === 1 ? "#e0525e" : "#3fae7a"), txt = (x) => [].concat(x.props.children).join("");
    const tx = flat.filter((x) => x.type === "text" && /\btx\b/.test(x.props.className || ""));
    assert.ok(tx.length > 0 && tx.every((x) => /^(多出|空出|多停損|空停損) |^(多|空)(停損)? [\d.,]+→/.test(txt(x))), tx.map(txt).join("|"));
    assert.ok(!tx.some((x) => /^(出場|停損) /.test(txt(x))), "還有舊的「出場／停損」字");
    assert.ok(tx.some((x) => txt(x)[0] === "多") && tx.some((x) => txt(x)[0] === "空"), "測資要有多單也有空單");
    const links = flat.filter((x) => x.type === "line" && x.props.className === "trlink");
    assert.strictEqual(links.length, tr.length, "每筆已平倉一條線");
    assert.ok(!flat.some((x) => x.props.className === "trbox"), "淡色框要拿掉");
    for (const L of links) assert.ok(L.props.stroke === col(L.props["data-side"]) && L.props.strokeWidth === "2.5" && !L.props.strokeDasharray, JSON.stringify(L.props));
    for (const x of tx) assert.strictEqual(x.props.fill || (x.props.style && x.props.style.fill), col(txt(x).startsWith("多") ? 1 : -1), txt(x));
    // 持倉中：把最後一筆改成未平倉 → 線少一條
    if (tr.length) {
      const w2 = { ...w, trade: { ...w.trade, trades: tr.slice(0, -1), open: { side: tr.at(-1).side, entry: tr.at(-1).entry, entry_i: tr.at(-1).entry_i, entry_t: tr.at(-1).entry_t, stop: tr.at(-1).stop } } };
      const f2 = []; (function wk(x) { if (Array.isArray(x)) x.forEach(wk); else if (x && x.props) { f2.push(x); wk(x.props.children); } })(P.KChart({ d: w2, full, smas: [], a: 0, b: full.bars.length, gaps: [], islands: [], top: [], rolls: [] }));
      assert.strictEqual(f2.filter((x) => x.type === "line" && x.props.className === "trlink").length, tr.length - 1, "持倉中不該畫連線");
    }
  });
  await t("出場記號／字／連線（11-17 第三版）：多單賠、空單賺、停損都用進場色；連線兩端＝▲▼ 中心與 ✕ 中心；隔 ≤2 根併成一串；擠遠有引線", async () => {
    const d = mkD({}), c = d.history.c, WS = "停損";
    const mkT = (side, ei, xi, why) => ({ side, entry_i: ei, exit_i: xi, entry: c[ei], exit_px: c[xi], stop: c[ei] * (1 - 0.05 * side), entry_t: "e" + ei, exit_t: "x" + xi,
      pct: ((c[xi] / c[ei] - 1) * 100) * side, pts: (c[xi] - c[ei]) * side, why, label: why });
    const TR = [mkT(1, 5, 15, "破均線"), mkT(-1, 17, 24, "破均線"), mkT(-1, 31, 33, WS), mkT(1, 38, 47, WS), mkT(1, 49, 50, "破均線")];
    assert.ok(TR[0].pct < 0 && TR[1].pct > 0, "測資要有多單賠、空單賺");
    const base = { trades: TR, open: null };
    const w = { ...d, trade: { ...base, ...lib3.chartMarks(base, 0), p: {} } };
    const full = P.fullSeries(w);
    const flat = [], walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && x.props) { flat.push(x); walk(x.props.children); } };
    walk(P.KChart({ d: w, full, smas: [], a: 0, b: full.bars.length, gaps: [], islands: [], top: [], rolls: [] }));
    const col = (s) => (s === 1 ? "#e0525e" : "#3fae7a"), txt = (x) => [].concat(x.props.children).join("");
    const kid = (k, cls) => { const g = flat.find((x) => x.key === k); assert.ok(g, "找不到 " + k); return [].concat(g.props.children).find((x) => x && x.props && x.props.className === cls); };
    const M = (dd) => dd.match(/^M\s*([-\d.]+)\s+([-\d.]+)/).slice(1).map(Number);
    const lab = (cls, i) => flat.filter((x) => x.type === "text" && new RegExp("\\b" + cls + "\\b").test(x.props.className || "") && x.props["data-i"] === i);
    for (const tr of TR) {
      const s = tr.side, C = col(s), nm = JSON.stringify([tr.entry_i, tr.exit_i]);
      // ✕：進場色（不是賺賠色、不是白）
      const xp = kid("mx" + tr.exit_i, "mk-exit");
      assert.strictEqual(xp.props.stroke, C, "✕ 顏色 " + nm);
      // 連線：進場色實線，起點＝三角中心（尖端往內 7px）、終點＝✕ 中心
      const ln = flat.find((x) => x.key === "trk" + tr.entry_i), [ex, ey] = M(kid("me" + tr.entry_i, "mk-entry").props.d), [xx, xy] = M(xp.props.d);
      assert.ok(ln && ln.props.stroke === C && !ln.props.strokeDasharray, "連線顏色 " + nm);
      const close = (u, v) => Math.abs(u - v) < 0.11;
      assert.ok(close(ln.props.x1, ex) && close(ln.props.y1, ey + s * 7), "連線起點≠三角中心 " + nm + JSON.stringify([ln.props.x1, ln.props.y1, ex, ey]));
      assert.ok(close(ln.props.x2, xx + 5) && close(ln.props.y2, xy + 5), "連線終點≠✕ 中心 " + nm + JSON.stringify([ln.props.x2, ln.props.y2, xx + 5, xy + 5]));
      // 字：停損寫多停損／空停損；隔 ≤2 根併成一串（進場處不寫字）；其他分開寫多進／多出
      const te = lab("te", tr.entry_i), tx = lab("tx", tr.exit_i), sd = s === 1 ? "多" : "空";
      assert.strictEqual(tx.length, 1, "出場字 " + nm);
      const T0 = txt(tx[0]);
      assert.strictEqual(tx[0].props.style.fill, C, "出場字顏色 " + nm);
      if (tr.why === WS) assert.ok(T0.startsWith(sd + "停損 "), "停損字樣 " + T0);
      if (tr.exit_i - tr.entry_i <= 2) {
        assert.strictEqual(te.length, 0, "隔 ≤2 根不該另寫進場字 " + nm);
        assert.ok(new RegExp("^" + sd + (tr.why === WS ? "停損" : "") + " [\\d.,]+→[\\d.,]+ [-−+]?[\\d.]+%$").test(T0) && /\btm\b/.test(tx[0].props.className), "合併標籤 " + T0);
      } else {
        assert.strictEqual(te.length, 1, "分開時要有進場字 " + nm);
        assert.ok(txt(te[0]).startsWith(sd + "進 ") && !T0.includes("→"), "分開標籤 " + T0);
        if (tr.why !== WS) assert.ok(T0.startsWith(sd + "出 "), "出場字樣 " + T0);
      }
    }
    assert.ok(!flat.some((x) => x.props.className === "mk-exit" && x.props.stroke === "#ffffff"), "✕ 不能是白色");
    // ▲▼ 畫在 ✕ 後面（不被 ✕ 蓋住）
    const order = flat.filter((x) => /^m[ex]\d/.test(String(x.key))).map((x) => x.key[1]);
    assert.ok(order.lastIndexOf("x") < order.indexOf("e"), order.join(""));
  });
  await t("出場字被擠遠 >20px → 1px 同色引線從字連到記號；沒擠遠就不畫（11-17 第三版）", async () => {
    const d = mkD({}), c = d.history.c;
    // 連續幾筆空單在同一段、互相擠：字一定有被推遠的
    const TR = [];
    for (let i = 20; i < 58; i += 3) TR.push({ side: -1, entry_i: i, exit_i: i + 1, entry: c[i], exit_px: c[i + 1], stop: c[i] * 1.05, entry_t: "e", exit_t: "x", pct: 0.5, pts: 0.5, why: "破均線", label: "破均線" });
    const base = { trades: TR, open: null }, w = { ...d, trade: { ...base, ...lib3.chartMarks(base, 0), p: {} } }, full = P.fullSeries(w);
    const flat = [], walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && x.props) { flat.push(x); walk(x.props.children); } };
    walk(P.KChart({ d: w, full, smas: [], a: 0, b: full.bars.length, gaps: [], islands: [], top: [], rolls: [] }));
    const leads = flat.filter((x) => x.type === "line" && x.props.className === "mk-lead");
    assert.ok(leads.length > 0, "擠在一起卻沒有引線");
    for (const L of leads) {
      assert.ok(L.props.stroke === "#3fae7a" && L.props.strokeWidth === "1", JSON.stringify(L.props));
      assert.ok(Math.hypot(L.props.x2 - L.props.x1, L.props.y2 - L.props.y1) > 12, "引線太短");
    }
    // 第一個測資（字都在原位附近）不畫引線
    const flat0 = []; (function wk(x) { if (Array.isArray(x)) x.forEach(wk); else if (x && x.props) { flat0.push(x); wk(x.props.children); } })(P.KChart({ d: { ...d, trade: { trades: [TR[0]], open: null, ...lib3.chartMarks({ trades: [TR[0]], open: null }, 0), p: {} } }, full, smas: [], a: 0, b: full.bars.length, gaps: [], islands: [], top: [], rolls: [] }));
    assert.strictEqual(flat0.filter((x) => x.props.className === "mk-lead").length, 0, "字沒被擠遠不該有引線");
  });
  await t("停損出場的說明多一列「停損由來」（沿用進場說明的寫法）；其他出場沒有", async () => {
    const res = { ctx: { O: [10, 10, 9], H: [11, 11, 10], L: [9, 9, 8], C: [10, 10, 8.5], T: ["a", "b", "c"], M: [[], [], []], XM: [], vr: [], atr: [1, 1, 1] } };
    const pp = { ...lib3.normParams({}).p, stop: "low_n", stop_n: 5, stop_on: "touch" };
    const st = lib3.explainExit(res, pp, { exit_i: 2, entry_i: 1, side: 1, why: "停損", stop: 9, entry: 10, exit_px: 9, pct: -10 });
    const row = st.rows.find((r) => r[0] === "停損由來");
    assert.ok(row && row[1] === "9＝進場時近 5 根（含進場根）的最低點", JSON.stringify(st.rows));
    const atrRow = lib3.explainExit(res, { ...pp, stop: "atr", atr_n: 14, atr_k: 2 }, { exit_i: 2, entry_i: 1, side: 1, why: "停損", stop: 8, entry: 10, exit_px: 8, pct: -20 }).rows.find((r) => r[0] === "停損由來");
    assert.ok(atrRow && atrRow[1].includes("ATR14 1 × 2 倍"), JSON.stringify(atrRow));
    const hold = lib3.explainExit(res, { ...pp, max_hold: 1 }, { exit_i: 2, entry_i: 1, side: 1, why: "持有到期", stop: 9, entry: 10, exit_px: 8.5, pct: -15 });
    assert.ok(!hold.rows.some((r) => r[0] === "停損由來"));
  });
  // lib/ta-live.js（swc 轉 CJS；jwt 同法載入）
  const ldMod = (rel) => { const f = path.join(ROOT, "lib", rel), mm = new Mod(f); mm.filename = f; mm.paths = Mod._nodeModulePaths(ROOT); mm._compile(transformSync(fs.readFileSync(f, "utf8"), opts).code, f); require.cache[f] = mm; mm.loaded = true; return mm.exports; };
  ldMod("jwt.js");
  const LV = ldMod("ta-live.js");
  await t("ta-live：代號格式收期貨／^SOX／中文別名，擋怪字；額度鍵 NQ1!／/NQ＝NQ=F", async () => {
    for (const x of ["2330", "brk.b", "ES=F", "nq1!", "/NQ", "^sox", "小那", "費半", "TXF1!", "2330.TWO"]) assert.ok(LV.cleanSym(x), x);
    for (const x of ["^^X", "A B", "<x>", "ES=F;DROP", "1234567890123", "小那斯達克期貨超長名字"]) assert.strictEqual(LV.cleanSym(x), "", x);
    assert.strictEqual(LV.symKey("NQ1!"), "NQ=F"); assert.strictEqual(LV.symKey("/nq"), "NQ=F"); assert.strictEqual(LV.symKey("NQ=F"), "NQ=F");
    assert.strictEqual(LV.symKey("2330.TW"), "2330"); assert.strictEqual(LV.symKey("BRK.B"), "BRK-B"); assert.strictEqual(LV.symKey("^SOX"), "^SOX");
  });
  await t("ta-live：引擎 ALIAS 裡每個中文別名都收得進來（直接讀 ta-engine/ta_engine.py，引擎加別名這裡自動跟上）", async () => {
    const src = fs.readFileSync(path.join(ROOT, "ta-engine", "ta_engine.py"), "utf8");
    const m = src.match(/^ALIAS = \{([\s\S]*?)\}\n/m);
    assert.ok(m, "找不到 ALIAS");
    const keys = [...m[1].matchAll(/'([^']+)':/g)].map((x) => x[1]);
    assert.ok(keys.length >= 20 && keys.includes("台指期") && keys.includes("小那斯達克"), "ALIAS 解析：" + keys.length);
    const bad = keys.filter((k) => !LV.cleanSym(k));
    assert.deepStrictEqual(bad, [], "被擋掉的別名");
  });

  await t("^TWII 加權指數＋年線（11-19）：代號別名收得進來；指數量標「指數量」不換算張；年線 yr 有值才畫（不足 240 根＝NaN 不畫）、只在日K 算", async () => {
    for (const x of ["^TWII", "^twii", "加權", "加權指數", "大盤", "TAIEX", "TWII"]) assert.ok(LV.cleanSym(x), x);
    assert.strictEqual(LV.symKey("^TWII"), "^TWII");
    const d = mkD({ symbol: { market: "tw", type: "INDEX", code: "^TWII", yahoo: "^TWII", exchange: "TWSE" } });
    const full = P.fullSeries(d), N = full.bars.length;
    const r = (yr) => renderToString(React.createElement(P.KChart, { d, full, smas: [], yr, a: 0, b: N, gaps: [], islands: [], top: [], rolls: [] }));
    const h0 = r(undefined);
    assert.ok(h0.includes("指數量") && !h0.includes("量（張）") && !h0.includes("年線") && !h0.includes('data-ma="sma240"'), "指數量標籤／沒給年線");
    const h1 = r(full.c.map((c, i) => (i < N / 2 ? NaN : c)));
    assert.ok(h1.includes(">年線<") && h1.includes('data-ma="sma240"'), "年線沒畫");
    assert.ok(!r(full.c.map(() => NaN)).includes("年線"), "整段不足 240 根也畫了年線");
    const tw = chartHtml(mkD({ symbol: { market: "tw", type: "EQUITY", code: "2330" } }));
    assert.ok(tw.includes("量（張）") && !tw.includes("指數量"), "個股量單位被改到");
    const src = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
    // 11-24 劇本：開著時年線跟著示意 K 延伸（fullX＝實際 K＋示意 K；沒開＝full）
    assert.ok(/d\.tf === "D" \? smaSeq\(fullX\.c, 240\) : d\.tf === "W" \? smaSeq\(fullX\.c, 52\) : null/.test(src), "日K smaSeq(fullX.c, 240)、週K smaSeq(fullX.c, 52)、其他不算");
  });
  await t("週K 52 週線（11-19）：週K 畫 SMA52 標「52 週線」；日K 仍是 240 年線；1H/4H 都沒有；不足根數不畫", async () => {
    const ca = (tf, n) => { const d = mkD({ n }); d.tf = tf; const ce = console.error; console.error = () => {}; try { return renderToString(React.createElement(P.ChartArea, { d })); } finally { console.error = ce; } };   // 伺服端 render 的 useLayoutEffect 警告不印
    const w = ca("W", 60);
    assert.ok(w.includes(">52 週線<") && w.includes('data-ma="sma52"') && !w.includes("年線") && !w.includes('data-ma="sma240"'), "週K 沒畫 52 週線／混到年線");
    const dd = ca("D", 260);
    assert.ok(dd.includes(">年線<") && dd.includes('data-ma="sma240"') && !dd.includes("52 週線") && !dd.includes('data-ma="sma52"'), "日K 年線被改到");
    for (const tf of ["1H", "4H"]) { const h = ca(tf, 260); assert.ok(!h.includes("年線") && !h.includes("52 週線") && !/data-ma="sma(52|240)"/.test(h), tf + " 不該畫"); }
    const w0 = ca("W", 51);
    assert.ok(!w0.includes("52 週線") && !w0.includes('data-ma="sma52"'), "不足 52 根也畫了");
    const d0 = ca("D", 239);
    assert.ok(!d0.includes("年線") && !d0.includes('data-ma="sma240"'), "不足 240 根也畫了");
    // 面板填到跟年線／52 週線同週期：兩條都要畫、React key 不能撞（11-24 審查）
    for (const [tf, ns, m] of [["D", ["20", "60", "240"], 240], ["W", ["10", "20", "52"], 52]]) {
      const d = mkD({ n: 300 }); d.tf = tf;
      const ks = [], oc = React.createElement, ce = console.error;   // 伺服端 render 不報重複 key，自己收 polyline 的 key
      React.createElement = (ty, pr, ...r) => { if (ty === "polyline" && pr) ks.push(pr.key); return oc(ty, pr, ...r); }; console.error = () => {};
      let h; try { h = renderToString(oc(P.ChartArea, { d, p: lib3.normParams({ ma: "sma", ma_n: ns }).p })); } finally { React.createElement = oc; console.error = ce; }
      assert.ok((h.match(new RegExp('class="ma" data-ma="sma' + m + '"', "g")) || []).length >= 2, tf + " 交易線＋年線都要畫");
      assert.deepStrictEqual(ks.filter((k, i) => ks.indexOf(k) !== i), [], tf + " React key 撞了");
    }
  });
  // ---------- 5. 台指期／費半期（期交所） ----------
  const TWF = { market: "fut", exchange: "TAIFEX", type: "FUTURE", code: "TXF1!", yahoo: "TXF1!", contract: "202611", tfs: ["D", "W"], session: "含夜盤（夜盤算到隔天）" };
  const html0 = (el) => renderToString(el).replace(/<!-- -->/g, "");
  await t("台指期：市場標籤台灣期貨・TAIFEX；美國期貨照舊", async () => {
    assert.strictEqual(P.mktBadge(TWF), "台灣期貨・TAIFEX");
    assert.strictEqual(P.mktBadge({ market: "fut", exchange: "CME" }), "美國期貨・CME");
  });
  await t("台指期：symbol.tfs=[D,W] → 1H／4H 停用＋「期交所只有日資料」；沒有 tfs（舊回應、美股）或壞值全部可用", async () => {
    const on = html0(React.createElement(P.TfTabs, { tf: "D", tfs: TWF.tfs, onPick: () => {} }));
    assert.strictEqual((on.match(/disabled=""/g) || []).length, 2, on);
    assert.ok(/title="期交所只有日資料"[^>]*>1H</.test(on) && on.includes("ta-tfnote") && /aria-selected="true"[^>]*>日K</.test(on), on);
    for (const x of [undefined, null, "D", [], { a: 1 }]) {
      const h = html0(React.createElement(P.TfTabs, { tf: "1H", tfs: x, onPick: () => {} }));
      assert.ok(!h.includes("disabled") && !h.includes("期交所只有日資料") && h.includes(">週K<"), String(x));
    }
  });
  await t("台指期：期交所讀不到 → 黃色註記；費半期 → ^SOX 是指數版＋改看鈕；美股、欄位壞值不顯示也不崩", async () => {
    const st = html0(React.createElement(P.FutInfo, { s: { ...TWF, stale: "期交所最新資料暫時讀不到，資料到 2026-11-07" }, onPick: () => {} }));
    assert.ok(st.includes("ta-chip warn") && st.includes("資料到 2026-11-07"), st);
    const sx = html0(React.createElement(P.FutInfo, { s: { ...TWF, code: "SXF1!", see_also: { code: "^SOX", text: "^SOX 是指數版（費城半導體指數，Yahoo 資料）" } }, onPick: () => {} }));
    assert.ok(sx.includes("^SOX 是指數版") && sx.includes("改看 ^SOX"), sx);
    for (const s of [TWF, { market: "fut", exchange: "CME", stale: "x" }, null, "x", { ...TWF, see_also: "x", stale: 5 }, { ...TWF, see_also: { code: 3 } }]) {
      assert.strictEqual(html0(React.createElement(P.FutInfo, { s, onPick: () => {} })), "", JSON.stringify(s));
    }
  });
  await t("台指期：換月標籤、量（口）照畫", async () => {
    const h = chartHtml(mkD({ symbol: TWF, rolls: [{ i: 40, t: "2026-02-13", dir: null, step_pct: null, label: "換月" }] }));
    assert.ok(h.includes('data-roll="2026-02-13"') && h.includes("量（口）"), "台指期圖");
  });
  await t("ta-live：台指期／費半期代號收得進來、額度鍵 TXF1!＝TXF=F", async () => {
    for (const x of ["TXF1!", "txf1!", "TX", "台指期", "台指", "SXF1!", "SXF", "費半期"]) assert.ok(LV.cleanSym(x), x);
    assert.strictEqual(LV.symKey("TXF1!"), "TXF=F"); assert.strictEqual(LV.symKey("SXF1!"), "SXF=F");
  });

  // ---------- 6. 區間強弱台股／美股（11-13）、續票判斷 ----------
  await t("區間強弱：美股字（SPY 含息、百萬美元、交易所、13 族群註腳），台股字不變", async () => {
    const row = { code: "NVDA", name: "NVIDIA", mkt: "NASDAQ", ret: 5.2, rel: 3.1, avgAmt: 32000.4, groups: ["半導體"] };
    const d = { start: "2026-11-02", end: "2026-11-12", base: "2026-10-31", days: 9, bench: { tr: 2.1, px: 2.0 }, range: { min: "2023-11-14", max: "2026-11-12" },
      groups: [{ name: "半導體", rel: 3.1, ret: 5.2, n: 1, total: 1, members: [row] }], strong: [row], weak: [row], universe: { eligible: 1, total: 1 }, through: "2026-11-12" };
    const h = (mk) => renderToString(React.createElement(P.RsView, { mk, rs: { data: d }, run: () => {}, onCode: () => {} }));
    const us = h("us"), tw = h("tw");
    for (const x of ["SPY 含息", "SPY 不含息（參考）", "百萬美元", "交易所", "32,000", "標普 500 成分股", "SPY 含息同期報酬", "美股報告熱力圖 13 族群", "個族群，依相對大盤"]) assert.ok(us.includes(x), "美股少了 " + x);
    for (const x of ["加權報酬指數", "加權指數", "日均成交值（億）", "上市＋上櫃"]) assert.ok(!us.includes(x), "美股不該有 " + x);
    for (const x of ["加權報酬指數", "加權指數（價格，參考）", "日均成交值（億）", "市場", "v6 分類", 'value="5000"']) assert.ok(tw.includes(x), "台股少了 " + x);
    assert.ok(us.includes('value="0"') && !tw.includes("SPY"));
  });
  await t("趨勢樣板（11-17）：分頁在區間強弱右邊、記得住；多空兩張表七欄可排序＋十列視窗、點代號回 K 線；折線紅多綠空；註腳只寫事實", async () => {
    const raw = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
    assert.ok(/>區間強弱<\/button>\s*<button[^]*?pickView\(view === "tt" \? "chart" : "tt"\)}>趨勢樣板<\/button>/.test(raw), "分頁鈕「趨勢樣板」要緊接在「區間強弱」右邊");
    assert.ok(raw.includes('call("/api/ta-rs", { op: "tt", market: mk })'), "要打 /api/ta-rs op:'tt' 帶 market");
    const st = {}; globalThis.localStorage = { getItem: (k) => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); }, removeItem: (k) => { delete st[k]; } };
    st.yoda_ta_view = "tt"; assert.strictEqual(P.readView(), "tt");
    st.yoda_ta_view = "junk"; assert.strictEqual(P.readView(), "chart");
    const row = (code, rs) => ({ code, name: "名" + code, group: "半導體業", close: 123.5, dhi: -3.25, dlo: 80.1, rs });
    const x = { day: "20261116", long: [row("2330", 99), row("2454", 90)], short: [row("2233", 1)],
      history: [{ d: "20261113", nl: 88, ns: 33, n: 642 }, { d: "20261116", nl: 64, ns: 37, n: 643 }, null] };
    const picked = [];
    const el = React.createElement(P.TtView, { x, mk: "tw", onCode: (c) => picked.push(c) });
    const h = renderToString(el).replace(/<!-- -->/g, "");
    for (const w of ["資料日 2026-11-16", "母體 643 檔", "多方樣板 2 檔", "空方樣板 1 檔", "多方樣板檔數占比 %", "空方樣板檔數占比 %", "ta-win10", "上市＋上櫃普通股", "RS ≥ 70", "離 52 週高點三成以上、距 52 週低點兩成五以內、RS ≤ 30"]) assert.ok(h.includes(w), "少了 " + w);
    for (const w of ["代號", "名稱", "族群", "收盤", "距 52 週高", "離 52 週低", "RS"]) assert.ok(h.includes(">" + w + "<"), "表頭少了 " + w);
    assert.ok((h.match(/<th /g) || []).length === 18 && (h.match(/點一下排序/g) || []).length === 18, "兩張表各 9 欄、每欄都可排序");
    // 舊面板（沒有 since／days／exits）：訊號欄留空、沒有新進／跳出摘要與跳出表
    assert.ok(!h.includes("新進") && !h.includes("跳出") && !h.includes("ta-tt-new"), "舊面板不該出現訊號");
    assert.ok(h.includes('class="tt-l"') && h.includes('class="tt-s"') && h.includes("-3.3%") && h.includes("+80.1%"), h.slice(0, 400));
    const us = renderToString(React.createElement(P.TtView, { x, mk: "us", onCode: () => {} })).replace(/<!-- -->/g, "");
    assert.ok(us.includes("標普 500 現任成分股") && us.includes("80 百萬美元") && !us.includes("上市＋上櫃") && us.includes("距 52 週低點兩成五以內、RS ≤ 30") && !us.includes("八條反向"), "美股註腳");
    // 代號欄的按鈕點一下 → onCode（頁面接 rsCode＝切回 K 線查這檔）
    const btn = P.ttCols((c) => picked.push(c))[0].render(row("2454", 90));
    let stopped = 0; btn.props.onClick({ stopPropagation: () => stopped++ });
    assert.deepStrictEqual(picked, ["2454"]); assert.strictEqual(stopped, 1);
    assert.ok(/<TtView x=\{tt\[rsMkt\]\.data\} mk=\{rsMkt\} onCode=\{rsCode\} \/>/.test(raw), "名單點代號要接 rsCode（切回 K 線）");
    // 守門：這一頁不准出現已永久刪除的字、不做進出訊號、不給買賣建議
    for (const w of ["怎麼看", "最近查過", "加碼", "停利", "2R", "出一半", "移保本", "多空排列", "進場", "出場", "買進", "賣出", "建議", "優勢", "勝率"]) {
      assert.ok(!h.includes(w) && !us.includes(w), "趨勢樣板分頁出現「" + w + "」");
    }
    // 資料壞掉不崩：沒有 history／名單不是陣列
    for (const bad of [{ day: "20261116" }, { day: "x", long: "x", short: null, history: [{ d: "1", nl: 1, ns: 1, n: 0 }] }]) {
      const b = renderToString(React.createElement(P.TtView, { x: bad, mk: "tw", onCode: () => {} }));
      assert.ok(b.includes("歷史天數不足") && b.includes("今天沒有符合的個股"), b.slice(0, 300));
    }
  });
  await t("趨勢樣板進出訊號（11-17）：天數＋符合以來 % 兩欄、新進排最前、摘要新進／跳出、今日跳出兩張表＋原因轉中文、沒有＝今天沒有；守門字", async () => {
    const row = (code, rs, days, chg, o) => ({ code, name: "名" + code, group: "半導體業", close: 100, dhi: -3, dlo: 80, rs, since: "20261101", days, chg, ...o });
    const x = { day: "20261116", history: [{ d: "20261113", nl: 3, ns: 1, n: 600 }, { d: "20261116", nl: 3, ns: 1, n: 600 }],
      long: [row("2330", 99, 12, 5.5), row("2454", 90, 1, 0), row("3008", 80, 300, 40, { trunc: true }), row("6234", 75, 1, 0)],
      short: [row("2233", 2, 4, -6.2)],
      exits_long: [row("3287", 60, 20, 5.62, { why: ["C7"] }), row("4903", 50, 9, -16.7, { why: ["C5", "C7", "U"] }), row("2881", 70, 5, null, { why: ["X"], close: null }), row("1101", 70, 1, -1, { why: ["C1", "C4", "C8"] })],
      exits_short: [] };
    const h = renderToString(React.createElement(P.TtView, { x, mk: "tw", onCode: () => {} })).replace(/<!-- -->/g, "");
    for (const w of [">天數<", ">符合以來 %<", "多方新進 2／跳出 4", "空方新進 0／跳出 0", "今日跳出・多方 4 檔", "今日跳出・空方 0 檔", "今天沒有<",
      ">符合天數<", ">符合期間 %<", ">跳出原因<", "距 52 週高超過兩成五", "沒站上 50 日線、距 52 週高超過兩成五、掉出母體",
      "沒站上 150 或 200 日線、50 日線沒在 150 或 200 日線之上、RS 不足 70", ">今天沒有收盤<", "≥300", "新進＝今天八條全部符合"]) assert.ok(h.includes(w), "少了 " + w);
    assert.ok((h.match(/<th /g) || []).length === 9 * 2 + 7, "名單 9 欄 ×2＋跳出表 7 欄（空方沒有＝不畫表）");
    // 新進排最前（2454、6234 照原順序），其餘照原順序；trunc 的 1 天不算新進
    const codes = [...h.split("多方樣板 4 檔")[1].split("空方樣板")[0].matchAll(/title="看 K 線">(\w+)</g)].map((m) => m[1]);
    assert.deepStrictEqual(codes, ["2454", "6234", "2330", "3008"]);
    assert.strictEqual((h.match(/class="ta-tt-new">新進</g) || []).length, 2, "跳出表 days=1 不標新進");
    assert.ok(h.includes('class="up">+5.5%') && h.includes('class="dn">-6.2%') && h.includes('class="up">+5.6%') && h.includes('class="dn">-16.7%'), "漲紅跌綠");
    assert.ok(/>2881<[^]*?<td class="r ">—<\/td>[^]*?<td class="r ">5<\/td><td class="r "><span class="">—<\/span>/.test(h), "沒收盤的跳出股：收盤、符合期間 % 顯示 —");
    const ttNewRow = P.ttCols(() => {})[7].render({ days: 1, trunc: true });
    assert.strictEqual(ttNewRow, "≥1", "trunc 的 1 天不標新進");
    const us = renderToString(React.createElement(P.TtView, { x: { ...x, exits_long: undefined, exits_short: [row("BSX", 50, 3, 2, { why: ["S1", "S4", "S5", "S8"] })] }, mk: "us", onCode: () => {} })).replace(/<!-- -->/g, "");
    assert.ok(us.includes("站上 150 或 200 日線、50 日線沒在 150 或 200 日線之下、沒跌破 50 日線、RS 高於 30") && us.includes("今日跳出・多方 0 檔") && us.includes("多方新進 2／跳出 0"), "美股空方跳出原因");
    for (const w of ["怎麼看", "最近查過", "加碼", "停利", "2R", "出一半", "移保本", "多空排列", "進場", "出場", "買進", "賣出", "建議", "優勢", "勝率"]) {
      assert.ok(!h.includes(w) && !us.includes(w), "訊號畫面出現「" + w + "」");
    }
    // 壞資料不崩：exits 裡有 null、why 不是陣列
    const b = renderToString(React.createElement(P.TtView, { x: { day: "x", long: [null, { code: "1" }], exits_long: [null, { code: "9", why: "C5" }], exits_short: "x" }, mk: "tw", onCode: () => {} })).replace(/<!-- -->/g, "");
    assert.ok(b.includes("今日跳出・多方 1 檔") && b.includes("今日跳出・空方 0 檔"), b.slice(0, 300));
  });
  await t("選擇權（11-23）：分頁在趨勢樣板右邊、記得住；下拉 11 檔分組；買 Call 表七欄可排序、預設報酬 % 高到低、十列視窗；試算最多賺；守門字", async () => {
    const raw = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
    assert.ok(/>趨勢樣板<\/button>\s*<button[^]*?pickView\(view === "opt" \? "chart" : "opt"\)}>選擇權<\/button>/.test(raw), "分頁鈕「選擇權」要緊接在「趨勢樣板」右邊");
    assert.ok(raw.includes('call("/api/ta-opt", e ? { symbol: s, expiry: e } : { symbol: s })'), "要打 /api/ta-opt");
    const st = {}; globalThis.localStorage = { getItem: (k) => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); }, removeItem: (k) => { delete st[k]; } };
    st.yoda_ta_view = "opt"; assert.strictEqual(P.readView(), "opt");
    assert.strictEqual(P.readOptSym(), "QQQ"); st.yoda_ta_opt_sym = "NVDA"; assert.strictEqual(P.readOptSym(), "NVDA"); st.yoda_ta_opt_sym = "AMD"; assert.strictEqual(P.readOptSym(), "QQQ");
    globalThis.localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
    assert.strictEqual(P.readOptSym(), "QQQ", "localStorage 不能用也不崩");
    const q = (b, a) => ({ b, a, iv: 0.5, oi: 10 });
    const rows = [100, 110, 120, 130, 140, 150, 170].map((k) => ({ k, c: k === 150 ? q(0, 1) : q(1, { 100: 31, 110: 22, 120: 14, 130: 9.2, 140: 3, 170: 0.1 }[k]), p: q(1, 2) }));
    const data = { symbol: "NVDA", price: 130, off: true, ts: "2026-11-23 01:38:43", last: "", expiries: ["2026-12-18", "2027-01-15"], expiry: "2026-12-18", rows };
    const h = renderToString(React.createElement(P.OptView, { opt: { sym: "NVDA", exp: "2026-12-18", data }, run: () => {} })).replace(/<!-- -->/g, "");
    const opts = [...h.matchAll(/<option value="([A-Z]{2,})"/g)].map((m) => m[1]);
    assert.deepStrictEqual(opts, ["QQQ", "SPY", "SOXX", "NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AVGO"]);
    for (const w of ['<optgroup label="ETF">', '<optgroup label="大型科技股">', "QQQ（那斯達克 100）", "SOXX（費半）", "CBOE 延遲報價（約 15 分鐘）", "資料時間 2026-11-23 09:38（台灣）", "看漲", "看跌", 'value="136.50"', "2026-12-18（剩", "ta-win10", "非正規盤時段，用上一個正規盤收盤價"]) assert.ok(h.includes(w), "少了 " + w);
    for (const w of ["選擇", "成本", "看對時賺賠", "報酬 %", "市場估的賺錢機率（用隱含波動率估）", "最多虧", "損益兩平"]) assert.ok(h.includes(">" + w + "<"), "表頭少了 " + w);
    assert.ok((h.match(/<th /g) || []).length === 7 && (h.match(/點一下排序/g) || []).length === 7, "七欄都可排序");
    assert.ok(/報酬 %<span class="arr">▼<\/span>/.test(h), "預設照報酬 % 由高到低（表頭箭頭）");
    const order = [...h.matchAll(/<td class="">買 (\d+) Call<\/td>/g)].map((m) => m[1]);
    assert.deepStrictEqual(order, ["110", "120", "100", "130", "140"], "只列有報價、±25% 內，照報酬 % 高到低");
    assert.ok(h.includes('class="up">+$450') && h.includes('class="dn">−$300') && h.includes("$2,200"), "看對時賺賠漲紅跌綠");
    // 試算：Call 最多賺無上限；Put＝(履約價 − 權利金) × 100 × 口數；到期價格的賺賠漲紅跌綠；口數打錯當 1
    const tc = renderToString(React.createElement(P.OptTry, { r: { k: 126, cp: "C", ask: 7.75, be: 133.75 }, price: 130, tgt: 136.5, n: "2", setN: () => {}, S: "135", setS: () => {} })).replace(/<!-- -->/g, "");
    assert.ok(tc.includes("無上限") && tc.includes('class="big up">+$250') && tc.includes("+16.1%") && tc.includes("$1,550") && tc.includes("133.75") && tc.includes('type="range"') && tc.includes("到期損益圖"), tc.slice(0, 600));
    for (const k of ["now", "be", "tg", "s"]) assert.ok(tc.includes('data-vx="' + k + '"'), "圖上少了 " + k);
    const tp = renderToString(React.createElement(P.OptTry, { r: { k: 100, cp: "P", ask: 4, be: 96 }, price: 100, tgt: 95, n: "0", setN: () => {}, S: "110", setS: () => {} })).replace(/<!-- -->/g, "");
    assert.ok(tp.includes("$9,600") && !tp.includes("無上限") && tp.includes('class="big dn">−$400') && tp.includes("-100.0%"), tp.slice(0, 600));
    // 抓不到：資料不足＋重試；不崩
    let re = 0;
    const he = renderToString(React.createElement(P.OptView, { opt: { sym: "QQQ", exp: "", error: "連線失敗，請再試一次" }, run: () => re++ }));
    assert.ok(he.includes("資料不足：連線失敗") && he.includes("重試"), he);
    const hb = renderToString(React.createElement(P.OptView, { opt: { sym: "QQQ", exp: "", data: { ...data, rows: [] } }, run: () => {} }));
    assert.ok(hb.includes("資料不足"), hb.slice(0, 300));
    // 守門：不做賣出／價差／Covered Call／Roll、不放專業欄位、不寫建議字、已永久刪除的字
    for (const s of [h, tc, tp]) for (const w of ["建議", "應該", "最佳", "推薦", "Delta", "Covered", "Roll", "賣出", "價差", "進場", "出場", "加碼", "停利", "2R", "出一半", "移保本", "怎麼看", "最近查過", "多空排列", "未平倉"]) assert.ok(!s.includes(w), "選擇權分頁出現「" + w + "」");
    assert.strictEqual((h.match(/隱含波動率/g) || []).length, 1, "隱含波動率只出現在機率欄名");
  });
  await t("共振閃爍（11-23）：1H／4H 同方向最近一次進場都在 8 小時內才閃；訊號篩選連動；時區換算；週期鈕 class／hover", async () => {
    const TP = "Asia/Taipei", H = 3600e3;
    assert.strictEqual(P.tzMs("2026-11-23 09:00", TP), Date.UTC(2026, 10, 23, 1, 0));
    assert.strictEqual(P.tzMs("2026-07-01 09:30", "America/New_York"), Date.UTC(2026, 6, 1, 13, 30));   // 夏令 UTC-4
    assert.strictEqual(P.tzMs("2026-12-01 09:30", "America/New_York"), Date.UTC(2026, 11, 1, 14, 30));   // 冬令 UTC-5
    assert.ok(Number.isNaN(P.tzMs("2026-11-23", TP)) && Number.isNaN(P.tzMs(null, TP)));
    const now = Date.UTC(2026, 10, 23, 6, 0);   // 台北 14:00
    const tr = (side, t) => ({ side, entry_t: t });
    const r1 = { trades: [tr(1, "2026-11-20 10:00"), tr(-1, "2026-11-23 12:00")], open: null };
    const r4 = { trades: [tr(-1, "2026-11-23 09:00")], open: { side: 1, entry_t: "2026-11-23 13:00" } };
    const b = P.mtfBlink(r1, r4, TP, "all", now);
    assert.ok(b && b.s === -1 && b.tip === "1H 空進 11/23 12:00、4H 空進 11/23 09:00" && b.key === "-1|2026-11-23 12:00|2026-11-23 09:00", JSON.stringify(b));
    assert.strictEqual(P.mtfBlink(r1, r4, TP, "long", now), null, "1H 多進在三天前");
    assert.ok(P.mtfBlink(r1, r4, TP, "short", now));
    // 8 小時從那根 K 收完起算：4H 09:00 那根收在 13:00、1H 12:00 那根也收在 13:00
    assert.strictEqual(P.mtfBlink(r1, r4, TP, "short", Date.UTC(2026, 10, 23, 5, 0) + 8 * H + 60e3), null, "4H 那根收完超過 8 小時就停");
    assert.ok(P.mtfBlink(r1, r4, TP, "short", Date.UTC(2026, 10, 23, 5, 0) + 8 * H), "收完後剛好 8 小時還閃");
    assert.ok(P.mtfBlink(r1, r4, TP, "short", Date.UTC(2026, 10, 23, 1, 0) + 8 * H + 60e3), "從 K 棒標的時間算已過 8 小時，但從收完算還沒");
    // 收盤那段取實際收盤、不超過當天收盤
    const NY = "America/New_York";
    assert.strictEqual(P.barEnd("2026-11-23 09:00", 4, TP), Date.UTC(2026, 10, 23, 5, 0), "台股 4H 09:00 → 13:00");
    assert.strictEqual(P.barEnd("2026-11-23 13:00", 4, TP), Date.UTC(2026, 10, 23, 5, 30), "台股 4H 13:00 → 13:30（不是 17:00）");
    assert.strictEqual(P.barEnd("2026-11-23 13:00", 1, TP), Date.UTC(2026, 10, 23, 5, 30), "台股 1H 13:00 → 13:30");
    assert.strictEqual(P.barEnd("2026-11-23 12:00", 1, TP), Date.UTC(2026, 10, 23, 5, 0), "台股 1H 12:00 → 13:00");
    assert.strictEqual(P.barEnd("2026-11-23 15:30", 1, NY), Date.UTC(2026, 10, 23, 21, 0), "美股 1H 15:30 → 16:00（冬令）");
    assert.strictEqual(P.barEnd("2026-07-01 15:30", 1, NY), Date.UTC(2026, 6, 1, 20, 0), "美股 1H 15:30 → 16:00（夏令）");
    assert.strictEqual(P.barEnd("2026-11-23 13:30", 4, NY), Date.UTC(2026, 10, 23, 21, 0), "美股 4H 13:30 → 16:00（不是 17:30）");
    assert.strictEqual(P.barEnd("2026-11-23 09:30", 4, NY), Date.UTC(2026, 10, 23, 18, 30), "美股 4H 09:30 → 13:30");
    assert.strictEqual(P.barEnd("2026-11-23 10:00", 1, "Asia/Tokyo"), P.tzMs("2026-11-23 10:00", "Asia/Tokyo") + H, "不認得的時區：只加週期");
    // 美國期貨（fut、紐約時區）：18:00 開、隔天 17:00 收；4H 切 18／22／02／06／10／14，不套股票 16:00
    const ft = (t) => P.tzMs(t, NY);
    assert.strictEqual(P.barEnd("2026-11-23 18:00", 4, NY, "fut"), ft("2026-11-23 22:00"), "期貨 4H 18:00 → 22:00");
    assert.strictEqual(P.barEnd("2026-11-23 22:00", 4, NY, "fut"), ft("2026-11-24 02:00"), "期貨 4H 22:00 → 隔天 02:00");
    assert.strictEqual(P.barEnd("2026-11-23 14:00", 4, NY, "fut"), ft("2026-11-23 17:00"), "期貨 4H 14:00 → 17:00（不是 16:00／18:00）");
    assert.strictEqual(P.barEnd("2026-11-23 23:00", 1, NY, "fut"), ft("2026-11-24 00:00"), "期貨 1H 23:00 → 00:00");
    assert.strictEqual(P.barEnd("2026-11-23 16:00", 1, NY, "fut"), ft("2026-11-23 17:00"), "期貨 1H 16:00 → 17:00");
    const r1f = { trades: [tr(1, "2026-11-24 01:00")], open: null }, r4f = { trades: [tr(1, "2026-11-23 22:00")], open: null };
    assert.ok(P.mtfBlink(r1f, r4f, NY, "all", ft("2026-11-24 02:20"), "fut"), "期貨 4H 22:00＋1H 01:00 多進，隔天 02:20 還閃");
    assert.ok(P.mtfBlink(r1f, r4f, NY, "all", ft("2026-11-24 10:00"), "fut") && !P.mtfBlink(r1f, r4f, NY, "all", ft("2026-11-24 10:01"), "fut"), "從 02:00 收完起算 8 小時（10:00）");
    // 台股 4H 13:00 那根：13:30 收完 → 21:30 還閃、21:31 停（1H 同在 13:00）
    const r1c = { trades: [], open: { side: 1, entry_t: "2026-11-23 13:00" } }, r4c = { trades: [tr(1, "2026-11-23 13:00")], open: null };
    assert.ok(P.mtfBlink(r1c, r4c, TP, "all", Date.UTC(2026, 10, 23, 13, 30)), "台股 13:30 收完後 8 小時（21:30）還閃");
    assert.strictEqual(P.mtfBlink(r1c, r4c, TP, "all", Date.UTC(2026, 10, 23, 13, 31)), null, "21:31 停");
    // 美股 1H 15:30、4H 13:30：都收在 16:00 → 隔天 00:00（紐約）還閃、00:01 停
    const r1u = { trades: [tr(-1, "2026-11-23 15:30")], open: null }, r4u = { trades: [tr(-1, "2026-11-23 13:30")], open: null };
    const bu = P.mtfBlink(r1u, r4u, NY, "all", Date.UTC(2026, 10, 24, 5, 0));
    assert.ok(bu && bu.tip === "1H 空進 11/23 15:30、4H 空進 11/23 13:30", "hover 仍顯示 K 棒標的時間：" + JSON.stringify(bu));
    assert.strictEqual(P.mtfBlink(r1u, r4u, NY, "all", Date.UTC(2026, 10, 24, 5, 1)), null, "美股收盤後超過 8 小時停");
    const r1b = { trades: [], open: { side: 1, entry_t: "2026-11-23 13:00" } };   // 兩邊都成立 → 取比較新的（多）
    const bb = P.mtfBlink(r1b, { trades: [tr(-1, "2026-11-23 12:00")], open: { side: 1, entry_t: "2026-11-23 12:00" } }, TP, "all", now);
    assert.ok(bb && bb.s === 1 && bb.tip.startsWith("1H 多進 11/23 13:00"), JSON.stringify(bb));
    assert.strictEqual(P.mtfBlink(null, r4, TP, "all", now), null);
    assert.strictEqual(P.mtfBlink({ trades: [], open: null }, r4, TP, "all", now), null);
    const h = html0(React.createElement(P.TfTabs, { tf: "D", tfs: undefined, onPick: () => {}, blink: b }));
    assert.strictEqual((h.match(/ta-blink b-dn/g) || []).length, 2, h);
    assert.ok(/ta-blink b-dn" title="1H 空進 11\/23 12:00、4H 空進 11\/23 09:00">1H</.test(h) && /ta-blink b-dn"[^>]*>4H</.test(h) && !/ta-blink[^>]*>日K</.test(h), h);
    assert.ok(html0(React.createElement(P.TfTabs, { tf: "D", tfs: undefined, onPick: () => {}, blink: { ...b, s: 1 } })).includes("ta-blink b-up"));
    assert.ok(!html0(React.createElement(P.TfTabs, { tf: "D", tfs: TWF.tfs, onPick: () => {}, blink: b })).includes("ta-blink"), "1H／4H 停用時不閃");
    assert.ok(!html0(React.createElement(P.TfTabs, { tf: "D", tfs: undefined, onPick: () => {} })).includes("ta-blink"));
    const css = fs.readFileSync(path.join(ROOT, "app", "ta", "ta.css"), "utf8");
    assert.ok(/prefers-reduced-motion:reduce\)\{\.ta-tab\.ta-blink\{animation:none/.test(css), "減少動態要停閃");
  });
  await t("均線組＝交易均線（11-24）：短／中／長＝applied 換成該組 SMA（回測筆數三組不同）、圖上畫線＝applied、非三組（EMA／手改）不亮、內建前四組（SMA5/10/20）亮「短」、長線 SMA 亮「長」、預設 SMA5/10/20 亮「短」", async () => {
    const def = lib3.normParams({}).p;
    assert.ok(def.ma === "sma" && def.ma_n.join() === "5,10,20" && P.maSetOf(def) === "short", "預設 SMA5/10/20 且「短」亮");
    const G = JSON.parse(fs.readFileSync(path.join(__dirname, "ta_5stage_nq4h.json"), "utf8")), n = G.bars.length, col = (k) => G.bars.map((x) => x[k]);   // NQ 4H（四步 fixture 11-24 刪了）
    const d = { tf: "4H", bars_completed: n, history: { n, t: col(0), o: col(1), h: col(2), l: col(3), c: col(4), v: col(5) }, symbol: { market: "fut", yahoo: "NQ=F" },
      chart: { bars: [], ma_sets: { short: [5, 10, 20] }, overlays: { gaps: { cols: [], rows: [] }, islands: [] }, legend: [] }, signals: {} };
    const ca = (p) => { const ce = console.error; console.error = () => {}; try { return renderToString(React.createElement(P.ChartArea, { d, p })); } finally { console.error = ce; } };
    const cnt = {}, draft0 = { ...def, ma: "ema", ma_n: ["7", "11", "30"], stop: "atr" };   // 面板上是字串、別的欄位要留著
    for (const [k, , ns] of P.MA_SETS) {
      const dr = P.pickMaSet(draft0, k), ap = lib3.normParams(dr, def).p;
      assert.ok(ap.ma === "sma" && ap.ma_n.join() === ns.join() && ap.stop === "atr" && P.maSetOf(ap) === k, k + " applied：" + JSON.stringify(ap));
      const w = P.withTrade(d, ap);
      cnt[k] = w.trade.trades.length;
      assert.ok(w.trade.p.ma === "sma" && w.trade.p.ma_n.join() === ns.join(), k + " 回測用的均線");
      const h = ca(ap).replace(/<!-- -->/g, "");
      for (const m of ns) assert.ok(h.includes('data-ma="sma' + m + '"') && h.includes(">SMA" + m + "<"), k + " 圖上要畫 SMA" + m);
      assert.ok(!/data-ma="ema\d/.test(h), k + " 不該畫 EMA");
    }
    assert.strictEqual(new Set(Object.values(cnt)).size, 3, "三組回測筆數要不同：" + JSON.stringify(cnt));
    const ema = { ...def, ma: "ema" }, he = ca(ema).replace(/<!-- -->/g, "");
    assert.ok(["5", "10", "20"].every((m) => he.includes('data-ma="ema' + m + '"') && he.includes(">EMA" + m + "<")) && !/data-ma="sma(5|10|20)"/.test(he), "EMA 時圖上畫 EMA、名稱也寫 EMA");
    const lg = renderToString(React.createElement(P.Legend, { d, p: ema })).replace(/<!-- -->/g, "");
    assert.ok(lg.includes("EMA5／EMA10／EMA20") && lg.includes("指數均線"), "圖例跟類型一致");
    assert.ok(renderToString(React.createElement(P.Legend, { d, p: def })).includes("SMA5／SMA10／SMA20"), "圖例 SMA");
    for (const p of [ema, { ...def, ma_n: [5, 10, 21] }, { ...def, ma_n: [8, 13, 35] }, null, {}]) assert.strictEqual(P.maSetOf(p), null, "不屬於三組要三顆不亮：" + JSON.stringify(p));
    const bi = lib3.PRESETS.map((x) => [x.name, P.maSetOf(lib3.normParams(x.p).p)]);
    assert.deepStrictEqual(bi, [["預設規則", "short"], ["短線快出", "short"], ["波段抱長", "short"], ["只做多・固定 5%", "short"], ["長線 SMA", "long"]], "內建策略：" + JSON.stringify(bi));
    const src = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
    assert.ok(src.includes("const maSet = maSetOf(applied)") && !src.includes("setMaSet") && src.includes("setDraft((x) => pickMaSet(x, k))"), "按鈕亮＝由 applied 推、按下去改 draft");
    assert.ok(src.includes("p={applied}") && !/maSet=\{maSet\}/.test(src), "圖與圖例吃 applied");
  });
  await t("migrateRules（11-24 舊訪客）：存的 cur＝舊預設 EMA5/10/20 → 新預設 SMA（「短」亮）；改過一欄 → 保留；壞資料 → 新預設；新預設不變；saved 不動", async () => {
    const def = lib3.normParams({}).p;
    const old = { ma: "ema", ma_n: [5, 10, 20], fresh_n: 3, vol_on: true, vol_in: 1.2, vol_n: 10, side_ma: true,   // 改版前 DEFAULT_PARAMS 原文
      stop: "low_n", stop_n: 3, stop_pct: 5, atr_n: 14, atr_k: 2, stop_on: "touch", exit_ma: true, exit_k: 2, exit_delay: 0, vol_exit: true, vol_out: 2,
      max_hold_on: false, max_hold: 20, dir: "both", fee: 0, slip: 0, entry: "ma" };
    const m = P.migrateRules(old);
    assert.deepStrictEqual(m, def); assert.strictEqual(P.maSetOf(m), "short");
    const { entry, ...pre1123 } = old;   // 11-23 前存的沒有 entry 欄位＝當時也是預設
    assert.deepStrictEqual(P.migrateRules(pre1123), def);
    for (const [k, v] of [["ma_n", [5, 10, 21]], ["stop_n", 4], ["vol_on", false], ["dir", "long"], ["fee", 0.1], ["entry", "keyk"]]) {
      const c = { ...old, [k]: v }, r = P.migrateRules(c);
      assert.deepStrictEqual(r, lib3.normParams(c).p, "改過 " + k + " 要保留"); assert.strictEqual(r.ma, "ema"); assert.strictEqual(P.maSetOf(r), null);
    }
    for (const bad of [null, undefined, "x", 42, [], {}]) assert.deepStrictEqual(P.migrateRules(bad), def, "壞資料：" + JSON.stringify(bad));
    assert.deepStrictEqual(P.migrateRules(def), def, "新預設不變");
    const mine = { ...def, ma_n: [8, 13, 34] }; assert.deepStrictEqual(P.migrateRules(mine), mine);
    const sv = [{ name: "舊預設存一份", p: old }, { name: "我的", p: { ...old, stop_n: 5 } }];
    const cr = P.cleanRules({ cur: old, saved: sv, active: null });
    assert.deepStrictEqual(cr.cur, def);
    assert.deepStrictEqual(cr.saved, [{ name: "舊預設存一份", p: old }, { name: "我的", p: { ...old, stop_n: 5 } }], "saved 一律不動");
    assert.strictEqual(cr.active, null);
    const ca = P.cleanRules({ cur: old, saved: sv, active: "舊預設存一份" });   // 套用中的是自己存的規則 → cur 不遷移
    assert.deepStrictEqual(ca.cur, old, "套用自己存的規則不遷移"); assert.strictEqual(ca.active, "舊預設存一份");
    assert.deepStrictEqual(P.cleanRules({ cur: old, saved: sv, active: "內建：預設規則" }).cur, def, "套用內建預設照樣遷移");
  });
  await t("舊版內建策略遷移（11-24 Yoda）：cur＝舊版（EMA）短線快出／波段抱長／只做多・固定 5% → 新版同名、active 指向它；套用自己存的規則照舊；saved 不動", async () => {
    // 1edf010 lib/ta-trade.js 的 normParams(PRESETS[k].p).p 原文（git show 逐欄核對過）
    const base = { ma: "ema", ma_n: [5, 10, 20], fresh_n: 3, vol_on: true, vol_in: 1.2, vol_n: 10, side_ma: true, stop: "low_n", stop_n: 3, stop_pct: 5, atr_n: 14, atr_k: 2,
      stop_on: "touch", exit_ma: true, exit_k: 2, exit_delay: 0, vol_exit: true, vol_out: 2, max_hold_on: false, max_hold: 20, dir: "both", fee: 0, slip: 0, entry: "ma" };
    const OLD = { "短線快出": { ...base, stop_n: 2, exit_k: 1 }, "波段抱長": { ...base, stop: "atr", exit_k: 3, exit_delay: 3 }, "只做多・固定 5%": { ...base, stop: "pct", max_hold_on: true, dir: "long" } };
    const sv = [{ name: "我的", p: { ...base, stop_n: 5 } }];
    for (const [nm, o] of Object.entries(OLD)) {
      const nw = lib3.normParams(lib3.PRESETS.find((x) => x.name === nm).p).p;
      assert.strictEqual(nw.ma, "sma"); assert.deepStrictEqual({ ...nw, ma: "ema" }, o, nm + "：新版跟舊版只差 ma");
      for (const act of [null, "內建：" + nm, "內建：預設規則"]) {
        const r = P.cleanRules({ cur: o, saved: sv, active: act });
        assert.deepStrictEqual(r.cur, nw, nm + " active=" + act); assert.strictEqual(r.active, "內建：" + nm); assert.deepStrictEqual(r.saved, sv, "saved 不動");
        assert.strictEqual(P.maSetOf(r.cur), "short");
      }
      const { entry, ...noEntry } = o;   // 11-23 前存的沒有 entry
      assert.strictEqual(P.cleanRules({ cur: noEntry, saved: [], active: null }).active, "內建：" + nm);
      const mine = P.cleanRules({ cur: o, saved: [{ name: "我的", p: o }], active: "我的" });   // 套用自己存的規則 → 不遷移
      assert.deepStrictEqual([mine.cur, mine.active], [o, "我的"]);
      const tweak = P.cleanRules({ cur: { ...o, fee: 0.1 }, saved: [], active: "內建：" + nm });   // 改過一欄 → 不是舊版內建
      assert.strictEqual(tweak.cur.ma, "ema"); assert.strictEqual(tweak.cur.fee, 0.1);
      assert.deepStrictEqual(P.cleanRules({ cur: nw, saved: [], active: "內建：" + nm }).cur, nw, "新版不動");
    }
    const ls = P.cleanRules({ cur: lib3.normParams(lib3.PRESETS[4].p).p, saved: [], active: null });   // 長線 SMA 本來就是 SMA、沒變 → 不認成舊版
    assert.strictEqual(ls.active, null);
    assert.strictEqual(P.oldBuiltin(null), null); assert.strictEqual(P.oldBuiltin("x"), null);
  });
  await t("反彈／修正五階段：工具列兩顆鈕在關鍵K 旁、預設關、localStorage；共振閃爍 8 小時、點過就停；日K 收盤時間（台指期 13:45）", async () => {
    const src = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
    assert.ok(/data-kk>關鍵K<\/button>\s*<span className="ta-seglab ta-glab"[^>]*>五階段<\/span>[^\n]*\s*<button[^>]*aria-label="反彈五階段" data-b5>反彈<\/button>\s*<button[^>]*aria-label="修正五階段" data-c5>修正<\/button>/.test(src), "鈕在關鍵K 旁（11-24：組名「五階段」＋反彈／修正，aria-label 全名）");
    assert.strictEqual(P.readB5(), false); assert.strictEqual(P.readC5(), false);
    assert.ok(src.includes('pickB5 = () => { setB5On(!b5On); lsSet(B5_KEY, b5On ? "0" : "1"); pickView("chart"); }'));
    assert.ok(!/fiveStage|co5|f5/.test(src.slice(src.indexOf("function RulePanel"), src.indexOf("function RulePanel") + 20000).split("\n// ")[0]), "不進面板");
    const TZ = "America/New_York", e = P.barEndTf("2026-11-23 14:00", "4H", TZ, "fut");
    assert.strictEqual(e, P.tzMs("2026-11-23 17:00", TZ), "期貨 4H 14:00 那根收在 17:00");
    assert.strictEqual(P.barEndTf("2026-11-23", "D", "Asia/Taipei", "tw"), P.tzMs("2026-11-23 13:30", "Asia/Taipei"));
    // 台指期／費半期（期交所，market fut＋Asia/Taipei）：日K 那根＝前一天夜盤＋當天日盤，收在當天 13:45；美國期貨日K 照舊 17:00（美東）
    const TPE = "Asia/Taipei", twfD = P.barEndTf("2026-11-23", "D", TPE, "fut");
    assert.strictEqual(twfD, P.tzMs("2026-11-23 13:45", TPE), "台指期日K 收在 13:45");
    assert.strictEqual(P.barEndTf("2026-11-23", "D", TZ, "fut"), P.tzMs("2026-11-23 17:00", TZ), "美國期貨日K 17:00");
    // 週K（11-24）：引擎標在該週最後一個交易日 → 收在那天收盤
    assert.strictEqual(P.barEndTf("2026-11-27", "W", TPE, "fut"), P.tzMs("2026-11-27 13:45", TPE), "台指期週K 週五 13:45");
    assert.strictEqual(P.barEndTf("2026-11-20", "W", TZ, "us"), P.tzMs("2026-11-20 16:00", TZ), "一般週：美股週五 16:00");
    assert.strictEqual(P.barEndTf("2026-11-20", "W", TPE, "tw"), P.tzMs("2026-11-20 13:30", TPE), "一般週：台股週五 13:30");
    assert.strictEqual(P.barEndTf("2026-11-27", "W", TZ, "us"), P.tzMs("2026-11-27 13:00", TZ), "感恩節週：週五半日市 13:00");
    assert.strictEqual(P.barEndTf("2026-11-27", "W", TZ, "fut"), P.tzMs("2026-11-27 17:00", TZ), "感恩節週：美國期貨照舊 17:00");
    assert.strictEqual(P.barEndTf("2026-11-27", "D", TZ, "us"), P.tzMs("2026-11-27 13:00", TZ), "半日市日K 也 13:00");
    assert.strictEqual(P.barEndTf("2026-12-24", "W", TZ, "us"), P.tzMs("2026-12-24 13:00", TZ), "耶誕週：週五休市、週四半日市 13:00");
    assert.strictEqual(P.barEndTf("2026-12-24", "W", TPE, "tw"), P.tzMs("2026-12-24 13:30", TPE), "耶誕週：台股 12-25 行憲紀念日休市、收週四");
    assert.strictEqual(P.barEndTf("2026-02-11", "W", TPE, "tw"), P.tzMs("2026-02-11 13:30", TPE), "農曆春節週：收在春節前最後交易日（週三）");
    assert.strictEqual(P.barEndTf("2027-02-01", "W", TPE, "fut"), P.tzMs("2027-02-01 13:45", TPE), "2027 春節週：只有週一，台指期 13:45");
    // 週五休市那週：引擎週五收盤才定案 → 8 小時從週五收盤起算（週四收盤後就算已收完）
    const gf = [{ t: "2026-03-27" }, { t: "2026-04-02" }], gco = [{ side: "s", key: 3, iA: 0, iB: 1, late: 1 }];
    assert.strictEqual(P.co5Live(gco, gf, "W", TZ, "us", P.tzMs("2026-04-02 15:59", TZ), [], "NQ|W|").length, 0, "耶穌受難日週：週四收盤前不閃");
    assert.strictEqual(P.co5Live(gco, gf, "W", TZ, "us", P.tzMs("2026-04-03 16:30", TZ), [], "NQ|W|").length, 1, "週五定案後在閃");
    assert.strictEqual(P.co5Live(gco, gf, "W", TZ, "us", P.tzMs("2026-04-04 00:30", TZ), [], "NQ|W|").length, 0, "週五收盤過 8 小時停");
    const nw = [{ t: "2026-11-13" }, { t: "2026-11-20" }];
    assert.strictEqual(P.co5Live(gco, nw, "W", TZ, "us", P.tzMs("2026-11-20 23:50", TZ), [], "NQ|W|").length, 1, "一般週：週五 16:00 起 8 小時內閃");
    assert.strictEqual(P.co5Live(gco, nw, "W", TZ, "us", P.tzMs("2026-11-21 00:10", TZ), [], "NQ|W|").length, 0, "一般週：過 8 小時停");
    const dbars = [{ t: "2026-11-20" }, { t: "2026-11-23" }], dco = [{ side: "s", key: 3, iA: 0, iB: 1, late: 1 }];
    assert.strictEqual(P.co5Live(dco, dbars, "D", TPE, "fut", twfD - 60e3, [], "TXF|D|").length, 0, "13:44 還沒收完不閃");
    assert.strictEqual(P.co5Live(dco, dbars, "D", TPE, "fut", twfD + 60e3, [], "TXF|D|").length, 1, "13:46 起閃");
    assert.strictEqual(P.co5Live(dco, dbars, "D", TPE, "fut", P.tzMs("2026-11-23 21:40", TPE), [], "TXF|D|").length, 1, "21:40（7 小時 55 分）還在閃");
    assert.strictEqual(P.co5Live(dco, dbars, "D", TPE, "fut", P.tzMs("2026-11-23 21:50", TPE), [], "TXF|D|").length, 0, "21:50（過 8 小時）停");
    const bars = [{ t: "2026-11-23 10:00" }, { t: "2026-11-23 11:00" }, { t: "2026-11-23 12:00" }], cos = [{ side: "s", key: 2, iA: 0, iB: 2, late: 2 }];
    const end = P.barEndTf("2026-11-23 12:00", "1H", TZ, "us");
    assert.strictEqual(P.co5Live(cos, bars, "1H", TZ, "us", end + 3600e3, [], "NQ|1H|").length, 1, "1 小時後還在閃");
    assert.strictEqual(P.co5Live(cos, bars, "1H", TZ, "us", end + 8.1 * 3600e3, [], "NQ|1H|").length, 0, "過 8 小時停");
    assert.strictEqual(P.co5Live(cos, bars, "1H", TZ, "us", end - 60e3, [], "NQ|1H|").length, 0, "還沒收完不算");
    const id = P.co5Live(cos, bars, "1H", TZ, "us", end + 60e3, [], "NQ|1H|")[0].id;
    assert.strictEqual(P.co5Live(cos, bars, "1H", TZ, "us", end + 60e3, [id], "NQ|1H|").length, 0, "點過就停");
  });
  await t("劇本（11-24）：工具列兩顆鈕在五階段後面、用分隔；一次只開一顆、再按收起；週K 停用（說明在 title／aria）；不記 localStorage", async () => {
    const src = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
    assert.ok(/data-c5>修正<\/button>\s*<ScBtns sc=\{scOn\} tf=\{tf\} onPick=\{pickSc\} \/>/.test(src), "鈕緊接在修正五階段後面");
    const html = (o) => renderToString(React.createElement("div", null, React.createElement(P.ScBtns, { sc: null, tf: "4H", onPick: () => {}, ...o }))).replace(/<!-- -->/g, "");
    const h0 = html({});
    assert.ok(/<span class="ta-vsep" aria-hidden="true"><\/span><span class="ta-seglab" aria-hidden="true">劇本<\/span><button[^>]*aria-label="空轉多劇本" data-sc="up"[^>]*>空轉多<\/button><button[^>]*aria-label="多轉空劇本" data-sc="dn"[^>]*>多轉空<\/button>/.test(h0), "分隔＋組名「劇本」＋兩顆鈕（11-24 縮短，aria-label 全名）：" + h0);
    assert.strictEqual((h0.match(/aria-pressed="true"/g) || []).length, 0, "預設都沒開");
    const hu = html({ sc: "up" });
    assert.ok(/aria-pressed="true" class="ta-tab on"[^>]*data-sc="up"/.test(hu) && /aria-pressed="false" class="ta-tab"[^>]*data-sc="dn"/.test(hu), "開空轉多：只有那顆亮");
    for (const tf of ["1H", "4H", "D"]) assert.ok(!html({ tf }).includes("disabled") && !html({ tf }).includes("劇本限"), tf + " 可用");
    const hw = html({ sc: "up", tf: "W" });
    assert.strictEqual((hw.match(/disabled=""/g) || []).length, 2, "週K 兩顆停用");
    assert.strictEqual((hw.match(/aria-pressed="true"/g) || []).length, 0, "週K 不顯示開著");
    assert.strictEqual((hw.match(/title="劇本限 1H／4H／日K"/g) || []).length, 2, "週K 說明只放停用鈕 title");
    assert.ok(hw.includes('aria-label="空轉多劇本，劇本限 1H／4H／日K"') && !hw.includes("data-sc-off"), "週K 說明放 aria、工具列不另放字（1440 排一行）");
    assert.strictEqual(P.nextSc(null, "up"), "up"); assert.strictEqual(P.nextSc("up", "dn"), "dn", "互斥：按另一顆＝換過去");
    assert.strictEqual(P.nextSc("up", "up"), null, "再按收起"); assert.strictEqual(P.nextSc("dn", "dn"), null);
    assert.ok(src.includes("const pickSc = (k) => { setScOn((x) => nextSc(x, k)); pickView(\"chart\"); };"), "按下就回 K 線圖");
    assert.ok(!/yoda_ta_sc|lsSet\([^)]*[Ss]c[A-Z]?On/.test(src), "不記 localStorage");
    assert.ok(src.includes('sc={SC_TFS.includes(d.tf) ? scOn : null}'), "週K 不傳劇本給圖");
    assert.deepStrictEqual(P.SC_TFS, ["1H", "4H", "D"]);
  });
  await t("劇本（11-24）：圖上示意區（淡底 .022、虛線框 .32）、今天線、半透明示意 K、子分頁＋可能性高→低、點位表、示意不是預測只在圖下一行；算不出＝一行字", async () => {
    const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "ta_5stage_nq4h.json"), "utf8"));
    const B = fx.bars, n = B.length, col = (j) => B.map((x) => x[j]);
    const d = { tf: "4H", symbol: { yahoo: "NQ=F", code: "NQ1!", market: "fut", timezone: "America/New_York" }, bars_completed: n,
      history: { t: col(0), o: col(1), h: col(2), l: col(3), c: col(4), v: col(5) }, chart: { bars: B.slice(-120).map((x) => ({ t: x[0], o: x[1], h: x[2], l: x[3], c: x[4], v: x[5] })) } };
    const p = lib3.normParams({ ma: "sma", ma_n: [8, 13, 34] }).p;
    const ca = (sc) => renderToString(React.createElement(P.ChartArea, { d, p, srOn: false, kkOn: false, sc })).replace(/<!-- -->/g, "");
    const off = ca(null);
    assert.ok(!off.includes("data-sim") && !off.includes("ta-sctl") && !off.includes("data-scpo") &&!off.includes("示意，不是預測"), "沒開不畫");
    const h = ca("up");
    assert.ok(/<rect class="sc-box"[^>]*fill="#9fb0c4" fill-opacity=".022" stroke="#9fb0c4" stroke-opacity=".32" stroke-dasharray="5 4"/.test(h), "示意區淡底＋虛線框");
    assert.ok(/<line class="sc-today"/.test(h) && h.includes("今天 " + B[n - 1][0].slice(5)), "今天線標最後一根收完的 K");
    assert.ok(/class="bd sim"[^>]*fill-opacity=".5"/.test(h), "示意 K 半透明");
    assert.ok(/role="tablist" aria-label="空轉多劇本"/.test(h) && h.includes("可能性高→低"), "子分頁＋可能性高→低");
    for (const nm of ["回踩 SMA34 再攻", "強勢上漲", "W 底回測多方關鍵K", "破底翻"]) assert.ok(h.includes(nm), "分頁名 " + nm);
    assert.strictEqual((h.match(/示意，不是預測/g) || []).length, 1, "只寫一次");
    assert.ok(/<div class="ta-scfoot">示意，不是預測<\/div>/.test(h), "寫在圖下");
    assert.ok(/data-scplan=""/.test(h) && h.includes("進場") && h.includes("出場1") && h.includes("出場2") && h.includes("停損"), "點位表");
    assert.ok(/data-n="(\d+)"/.test(h) && +h.match(/data-n="(\d+)"/)[1] > 120, "圖接上示意段");
    const hd = ca("dn");
    assert.ok(/aria-label="多轉空劇本"/.test(hd) && hd.includes("反彈測 SMA34 不過再跌") && hd.includes("假突破翻黑"), "多轉空四個分頁");
    for (const w of ["建議", "應該", "最佳", "推薦", "機率", "停利", "加碼", "出一半", "保本"]) assert.ok(!h.includes(w) && !hd.includes(w), "不寫「" + w + "」");
    // 算不出：沒有成交量 → 沒有多方關鍵K → W 底那條 null；ScPlan 寫一行字
    const nv = renderToString(React.createElement(P.ScPlan, { scr: { dir: 1, names: ["a", "b", "c", "d"], lv: [], list: [null, null, null, null] }, cur: null }));
    assert.ok(nv.includes("這檔目前算不出這個劇本") && !nv.includes("<table"), "算不出不硬畫");
    const tabs = renderToString(React.createElement(P.ScTabs, { scr: { dir: -1, names: ["a", "b", "c", "d"], list: [null, {}, null, null] }, k: 0, onPick: () => {} }));
    assert.ok(/class="ta-tab on none"/.test(tabs) && !/disabled/.test(tabs), "算不出的分頁照樣能點（點了顯示那行字）");
    const info = P.scInfo({ name: "x", dir: -1 }, { kind: "stop", name: "停損", cond: "c", p: 10, pnl: -2, pct: -1.5 });
    assert.strictEqual(info.sub, "示意段內未觸發（示意 K）"); assert.strictEqual(info.cls, "short");
    // 11-24 審查：開劇本時圖下 ③ 的區間說明只算實際 K（結尾日期不空白、根數不含示意 K）
    const ls0 = global.localStorage; global.localStorage = { getItem: (k) => (k === "yoda_ta_blk" ? "vol" : null), setItem() {} };
    const ce = console.error; console.error = () => {};
    let caps; try { caps = [null, "up"].map((sc) => (ca(sc).match(/③ 前五大量 <span class="mut">區間 ([^<]*?) 已定案/) || [])[1]); } finally { console.error = ce; global.localStorage = ls0; }
    assert.ok(caps[0] && caps[0].endsWith(B[n - 1][0] + "（120 根）"), "沒開劇本 " + caps[0]);
    assert.strictEqual(caps[1], caps[0], "開劇本後說明變了");
    // 11-24 審查：K 棒合併（grp>1）不跨「今天」：實際 K 那組只含實際 K
    const NN = 1600, AT = 1551, bb = [];
    let c0 = 100; for (let i = 0; i < NN; i++) { const o = c0; c0 = i >= AT ? c0 + 5 : c0 + Math.sin(i) * 0.5; bb.push({ t: "2026-01-01 00:00", o, h: Math.max(o, c0) + 0.3, l: Math.min(o, c0) - 0.3, c: c0, v: 10 }); }
    const kh = renderToString(React.createElement(P.KChart, { d: { tf: "1H", symbol: { yahoo: "X", market: "us", timezone: "America/New_York" }, chart: {} },
      full: { bars: bb, c: bb.map((x) => x.c), k0: 0 }, smas: [], yr: null, a: 0, b: NN, gaps: [], islands: [], top: [], rolls: [], sc: { at: AT, dir: 1, name: "x", plan: [] } }));
    const seg = (cls) => [...kh.matchAll(/<path class="(bd(?: sim)?)" d="([^"]*)"/g)].filter((x) => x[1] === cls).reduce((z, x) => z + (x[2].match(/M/g) || []).length, 0);
    assert.deepStrictEqual([seg("bd"), seg("bd sim")], [Math.ceil(AT / 2), Math.ceil((NN - AT) / 2)], "合併跨過今天");
    // 11-24 審查：在示意段裡放大再收起劇本 → 回預設區間（不是只剩 2 根）
    const srcCA = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
    assert.ok(/const gone = rng\[0\] > NX - 2;\s*const b = gone \? NX : Math\.min\(rng\[1\], NX\), a = gone \? def0 :/.test(srcCA), "收起劇本後區間回預設");
  });
  await t("劇本點位一個數字（11-24）：同一點的價位虛線、右側標籤、點位表都是成交價；觸發價寫在條件欄（NQ 4H 兩個方向，進場成交價≠觸發價）", async () => {
    const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "ta_5stage_nq4h.json"), "utf8"));
    // 11-24 稽核加距離上限後 NQ 4H 多轉空四條都算不出：多轉空改用上下翻轉的 NQ（＝原資料空轉多的鏡像，四條照樣有）
    const NB = fx.bars, K = scLib.exports.mirrorK(NB.map((x) => ({ h: x[2], l: x[3] })), scLib.exports.tickOf(NB.map((x) => ({ o: x[1], h: x[2], l: x[3], c: x[4] }))));
    const FB = NB.map(([t0, o, h, l, c, v]) => [t0, K - o, K - l, K - h, K - c, v]);
    const dOf = (B) => { const n = B.length, col = (j) => B.map((x) => x[j]); return { tf: "4H", symbol: { yahoo: "NQ=F", code: "NQ1!", market: "fut", timezone: "America/New_York" }, bars_completed: n,
      history: { t: col(0), o: col(1), h: col(2), l: col(3), c: col(4), v: col(5) }, chart: { bars: B.slice(-120).map((x) => ({ t: x[0], o: x[1], h: x[2], l: x[3], c: x[4], v: x[5] })) } }; };
    const fp = (x) => Number(x).toLocaleString("en-US", { maximumFractionDigits: 4 });
    for (const ma_n of [[5, 10, 20], [8, 13, 34]]) for (const [sc, dir] of [["up", 1], ["dn", -1]]) {
      const p = lib3.normParams({ ma: "sma", ma_n }).p, nm = ma_n.join("/") + " " + sc, B = dir === 1 ? NB : FB, d = dOf(B);
      const h = renderToString(React.createElement(P.ChartArea, { d, p, srOn: false, kkOn: false, sc })).replace(/<!-- -->/g, "");
      const lines = Object.fromEntries([...h.matchAll(/<line class="sc-lv (\w+)"[^>]*data-p="([^"]+)"/g)].map((x) => [x[1], +x[2]]));
      // 11-24 稽核：右側標籤寫「劇本進場／劇本停損／劇本出場1／劇本出場2」（跟策略的停損、進場分開）；點位表欄名不變
      const labs = Object.fromEntries([...h.matchAll(/<text class="srl mk-lab"[^>]*>[↑↓]?劇本(進場|停損|出場1|出場2) ([^<]+)<\/text>/g)].map((x) => [x[1], x[2]]));
      const rows = [...h.matchAll(/<span class="sc-k (\w+)">([^<]*)<\/span><\/td><td[^>]*>([^<]*)<\/td><td[^>]*>([^<]*)<\/td>/g)].map((x) => ({ kind: x[1], name: x[2], cond: x[3], px: x[4] }));
      assert.strictEqual(rows.length, 4, nm + " 點位表四列");
      const plan = scLib.exports.scenarios(B.map((x) => ({ t: x[0], o: x[1], h: x[2], l: x[3], c: x[4], v: x[5] })), { tf: "4H", mkt: "fut", tz: "America/New_York", ma: "sma", ma_n, dir }).list[0].plan;
      for (const r of rows) {
        const pr = plan.find((z) => z.kind === r.kind);
        if (pr.level == null) { assert.ok(!(r.kind in lines) && !(r.name in labs), nm + " " + r.name + " 沒觸發價＝不畫線"); continue; }
        assert.strictEqual(labs[r.name], r.px, nm + " " + r.name + " 標籤 " + labs[r.name] + " ≠ 點位表 " + r.px);
        assert.strictEqual(fp(lines[r.kind]), r.px, nm + " " + r.name + " 虛線 " + lines[r.kind] + " ≠ 點位表 " + r.px);
        assert.ok(r.cond.includes(fp(pr.level)), nm + " " + r.name + " 條件要寫觸發價 " + fp(pr.level) + "：" + r.cond);
      }
      const en = plan.find((z) => z.kind === "entry");
      assert.ok(en.p !== en.level && labs["進場"] === fp(en.p) && !h.includes("劇本進場 " + fp(en.level) + "<"), nm + " 進場標籤是成交價、不是觸發價");
      const mk = [...h.matchAll(/<text class="sc-t mk-lab"[^>]*>([^<]+)<\/text>/g)].map((x) => x[1]);
      assert.deepStrictEqual(mk, ["劇本進場", "劇本出場1", "劇本出場2"], nm + " 記號文字");
      const cols = [...h.matchAll(/<line class="sc-lv \w+"[^>]*stroke="([^"]+)"/g)].map((x) => x[1].toLowerCase());
      assert.ok(cols.length === rows.filter((r) => plan.find((z) => z.kind === r.kind).level != null).length && cols.length >= 3 && cols.every((c) => c !== "#ff4d4d" && c !== "#9ad0ff" && c !== "#ffc94a"), nm + " 劇本線色跟策略停損紅／進場淡藍分開：" + cols);
    }
  });
  await t("劇本只看路徑（11-24）：亮＝只剩示意 K（示意區、今天線、延伸均線），沒有規劃點記號／虛線／右側標籤／點位表；熄＝照舊；記 localStorage、讀不到＝熄；劇本關時不顯示", async () => {
    const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "ta_5stage_nq4h.json"), "utf8"));
    const NB = fx.bars, K = scLib.exports.mirrorK(NB.map((x) => ({ h: x[2], l: x[3] })), scLib.exports.tickOf(NB.map((x) => ({ o: x[1], h: x[2], l: x[3], c: x[4] }))));
    const dOf = (B) => { const n = B.length, col = (j) => B.map((x) => x[j]); return { tf: "4H", symbol: { yahoo: "NQ=F", code: "NQ1!", market: "fut", timezone: "America/New_York" }, bars_completed: n,
      history: { t: col(0), o: col(1), h: col(2), l: col(3), c: col(4), v: col(5) }, chart: { bars: B.slice(-120).map((x) => ({ t: x[0], o: x[1], h: x[2], l: x[3], c: x[4], v: x[5] })) } }; };
    // 多轉空用上下翻轉的 NQ（11-24 距離上限後原資料多轉空四條都算不出）
    const d = dOf(NB), dF = dOf(NB.map(([t0, o, h, l, c, v]) => [t0, K - o, K - l, K - h, K - c, v]));
    const p = lib3.normParams({ ma: "sma", ma_n: [8, 13, 34] }).p;
    const ls0 = global.localStorage, st = {};
    global.localStorage = { getItem: (k) => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); }, removeItem: (k) => { delete st[k]; } };
    const ca = (sc) => renderToString(React.createElement(P.ChartArea, { d: sc === "dn" ? dF : d, p, srOn: false, kkOn: false, sc })).replace(/<!-- -->/g, "");
    try {
      for (const sc of ["up", "dn"]) {
        delete st.yoda_ta_path;
        const off = ca(sc);
        assert.ok(/aria-pressed="false" class="ta-tab ta-scpo" data-scpo="">只看路徑<\/button>/.test(off), sc + " 熄：鈕在子分頁那排");
        assert.ok(/sc-mk/.test(off) && /class="sc-lv /.test(off) && /data-scplan=""/.test(off), sc + " 熄：記號、虛線、點位表照舊");
        st.yoda_ta_path = "1";
        const on = ca(sc);
        assert.ok(/aria-pressed="true" class="ta-tab ta-scpo on"/.test(on), sc + " 亮");
        assert.ok(!/sc-mk|class="sc-lv |sc-t mk-lab|data-tip="sc"|data-scplan|ta-sclv/.test(on), sc + " 亮：不畫規劃點、虛線、標籤、點位表");
        assert.ok(/data-sim=""/.test(on) && /<line class="sc-today"/.test(on) && /class="bd sim"/.test(on) && on.includes("示意 K →"), sc + " 亮：示意區、今天線、示意 K 還在");
        assert.strictEqual(+on.match(/data-n="(\d+)"/)[1], +off.match(/data-n="(\d+)"/)[1], "示意段長度一樣（均線跟著延伸）");
        assert.ok(/<div class="ta-scfoot">示意，不是預測<\/div>/.test(on), "圖下那行照留");
      }
      assert.ok(!ca(null).includes("只看路徑"), "劇本關時不顯示");
      st.yoda_ta_path = "1"; assert.strictEqual(P.readPo(), true);
      st.yoda_ta_path = "x"; assert.strictEqual(P.readPo(), false);
      global.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
      assert.strictEqual(P.readPo(), false, "讀不到＝熄");
    } finally { global.localStorage = ls0; }
    const raw = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
    assert.ok(raw.includes('const PO_KEY = "yoda_ta_path";') && raw.includes('const pickPo = () => { setPo(!po); lsSet(PO_KEY, po ? "0" : "1"); };'), "記 localStorage（兩種劇本同一個 key）");
  });
  await t("全螢幕（11-24）：鈕在圖上方「只看路徑」右邊（劇本關時那排只剩它）、工具列不再有 ⛶；有 API → requestFullscreen（含 webkit）、再按 exitFullscreen；沒有／被拒 → CSS 退路 class、再按還原", async () => {
    const raw = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
    const tb = raw.slice(raw.indexOf('<div className="ta-seg ta-vseg">'), raw.indexOf('<div className="ta-pane" hidden={view !== "chart"}>'));
    assert.ok(tb.includes(">選擇權</button>") && !/ta-fsbtn|⛶|fsBtn/.test(tb.slice(0, tb.indexOf("計算中"))), "工具列不再有全螢幕鈕");
    assert.ok(/const fsBtn = \(\s*<button type="button" aria-pressed=\{!!fs\} className=\{"ta-tab ta-fsbtn"[^>]*aria-label="全螢幕"/.test(raw) && raw.includes("fsBtn={fsBtn} fs={!!fs} />"), "鈕交給 ChartArea");
    assert.ok(raw.includes('{fs && !(view === "chart" && d) ? <div className="ta-sctabs">{fsBtn}</div> : null}'), "全螢幕中切到別的分頁：離開鈕照樣在");
    const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "ta_5stage_nq4h.json"), "utf8"));
    const B = fx.bars, n = B.length, col = (j) => B.map((x) => x[j]);
    const d = { tf: "4H", symbol: { yahoo: "NQ=F", code: "NQ1!", market: "fut", timezone: "America/New_York" }, bars_completed: n,
      history: { t: col(0), o: col(1), h: col(2), l: col(3), c: col(4), v: col(5) }, chart: { bars: B.slice(-120).map((x) => ({ t: x[0], o: x[1], h: x[2], l: x[3], c: x[4], v: x[5] })) } };
    const fb = React.createElement("button", { type: "button", className: "ta-tab ta-fsbtn", "data-fs": "" }, "⛶ 全螢幕");
    const ca = (sc) => renderToString(React.createElement(P.ChartArea, { d, p: lib3.normParams({ ma: "sma", ma_n: [8, 13, 34] }).p, srOn: false, kkOn: false, sc, fsBtn: fb })).replace(/<!-- -->/g, "");
    assert.ok(/data-scpo="">只看路徑<\/button><button type="button" class="ta-tab ta-fsbtn" data-fs="">⛶ 全螢幕<\/button><\/div>/.test(ca("up")), "劇本開：緊接在只看路徑右邊、同一排");
    assert.ok(/^<div class="ta-sctabs"><button type="button" class="ta-tab ta-fsbtn" data-fs="">⛶ 全螢幕<\/button><\/div>/.test(ca(null)), "劇本關：那排照樣在、只有全螢幕鈕");
    const css0 = fs.readFileSync(path.join(ROOT, "app", "ta", "ta.css"), "utf8");
    assert.ok(!css0.includes(".ta-tabs .ta-fsbtn") && !css0.includes(".ta-tabs{gap:4px;padding-right:4px}"), "工具列間距還原（組間 6、右留白 8）");
    assert.ok(raw.includes('<div ref={fsRef} className={"ta-right" + (fs ? " ta-fs" : "") + (fs === 2 ? " ta-fsfb" : "")}>'), "全螢幕的是右欄（工具列＋圖＋導覽列，不含左側面板）；退路 class ta-fsfb");
    assert.ok(raw.includes('document.addEventListener("fullscreenchange", sync)') && raw.includes('document.addEventListener("webkitfullscreenchange", sync)'), "狀態跟 document.fullscreenElement 同步");
    assert.ok(/document\.body\.style\.overflow = "hidden";[\s\S]{0,200}document\.body\.style\.overflow = ov;/.test(raw), "退路：body 不捲、離開還原");
    assert.ok(raw.includes("fs={!!fs} /></Boundary>"), "圖知道全螢幕（量寬高重畫）");
    const css = fs.readFileSync(path.join(ROOT, "app", "ta", "ta.css"), "utf8");
    assert.ok(/\.ta-right\.ta-fsfb\{position:fixed;inset:0;z-index:9000\}/.test(css), "CSS 退路鋪滿");
    const calls = [], got = [], set = (v) => got.push(v);
    const el = { requestFullscreen() { calls.push("req"); return Promise.resolve(); } }, doc = { fullscreenElement: null, exitFullscreen() { calls.push("exit"); } };
    P.toggleFs(el, 0, set, doc); assert.deepStrictEqual(calls, ["req"]); assert.deepStrictEqual(got, [], "API 成功：狀態由 fullscreenchange 設");
    doc.fullscreenElement = el; P.toggleFs(el, 1, set, doc); assert.deepStrictEqual(calls, ["req", "exit"], "再按離開");
    const wk = [], wel = { webkitRequestFullscreen() { wk.push("wreq"); } }, wdoc = { webkitFullscreenElement: null, webkitExitFullscreen() { wk.push("wexit"); } };
    P.toggleFs(wel, 0, set, wdoc); wdoc.webkitFullscreenElement = wel; P.toggleFs(wel, 1, set, wdoc); assert.deepStrictEqual(wk, ["wreq", "wexit"], "webkit 前綴");
    got.length = 0; P.toggleFs({}, 0, set, {}); assert.deepStrictEqual(got, [2], "不支援 → CSS 退路");
    got.length = 0; P.toggleFs({}, 2, set, {}); assert.deepStrictEqual(got, [0], "退路再按 → 還原");
    got.length = 0; P.toggleFs({ requestFullscreen() { throw new Error("x"); } }, 0, set, {}); assert.deepStrictEqual(got, [2], "丟例外 → 退路");
    got.length = 0; P.toggleFs({ requestFullscreen: () => Promise.reject(new Error("denied")) }, 0, set, {}); await new Promise((r) => setTimeout(r, 0)); assert.deepStrictEqual(got, [2], "被拒 → 退路");
    // 有 API 但一直不回（內嵌瀏覽器實測：promise 永遠 pending、沒 fullscreenchange）→ 1.5 秒後退路；成功的不會被誤退
    const g2 = [], g3 = [], g4 = [];
    P.toggleFs({ requestFullscreen: () => new Promise(() => {}) }, 0, (v) => g2.push(v), {});
    P.toggleFs({ requestFullscreen: () => Promise.resolve() }, 0, (v) => g3.push(v), {});
    P.toggleFs({ requestFullscreen: () => Promise.reject(new Error("denied")) }, 0, (v) => g4.push(v), {});
    await new Promise((r) => setTimeout(r, 1600));
    assert.deepStrictEqual(g2, [2], "不回應 → 退路"); assert.deepStrictEqual(g3, [], "成功（之後又離開）不誤退");
    assert.deepStrictEqual(g4, [2], "被拒只退一次（1.5 秒內按離開不會又跳回鋪滿）");
    assert.ok(/if \(e\.key === "Escape"\) setFs\(0\);/.test(raw), "退路 Esc 離開");
    assert.ok(/\(W - KL - KR\)/.test(raw) && /live\.current = \{ a, b, N: NX, W: kw \}/.test(raw), "框選換算用目前的圖寬");
    assert.ok(/setKw\(Math\.max\(KW, Math\.round\(\(KH \* el\.clientWidth\) \/ h\)\)\)/.test(raw) && /if \(!fs \|\| !pane\) \{ setKw\(KW\);/.test(raw), "全螢幕量寬高反推圖寬、離開回 KW");
    const kh = (w) => renderToString(React.createElement(P.KChart, { d: { tf: "D", symbol: { yahoo: "X", market: "us" }, chart: {} }, full: { bars: [{ t: "2026-01-01", o: 1, h: 2, l: 0.5, c: 1.5, v: 1 }, { t: "2026-01-02", o: 1.5, h: 2.5, l: 1, c: 2, v: 1 }], c: [1.5, 2], k0: 0 }, smas: [], yr: null, a: 0, b: 2, gaps: [], islands: [], top: [], rolls: [], w }));
    assert.ok(kh(undefined).includes('viewBox="0 0 1000 526"') && kh(1600).includes('viewBox="0 0 1600 526"'), "KChart 依量到的寬重畫（高 526＝KH）");
  });
  await t("pastHalf：TA 票過半才續；普通票、壞票、沒期限 → 要問 status", async () => {
    const tk = (p) => "h." + Buffer.from(JSON.stringify(p)).toString("base64url") + ".s", n = Date.now() / 1000;
    assert.strictEqual(P.pastHalf(tk({ aud: "ta", iat: n - 86400, exp: n + 29 * 86400 })), false);
    assert.strictEqual(P.pastHalf(tk({ aud: "ta", iat: n - 16 * 86400, exp: n + 14 * 86400 })), true);
    assert.strictEqual(P.pastHalf(tk({ aud: "ta", iat: n - 40 * 86400, exp: n - 86400 })), true);   // 已過期
    assert.strictEqual(P.pastHalf(tk({ iat: n, exp: n + 3600 })), true);   // 普通票：換長效票
    assert.strictEqual(P.pastHalf(tk({ aud: "ta" })), true);
    assert.strictEqual(P.pastHalf("garbage"), true); assert.strictEqual(P.pastHalf(""), false);
  });
  await t("波浪分頁（11-24）：「指數位階」右邊有「波浪」鈕、readView 接受 wave、view===wave 才畫 WaveView（帶 call／gate）；工具列其他鈕照樣回 K 線", async () => {
    const raw = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
    assert.ok(raw.includes('import WaveView from "./WaveView";'), "import WaveView");
    assert.ok(/pickView\(view === "idx" \? "chart" : "idx"\)}>指數位階<\/button>\s*<button[^>]*aria-pressed={view === "wave"}[^>]*\s*onClick={\(\) => pickView\(view === "wave" \? "chart" : "wave"\)}>波浪<\/button>\s*<button[^]*?>區間強弱</.test(raw), "「波浪」緊接在「指數位階」右邊、「區間強弱」左邊");
    assert.ok(/{view === "wave" \? \(\s*<div className="ta-pane">\s*<Boundary reset={view}><WaveView call={call} gate={gate} \/><\/Boundary>/.test(raw), "view===wave 才畫，帶 call／gate");
    const st = {}; globalThis.localStorage = { getItem: (k) => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); }, removeItem: (k) => { delete st[k]; } };
    st.yoda_ta_view = "wave"; assert.strictEqual(P.readView(), "wave");
    st.yoda_ta_view = "waves"; assert.strictEqual(P.readView(), "chart");
    assert.ok(raw.includes('.ta-tabs:not([data-view="chart"])') || fs.readFileSync(path.join(ROOT, "app", "ta", "ta.css"), "utf8").includes('.ta-tabs:not([data-view="chart"])'), "非 K 線分頁時其他鈕不顯示選中（同指數位階）");
  });

  await t("多空波段分頁（11-26）：「選擇權」右邊有「多空波段」鈕、readView 接受 swing、view===swing 才畫 SwingView（帶 call／gate）", async () => {
    const raw = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
    assert.ok(raw.includes('import SwingView from "./SwingView";'));
    assert.ok(/>選擇權<\/button>\s*<button[^>]*aria-pressed={view === "swing"}[^>]*\s*onClick={\(\) => pickView\(view === "swing" \? "chart" : "swing"\)}>多空波段<\/button>/.test(raw), "「多空波段」緊接在「選擇權」右邊");
    assert.ok(/{view === "swing" \? \(\s*<div className="ta-pane">\s*<Boundary reset={view}><SwingView call={call} gate={gate} \/><\/Boundary>/.test(raw), "view===swing 才畫");
    const st = {}; globalThis.localStorage = { getItem: (k) => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); }, removeItem: (k) => { delete st[k]; } };
    st.yoda_ta_view = "swing"; assert.strictEqual(P.readView(), "swing");
  });

  await t("訊號開關式（11-24）：點亮著的那顆＝全關 none、全關點哪顆切哪顆；none 存得住；圖上無 ▲▼✕／停損線／出場線；不閃；① 只寫「訊號已全關」；回測照算", async () => {
    assert.strictEqual(P.nextSide("short", "short"), "none"); assert.strictEqual(P.nextSide("all", "all"), "none");
    assert.strictEqual(P.nextSide("none", "long"), "long"); assert.strictEqual(P.nextSide("none", "all"), "all"); assert.strictEqual(P.nextSide("long", "short"), "short");
    const raw = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
    assert.ok(raw.includes("const v = nextSide(side, k); setSide(v); lsSet(SIDE_KEY, v);"), "pickSide 走 nextSide 並存 localStorage");
    assert.ok(raw.includes("aria-pressed={side === k}"), "none 時三顆 aria-pressed 都 false");
    const st = {}; globalThis.localStorage = { getItem: (k) => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); }, removeItem: (k) => { delete st[k]; } };
    st.yoda_ta_side = "none"; assert.strictEqual(P.readSide(), "none", "重新整理保留全關");
    for (const v of ["NONE", "off", " none"]) { st.yoda_ta_side = v; assert.strictEqual(P.readSide(), "all", v); }
    const w = P.withTrade(mkD({}), { ...lib3.normParams({}).p, vol_on: false, fresh_n: 1 });
    assert.ok(w.trade.trades.length > 0 && w.chart.exit_line, "測資要有交易與出場線");
    const kc = (d) => { const full = P.fullSeries(d); return renderToString(React.createElement(P.KChart, { d, full, smas: [], a: 0, b: full.bars.length, gaps: [], islands: [], top: [], rolls: [] })).replace(/<!-- -->/g, ""); };
    const on = kc(w), N = P.sideTrade(w, "none"), off = kc(N);
    assert.ok(/mk-entry|mk-exit/.test(on) && on.includes("exit_ma") && on.includes(">停損<") && /data-kind="stop"/.test(on), "全部：有記號、出場線、停損線");
    assert.ok(!/mk-entry|mk-exit|trlink|mk-lab|data-tip="(entry|exit)"/.test(off), "全關：沒有 ▲▼✕、連線、記號字");
    assert.ok(!off.includes("exit_ma") && !/data-kind="(stop|open_stop|open_entry)"/.test(off) && !off.includes(">停損<") && !off.includes(">出場線"), "全關：沒有停損線、出場線與線名");
    assert.ok(!off.includes("區間內沒有"), "全關不是「沒有某方訊號」");
    assert.strictEqual(w.trade.trades.length > 0 && N.trade.trades.length, 0); assert.ok(w.chart.exit_line, "原資料沒被改（回測照算，點回來立刻有）");
    assert.strictEqual(P.sideTrade(w, "all"), w);
    assert.strictEqual(renderToString(React.createElement(P.BadBanner, { d: { ...w, trade: { ...w.trade, banner: { bad: true, text: "表現不好" } } } })).includes("表現不好"), true);
    assert.strictEqual(renderToString(React.createElement(P.BadBanner, { d: P.sideTrade({ ...w, trade: { ...w.trade, banner: { bad: true, text: "表現不好" } } }, "none") })), "", "全關：圖上方規則表現橫幅不顯示");
    const th = renderToString(React.createElement(P.Trade, { d: N }));
    assert.ok(th.includes("訊號已全關") && !th.includes("<table") && !th.includes("回測期間"), th);
    // 11-24：全關時圖例拿掉交易項目（出場線、進場、停損、✕ 出場、進→出、持倉中、滑過記號），均線／關鍵K／島狀反轉／引擎給的照舊
    const wl = { ...w, chart: { ...w.chart, legend: [{ key: "gap", label: "缺口", desc: "方框" }] } };
    const lgOn = renderToString(React.createElement(P.Legend, { d: wl })).replace(/<!-- -->/g, ""), lgOff = renderToString(React.createElement(P.Legend, { d: P.sideTrade(wl, "none") })).replace(/<!-- -->/g, "");
    const TRL = ["（出場線）", "多進／空進", "</span>停損</dt>", "✕ 出場", "進→出", "持倉中", "滑過記號"], KEEP = ["均線", "關鍵K", "島狀反轉", "缺口", "右側標籤"];
    for (const x of [...TRL, ...KEEP]) assert.ok(lgOn.includes(x), "全部：圖例有 " + x);
    for (const x of TRL) assert.ok(!lgOff.includes(x), "全關：圖例不該有 " + x);
    for (const x of KEEP) assert.ok(lgOff.includes(x), "全關：圖例照留 " + x);
    assert.strictEqual(w.trade_legend.length, wl.trade_legend.length, "原資料圖例沒被改");
    const tr = (side, t) => ({ side, entry_t: t }), now = Date.UTC(2026, 10, 23, 6, 0);
    const r1 = { trades: [tr(-1, "2026-11-23 12:00")], open: { side: 1, entry_t: "2026-11-23 13:00" } }, r4 = { trades: [tr(-1, "2026-11-23 09:00")], open: { side: 1, entry_t: "2026-11-23 12:00" } };
    assert.ok(P.mtfBlink(r1, r4, "Asia/Taipei", "all", now), "測資 all 會閃");
    assert.strictEqual(P.mtfBlink(r1, r4, "Asia/Taipei", "none", now), null, "全關不閃");
  });

  console.log(fails ? "FAILED " + fails : "all passed");
  process.exit(fails ? 1 : 0);
})();
