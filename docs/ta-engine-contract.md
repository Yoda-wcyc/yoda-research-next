# ta-engine 回應契約（schema `ta-engine-3`，2026-11-09；11-10 加期貨／費半，只加欄位）

> 11-10（schema 不變、**只加欄位**，舊頁面拿到新回應、新頁面拿到舊回應都要能跑）：收美國期貨連續月（ES、NQ、YM、RTY、GC、CL）與 ^SOX。
> 新欄位：頂層 `has_volume`、`symbol.has_volume`／`contract`／`continuous`、`chart.overlays.rolls`（換月）、`chart.legend` 的 `roll`／（沒量時）少 `top_volume`。
> 頁面一律當可缺：`has_volume` 缺＝看 `history.v` 有沒有 >0 的量；`rolls` 缺＝空陣列。

> 11-09 晚（`ta-engine-2` → `ta-engine-3`，Yoda 定）：`overlays.gaps`／`overlays.islands` 改算**整段歷史**、`i` 改成 `history` 的絕對位置，缺口改欄位表格式（§4）；
> `overlays.top_volume` 拿掉——前五大量改在瀏覽器依「目前可見區間」算（只算定案 K；量倍數＝這根量 ÷ 之前 20 根均量，用整段 history）。`signals`（近 120 根）不變。

> 11-09 改版（`ta-engine-1` → `ta-engine-2`）：回應拿掉 `trade` 與 `chart.ema10`／`ema10_label`、圖例拿掉進出場那幾項，改帶 `history`（全部 K）。
> 進出場回測改在瀏覽器用 `lib/ta-trade.js` 依「交易規則控制面板」的參數即時算（§6），免得引擎與瀏覽器兩份結果打架。

會員技術分析網站版的 Python 計算引擎。Next 端（之後的 `/api/ta-*` 路由）在**伺服器端**呼叫它，瀏覽器永遠不直接打引擎。

```
瀏覽器 ──(會員 JWT)──▶ Next /api/ta-xxx ──(X-TA-Engine-Key)──▶ ta-engine /api/engine ──▶ Yahoo chart v8
          驗登入＋ta_access＋每日 30 檔額度          驗金鑰（沒過 401，不碰 Yahoo）
```

正本在 `Skill\ta_engine.py`（＋`analyze_symbol.py`；11-09 起引擎不再用 `ta_trade.py`）。本 repo 的 `ta-engine\` 是同步出來的副本，
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
| symbol | 台股數字代號（`2330`、`00878`、`6488`，可帶 `.TW`／`.TWO`）；美股英文代號（`NVDA`、`SPY`、`BRK.B`）。大小寫、前後空白不拘。<br>美國期貨（白名單，§2.1）：`ES=F`／`ES1!`／`/ES`，`NQ`、`YM`、`RTY`、`GC` 也收純代號；純 `ES`、`CL` 照查股票（Eversource、Colgate），期貨要打 `ES1!`／`CL1!`。中文別名：小那、那指期→NQ；小道、道瓊期→YM；小標普、標普期→ES；小羅素→RTY；黃金期→GC；原油期、輕原油→CL。<br>指數只收 `^SOX`（也收 `SOX`、費半、費城半導體）。`TXF1!`、`SXF1!`、台指期、小台、費半期 → 422 `coming_soon`（下一階段接 TAIFEX） |
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
| 400 | `bad_symbol` | 格式不對、指數（`^` 開頭，`^SOX` 除外）、加密貨幣／外匯格式、微型期貨（`MES=F` 等，還沒做） |
| 400 | `bad_tf` | tf 不是 1H／4H／D／W |
| 404 | `not_found` | Yahoo 查無（台股 `.TW`、`.TWO` 都試過） |
| 422 | `not_supported` | 查得到但不是個股／ETF（`instrumentType` 不是 `EQUITY`／`ETF`；期貨白名單要是 `FUTURE`、`^SOX` 要是 `INDEX`） |
| 422 | `coming_soon` | 台指期／費半期（`TXF1!`、`SXF1!`…）：`message`＝「台指期／費半期資料整合中」；Next 回 `reason: "coming-soon"`、不扣額度 |
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
- 快取：引擎行程記憶體內，同代號＋Yahoo 週期 15 分鐘內不重抓；日K 收盤後抓的用到收盤後 17 小時（期貨 17:00 收、18:00 開，只用到收盤後 1 小時）。快取不對外（沒金鑰拿不到）。
- **沒有成交量**（11-10）：定案 K 的量全是 0／缺（`^SOX`：Yahoo 1H、日K 的量全是 0）→ 頂層 `has_volume=false`、`history.v` 全 `null`、`notes` 寫「這檔 Yahoo 不給成交量（指數沒有量）…」、
  `legend` 不給 `top_volume`；瀏覽器回測量的進場門檻與爆量反向K 不套用（§6）。

### 2.1 美國期貨（11-10）

| 根 | Yahoo | 中文名（`symbol.name`） | `symbol.exchange` | 換月偵測的參考標的 |
|---|---|---|---|---|
| ES | `ES=F` | E-mini 標普 500 期貨 | CME | `^GSPC` |
| NQ | `NQ=F` | E-mini 那斯達克 100 期貨 | CME | `^NDX` |
| YM | `YM=F` | E-mini 道瓊期貨 | CBOT | `^DJI` |
| RTY | `RTY=F` | E-mini 羅素 2000 期貨 | CME | `^RUT` |
| GC | `GC=F` | 黃金期貨 | COMEX | `GLD` |
| CL | `CL=F` | 輕原油期貨 | NYMEX | `USO` |

`symbol.code`＝`ES1!` 這種寫法（最近查過、網址 `#s=` 都用它）；`symbol.market="fut"`、`type="FUTURE"`、`contract`＝Yahoo 連續月目前接的合約（例 `E-Mini S&P 500 Dec 26`）、`continuous=true`。
`^SOX`：`market="us"`（美股盤別）、`type="INDEX"`、`name`＝費城半導體指數、`has_volume=false`。

盤別＝CME 交易日（美東時間）：前一天 18:00 開、當天 17:00 收（17:00～18:00 休市；週日 18:00 開、週五 17:00 收）。

| 週期 | 說明 |
|---|---|
| 1H | 整點 K，18:00～隔天 16:00 共 23 根。丟掉 17:00 那根雜訊 K（休市時段）與沒對齊整點又沒價動的即時跳動點；提早收盤日對齊 :30 的 K 併進所在的整點；有價動卻量 0（18:00 開盤那根約八成）＝缺量 `null`。結束＝下一個整點，最晚 17:00 |
| 4H | 由 1H 從 18:00 起切：18、22、02、06、10、14（14:00～17:00 那段 3 小時，同 TradingView）；K 標在該段開始時間 |
| D | Yahoo `1d`（K 標在交易日 00:00、收盤＝**結算價**）；結束＝當天 17:00。量 0、或跟前一根一模一樣（Yahoo 最近一個收完的交易日常抄前一天的量）→ `null` |
| W | 日K 週一～週五合併，結束＝週五 17:00 |

定案（`bars_completed`）同一套規則：K 的結束時間到了才算；結束在 17:00 的那根（1H 16:00、4H 14:00、日K、週K）要 17:15。週末全部定案；週日 18:00 起是週一那根（盤中未定）。
注意 1H 的 00:00 那根時間字串只有日期（`2026-11-10`，沿用 `analyze_symbol._d`），其他整點帶時分。

### 2.2 換月（`chart.overlays.rolls`；價格**不還原**）

Yahoo 連續月到期前直接接下一個合約、沒有還原，也拿不到已到期合約 → 從「期貨 ÷ 參考標的」價差（basis）的跳動找換月：
股指在季月第三個週五 E 前後（窗口 E−8 天～E 後第一個交易日，日K 不比 E 當天：那天 Yahoo 收盤是到期合約的最後結算價）；
GC 在交割月 G/J/M/Q/Z 前一個月最後營業日（FND）前 5～後 2 個營業日；CL 在 25 日往前 3 個營業日（LTD）前 5～後 2 個營業日。
窗口內 |Δln(F/R)| 最大、且大於 max(25bp, 5×近一年 MAD) 那天＝換月日（日K 用收盤；1H／4H 用 15:00 那根 1H 的收盤＝16:00，跟參考標的收盤同時）。
GC、CL 日K 結算時間跟 ETF 收盤不同、雜訊太大 → 在 {FND, FND+1}／{LTD, LTD+1} 挑開盤跳空大的那根。日K／週K 偵測不到（2017～2021 低利率時股指只差幾 bp）或參考標的抓不到 → 用日曆
（股指 E 後第一個交易日、GC＝FND、CL＝LTD+1）。1H 是在 K 中間拼接：換月那根＝當天報酬與 Δbasis 同向且最大的那根（2025-06 以前股指在到期日 16:00 那根）——只能定位到「最可能的那根」，GC 偶爾差幾根。
2026-11-10 用現行合約逐根比對確認：ES／NQ 1H 2026-09-14 11:00、日K 2026-09-21；YM 1H 09-14 03:00；RTY 1H 09-14 05:00；GC 日K 2026-07-31；CL 1H 2026-10-15、日K 2026-10-21（`Skill\tests\ta_engine_check.py --regress` 驗）。

| 欄位 | 說明 |
|---|---|
| `chart.overlays.rolls[]` | `{i, t, dir:"up"\|"down"\|null, step_pct, label:"換月"}`；`i`＝`history` 絕對位置（W：含換月那天的那一週；4H：含換月那根 1H 的那段）；`dir`／`step_pct`＝那天的價差跳動（只靠日曆時 `null`）。非期貨＝`[]`；**舊回應沒有這欄** |
| 缺口 | 換月那根**不算缺口**（`overlays.gaps`、`signals.gaps` 都沒有它，所以也不進撐壓、不配成島狀反轉）；其他缺口照算（回補狀態仍可能被換月的價差影響，因為價格沒還原） |
| `notes` | 期貨一律多一句「期貨連續月是 Yahoo 直接接下一個合約、價格沒有還原：換月那根（圖上標「換月」）的跳空不算缺口、不進撐壓、不算島狀反轉」 |
| `legend` | 有換月時多一項 `{key:"roll", label:"換月", desc}` |

畫法：換月那根畫灰色（`#8b95a3`）細虛直線、價格區底部小字「換月」（中性色，不是紅綠）；回測照常（換月那根也可能進出場）。

## 3. 成功回應（頂層）

```jsonc
{
  "ok": true, "schema": "ta-engine-3", "tf": "D",
  "symbol": { "input": "6488", "code": "6488", "yahoo": "6488.TWO", "market": "tw|us|fut",
              "type": "EQUITY|ETF|FUTURE|INDEX", "name": "GlobalWafers Co., Ltd.",   // Yahoo longName（台股是英文名），可能為 null；期貨／^SOX 是中文名（§2.1）
              "exchange": "Taipei Exchange", "currency": "TWD", "timezone": "Asia/Taipei",
              "has_volume": true,                                        // 11-10 加；同頂層 has_volume
              "contract": "E-Mini S&P 500 Dec 26", "continuous": true },  // 11-10 加，只有期貨有
  "generated_at": 1794000000, "fetched_at": 1793999900, "cached": false,   // epoch 秒
  "asof": "2026-11-06",              // 最後一根「定案」K 的時間
  "bars_total": 2430, "bars_completed": 2430,   // 全部抓到的根數／定案根數（回測用全部定案 K）
  "unfinished": false, "unfinished_label": null, // 有未定 K 時 true／"盤中未定"
  "has_volume": true,                // 11-10 加：false＝沒有成交量（^SOX），history.v 全 null（§2）；舊回應沒有這欄
  "chart":   { ... },                // §4
  "signals": { ... },                // §5
  "history": { ... },                // §6：全部 K（瀏覽器回測用）
  "notes":   ["近 120 根裡有 22 根 Yahoo 沒給量…"]   // 資料狀態說明，照列在圖下
}
```

## 4. `chart`（畫圖需要的全部東西）

視窗＝最後 120 根**定案** K ＋ 尾巴的未定 K（所以 `n` 是 120 或 121；歷史不足 120 時更少）。
`bars`／`sma` 只有這 120 根；`overlays.gaps`／`islands` 的 `i` 是 `history` 的絕對位置（整段歷史），頁面依時間區間自己切。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `n` | int | `bars` 長度 |
| `bars[]` | `{t, o, h, l, c, v, final}` | 價格已四捨五入（≥1 兩位、<1 四位）；`v` 可能 null |
| `sma` | `{"5":[…],"8":[…],"10":[…],"13":[…],"20":[…],"34":[…],"60":[…],"120":[…]}` | 跟 `bars` 對齊，暖身不足為 null |
| `ma_sets` | `{short:[5,10,20], mid:[8,13,34], long:[20,60,120]}` | UI 切「短／中／長」時畫哪三條（預設 short） |
| `overlays.sr[]` | `{kind:"support"\|"resistance", price, style:"solid"\|"dashed", color:"#ffffff", pick_scope:"within10"\|"beyond", dist_pct}` | 每側最多一條。support＝白實線、resistance＝白虛線；`beyond`＝±10% 內沒有、取範圍外最強（ta_local 會標「10% 內無，取範圍外最強」） |
| `overlays.gaps` | `{cols:[…], enums:{欄:[字…]}, rows:[[…], …]}` | **整段歷史**的全部缺口（分類只用缺口那根以前的 K，回補／距現價看到最後一根定案 K；口徑＝`signals.gaps` 把視窗放到整段，最近 120 根那段跟 `signals.gaps` 逐欄一樣）。`cols`＝`i, dir, bottom, top, fill, fill_i, open_bottom, open_top, type, type_short, island, trend, position_zh, seq, vol_ratio, size_pct, dist_pct, notes`；`enums` 裡有的欄（`dir`／`fill`／`type`／`type_short`／`trend`／`position_zh`）存序號，`enums[欄][序號]` 換回字（null 照舊）。`i`、`fill_i`＝`history` 絕對位置。順序同 `signals.gaps.items`（未補依離現價近到遠、已補依時間新到舊）。畫法：`full`＝從 `i` 畫到 `fill_i`、`top～bottom`；`none`／`partial`＝從 `i` 畫到右緣、只畫剩下的 `open_bottom～open_top`；`island=true` 時框旁標「島」 |
| `overlays.islands[]` | `{kind:"top"\|"bottom", name, i0, i1, start, end, bars, high, low}` | **整段歷史**的島狀反轉（`i0`／`i1`＝`history` 絕對位置）。唯一跟 `signals.gaps.islands` 可能不同的地方：A 缺口在近 120 根左邊、B 在裡面的島，整段版有、視窗版沒有 |
| `overlays.rolls[]` | `{i, t, dir, step_pct, label}` | 期貨換月（§2.2）；非期貨＝`[]`；11-10 加，舊回應沒有 |
| `legend[]` | `{key, label, desc}` | 圖例說明文字（support／resistance／top_volume／gap／unfinished，期貨有換月時加 roll，沒有成交量時拿掉 top_volume）；進出場那幾項（出場線、多進空進、停損、✕ 出場、持倉中）由頁面依面板參數產生 |

### 4.1 進出場記號（瀏覽器 `chartMarks()` 產生，格式同改版前的 `trade.markers[]`）

| kind | 欄位 | 畫法（同 ta_local） |
|---|---|---|
| `entry` | `i, side(1\|-1), px, label("多進"\|"空進")` | 多＝紅（`#e0525e`）三角箭頭在 K 低點下方＋「多進」；空＝綠（`#3fae7a`）箭頭在 K 高點上方＋「空進」 |
| `exit` | `i, side, px, why, label, tone` | ✕ 畫在 `px`（整筆出場價）；`label` 是縮寫原因（停損／破10線／爆量反K）；顏色依 `tone`：`stop`＝紅 `#ff4d4d`、`exit`＝白 |

### 4.2 線（瀏覽器 `chartMarks()` 產生）：`{kind, i0, i1, y}`

`i1 = null`＝**延伸到價格區右緣**（持倉中的線）。

| kind | 畫法 |
|---|---|
| `stop` | 紅虛線 `#ff4d4d`（dash `5 3`）：停損，進場→出場（抱著期間不動） |
| `open_entry` | 淡藍實線 `#9ad0ff`：目前持倉進場價，到右緣 |
| `open_stop` | 紅虛線：目前持倉的停損，到右緣 |

持倉中的右側標籤（ta_local 的做法）：`多單進場 x`／`停損 x`，跟撐壓標籤一起避讓。

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

## 6. `history` ＋ 瀏覽器回測（`lib/ta-trade.js`，2026-11-09 交易規則控制面板）

| 欄位 | 說明 |
|---|---|
| `history` | `{n, t[], o[], h[], l[], c[], v[]}`：**全部** K（含尾巴的盤中未定那根），每個欄位一個陣列（省空間）；`t` 同 `bars[].t` 格式；開高低收已除息還原、取 6 位小數；`v` 整數或 `null`（缺量） |
| `bars_completed` | 前幾根是定案 K。回測只用 `history` 的前 `bars_completed` 根；未定那根只用來畫出場線 |

圖的視窗起點 `k0 = max(0, bars_completed − 120)`（＝`chart.bars[0]` 在 `history` 的位置）。

大小（2026-11-09 實測，引擎回應整份，未壓縮／gzip）：1H 730 天 台股約 3,635 根 ≈ 273–292 KB（67–72 KB）、美股約 5,083 根 ≈ 385–387 KB（136 KB），其中 `history` 239–351 KB；日K 10 年約 2,430–2,510 根 ≈ 191–212 KB（60–75 KB）。

**瀏覽器回測**（`lib/ta-trade.js`，純函式；與 `Skill\ta_trade.py` 參數化版逐筆一致：`python "G:\Yoda x Claude\Skill\tests\ta_trade_parity.py"`）：

```js
import { normParams, backtest, chartMarks, exitLine, ruleText } from "../lib/ta-trade";
const { p, errors } = normParams(raw);                 // 面板值（可是字串）→ 參數；壞欄位用預設並寫原因
const r = backtest(d.history, d.bars_completed, p);    // {trades, open, stats, banner}
const { markers, lines } = chartMarks(r, k0);          // §4.1／§4.2
const line = exitLine(d.history, p, k0);               // 出場均線（跟 chart.bars 對齊）
```

| 參數（預設＝站方現行規則） | 說明 |
|---|---|
| `ma` `"ema"`、`ma_n` `[5,10,20]` | 均線種類（EMA＝pandas `ewm(span, adjust=False)` 逐位重現；SMA＝逐根累加減）與三條週期（由短到長） |
| `fresh_n` 3 | 排列剛成立：本根排好、前 N 根不是全部排好 |
| `vol_on` true、`vol_in` 1.2、`vol_n` 10 | 進場量比門檻（可關）；量比＝本根量 ÷ 前 N 根平均（pandas `shift(1).rolling(N, min_periods=min(5,N)).mean()` 逐位重現） |
| `side_ma` true | 收在第一條均線同側 |
| `stop` `"low_n"`｜`"pct"`｜`"atr"`；`stop_n` 3、`stop_pct` 5、`atr_n` 14、`atr_k` 2 | 停損：近 N 根極值／進場價 ±X%／進場價 ± K×ATR（Wilder）；抱著期間不動 |
| `stop_on` `"touch"`｜`"close"` | 盤中碰到（成交＝開盤與停損較差者）／收盤破（成交＝收盤） |
| `exit_ma` true、`exit_k` 2、`exit_delay` 0 | 收破第 k 條均線整筆出；進場後先放 N 根不看 |
| `vol_exit` true、`vol_out` 2 | 爆量反向K（量比 ≥門檻、反向 K、收破第一條線） |
| `max_hold_on` false、`max_hold` 20 | 最多持有 N 根，到期收盤出 |
| `dir` `"both"`｜`"long"`｜`"short"` | 方向 |
| `fee` 0、`slip` 0 | 每邊 %；每筆報酬扣 2×(fee+slip) 個百分點 |

輸出：`trades[]` `{side, entry_t, entry_i, entry, stop, vr, exit_t, exit_i, exit_px, why, label, pts, pct}`（`why`：停損／爆量反向K／收破N線／持有到期；`label`：停損／爆量反K／破N線／到期）；
`open` `{side, entry_t, entry_i, entry, stop}` 或 null；`stats` `{n, wins, win_rate, sum_pts, sum_pct, avg_win_pct, avg_loss_pct, max_consec_loss, mdd_pct, payoff, start, end, bars, n_long, n_short}`（`mdd_pct`＝各筆 pct 累加曲線從高點的最大回落；`payoff`＝平均賺 ÷ |平均賠|；% 沒有四捨五入）；
`banner` `{bad, min_n:8, win_pct:25, text}`：`n ≥ 8` 且（勝率 <25% 或合計 <0，兩者先取 2 位小數）→ `bad=true`。

**沒有成交量**（`history.v` 前 `bars_completed` 根沒有任何 >0 的量，例 `^SOX`）：`backtest` 內部把 `vol_on`、`vol_exit` 當 `false`（`effParams(p, hasVolume(v, nf))`；`ta_trade.py` 同一條，
`tests/ta_trade_parity.py` 有「量全 null」的 fixture 比對），面板上存的參數不改；頁面規則面板在這兩格旁寫「此標的沒有成交量：量的條件不套用」並停用，
量柱區與 ③ 前五大量寫「此標的沒有成交量」。

整筆進、整筆出，停損固定不動；分批出場、移動停損、加倉、固定倍數停利都已永久刪除，面板也不提供（`tests/ta_engine_check.py` 守門掃 `lib/ta-trade.js`、`app/ta/page.jsx`、引擎原始碼與回應）。
面板設定與命名策略只存在使用者自己的瀏覽器（localStorage `yoda_ta_rules_v1`）；改參數不打伺服器、不扣額度。

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
| `ta-engine/ta_engine.py`、`analyze_symbol.py` | Skill 副本（vendor.json 鎖 sha256）；`ta_trade.py` 11-09 起不再同步（引擎不用） |
| `ta-engine/requirements.txt` | `numpy==2.3.2`、`pandas==2.3.1`（同本機） |
| `ta-engine/.python-version` | `3.13` |
| `ta-engine/vercel.json` | `maxDuration 60`、排除 dev_server／vendor.json |
| `ta-engine/dev_server.py` | 本機伺服器 |
