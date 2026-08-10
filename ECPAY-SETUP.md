# 綠界金流對接 · 部署與測試

信用卡定期定額（每月自動續扣）。所有密鑰只放 **Vercel 環境變數**，不進碼庫。

## 架構
```
遊戲刷卡表單(email) → /api/ecpay-create  組定期定額參數+CheckMacValue → 自動送綠界
綠界卡片頁付款 → 背景 POST → /api/ecpay-notify  驗章 → 呼叫 GAS markPaid → 回 1|OK
                                                          ↳ 標記會員已付費 / 建立創始會員
```

## Vercel 環境變數（Project → Settings → Environment Variables）

### 先用「沙盒測試」（不花錢，公開測試特店）
| Key | Value |
|---|---|
| `ECPAY_ENV` | `stage` |
| `ECPAY_MERCHANT_ID` | `3002607` |
| `ECPAY_HASHKEY` | `pwFHCqoQZGmho4w6` |
| `ECPAY_HASHIV` | `EkRm7iFT261dpevs` |
| `GAS_URL` | 你的 Apps Script `/exec` 網址 |
| `GAS_SHARED_SECRET` | 與 `會員系統/Code.gs` 的 `CONFIG.PAY_SECRET` 完全相同（見對話） |
| `ECPAY_CLIENT_BACK_URL` | `https://yoda-wcyc.github.io/-/subscribe.html?paid=1` |

### 測通後改「正式」（收真實訂閱）
| Key | Value |
|---|---|
| `ECPAY_ENV` | `production` |
| `ECPAY_MERCHANT_ID` | `3505508` |
| `ECPAY_HASHKEY` | `<你的正式 HashKey，只貼進 Vercel、勿寫進碼庫>` |
| `ECPAY_HASHIV` | `<你的正式 HashIV，只貼進 Vercel、勿寫進碼庫>` |

> 其餘變數（GAS_URL / GAS_SHARED_SECRET / ECPAY_CLIENT_BACK_URL）不動。
> 改完環境變數要 **Redeploy** 才生效。

## GAS（Code.gs）
1. 把最新 `會員系統/Code.gs` 貼進 Apps Script → 存檔 → **重新部署（選新版本）**。
2. 已內含 `markPaid` action 與 `CONFIG.PAY_SECRET`（須與 Vercel `GAS_SHARED_SECRET` 一致）。

## 測試步驟（沙盒）
1. Vercel 設好上表 stage 變數 → Deploy。
2. 開遊戲結局頁 → 勾同意 → 填 email → 送出 → 應導到綠界測試卡片頁。
3. 測試卡：`4311-9511-1111-1111`，到期日填未來任意月/年，CVV 任意 3 碼，3D 驗證碼 `1234`。
4. 付款成功 → 綠界背景通知 `/api/ecpay-notify` → 你的 Google Sheet「Members」該 email 應變 `active`、`plan=創始`、`paid_periods+1`；「Payments」多一筆。
5. 主控台會員名單能看到該會員（方案=創始）。

## 註冊/付款順序（Option B）
- 遊戲付款區＝先填 email+密碼 → 呼叫 GAS `register`（建立創始會員）→ 再前往綠界付款。
- 付款成功後 `markPaid` 只把「已註冊的該 email」標成已付費（active、期數+1）。
- 找不到會員時 **不** 建無密碼帳號，改記進「Payments」分頁待手動對帳。

## 正式上線前
- 綠界後台「信用卡定期定額」：✅ 已開通。
- Vercel 環境變數換成正式那組（`ECPAY_ENV=production` + 商店代號 3505508 + 正式 HashKey/HashIV）→ **Redeploy**。
- 用你自己的卡小額實測一筆，確認主控台入帳後，到綠界後台退款/取消訂閱。
- 沙盒測試建立的會員，記得在主控台「會員名單」刪掉，別混進正式名單。
