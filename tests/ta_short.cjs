// /ta「選擇權 → 作空試算」子分頁（2026-11-26）：lib/ta-short.js 純函式（對拍 demo 同一組輸入）＋ /api/ta-opt 新增的 SMH／NDX／expiries ＋ ShortView 畫面。
// 跑法：node tests/ta_short.cjs（失敗 exit 1）。對拍數字＝demo\ta_選擇權作空試算_demo.html（11-25 快照）預設輸入在無頭 Chrome 跑出來的 LAST.res。
const fs = require("fs"), path = require("path"), assert = require("assert");
const ROOT = path.join(__dirname, "..");
const { transformSync } = require(path.join(ROOT, "node_modules", "next", "dist", "build", "swc"));
const React = require(path.join(ROOT, "node_modules", "react"));
const { renderToString } = require(path.join(ROOT, "node_modules", "react-dom", "server"));
const cache = {};
function esm(file, over = {}) {
  if (cache[file]) return cache[file];
  const c = transformSync(fs.readFileSync(file, "utf8"), { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "classic" } }, target: "es2020" }, module: { type: "commonjs" } }).code;
  const mm = { exports: {} };
  const rq = (s) => (s in over ? over[s] : s === "react" ? React : s.startsWith(".") ? esm(path.resolve(path.dirname(file), s) + (/\.\w+$/.test(s) ? "" : ".js"), over) : require(s));
  new Function("module", "exports", "require", "React", c)(mm, mm.exports, rq, React);
  if (!Object.keys(over).length) cache[file] = mm.exports;
  return mm.exports;
}
const L = esm(path.join(ROOT, "lib", "ta-short.js"));
const O = esm(path.join(ROOT, "lib", "ta-opt.js"));

let fails = 0;
const at = [];
const t = (name, fn) => at.push([name, fn]);
const near = (a, b, rel = 1e-9) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), a + " ≠ " + b);

// demo 預設：總資金 100 萬、年保險費 5%、無風險 4%、跌 20% 加 10 點、跌 50% 加 25 點
const CAP = 1e6, B = 5e4, EQ = { m: 100, r: 0.04, fut: false, ivA: 0.1, ivB: 0.25 };
const QQQ = [
  { n: 177, S0: 633.93, legs: [{ K: 505, mid: 13.045, iv: 0.3693, q: 1 }] },
  { n: 177, S0: 633.93, legs: [{ K: 570, mid: 24.83, iv: 0.3252, q: 1 }, { K: 410, mid: 4.915, iv: 0.4453, q: -1 }] },
  { n: 93, S0: 633.93, legs: [{ K: 571, mid: 16.805, iv: 0.3507, q: 1 }] },
];
const QQQ_DEMO = [
  { N: 19, cycles: 2, annual: 49571, worst: -60961.17201926272, worstAt: "12 個月跌 37%", maxG: 934714.5, be: 491.955, theta: -172.2782442715527, sc: [-24785.5, -60425.052971537734, 104872.21857433236, -49571] },
  { N: 12, cycles: 2, annual: 47796, worst: -49842.69960030007, worstAt: "12 個月跌 19%", maxG: 168102, be: 550.085, theta: -65.12209718286499, sc: [47422.832582826326, 69454.24846340079, 188715.24355491018, -47796] },
  { N: 7, cycles: 4, annual: 47054, worst: -51638.61826863754, worstAt: "12 個月跌 20%", maxG: 387936.50000000006, be: 554.195, theta: -116.22294394126129, sc: [-13696.701501187377, -36261.744368152235, 26136.083252667217, -47054] },
];
t("對拍 demo：QQQ 三種結構（口數、一年花掉、試算最大虧損＋出現情境、最大獲利、兩平、Theta、四個情境）", () => {
  QQQ.forEach((st, i) => {
    const o = L.calc(st, CAP, B, EQ), d = QQQ_DEMO[i];
    assert.strictEqual(o.N, d.N); assert.strictEqual(o.cycles, d.cycles); assert.strictEqual(o.demo, false); assert.strictEqual(o.worstAt, d.worstAt);
    for (const k of ["annual", "worst", "maxG", "be", "theta"]) near(o[k], d[k]);
    d.sc.forEach((v, j) => near(o.sc[j], v));
    assert.strictEqual(o.line.length, 61); near(o.line[35], d.sc[1]);
  });
});
t("對拍 demo：NQ（Black-76、乘數 20、預算只夠 1 口）、XND（NDX ÷ 100）、NDX（預算不夠 → 1 口示意）", () => {
  const nq = L.calc({ n: 177, S0: 26526.31, legs: [{ K: 21200, mid: 700.7474026633923, iv: 0.3853, q: 1 }] }, CAP, B, { ...EQ, m: 20, fut: true });
  assert.strictEqual(nq.N, 1); assert.strictEqual(nq.demo, false); assert.strictEqual(nq.worstAt, "12 個月跌 37%");
  near(nq.worst, -33085.06315045153); near(nq.theta, -96.85732002726354); near(nq.sc[2], 42492.29774919085); near(nq.maxG, 409985.0519467321);
  near(L.b76Put(26526.31, 21200, 177 / 365, 0.3853, 0.04), 700.7474026633923, 1e-6);
  const xnd = L.calc({ n: 177, S0: 260.469, legs: [{ K: 210, mid: 5.5885, iv: 0.3664, q: 1 }] }, CAP, B, EQ);
  assert.strictEqual(xnd.N, 44); near(xnd.annual, 49178.8); near(xnd.worst, -60450.1611787417); near(xnd.theta, -169.21662687642822);
  const ndx = L.calc({ n: 177, S0: 26046.8965, legs: [{ K: 21000, mid: 558.85, iv: 0.3664, q: 1 }] }, CAP, B, EQ);
  assert.strictEqual(ndx.N, 1); assert.strictEqual(ndx.demo, true, "每口 $55,885 × 2 次 > 預算 → 以 1 口示意"); near(ndx.annual, 111770); near(ndx.worst, -137386.78271865443);
  near(ndx.need, 55885 * 2 / 0.05);
});
t("邊界：0 口（預算 0）→ 1 口示意；IV 0／到期＝內含價值；Delta 範圍；IV 隨跌幅上升內插與外推", () => {
  const o = L.calc(QQQ[0], CAP, 0, EQ);
  assert.strictEqual(o.N, 1); assert.strictEqual(o.demo, true);
  assert.strictEqual(L.bsPut(90, 100, 0.5, 0, 0.04), 10); assert.strictEqual(L.bsPut(110, 100, 0, 0.3, 0.04), 0); assert.strictEqual(L.b76Put(90, 100, 0.5, 0, 0.04), 10);
  const dl = L.putDelta(false, 633.93, 505, 177 / 365, 0.3693, 0.04);
  assert.ok(dl < 0 && dl > -0.5, String(dl)); assert.strictEqual(L.putDelta(false, 90, 100, 0, 0.3, 0.04), -1); assert.strictEqual(L.putDelta(true, 110, 100, 0.5, 0, 0.04), 0);
  // Delta ≈ 數值微分
  const h = 0.01, nd = (L.bsPut(633.93 + h, 505, 0.485, 0.3693, 0.04) - L.bsPut(633.93 - h, 505, 0.485, 0.3693, 0.04)) / (2 * h);
  near(L.putDelta(false, 633.93, 505, 0.485, 0.3693, 0.04), nd, 1e-4);
  near(L.ivUp(0.2, 0.1, 0.25), 0.1); near(L.ivUp(0.35, 0.1, 0.25), 0.175); near(L.ivUp(0.5, 0.1, 0.25), 0.25); near(L.ivUp(0.6, 0.1, 0.25), 0.3); assert.strictEqual(L.ivUp(-0.1, 0.1, 0.25), 0);
  // 用 IV 0 算情境不崩、不 NaN
  const z = L.calc({ n: 177, S0: 100, legs: [{ K: 90, mid: 1, iv: 0, q: 1 }] }, CAP, B, { ...EQ, ivA: 0, ivB: 0 });
  assert.ok([z.worst, ...z.sc, ...z.line].every(Number.isFinite));
});
t("輸入檢查：到期已過、沒報價、賣出腳不低於買進腳、權利金 0、淨權利金過低、淨權利金 ≥ 價差寬度；共用欄位", () => {
  const nm = "② 賣權價差", a = { K: 100, mid: 3, q: 1 }, b = { K: 90, mid: 1, q: -1 };
  assert.deepStrictEqual(L.checkStruct(nm, [a, b], 0, 0.01, " 美元"), [nm + "：這個到期日已過或今天到期，換一個到期日"]);
  assert.match(L.checkStruct(nm, [a, null], 30, 0.01, " 美元")[0], /沒有報價/);
  assert.match(L.checkStruct(nm, [a, { K: 100, mid: 1, q: -1 }], 30, 0.01, " 美元")[0], /要低於買進那腳/);
  assert.match(L.checkStruct(nm, [{ K: 50, mid: 0, q: 1 }], 30, 0.01, " 美元")[0], /權利金是 0/);
  assert.match(L.checkStruct(nm, [{ K: 50, mid: 0.005, q: 1 }], 30, 0.01, " 美元")[0], /淨權利金不到 0.01 美元/);
  assert.match(L.checkStruct(nm, [{ K: 100, mid: 1.1, q: 1 }, { K: 99, mid: 1, q: -1 }], 30, 0.25, " 點")[0], /淨權利金不到 0.25 點/);
  assert.match(L.checkStruct(nm, [{ K: 100, mid: 12, q: 1 }, { K: 90, mid: 1, q: -1 }], 30, 0.01, " 美元")[0], /要低於 10.00/);
  assert.deepStrictEqual(L.checkStruct(nm, [a, b], 30, 0.01, " 美元"), []);
  assert.deepStrictEqual(L.checkGlobal({ cap: "1000000", bp: "5", rf: "4", ivA: "10", ivB: "25", fut: false }), []);
  assert.deepStrictEqual(L.checkGlobal({ cap: "0", bp: "0", rf: "", ivA: "30", ivB: "25", fut: true, nqiv: "0" }), ["總資金要大於 0", "年保險費要在 0～100% 之間", "無風險利率要在 −5%～20% 之間", "跌 50% 加的 IV 點數不能比跌 20% 少", "估算 IV 要大於 0"]);
});
t("到期日／履約價挑選、價平 IV、季月期貨", () => {
  const list = [{ e: "a", n: 30 }, { e: "b", n: 177 }, { e: "c", n: 205 }];
  assert.strictEqual(L.nearExp(list, 182).e, "b"); assert.strictEqual(L.nearExp(list, 91).e, "a"); assert.strictEqual(L.nearExp([], 1), null);
  const rows = [{ k: 500, p: { b: 12, a: 14, iv: 0.37, oi: 5 } }, { k: 505, p: { b: 0, a: 0, iv: 0, oi: 0 } }, { k: 510, c: {}, p: null }, { k: 520, p: { b: 15, a: 16, iv: 0.36, oi: 1 } }];
  assert.deepStrictEqual(L.nearPut(rows, 506), { K: 500, b: 12, a: 14, mid: 13, iv: 0.37, oi: 5 }, "沒有賣價的履約價跳過");
  assert.deepStrictEqual(L.nearPut(rows, 506, 0.01), { K: 5.2, b: 0.15, a: 0.16, mid: 0.155, iv: 0.36, oi: 1 }, "XND＝NDX ÷ 100");
  assert.strictEqual(L.nearPut([], 1), null); assert.strictEqual(L.atmIv(rows, 518), 0.36);
  assert.strictEqual(L.thirdFri(2027, 3), "2027-03-19"); assert.strictEqual(L.thirdFri(2026, 12), "2026-12-18");
  assert.deepStrictEqual(L.futOf("2027-01-15"), { code: "H27", fe: "2027-03-19" });
  assert.deepStrictEqual(L.futOf("2027-03-19"), { code: "H27", fe: "2027-03-19" });
  assert.deepStrictEqual(L.futOf("2027-06-17"), { code: "M27", fe: "2027-06-18" });
  assert.deepStrictEqual(L.futOf("2027-12-17"), { code: "Z27", fe: "2027-12-17" });
  assert.deepStrictEqual(L.futOf("2027-12-20"), { code: "H28", fe: "2028-03-17" });
});

// ───── lib/ta-opt：SMH／NDX 白名單、_NDX 的 root 解析 ─────
const RAW = { timestamp: "2026-11-26 01:05:14", data: { current_price: 26046.9, close: 26046.9, last_trade_time: "2026-11-25T16:14:59", options: [
  { option: "NDXP261217P21000000", bid: 100, ask: 110, iv: 0.4, open_interest: 3 },   // 12-17 只有 NDXP
  { option: "NDX261218P21000000", bid: 200, ask: 210, iv: 0.38, open_interest: 9 },   // 12-18 兩種都有 → 取 NDX
  { option: "NDXP261218P21000000", bid: 1, ask: 2, iv: 0.5, open_interest: 1 },
  { option: "XND261218P00210000", bid: 1, ask: 2 },
] } };
t("ta-opt：cboeSym 多收 SMH／NDX（舊 optSym、OPT_SYMS 不變）；NDX 抓 _NDX；每個到期日只留一個 root", () => {
  assert.strictEqual(O.cboeSym(" smh "), "SMH"); assert.strictEqual(O.cboeSym("ndx"), "NDX"); assert.strictEqual(O.cboeSym("QQQ"), "QQQ");
  for (const s of ["XND", "_NDX", "SPX", "NQ", "", null, {}]) assert.strictEqual(O.cboeSym(s), null, String(s));
  assert.strictEqual(O.optSym("SMH"), null); assert.strictEqual(O.optSym("NDX"), null); assert.ok(!O.OPT_SYMS.includes("SMH"));
  assert.strictEqual(O.cboeCode("NDX"), "_NDX"); assert.strictEqual(O.cboeCode("SMH"), "SMH");
  const c = O.parseChain(RAW, "NDX");
  assert.deepStrictEqual(c.expiries, ["2026-12-17", "2026-12-18"]); assert.deepStrictEqual(c.root, { "2026-12-17": "NDXP", "2026-12-18": "NDX" });
  assert.deepStrictEqual(c.by["2026-12-18"], [{ k: 21000, c: null, p: { b: 200, a: 210, iv: 0.38, oi: 9 } }]);
  assert.ok(!("root" in O.parseChain({ ...RAW, data: { ...RAW.data, options: [{ option: "SMH261218P00400000", bid: 1, ask: 2 }] } }, "SMH")), "單一 root 不多回 root");
});
function route(sub) {
  const live = { authOf: () => (sub ? { sub } : null), owners: () => ["o"], store: async () => ({ isOwner: async () => false, allowed: async () => true }) };
  return esm(path.join(ROOT, "app", "api", "ta-opt", "route.js"), { "../../../lib/ta-live": live });
}
const ask = (rt, body) => rt.POST(new Request("http://x/api/ta-opt", { method: "POST", body: JSON.stringify(body) })).then(async (r) => ({ status: r.status, j: await r.json() }));
let fetched = [];
globalThis.fetch = async (u) => { fetched.push(u); return { ok: true, status: 200, json: async () => RAW }; };
t("路由：NDX 打 _NDX.json、回 root；expiries 參數回 by（不在清單的略過）；expiries 壞值 400；會員閘門照舊", async () => {
  fetched = [];
  assert.strictEqual((await ask(route(null), { symbol: "NDX" })).status, 401);
  const rt = route("m");
  const a = await ask(rt, { symbol: "NDX", expiries: ["2026-12-17", "2026-12-18", "2030-01-01"] });
  assert.strictEqual(a.status, 200); assert.ok(fetched[0].endsWith("/options/_NDX.json"), fetched[0]);
  assert.deepStrictEqual(Object.keys(a.j.by), ["2026-12-17", "2026-12-18"]); assert.deepStrictEqual(a.j.root, { "2026-12-17": "NDXP", "2026-12-18": "NDX" });
  for (const bad of ["2026-12-17", ["12/17"], [1], Array(7).fill("2026-12-17")]) assert.strictEqual((await ask(rt, { symbol: "NDX", expiries: bad })).status, 400, JSON.stringify(bad));
  assert.strictEqual((await ask(rt, { symbol: "XND" })).status, 400, "XND 前端借 NDX，不開白名單");
  assert.strictEqual(fetched.length, 1, "同代號 60 秒快取");
});

// ───── ShortView 畫面（假 SortTable：照欄位畫表頭＋每格）─────
const ST = ({ cols, rows, className }) => React.createElement("table", { className }, React.createElement("thead", null, React.createElement("tr", null, cols.map((c, i) => React.createElement("th", { key: i }, c.label)))),
  React.createElement("tbody", null, rows.map((r, i) => React.createElement("tr", { key: i }, cols.map((c, j) => React.createElement("td", { key: j }, c.render(r)))))));
function view(sym, memo) {
  const store = {}; globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: () => {} };
  store.yoda_ta_short_sym = sym;
  const V = esm(path.join(ROOT, "app", "ta", "ShortView.jsx"));
  for (const k of Object.keys(V.MEMO)) delete V.MEMO[k];
  Object.assign(V.MEMO, memo);
  return renderToString(React.createElement(V.default, { call: async () => ({ ok: false }), gate: () => false, SortTable: ST })).replace(/<!-- -->/g, "");
}
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return d.toISOString().slice(0, 10); };
const E1 = day(180), E3 = day(92);
const put = (k, b, a, iv) => ({ k, c: null, p: { b, a, iv, oi: 100 } });
const qRows = (S) => [0.6, 0.65, 0.7, 0.8, 0.9, 1].map((x) => put(Math.round(S * x), S * x * 0.01, S * x * 0.012, 0.3 + (1 - x) * 0.3));
t("ShortView：八個標的鈕、三結構、錯誤檢查、成本表→情境表→圖（圖在情境表正下方）、檢查表 11-25 快照、Burry 卡；沒有尾句", () => {
  const base = { ok: true, symbol: "QQQ", price: 600, ts: "2026-11-26 01:05:16", expiries: [E3, E1], expiry: E3, rows: qRows(600) };
  const h = view("QQQ", { QQQ: { base, by: { [E1]: qRows(600), [E3]: qRows(600) } } });
  assert.deepStrictEqual([...h.matchAll(/data-s="([A-Z]+)"/g)].map((m) => m[1]), ["QQQ", "SMH", "SOXX", "NQ", "MNQ", "NDX", "XND", "NVDA"]);
  for (const w of ["① 長天期價外賣權", "② 賣權價差", "③ 短天期滾動", "成本與風險", "試算最大虧損", "Theta／天", "Delta（每 1 點）", "情境損益（一年計畫，含換倉）", "12 個月腰斬 −50%", "接檢查表分批", "目前（11-25）", "Burry 怎麼做", "資料時間 2026-11-26 09:05（台灣）", "ta-sh-i"]) assert.ok(h.includes(w), "少了 " + w);
  const iB = h.indexOf("情境損益（一年計畫"), iT = h.indexOf("</table>", iB), iC = h.indexOf("<svg", iT);
  assert.ok(iT > iB && h.slice(iT + 8, iC) === "" && h.slice(iC, iC + 60).includes('class="ta-sh-chart"'), "圖要緊接在情境表後面");
  assert.strictEqual((h.match(/data-line="/g) || []).length, 3, "三條折線");
  assert.ok(!h.includes("輸入有誤"), h.match(/輸入有誤[^<]*/));
  assert.ok(!/不是操作建議|不構成|投資建議/.test(h), "不放尾句");
  // 錯誤檢查：賣出腳 % 不低於買進腳 → 錯誤框、該結構不算
  const store = {}; globalThis.localStorage = { getItem: (k) => store[k] || null, setItem: () => {} };
  const V = esm(path.join(ROOT, "app", "ta", "ShortView.jsx"));
  const React2 = React, orig = React2.useState;
  React2.useState = (init) => orig(typeof init === "function" && String(init).includes("FORM0") ? () => ({ cap: "1000000", bp: "5", rf: "4.0", ivA: "10", ivB: "25", nqiv: "", k1: "80", k2a: "65", k2b: "90", k3: "200", e1: "", e2: "", e3: "" }) : init);
  let he;
  try { he = renderToString(React.createElement(V.default, { call: async () => ({ ok: false }), gate: () => false, SortTable: ST })).replace(/<!-- -->/g, ""); } finally { React2.useState = orig; }
  assert.ok(he.includes("輸入有誤") && he.includes("② 賣權價差：賣出那腳的履約價要低於買進那腳") && he.includes("履約價要在現價的 30%～105% 之間"), (he.match(/輸入有誤[^<]*/) || [he.slice(0, 500)])[0]);
  assert.strictEqual((he.match(/data-line="/g) || []).length, 1, "只剩 ① 一條線");
  globalThis.localStorage = undefined;
});
t("ShortView：NQ 標「估算，非報價」、到期接季月、估算 IV 預設 QQQ 價平；XND 借 NDX；NVDA 有 Burry 帶入鈕；讀取中不崩", () => {
  const nb = { ok: true, symbol: "NDX", price: 26000, ts: "2026-11-26 01:05:14", expiries: [day(51), day(180)], expiry: day(51), rows: qRows(26000), root: { [day(51)]: "NDX", [day(180)]: "NDX" } };
  const qb = { ok: true, symbol: "QQQ", price: 600, ts: "", expiries: [day(30)], expiry: day(30), rows: qRows(600) };
  const h = view("NQ", { NDX: { base: nb, by: { [day(51)]: qRows(26000), [day(180)]: qRows(26000) } }, QQQ: { base: qb, by: {} } });
  assert.ok(h.includes("估算，非報價") && h.includes("NQ 期貨") && /→ NQ[HMUZ]\d\d/.test(h) && h.includes("預設 QQQ 價平 IV 30.00"), h.slice(0, 2000));
  const x = view("XND", { NDX: { base: nb, by: { [day(180)]: qRows(26000), [day(51)]: qRows(26000) } } });
  assert.ok(x.includes("借 NDX（AM 結算） 報價") && x.includes("÷ 100") && x.includes("<b class=\"mono\">260.00</b>"), x.slice(0, 1500));
  const nv = view("NVDA", { NVDA: { base: { ...nb, symbol: "NVDA", price: 180, root: undefined, rows: qRows(180) }, by: {} } });
  assert.ok(nv.includes("帶入 Burry 2026-04 那組"));
  assert.ok(view("SMH", {}).includes("讀取中"));
});
t("page.jsx：選擇權分頁多一排子分頁（原試算｜作空試算）；原試算照舊用 OptView", () => {
  const raw = fs.readFileSync(path.join(ROOT, "app", "ta", "page.jsx"), "utf8");
  assert.ok(raw.includes('[["calc", "原試算"], ["short", "作空試算"]]') && raw.includes("<ShortView call={call} gate={gate} SortTable={SortTable} />") && raw.includes("<OptView opt={opt} run={runOpt} />"));
});

(async () => {
  for (const [name, fn] of at) {
    try { await fn(); console.log("ok  ", name); } catch (e) { fails++; console.log("FAIL", name, "→", e && e.message); }
  }
  if (fails) { console.log("\n" + fails + " 項失敗"); process.exit(1); }
  console.log("\n全部通過");
})();
