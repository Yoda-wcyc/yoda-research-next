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
    .replace('"../../lib/ta-trade"', JSON.stringify(path.join(ROOT, "lib", "ta-trade.js").replace(/\\/g, "/"))) + "\nexport { cleanRecent, readRecent, Boundary, headInfo, sideTrade, readSide, Trade, noVolume, mktBadge, KChart, TopVolume, RulePanel, withTrade, fullSeries };\n";
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

  console.log(fails ? "FAILED " + fails : "all passed");
  process.exit(fails ? 1 : 0);
})();
