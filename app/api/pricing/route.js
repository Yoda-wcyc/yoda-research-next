import { PRICING, priceMap, currentPlan, currentPrice } from '../../../lib/pricing';
import { J, preflight } from '../../../lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function OPTIONS() { return preflight(); }

// 公開的價目表（就是網頁上寫的售價，本來就對外，沒有機密）。
// 訂閱頁、直接訂閱頁在 github.io、主控台在 Vercel、GAS 在 Google——三個不同來源都靠這支取價，
// 這樣「網頁寫一個價、實際扣另一個價」就不可能發生。
// 各頁面仍保留內建預設值當退路：這支掛掉時頁面照常顯示，只是失去自動同步。
async function handle() {
  return J({
    ok: true,
    currency: PRICING.currency,
    current: { plan: currentPlan(), monthly: currentPrice() },
    prices: priceMap(),          // { '創始': 459, '一般': 589 }
    plans: PRICING.plans,        // 含 sellable / closedAt，給頁面判斷要不要顯示
  });
}
export async function GET() { return handle(); }
export async function POST() { return handle(); }
