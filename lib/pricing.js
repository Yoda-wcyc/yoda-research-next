// ====== 價目表：唯一來源 ======
// 這裡是整個系統唯一該寫價格的地方。其他地方一律從這裡取，不要再各自寫死。
//
// 為什麼需要這個檔：價格原本散在四處（綠界建單金額、主控台、GAS、訂閱頁文案），
// 任一處忘了改，就會出現「網頁寫一個價、實際扣另一個價」——那是直接對客人出錯。
//
// 三個執行環境各自怎麼取：
//   · Vercel 伺服器（ecpay-create 等）→ 直接 import 這個檔（真正的同一份，不可能不同步）
//   · 主控台、訂閱頁、直接訂閱頁     → 呼叫 /api/pricing 取（頁面有內建預設值當退路）
//   · GAS                            → 每次比對時呼叫 /api/pricing；取不到才用自己的備援值
//
// ★改價只要改這裡。改完 push，其他地方會自己跟上。

export const PRICING = {
  currency: 'TWD',
  plans: {
    // 2026-08-22 額滿停售。既有會員的綠界訂單金額鎖在建單當下，永遠維持 459。
    創始: { monthly: 459, sellable: false, closedAt: '2026-08-22' },
    一般: { monthly: 589, sellable: true },
  },
  current: '一般',   // 目前對外販售的方案
};

// 目前對外販售的方案別與月費（新訂單用這個）
export function currentPlan() { return PRICING.current; }
export function currentPrice() { return PRICING.plans[PRICING.current].monthly; }

// 某個方案「應該」的月費；未知方案回 0（呼叫端要當成「無從判斷」，不要當成 0 元）
export function priceOf(plan) {
  const p = PRICING.plans[String(plan == null ? '' : plan).trim()];
  return p ? p.monthly : 0;
}

// 某個方案的完整資訊（含是否還在販售、何時停售）；未知方案回 null
export function planInfo(plan) {
  return PRICING.plans[String(plan == null ? '' : plan).trim()] || null;
}

// 給前端與 GAS 用的精簡格式：{ '創始': 459, '一般': 589 }
export function priceMap() {
  const out = {};
  Object.keys(PRICING.plans).forEach((k) => { out[k] = PRICING.plans[k].monthly; });
  return out;
}
