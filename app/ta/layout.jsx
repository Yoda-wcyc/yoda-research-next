import "./ta.css";

// 會員技術分析頁（獨立網站版）：會員登入＋開通（或站長）才看得到內容。不收錄、不進 sitemap。
export const metadata = {
  title: "技術分析｜Yoda Research 會員專屬",
  description: "Yoda Research 會員專屬技術分析。",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

// 永遠桌機版面（手機也用 1200 寬縮放顯示）
export const viewport = {
  width: 1200,
  themeColor: "#000000",
};

export default function TaLayout({ children }) {
  return children;
}
