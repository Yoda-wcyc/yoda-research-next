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
    .replace('"../../lib/ta-rs"', JSON.stringify(path.join(ROOT, "lib", "ta-rs.js").replace(/\\/g, "/"))) + "\nexport { cleanRecent, readRecent, Boundary, headInfo, sideTrade, readSide, Trade, noVolume, mktBadge, KChart, TopVolume, RulePanel, withTrade, fullSeries, TfTabs, FutInfo, RecentDrop, RsView, pastHalf };\n";
  const Mod = require("module");
  const libSrc = transformSync(fs.readFileSync(path.join(ROOT, "lib", "ta-trade.js"), "utf8"), opts).code;
  const lib = new Mod(path.join(ROOT, "lib", "ta-trade.js")); lib.paths = Mod._nodeModulePaths(ROOT); lib._compile(libSrc, lib.id);
  require.cache[lib.id] = lib; lib.loaded = true;
  const rsLib = new Mod(path.join(ROOT, "lib", "ta-rs.js")); rsLib._compile(transformSync(fs.readFileSync(rsLib.id, "utf8"), opts).code, rsLib.id);   // page.jsx 也 import lib/ta-rs（區間強弱，11-13）
  require.cache[rsLib.id] = rsLib; rsLib.loaded = true;
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
    const n = 60, t = [], O = [], H = [], Lo = [], C = [], V = [];
    for (let i = 0; i < n; i++) {
      const c = 100 + 10 * Math.sin(i / 5) + (i >= 40 ? 6 : 0);   // 第 40 根往上跳（當作換月）
      t.push("2026-0" + (1 + Math.floor(i / 28)) + "-" + String(1 + (i % 28)).padStart(2, "0")); O.push(c - 0.5); H.push(c + 1); Lo.push(c - 1); C.push(c);
      V.push(o.noVol ? null : 1000 + (i % 3) * 800);
    }
    const bars = t.slice(-40).map((x, k) => ({ t: x, o: O[20 + k], h: H[20 + k], l: Lo[20 + k], c: C[20 + k], v: V[20 + k], final: true }));
    const d = { tf: "D", bars_completed: n, history: { n, t, o: O, h: H, l: Lo, c: C, v: V },
      symbol: o.symbol || { market: "fut", exchange: "CME", type: "FUTURE", code: "NQ1!", yahoo: "NQ=F", contract: "Nasdaq 100 Dec 26" },
      chart: { bars, ma_sets: { short: [5, 10, 20] }, overlays: { sr: [], gaps: { cols: [], rows: [] }, islands: [] }, legend: [] }, signals: {} };
    if ("rolls" in o) d.chart.overlays.rolls = o.rolls;
    if ("hv" in o) d.has_volume = o.hv;
    return d;
  };
  const chartHtml = (d) => { const full = P.fullSeries(d); return renderToString(React.createElement(P.KChart, { d, full, smas: [], a: 0, b: full.bars.length, gaps: [], islands: [], top: [], rolls: g4(d) })); };
  const g4 = (d) => (Array.isArray(d.chart.overlays.rolls) ? d.chart.overlays.rolls : []);
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
  await t("pastHalf：TA 票過半才續；普通票、壞票、沒期限 → 要問 status", async () => {
    const tk = (p) => "h." + Buffer.from(JSON.stringify(p)).toString("base64url") + ".s", n = Date.now() / 1000;
    assert.strictEqual(P.pastHalf(tk({ aud: "ta", iat: n - 86400, exp: n + 29 * 86400 })), false);
    assert.strictEqual(P.pastHalf(tk({ aud: "ta", iat: n - 16 * 86400, exp: n + 14 * 86400 })), true);
    assert.strictEqual(P.pastHalf(tk({ aud: "ta", iat: n - 40 * 86400, exp: n - 86400 })), true);   // 已過期
    assert.strictEqual(P.pastHalf(tk({ iat: n, exp: n + 3600 })), true);   // 普通票：換長效票
    assert.strictEqual(P.pastHalf(tk({ aud: "ta" })), true);
    assert.strictEqual(P.pastHalf("garbage"), true); assert.strictEqual(P.pastHalf(""), false);
  });

  console.log(fails ? "FAILED " + fails : "all passed");
  process.exit(fails ? 1 : 0);
})();
