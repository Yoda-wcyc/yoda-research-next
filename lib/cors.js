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

// 預檢回應
export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}
