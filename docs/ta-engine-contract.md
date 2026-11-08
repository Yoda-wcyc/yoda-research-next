# ta-engine 回應契約（schema `ta-engine-1`，2026-11-08）

會員技術分析網站版的 Python 計算引擎。Next 端（之後的 `/api/ta-*` 路由）在**伺服器端**呼叫它，瀏覽器永遠不直接打引擎。

```
瀏覽器 ──(會員 JWT)──▶ Next /api/ta-xxx ──(X-TA-Engine-Key)──▶ ta-engine /api/engine ──▶ Yahoo chart v8
          驗登入＋ta_access＋每日 30 檔額度          驗金鑰（沒過 401，不碰 Yahoo）
```

正本在 `Skill\ta_engine.py`（＋`analyze_symbol.py`、`ta_trade.py`）。本 repo 的 `ta-engine\` 是同步出來的副本，
`ta-engine\vendor.json` 記 sha256；**不要直接改副本**，改 Skill 再跑：

```
python "G:\Yoda x Claude\Skill\ta_engine.py" --sync "G:\Yoda x Claude\_deploy\yoda-research-next\ta-engine"
python "G:\Yoda x Claude\Skill\ta_engine.py" --check-vendor "G:\Yoda x Claude\_deploy\yoda-research-next\ta-engine"
```

## 1. 呼叫

`GET {ENGINE}/api/engine?symbol=<代號>&tf=<1H|4H|D|W>`

| 項目 | 值 |
|---|---|
| Header | `X-TA-Engine-Key: <hex>`，`hex = HMAC-SHA256(key=TA_ENGINE_KEY, msg="ta-engine")` 小寫 hex 64 字 |
| symbol | 台股數字代號（`2330`、`00878`、`6488`，可帶 `.TW`／`.TWO`）；美股英文代號（`NVDA`、`SPY`、`BRK.B`）。大小寫、前後空白不拘 |
| tf | `1H`、`4H`、`D`（日K）、`W`（週K）；預設 `D` |
| 回應 | `application/json; charset=utf-8`，`Cache-Control: private, no-store` |

`TA_ENGINE_KEY`＝引擎專用密鑰（2026-11-08 起取代 `JWT_SECRET` 衍生）：Next 專案與 ta-engine 專案設**同一個值**；引擎完全不讀 `JWT_SECRET`。
選 HMAC 衍生值而不是直接比對原始密鑰：原始密鑰不出現在線路／log 上；引擎用 `hmac.compare_digest` 定時比對。
任一邊沒設：引擎回 401（log 印 `ta-engine: TA_ENGINE_KEY 沒設，全部請求回 401`）；Next 不打引擎、直接回 502（log 印 `[ta-live] TA_ENGINE_KEY 沒設…`）；
引擎回 401 時 Next 也回 502，log 印 `[ta-live] 計算引擎回 401：兩邊的 TA_ENGINE_KEY 不一致…`。

Node 端產金鑰：

```js
import crypto from 'crypto';
const key = crypto.createHmac('sha256', process.env.TA_ENGINE_KEY).update('ta-engine').digest('hex');
const r = await fetch(`${ENGINE}/api/engine?symbol=${encodeURIComponent(sym)}&tf=${tf}`,
                      { headers: { 'X-TA-Engine-Key': key }, cache: 'no-store' });
```

### 錯誤

一律 `{ "ok": false, "error": { "code": "...", "message": "給人看的中文" } }`

| HTTP | code | 什麼時候 |
|---|---|---|
| 401 | `unauthorized` | 沒帶／帶錯金鑰，或引擎那邊沒設 `TA_ENGINE_KEY` |
| 400 | `bad_symbol` | 格式不對、指數（`^` 開頭）、加密貨幣／外匯格式 |
| 400 | `bad_tf` | tf 不是 1H／4H／D／W |
| 404 | `not_found` | Yahoo 查無（台股 `.TW`、`.TWO` 都試過） |
| 422 | `not_supported` | 查得到但不是個股／ETF（`instrumentType` 不是 `EQUITY`／`ETF`） |
| 422 | `too_few_bars` | 定案 K 少於 30 根（新上市） |
| 502 | `upstream` | Yahoo query1、query2 都沒回 |
| 500 | `internal` | 引擎例外（message 只給例外型別） |

**額度要在 Next 端算**：同一檔換 tf／均線組不算新的一檔；`not_found`／`bad_symbol` 要不要扣額度由 Next 決定（建議不扣）。

## 2. 資料口徑

| 週期 | 來源 | 說明 |
|---|---|---|
| 1H | Yahoo `interval=1h&range=730d` | 只留開盤起整點對齊的 K（台股 09:00…13:00、美股 09:30…15:30）；Yahoo 在收盤那刻補的假 K（台股 13:30、美股 16:00、量 0）丟掉 |
| 4H | 由 1H 合成 | 每個交易日從開盤起每 4 小時一段：台股 `[09:00,13:00)`＋`[13:00,13:30]`，美股 `[09:30,13:30)`＋`[13:30,16:00]`；依時間切，缺一根不錯位；K 標在該段開始時間 |
| D | Yahoo `interval=1d&range=10y` | — |
| W | 由日K 合成 | 週一～週五一根，標在該週**最後一個交易日** |

- 時間一律是**交易所當地時間**字串：日K／週K `YYYY-MM-DD`；1H／4H `YYYY-MM-DD HH:MM`。
- 開高低收依 Yahoo 除息事件往前還原（＝Yahoo adjclose 口徑，實測差 <0.001%），量不動。
- Yahoo 1H 有價動卻量 0 的 K＝缺量，`v` 給 `null`（台股盤中第一根很常見）；量比、前五大量會跳過，`notes` 會寫幾根。4H 的量＝該段有量的 1H 加總。
- **盤中未定**：K 棒結束時間還沒到；收盤那一根（日K、週K、每天最後一段 1H／4H）要收盤＋15 分鐘才定案；週K 要到該週五收盤＋15 分鐘。
  未定的 K **只上圖**（`bars[i].final=false`，只會在尾巴，通常 1 根），訊號、均線排列、進出場回測一律只用定案 K。
- 快取：引擎行程記憶體內，同代號＋Yahoo 週期 15 分鐘內不重抓；日K 收盤後抓的用到收盤後 17 小時。快取不對外（沒金鑰拿不到）。

## 3. 成功回應（頂層）

```jsonc
{
  "ok": true, "schema": "ta-engine-1", "tf": "D",
  "symbol": { "input": "6488", "code": "6488", "yahoo": "6488.TWO", "market": "tw|us",
              "type": "EQUITY|ETF", "name": "GlobalWafers Co., Ltd.",   // Yahoo longName（台股是英文名），可能為 null
              "exchange": "Taipei Exchange", "currency": "TWD", "timezone": "Asia/Taipei" },
  "generated_at": 1794000000, "fetched_at": 1793999900, "cached": false,   // epoch 秒
  "asof": "2026-11-06",              // 最後一根「定案」K 的時間
  "bars_total": 2430, "bars_completed": 2430,   // 全部抓到的根數／定案根數（回測用全部定案 K）
  "unfinished": false, "unfinished_label": null, // 有未定 K 時 true／"盤中未定"
  "chart":   { ... },                // §4
  "signals": { ... },                // §5
  "trade":   { ... },                // §6
  "notes":   ["近 120 根裡有 22 根 Yahoo 沒給量…"]   // 資料狀態說明，照列在圖下
}
```

## 4. `chart`（畫圖需要的全部東西）

視窗＝最後 120 根**定案** K ＋ 尾巴的未定 K（所以 `n` 是 120 或 121；歷史不足 120 時更少）。
下面所有 `i`＝`bars` 陣列的 index；**`i = -1` 表示在視窗左邊**（線從左緣畫起、不畫記號）。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `n` | int | `bars` 長度 |
| `bars[]` | `{t, o, h, l, c, v, final}` | 價格已四捨五入（≥1 兩位、<1 四位）；`v` 可能 null |
| `sma` | `{"5":[…],"8":[…],"10":[…],"13":[…],"20":[…],"34":[…],"60":[…],"120":[…]}` | 跟 `bars` 對齊，暖身不足為 null |
| `ma_sets` | `{short:[5,10,20], mid:[8,13,34], long:[20,60,120]}` | UI 切「短／中／長」時畫哪三條（預設 short） |
| `ema10` | number[] | ta_trade 同一條 EMA10（全歷史 `ewm(span=10, adjust=False)`），跟 `bars` 對齊 |
| `ema10_label` | `"EMA10（出場線）"` | 圖例文字 |
| `overlays.sr[]` | `{kind:"support"\|"resistance", price, style:"solid"\|"dashed", color:"#ffffff", pick_scope:"within10"\|"beyond", dist_pct}` | 每側最多一條。support＝白實線、resistance＝白虛線；`beyond`＝±10% 內沒有、取範圍外最強（ta_local 會標「10% 內無，取範圍外最強」） |
| `overlays.top_volume[]` | `{rank, i, t, high, low, vol_ratio, read}` | 前五大量 K：K 棒金框＋金色量柱（`#ffc94a`）；`read`＝大量K 解讀 |
| `overlays.gaps[]` | `{i, t, dir:"up"\|"down", top, bottom, fill:"none"\|"partial"\|"full", fill_i, open_top, open_bottom, type, type_short, island}` | 缺口框：`full`＝從 `i` 畫到 `fill_i`、`top～bottom`；`none`／`partial`＝從 `i` 畫到右緣、只畫剩下的 `open_bottom～open_top`。`type_short`（突／逃／竭／彈／回／普／島…）可標在框上 |
| `overlays.islands[]` | `{kind:"top"\|"bottom", name, i0, i1, high, low}` | 島狀反轉區段 |
| `legend[]` | `{key, label, desc}` | 圖例說明文字（直接列出即可） |

### 4.1 進出場記號 `trade.markers[]`

| kind | 欄位 | 畫法（同 ta_local） |
|---|---|---|
| `entry` | `i, side(1\|-1), px, label("多進"\|"空進")` | 多＝紅（`#e0525e`）三角箭頭在 K 低點下方＋「多進」；空＝綠（`#3fae7a`）箭頭在 K 高點上方＋「空進」 |
| `add` | `i, side, px, label("加碼")` | 菱形畫在 `px`（加碼成交價），多紅空綠，字放 K 棒外側 |
| `exit` | `i, side, px, why, label, tone, stack` | ✕ 畫在 `px`；`label` 是縮寫原因（停損／保本／停利½／破10線／爆量反K／加碼停損，加碼那段一起出時前面加「加碼」）；顏色依 `tone`：`tp`＝黃 `#ffd23f`、`stop`＝紅 `#ff4d4d`、`add_stop`＝橘 `#ff9f40`、`exit`＝白；同一筆第幾段 `stack`（0,1,2…）用來把字錯開 |

### 4.2 線 `trade.lines[]`：`{kind, i0, i1, y}`

`i1 = null`＝**延伸到價格區右緣**（持倉中的線）。

| kind | 畫法 |
|---|---|
| `stop` | 紅虛線 `#ff4d4d`（dash `5 3`）：原始停損，進場→停利一半（沒停利就到出場） |
| `stop_be` | 紅虛線：停利一半後移到進場價的保本停損，停利那根→出場 |
| `tp1` | 黃點線 `#ffd23f`（dash `1.5 2.5`）：停利 2R，進場→停利或出場（2R 價 ≤ 0 時不給，見 §6） |
| `add_stop` | 橘虛線 `#ff9f40`（dash `5 3`）：加碼停損，加碼→加碼停損出場（或整筆出場） |
| `open_entry` | 淡藍實線 `#9ad0ff`：目前持倉進場價，到右緣 |
| `open_stop` | 紅虛線：目前停損（已停利一半時＝進場價），到右緣；原單已全出時不給 |
| `open_tp1` | 黃點線：停利一半價位，到右緣（`trade.open.tp1_done` 為 true 時可標「✓已出」）；2R 價 ≤ 0 時不給，右側也不放「停利一半」標籤 |
| `open_add_stop` | 橘虛線：加碼那份還在時的加碼停損，到右緣 |

持倉中的右側標籤（ta_local 的做法）：`多單進場 x`／`停損 x`／`停利一半 x（✓已出）`／`加碼停損 x`，跟撐壓標籤一起避讓。

## 5. `signals`（sig3-2 原樣，套在所選週期）

`analyze_symbol.compute_signals` 的輸出原封不動，只有 `ma_align` 換成三組。欄位裡的 `days_ago`、`days` 等**單位是「根」**（UI 要寫「近 120 根」「N 根前」，不要寫天）。

| 欄位 | 說明 |
|---|---|
| `schema` | `"sig3-2"` |
| `window_bars` | 訊號視窗根數（≤120） |
| `top_volume` | `{unit, items[≤5], badge}`；item：`rank, date, days_ago, volume, avg20_prev, vol_ratio, open, high, low, close, chg_pct, candle, body_ratio, close_pos, relation, dist_high_pct, dist_low_pct, trend, position, position_zh, read, basis{…}` |
| `gaps` | `{n, n_open, n_filled, items[], badge{above, below, text, last}, islands[]}`；item：`date, dir, top, bottom, size_pct, vol_ratio, days_ago, fill, fill_date, open_top, open_bottom, dist_pct, trend, position, position_zh, seq, seq_from, vol_class, type, type_short, notes[], island, island_kind, basis{…}`（**全部缺口、沒有門檻**） |
| `ma_align` | `{short, mid, long, badge}`；每組：`lines_n, close, lines[{name,n,value,slope}], state("多頭排列"\|"空頭排列"\|"糾結"\|"insufficient"), why, fails[], days, days_capped, since, nearest_break{a,b,a_value,b_value,gap_pct}`；`badge`＝`{short:"短多", mid:"中空", long:"長糾", text:"短多・中空・長糾"}`。規則：順序成立**且**三條同向斜率；`days`＝連續成立幾根；`nearest_break`＝最接近被破壞的一對及距離 |
| `sr_levels` | `{tol, atr14, support[≤1], resistance[≤1], n_candidates, n_lines, badge}`；線：`price, kind, sources[], touches, touch_dates[], last_touch_date, strength, dist_pct, testing, strongest, pick_scope` |
| `badges` | `{vol, gap, ma, sr, gap_type}` 一行摘要字串 |

注意：本機 ta_local／analyze_symbol 的 `ma_align.mid` 是 20/60/120；網站版的 `mid` 是 8/13/34、`long` 才是 20/60/120。

## 6. `trade`（ta_trade，含加碼；所有開通者都看得到）

| 欄位 | 說明 |
|---|---|
| `trades[]` | 全期每一筆（舊到新）：`side, entry_t, entry, stop0, tp1, tp1_na, tp1_note, exit_t, pts, pct, vr, add, legs[]`。④ 表的「最近 10 筆」取最後 10 筆反序，`#`＝在 `trades` 的序號＋1 |
| `trades[].add` | `null` 或 `{t, px, stop, qty}`（qty 0＝加碼那份已出） |
| `trades[].legs[]` | `{t, px, qty, why, entry_px, is_add, label}`；`why`：停損／保本出／停利一半(2R)／收破10線／爆量反向K／加碼停損；`pts＝Σ side×qty×(px−entry_px)`，`pct＝pts÷原進場×100` |
| `open` | `null` 或 `{side, entry_t, entry, stop, stop0, tp1, tp1_na, tp1_note, tp1_done, qty, add}`（`qty` 0.5＝已停利一半；0＝原單已出、只剩加碼） |
| `tp1_na`／`tp1_note` | 2R 停利價 ≤ 0（空單風險大於進場價一半，例：6488 週K）：`tp1=null`、`tp1_na=true`、`tp1_note="2R 停利價低於 0，不適用"`，不畫 `tp1`／`open_tp1` 線；表格該格改寫 `tp1_note`。交易邏輯不變（ta_trade 照算，那個價永遠碰不到）。正常時 `tp1_na=false`、`tp1_note=null` |
| `stats` | `{n, wins, win_rate, sum_pts, sum_pct, avg_win_pct, avg_loss_pct, max_consec_loss, adds, start, end, bars, n_long, n_short}`（`bars`＝回測用的定案根數；% 已四捨五入兩位） |
| `banner` | `{bad, min_n:8, win_pct:25, text}`：`n ≥ 8` 且（勝率 <25% 或合計 <0）→ `bad=true`，`text`＝「這套規則在這檔的歷史表現不好（N 筆、勝率 x%、合計 y%），進出場點不適用」 |
| `note` | `"樣本內統計，不代表未來；未計手續費與滑價"`（放統計旁邊） |
| `markers[]`、`lines[]` | §4.1、§4.2 |

規則全文（ta_local 的白話規則可照搬）：EMA5/10/20 排列剛成立（本根成立、前 3 根不是全部成立）＋量比 ≥1.2（對前 10 根均量）＋收在 EMA5 同側進場；
停損＝近 3 根最低（空單最高），盤中碰到成交 `min(開盤, 停損)`；2R 先出一半（成交在 2R 價）、停損移到進場價；
剩下收破 EMA10 或爆量反向K（量比 ≥2、反向K、收破 EMA5）出；同一根同時碰停損與停利算停損。
加碼：停利一半之後，某根碰 EMA10 但沒收破、下一根收在 EMA5 外側且量比 ≥1.2 → 收盤加 0.5（最多一次）；加碼停損＝近 3 根最低（空單最高），碰到只出加碼那份；之後剩下的一起照出場規則出。

## 7. 本機開發

```
$env:TA_ENGINE_KEY = 'local-dev-only'   # 沒設時 dev_server 自動用這個；Next 的 .env.local 也放 TA_ENGINE_KEY=local-dev-only
python "G:\Yoda x Claude\_deploy\yoda-research-next\ta-engine\dev_server.py"      # http://127.0.0.1:8790/api/engine
```

Next 端引擎網址：本機 `http://127.0.0.1:8790`；線上＝獨立 Vercel 專案的網址（見 §8）。

## 7.1 環境變數（兩個 Vercel 專案）

| 專案 | 變數 | 值 |
|---|---|---|
| Next 正式站（本 repo 根目錄） | `TA_ENGINE_KEY` | 新產的隨機字串（≥32 bytes，例：`python -c "import secrets;print(secrets.token_hex(32))"`） |
| Next 正式站 | `TA_ENGINE_URL` | ta-engine 專案網址（不設＝`https://yoda-ta-engine.vercel.app`） |
| ta-engine（Root Directory＝`ta-engine`） | `TA_ENGINE_KEY` | 跟 Next 那邊**一模一樣** |
| ta-engine | `JWT_SECRET` | 不需要；之前若設過可刪（引擎已不讀） |

改完兩邊都要 Redeploy 才生效；只改一邊＝全部 502（Next log 會寫 401 不一致）。

## 8. 部署形態（為什麼是獨立專案）

不能把 `api/*.py` 放在這個 Next repo 的根目錄：Vercel 只在根目錄 `/api` 找 Python 函式，而社群回報 Next App Router 專案一旦有根目錄 `api/`，
`/api/*` 會被導去 Python、`app/api/*` 的路由變 404（本站 `/api/ecpay-notify`、`/api/member-login` 等 30 個路由都在 `app/api/`）。
Vercel Services 可以同專案共存，但要改 Framework Preset 並把整個 Next 站搬進 services 設定，動到正式站。
所以引擎是本 repo 裡的 `ta-engine/` 子資料夾，另開一個 Vercel 專案（Root Directory＝`ta-engine`），對正式站零影響。

| 檔案 | 用途 |
|---|---|
| `ta-engine/api/engine.py` | Vercel 函式（`BaseHTTPRequestHandler`），網址 `/api/engine` |
| `ta-engine/ta_engine.py`、`analyze_symbol.py`、`ta_trade.py` | Skill 副本（vendor.json 鎖 sha256） |
| `ta-engine/requirements.txt` | `numpy==2.3.2`、`pandas==2.3.1`（同本機） |
| `ta-engine/.python-version` | `3.13` |
| `ta-engine/vercel.json` | `maxDuration 60`、排除 dev_server／vendor.json |
| `ta-engine/dev_server.py` | 本機伺服器 |
