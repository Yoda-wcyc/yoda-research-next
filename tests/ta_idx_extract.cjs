// /ta「指數位階」分頁：lib/ta-idx.js 從美股報告抽「02 指數位階」整章（2026-11-11）。跑法：node tests/ta_idx_extract.cjs（失敗 exit 1）
// 夾具唯讀、不進 repo：舊版＝reports 裡 11-11 正式檔（四 TAB）、新版＝三合一預覽（五 TAB＋指數估值）；檔案不在就略過那一份。
const fs = require("fs"), path = require("path"), assert = require("assert");
const ROOT = path.join(__dirname, "..");
const { transformSync } = require(path.join(ROOT, "node_modules", "next", "dist", "build", "swc"));
const code = transformSync(fs.readFileSync(path.join(ROOT, "lib", "ta-idx.js"), "utf8"), { jsc: { parser: { syntax: "ecmascript" }, target: "es2020" }, module: { type: "commonjs" } }).code;
const m = { exports: {} };
new Function("module", "exports", "require", code)(m, m.exports, require);
const { extractIdxPos, newestUs } = m.exports;

const FIX = {
  old: "G:\\Yoda x Claude\\reports\\美股分析_20261111.html",
  new: "C:\\Users\\iamtw\\AppData\\Local\\Temp\\claude\\e23d56752174abce\\3a401bc1-1478-48cc-a86e-8dde6b3459b3\\scratchpad\\idx3\\美股分析_20261111_三合一預覽.html",
};
let fails = 0;
function t(name, fn) { try { fn(); console.log("ok  ", name); } catch (e) { fails++; console.log("FAIL", name, "→", e && e.message); } }

for (const [k, f] of Object.entries(FIX)) {
  if (!fs.existsSync(f)) { console.log("skip", k, "夾具不在：", f); continue; }
  const d = extractIdxPos(fs.readFileSync(f, "utf8"));
  t(k + "：抽得到整章", () => {
    assert.ok(d, "回 null");
    for (const s of ["trc-wrap", "data-cta", "data-idxpos-take"]) assert.ok(d.includes(s), "缺 " + s);
    assert.ok(!d.includes('<div id="sec-treemap"'), "多抽到下一章");
    assert.ok(!d.includes('<div class="section-num">'), "章號沒拿掉");
    const head = d.slice(0, d.indexOf("</head>"));
    assert.ok((head.match(/<style/g) || []).length > 5, "樣式太少");
    assert.ok(d.includes("function sortTbl("), "sortTbl 沒帶");
  });
  if (k === "new") t("new：指數估值＋五個比值 TAB", () => {
    assert.ok(d.includes("data-ipe-wrap"), "缺 data-ipe-wrap");
    assert.strictEqual((d.match(/<button[^>]*\sdata-trc="/g) || []).length, 5);
  });
}
t("找不到章節回 null、不丟例外", () => {
  assert.strictEqual(extractIdxPos(""), null);
  assert.strictEqual(extractIdxPos(null), null);
  assert.strictEqual(extractIdxPos('<div id="sec-idxpos" class="section-header"></div>'), null);   // 後面沒有下一章
});
t("newestUs：只挑美股、日期最新（含付費_前綴）", () => {
  const r = newestUs([{ reportId: "台股分析_20261112" }, { reportId: "美股分析_20261110" }, { reportId: "付費_美股分析_20261111" }, { reportId: "免費_美股分析_20261112" }]);
  assert.deepStrictEqual(r, { reportId: "付費_美股分析_20261111", date: "2026-11-11" });
  assert.strictEqual(newestUs([]), null);
});
console.log(fails ? fails + " 項失敗" : "全部通過");
process.exit(fails ? 1 : 0);
