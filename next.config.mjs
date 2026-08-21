/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // /api/console 在執行時用 fs 讀 console.html，這個檔案不是 import 進來的，
    // Next 的靜態分析看不到 → 必須明確要求把它一起打包進 serverless function，
    // 否則線上會 500（本機開發看不出來，因為本機讀得到專案檔案）。
    outputFileTracingIncludes: {
      '/api/console': ['./app/api/console/console.html'],
    },
  },
};
export default nextConfig;
