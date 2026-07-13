# Yoda Research — Next.js 版部署手冊(Phase 2a+2b)

## 部署到 Vercel(現在可以上線了)
1. 把本資料夾推上 GitHub 新 repo(例:yoda-research-next)
   - node_modules 與 .next 不要推(.gitignore 已排除)
2. vercel.com → Add New Project → Import 該 repo
3. Framework 自動偵測 Next.js,全用預設值,按 Deploy
4. 拿到 *.vercel.app 網址後,做兩件收尾:
   - app/sitemap.js 與 app/robots.js 開頭的 BASE 改成實際網址
   - app/layout.jsx 的 metadataBase 同步改
   -(之後綁自訂網域再改一次即可)

## 本機預覽(可跳過)
npm install → npm run dev → http://localhost:3000

## 已完成
- ✅ 首頁完整遷移(Hero/儀表板/六分類/AI泡沫/訂閱/Footer)
- ✅ /archive 研究總覽(七頁籤、history 清單、離線降級)
- ✅ PWA:manifest + sw.js v2(reports.json 網路優先、殼快取優先)
- ✅ sitemap.xml + robots.txt(Next 慣例自動生成)
- ✅ 金色單一色階:深 #e0a526 / 淺 #b8860b
- ✅ 深淺主題、三檔字級、滾動動畫、375px RWD
- ✅ reports.json 動態載入,失敗自動退回內建預設

## 待辦
- ⏳ Phase 2c:會員三層(members 表 / Magic Link / 內容遮蔽)
- 上線後實測:跨網域抓 yoda-wcyc.github.io/-/reports.json
  (GitHub Pages 對所有資源送 Access-Control-Allow-Origin: *,理論上直接通;
   若有異常回報即可)
