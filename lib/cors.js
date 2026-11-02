// 跨網域存取（會員頁在 github.io、主控台在 GAS googleusercontent → 打 Vercel 都是跨網域）。
// 端點本身用 JWT / ADMIN_KEY 把關，故 Allow-Origin 開放 * 沒問題（門是 token，不是來源）。
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// 回 JSON（附 CORS）
export function J(data, status) {
  return Response.json(data, { status: status || 200, headers: CORS });
}

// 回 JSON 串流（附 CORS）：內容和 J 完全相同，只是分塊送。Vercel 一次回傳上限 4.5MB，串流不受限；只給整份報告這種大回應用。
const STREAM_CHUNK = 64 * 1024;
export function streamJson(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let i = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (i >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(i, i + STREAM_CHUNK));
      i += STREAM_CHUNK;
    },
  });
  return new Response(body, { headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// 預檢回應
export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}
