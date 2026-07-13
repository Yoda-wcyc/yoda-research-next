import "./globals.css";
import Controls from "../components/Controls";
import PwaRegister from "../components/PwaRegister";

export const metadata = {
  metadataBase: new URL("https://yoda-research-next.vercel.app"),
  title: "Yoda Research｜用最清澈的白話，凌駕喧囂，解碼美股與台股的真實訊號。",
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
      <body>
        <Controls />
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
