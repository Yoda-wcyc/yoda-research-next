// /ta「選擇權」：lib/ta-opt.js 純函式＋app/api/ta-opt/route.js 閘門（2026-11-23）。跑法：node tests/ta_opt.cjs（失敗 exit 1）
const fs = require("fs"), path = require("path"), assert = require("assert");
const ROOT = path.join(__dirname, "..");
const { transformSync } = require(path.join(ROOT, "node_modules", "next", "dist", "build", "swc"));
function esm(file, over = {}) {
  const c = transformSync(fs.readFileSync(file, "utf8"), { jsc: { parser: { syntax: "ecmascript" }, target: "es2020" }, module: { type: "commonjs" } }).code;
  const mm = { exports: {} };
  const rq = (s) => (s in over ? over[s] : s.startsWith(".") ? esm(path.resolve(path.dirname(file), s) + ".js", over) : require(s));
  new Function("module", "exports", "require", c)(mm, mm.exports, rq);
  return mm.exports;
}
const O = esm(path.join(ROOT, "lib", "ta-opt.js"));

let fails = 0;
const at = [];
const t = (name, fn) => at.push([name, fn]);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, a + " ≠ " + b);

t("買 126 Call、ask 7.75、到期 135 → (9 − 7.75) × 100 ＝ +125；成本 775、報酬 16.1%、兩平 133.75", () => {
  near(O.pnl("C", 126, 7.75, 135), 125); near(O.cost(7.75), 775); near(O.retPct(125, 775), (125 / 775) * 100); near(O.breakeven("C", 126, 7.75), 133.75);
  near(O.pnl("C", 126, 7.75, 135, 3), 375); near(O.cost(7.75, 3), 2325);
});
t("目標價在履約價另一邊＝賠滿（−成本、−100%）", () => {
  near(O.pnl("C", 126, 7.75, 120), -775); near(O.retPct(-775, 775), -100);
  near(O.pnl("P", 100, 4, 110, 2), -800);
});
t("買 Put：到期賺賠、兩平、最多賺＝(履約價 − 權利金) × 100 × 口數；Call 最多賺無上限", () => {
  near(O.pnl("P", 100, 4, 90), 600); near(O.breakeven("P", 100, 4), 96);
  near(O.maxGain("P", 100, 4, 1), 9600); near(O.maxGain("P", 100, 4, 3), 28800); near(O.pnl("P", 100, 4, 0, 3), 28800);
  assert.strictEqual(O.maxGain("C", 100, 4, 1), Infinity);
});
t("口數：整數 ≥ 1（空白、0、負數、小數、亂打）", () => {
  for (const [v, w] of [["3", 3], [2.9, 2], ["", 1], ["0", 1], [-5, 1], ["abc", 1], [null, 1], [undefined, 1], ["1e3", 1000]]) assert.strictEqual(O.lots(v), w, String(v));
});
t("BS 機率：iv→0 時趨近 0／1；iv 0、天數 0 直接照現價判；Call＋Put 互補；r＝0 價平約一半", () => {
  near(O.probProfit("C", 100, 90, 1e-6, 30), 1); near(O.probProfit("C", 100, 110, 1e-6, 30), 0);
  near(O.probProfit("P", 100, 90, 1e-6, 30), 0); near(O.probProfit("P", 100, 110, 1e-6, 30), 1);
  assert.strictEqual(O.probProfit("C", 100, 90, 0, 30), 1); assert.strictEqual(O.probProfit("P", 100, 90, 0, 30), 0);
  assert.strictEqual(O.probProfit("C", 100, 110, 0.5, 0), 0);
  near(O.probProfit("C", 100, 105, 0.4, 30) + O.probProfit("P", 100, 105, 0.4, 30), 1, 1e-9);
  const sd = 0.4 * Math.sqrt(30 / 365);
  near(O.probProfit("C", 100, 100, 0.4, 30), O.ncdf(-sd / 2), 1e-12);
  assert.ok(O.probProfit("C", 100, 100, 0.4, 30) < 0.5 && O.probProfit("C", 100, 100, 0.4, 30) > 0.45);
  near(O.ncdf(0), 0.5, 1e-7); near(O.ncdf(1.96), 0.9750021, 1e-6); near(O.ncdf(-1.96), 0.0249979, 1e-6);
  assert.strictEqual(O.probProfit("P", 100, -1, 0.4, 30), 0); assert.strictEqual(O.probProfit("C", 100, -1, 0.4, 30), 1);
  assert.strictEqual(O.probProfit("C", 0, 100, 0.4, 30), null);
});
t("表格列：只收買賣價都 > 0、履約價在現價 ±25%；看漲用買權、看跌用賣權", () => {
  const q = (b, a, iv = 0.5) => ({ b, a, iv, oi: 1 });
  const rows = [{ k: 70, c: q(31, 32), p: q(0.1, 0.2) }, { k: 80, c: q(21, 22), p: q(0.5, 0.6) }, { k: 100, c: q(4, 4.2), p: q(3.8, 4) },
    { k: 110, c: q(0, 1), p: q(10, 11) }, { k: 120, c: q(0.5, 0.6), p: null }, { k: 130, c: q(0.1, 0.2), p: q(30, 31) }];
  const c = O.candidates(rows, "C", 100, 105, 30);
  assert.deepStrictEqual(c.map((r) => r.k), [80, 100, 120]);
  const r100 = c.find((r) => r.k === 100);
  near(r100.cost, 420); near(r100.pnl, 80); near(r100.ret, (80 / 420) * 100); near(r100.be, 104.2); assert.ok(r100.prob > 0 && r100.prob < 1);
  assert.deepStrictEqual(O.candidates(rows, "P", 100, 95, 30).map((r) => r.k), [80, 100, 110]);
  assert.deepStrictEqual(O.candidates(null, "C", 100, 1, 30), []); assert.deepStrictEqual(O.candidates(rows, "C", 0, 1, 30), []);
  assert.strictEqual(O.candidates(rows, "C", 100, NaN, 30)[0].pnl, null);
});
t("代號白名單 11 檔、OCC 解析、預設到期日（第一個 ≥ 14 天）、剩餘天數、時間格式", () => {
  assert.deepStrictEqual(O.OPT_SYMS, ["QQQ", "SPY", "SOXX", "NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AVGO"]);
  assert.strictEqual(O.optSym(" nvda "), "NVDA");
  for (const s of ["2330", "^TWII", "SPX", "AMD", "", null, 5, {}, "QQQ;"]) assert.strictEqual(O.optSym(s), null, String(s));
  assert.deepStrictEqual(O.parseOcc("NVDA261231P00255000"), { root: "NVDA", e: "2026-12-31", cp: "P", k: 255 });
  assert.deepStrictEqual(O.parseOcc("QQQ261127C00612500"), { root: "QQQ", e: "2026-11-27", cp: "C", k: 612.5 });
  assert.strictEqual(O.parseOcc("junk"), null);
  const now = Date.parse("2026-11-23T01:38:43Z");   // 美東 11-22 20:38
  assert.strictEqual(O.dte("2026-11-27", now), 5); assert.strictEqual(O.dte("2026-11-22", now), 0, "今天到期＝0");
  assert.strictEqual(O.dte("2026-11-20", now), 0);
  assert.strictEqual(O.regular("2026-11-23 01:38:43"), false, "週日晚上");
  assert.strictEqual(O.regular("2026-11-23 15:00:00"), true, "週一美東 10:00");
  assert.strictEqual(O.regular("2026-11-23 14:29:00"), false, "盤前 09:29");
  assert.strictEqual(O.regular("2026-11-23 21:00:00"), false, "盤後 16:00");
  assert.strictEqual(O.regular("2026-11-21 15:00:00"), false, "週六");
  assert.strictEqual(O.defaultExpiry(["2026-11-27", "2026-12-04", "2026-12-05", "2027-01-15"], now), "2027-01-15");   // 12-04＝12 天、12-05＝13 天
  assert.strictEqual(O.defaultExpiry(["2026-11-27", "2026-12-06", "2026-12-18"], now), "2026-12-06");
  assert.strictEqual(O.defaultExpiry(["2026-11-24", "2026-11-27"], now), "2026-11-27");
  assert.strictEqual(O.defaultExpiry([], now), null);
  assert.strictEqual(O.fmtTs("2026-11-23 01:38:43", "Asia/Taipei"), "2026-11-23 09:38");
  assert.strictEqual(O.fmtTs("junk", "Asia/Taipei"), "");
});
const RAW = { timestamp: "2026-11-23 01:38:43", data: { current_price: 130.01, close: 125.53, last_trade_time: "2026-11-20T15:59:59", options: [
  { option: "NVDA261218C00130000", bid: 9, ask: 9.2, iv: 0.5, delta: 0.52, open_interest: 100, volume: 5 },
  { option: "NVDA261218P00130000", bid: 8, ask: 8.3, iv: 0.51, delta: -0.48, open_interest: 50, volume: null },
  { option: "NVDA261127C00127500", bid: 4, ask: "x", iv: 0.6, open_interest: 1 },
  { option: "NVDA261127P00127500", bid: 3, ask: 3.2, iv: 0.6, open_interest: 1 },
  { option: "NVDA261204C00130000", bid: 0, ask: 0, iv: 0, open_interest: 0 },   // 剛掛牌、整條沒報價的到期日 → 不列
  { option: "B1VDA261127C00135000", bid: 1, ask: 1 }, { option: "junk" }, null,
] } };
t("parseChain：只收代號本身的 OCC、買賣權併成一列、到期日排序、整條沒報價的到期日不列、只留 b／a／iv／oi、壞值當 0", () => {
  const c = O.parseChain(RAW, "NVDA");
  assert.strictEqual(c.price, 125.53, "週末用正規盤 close，不用夜盤 current_price"); assert.strictEqual(c.off, true);
  const live = O.parseChain({ ...RAW, timestamp: "2026-11-23 15:00:00" }, "NVDA");
  assert.strictEqual(live.price, 130.01); assert.strictEqual(live.off, false); assert.deepStrictEqual(c.expiries, ["2026-11-27", "2026-12-18"]); assert.deepStrictEqual(Object.keys(c.by), c.expiries);
  assert.deepStrictEqual(c.by["2026-11-27"], [{ k: 127.5, c: { b: 4, a: 0, iv: 0.6, oi: 1 }, p: { b: 3, a: 3.2, iv: 0.6, oi: 1 } }]);
  const none = O.parseChain({ data: { current_price: 1, options: [{ option: "NVDA261204C00130000", bid: 0, ask: 0 }] } }, "NVDA");
  assert.deepStrictEqual(none.expiries, ["2026-12-04"], "全部沒報價就照列");
  assert.deepStrictEqual(c.by["2026-12-18"][0].p, { b: 8, a: 8.3, iv: 0.51, oi: 50 });
  assert.strictEqual(O.parseChain({ data: {} }, "NVDA"), null);
});

// 路由：會員閘門＋白名單＋快取／去重＋抓不到的錯誤；fetch 換成假的
function route(sub, allowed = true) {
  const live = { authOf: () => (sub ? { sub } : null), owners: () => ["o"], store: async () => ({ isOwner: async () => false, allowed: async () => allowed }) };
  return esm(path.join(ROOT, "app", "api", "ta-opt", "route.js"), { "../../../lib/ta-live": live });
}
const ask = (rt, body) => rt.POST(new Request("http://x/api/ta-opt", { method: "POST", body: JSON.stringify(body) })).then(async (r) => ({ status: r.status, j: await r.json() }));
let fetched = [], reply = () => ({ ok: true, status: 200, json: async () => RAW });
globalThis.fetch = async (u, o) => { fetched.push([u, o]); await new Promise((r) => setTimeout(r, 5)); return reply(u); };
t("路由閘門：未登入 401、未開通 403、白名單外 400（都不打 CBOE）", async () => {
  fetched = [];
  assert.strictEqual((await ask(route(null), { symbol: "NVDA" })).status, 401);
  assert.strictEqual((await ask(route("m", false), { symbol: "NVDA" })).status, 403);
  for (const s of ["AMD", "2330", "", null, "../x"]) { const r = await ask(route("m"), { symbol: s }); assert.strictEqual(r.status, 400, String(s)); assert.strictEqual(r.j.reason, "bad-input"); }
  assert.strictEqual((await ask(route("m"), { symbol: "NVDA", expiry: "12/18" })).status, 400);
  assert.strictEqual(fetched.length, 0);
});
t("路由：帶 Referer／Origin、同代號同時請求只打一次、60 秒內快取；只回前端要的欄位；不在清單的到期日退回預設", async () => {
  fetched = [];
  const rt = route("m");
  const [a, b] = await Promise.all([ask(rt, { symbol: "nvda" }), ask(rt, { symbol: "NVDA", expiry: "2026-11-27" })]);
  assert.strictEqual(fetched.length, 1, "同時兩個請求只打一次");
  assert.ok(fetched[0][0].endsWith("/options/NVDA.json") && fetched[0][1].headers.Referer === "https://www.cboe.com/" && fetched[0][1].headers.Origin === "https://www.cboe.com");
  assert.strictEqual(a.status, 200); assert.deepStrictEqual(Object.keys(a.j).sort(), ["expiries", "expiry", "last", "ok", "price", "rows", "symbol", "ts"]);
  assert.strictEqual(b.j.expiry, "2026-11-27"); assert.deepStrictEqual(b.j.rows, [{ k: 127.5, c: { b: 4, a: 0, iv: 0.6, oi: 1 }, p: { b: 3, a: 3.2, iv: 0.6, oi: 1 } }]);
  assert.ok(!a.j.expiries.includes("2026-12-04"));
  const c = await ask(rt, { symbol: "NVDA", expiry: "2030-01-01" });
  assert.strictEqual(fetched.length, 1, "60 秒內不重抓"); assert.ok(c.j.expiries.includes(c.j.expiry));
});
t("路由：CBOE 403／斷線／空資料 → 502 資料不足（不崩、不快取壞結果）", async () => {
  for (const bad of [() => ({ ok: false, status: 403 }), () => { throw new Error("socket hang up"); }, () => ({ ok: true, status: 200, json: async () => ({ data: { options: [] } }) })]) {
    fetched = []; reply = bad;
    const rt = route("m");
    const r = await ask(rt, { symbol: "QQQ" });
    assert.strictEqual(r.status, 502); assert.strictEqual(r.j.reason, "upstream"); assert.ok(r.j.error.startsWith("資料不足"), r.j.error);
    await ask(rt, { symbol: "QQQ" }); assert.strictEqual(fetched.length, 2, "失敗不快取");
  }
});

(async () => {
  for (const [name, fn] of at) {
    try { await fn(); console.log("ok  ", name); } catch (e) { fails++; console.log("FAIL", name, "→", e && e.message); }
  }
  if (fails) { console.log("\n" + fails + " 項失敗"); process.exit(1); }
  console.log("\n全部通過");
})();
