const BASE = "https://yoda-research.vercel.app"; // 部署後若綁自訂網域,改這裡
export default function sitemap() {
  return [
    { url: BASE + "/", lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: BASE + "/archive", lastModified: new Date(), changeFrequency: "daily", priority: 0.8 },
  ];
}
