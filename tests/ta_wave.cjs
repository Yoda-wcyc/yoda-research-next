// /ta「波浪」分頁：lib/ta-wave.js 從會員版波浪理論報告只切互動圖表（2026-11-24）＋ /api/ta-wave 閘門在讀 Blob 之前。
// 跑法：node tests/ta_wave.cjs（失敗 exit 1）。夾具唯讀、不進 repo：會員版正式檔；不在就略過切片那幾項。
const fs = require("fs"), path = require("path"), assert = require("assert");
const ROOT = path.join(__dirname, "..");
const { transformSync } = require(path.join(ROOT, "node_modules", "next", "dist", "build", "swc"));
const code = transformSync(fs.readFileSync(path.join(ROOT, "lib", "ta-wave.js"), "utf8"), { jsc: { parser: { syntax: "ecmascript" }, target: "es2020" }, module: { type: "commonjs" } }).code;
const m = { exports: {} };
new Function("module", "exports", "require", code)(m, m.exports, require);
const { extractWave, newestWave } = m.exports;

const FIX = "G:\\Yoda x Claude\\reports\\_member\\專題研究_波浪理論_20261123.html";
let fails = 0;
function t(name, fn) { try { fn(); console.log("ok  ", name); } catch (e) { fails++; console.log("FAIL", name, "→", e && e.message); } }

if (!fs.existsSync(FIX)) console.log("skip 夾具不在：", FIX);
else {
  const src = fs.readFileSync(FIX, "utf8");
  const d = extractWave(src);
  t("切得出來、srcdoc 以 <!doctype 開頭", () => {
    assert.ok(/^<!doctype html>/i.test(d));
    assert.ok(d.includes('<style id="wv-css">'), "缺 wv-css");
    assert.ok(d.includes('<script id="wv-js">'), "缺 wv-js");
    assert.ok(d.includes("ta-wave-h"), "缺高度回報橋");
  });
  t("四個指數 tab、四張圖、數法鈕、時間軸、圖例", () => {
    for (const k of ["ndx", "spx", "sox", "twii"]) {
      assert.ok(d.includes('id="wv-tab-' + k + '"'), "缺 tab " + k);
      assert.ok(d.includes('id="wv-chart-' + k + '"'), "缺圖 " + k);
      assert.ok(d.includes('id="wv-top-' + k + '-nv"') && d.includes('id="wv-bot-' + k + '-nv"'), "缺時間軸 " + k);
    }
    assert.ok((d.match(/class="wv-btn"/g) || []).length >= 12, "數法鈕太少");
    assert.ok(d.includes('class="wv-lg"') && d.includes('class="wv-note"'), "缺圖例／圖下提示");
  });
  t("不含 01／02 章節、「四個指數一起看」文字框、頁首頁尾雜項", () => {
    const body = d.slice(d.indexOf("<body>"));   // 樣式表裡本來就有 .context-box 等規則，只查 body
    for (const s of ['id="sec-rank"', 'id="sec-rules"', "四個指數一起看", 'class="context-box', 'class="section-header', "<nav", 'class="hero', "share-bar", "yr-disc", "googletagmanager", "yoda-prefs.js"]) assert.ok(!body.includes(s), "不該有 " + s);
    assert.ok(!d.includes("四個指數一起看"), "整份都不該有「四個指數一起看」");
  });
  t("data-tip 已改名 data-wv-tip", () => {
    assert.ok(!/\bdata-tip\b/.test(d), "還有 data-tip");
    assert.ok(d.includes("data-wv-tip"), "沒有 data-wv-tip");
  });
  t("錨點切不到要 throw、講清楚缺什麼", () => {
    assert.throws(() => extractWave(""), /找不到/);
    assert.throws(() => extractWave(src.replace('<div class="wv-tabs"', '<div class="x"')), /wv-tabs/);
    assert.throws(() => extractWave(src.replace(/id="sec-rank"/g, 'id="x"')), /sec-rank/);
    assert.throws(() => extractWave(src.replace('<script id="wv-js">', "<script>")), /wv-js/);
  });
}
t("newestWave：只挑會員版、日期最新", () => {
  const r = newestWave([{ reportId: "專題研究_波浪理論_20261130" }, { reportId: "付費_專題研究_波浪理論_20261123" }, { reportId: "付費_專題研究_波浪理論_20261101" }, { reportId: "付費_專題研究_波浪理論_20261201_預覽" }, { reportId: "付費_美股分析_20261124" }]);
  assert.deepStrictEqual(r, { reportId: "付費_專題研究_波浪理論_20261123", date: "2026-11-23" });
  assert.strictEqual(newestWave([]), null);
});
t("route：閘門（401／403）在讀索引／Blob 之前", () => {
  const r = fs.readFileSync(path.join(ROOT, "app", "api", "ta-wave", "route.js"), "utf8");
  const post = r.slice(r.indexOf("export async function POST"));
  const i401 = post.indexOf("need-login"), i403 = post.indexOf("not-enabled");
  const iIdx = post.indexOf("readIndex("), iRead = post.indexOf("readReport(");
  assert.ok(i401 > 0 && i403 > i401, "閘門不見了");
  assert.ok(iIdx > i403 && iRead > i403, "讀索引／Blob 跑到閘門前面");
  assert.ok(!/readReport\(|readIndex\(|get\(/.test(r.slice(0, r.indexOf("async function readReport"))), "模組頂層就讀 Blob");
});
console.log(fails ? fails + " 項失敗" : "全部通過");
process.exit(fails ? 1 : 0);
