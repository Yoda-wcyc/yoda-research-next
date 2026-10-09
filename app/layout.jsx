import "./globals.css";
import Controls from "../components/Controls";
import PwaRegister from "../components/PwaRegister";
import { GT_GUARD } from "../lib/gt-guard";

export const metadata = {
  metadataBase: new URL("https://yoda-research.vercel.app"),
  title: "Yoda Research｜用可證偽的判斷,追蹤美股與台股的真實訊號",
  description:
    "Yoda Research 市場簡報與深度研究:市場觀察、美股、台股、AI 泡沫評估、總體經濟。",
  openGraph: {
    title: "Yoda Research",
    description: "用可證偽的判斷,追蹤美股與台股的真實訊號",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant" data-theme="dark" data-size="md" suppressHydrationWarning>
      <head>
        {/* 讀者偏好（與 A 網域同名鍵 yoda-size／yoda-theme）：繪製前先套到 <html>，避免深淺／字級閃一下 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var r=document.documentElement,s=localStorage.getItem('yoda-size'),t=localStorage.getItem('yoda-theme');if(s==='sm'||s==='md'||s==='lg')r.setAttribute('data-size',s);if(t==='dark'||t==='light')r.setAttribute('data-theme',t)}catch(e){}",
          }}
        />
        {/* React × Google 網頁翻譯相容防護（English 模式不報 removeChild／insertBefore 錯、改字不卡舊譯文）；說明見 lib/gt-guard.js */}
        <script dangerouslySetInnerHTML={{ __html: GT_GUARD }} />
        {/* 安裝鈕共用樣式(首頁/報告/遊戲同一支 → 改 yoda-btn.css 全同步) */}
        <link rel="stylesheet" href="/yoda-btn.css" />
        {/* Google tag (gtag.js) — GA4 */}
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-DFFP3JL6EY"></script>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-DFFP3JL6EY');",
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__bip=e;});",
          }}
        />
      </head>
      <body>
        <Controls />
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
