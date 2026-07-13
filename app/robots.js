const BASE = "https://yoda-research.vercel.app"; // 部署後若綁自訂網域,改這裡
export default function robots() {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: BASE + "/sitemap.xml",
  };
}
