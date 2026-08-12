import { SAMPLE_B64 } from './sample';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── 第0步 · 速度證明（不影響任何現有頁面）──
// 模擬「選項②：報告內容存在 Vercel 自己家 → 驗票 → 烤逐人浮水印 → 吐出」的完整供內容路徑，量它多快。
// 真實版會在最前面做 JWT 驗票(HMAC 驗簽，實測 <1ms)；這裡先跳過，專心量「讀內容+浮水印+回傳」的伺服器耗時。
export async function GET(req) {
  const t0 = Date.now();
  const url = new URL(req.url);
  const wm = url.searchParams.get('wm') || 'PROOF-9MWDX · d***@gmail.com';

  // 選項②：內容就在 Vercel 部署裡，讀取零跨服務延遲（正式版會放 Blob/KV，這裡先 bundle 一份代表大小）
  let html = Buffer.from(SAMPLE_B64, 'base64').toString('utf8');
  html = html.split('{{WATERMARK}}').join(wm); // 逐人浮水印：即使樣本無 token，仍完整掃一遍量成本

  const serveMs = Date.now() - t0;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-serve-ms': String(serveMs), // 伺服器端處理耗時（解碼+浮水印）
      'x-content-kb': String(Math.round(html.length / 1024)),
      'cache-control': 'no-store',
    },
  });
}
