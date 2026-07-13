export const metadata = {
  title: "研究總覽｜Yoda Research",
  description: "Yoda Research 全部研究報告:市場觀察、美股、台股、AI 泡沫評估、總體經濟、公開簡報。",
  openGraph: {
    title: "研究總覽｜Yoda Research",
    description: "全部研究報告,依日期與分類瀏覽",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};
export default function ArchiveLayout({ children }) {
  return children;
}
