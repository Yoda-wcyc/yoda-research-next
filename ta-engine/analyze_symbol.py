# -*- coding: utf-8 -*-
r"""單一標的技術分析計算引擎（Yoda 2026-09-27 · 會員技術分析＋私人筆記共用）

這支只算數字、不寫文章。2026-09-27 Yoda 定案：**技術分析內容只留三個訊號**——
① 前五大量（top_volume；09-27 由前三改前五）② 跳空缺口（gaps）③ 多空排列（ma_align），全部是可逐日手算檢查的規則，
不給停損／停利／目標價、不給信心分。同日追加：缺口依「趨勢＋位置」分類（突破／逃逸／竭盡／反彈／島狀）＋前五大量解讀（⑤）。
舊的趨勢／結構／ADX／停損目標等區塊函式還在檔內，
analyze(..., legacy=True) 才輸出（給舊呼叫者退路），預設不輸出。
本檔的輸出**不准**流進任何對外報告正文、reports.json、dyn-ledgers、continuity 帳本。

用法
    python analyze_symbol.py 2330 NVDA               # 印完整 JSON（list，一檔一個 dict）
    python analyze_symbol.py 2330 NVDA --summary     # 印一行三訊號摘要（量／缺／排）
    python analyze_symbol.py 2330 --compact          # JSON 但拿掉 chart（120 根 K 線）
    python analyze_symbol.py 2330 --asof 2026-09-18  # 回放到某一天（只用 ≤ 該日的 K）
    python analyze_symbol.py 2330 --offline          # 只用 pkl，不上網補
    python analyze_symbol.py 2330 --legacy           # 連舊區塊（趨勢／結構／停損…）一起輸出
    python analyze_symbol.py 2330 --refresh          # 先跑 tw_daily.ensure / us_daily.ensure（⚠會寫 pkl＋市場寬度帳本）
    python analyze_symbol.py --selftest              # 合成資料單元測試
    程式內：from analyze_symbol import analyze; d = analyze('2330')；舊格式 analyze('2330', legacy=True)

───────────────────────── 資料來源與口徑 ─────────────────────────
代號判市場：^\d{4,6}[A-Z]?$（含 0050、00878、00631L）＝台股；其餘（字母）＝美股；BRK.B 自動轉 BRK-B。

台股  reports\twdaily.pkl（tw_daily.py；上市／上櫃官方日線，開高低收＋成交股數）
      · 還原：日期 d 的價 × 之後每一次除權息因子的連乘（同 tw_breadth.load_panel_full 的口徑），開高低收同比例。
      · 分割／減資：pkl 不含（例：0050 2025-06-18 一拆四，188.65→47.5）。本檔自動偵測「開盤／前收」落在
        [0.75, 1.30] 以外的跳空（台股漲跌幅 10%，正常不會出現；序列前 5 根新上市蜜月期不判），
        以該比值當因子往前還原價（接近 1/n 或 n 就取整數比），量同步 ÷ 因子；偵測結果寫進 meta.notes。
      · 補最新：pkl 最後一天之後的平日（今天要 15:00 後）用 tw_daily.fetch_twse／fetch_tpex **只在記憶體**補，
        除權息用 tw_rel.fetch_exdiv 補那幾天；**不寫回 pkl**（pkl 只有 tw_daily 一個寫入者）。
      · 基準：加權指數收盤（pkl['index']，補的日子取 MI_INDEX 當天收盤）。上櫃股也對加權（不是櫃買指數）。
美股  reports\usdaily.pkl（us_daily.py；Yahoo auto_adjust）
      · pkl 有該檔且資料日 ≥ us_daily._settled_day()（最後定稿交易日）→ 直接用 pkl。
      · 否則（pkl 過期、或 pkl 不收的 ETF 如 SPY／QQQ）→ yfinance 單檔抓 2y（auto_adjust=True），
        裁掉定稿日之後與 Close 為 NaN 的 K（Yahoo 未定案空殼）；不寫任何檔。抓不到才退回 pkl 舊資料並標 stale。
      · 基準：SPY（同上抓法）；抓不到退 pkl['index']['SP500']（^GSPC）並註明。
      · 批次（2026-09-27，ta_publish 一次算上千檔）：先呼叫 prefetch_us(代號們) 分批 yf.download 放進記憶體快取，
        之後 _yf_one 先查快取、不逐檔打 Yahoo；沒呼叫 prefetch_us 時行為跟原本一樣（ta_local 不受影響）。

缺值一律 None（JSON null），不補 0；根數不足的指標標 None 或 status='insufficient'。

───────────────────────── 預設輸出（三訊號，schema＝sig3-2）─────────────────────────
（2026-09-27：sig3-1 → sig3-2 只「加」欄位不改舊欄位——⑤ 缺口分類＋大量K解讀；舊讀者照讀不受影響）
頂層只有 meta／price／signals／chart 四塊。
meta        symbol／market('tw'|'us')／name／exchange（上市|上櫃|NASDAQ…）／asof（最後一根 K，YYYY-MM-DD）／
            bars（可用根數）／source（資料來源說明）／bench（基準名）／stale（bool，資料落後預期最新交易日）／
            notes（list[str]，還原、補資料、退路等說明）
price       close；chg_1d_pct＝(C/C[-1]−1)×100（原始精度收盤算）
signals     {schema:'sig3-2', window_bars（視窗實際根數，≤120）, top_volume, gaps, ma_align, sr_levels,
             badges:{vol, gap, ma, sr, gap_type}（badge 文字，同各訊號 badge.text；gap_type 見 ⑤）}

  通用口徑
    · 視窗＝最近 120 根日 K（不足 120 根就用全部，window_bars 記實際根數）。
    · 價格比較一律用「顯示精度」：≥1 取 2 位小數、<1 取 4 位（同輸出的數字），避免還原價的浮點雜訊
      造成 0.00 的假缺口或假站上；所以拿輸出的數字手算一定對得上。
    · 量：台股＝成交股數、美股＝shares；0 量視為缺值（不參與排名、均量）。
    · 前 20 日均量 avg20_prev(i)＝第 i 根「之前」20 根（i−20…i−1，不含當天）的均量，缺值不計；
      i 前面不足 20 根 → None。vol_ratio＝當日量 ÷ avg20_prev，四捨五入（half-up）到 1 位。
    · 距離% 一律＝(關卡價 ÷ 今收 − 1)×100：正＝關卡在現價上方、負＝在下方（同舊 levels.dist_pct 口徑）。

  ① top_volume {unit, items:[…5], badge}
    · 視窗內成交量最大的 5 根（TOP_VOL_N；2026-09-27 由 3 根改 5 根）；同量取較近日期。
    · 每根：rank／date／days_ago（今天＝0）／volume／avg20_prev／vol_ratio／open／high／low／close／
      chg_pct＝(當日收 ÷ 前一日收 − 1)×100／
      candle：實體÷全距（|收−開| ÷ (高−低)，body_ratio）≥0.6 → 長紅（收>開）／長黑（收<開）；≤0.1 → 十字；
              其餘 → 紅K（收>開）／黑K（收<開）；全距 0（一字線）歸十字、body_ratio=None／
      close_pos：(收−低) ÷ (高−低)（close_pos_ratio）≥2/3 高檔、≤1/3 低檔、其餘中間；全距 0 → 中間、ratio=None／
      關卡＝該根最高價與最低價：relation＝今收 > 最高「在上方」、今收 < 最低「在下方」、其餘「區間內」；
      dist_high_pct＝(最高 ÷ 今收 − 1)×100、dist_low_pct＝(最低 ÷ 今收 − 1)×100。
    · badge＝以量最大那根（rank 1）為準：{relation, date, days_ago, text}，
      text：「在最大量K上方」／「在最大量K區間內」／「在最大量K下方」；視窗內沒有量 → relation=None、text「無量資料」。

  ② gaps {n, n_open, n_filled, items:[…], badge}
    · 視窗內「全部」跳空（不設門檻），第 i 根對第 i−1 根比（i−1 可以落在視窗前一根）：
      向上 up：今低 > 昨高 → 缺口 [bottom＝昨高, top＝今低]；向下 down：今高 < 昨低 → 缺口 [bottom＝今高, top＝昨低]。
    · size_pct＝(top − bottom) ÷ 昨收 ×100；vol_ratio＝當日量 ÷ avg20_prev（同上口徑）；days_ago。
    · 回補只看缺口日「之後」的 K（不含缺口當天），逐根往後走：
      向上缺口：某根最低 ≤ bottom → full（完全穿越另一緣）；否則某根最低 < 尚未補區的上緣 → partial（進入缺口），
               尚未補區上緣下修到那根最低。向下缺口對稱：某根最高 ≥ top → full；最高 > 尚未補區下緣 → partial。
      fill：none／partial／full；fill_date：full＝完全回補那天、partial＝第一次進入缺口那天、none＝None；
      open_top／open_bottom＝尚未回補的剩餘區間（none＝原缺口、full＝None）。
    · dist_pct（只算未補／部分回補）：向上缺口＝(open_top ÷ 今收 − 1)×100（必 ≤0，缺口在下方＝支撐側）；
      向下缺口＝(open_bottom ÷ 今收 − 1)×100（必 ≥0，缺口在上方＝壓力側）；full＝None。
      （之後的 K 一定都在缺口「回補方向」的另一側，所以未補的向上缺口必在現價下方、向下缺口必在上方。）
    · 排序：未補（none＋partial）在前，依 |dist_pct| 由近到遠（同距離較新的在前）；已補（full）在後，依日期新到舊。
    · badge：{above＝上方最近的未補缺口（向下缺口）, below＝下方最近的未補缺口（向上缺口）, text}；
      above／below 各含 date／dir／fill／open_bottom／open_top／dist_pct，沒有＝None；
      text：「上 +3.2%｜下 -1.5%」（沒有的一側寫「無」）；兩側都沒有＝「無未補」。

  ③ ma_align {short, mid, badge}
    · short 組＝SMA5／10／20，mid 組＝SMA20／60／120（簡單平均，收盤原始精度）。
    · 某天 t 的狀態（第一條／第二條／第三條＝該組由短到長）：
      多頭排列＝收盤 > 第一條 > 第二條 > 第三條，且三條均線今天都比昨天高（斜率 > 0）；
      空頭排列＝收盤 < 第一條 < 第二條 < 第三條，且三條都比昨天低（斜率 < 0）；其他＝糾結。
      斜率＝SMA_t − SMA_{t−1}＝(C_t − C_{t−n}) ÷ n（直接用這條算，避免累加誤差）；
      比大小前先把收盤、均線、斜率四捨五入到 6 位小數（去浮點雜訊，不是門檻）。
    · 每組輸出：state（多頭排列／空頭排列／糾結／insufficient）／
      why（糾結時寫哪個條件不成立，成立時為 ''）／fails（同 why 的結構化清單）／
      days（目前狀態連續幾天，含今天）／days_capped（True＝一路數到可算的第一天，實際 ≥ days）／since（這段狀態的第一天）／
      nearest_break（成立時：收盤–第一條、第一條–第二條、第二條–第三條三組相鄰兩者中，差距% 最小的一組；
                     gap_pct＝|a ÷ b − 1|×100；糾結＝None）／close／lines（各均線 name／n／value／slope＝今−昨）。
    · why 的寫法：先判「比較接近哪一邊」——多方條件（3 組順序 ＋ 3 條斜率）成立數 vs 空方成立數，
      先比順序成立數、再比斜率成立數，完全打平看收盤 ≥ 第三條 → 多方、否則空方；然後列出該方不成立的條件：
      順序全對只差斜率 →「多頭順序成立但 MA20 走平／下彎」（空方：「空頭順序成立但 MA5 走平／上揚」）；
      順序有錯 →「多頭順序不成立：MA5 < MA10」（多個用「、」接；斜率也有錯再接「；且 MA20 走平／下彎」）。
    · 資料不足：mid 組需 ≥121 根（今、昨兩天的 SMA120）→ 不足回 state='insufficient'、why 寫根數。
    · badge：{short:'短多'|'短空'|'短糾'|'短—', mid:'中多'|'中空'|'中糾'|'中—', text:'短多・中糾'}（—＝資料不足）。

  ④ sr_levels（日線支撐／壓力；2026-09-27 Yoda 追加）{tol, atr14, support:[≤1], resistance:[≤1], n_candidates, n_lines, badge}
    · 容差 tol＝max(0.5×ATR14, 0.5%×今收)（ATR14＝Wilder，原始精度；根數不足 ATR 算不出 → 只用 0.5%×今收）。
    · 觸及計數 T(P)（對任一價位 P，只看視窗內的 K，同一根 K 符合多條只算一次＝「幾天」）：
        a. N=2 分形高點（最高 > 前 2 根最高 且 ≥ 後 2 根最高）其最高 ∈ [P−tol, P+tol]；
        b. N=2 分形低點（最低 < 前 2 根最低 且 ≤ 後 2 根最低）其最低 ∈ [P−tol, P+tol]；
        c. 影線觸及後收回（壓力）：最高 ∈ [P−tol, P+tol] 且收盤 < P − 0.25×tol；
        d. 影線觸及後收回（支撐）：最低 ∈ [P−tol, P+tol] 且收盤 > P + 0.25×tol。
      （最後 2 根的分形還不能確認，不算 a／b；c／d 含今天。）
    · 候選價位：
        ① 前五大量 K 各自的最高與最低（10 個；權重 w＝min(vol_ratio, 5)，vol_ratio 缺 → 1）；
        ② 未補與部分回補缺口的剩餘區間上下緣（open_top／open_bottom；權重 2）；
        ③ 觸及反彈：視窗內所有分形高點與低點的價位（高低混在一起）由低到高排序，貪婪聚類——
           與「該群最低價」差 ≤ tol 就併入同群（群寬 ≤ tol），群價位 L＝群內價位的中位數；T(L) ≥ 3 才成為候選。
    · 合併（以中心吸收）：候選依優先序排——觸及候選在前（T(L) 大到小）、大量K／缺口在後（權重大到小），
      同分取離今收近的；依序拿還沒歸組的候選當「中心」，把其餘還沒歸組、與中心差 ≤ tol 的候選併成同一條。
      線價 P＝中心價（有觸及候選的線一定以觸及價為準）；因為沒被併進去的候選離中心 > tol，各線彼此差必 > tol
      （2026-09-27 實測：原「由低往高貪婪分組」會留下相距不到 tol 的兩條線，例 NVDA 217.15／216.34、tol 2.93，改成這樣）。
      touches＝T(P)；touch_dates＝T(P) 那幾天；last_touch_date＝最後一天（沒有＝None）。
      strength＝Σ(組內每一根不同的大量 K 的 min(vol_ratio,5)) ＋ 2×(組內不同缺口數) ＋ touches，四捨五入 1 位。
      sources：「大量K 9/12 高」「缺口 9/5 上緣」「觸及 4 次」（組內全部列出，大量K→缺口→觸及順序）。
    · 分類：P < 今收＝support、P > 今收＝resistance；|P − 今收| ≤ 0.25×tol 標 testing=True（正在測試），
      此時依「最近一次收盤方向」歸類：今收 > 昨收（漲上來碰到）＝resistance、今收 < 昨收（跌下來碰到）＝support、
      平盤再看 今收 ≥ P＝support。
    · 輸出（2026-09-27 Yoda：支撐、壓力各只留一條；同日再定「先在現價 ±10% 內挑最強，無則取範圍外」）：
      support／resistance 各只留一條（list 長度 ≤1；該側沒有線＝[]），每側分開挑：
        ① 先看該側 |dist_pct| ≤ 10 的線（±10% 內，含邊界；dist_pct 用輸出值、2 位小數）——有 → 挑其中強度最高的，
           pick_scope＝'within10'；
        ② 該側 ±10% 內一條線都沒有 → 才往外挑該側全範圍強度最高的，pick_scope＝'beyond'。
      強度比的是輸出的 strength（1 位小數），相同取 |P − 今收| 近的。其餘線不輸出
      （n_candidates＝合併前候選數、n_lines＝合併後兩側總線數，只留作參考）。
      每條：price／kind（support|resistance）／sources（list）／touches／touch_dates／last_touch_date／strength／
      dist_pct＝(P ÷ 今收 − 1)×100／testing（bool）／pick_scope（'within10'|'beyond'）／
      strongest（恆 True，保留給舊讀者相容；意思是「被選中的那條」，不一定是該側全範圍最強）。
    · badge：{res＝那條壓力 {price, dist_pct}|None, sup＝那條支撐 {…}|None, text：「壓 +2.1%｜撐 -3.4%」（沒有寫「無」）}。
      （所以 badge 的距離是「選中那條」的距離：±10% 內最強，不一定是最近的關卡；pick_scope＝'beyond' 時會超過 ±10%。）

  ⑤ 缺口分類＋大量K解讀（2026-09-27 Yoda 核准「先看趨勢、再看位置」；常數在程式 ⑤ 區塊開頭）
    參數：TREND_N=60、POS_N=60、UP_DAYS_HIGH=5、ATR_HIGH=6、ATR_DEEP=5、VOL_BURST=2.0、VOL_WITH=1.5、SEQ_EXHAUST=3、
          SEQ_LOOK=250、ESCAPE_ROOM=10%、CHASE_PCT=3%、PIT_N=120、PIT_TOP_N=5、ISLAND_MAX=10。
    · 基準根：缺口（日期 d，第 i 根）一律用 d 的「前一根」r＝i−1 判 trend／position；大量 K 用「當根」r＝i。
      價格比較用顯示精度（同通用口徑）；SMA60 與斜率用原始收盤、比大小前四捨五入 6 位（同 ma_align）；ATR14＝Wilder、原始精度。
    · trend：斜率＝SMA60_r − SMA60_{r−1}＝(C_r − C_{r−60})÷60；斜率 >0 且 C_r > SMA60_r＝'多頭'、
      斜率 <0 且 C_r < SMA60_r＝'空頭'、其他＝'盤整'；r < 60（SMA60 今昨不足）＝None。
    · position（向上缺口；向下缺口全部鏡像）：代碼 HIGH／LOW／MID（方向相對），中文 position_zh：
        向上＝'高檔'／'低檔起漲'／'中段'；向下＝'低檔'／'高檔起跌'／'中段'。依序判：
        HIGH：到 r 為止已連漲 ≥5 天（收盤連續高於前一日；向下＝連跌），或 (C_r − 60 日最低價) ≥ 6×ATR14_r
              （向下＝(60 日最高價 − C_r) ≥ 6×ATR14_r）；60 日＝r−59…r 的最低「最低價」／最高「最高價」。
        LOW ：(60 日最高價 − C_r) ≥ 5×ATR14_r（向下＝(C_r − 60 日最低價) ≥ 5×ATR）且「跌深後第一個向上缺口」＝
              60 日最低價那天（同價取較近）之後、這個缺口之前沒有別的向上缺口（向下＝60 日最高那天之後沒有別的向下缺口）。
              大量 K 不是缺口，LOW 只看跌深那一條。
        MID ：其他。60 日或 ATR 不足 → 只剩連漲條件可判：連漲 ≥5 → HIGH，否則 None。
    · seq：缺口 i 之前最近一個「已確認」的 N=2 分形低點 f（f+2 ≤ i，只用當天以前的 K；向下缺口用分形高點），
      數 (f, i] 之間同向缺口個數（含自己，1 起算）；seq_from＝f 的日期。SEQ_LOOK 根內找不到分形 → 從 i−250 起數、seq_from=None。
      缺口與分形往回看到視窗前 CTX_N=260 根（不只視窗內）。
    · vol_class：量倍數（同 gaps.vol_ratio）≥2.0＝'爆量'、≥1.5＝'帶量'、其他（含 None）＝'一般'。
    · 「當時可得」的壓力（逃逸、追高、大量K 用；不看第 i 根之後任何 K）：
        ① 第 i 根「之前」120 根（i−120…i−1，不含當天——自己的高點不算自己的壓力）量最大 5 根的最高價；
        ② 缺口日也在 i−120…i−1、截至第 i 根還沒完全回補的向下缺口，其剩餘區間下緣。
      支撐（向下缺口鏡像用）：① 換最低價、② 換向上缺口剩餘區間上緣。最近上方壓力＝P > 當天收盤裡最低的，
      距離＝(P ÷ 當天收盤 − 1)×100；記在 basis.level／level_src／level_pct。
    · type（依序判，先中先得；括號內為 type_short）：
        1. 突破：position=LOW 且 seq=1 且 vol_class∈{帶量,爆量} → '突破缺口'（突）／'跌破缺口'（破）
           （2026-09-27 Yoda 教學改為最優先、不看趨勢：跌深往上的第一個帶量缺口才會讓原本很弱的型態轉強；
            所以空頭裡的向上缺口，只有跌深後第一個且帶量的才算突破，其餘都是反彈。向下鏡像：多頭裡只有漲多後第一個帶量的向下缺口算跌破）
        2. 反彈：向上缺口且 trend='空頭' → '反彈缺口'（彈）；向下缺口且 trend='多頭' → '回檔缺口'（回）
        3. 竭盡：seq ≥3 且 position=HIGH 且 vol_class='爆量' → '竭盡缺口'／'下跌竭盡缺口'（竭）
        4. 逃逸：trend='多頭'（向下＝'空頭'）且 position=MID 且缺口當天收盤上方 10% 內沒有「當時可得」的壓力
           （向下＝下方 10% 內沒有支撐；距離 |%| ≤ 10 就算有）→ '逃逸缺口'／'下跌逃逸缺口'（逃）
        5. 其他 → '一般缺口'（一）
      type_short 全部值：突／破／逃／竭／彈／回／島／一（竭、逃不分方向，看 dir）。
    · notes（list，可多個）：
        '竭盡確認：這波可能走完'：type＝竭盡（兩方向）且 fill ≠ none（之後已部分或完全回補）。
        '追高警示：高檔且距上方壓力 +2.1%'：position=HIGH 且缺口當天收盤距當時最近上方壓力 ≤3%
          （向下鏡像：'追空警示：低檔且距下方支撐 -2.1%'）。
        '缺口守住，洗盤後可能發動'：type＝突破 且 fill=none 且缺口日之後至少一根、每根收盤都 > 缺口上緣 top
          （向下鏡像：跌破 且 之後每根收盤都 < 下緣 bottom → '缺口壓住，反彈後可能續跌'）。
    · islands（gaps.islands[]）：視窗內缺口依日期排，對每個缺口 A 取它之後「第一個」反向缺口 B，b−a ≤ 10 根、
      兩個都還沒被別的島用掉，且島內 K（a…b−1）整段懸空＝
        頂部（A 向上、B 向下）：島內每根最低價 > max(A.bottom, B.bottom)（A 前一根最高、B 當天最高＝兩缺口的外緣）；
        底部（A 向下、B 向上）：島內每根最高價 < min(A.top, B.top)。
      （規格原文寫「高於 A、B 區間上緣」，但向上缺口 A 的上緣＝A 當天最低、向下缺口 B 的上緣＝B 前一天最低，本來就是島內 K 的
        最低價，「嚴格高於」永遠不成立；所以實作取兩缺口的外緣＝島與兩側 K 棒價格區間完全不重疊，即懸空。）
      每筆：{kind:'top'|'bottom', name:'頂部島狀反轉'|'底部島狀反轉', start（A 那根）, end（B 前一根）, a_gap, b_gap（日期）,
            bars（島內根數＝b−a）, high, low（島內最高／最低）, edge（比較用的外緣價）}。
      被判為島的兩個缺口：island=True、island_kind、type_short 改成 '島'（type 保留原分類）。
    · 每個 gaps.items 另加：trend／position／position_zh／seq／seq_from／vol_class／type／type_short／notes／island／island_kind／
      basis{ref_date, ref_close, sma60, sma60_slope, run_days（連漲；向下缺口＝連跌）, atr14, low60, low60_date, high60,
            high60_date, rise_atr＝(C−60日低)÷ATR, drop_atr＝(60日高−C)÷ATR, first_since（跌深後第一個）, level, level_src, level_pct}。
    · gaps.badge.last＝日期最近的那個缺口 {date, dir, type, type_short, island, confirmed（有竭盡確認）,
      text＝type_short＋（竭盡確認且不是島 → '✓'）}，例 '突'、'竭✓'、'島'；沒有缺口＝None。signals.badges.gap_type＝text（沒有＝'—'）。
    · 大量 K（top_volume.items 每根，以當根為基準）另加：trend、position／position_zh（一律用向上定義）、basis（同上，
      level 為當根收盤「當時可得」的最近上方壓力）、read（依序判，紅K＝candle 長紅／紅K、黑K＝長黑／黑K，十字兩邊都不算）：
        紅K 且 LOW → '跌深後大量紅K·可能轉強'；紅K 且 trend='空頭' → '空頭反彈'；
        紅K 且 HIGH 且距上方壓力 ≤3% → '高檔近壓力·追高風險'；黑K 且 HIGH → '高檔大量黑K·出貨疑慮'；
        黑K 且「高檔起跌」→ '高位大量黑K·可能轉弱'；黑K 且 trend='多頭' 且 MID → '多頭中的大量黑K·先看支撐'；其他 → '中性'。
        （2026-09-27 與缺口分類同一原則「跌深後第一個帶量才是轉強」：跌深的大量紅K 先判可能轉強、再判空頭反彈；
          黑K 鏡像——「高檔起跌」＝當根另用向下定義判位置得 LOW：(C − 60 日最低價) ≥ 5×ATR14，且不是向下的 HIGH
          （沒連跌 ≥5 天、(60 日最高價 − C) < 6×ATR14），不套「第一個缺口」；先判可能轉弱、再判多頭中的先看支撐。
          出貨疑慮仍排在可能轉弱前面：向上定義已是 HIGH（連漲 ≥5 或離 60 日低 ≥6 ATR）的黑K 照舊判出貨疑慮，
          所以「可能轉弱」實際落在離 60 日低 5～6 ATR、未連漲 5 天那段。position／position_zh 欄仍是向上定義，不另存向下的位置。）

chart       最近 120 根：bars=[{date,o,h,l,c,v}]（顯示精度）、sma5／sma10／sma20／sma60／sma120＝[…]
            （與 bars 對齊，缺值 None）

───────────────────────── legacy=True 才輸出的舊區塊（2026-09-27 前的版本，保留給舊呼叫者）─────────────────────────
price（舊） 另含 high_52w／low_52w＝最近 252 根（不足就用全部並記 window_bars）
            的最高 High／最低 Low；dist_high_52w_pct＝(C/high−1)×100（≤0）；dist_low_52w_pct＝(C/low−1)×100（≥0）
ma          sma{5,20,60,120,240}：簡單平均（根數 < n → None）；ema{20,50,200}：第 n 根以 SMA(n) 起算，
            之後 α＝2/(n+1)（StockCharts 口徑）；slope_5d_pct{名}＝(MA/MA[−5]−1)×100；
            above{名}＝C > MA；alignment：SMA5>20>60>120>240 全成立＝「多頭排列」、全反＝「空頭排列」、
            其餘「糾結」（五條沒到齊就用現有的，至少三條，否則 None）
trend_state DecisionPoint 趨勢模型（EMA 版）：
            long ＝ LTTM：EMA50 > EMA200 → BUY，否則 SELL
            inter＝ ITTM：EMA20 > EMA50 且 EMA50 > EMA200 → BUY；EMA20 > EMA50 但 EMA50 < EMA200 → NEUTRAL（空頭市場不給 BUY）；
                   EMA20 < EMA50 且 EMA50 > EMA200 → NEUTRAL（多頭市場不給 SELL）；兩者都 < → SELL
            short＝（本檔補的短線層，DP 原版用 PMO）：C > EMA20 且 EMA20 五日斜率 > 0 → BUY；
                   C < EMA20 且斜率 < 0 → SELL；其餘 NEUTRAL
            另附 silver_cross／golden_cross：最近一次 EMA20×EMA50、EMA50×EMA200 交叉的日期與方向
structure   分形 N=2：第 i 根 High > 前兩根 High 且 ≥ 後兩根 High ＝ swing high（Low 對稱）；最後兩根還不能確認。
            swings：最近 6 個（高低混排，含 date／price／kind／label）；label：高點對前一個高點 HH／LH／EQH，
            低點對前一個低點 HL／LL／EQL。
            events（BOS／CHoCH）：逐根往前走、**不偷看**——swing 在 i+2 根才算確認；收盤 > 最近一個確認且未被破的
            swing high ＝ 向上突破，收盤 < 最近未破 swing low ＝ 向下跌破；突破方向跟前一次相同（或第一次）＝BOS，
            相反＝CHoCH。last_event＝最後一次。
            state：最後一次突破在 60 根內 → 依其方向（多頭／空頭）；否則看最後一個高、低點標籤：
            HH＋HL＝多頭、LH＋LL＝空頭；其餘＝區間。state_basis 說明是哪一條判的。
adx         Wilder ADX14、+DI、−DI（RMA 平滑，第 14 根以平均起算）；quality：ADX>25 趨勢、<20 無趨勢、其間灰色；
            bars < 150 → status='insufficient'、數值 None（Wilder 平滑要夠長才收斂）
vol         ATR14（Wilder）、atr_pct＝ATR/C×100；Bollinger(20,2)：中軌 SMA20、標準差 ddof=0；
            bandwidth＝(上−下)/中×100；pct_b＝(C−下)/(上−下)；squeeze＝今天 BandWidth ≤ 最近 125 根最小值
            （不足 125 根有效值 → None）
volume      v＝今量；ratio_1d＝今量 / 前 20 根均量（不含今天）；ratio_5d＝近 5 根均量 / 再往前 20 根均量（不重疊）；
            pv_1d：價（C 對前收）× 量（ratio_1d 對 1）→「價漲量增／價漲量縮／價跌量增／價跌量縮／平盤」，
            same_dir_1d＝價漲量增或價跌量縮（量價同向）；pv_5d／same_dir_5d：五日漲跌 × ratio_5d 同理
rel         rel{5,20,60}＝標的 w 根報酬 − 基準 w 根報酬（百分點）；兩邊取共同交易日後各自往回數 w 根
levels      候選：swing high/low（最近 250 根內已確認者）、SMA60、SMA240、整數關卡（級距＝不超過收盤 5% 的最大
            1／2／5×10^k）、未補缺口（最近 250 根；向上缺口 L[i]>H[i−1] 且之後最低 > H[i−1] → 兩緣 H[i−1] 與之後最低；
            向下對稱）、52w 高低。距離 0.5% 內合併來源。above／below 各取最近 3 個：price、sources、dist_pct
risk        long（多方停損）：① swing＝最近一個低於收盤的 swing low − 0.5×ATR14；② chandelier＝最近 22 根最高 −
            3×ATR22；③ atr2＝C − 2×ATR14；short（空方）對稱：swing high + 0.5ATR、22 根最低 + 3×ATR22、C + 2ATR。
            side：structure.state＝空頭 → 'short'，其餘 'long'。default＝該方向 ①② 中離收盤較近者（兩者都無效才用 ③）。
            每個停損附 dist_pct＝(停損/C−1)×100
targets     R＝|C − 預設停損|；r1／r2／r3＝C ± 1R／2R／3R；next_swing＝方向上最近一個 swing（多方：高於收盤的
            swing high，沒有就用 52w 高；空方對稱）；measured＝最後一次同方向 BOS／CHoCH（60 根內）的量測：
            被突破價位 ± (被突破價位 − 突破前回檔極值)；每個目標附 rr＝(目標−C)/R（空方取正）
invalidation 一句話日檢條件（多頭：收盤跌破最後一個 HL；空頭：收盤站上最後一個 LH；區間：跌破預設停損）
confidence  0～100 規則分（見 SCORE_TABLE）；breakdown 逐項 hit／pts／why；notes：「分數不是勝率」
chart       最近 120 根：bars=[{date,o,h,l,c,v}]、sma20=[…]、sma60=[…]（與 bars 對齊，缺值 None）
"""
import os, re, io, sys, json, math, time, pickle, datetime as dt, contextlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

try:
    from yoda_paths import REPORTS
except Exception:
    REPORTS = os.path.join(os.path.dirname(HERE), 'reports')

import numpy as np
import pandas as pd

TW_PAT = re.compile(r'^\d{4,6}[A-Z]?$')
SPLIT_LO, SPLIT_HI = 0.75, 1.30
TW_CUTOFF_HOUR = 15          # 台股當天日線 15:00 後才抓
LIVE_MAX_DAYS = 10           # 記憶體補資料最多補幾個平日；更舊請 --refresh
BREAK_FRESH = 60             # 最後一次 BOS/CHoCH 在幾根內才拿來定 state／量測目標
CHART_N = 120

# 信心分計分表（寫死；總分 100）。side＝risk.side 的方向（long 看多方條件，short 看空方條件）
SCORE_TABLE = [
    ('trend_long',  15, 'DecisionPoint 長線（EMA50 vs EMA200）與 side 同向'),
    ('trend_inter', 15, 'DecisionPoint 中線（EMA20 vs EMA50）與 side 同向（NEUTRAL 0 分）'),
    ('trend_short', 10, '短線（C vs EMA20＋斜率）與 side 同向'),
    ('structure',   15, '結構 state 與 side 一致（區間 0 分）'),
    ('adx',         15, 'ADX>25 且 DI 方向與 side 同向＝15；ADX 20～25 且同向＝7；其餘或資料不足＝0'),
    ('volume',      10, '五日量價同向且方向與 side 一致（多：價漲量增或價跌量縮；空：價跌量增或價漲量縮）'),
    ('rel20',       10, 'REL20 與 side 同號（多：>0；空：<0）'),
    ('ma_align',    10, '均線排列與 side 一致（多頭排列／空頭排列）'),
]

_CACHE = {}


# ═════════════════════════ 小工具 ═════════════════════════

def _f(x, nd=4):
    """numpy/None/NaN → JSON 安全的 float 或 None。"""
    if x is None:
        return None
    try:
        x = float(x)
    except Exception:
        return None
    if math.isnan(x) or math.isinf(x):
        return None
    return round(x, nd)


def _p(x):
    """價格：≥1 取 2 位、<1 取 4 位。"""
    if x is None:
        return None
    x = _f(x, 6)
    if x is None:
        return None
    return round(x, 2) if abs(x) >= 1 else round(x, 4)


def _pct(a, b):
    """(a/b − 1)×100，任一缺值回 None。"""
    if a is None or b is None:
        return None
    try:
        a, b = float(a), float(b)
    except Exception:
        return None
    if not b or math.isnan(a) or math.isnan(b):
        return None
    return round((a / b - 1) * 100, 2)


def _d(ts):
    t = pd.Timestamp(ts)      # 11-08 網站版：盤中 K（1H／4H）要帶時分才不撞日期；日 K（00:00）輸出不變
    return t.strftime('%Y-%m-%d %H:%M' if (t.hour or t.minute) else '%Y-%m-%d')


def _ymd(x):
    if x is None:
        return None
    s = re.sub(r'\D', '', str(x))
    if len(s) != 8:
        raise ValueError('看不懂的日期：%r' % (x,))
    return s


# ═════════════════════════ 指標基元（純 numpy，selftest 會逐一驗） ═════════════════════════

def sma(x, n):
    x = np.asarray(x, dtype='float64')
    out = np.full(len(x), np.nan)
    if len(x) < n:
        return out
    c = np.cumsum(np.insert(x, 0, 0.0))
    out[n - 1:] = (c[n:] - c[:-n]) / n
    return out


def ema(x, n):
    """第 n 根以 SMA(n) 起算，α＝2/(n+1)。"""
    x = np.asarray(x, dtype='float64')
    out = np.full(len(x), np.nan)
    if len(x) < n:
        return out
    a = 2.0 / (n + 1)
    out[n - 1] = x[:n].mean()
    for i in range(n, len(x)):
        out[i] = a * x[i] + (1 - a) * out[i - 1]
    return out


def rma(x, n):
    """Wilder 平滑：從第一段連續 n 個有效值的平均起算，之後 (prev×(n−1)+x)/n。"""
    x = np.asarray(x, dtype='float64')
    out = np.full(len(x), np.nan)
    valid = ~np.isnan(x)
    run = 0
    start = None
    for i in range(len(x)):
        run = run + 1 if valid[i] else 0
        if run == n:
            start = i
            break
    if start is None:
        return out
    out[start] = x[start - n + 1:start + 1].mean()
    for i in range(start + 1, len(x)):
        xi = x[i] if valid[i] else out[i - 1]
        out[i] = (out[i - 1] * (n - 1) + xi) / n
    return out


def true_range(h, l, c):
    h, l, c = (np.asarray(v, dtype='float64') for v in (h, l, c))
    tr = h - l
    if len(c) > 1:
        pc = c[:-1]
        tr[1:] = np.maximum.reduce([h[1:] - l[1:], np.abs(h[1:] - pc), np.abs(l[1:] - pc)])
    return tr


def atr(h, l, c, n=14):
    return rma(true_range(h, l, c), n)


def adx(h, l, c, n=14):
    """回 (adx, +di, −di) 三條 numpy 序列（Wilder）。"""
    h, l, c = (np.asarray(v, dtype='float64') for v in (h, l, c))
    N = len(c)
    up = np.full(N, np.nan)
    dn = np.full(N, np.nan)
    tr = np.full(N, np.nan)
    if N > 1:
        u = h[1:] - h[:-1]
        d = l[:-1] - l[1:]
        up[1:] = np.where((u > d) & (u > 0), u, 0.0)
        dn[1:] = np.where((d > u) & (d > 0), d, 0.0)
        tr[1:] = true_range(h, l, c)[1:]
    str_, sup, sdn = rma(tr, n), rma(up, n), rma(dn, n)
    with np.errstate(invalid='ignore', divide='ignore'):
        pdi = 100 * sup / str_
        mdi = 100 * sdn / str_
        dx = 100 * np.abs(pdi - mdi) / (pdi + mdi)
    return rma(dx, n), pdi, mdi


def fractals(h, l, n=2):
    """回 (swing_high_idx, swing_low_idx)。左邊嚴格大於、右邊 ≥（等高只算第一根）。"""
    hi, lo = [], []
    for i in range(n, len(h) - n):
        if h[i] > max(h[i - n:i]) and h[i] >= max(h[i + 1:i + n + 1]):
            hi.append(i)
        if l[i] < min(l[i - n:i]) and l[i] <= min(l[i + 1:i + n + 1]):
            lo.append(i)
    return hi, lo


def break_events(h, l, c, hi, lo, n=2):
    """逐根走，swing 在 i+n 根確認；回 [{i, type, dir, level, swing_i}]。"""
    hi_at = {i + n: i for i in hi}
    lo_at = {i + n: i for i in lo}
    act_h = act_l = None
    bias = None
    ev = []
    for t in range(len(c)):
        if t in hi_at:
            act_h = hi_at[t]
        if t in lo_at:
            act_l = lo_at[t]
        if act_h is not None and c[t] > h[act_h]:
            ev.append({'i': t, 'type': 'CHoCH' if bias == 'down' else 'BOS', 'dir': 'up',
                       'level': float(h[act_h]), 'swing_i': act_h})
            bias, act_h = 'up', None
        if act_l is not None and c[t] < l[act_l]:
            ev.append({'i': t, 'type': 'CHoCH' if bias == 'up' else 'BOS', 'dir': 'down',
                       'level': float(l[act_l]), 'swing_i': act_l})
            bias, act_l = 'down', None
    return ev


def round_step(p):
    """不超過收盤 5% 的最大 1／2／5×10^k。"""
    if not p or p <= 0:
        return None
    lim = p * 0.05
    k = math.floor(math.log10(lim))
    best = None
    for kk in (k - 1, k):
        for m in (1, 2, 5):
            s = m * 10 ** kk
            if s <= lim and (best is None or s > best):
                best = s
    return best


# ═════════════════════════ 資料層 ═════════════════════════

def market_of(symbol):
    s = str(symbol).strip().upper()
    return ('tw', s) if TW_PAT.match(s) else ('us', s.replace('.', '-'))


def _tw_db():
    if 'tw' not in _CACHE:
        with open(os.path.join(REPORTS, 'twdaily.pkl'), 'rb') as f:
            _CACHE['tw'] = pickle.load(f)
    return _CACHE['tw']


def _us_db():
    if 'us' not in _CACHE:
        p = os.path.join(REPORTS, 'usdaily.pkl')
        if os.path.exists(p):
            with open(p, 'rb') as f:
                _CACHE['us'] = pickle.load(f)
        else:
            _CACHE['us'] = None
    return _CACHE['us']


def _tw_live_days(last_ymd, until_ymd):
    """pkl 最後一天之後、≤ until 的平日（今天要過 15:00）。"""
    now = dt.datetime.now()
    today = now.strftime('%Y%m%d')
    d = dt.datetime.strptime(last_ymd, '%Y%m%d').date() + dt.timedelta(days=1)
    end = dt.datetime.strptime(until_ymd, '%Y%m%d').date()
    out = []
    while d <= end and len(out) < LIVE_MAX_DAYS + 5:
        y = d.strftime('%Y%m%d')
        if d.weekday() < 5 and (y < today or (y == today and now.hour >= TW_CUTOFF_HOUR)):
            out.append(y)
        d += dt.timedelta(days=1)
    return out


def _tw_live_day(y, mkt):
    """抓一天（上市必抓，拿加權指數；上櫃股再抓 TPEx）。每天每市場只抓一次（_CACHE）。
    回 ('ok', {code: tuple}, 指數)｜('holiday', None, None)｜('fail', None, 原因)。"""
    import tw_daily
    cc = _CACHE.setdefault('twlive', {})
    key = (y, mkt)
    if key in cc:
        return cc[key]
    res = None
    try:
        tw = cc.get((y, '上市'))
        if tw is None:
            with contextlib.redirect_stdout(io.StringIO()):
                b, _n, ix = tw_daily.fetch_twse(y)
            tw = ('ok', b, ix) if len(b) >= 500 else ('fail', None, '上市只有 %d 檔（未公布完整）' % len(b))
            cc[(y, '上市')] = tw
            time.sleep(0.3)
        if mkt == '上櫃' and tw[0] == 'ok':
            with contextlib.redirect_stdout(io.StringIO()):
                b, _n = tw_daily.fetch_tpex(y)
            res = ('ok', b, tw[2]) if len(b) >= 300 else ('fail', None, '上櫃只有 %d 檔' % len(b))
            time.sleep(0.3)
        else:
            res = tw
    except Exception as e:
        msg = str(e)
        res = ('holiday', None, None) if '沒有符合' in msg else ('fail', None, '%s: %s' % (type(e).__name__, msg[:60]))
    cc[key] = res
    return res


def _tw_live_patch(code, mkt, last_ymd, until_ymd, notes):
    """記憶體補最新幾天（不寫 pkl）。回 ({ymd: tuple}, {ymd: 指數}, [(ymd, factor)], [失敗日])。
    官方回「沒有符合條件的資料」＝休市（例：2026-09-25 中秋），不算過期。"""
    days = _tw_live_days(last_ymd, until_ymd)
    if not days:
        return {}, {}, [], []
    if len(days) > LIVE_MAX_DAYS:
        notes.append('pkl 落後 %d 個平日，只在記憶體補最近 %d 天；建議 --refresh' % (len(days), LIVE_MAX_DAYS))
        days = days[-LIVE_MAX_DAYS:]
    import tw_rel
    bars, idx, got, hol, bad = {}, {}, [], [], []
    for y in days:
        st, b, ix = _tw_live_day(y, mkt)
        if st == 'ok':
            if ix:
                idx[y] = ix
            if code in b:
                bars[y] = b[code]
            got.append(y)
        elif st == 'holiday':
            hol.append(y)
        else:
            bad.append('%s（%s）' % (y, ix))
    exl = []
    if got:
        ck = ('twex', tuple(sorted(got)))
        try:
            if ck not in _CACHE:
                with contextlib.redirect_stdout(io.StringIO()):
                    _CACHE[ck] = tw_rel.fetch_exdiv(sorted(got))
            exl = _CACHE[ck].get(code, [])
        except Exception as e:
            notes.append('補抓日的除權息因子抓取失敗（%s），那幾天若有除息會少還原' % type(e).__name__)
        notes.append('記憶體補上 pkl 之後的交易日：%s（未寫回 pkl）' % '、'.join(got))
    if hol:
        notes.append('官方無資料（休市）：%s' % '、'.join(hol))
    if bad:
        notes.append('補抓失敗：%s' % '、'.join(bad))
    return bars, idx, exl, bad


def load_tw(code, asof=None, live=True):
    db = _tw_db()
    notes = []
    mkt = None
    last_seen = ''
    rows = {}
    for m in ('上市', '上櫃'):
        for y, day in db['bars'][m].items():
            t = day.get(code)
            if t and t[3]:
                rows[y] = t
                if y >= last_seen:
                    last_seen, mkt = y, m
    if not rows:
        raise LookupError('台股 %s 不在 twdaily.pkl（上市／上櫃都沒有）' % code)
    pkl_last = max(max(db['bars']['上市']), max(db['bars']['上櫃']))
    idx = dict(db['index'])
    ex = list(db['ex'].get(code, []))
    until = _ymd(asof) or dt.date.today().strftime('%Y%m%d')
    bad = None
    if live and until > pkl_last:
        b2, i2, e2, bad = _tw_live_patch(code, mkt, pkl_last, until, notes)
        rows.update(b2)
        idx.update(i2)
        for y, f in e2:
            if not any(x[0] == y for x in ex):
                ex.append((y, f))
    ymds = sorted(y for y in rows if y <= until)
    df = pd.DataFrame([rows[y][:5] for y in ymds], index=pd.to_datetime(ymds),
                      columns=['o', 'h', 'l', 'c', 'v'], dtype='float64')
    # 開高低缺（零成交或欄位空）→ 用收盤補「形狀」不補量；只影響極少數日
    for col in ('o', 'h', 'l'):
        df[col] = df[col].where(df[col] > 0, df['c'])
    # 除權息還原
    fac = pd.Series(1.0, index=df.index)
    for y, f in ex:
        fac[df.index < pd.Timestamp(y)] *= f
    if ex:
        notes.append('已套除權息還原（%d 次）' % sum(1 for y, _ in ex if pd.Timestamp(y) <= df.index[-1]))
    for col in ('o', 'h', 'l', 'c'):
        df[col] = df[col] * fac
    # 分割／減資偵測（跳過前 5 根）
    ratio = (df['o'] / df['c'].shift(1)).values
    for k in range(5, len(df)):
        r = ratio[k]
        if np.isnan(r) or SPLIT_LO <= r <= SPLIT_HI:
            continue
        f = r
        for nn in range(2, 11):
            if abs(r * nn - 1) < 0.03:
                f = 1.0 / nn; break
            if abs(r / nn - 1) < 0.03:
                f = float(nn); break
        pre = df.index < df.index[k]
        for col in ('o', 'h', 'l', 'c'):
            df.loc[pre, col] = df.loc[pre, col] * f
        df.loc[pre, 'v'] = df.loc[pre, 'v'] / f
        notes.append('偵測到 %s 疑似分割／減資（開盤/前收＝%.4f），往前以因子 %.4f 還原價、量 ÷ 因子'
                     % (_d(df.index[k]), r, f))
    df['v'] = df['v'].where(df['v'] > 0)          # 0 量視為缺，不參與均量
    bench = pd.Series({pd.Timestamp(y): v for y, v in idx.items() if v and y <= until}).sort_index()
    stale = False
    if bad:                                        # live 模式：真的抓失敗才算過期（休市不算）
        stale = True
    elif not live and not asof:
        exp = _tw_live_days(pkl_last, dt.date.today().strftime('%Y%m%d'))
        if exp:
            stale = True
            notes.append('離線模式：pkl 只到 %s，之後的平日 %s 沒資料（可能是休市，未查證）'
                         % (_d(pd.Timestamp(pkl_last)), '、'.join(exp[:5])))
    meta = {'name': db['names'].get(code), 'exchange': mkt,
            'source': 'twdaily.pkl（官方日線，除權息＋分割還原）' + ('＋記憶體補抓' if any('記憶體補上' in x for x in notes) else ''),
            'bench': '加權指數', 'stale': stale}
    return df, bench, meta, notes


def _yf_norm(d):
    """yf.download 單檔 DataFrame → 本檔口徑（o/h/l/c/v、tz-naive 日期、丟掉 Close 為 NaN 的 K）。"""
    if d is None or not len(d):
        return None
    if isinstance(d.columns, pd.MultiIndex):
        d.columns = d.columns.get_level_values(0)
    d.index = pd.to_datetime(d.index).tz_localize(None).normalize()
    d = d.rename(columns={'Open': 'o', 'High': 'h', 'Low': 'l', 'Close': 'c', 'Volume': 'v'})[['o', 'h', 'l', 'c', 'v']]
    d = d.astype('float64').dropna(subset=['c']).sort_index()
    return d if len(d) else None


def prefetch_us(syms, period='2y', chunk=100, pause=0.5, progress=None):
    """批量預抓美股日線（2026-09-27 加，給 ta_publish 一次算上千檔用）。
    分批 yf.download(threads=True, group_by='column')，拆成單檔、口徑同 _yf_one，只放記憶體 _CACHE['yf']；
    **不寫任何檔、不跑 us_daily.ensure**（ensure 會連帶跑 us_breadth.run 寫寬度帳本）。
    之後 load_us 走到 _yf_one 時先查這個快取，就不會逐檔打 Yahoo（上千檔逐檔會被 429 限流）。
    SPY（REL 基準）一併預抓。抓不到的代號不進快取，之後 _yf_one 會照舊單檔再試一次。
    回 (成功數, [抓不到的代號])。"""
    import warnings
    warnings.filterwarnings('ignore')
    import yfinance as yf
    cache = _CACHE.setdefault('yf', {})
    want = []
    for s in list(syms) + ['SPY']:
        m, s2 = market_of(s)
        if m == 'us' and s2 not in want and s2 not in cache:
            want.append(s2)
    miss = []
    for k in range(0, len(want), chunk):
        part = want[k:k + chunk]
        try:
            with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
                d = yf.download(part, period=period, interval='1d', auto_adjust=True, progress=False,
                                threads=True, group_by='column')
        except Exception:
            d = None
        for s in part:
            one = None
            if d is not None and len(d):
                try:
                    if isinstance(d.columns, pd.MultiIndex):
                        lv1 = d.columns.get_level_values(1)
                        if s in set(lv1):
                            one = d.xs(s, axis=1, level=1).copy()
                    elif len(part) == 1:
                        one = d.copy()
                except Exception:
                    one = None
            one = _yf_norm(one) if one is not None else None
            if one is None:
                miss.append(s)
            else:
                cache[s] = one
        if progress:
            progress('美股預抓 %d/%d' % (min(k + chunk, len(want)), len(want)))
        if pause and k + chunk < len(want):
            time.sleep(pause)
    if 'SPY' in cache and _CACHE.get('SPY') is None:
        _CACHE['SPY'] = cache['SPY']
    return len(want) - len(miss), miss


def _yf_one(sym, period='2y'):
    hit = (_CACHE.get('yf') or {}).get(sym)       # prefetch_us 預抓過就直接用（拷貝，呼叫端會改 df）
    if hit is not None:
        return hit.copy()
    import warnings
    warnings.filterwarnings('ignore')
    import yfinance as yf
    with contextlib.redirect_stderr(io.StringIO()):
        d = yf.download(sym, period=period, interval='1d', auto_adjust=True, progress=False, threads=False)
    if d is None or not len(d):
        return None
    if isinstance(d.columns, pd.MultiIndex):
        d.columns = d.columns.get_level_values(0)
    d.index = pd.to_datetime(d.index).tz_localize(None).normalize()
    d = d.rename(columns={'Open': 'o', 'High': 'h', 'Low': 'l', 'Close': 'c', 'Volume': 'v'})[['o', 'h', 'l', 'c', 'v']]
    d = d.astype('float64').dropna(subset=['c']).sort_index()
    return d


def _us_settled():
    try:
        import us_daily
        return us_daily._settled_day()
    except Exception:
        return (dt.date.today() - dt.timedelta(days=1)).strftime('%Y%m%d')


def load_us(sym, asof=None, live=True):
    notes = []
    o = _us_db()
    settled = _us_settled()
    until = min(_ymd(asof) or settled, settled)
    in_pkl = o is not None and sym in o['bars']['Close'].columns
    pkl_asof = o.get('asof') if o else None
    df = None
    src = None
    if in_pkl and (pkl_asof >= until or not live):
        B = o['bars']
        df = pd.DataFrame({'o': B['Open'][sym], 'h': B['High'][sym], 'l': B['Low'][sym],
                           'c': B['Close'][sym], 'v': B['Volume'][sym]}).astype('float64').dropna(subset=['c'])
        src = 'usdaily.pkl（Yahoo auto_adjust，資料日 %s）' % pkl_asof
    elif live:
        try:
            df = _yf_one(sym)
            if df is not None:
                src = 'yfinance 單檔 2y（auto_adjust；%s）' % ('pkl 資料日 %s 過期' % pkl_asof if in_pkl else 'pkl 不收此檔')
        except Exception as e:
            notes.append('yfinance 抓 %s 失敗（%s）' % (sym, type(e).__name__))
        if df is None and in_pkl:
            B = o['bars']
            df = pd.DataFrame({'o': B['Open'][sym], 'h': B['High'][sym], 'l': B['Low'][sym],
                               'c': B['Close'][sym], 'v': B['Volume'][sym]}).astype('float64').dropna(subset=['c'])
            src = 'usdaily.pkl 舊資料（線上抓不到的退路，資料日 %s）' % pkl_asof
    if df is None or not len(df):
        raise LookupError('美股 %s 抓不到（%s）' % (
            sym, 'usdaily.pkl 沒有此檔（pkl 不收 ETF），離線模式不上網' if not live
            else 'pkl 沒有、yfinance 也沒回資料'))
    df = df[df.index <= pd.Timestamp(until)]
    df['v'] = df['v'].where(df['v'] > 0)
    # 基準 SPY
    bench, bname = None, 'SPY'
    if live:
        try:
            b = _CACHE.get('SPY')
            if b is None:
                b = _yf_one('SPY')
                _CACHE['SPY'] = b
            if b is not None:
                bench = b['c']
        except Exception:
            bench = None
    if bench is None and o is not None and 'SP500' in (o.get('index') or {}):
        bench, bname = o['index']['SP500'].astype('float64'), '^GSPC（SPY 抓不到的退路）'
        notes.append('基準退用 pkl 的 ^GSPC')
    if bench is not None:
        bench = bench[bench.index <= pd.Timestamp(until)]
    m = (o['meta'].get(sym) if o else None) or {}
    name = (m.get('name') or '').split(' - ')[0] or None
    stale = _d(df.index[-1]).replace('-', '') < until and not asof
    if stale:
        notes.append('資料只到 %s，預期最新定稿日 %s' % (_d(df.index[-1]), until))
    meta = {'name': name, 'exchange': m.get('ex'), 'source': src, 'bench': bname, 'stale': bool(stale)}
    return df, bench, meta, notes


# ═════════════════════════ 計算 ═════════════════════════

def _last(a):
    return None if a is None or not len(a) or np.isnan(a[-1]) else float(a[-1])


def _slope5(a):
    if len(a) < 6 or np.isnan(a[-1]) or np.isnan(a[-6]):
        return None
    return _pct(a[-1], a[-6])


def _cross_last(a, b, idx):
    """a−b 最近一次變號的日期與方向。"""
    d = a - b
    s = np.sign(d)
    last = None
    for i in range(1, len(s)):
        if np.isnan(s[i]) or np.isnan(s[i - 1]) or s[i] == 0:
            continue
        if s[i] != s[i - 1] and s[i - 1] != 0:
            last = {'date': _d(idx[i]), 'dir': 'up' if s[i] > 0 else 'down', 'bars_ago': len(s) - 1 - i}
    return last


# ═════════════════════════ 三訊號（2026-09-27 起的預設輸出；規則見檔頭 signals） ═════════════════════════

SIG_N = 120
SIG_SCHEMA = 'sig3-2'         # 09-27 sig3-1 → sig3-2：gaps／top_volume 加分類欄位、gaps.islands、badges.gap_type（只增不改）
TOP_VOL_N = 5                 # 前 N 大量（09-27 Yoda：前三 → 前五）
MA_GROUPS = (('short', (5, 10, 20)), ('mid', (20, 60, 120)))
MA_BULL, MA_BEAR, MA_MIX, MA_NA = '多頭排列', '空頭排列', '糾結', 'insufficient'
MA_BADGE = {MA_BULL: '多', MA_BEAR: '空', MA_MIX: '糾', MA_NA: '—'}
VOL_W_CAP = 5.0               # sr_levels：大量 K 權重上限（量倍數）
GAP_W = 2.0                   # sr_levels：每個缺口的權重
SR_NEAR_PCT = 10.0            # sr_levels：先在今收 ±10% 內挑最強，該側沒線才往外（2026-09-27 Yoda）


def _hu(x, nd=1):
    """四捨五入（half-up；Python round 是銀行家捨入）。None/NaN → None。"""
    x = _f(x, 12)
    if x is None:
        return None
    from decimal import Decimal, ROUND_HALF_UP
    return float(Decimal(repr(x)).quantize(Decimal(1).scaleb(-nd), rounding=ROUND_HALF_UP))


def _prev_avg(v, i, n=20):
    """第 i 根「之前」n 根（不含 i）的均量；前面不足 n 根 → None；缺值（0 量）不計。"""
    if i < n:
        return None
    a = v[i - n:i]
    a = a[~np.isnan(a)]
    return float(a.mean()) if len(a) else None


def _md(ts):
    t = pd.Timestamp(ts)
    return '%d/%d' % (t.month, t.day) + (' %02d:%02d' % (t.hour, t.minute) if (t.hour or t.minute) else '')


def _candle(o, h, l, c):
    """回 (candle, body_ratio)。規則見檔頭 top_volume。"""
    rng = h - l
    if not (rng > 0):
        return '十字', None
    r = round(abs(c - o) / rng, 10)
    if r >= 0.6:
        return ('長紅' if c > o else '長黑'), r
    if r <= 0.1:
        return '十字', r
    return ('紅K' if c > o else '黑K'), r


def _close_pos(h, l, c):
    """回 (高檔|中間|低檔, ratio)。"""
    rng = h - l
    if not (rng > 0):
        return '中間', None
    p = round((c - l) / rng, 10)
    if p >= round(2 / 3, 10):
        return '高檔', p
    if p <= round(1 / 3, 10):
        return '低檔', p
    return '中間', p


def _sig_top_volume(idx, O, H, L, Cc, v, k0, market):
    N = len(Cc)
    C = Cc[-1]
    cand = [i for i in range(k0, N) if not np.isnan(v[i]) and v[i] > 0]
    cand.sort(key=lambda i: (-v[i], -i))                  # 量大在前；同量取較近
    items = []
    for rank, i in enumerate(cand[:TOP_VOL_N], 1):
        avg = _prev_avg(v, i)
        cd, br = _candle(O[i], H[i], L[i], Cc[i])
        cp, pr = _close_pos(H[i], L[i], Cc[i])
        rel = '在上方' if C > H[i] else ('在下方' if C < L[i] else '區間內')
        items.append({'rank': rank, 'date': _d(idx[i]), 'days_ago': int(N - 1 - i),
                      'volume': _f(v[i], 0), 'avg20_prev': _f(avg, 0),
                      'vol_ratio': _hu(v[i] / avg, 1) if avg else None,
                      'open': _p(O[i]), 'high': _p(H[i]), 'low': _p(L[i]), 'close': _p(Cc[i]),
                      'chg_pct': _pct(Cc[i], Cc[i - 1]) if i > 0 and not np.isnan(Cc[i - 1]) else None,
                      'candle': cd, 'body_ratio': _f(br, 2), 'close_pos': cp, 'close_pos_ratio': _f(pr, 2),
                      'relation': rel, 'dist_high_pct': _pct(H[i], C), 'dist_low_pct': _pct(L[i], C)})
    if items:
        t = items[0]
        badge = {'relation': t['relation'], 'date': t['date'], 'days_ago': t['days_ago'],
                 'text': {'在上方': '在最大量K上方', '在下方': '在最大量K下方', '區間內': '在最大量K區間內'}[t['relation']]}
    else:
        badge = {'relation': None, 'date': None, 'days_ago': None, 'text': '無量資料'}
    return {'unit': {'tw': '股', 'fut': '口'}.get(market, 'shares'), 'items': items, 'badge': badge}


def _sig_gaps(idx, H, L, Cc, v, k0, skip=()):
    """skip：不算缺口的 K（絕對位置；網站版期貨換月那根，價格沒還原、跳空是換合約不是行情）。"""
    N = len(Cc)
    C = Cc[-1]
    raw = []
    for i in range(max(1, k0), N):
        if np.isnan(H[i - 1]) or np.isnan(L[i - 1]) or i in skip:
            continue
        if L[i] > H[i - 1]:
            dr, bot, top = 'up', H[i - 1], L[i]
        elif H[i] < L[i - 1]:
            dr, bot, top = 'down', H[i], L[i - 1]
        else:
            continue
        fill, fdate, ob, ot = 'none', None, bot, top
        for j in range(i + 1, N):
            if dr == 'up':
                if L[j] <= bot:
                    fill, fdate, ob, ot = 'full', j, None, None
                    break
                if L[j] < ot:
                    if fill == 'none':
                        fill, fdate = 'partial', j
                    ot = L[j]
            else:
                if H[j] >= top:
                    fill, fdate, ob, ot = 'full', j, None, None
                    break
                if H[j] > ob:
                    if fill == 'none':
                        fill, fdate = 'partial', j
                    ob = H[j]
        avg = _prev_avg(v, i)
        dist = None
        if fill != 'full':
            dist = _pct(ot, C) if dr == 'up' else _pct(ob, C)
        raw.append({'i': i, 'dist_abs': abs(dist) if dist is not None else None,
                    'row': {'date': _d(idx[i]), 'dir': dr, 'top': _p(top), 'bottom': _p(bot),
                            'size_pct': _f((top - bot) / Cc[i - 1] * 100, 2),
                            'vol_ratio': _hu(v[i] / avg, 1) if (avg and not np.isnan(v[i])) else None,
                            'days_ago': int(N - 1 - i),
                            'fill': fill, 'fill_date': _d(idx[fdate]) if fdate is not None else None,
                            'open_top': _p(ot), 'open_bottom': _p(ob), 'dist_pct': dist}})
    opn = sorted([g for g in raw if g['row']['fill'] != 'full'], key=lambda g: (g['dist_abs'], -g['i']))
    fld = sorted([g for g in raw if g['row']['fill'] == 'full'], key=lambda g: -g['i'])
    items = [g['row'] for g in opn + fld]

    def _brief(g):
        if g is None:
            return None
        r = g['row']
        return {k: r[k] for k in ('date', 'dir', 'fill', 'open_bottom', 'open_top', 'dist_pct')}
    above = next((g for g in opn if g['row']['dir'] == 'down'), None)
    below = next((g for g in opn if g['row']['dir'] == 'up'), None)
    if above is None and below is None:
        text = '無未補'
    else:
        text = '上 %s｜下 %s' % ('%+.1f%%' % above['row']['dist_pct'] if above else '無',
                                 '%+.1f%%' % below['row']['dist_pct'] if below else '無')
    return {'n': len(items), 'n_open': len(opn), 'n_filled': len(fld), 'items': items,
            'badge': {'above': _brief(above), 'below': _brief(below), 'text': text}}


def _ma_explain(C, vals, slopes, names):
    """糾結時：先判比較接近多方還是空方，再列出該方不成立的條件。回 (why, fails)。"""
    labels = ['收盤'] + list(names)
    seq = [C] + list(vals)
    pairs = [(labels[j], labels[j + 1], seq[j], seq[j + 1]) for j in range(len(vals))]
    bo = sum(1 for *_, a, b in pairs if a > b)
    be = sum(1 for *_, a, b in pairs if a < b)
    bs = sum(1 for s in slopes if s > 0)
    bes = sum(1 for s in slopes if s < 0)
    bull = (bo, bs) > (be, bes) if (bo, bs) != (be, bes) else C >= vals[-1]
    fails = []
    for x, y, a, b in pairs:
        if bull and not a > b:
            fails.append({'type': 'order', 'a': x, 'b': y, 'rel': '<' if a < b else '='})
        if not bull and not a < b:
            fails.append({'type': 'order', 'a': x, 'b': y, 'rel': '>' if a > b else '='})
    for nm, s in zip(names, slopes):
        if (bull and not s > 0) or (not bull and not s < 0):
            fails.append({'type': 'slope', 'ma': nm, 'slope': _f(s, 4)})
    side = '多頭' if bull else '空頭'
    bend = '走平／下彎' if bull else '走平／上揚'
    od = [f for f in fails if f['type'] == 'order']
    sl = [f for f in fails if f['type'] == 'slope']
    if not od:
        why = '%s順序成立但 %s %s' % (side, '、'.join(f['ma'] for f in sl), bend)
    else:
        why = '%s順序不成立：%s' % (side, '、'.join('%s %s %s' % (f['a'], f['rel'], f['b']) for f in od))
        if sl:
            why += '；且 %s %s' % ('、'.join(f['ma'] for f in sl), bend)
    return why, fails


def _ma_group(c, ns, idx):
    N = len(c)
    names = ['MA%d' % n for n in ns]
    M = {n: sma(c, n) for n in ns}
    S = {}
    for n in ns:
        s = np.full(N, np.nan)
        if N > n:
            s[n:] = (c[n:] - c[:-n]) / n              # SMA_t − SMA_{t−1}
        S[n] = np.round(s, 6)
    Mr = {n: np.round(M[n], 6) for n in ns}
    cr = np.round(c, 6)
    lines = [{'name': nm, 'n': n, 'value': _p(_last(M[n])), 'slope': _f(S[n][-1], 4)} for nm, n in zip(names, ns)]
    base = {'lines_n': list(ns), 'close': _p(c[-1]), 'lines': lines}
    n3 = ns[-1]
    if N < n3 + 1:
        return dict(base, state=MA_NA, why='只有 %d 根，需 ≥%d 根（今、昨兩天的 SMA%d）' % (N, n3 + 1, n3),
                    fails=[], days=None, days_capped=None, since=None, nearest_break=None)
    a1, a2, a3 = (Mr[n] for n in ns)
    s1, s2, s3 = (S[n] for n in ns)
    with np.errstate(invalid='ignore'):
        bull = (cr > a1) & (a1 > a2) & (a2 > a3) & (s1 > 0) & (s2 > 0) & (s3 > 0)
        bear = (cr < a1) & (a1 < a2) & (a2 < a3) & (s1 < 0) & (s2 < 0) & (s3 < 0)
    st = np.where(bull, 1.0, np.where(bear, -1.0, 0.0))
    st[np.isnan(a3) | np.isnan(s3) | np.isnan(a1) | np.isnan(s1)] = np.nan
    today = st[-1]
    k = N - 1
    while k - 1 >= 0 and st[k - 1] == today:
        k -= 1
    capped = bool(k == 0 or np.isnan(st[k - 1]))
    state = MA_BULL if today == 1 else (MA_BEAR if today == -1 else MA_MIX)
    vals = [float(Mr[n][-1]) for n in ns]
    slopes = [float(S[n][-1]) for n in ns]
    why, fails, nb = '', [], None
    if state == MA_MIX:
        why, fails = _ma_explain(float(cr[-1]), vals, slopes, names)
    else:
        labels = ['收盤'] + names
        seq = [float(c[-1])] + [float(M[n][-1]) for n in ns]
        cand = [(labels[j], labels[j + 1], seq[j], seq[j + 1]) for j in range(3)]
        x, y, a, b = min(cand, key=lambda z: abs(z[2] / z[3] - 1))
        nb = {'a': x, 'b': y, 'a_value': _p(a), 'b_value': _p(b), 'gap_pct': _f(abs(a / b - 1) * 100, 2)}
    return dict(base, state=state, why=why, fails=fails, days=int(N - k), days_capped=capped,
                since=_d(idx[k]), nearest_break=nb)


def _sig_ma_align(c, idx):
    out = {}
    for key, ns in MA_GROUPS:
        out[key] = _ma_group(c, ns, idx)
    bs = '短' + MA_BADGE[out['short']['state']]
    bm = '中' + MA_BADGE[out['mid']['state']]
    out['badge'] = {'short': bs, 'mid': bm, 'text': '%s・%s' % (bs, bm)}
    return out


def _touch_set(P, tol, H, L, Cc, k0, fh, fl):
    """T(P)：視窗內觸及 P 的 K（index 集合）。規則見檔頭 sr_levels。"""
    lo_, hi_, q = P - tol, P + tol, 0.25 * tol
    hit = set()
    for i in fh:
        if lo_ <= H[i] <= hi_:
            hit.add(i)
    for i in fl:
        if lo_ <= L[i] <= hi_:
            hit.add(i)
    for i in range(k0, len(Cc)):
        if lo_ <= H[i] <= hi_ and Cc[i] < P - q:
            hit.add(i)
        if lo_ <= L[i] <= hi_ and Cc[i] > P + q:
            hit.add(i)
    return hit


def _greedy_groups(items, tol, key=lambda x: x):
    """由低到高排序；與該組最低值差 ≤ tol 併入（組寬 ≤ tol）。"""
    out = []
    for x in sorted(items, key=key):
        if out and key(x) - key(out[-1][0]) <= tol + 1e-12:
            out[-1].append(x)
        else:
            out.append([x])
    return out


def _sr_lines(idx, H, L, Cc, h_raw, l_raw, c_raw, k0, tv, gp):
    """候選 → 合併 → 全部的線（兩側都有、還沒挑）。回 (tol, atr14, cands, lines)。
    _sig_sr 從這裡每側只挑一條（±10% 內最強，無則範圍外最強）；驗證時可包住本函式看全部線的強度對照。"""
    N = len(Cc)
    C = Cc[-1]
    C_prev = Cc[-2] if N > 1 else C
    a14 = _last(atr(h_raw, l_raw, c_raw, 14))
    tol = max(0.5 * a14 if a14 is not None else 0.0, 0.005 * C)
    # 分形（最後 2 根不確認）
    fh, fl = [], []
    for i in range(max(k0, 2), N - 2):
        if any(np.isnan(x) for x in (H[i - 2], H[i - 1], L[i - 2], L[i - 1])):
            continue
        if H[i] > max(H[i - 2:i]) and H[i] >= max(H[i + 1:i + 3]):
            fh.append(i)
        if L[i] < min(L[i - 2:i]) and L[i] <= min(L[i + 1:i + 3]):
            fl.append(i)
    cands = []
    for t in tv['items']:
        w = min(t['vol_ratio'], VOL_W_CAP) if t['vol_ratio'] is not None else 1.0
        for side, px in (('高', t['high']), ('低', t['low'])):
            cands.append({'p': px, 'type': 'vol', 'w': w, 'key': 'v' + t['date'],
                          'label': '大量K %s %s' % (_md(t['date']), side)})
    for g in gp['items']:
        if g['fill'] == 'full':
            continue
        for side, px in (('上緣', g['open_top']), ('下緣', g['open_bottom'])):
            cands.append({'p': px, 'type': 'gap', 'w': GAP_W, 'key': 'g' + g['date'],
                          'label': '缺口 %s %s' % (_md(g['date']), side)})
    pts = [H[i] for i in fh] + [L[i] for i in fl]
    for grp in _greedy_groups(pts, tol):
        Lc = float(np.median(grp))
        T = _touch_set(Lc, tol, H, L, Cc, k0, fh, fl)
        if len(T) >= 3:
            cands.append({'p': Lc, 'type': 'touch', 'w': float(len(T)), 'key': 't%.6f' % Lc, 'label': None,
                          'nt': len(T)})
    # 合併（以中心吸收）：候選依優先序排——觸及候選在前（T 大到小）、其餘依權重大到小，同分取離今收近；
    # 依序當中心，把還沒歸組、與中心差 ≤ tol 的候選併進來。線價 P＝中心價 → 每條線彼此差必 > tol。
    pri = sorted(cands, key=lambda x: (x['type'] != 'touch', -x['w'], abs(x['p'] - C)))
    used = [False] * len(pri)
    groups = []
    for a, x in enumerate(pri):
        if used[a]:
            continue
        used[a] = True
        grp = [x]
        for b in range(a + 1, len(pri)):
            if not used[b] and abs(pri[b]['p'] - x['p']) <= tol + 1e-12:
                used[b] = True
                grp.append(pri[b])
        groups.append((x['p'], grp))
    lines = []
    for P, grp in groups:
        T = sorted(_touch_set(P, tol, H, L, Cc, k0, fh, fl))
        vk = {}
        gk = set()
        for x in grp:
            if x['type'] == 'vol':
                vk[x['key']] = x['w']
            elif x['type'] == 'gap':
                gk.add(x['key'])
        strength = sum(vk.values()) + GAP_W * len(gk) + len(T)
        order = {'vol': 0, 'gap': 1, 'touch': 2}
        srcs = []
        for x in sorted(grp, key=lambda x: (order[x['type']], x['p'])):
            lab = x['label'] if x['type'] != 'touch' else '觸及 %d 次' % len(T)
            if lab not in srcs:
                srcs.append(lab)
        q = 0.25 * tol
        testing = abs(P - C) <= q + 1e-12
        if testing:
            kind = 'resistance' if C > C_prev else ('support' if C < C_prev else ('support' if C >= P else 'resistance'))
        else:
            kind = 'support' if P < C else 'resistance'
        lines.append({'price': _p(P), 'kind': kind, 'sources': srcs, 'touches': len(T),
                      'touch_dates': [_d(idx[i]) for i in T],
                      'last_touch_date': _d(idx[T[-1]]) if T else None,
                      'strength': _hu(strength, 1), 'dist_pct': _pct(P, C), 'testing': bool(testing),
                      '_d': abs(P - C)})
    return tol, a14, cands, lines


def _sr_pick(lines, kind):
    """該側只留一條 → [line] 或 []：
    先在 |dist_pct| ≤ SR_NEAR_PCT（±10%，含邊界）的線裡挑強度最高的 → pick_scope='within10'；
    該側 ±10% 內沒有任何線，才在該側全部線裡挑強度最高的 → pick_scope='beyond'。
    強度比輸出的 strength，相同取離今收近的。strongest 恆 True（＝被選中；保留欄位給舊讀者相容）。"""
    ls = [x for x in lines if x['kind'] == kind]
    if not ls:
        return []
    near = [x for x in ls if x.get('dist_pct') is not None and abs(x['dist_pct']) <= SR_NEAR_PCT + 1e-9]
    pool, scope = (near, 'within10') if near else (ls, 'beyond')
    best = min(pool, key=lambda x: (-(x['strength'] or 0), x['_d']))
    out = {k: v for k, v in best.items() if not k.startswith('_')}
    out['strongest'] = True
    out['pick_scope'] = scope
    return [out]


def _sig_sr(idx, H, L, Cc, h_raw, l_raw, c_raw, k0, tv, gp):
    tol, a14, cands, lines = _sr_lines(idx, H, L, Cc, h_raw, l_raw, c_raw, k0, tv, gp)
    sup, res = _sr_pick(lines, 'support'), _sr_pick(lines, 'resistance')

    def _b(x):
        return None if x is None else {'price': x['price'], 'dist_pct': x['dist_pct']}
    r0 = res[0] if res else None
    s0 = sup[0] if sup else None
    text = '壓 %s｜撐 %s' % ('%+.1f%%' % r0['dist_pct'] if r0 else '無', '%+.1f%%' % s0['dist_pct'] if s0 else '無')
    return {'tol': _p(tol), 'atr14': _p(a14), 'support': sup, 'resistance': res, 'n_candidates': len(cands),
            'n_lines': len(lines), 'badge': {'res': _b(r0), 'sup': _b(s0), 'text': text}}


# ═════════════════════════ ⑤ 缺口分類＋大量K解讀（趨勢＋位置；2026-09-27 Yoda 核准；規則見檔頭 ⑤） ═════════════════════════

TREND_N = 60                  # 趨勢：SMA60 今昨斜率＋收盤在均線上／下
POS_N = 60                    # 位置：60 日最高價／最低價
UP_DAYS_HIGH = 5              # 缺口前已連漲（收盤連續高於前一日）≥5 天 → 高檔
ATR_HIGH = 6.0                # (收盤 − 60 日最低) ≥ 6×ATR14 → 高檔
ATR_DEEP = 5.0                # (60 日最高 − 收盤) ≥ 5×ATR14 且跌深後第一個向上缺口 → 低檔起漲
VOL_BURST = 2.0               # 量倍數 ≥2.0 → 爆量
VOL_WITH = 1.5                # 量倍數 ≥1.5 → 帶量
SEQ_EXHAUST = 3               # 竭盡：這一波第 ≥3 個同向缺口
SEQ_LOOK = 250                # seq：往回找分形低（高）點最多幾根；找不到就從那裡起算
ESCAPE_ROOM = 10.0            # 逃逸：缺口當天收盤上方 10% 內沒有壓力（向下：下方 10% 內沒有支撐）
CHASE_PCT = 3.0               # 追高警示／大量K「近壓力」：距當時最近上方壓力 ≤3%
PIT_N = 120                   # 「當時可得」候選價位：當天之前 120 根
PIT_TOP_N = 5                 # 當時的前五大量
ISLAND_MAX = 10               # 島：缺口 A 之後 ≤10 根內出現反向缺口 B
CTX_N = 260                   # 視窗前多算幾根顯示精度價（PIT／seq 回看要用）
TREND_BULL, TREND_BEAR, TREND_FLAT = '多頭', '空頭', '盤整'
POS_ZH = {'up': {'HIGH': '高檔', 'LOW': '低檔起漲', 'MID': '中段'},
          'down': {'HIGH': '低檔', 'LOW': '高檔起跌', 'MID': '中段'}}
GAP_TYPE = {('up', 'rebound'): ('反彈缺口', '彈'), ('down', 'rebound'): ('回檔缺口', '回'),
            ('up', 'exhaust'): ('竭盡缺口', '竭'), ('down', 'exhaust'): ('下跌竭盡缺口', '竭'),
            ('up', 'break'): ('突破缺口', '突'), ('down', 'break'): ('跌破缺口', '破'),
            ('up', 'run'): ('逃逸缺口', '逃'), ('down', 'run'): ('下跌逃逸缺口', '逃'),
            ('up', 'common'): ('一般缺口', '一'), ('down', 'common'): ('一般缺口', '一')}
ISLAND_SHORT = '島'
NOTE_EXHAUST = '竭盡確認：這波可能走完'
NOTE_HOLD = {'up': '缺口守住，洗盤後可能發動', 'down': '缺口壓住，反彈後可能續跌'}
READ_REBOUND = '空頭反彈'
READ_CHASE = '高檔近壓力·追高風險'
READ_TURN = '跌深後大量紅K·可能轉強'
READ_DUMP = '高檔大量黑K·出貨疑慮'
READ_TURN_DN = '高位大量黑K·可能轉弱'   # 09-27 鏡像 READ_TURN：黑K 在「高檔起跌」（向下定義的 LOW）
READ_BULL_BLACK = '多頭中的大量黑K·先看支撐'
READ_NEUTRAL = '中性'


def _nan(*xs):
    return any(x is None or (isinstance(x, float) and math.isnan(x)) or (isinstance(x, np.floating) and np.isnan(x))
               for x in xs)


def _gap_ctx(H, L, Cc, c_raw, h_raw, l_raw, tx):
    """分類要用的共用資料（只算一次）：SMA60／今昨斜率、ATR14、tx 起的全部缺口、tx 起的分形高低點。"""
    N = len(Cc)
    s60 = np.round(sma(c_raw, TREND_N), 6)
    sl = np.full(N, np.nan)
    if N > TREND_N:
        sl[TREND_N:] = (c_raw[TREND_N:] - c_raw[:-TREND_N]) / TREND_N     # SMA60_t − SMA60_{t−1}
    allg = []                                                            # (i, dir, bottom, top)，同 _sig_gaps 口徑
    for i in range(max(1, tx + 1), N):
        if _nan(H[i - 1], L[i - 1], H[i], L[i]):
            continue
        if L[i] > H[i - 1]:
            allg.append((i, 'up', float(H[i - 1]), float(L[i])))
        elif H[i] < L[i - 1]:
            allg.append((i, 'down', float(H[i]), float(L[i - 1])))
    fh, fl = [], []                                                      # N=2 分形；f 在 f+2 那根收盤才確認
    for f in range(tx + 2, N - 2):
        hs, ls = H[f - 2:f + 3], L[f - 2:f + 3]
        if np.isnan(hs).any() or np.isnan(ls).any():
            continue
        if H[f] > max(H[f - 2:f]) and H[f] >= max(H[f + 1:f + 3]):
            fh.append(f)
        if L[f] < min(L[f - 2:f]) and L[f] <= min(L[f + 1:f + 3]):
            fl.append(f)
    return {'tx': tx, 'c6': np.round(c_raw, 6), 's60': s60, 'sl60': np.round(sl, 6),
            'a14': atr(h_raw, l_raw, c_raw, 14), 'allg': allg, 'fh': fh, 'fl': fl}


def _trend_at(ctx, r):
    """第 r 根的趨勢：SMA60 今昨斜率 >0 且收盤 > SMA60＝多頭；斜率 <0 且收盤 < SMA60＝空頭；其他＝盤整；SMA60 不足＝None。"""
    if r < TREND_N or r >= len(ctx['c6']):
        return None
    s, sl, c = ctx['s60'][r], ctx['sl60'][r], ctx['c6'][r]
    if _nan(s, sl, c):
        return None
    if sl > 0 and c > s:
        return TREND_BULL
    if sl < 0 and c < s:
        return TREND_BEAR
    return TREND_FLAT


def _position_at(ctx, idx, H, L, Cc, r, dr, gi=None):
    """第 r 根的位置（dr＝缺口方向；大量K一律用 'up'）。回 (HIGH|LOW|MID|None, basis)。
    gi＝缺口那根的 index：LOW 另要「跌深後第一個向上缺口」＝60 日最低那天（同價取較近）之後、gi 之前沒有別的向上缺口
    （向下缺口鏡像：60 日最高那天之後沒有別的向下缺口）；gi=None（大量K）不套這一條。"""
    up = dr == 'up'
    run, j = 0, r
    while j - 1 >= ctx['tx'] and run < 250:
        a_, b_ = Cc[j], Cc[j - 1]
        if _nan(a_, b_) or not ((a_ > b_) if up else (a_ < b_)):
            break
        run += 1
        j -= 1
    b = {'ref_date': _d(idx[r]), 'ref_close': _p(Cc[r]), 'sma60': _p(ctx['s60'][r]),
         'sma60_slope': _f(ctx['sl60'][r], 4), 'run_days': run, 'atr14': None, 'low60': None, 'low60_date': None,
         'high60': None, 'high60_date': None, 'rise_atr': None, 'drop_atr': None, 'first_since': None}
    j0 = r - POS_N + 1
    a = ctx['a14'][r] if r < len(ctx['a14']) else np.nan
    if j0 < ctx['tx'] or j0 < 0 or _nan(Cc[r], a) or not a > 0:
        return ('HIGH' if run >= UP_DAYS_HIGH else None), b
    sl_, sh_ = L[j0:r + 1], H[j0:r + 1]
    lo60, hi60 = float(np.nanmin(sl_)), float(np.nanmax(sh_))
    tlo = j0 + int(np.flatnonzero(sl_ == lo60)[-1])
    thi = j0 + int(np.flatnonzero(sh_ == hi60)[-1])
    C = float(Cc[r])
    rise, drop = round((C - lo60) / a, 6), round((hi60 - C) / a, 6)
    b.update(atr14=_p(a), low60=_p(lo60), low60_date=_d(idx[tlo]), high60=_p(hi60), high60_date=_d(idx[thi]),
             rise_atr=_f(rise, 2), drop_atr=_f(drop, 2))
    ext, deep = (rise, drop) if up else (drop, rise)
    first = None
    if gi is not None:
        t_ext = tlo if up else thi
        first = not any(d == dr and t_ext < g < gi for g, d, _b, _t in ctx['allg'])
        b['first_since'] = first
    if run >= UP_DAYS_HIGH or ext >= ATR_HIGH:
        return 'HIGH', b
    if deep >= ATR_DEEP and (gi is None or first):
        return 'LOW', b
    return 'MID', b


def _seq_at(ctx, gi, dr):
    """這一波第幾個同向缺口：從 gi 之前最近一個已確認（f+2 ≤ gi）的 N=2 分形低點（向下缺口用分形高點）起算，
    數 (f, gi] 之間同向缺口個數（含自己）。SEQ_LOOK 根內找不到分形 → 從 gi−SEQ_LOOK 起算、f=None。"""
    fr = ctx['fl'] if dr == 'up' else ctx['fh']
    lim = max(ctx['tx'], gi - SEQ_LOOK)
    f = None
    for x in reversed(fr):
        if x + 2 <= gi:
            if x >= lim:
                f = x
            break
    anchor = f if f is not None else lim - 1
    n = sum(1 for g, d, _b, _t in ctx['allg'] if d == dr and anchor < g <= gi)
    return n, f


def _pit_levels(ctx, idx, H, L, v, i, side):
    """第 i 根收盤「當時可得」的壓力（side='res'）／支撐（'sup'）候選，不看 i 之後的 K：
    ① i 之前 PIT_N 根（i−120…i−1，不含當天）量最大的 5 根的最高價（支撐用最低價）；
    ② 缺口日在同一段（i−120…i−1）、截至第 i 根還沒完全回補的向下缺口剩餘區間下緣（支撐：向上缺口剩餘區間上緣）。
    回 [(價位, 說明)]。"""
    lo = max(ctx['tx'], i - PIT_N)
    js = [j for j in range(lo, i) if not _nan(v[j]) and v[j] > 0]
    js.sort(key=lambda j: (-v[j], -j))
    out = []
    for j in js[:PIT_TOP_N]:
        p = H[j] if side == 'res' else L[j]
        if not _nan(p):
            out.append((float(p), '大量K %s %s' % (_md(idx[j]), '高' if side == 'res' else '低')))
    want = 'down' if side == 'res' else 'up'
    for g, d, bot, top in ctx['allg']:
        if d != want or g < lo or g >= i:
            continue
        if d == 'down':
            seg = H[g + 1:i + 1]
            mx = float(np.nanmax(seg)) if len(seg) and not np.isnan(seg).all() else -np.inf
            if mx >= top:
                continue
            out.append((max(bot, mx), '缺口 %s 下緣' % _md(idx[g])))
        else:
            seg = L[g + 1:i + 1]
            mn = float(np.nanmin(seg)) if len(seg) and not np.isnan(seg).all() else np.inf
            if mn <= bot:
                continue
            out.append((min(top, mn), '缺口 %s 上緣' % _md(idx[g])))
    return out


def _pit_nearest(levels, C, side):
    """最近的上方壓力（side='res'：P > C 取最低）／下方支撐（'sup'：P < C 取最高）。回 (price, label, dist_pct) 或 None 三個。"""
    if side == 'res':
        c = [x for x in levels if x[0] > C]
        best = min(c, key=lambda x: x[0]) if c else None
    else:
        c = [x for x in levels if x[0] < C]
        best = max(c, key=lambda x: x[0]) if c else None
    if best is None:
        return None, None, None
    return _p(best[0]), best[1], _pct(best[0], C)


def _vol_class(vr):
    if vr is not None and vr >= VOL_BURST:
        return '爆量'
    if vr is not None and vr >= VOL_WITH:
        return '帶量'
    return '一般'


def _classify(sig_gaps, sig_tv, ctx, idx, O, H, L, Cc, v, k0):
    """原地在 gaps.items／top_volume.items 加分類欄位，並補 gaps.islands、gaps.badge.last。規則見檔頭 ⑤。"""
    N = len(Cc)
    d2i = {_d(idx[i]): i for i in range(k0, N)}
    gl = []
    for g in sig_gaps['items']:
        i = d2i[g['date']]
        dr = g['dir']
        up = dr == 'up'
        r = i - 1
        trend = _trend_at(ctx, r)
        pos, basis = _position_at(ctx, idx, H, L, Cc, r, dr, gi=i)
        seq, f = _seq_at(ctx, i, dr)
        vc = _vol_class(g.get('vol_ratio'))
        side = 'res' if up else 'sup'
        lp, llab, lpct = _pit_nearest(_pit_levels(ctx, idx, H, L, v, i, side), float(Cc[i]), side)
        basis.update(level=lp, level_src=llab, level_pct=lpct)
        room = lpct is None or abs(lpct) > ESCAPE_ROOM
        if pos == 'LOW' and seq == 1 and vc in ('帶量', '爆量'):       # 突破／跌破優先：跌深後第一個帶量缺口才是轉強
            key = 'break'
        elif trend == (TREND_BEAR if up else TREND_BULL):
            key = 'rebound'
        elif seq >= SEQ_EXHAUST and pos == 'HIGH' and vc == '爆量':
            key = 'exhaust'
        elif trend == (TREND_BULL if up else TREND_BEAR) and pos == 'MID' and room:
            key = 'run'
        else:
            key = 'common'
        tp, ts = GAP_TYPE[(dr, key)]
        notes = []
        if key == 'exhaust' and g['fill'] != 'none':
            notes.append(NOTE_EXHAUST)
        if pos == 'HIGH' and lpct is not None and abs(lpct) <= CHASE_PCT + 1e-9:
            notes.append(('追高警示：高檔且距上方壓力 %+.1f%%' if up else '追空警示：低檔且距下方支撐 %+.1f%%') % lpct)
        if key == 'break' and g['fill'] == 'none' and i < N - 1:
            edge = g['top'] if up else g['bottom']
            if all((Cc[j] > edge) if up else (Cc[j] < edge) for j in range(i + 1, N)):
                notes.append(NOTE_HOLD[dr])
        g.update(trend=trend, position=pos, position_zh=POS_ZH[dr].get(pos) if pos else None, seq=seq,
                 seq_from=_d(idx[f]) if f is not None else None, vol_class=vc, type=tp, type_short=ts,
                 notes=notes, island=False, island_kind=None, basis=basis)
        gl.append((i, g))
    # 島狀反轉：A 之後第一個反向缺口 B（b−a ≤ 10），島內 K（a…b−1）整段懸空＝不碰兩側缺口的外緣
    gl.sort(key=lambda x: x[0])
    islands, used = [], set()
    for ka, (a, A) in enumerate(gl):
        nb = next(((b, B) for b, B in gl[ka + 1:] if B['dir'] != A['dir']), None)
        if nb is None:
            continue
        b, B = nb
        if b - a > ISLAND_MAX or a in used or b in used:
            continue
        seg_l, seg_h = L[a:b], H[a:b]
        if np.isnan(seg_l).any() or np.isnan(seg_h).any():
            continue
        if A['dir'] == 'up':
            edge = max(A['bottom'], B['bottom'])
            ok_ = float(seg_l.min()) > edge
            kind, name = 'top', '頂部島狀反轉'
        else:
            edge = min(A['top'], B['top'])
            ok_ = float(seg_h.max()) < edge
            kind, name = 'bottom', '底部島狀反轉'
        if not ok_:
            continue
        used.update((a, b))
        for X in (A, B):
            X.update(island=True, island_kind=kind, type_short=ISLAND_SHORT)
        islands.append({'kind': kind, 'name': name, 'start': _d(idx[a]), 'end': _d(idx[b - 1]),
                        'a_gap': A['date'], 'b_gap': B['date'], 'bars': int(b - a),
                        'high': _p(seg_h.max()), 'low': _p(seg_l.min()), 'edge': _p(edge)})
    sig_gaps['islands'] = islands
    if gl:
        i_, G = gl[-1]
        conf = NOTE_EXHAUST in G['notes']
        txt = G['type_short'] + ('✓' if conf and not G['island'] else '')
        sig_gaps['badge']['last'] = {'date': G['date'], 'dir': G['dir'], 'type': G['type'], 'type_short': G['type_short'],
                                     'island': G['island'], 'confirmed': conf, 'text': txt}
    else:
        sig_gaps['badge']['last'] = None
    # 大量 K：以當根為基準
    for t in sig_tv['items']:
        i = d2i[t['date']]
        trend = _trend_at(ctx, i)
        pos, basis = _position_at(ctx, idx, H, L, Cc, i, 'up', gi=None)
        lp, llab, lpct = _pit_nearest(_pit_levels(ctx, idx, H, L, v, i, 'res'), float(Cc[i]), 'res')
        basis.update(level=lp, level_src=llab, level_pct=lpct)
        red, black = t['candle'] in ('長紅', '紅K'), t['candle'] in ('長黑', '黑K')     # 十字不算紅也不算黑
        # 黑K 另用向下定義判一次位置：LOW＝高檔起跌（離 60 日低 ≥5 ATR，且沒連跌 ≥5、沒離 60 日高 ≥6 ATR）
        pos_dn = _position_at(ctx, idx, H, L, Cc, i, 'down', gi=None)[0] if black else None
        if red and pos == 'LOW':                  # 跌深轉強優先於空頭反彈（同缺口「突破優先於反彈」，09-27）
            rd = READ_TURN
        elif red and trend == TREND_BEAR:
            rd = READ_REBOUND
        elif red and pos == 'HIGH' and lpct is not None and lpct <= CHASE_PCT + 1e-9:
            rd = READ_CHASE
        elif black and pos == 'HIGH':
            rd = READ_DUMP
        elif black and pos_dn == 'LOW':           # 鏡像：漲多後的大量黑K 先判轉弱，再判多頭中的先看支撐
            rd = READ_TURN_DN
        elif black and trend == TREND_BULL and pos == 'MID':
            rd = READ_BULL_BLACK
        else:
            rd = READ_NEUTRAL
        t.update(trend=trend, position=pos, position_zh=POS_ZH['up'].get(pos) if pos else None, read=rd, basis=basis)


def compute_signals(df, market, skip_gaps=()):
    """回 (signals, chart)。價格比較用顯示精度（見檔頭通用口徑）。skip_gaps：不算缺口的 K（見 _sig_gaps）。"""
    idx = df.index
    o_raw, h_raw, l_raw, c_raw, v = (df[k].values.astype('float64') for k in ('o', 'h', 'l', 'c', 'v'))
    N = len(c_raw)
    k0 = max(0, N - SIG_N)                        # 視窗第一根
    tx = max(0, k0 - CTX_N)                       # 顯示精度從這根起算：①～④只用 ≥k0−2，⑤ 的 PIT／seq 要往回看

    def rnd(a):
        out = np.full(N, np.nan)
        for i in range(tx, N):
            x = _p(a[i])
            if x is not None:
                out[i] = x
        return out
    O, H, L, Cc = rnd(o_raw), rnd(h_raw), rnd(l_raw), rnd(c_raw)
    tv = _sig_top_volume(idx, O, H, L, Cc, v, k0, market)
    gp = _sig_gaps(idx, H, L, Cc, v, k0, skip_gaps)
    ma = _sig_ma_align(c_raw, idx)
    sr = _sig_sr(idx, H, L, Cc, h_raw, l_raw, c_raw, k0, tv, gp)
    _classify(gp, tv, _gap_ctx(H, L, Cc, c_raw, h_raw, l_raw, tx), idx, O, H, L, Cc, v, k0)
    last = gp['badge'].get('last')
    sig = {'schema': SIG_SCHEMA, 'window_bars': int(N - k0), 'top_volume': tv, 'gaps': gp, 'ma_align': ma,
           'sr_levels': sr,
           'badges': {'vol': tv['badge']['text'], 'gap': gp['badge']['text'], 'ma': ma['badge']['text'],
                      'sr': sr['badge']['text'], 'gap_type': last['text'] if last else '—'}}
    chart = {'bars': [{'date': _d(idx[i]), 'o': _p(O[i]), 'h': _p(H[i]), 'l': _p(L[i]), 'c': _p(Cc[i]),
                       'v': _f(v[i], 0)} for i in range(k0, N)]}
    for n in (5, 10, 20, 60, 120):
        s = sma(c_raw, n)
        chart['sma%d' % n] = [_p(s[i]) for i in range(k0, N)]
    return sig, chart


def compute(df, bench, symbol, market, meta, notes, legacy=False):
    """預設：meta／price（close、chg_1d_pct）／signals／chart。legacy=True：舊版全部區塊＋signals＋新 chart。"""
    if legacy:
        out = compute_legacy(df, bench, symbol, market, meta, notes)
    else:
        idx = df.index
        c = df['c'].values.astype('float64')
        N = len(c)
        out = {'meta': {'symbol': symbol, 'market': market, 'name': meta.get('name'), 'exchange': meta.get('exchange'),
                        'asof': _d(idx[-1]), 'bars': int(N), 'source': meta.get('source'), 'bench': meta.get('bench'),
                        'stale': bool(meta.get('stale')), 'notes': notes},
               'price': {'close': _p(c[-1]), 'chg_1d_pct': _pct(c[-1], c[-2]) if N > 1 else None}}
    sig, chart = compute_signals(df, market)
    out.pop('chart', None)
    out['signals'] = sig
    out['chart'] = chart
    return out


def compute_legacy(df, bench, symbol, market, meta, notes):
    """2026-09-27 前的完整輸出（趨勢／結構／ADX／停損目標／信心分…）；只在 analyze(legacy=True) 時呼叫。"""
    idx = df.index
    o, h, l, c, v = (df[k].values.astype('float64') for k in ('o', 'h', 'l', 'c', 'v'))
    N = len(c)
    C = float(c[-1])
    out = {}

    # ── meta
    out['meta'] = {'symbol': symbol, 'market': market, 'name': meta.get('name'), 'exchange': meta.get('exchange'),
                   'asof': _d(idx[-1]), 'bars': int(N), 'source': meta.get('source'), 'bench': meta.get('bench'),
                   'stale': bool(meta.get('stale')), 'notes': notes}

    # ── price
    w = min(252, N)
    hi52, lo52 = float(np.nanmax(h[-w:])), float(np.nanmin(l[-w:]))
    out['price'] = {'close': _p(C), 'chg_1d_pct': _pct(c[-1], c[-2]) if N > 1 else None,
                    'high_52w': _p(hi52), 'low_52w': _p(lo52),
                    'dist_high_52w_pct': _pct(C, hi52), 'dist_low_52w_pct': _pct(C, lo52),
                    'window_bars': int(w)}

    # ── ma
    S = {n: sma(c, n) for n in (5, 20, 60, 120, 240)}
    E = {n: ema(c, n) for n in (20, 50, 200)}
    lines = {('sma%d' % n): a for n, a in S.items()}
    lines.update({('ema%d' % n): a for n, a in E.items()})
    have = [n for n in (5, 20, 60, 120, 240) if _last(S[n]) is not None]
    align = None
    if len(have) >= 3:
        vals = [_last(S[n]) for n in have]
        if all(vals[i] > vals[i + 1] for i in range(len(vals) - 1)):
            align = '多頭排列'
        elif all(vals[i] < vals[i + 1] for i in range(len(vals) - 1)):
            align = '空頭排列'
        else:
            align = '糾結'
    out['ma'] = {
        'sma': {str(n): _p(_last(S[n])) for n in S},
        'ema': {str(n): _p(_last(E[n])) for n in E},
        'slope_5d_pct': {k: _slope5(a) for k, a in lines.items()},
        'above': {k: (None if _last(a) is None else bool(C > _last(a))) for k, a in lines.items()},
        'alignment': align, 'alignment_lines': ['sma%d' % n for n in have]}

    # ── trend_state（DecisionPoint）
    e20, e50, e200 = _last(E[20]), _last(E[50]), _last(E[200])
    lt = it = st = None
    if e50 is not None and e200 is not None:
        lt = 'BUY' if e50 > e200 else 'SELL'
    if e20 is not None and e50 is not None and e200 is not None:
        if e20 > e50:
            it = 'BUY' if e50 > e200 else 'NEUTRAL'
        else:
            it = 'NEUTRAL' if e50 > e200 else 'SELL'
    s20 = _slope5(E[20])
    if e20 is not None and s20 is not None:
        st = 'BUY' if (C > e20 and s20 > 0) else ('SELL' if (C < e20 and s20 < 0) else 'NEUTRAL')
    out['trend_state'] = {'long': lt, 'inter': it, 'short': st,
                          'aligned': (lt is not None and lt == it == st and lt != 'NEUTRAL'),
                          'silver_cross': _cross_last(E[20], E[50], idx),
                          'golden_cross': _cross_last(E[50], E[200], idx),
                          'rule': 'LTTM: EMA50>EMA200 BUY 否則 SELL；ITTM: EMA20>50 且 50>200 BUY、20>50 但 50<200 NEUTRAL、'
                                  '20<50 但 50>200 NEUTRAL、皆< SELL；ST: C 對 EMA20＋EMA20 五日斜率'}

    # ── structure
    hi_i, lo_i = fractals(h, l, 2)
    sw = []
    prev = None
    for i in hi_i:
        lab = None if prev is None else ('HH' if h[i] > h[prev] else ('LH' if h[i] < h[prev] else 'EQH'))
        sw.append({'i': i, 'kind': 'high', 'price': float(h[i]), 'label': lab}); prev = i
    prev = None
    for i in lo_i:
        lab = None if prev is None else ('HL' if l[i] > l[prev] else ('LL' if l[i] < l[prev] else 'EQL'))
        sw.append({'i': i, 'kind': 'low', 'price': float(l[i]), 'label': lab}); prev = i
    sw.sort(key=lambda x: x['i'])
    last_h = next((x for x in reversed(sw) if x['kind'] == 'high'), None)
    last_l = next((x for x in reversed(sw) if x['kind'] == 'low'), None)
    ev = break_events(h, l, c, hi_i, lo_i, 2)
    le = ev[-1] if ev else None
    state, basis = '區間', '無 60 根內突破、且高低點標籤不一致'
    if le and N - 1 - le['i'] <= BREAK_FRESH:
        state = '多頭' if le['dir'] == 'up' else '空頭'
        basis = '最後一次 %s（%s）在 %d 根前' % (le['type'], le['dir'], N - 1 - le['i'])
    elif last_h and last_l and last_h['label'] == 'HH' and last_l['label'] == 'HL':
        state, basis = '多頭', '最後高低點＝HH＋HL'
    elif last_h and last_l and last_h['label'] == 'LH' and last_l['label'] == 'LL':
        state, basis = '空頭', '最後高低點＝LH＋LL'

    def _sw(x):
        return {'date': _d(idx[x['i']]), 'price': _p(x['price']), 'kind': x['kind'], 'label': x['label']}

    def _ev(e):
        return None if e is None else {'date': _d(idx[e['i']]), 'type': e['type'], 'dir': e['dir'],
                                       'level': _p(e['level']), 'swing_date': _d(idx[e['swing_i']]),
                                       'bars_ago': int(N - 1 - e['i'])}
    out['structure'] = {
        'swings': [_sw(x) for x in sw[-6:]],
        'sequence': [x['label'] for x in sw[-6:] if x['label']],
        'last_swing_high': _sw(last_h) if last_h else None,
        'last_swing_low': _sw(last_l) if last_l else None,
        'last_event': _ev(le),
        'last_bos': _ev(next((e for e in reversed(ev) if e['type'] == 'BOS'), None)),
        'last_choch': _ev(next((e for e in reversed(ev) if e['type'] == 'CHoCH'), None)),
        'state': state, 'state_basis': basis}

    # ── adx
    A, PDI, MDI = adx(h, l, c, 14)
    if N < 150:
        out['adx'] = {'status': 'insufficient', 'adx14': None, 'plus_di': None, 'minus_di': None,
                      'quality': None, 'why': '只有 %d 根，Wilder 平滑需 ≥150 根' % N}
    else:
        a = _last(A)
        out['adx'] = {'status': 'ok', 'adx14': _f(a, 2), 'plus_di': _f(_last(PDI), 2), 'minus_di': _f(_last(MDI), 2),
                      'adx_slope_5d': (_f(A[-1] - A[-6], 2) if N > 6 and not np.isnan(A[-6]) else None),
                      'quality': None if a is None else ('趨勢' if a > 25 else ('無趨勢' if a < 20 else '灰色')),
                      'di_dir': None if a is None else ('up' if PDI[-1] > MDI[-1] else 'down')}

    # ── vol
    AT = atr(h, l, c, 14)
    at14 = _last(AT)
    AT22 = atr(h, l, c, 22)
    at22 = _last(AT22)
    mid = S[20]
    sd = pd.Series(c).rolling(20).std(ddof=0).values
    up_, lo_ = mid + 2 * sd, mid - 2 * sd
    with np.errstate(invalid='ignore', divide='ignore'):
        bw = (up_ - lo_) / mid * 100
    bwv = bw[~np.isnan(bw)]
    squeeze = None
    if len(bwv) >= 125:
        squeeze = bool(bwv[-1] <= bwv[-125:].min() + 1e-12)
    out['vol'] = {'atr14': _p(at14), 'atr_pct': _f(at14 / C * 100, 2) if at14 is not None else None,
                  'atr22': _p(at22),
                  'bb_mid': _p(_last(mid)), 'bb_upper': _p(_last(up_)), 'bb_lower': _p(_last(lo_)),
                  'bandwidth': _f(_last(bw), 2),
                  'bandwidth_min125': _f(bwv[-125:].min(), 2) if len(bwv) >= 125 else None,
                  'pct_b': _f((C - lo_[-1]) / (up_[-1] - lo_[-1]), 3)
                           if _last(up_) is not None and up_[-1] != lo_[-1] else None,
                  'squeeze': squeeze}

    # ── volume
    def _nm(a):
        a = a[~np.isnan(a)]
        return float(a.mean()) if len(a) else None
    vt = None if np.isnan(v[-1]) else float(v[-1])
    avg20p = _nm(v[-21:-1]) if N >= 21 else None
    avg5 = _nm(v[-5:]) if N >= 5 else None
    avg20q = _nm(v[-25:-5]) if N >= 25 else None
    r1 = (vt / avg20p) if (vt is not None and avg20p) else None
    r5 = (avg5 / avg20q) if (avg5 is not None and avg20q) else None

    def _pv(dp, r):
        if dp is None or r is None:
            return None, None
        if dp == 0:
            return '平盤', None
        lab = ('價漲' if dp > 0 else '價跌') + ('量增' if r > 1 else '量縮')
        return lab, lab in ('價漲量增', '價跌量縮')
    d1 = (c[-1] - c[-2]) if N > 1 else None
    d5 = (c[-1] - c[-6]) if N > 5 else None
    pv1, same1 = _pv(d1, r1)
    pv5, same5 = _pv(d5, r5)
    out['volume'] = {'v': _f(vt, 0), 'avg20_prev': _f(avg20p, 0), 'ratio_1d': _f(r1, 2),
                     'avg5': _f(avg5, 0), 'ratio_5d': _f(r5, 2),
                     'pv_1d': pv1, 'same_dir_1d': same1, 'pv_5d': pv5, 'same_dir_5d': same5,
                     'unit': '股' if market == 'tw' else 'shares'}

    # ── rel
    rel = {}
    if bench is not None and len(bench):
        j = pd.concat([df['c'], bench.rename('b')], axis=1, join='inner').dropna()
        for w_ in (5, 20, 60):
            if len(j) > w_:
                rs = (j['c'].iloc[-1] / j['c'].iloc[-1 - w_] - 1) * 100
                rb = (j['b'].iloc[-1] / j['b'].iloc[-1 - w_] - 1) * 100
                rel['rel%d' % w_] = _f(rs - rb, 2)
                rel['ret%d' % w_] = _f(rs, 2)
                rel['bench_ret%d' % w_] = _f(rb, 2)
            else:
                rel['rel%d' % w_] = None
        rel['common_asof'] = _d(j.index[-1]) if len(j) else None
        if len(j) and j.index[-1] != idx[-1]:
            notes.append('基準最後一天 %s 與標的 %s 不同，REL 以共同交易日 %s 計'
                         % (_d(bench.index[-1]), _d(idx[-1]), _d(j.index[-1])))
    else:
        rel = {'rel5': None, 'rel20': None, 'rel60': None}
        notes.append('基準序列缺，REL 無法計算')
    rel['bench'] = meta.get('bench')
    rel['unit'] = '百分點（標的報酬 − 基準報酬）'
    out['rel'] = rel

    # ── levels
    cand = []
    lb = max(0, N - 250)
    for x in sw:
        if x['i'] >= lb:
            cand.append((x['price'], 'swing %s %s' % (x['kind'], _d(idx[x['i']]))))
    for n in (60, 240):
        if _last(S[n]) is not None:
            cand.append((_last(S[n]), 'SMA%d' % n))
    stp = round_step(C)
    if stp:
        cand.append((math.ceil(C / stp + 1e-9) * stp, '整數關卡（級距 %g）' % stp))
        cand.append((math.floor(C / stp - 1e-9) * stp, '整數關卡（級距 %g）' % stp))
    gaps = []
    for i in range(max(1, lb), N):
        if l[i] > h[i - 1]:
            after = l[i:].min()
            if after > h[i - 1]:
                gaps.append({'date': _d(idx[i]), 'dir': 'up', 'lo': float(h[i - 1]), 'hi': float(after)})
                cand.append((float(h[i - 1]), '未補向上缺口下緣 %s' % _d(idx[i])))
                cand.append((float(after), '未補向上缺口上緣 %s' % _d(idx[i])))
        if h[i] < l[i - 1]:
            after = h[i:].max()
            if after < l[i - 1]:
                gaps.append({'date': _d(idx[i]), 'dir': 'down', 'lo': float(after), 'hi': float(l[i - 1])})
                cand.append((float(l[i - 1]), '未補向下缺口上緣 %s' % _d(idx[i])))
                cand.append((float(after), '未補向下缺口下緣 %s' % _d(idx[i])))
    cand.append((hi52, '52w 高'))
    cand.append((lo52, '52w 低'))

    def _pick(side_up):
        pool = sorted([x for x in cand if (x[0] > C if side_up else x[0] < C)],
                      key=lambda x: abs(x[0] - C))
        sel = []
        for p_, s_ in pool:
            hit = next((z for z in sel if abs(p_ / z['_p'] - 1) < 0.005), None)
            if hit:
                if s_ not in hit['sources']:
                    hit['sources'].append(s_)
                continue
            if len(sel) < 3:
                sel.append({'_p': p_, 'sources': [s_]})
        return [{'price': _p(z['_p']), 'sources': z['sources'], 'dist_pct': _pct(z['_p'], C)} for z in sel]
    out['levels'] = {'above': _pick(True), 'below': _pick(False),
                     'open_gaps': [{'date': g['date'], 'dir': g['dir'], 'lo': _p(g['lo']), 'hi': _p(g['hi'])}
                                   for g in gaps[-5:]]}

    # ── risk
    side = 'short' if state == '空頭' else 'long'
    lows_below = [x for x in sw if x['kind'] == 'low' and x['price'] < C]
    highs_above = [x for x in sw if x['kind'] == 'high' and x['price'] > C]
    L = {}
    Sh = {}
    if at14 is not None:
        if lows_below:
            x = lows_below[-1]
            L['swing'] = {'price': _p(x['price'] - 0.5 * at14), 'basis': 'swing low %s %s − 0.5×ATR14'
                          % (_d(idx[x['i']]), _p(x['price']))}
        if highs_above:
            x = highs_above[-1]
            Sh['swing'] = {'price': _p(x['price'] + 0.5 * at14), 'basis': 'swing high %s %s + 0.5×ATR14'
                           % (_d(idx[x['i']]), _p(x['price']))}
        L['atr2'] = {'price': _p(C - 2 * at14), 'basis': '收盤 − 2×ATR14'}
        Sh['atr2'] = {'price': _p(C + 2 * at14), 'basis': '收盤 + 2×ATR14'}
    if at22 is not None and N >= 22:
        L['chandelier'] = {'price': _p(h[-22:].max() - 3 * at22), 'basis': '22 根最高 %s − 3×ATR22' % _p(h[-22:].max())}
        Sh['chandelier'] = {'price': _p(l[-22:].min() + 3 * at22), 'basis': '22 根最低 %s + 3×ATR22' % _p(l[-22:].min())}
    for dct in (L, Sh):
        for k_ in dct:
            dct[k_]['dist_pct'] = _pct(dct[k_]['price'], C)
    if side == 'long':
        ok = {k_: z for k_, z in L.items() if k_ in ('swing', 'chandelier') and z['price'] is not None and z['price'] < C}
        dk = max(ok, key=lambda k_: ok[k_]['price']) if ok else ('atr2' if 'atr2' in L else None)
        dflt = L.get(dk) if dk else None
    else:
        ok = {k_: z for k_, z in Sh.items() if k_ in ('swing', 'chandelier') and z['price'] is not None and z['price'] > C}
        dk = min(ok, key=lambda k_: ok[k_]['price']) if ok else ('atr2' if 'atr2' in Sh else None)
        dflt = Sh.get(dk) if dk else None
    out['risk'] = {'side': side, 'long': L, 'short': Sh,
                   'default': None if dflt is None else dict(dflt, method=dk),
                   'rule': '多方：①swing low−0.5ATR ②Chandelier 取較近（高者）；空方對稱；皆無效用 ③'}

    # ── targets
    tg = {'side': side}
    if dflt and dflt['price'] is not None:
        R = abs(C - dflt['price'])
        sg = 1 if side == 'long' else -1
        tg['R'] = _p(R)
        for k_ in (1, 2, 3):
            tg['r%d' % k_] = {'price': _p(C + sg * k_ * R), 'rr': float(k_), 'dist_pct': _pct(C + sg * k_ * R, C)}
        if side == 'long':
            ns = highs_above[-1]['price'] if highs_above else (hi52 if hi52 > C else None)
            nsrc = ('swing high %s' % _d(idx[highs_above[-1]['i']])) if highs_above else '52w 高'
        else:
            ns = lows_below[-1]['price'] if lows_below else (lo52 if lo52 < C else None)
            nsrc = ('swing low %s' % _d(idx[lows_below[-1]['i']])) if lows_below else '52w 低'
        tg['next_swing'] = None if ns is None else {'price': _p(ns), 'source': nsrc, 'dist_pct': _pct(ns, C),
                                                    'rr': _f(sg * (ns - C) / R, 2) if R else None}
        me = next((e for e in reversed(ev) if e['dir'] == ('up' if side == 'long' else 'down')), None)
        if me and N - 1 - me['i'] <= BREAK_FRESH:
            seg = slice(me['swing_i'], me['i'] + 1)
            ext = float(l[seg].min()) if side == 'long' else float(h[seg].max())
            height = abs(me['level'] - ext)
            mt = me['level'] + sg * height
            tg['measured'] = {'price': _p(mt), 'dist_pct': _pct(mt, C), 'rr': _f(sg * (mt - C) / R, 2) if R else None,
                              'reached': bool(sg * (C - mt) >= 0),
                              'basis': '%s %s 突破 %s，量測高度 %s（突破前回檔極值 %s）'
                                       % (me['type'], _d(idx[me['i']]), _p(me['level']), _p(height), _p(ext))}
        else:
            tg['measured'] = None
            tg['measured_why'] = '60 根內沒有與 side 同方向的 BOS／CHoCH，無可量測型態'
    else:
        tg['why'] = '沒有有效預設停損（ATR 不足）'
    out['targets'] = tg

    # ── invalidation：以「會觸發反向 CHoCH 的那個 swing」為準（最近一個確認 swing low／high，須在收盤另一側）
    if state == '多頭':
        ref = lows_below[-1] if lows_below else None
        inv = ('收盤跌破最後一個 swing low（%s）%s（%s）' % (ref['label'] or '—', _p(ref['price']), _d(idx[ref['i']]))
               if ref else '收盤跌破預設停損 %s' % (dflt or {}).get('price'))
    elif state == '空頭':
        ref = highs_above[-1] if highs_above else None
        inv = ('收盤站上最後一個 swing high（%s）%s（%s）' % (ref['label'] or '—', _p(ref['price']), _d(idx[ref['i']]))
               if ref else '收盤站上預設停損 %s' % (dflt or {}).get('price'))
    else:
        inv = '區間：收盤跌破預設停損 %s 就放棄多方假設%s' % (
            (dflt or {}).get('price'),
            ('；收盤站上 swing high %s 才轉多頭結構' % _p(highs_above[-1]['price'])) if highs_above else '')
    out['invalidation'] = inv

    # ── confidence（兩個方向都算；score＝side 那一邊）
    def _score(sd):
        want = 'BUY' if sd == 'long' else 'SELL'
        bd = []

        def add(key, hit, pts, why):
            mx = next(z[1] for z in SCORE_TABLE if z[0] == key)
            bd.append({'item': key, 'hit': bool(hit), 'pts': int(pts if hit else 0), 'max': mx, 'why': why})
        add('trend_long', lt == want, 15, 'long=%s' % lt)
        add('trend_inter', it == want, 15, 'inter=%s' % it)
        add('trend_short', st == want, 10, 'short=%s' % st)
        add('structure', state == ('多頭' if sd == 'long' else '空頭'), 15, 'state=%s' % state)
        ax = out['adx']
        dir_ok = ax.get('di_dir') == ('up' if sd == 'long' else 'down')
        a_ = ax.get('adx14')
        if ax['status'] != 'ok' or a_ is None:
            add('adx', False, 0, 'insufficient')
        elif a_ > 25 and dir_ok:
            add('adx', True, 15, 'ADX %.1f>25，DI %s' % (a_, ax['di_dir']))
        elif a_ >= 20 and dir_ok:
            add('adx', True, 7, 'ADX %.1f 灰色，DI %s' % (a_, ax['di_dir']))
        else:
            add('adx', False, 0, 'ADX %s，DI %s' % (a_, ax.get('di_dir')))
        good = ('價漲量增', '價跌量縮') if sd == 'long' else ('價跌量增', '價漲量縮')
        add('volume', pv5 in good, 10, 'pv_5d=%s' % pv5)
        r20 = rel.get('rel20')
        add('rel20', r20 is not None and (r20 > 0 if sd == 'long' else r20 < 0), 10, 'REL20=%s' % r20)
        add('ma_align', align == ('多頭排列' if sd == 'long' else '空頭排列'), 10, 'alignment=%s' % align)
        return int(sum(z['pts'] for z in bd)), bd
    sc_l, bd_l = _score('long')
    sc_s, bd_s = _score('short')
    sc, bd = (sc_l, bd_l) if side == 'long' else (sc_s, bd_s)
    conflict = None
    if (side == 'short' and sc_l > sc_s) or (side == 'long' and sc_s > sc_l):
        conflict = '結構定的方向（%s）與多數趨勢訊號相反：long %d／short %d，結構剛翻或只是回檔，宜降低部位或等確認' % (side, sc_l, sc_s)
    out['confidence'] = {'score': sc, 'side': side, 'score_long': sc_l, 'score_short': sc_s, 'conflict': conflict,
                         'breakdown': bd,
                         'table': [{'item': k_, 'max': m_, 'rule': r_} for k_, m_, r_ in SCORE_TABLE],
                         'notes': '分數不是勝率：只衡量各規則訊號與 side 同向的程度，未經回測校準'}

    # ── chart
    k0 = max(0, N - CHART_N)
    out['chart'] = {
        'bars': [{'date': _d(idx[i]), 'o': _p(o[i]), 'h': _p(h[i]), 'l': _p(l[i]), 'c': _p(c[i]),
                  'v': _f(v[i], 0)} for i in range(k0, N)],
        'sma20': [_p(S[20][i]) for i in range(k0, N)],
        'sma60': [_p(S[60][i]) for i in range(k0, N)]}
    return out


def analyze(symbol, asof=None, live=True, refresh=False, legacy=False):
    """主入口。symbol：'2330'／'0050'／'NVDA'…；asof：'YYYY-MM-DD' 或 'YYYYMMDD'（只用 ≤ 該日的 K）。
    live=True：pkl 過期時在記憶體補最新（不寫檔）；refresh=True：先跑官方 ensure（會寫 pkl＋寬度帳本）。
    legacy=True：連舊區塊（ma／trend_state／structure／adx／vol／volume／rel／levels／risk／targets／
    invalidation／confidence）一起輸出；預設只有 meta／price／signals／chart。"""
    market, sym = market_of(symbol)
    if refresh:
        want = _ymd(asof) or dt.date.today().strftime('%Y%m%d')
        if market == 'tw':
            import tw_daily
            tw_daily.ensure(want)
            _CACHE.pop('tw', None)
        else:
            import us_daily
            us_daily.ensure(want)
            _CACHE.pop('us', None)
    if market == 'tw':
        df, bench, meta, notes = load_tw(sym, asof, live)
    else:
        df, bench, meta, notes = load_us(sym, asof, live)
    if len(df) < 30:
        raise LookupError('%s 只有 %d 根 K，不足以分析（至少 30）' % (sym, len(df)))
    return compute(df, bench, sym, market, meta, notes, legacy=legacy)


def summary_line(d):
    """一行三訊號摘要（量／缺〔最近缺口類型〕／排／撐壓）。"""
    m, p, b = d['meta'], d['price'], d['signals']['badges']
    chg = p.get('chg_1d_pct')
    return ('%-6s %-10s %s 收 %-9s %s ｜量 %s｜缺 %s〔%s〕｜排 %s｜%s'
            % (m['symbol'], (m['name'] or '')[:10], m['asof'], p['close'],
               ('%+.2f%%' % chg) if chg is not None else '—', b['vol'], b['gap'], b.get('gap_type', '—'), b['ma'],
               b['sr']))


def summary_line_legacy(d):
    m, t, s, r, g, cf = d['meta'], d['trend_state'], d['structure'], d['risk'], d['targets'], d['confidence']
    df_ = r.get('default') or {}
    r2 = (g.get('r2') or {}).get('price')
    return ('%-6s %-10s %s 收 %-8s 趨勢 L/I/S=%s/%s/%s  結構 %s  %s 停損 %s(%s%%,%s)  2R %s  信心 %d'
            % (m['symbol'], (m['name'] or '')[:10], m['asof'], d['price']['close'], t['long'], t['inter'], t['short'],
               s['state'], r['side'], df_.get('price'), df_.get('dist_pct'), df_.get('method'), r2, cf['score']))


# ═════════════════════════ selftest ═════════════════════════

def selftest():
    fails = []

    def ok(cond, msg):
        print(('  PASS ' if cond else '  FAIL ') + msg)
        if not cond:
            fails.append(msg)

    rng = np.random.default_rng(7)
    x = np.arange(1, 31, dtype=float)
    ok(abs(sma(x, 5)[-1] - np.mean(x[-5:])) < 1e-12 and np.isnan(sma(x, 5)[3]), 'sma 末值＝最後五根平均、前 4 根為 NaN')
    e = ema(x, 10)
    ref = np.mean(x[:10])
    for i in range(10, 30):
        ref = 2 / 11 * x[i] + 9 / 11 * ref
    ok(abs(e[-1] - ref) < 1e-9 and np.isnan(e[8]), 'ema SMA 起算＋遞迴')
    # ATR 手算
    h = 10 + rng.random(40) * 2
    l = h - 1 - rng.random(40)
    c = (h + l) / 2
    tr = [h[0] - l[0]] + [max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1])) for i in range(1, 40)]
    a = sum(tr[:14]) / 14
    for i in range(14, 40):
        a = (a * 13 + tr[i]) / 14
    ok(abs(atr(h, l, c, 14)[-1] - a) < 1e-9, 'ATR14 Wilder 對手算')
    # 分形
    hh = np.array([1, 2, 5, 3, 2, 3, 4, 8, 4, 3, 2, 3], float)
    ll = hh - 1
    hi, lo = fractals(hh, ll, 2)
    ok(hi == [2, 7], 'fractal swing highs = [2,7]（得 %s）' % hi)
    ok(lo == [4, 10] or lo == [4], 'fractal swing lows 含 4（得 %s）' % lo)
    # BOS／CHoCH：先跌破低點（BOS down）再站上高點（CHoCH up）
    cl = np.array([10, 11, 12, 11, 10, 9, 8, 9, 10, 12, 13, 14, 15], float)
    H = cl + 0.5
    Lw = cl - 0.5
    hi, lo = fractals(H, Lw, 2)
    ev = break_events(H, Lw, cl, hi, lo, 2)
    ok(any(z['type'] == 'BOS' and z['dir'] == 'up' for z in ev) or any(z['dir'] == 'up' for z in ev),
       '上漲站上前高產生向上突破事件（events=%s）' % [(z['i'], z['type'], z['dir']) for z in ev])
    cl2 = np.concatenate([np.linspace(10, 20, 20), np.linspace(20, 14, 8), np.linspace(14, 22, 10),
                          np.linspace(22, 12, 12)])
    cl2 = cl2 + np.tile([0, 0.4, -0.3, 0.2], 13)[:len(cl2)]
    hi, lo = fractals(cl2 + 0.3, cl2 - 0.3, 2)
    ev = break_events(cl2 + 0.3, cl2 - 0.3, cl2, hi, lo, 2)
    ok(bool(ev) and ev[-1]['dir'] == 'down' and ev[-1]['type'] == 'CHoCH',
       '多頭後大跌 → 最後事件為向下 CHoCH（得 %s）' % ([(z['type'], z['dir']) for z in ev][-3:]))
    # ADX：穩定上漲序列 ADX 高、+DI > −DI
    n = 200
    base = np.linspace(100, 200, n) + rng.normal(0, 0.3, n)
    A, P, M = adx(base + 1, base - 1, base, 14)
    ok(A[-1] > 25 and P[-1] > M[-1], '單邊上漲 ADX>25 且 +DI>−DI（ADX=%.1f）' % A[-1])
    # 整數關卡
    ok(round_step(2475) == 100 and round_step(225) == 10 and round_step(34.88) == 1, 'round_step 2475→100、225→10、34.88→1')
    # 整合：合成 K 線跑 compute，JSON 可序列化、短序列標 insufficient
    idx = pd.bdate_range('2025-01-01', periods=300)
    px = 100 * np.exp(np.cumsum(rng.normal(0.001, 0.015, 300)))
    df = pd.DataFrame({'o': px * (1 + rng.normal(0, 0.003, 300)), 'h': px * 1.01, 'l': px * 0.99, 'c': px,
                       'v': rng.integers(1e5, 2e5, 300).astype(float)}, index=idx)
    df['h'] = df[['o', 'h', 'c']].max(axis=1)
    df['l'] = df[['o', 'l', 'c']].min(axis=1)
    bench = pd.Series(100 * np.exp(np.cumsum(rng.normal(0, 0.01, 300))), index=idx)
    d0 = compute(df, bench, 'TEST', 'us', {'name': 'test', 'bench': 'synthetic'}, [])
    s = json.dumps(d0, ensure_ascii=False)
    ok('NaN' not in s and 'Infinity' not in s, '預設 compute 輸出可 json.dumps 且無 NaN/Infinity')
    ok(list(d0) == ['meta', 'price', 'signals', 'chart'] and set(d0['price']) == {'close', 'chg_1d_pct'},
       '預設頂層只有 meta／price／signals／chart，price 只有 close、chg_1d_pct（得 %s）' % list(d0))
    ok(all(len(d0['chart'][k]) == 120 for k in ('bars', 'sma5', 'sma10', 'sma20', 'sma60', 'sma120')),
       'chart 120 根且 SMA5/10/20/60/120 對齊')
    d = compute(df, bench, 'TEST', 'us', {'name': 'test', 'bench': 'synthetic'}, [], legacy=True)
    s = json.dumps(d, ensure_ascii=False)
    ok('NaN' not in s and 'Infinity' not in s, 'legacy compute 輸出可 json.dumps 且無 NaN/Infinity')
    need = ['meta', 'price', 'ma', 'trend_state', 'structure', 'adx', 'vol', 'volume', 'rel', 'levels',
            'risk', 'targets', 'invalidation', 'confidence', 'signals', 'chart']
    ok(all(k in d for k in need), 'legacy：舊 15 個頂層欄位＋signals 齊')
    ok(0 <= d['confidence']['score'] <= 100 and sum(z[1] for z in SCORE_TABLE) == 100, '信心分 0～100、計分表滿分 100')
    ok(len(d['chart']['bars']) == 120 and len(d['chart']['sma20']) == 120, 'chart 120 根且 SMA 對齊')
    rs = (px[-1] / px[-21] - 1) * 100 - (bench.iloc[-1] / bench.iloc[-21] - 1) * 100
    ok(abs(d['rel']['rel20'] - rs) < 0.01, 'REL20 對手算（%.2f vs %.2f）' % (d['rel']['rel20'], rs))
    dfl = d['risk']['default']
    if d['risk']['side'] == 'long':
        ok(dfl is None or dfl['price'] < d['price']['close'], '多方預設停損在收盤之下')
    else:
        ok(dfl is None or dfl['price'] > d['price']['close'], '空方預設停損在收盤之上')
    d2 = compute(df.iloc[:60], bench, 'SHORT', 'us', {'name': 'short', 'bench': 'synthetic'}, [], legacy=True)
    ok(d2['adx']['status'] == 'insufficient' and d2['ma']['sma']['240'] is None and d2['ma']['ema']['200'] is None,
       '60 根：ADX insufficient、SMA240／EMA200 為 None（不補 0）')
    ok(d2['signals']['ma_align']['mid']['state'] == MA_NA and d2['signals']['ma_align']['badge']['mid'] == '中—',
       '60 根：mid 組 insufficient、badge 中—')
    ok(market_of('0050') == ('tw', '0050') and market_of('00631L')[0] == 'tw' and market_of('brk.b') == ('us', 'BRK-B'),
       '代號判市場：0050／00631L＝tw、brk.b→BRK-B')

    # ── 三訊號：手算對照 ──
    ok(_hu(2.25, 1) == 2.3 and _hu(3.7037, 1) == 3.7 and _hu(None) is None, '_hu 四捨五入 half-up（2.25→2.3）')
    # ① top_volume：40 根平盤，第 25/30/35 根放量（30 與 35 同量 → 35 在前）
    n = 40
    ix = pd.bdate_range('2026-01-05', periods=n)
    O = np.full(n, 10.0); Hh = np.full(n, 10.2); Ll = np.full(n, 9.8); Cl = np.full(n, 10.0); V = np.full(n, 100.0)
    O[35], Hh[35], Ll[35], Cl[35], V[35] = 10.0, 11.0, 9.9, 10.9, 500     # 實體 .9/全距 1.1＝.82 長紅；收位 .91 高檔
    O[30], Hh[30], Ll[30], Cl[30], V[30] = 10.5, 10.6, 9.6, 10.45, 500    # .05/1.0＝.05 十字；收位 .85 高檔
    O[25], Hh[25], Ll[25], Cl[25], V[25] = 10.4, 10.5, 9.5, 10.0, 400     # .4/1.0＝.4 黑K；收位 .5 中間
    O[-1], Hh[-1], Ll[-1], Cl[-1] = 10.0, 10.2, 9.8, 9.85                  # 今收 9.85 < 第 30 根最低 9.6? 否 → 區間內
    dfa = pd.DataFrame({'o': O, 'h': Hh, 'l': Ll, 'c': Cl, 'v': V}, index=ix)
    sa, _ = compute_signals(dfa, 'tw')
    tv = sa['top_volume']['items']
    ok([x['date'] for x in tv] == [_d(ix[35]), _d(ix[30]), _d(ix[25]), _d(ix[39]), _d(ix[38])],
       '前五大量排序：35、30（同量 500 取較近）、25，其餘都 100 → 取最近的 39、38（得 %s）' % [x['date'] for x in tv])
    ok([x['vol_ratio'] for x in tv][:3] == [3.7, 4.3, 4.0],
       'vol_ratio：500/135＝3.7、500/115＝4.3、400/100＝4.0（得 %s）' % [x['vol_ratio'] for x in tv])
    ok([x['candle'] for x in tv][:3] == ['長紅', '十字', '黑K'] and [x['close_pos'] for x in tv][:3] == ['高檔', '高檔', '中間'],
       'candle／close_pos 分類（得 %s／%s）' % ([x['candle'] for x in tv], [x['close_pos'] for x in tv]))
    ok(tv[0]['relation'] == '在下方' and tv[1]['relation'] == '區間內' and tv[0]['days_ago'] == 4,
       'relation：9.85 < 第 35 根最低 9.9 → 在下方；第 30 根 [9.6,10.6] → 區間內（得 %s）' % [x['relation'] for x in tv])
    ok(tv[0]['dist_high_pct'] == _pct(11.0, 9.85) and sa['top_volume']['badge']['text'] == '在最大量K下方',
       'dist_high_pct＝(11/9.85−1)×100、badge 以最大量那根為準')
    ok(tv[0]['chg_pct'] == _pct(10.9, 10.0), 'chg_pct＝(10.9/10−1)×100')
    # ② gaps：上缺→部分回補→完全回補；下缺→完全回補；最後一個下缺部分回補
    n = 30
    ix = pd.bdate_range('2026-02-02', periods=n)
    O = np.full(n, 10.0); Hh = np.full(n, 10.2); Ll = np.full(n, 9.8); Cl = np.full(n, 10.0); V = np.full(n, 100.0)

    def bar(i, o, h, l, c):
        O[i], Hh[i], Ll[i], Cl[i] = o, h, l, c
    bar(10, 10.6, 10.9, 10.5, 10.8)                      # 上缺 [10.2, 10.5]
    for i in range(11, 15):
        bar(i, 10.8, 11.0, 10.6, 10.8)
    bar(15, 10.7, 10.8, 10.4, 10.6)                      # 進入 → partial，剩 [10.2, 10.4]
    for i in range(16, 20):
        bar(i, 10.7, 10.9, 10.45, 10.7)
    bar(20, 9.9, 10.0, 9.6, 9.7)                         # 下缺 [10.0, 10.45]；同時低 9.6 ≤ 10.2 → 上缺 full
    for i in range(21, 25):
        bar(i, 9.7, 9.9, 9.5, 9.7)
    bar(25, 9.8, 10.5, 9.7, 10.3)                        # 高 10.5 ≥ 10.45 → 下缺 full
    bar(26, 9.5, 9.6, 9.2, 9.3)                          # 下缺 [9.6, 9.7]
    bar(27, 9.3, 9.5, 9.1, 9.3)
    bar(28, 9.3, 9.65, 9.1, 9.3)                         # 高 9.65 > 9.6 → partial，剩 [9.65, 9.7]
    bar(29, 9.3, 9.5, 9.1, 9.3)
    dfg = pd.DataFrame({'o': O, 'h': Hh, 'l': Ll, 'c': Cl, 'v': V}, index=ix)
    sg, _ = compute_signals(dfg, 'tw')
    g = sg['gaps']['items']
    ok([(x['date'], x['dir'], x['fill']) for x in g] ==
       [(_d(ix[26]), 'down', 'partial'), (_d(ix[20]), 'down', 'full'), (_d(ix[10]), 'up', 'full')],
       '缺口：三個、未補在前、已補新到舊（得 %s）' % [(x['date'], x['dir'], x['fill']) for x in g])
    ok(g[0]['open_bottom'] == 9.65 and g[0]['open_top'] == 9.7 and g[0]['fill_date'] == _d(ix[28])
       and g[0]['dist_pct'] == _pct(9.65, 9.3), '部分回補：剩 [9.65, 9.7]、fill_date＝第一次進入、dist＝(9.65/9.3−1)')
    ok(g[1]['top'] == 10.45 and g[1]['bottom'] == 10.0 and g[1]['fill_date'] == _d(ix[25]) and g[1]['dist_pct'] is None,
       '下缺 [10.0, 10.45] 於第 25 根完全回補')
    ok(g[2]['fill_date'] == _d(ix[20]) and g[2]['size_pct'] == round((10.5 - 10.2) / 10.0 * 100, 2),
       '上缺第 20 根完全回補（先 partial 再 full，fill_date 取 full 那天）、size＝0.3/10')
    ok(sg['gaps']['badge']['text'] == '上 +3.8%｜下 無' and sg['gaps']['badge']['below'] is None,
       'gap badge（得 %s）' % sg['gaps']['badge']['text'])
    # ③ ma_align
    up = np.linspace(10, 50, 200)
    dfu = pd.DataFrame({'o': up, 'h': up + .1, 'l': up - .1, 'c': up, 'v': np.full(200, 1e5)},
                       index=pd.bdate_range('2025-01-01', periods=200))
    su, _ = compute_signals(dfu, 'us')
    ms, mm = su['ma_align']['short'], su['ma_align']['mid']
    ok(ms['state'] == MA_BULL and ms['days'] == 180 and ms['days_capped'] and mm['state'] == MA_BULL and mm['days'] == 80,
       '單邊上漲：short 多頭 180 天（第 20 根起可算）、mid 多頭 80 天（得 %s/%s、%s/%s）'
       % (ms['state'], ms['days'], mm['state'], mm['days']))
    ok(su['ma_align']['badge']['text'] == '短多・中多' and ms['nearest_break']['a'] == '收盤', 'badge 短多・中多；最近破壞點＝收盤–MA5')
    dn = up[::-1].copy()
    dfd = pd.DataFrame({'o': dn, 'h': dn + .1, 'l': dn - .1, 'c': dn, 'v': np.full(200, 1e5)},
                       index=pd.bdate_range('2025-01-01', periods=200))
    sd_, _ = compute_signals(dfd, 'us')
    ok(sd_['ma_align']['badge']['text'] == '短空・中空', '單邊下跌：短空・中空')
    nm3 = ['MA5', 'MA10', 'MA20']
    ok(_ma_explain(10, [9, 9.5, 8], [.1, .1, .1], nm3)[0] == '多頭順序不成立：MA5 < MA10', 'why：MA5 < MA10')
    ok(_ma_explain(10, [9, 8, 7], [.1, .2, 0.0], nm3)[0] == '多頭順序成立但 MA20 走平／下彎', 'why：順序成立但 MA20 走平／下彎')
    ok(_ma_explain(5, [6, 7, 8], [-.1, .05, -.1], nm3)[0] == '空頭順序成立但 MA10 走平／上揚', 'why：空頭順序成立但 MA10 走平／上揚')
    ok(_ma_explain(10, [9, 9.5, 8], [.1, -.1, .1], nm3)[0] == '多頭順序不成立：MA5 < MA10；且 MA10 走平／下彎',
       'why：順序錯＋斜率錯一起列')
    # ④ sr_levels：鋸齒走勢，每 6 根摸一次 12.0 又回落 → 12.0 是觸及 ≥3 的壓力
    cyc = [10.0, 10.8, 11.5, 11.8, 11.2, 10.5]
    cc = np.array(cyc * 10 + [10.2, 10.4])
    hh = cc + 0.15
    hh[3::6][:10] = 12.0
    ll = cc - 0.15
    oo = np.roll(cc, 1); oo[0] = cc[0]
    vv = np.full(len(cc), 1e5)
    vv[[30, 36, 42, 48, 54]] = 3e5                     # 前五大量放在波段低點（收 10.0），不擠到 12.0 那一側
    dfs = pd.DataFrame({'o': oo, 'h': np.maximum(hh, oo), 'l': np.minimum(ll, oo), 'c': cc, 'v': vv},
                       index=pd.bdate_range('2025-06-02', periods=len(cc)))
    cap = {}
    _orig_lines = globals()['_sr_lines']

    def _spy(*a, **k):                                 # 包住 _sr_lines，看挑之前的全部線
        r_ = _orig_lines(*a, **k)
        cap['lines'] = r_[3]
        return r_
    globals()['_sr_lines'] = _spy
    try:
        ss, _ = compute_signals(dfs, 'us')
    finally:
        globals()['_sr_lines'] = _orig_lines
    sr = ss['sr_levels']
    all_lines = cap.get('lines') or []
    r12 = [x for x in all_lines if x['kind'] == 'resistance' and abs(x['price'] - 12.0) <= sr['tol']]
    ok(bool(r12) and r12[0]['touches'] >= 3 and r12[0]['dist_pct'] > 0 and any(s_.startswith('觸及') for s_ in r12[0]['sources']),
       'sr：12.0 附近有觸及 ≥3 的壓力候選線（得 %s）' % [(x['price'], x['touches'], x['sources']) for x in all_lines])
    okp = len(sr['support']) <= 1 and len(sr['resistance']) <= 1
    for kind_ in ('support', 'resistance'):
        side_ = [x for x in all_lines if x['kind'] == kind_]
        out_ = sr[kind_]
        if side_:
            in10 = [x for x in side_ if abs(x['dist_pct']) <= SR_NEAR_PCT]
            pool_, scope_ = (in10, 'within10') if in10 else (side_, 'beyond')
            mx = max(x['strength'] for x in pool_)
            near_ = min(x['_d'] for x in pool_ if x['strength'] == mx)
            okp = okp and len(out_) == 1 and out_[0]['strength'] == mx and out_[0]['strongest'] is True \
                and out_[0]['pick_scope'] == scope_ \
                and any(x['price'] == out_[0]['price'] and x['_d'] == near_ for x in pool_)
        else:
            okp = okp and out_ == []
    bt = sr['badge']
    okp = okp and (bt['res'] or {}).get('price') == (sr['resistance'][0]['price'] if sr['resistance'] else None) \
        and (bt['sup'] or {}).get('price') == (sr['support'][0]['price'] if sr['support'] else None)
    ok(okp, 'sr：每側只輸出一條＝±10%% 內最強（無則範圍外最強；同分取近）；badge 用這兩條（得 壓 %s 撐 %s；全部 %s）' % (
        [(x['price'], x['strength'], x['pick_scope']) for x in sr['resistance']],
        [(x['price'], x['strength'], x['pick_scope']) for x in sr['support']],
        [(x['kind'][0], x['price'], x['strength'], x['dist_pct']) for x in all_lines]))

    def _fl(kind, price, strength, C=100.0):          # 合成線：今收 C，dist_pct／_d 照 _sr_lines 的算法
        return {'kind': kind, 'price': price, 'strength': strength, 'dist_pct': _pct(price, C), '_d': abs(price - C)}
    # 合成 within10：±10% 內有線 → 範圍外再強也不選；±10% 內同分取近；邊界 ±10.00% 算在內
    fw = [_fl('support', 97.0, 4.0), _fl('support', 93.0, 6.0), _fl('support', 94.0, 6.0),   # 94／93 同分 6.0 → 取近的 94
          _fl('support', 80.0, 12.0),                                                        # −20%，強度最高但在範圍外
          _fl('resistance', 110.0, 2.0), _fl('resistance', 130.0, 9.0)]                     # +10.00% 邊界算內 → 110
    ps, pr = _sr_pick(fw, 'support'), _sr_pick(fw, 'resistance')
    ok([(x['price'], x['pick_scope']) for x in ps] == [(94.0, 'within10')]
       and [(x['price'], x['pick_scope']) for x in pr] == [(110.0, 'within10')]
       and '_d' not in ps[0] and ps[0]['strongest'] is True,
       '_sr_pick within10：±10%% 內最強（撐 94 勝範圍外 12.0 的 80、同分勝 93；壓 +10.00%% 邊界的 110 勝 +30%% 的 130）（得 撐 %s 壓 %s）'
       % ([(x['price'], x['pick_scope']) for x in ps], [(x['price'], x['pick_scope']) for x in pr]))
    # 合成 beyond：該側 ±10% 內一條都沒有 → 取範圍外最強（同分取近）；另一側有近線照樣 within10；沒線回 []
    fb = [_fl('resistance', 115.0, 3.0), _fl('resistance', 125.0, 7.0), _fl('resistance', 121.0, 7.0),  # 121／125 同分 → 121
          _fl('support', 89.99, 20.0), _fl('support', 95.0, 1.0)]                                     # −10.01% 算外 → 95
    pb, ps2 = _sr_pick(fb, 'resistance'), _sr_pick(fb, 'support')
    ok([(x['price'], x['pick_scope']) for x in pb] == [(121.0, 'beyond')]
       and [(x['price'], x['pick_scope']) for x in ps2] == [(95.0, 'within10')]
       and _sr_pick([], 'support') == [] and _sr_pick(fb[:3], 'support') == [],
       '_sr_pick beyond：壓力 ±10%% 內沒線 → 取範圍外最強 121（同分勝 125）；撐 −10.01%% 的 89.99 不算內 → 95；沒線回 []（得 壓 %s 撐 %s）'
       % ([(x['price'], x['pick_scope']) for x in pb], [(x['price'], x['pick_scope']) for x in ps2]))
    okt = True
    if r12:
        P, tol = r12[0]['price'], sr['tol']
        dmap = {_d(t): i for i, t in enumerate(dfs.index)}
        for dd in r12[0]['touch_dates']:
            i = dmap[dd]
            H_, L_, C_ = dfs['h'].iloc[i], dfs['l'].iloc[i], dfs['c'].iloc[i]
            near_h = P - tol <= H_ <= P + tol
            near_l = P - tol <= L_ <= P + tol
            okt = okt and (near_h or near_l)
        okt = okt and len(r12[0]['touch_dates']) == r12[0]['touches']
    ok(okt, 'sr：每個 touch_date 的高或低都落在 [P−tol, P+tol]，touches＝touch_dates 天數')
    ok(all(x['kind'] == 'support' and x['price'] < 10.4 + 0.25 * sr['tol'] for x in sr['support'])
       and all(x['kind'] == 'resistance' for x in sr['resistance']),
       'sr：支撐在下、壓力在上')
    allp = sorted(x['price'] for x in all_lines)
    ok(all(b - a > sr['tol'] - 0.01 for a, b in zip(allp, allp[1:])),
       'sr：合併後的全部線彼此差 > tol（得 %s，tol %s）' % (allp, sr['tol']))

    # ⑤ 缺口分類＋大量K解讀：合成案例（每種至少一例；向下缺口用價格鏡像 K−p 驗證鏡像名稱）
    class _K:
        """合成 K 線：add(收, 開=前收, 高=實體上緣+w, 低=實體下緣−w, 量=100)，價格一律 2 位小數。"""
        def __init__(self, c0, w=0.3):
            self.rows, self.w, self.last = [], w, c0

        def add(self, c, o=None, h=None, l=None, v=100.0):
            o = self.last if o is None else o
            h = max(o, c) + self.w if h is None else h
            l = min(o, c) - self.w if l is None else l
            self.rows.append([round(o, 2), round(h, 2), round(l, 2), round(c, 2), float(v)])
            self.last = c
            return self.rows[-1]

        def gap_up(self, d_lo, d_o, d_c, d_h, v=100.0):         # 以前一根最高為基準往上跳
            p = self.rows[-1][1]
            return self.add(p + d_c, o=p + d_o, h=p + d_h, l=p + d_lo, v=v)

        def gap_dn(self, d_hi, d_o, d_c, d_l, v=100.0):         # 以前一根最低為基準往下跳
            p = self.rows[-1][2]
            return self.add(p - d_c, o=p - d_o, h=p - d_hi, l=p - d_l, v=v)

        def df(self):
            a = np.array(self.rows)
            return pd.DataFrame({'o': a[:, 0], 'h': a[:, 1], 'l': a[:, 2], 'c': a[:, 3], 'v': a[:, 4]},
                                index=pd.bdate_range('2025-01-01', periods=len(a)))

    def _mir(df_, K):
        return pd.DataFrame({'o': (K - df_['o']).round(2), 'h': (K - df_['l']).round(2), 'l': (K - df_['h']).round(2),
                             'c': (K - df_['c']).round(2), 'v': df_['v']}, index=df_.index)

    def _gaps(df_):
        s_, _ = compute_signals(df_, 'us')
        return s_, sorted(s_['gaps']['items'], key=lambda x: x['date'])

    def _desc(gs):
        return [(x['date'][5:], x['dir'], x['trend'], x['position'], x['seq'], x['vol_class'], x['type'], x['type_short'],
                 x['notes']) for x in gs]
    # (a) 反彈：150 根一路跌（空頭、跌深），向上跳空但量一般（1.2 倍，不符突破的「帶量以上」）→ 反彈缺口；
    #     大量K（這根量最大、跌深 LOW）＝跌深後大量紅K·可能轉強（09-27 起先於空頭反彈）；鏡像 → 回檔缺口
    def _bear(v_gap):
        k = _K(150)
        for c_ in np.linspace(150, 100, 150):
            k.add(c_)
        k.gap_up(0.8, 1.0, 1.5, 1.7, v=v_gap)
        for d_ in (0.1, -0.1, 0.1):
            k.add(k.last + d_)
        return k
    ka = _bear(120)
    da = ka.df()
    s_, gs = _gaps(da)
    ok(len(gs) == 1 and gs[0]['trend'] == TREND_BEAR and gs[0]['position'] == 'LOW' and gs[0]['seq'] == 1
       and gs[0]['vol_class'] == '一般' and gs[0]['type'] == '反彈缺口' and gs[0]['type_short'] == '彈'
       and s_['top_volume']['items'][0]['trend'] == TREND_BEAR and s_['top_volume']['items'][0]['position'] == 'LOW'
       and s_['top_volume']['items'][0]['read'] == READ_TURN and s_['badges']['gap_type'] == '彈',
       '⑤ 反彈：空頭中跌深後第一個向上缺口但量一般（不符突破）＝反彈缺口［彈］；'
       '空頭趨勢裡跌深後的大量紅K＝可能轉強、不是空頭反彈（得 %s／%s）'
       % (_desc(gs), s_['top_volume']['items'][0]['read']))
    s_, gs = _gaps(_mir(da, 400))
    ok(len(gs) == 1 and gs[0]['dir'] == 'down' and gs[0]['trend'] == TREND_BULL and gs[0]['type'] == '回檔缺口'
       and gs[0]['type_short'] == '回', '⑤ 鏡像：多頭中的向下缺口（量一般）＝回檔缺口［回］（得 %s）' % _desc(gs))
    t_ = s_['top_volume']['items'][0]
    ok(t_['candle'] in ('長黑', '黑K') and t_['position'] == 'HIGH' and t_['read'] == READ_DUMP,
       '⑤ 鏡像大量K：離 60 日低 ≥6 ATR（向上定義已是高檔）的大量黑K 仍判出貨疑慮，排在可能轉弱前面（得 %s %s %s）'
       % (t_['candle'], t_['position'], t_['read']))
    # (a2) 反彈（不是第一個）：接著再一個爆量向上缺口——跌深後已經有過向上缺口 → 位置不是低檔起漲 → 仍是反彈
    ka.gap_up(0.8, 1.0, 1.5, 1.7, v=500)
    ka.add(ka.last + 0.1)
    s_, gs = _gaps(ka.df())
    x_ = gs[-1] if gs else {}
    ok(len(gs) == 2 and x_['trend'] == TREND_BEAR and x_['vol_class'] == '爆量' and x_['position'] != 'LOW'
       and x_['basis']['first_since'] is False and x_['type'] == '反彈缺口',
       '⑤ 反彈：空頭中跌深後第二個向上缺口，就算爆量也不是突破＝反彈缺口（得 %s）' % _desc(gs))
    # (a3) 突破優先於反彈：同一段空頭、跌深後第一個向上缺口帶量以上（5 倍＝爆量）→ 突破缺口（不再被趨勢先判成反彈）；
    #      鏡像：多頭中漲多後第一個爆量向下缺口 → 跌破缺口
    db3 = _bear(500).df()
    s_, gs = _gaps(db3)
    ok(len(gs) == 1 and gs[0]['trend'] == TREND_BEAR and gs[0]['position'] == 'LOW' and gs[0]['seq'] == 1
       and gs[0]['vol_class'] == '爆量' and gs[0]['basis']['first_since'] is True
       and gs[0]['type'] == '突破缺口' and gs[0]['type_short'] == '突' and s_['badges']['gap_type'] == '突',
       '⑤ 突破優先：空頭趨勢中跌深後第一個帶量向上缺口＝突破缺口［突］，不是反彈（得 %s）' % _desc(gs))
    s_, gs = _gaps(_mir(db3, 400))
    ok(len(gs) == 1 and gs[0]['dir'] == 'down' and gs[0]['trend'] == TREND_BULL and gs[0]['position_zh'] == '高檔起跌'
       and gs[0]['type'] == '跌破缺口' and gs[0]['type_short'] == '破',
       '⑤ 鏡像：多頭趨勢中漲多後第一個帶量向下缺口＝跌破缺口［破］，不是回檔（得 %s）' % _desc(gs))
    # (b) 突破＋缺口守住：60 根前 88 → 急拉 121 → 跌回 89.6（60 日最低、距高 ≥5ATR、SMA60 斜率仍 >0＝盤整）→ 第一個向上缺口帶量
    k = _K(88)
    for j_ in range(80):
        k.add(88 + (0.1 if j_ % 2 else -0.1))
    k.add(88)
    for c_ in np.linspace(91, 121, 12):
        k.add(c_)
    for c_ in np.linspace(120, 90.5, 45):
        k.add(c_)
    for c_ in (89.6, 90.2, 90.6):
        k.add(c_)
    g_ = k.gap_up(0.6, 0.8, 1.6, 1.8, v=180)
    for d_ in (0.3, 0.5, 0.4):
        k.add(g_[3] + d_)
    db = k.df()
    s_, gs = _gaps(db)
    x_ = gs[-1] if gs else {}
    ok(len(gs) == 1 and x_['trend'] == TREND_FLAT and x_['position'] == 'LOW' and x_['position_zh'] == '低檔起漲'
       and x_['seq'] == 1 and x_['vol_class'] == '帶量' and x_['type'] == '突破缺口' and x_['type_short'] == '突'
       and x_['basis']['first_since'] is True and x_['basis']['drop_atr'] >= ATR_DEEP,
       '⑤ 突破：跌深（距 60 日高 ≥5ATR）後第一個向上缺口、seq 1、帶量＝突破缺口［突］（得 %s）' % _desc(gs))
    ok(x_.get('notes') == [NOTE_HOLD['up']] and s_['top_volume']['items'][0]['read'] == READ_TURN,
       '⑤ 缺口守住：突破後未回補、之後收盤都在上緣之上；大量K＝跌深後大量紅K（得 %s／%s）'
       % (x_.get('notes'), s_['top_volume']['items'][0]['read']))
    k.add(g_[2] + 0.1, o=k.last, h=k.last + 0.2, l=g_[2] - 0.2)          # 收盤掉進缺口 → 不再是守住
    s_, gs = _gaps(k.df())
    ok(gs[-1]['type'] == '突破缺口' and gs[-1]['fill'] == 'partial' and gs[-1]['notes'] == [],
       '⑤ 缺口守住（反例）：之後有 K 進入缺口 → 沒有守住備註（得 %s）' % _desc(gs))
    s_, gs = _gaps(_mir(db, 300))
    ok(len(gs) == 1 and gs[0]['type'] == '跌破缺口' and gs[0]['type_short'] == '破' and gs[0]['position_zh'] == '高檔起跌'
       and gs[0]['notes'] == [NOTE_HOLD['down']], '⑤ 鏡像：跌破缺口［破］＋缺口壓住（得 %s）' % _desc(gs))
    # (c) 竭盡＋回補確認：一路收高、分形低點後連三個向上缺口，第三個爆量 → 之後大量黑K 回補進缺口
    k = _K(60)
    for j_ in range(90):
        k.add(60 + 0.5 * (j_ + 1))
    k.add(k.last - 1.2)
    k.add(k.last - 1.0)
    for j_ in range(4):
        k.add(k.last + 0.8)
    for vv in (100, 110, 320):
        g3 = k.gap_up(0.5, 0.6, 1.4, 1.6, v=vv)
        for j_ in range(2):
            k.add(k.last + 0.6)
    p_ = k.rows[-1]
    k.add(g3[2] + 0.2, o=p_[3] + 0.3, h=p_[3] + 0.5, l=g3[2] - 0.3, v=600)
    k.add(k.last + 0.1)
    dc = k.df()
    s_, gs = _gaps(dc)
    ok([x['seq'] for x in gs] == [1, 2, 3] and [x['type'] for x in gs] == ['一般缺口', '一般缺口', '竭盡缺口']
       and gs[2]['position'] == 'HIGH' and gs[2]['vol_class'] == '爆量' and gs[2]['fill'] == 'partial'
       and gs[2]['notes'] == [NOTE_EXHAUST] and s_['badges']['gap_type'] == '竭✓',
       '⑤ 竭盡：高檔、第 3 個、爆量＝竭盡缺口，之後回補 → 竭盡確認、badge 竭✓（得 %s）' % _desc(gs))
    ok(s_['top_volume']['items'][0]['read'] == READ_DUMP and s_['top_volume']['items'][1]['read'] == READ_NEUTRAL,
       '⑤ 大量K：高檔大量黑K＝出貨疑慮；高檔大量紅K 但上方沒壓力＝中性（得 %s）'
       % [t['read'] for t in s_['top_volume']['items'][:2]])
    s_, gs = _gaps(_mir(dc, 300))
    ok([x['type'] for x in gs] == ['一般缺口', '一般缺口', '下跌竭盡缺口'] and gs[2]['type_short'] == '竭'
       and gs[2]['position_zh'] == '低檔' and gs[2]['notes'] == [NOTE_EXHAUST],
       '⑤ 鏡像：下跌竭盡缺口［竭］＋竭盡確認（得 %s）' % _desc(gs))
    # (d) 逃逸：緩漲鋸齒（連漲 <5、距 60 日低 <6ATR＝中段、多頭），缺口當天上方 10% 內沒有當時的壓力；
    #     之後才出現的大量K 高點（+5%）不准回頭影響（不用未來資料）
    k = _K(100, w=0.5)
    for j_ in range(140):
        k.add(k.last + (1.0 if j_ % 2 == 0 else -0.8))
    g_ = k.gap_up(0.4, 0.6, 1.2, 1.5)
    k.add(k.last + 0.3)
    k.add(k.last - 0.2, o=k.last + 0.5, h=round(g_[3] * 1.05, 2), l=k.last - 0.4, v=1000)
    s_, gs = _gaps(k.df())
    x_ = gs[-1]
    ok(x_['trend'] == TREND_BULL and x_['position'] == 'MID' and x_['type'] == '逃逸缺口' and x_['type_short'] == '逃'
       and x_['basis']['level'] is None,
       '⑤ 逃逸：多頭中段、當時上方 10%% 內無壓力＝逃逸缺口［逃］；之後的大量K 不算（得 %s，當時最近壓力 %s）'
       % (_desc(gs[-1:]), x_['basis']['level']))
    # (e) 一般：平盤（SMA60 斜率 0＝盤整）小跳空、量一般
    k = _K(100, w=0.2)
    for j_ in range(140):
        k.add(100 + (0.1 if j_ % 2 else -0.1))
    k.gap_up(0.1, 0.2, 0.3, 0.4)
    k.add(k.last - 0.05)
    s_, gs = _gaps(k.df())
    ok(len(gs) == 1 and gs[0]['trend'] == TREND_FLAT and gs[0]['type'] == '一般缺口' and gs[0]['type_short'] == '一'
       and gs[0]['notes'] == [], '⑤ 一般：盤整中段的小缺口＝一般缺口［一］（得 %s）' % _desc(gs))
    # (f) 追高警示：先有大量K 高點 110 → 回落 → 連漲 6 天（高檔）→ 跳空收 106.9，距 110 +2.9%（≤3%）
    k = _K(100)
    for j_ in range(100):
        k.add(100 + (0.1 if j_ % 2 else -0.1))
    k.add(104, o=100, h=110, l=99.7, v=1000)
    for c_ in np.linspace(103, 96, 8):
        k.add(c_)
    for c_ in (97, 98.2, 99.4, 100.6, 101.8, 103):
        k.add(c_)
    k.gap_up(0.8, 1.0, 3.6, 3.9)
    k.add(k.last + 0.1)
    s_, gs = _gaps(k.df())
    x_ = gs[-1]
    ok(x_['position'] == 'HIGH' and x_['basis']['run_days'] >= UP_DAYS_HIGH and x_['basis']['level'] == 110.0
       and x_['basis']['level_pct'] <= CHASE_PCT and len(x_['notes']) == 1 and x_['notes'][0].startswith('追高警示'),
       '⑤ 追高警示：高檔（連漲 %s 天）且距當時最近壓力 %s（%s%%）≤3%%（得 %s）'
       % (x_['basis']['run_days'], x_['basis']['level'], x_['basis']['level_pct'], x_['notes']))
    # (g) 頂部島：向上缺口 A → 3 根懸空 → 向下缺口 B；鏡像 → 底部島
    k = _K(100)
    for j_ in range(120):
        k.add(100 + 0.05 * j_ + (0.1 if j_ % 2 else -0.1))
    k.gap_up(0.8, 1.0, 1.5, 1.8)
    k.add(k.last + 0.2)
    k.add(k.last - 0.1)
    k.gap_dn(0.8, 1.0, 1.5, 1.8)
    k.add(k.last - 0.2)
    dg = k.df()
    s_, gs = _gaps(dg)
    il = s_['gaps']['islands']
    ok(len(il) == 1 and il[0]['kind'] == 'top' and il[0]['bars'] == 3 and il[0]['a_gap'] == gs[0]['date']
       and il[0]['b_gap'] == gs[1]['date'] and il[0]['low'] > il[0]['edge']
       and all(x['island'] and x['island_kind'] == 'top' and x['type_short'] == ISLAND_SHORT for x in gs)
       and gs[0]['type'] != '島' and s_['badges']['gap_type'] == '島',
       '⑤ 頂部島：A 上缺、3 根懸空、B 下缺 → islands 1 筆、兩缺口 type_short＝島、type 保留原分類（得 %s；%s）'
       % (il, _desc(gs)))
    s_, gs = _gaps(_mir(dg, 300))
    il = s_['gaps']['islands']
    ok(len(il) == 1 and il[0]['kind'] == 'bottom' and il[0]['name'] == '底部島狀反轉' and il[0]['high'] < il[0]['edge']
       and all(x['island'] and x['type_short'] == ISLAND_SHORT for x in gs),
       '⑤ 底部島（鏡像）：islands 1 筆 bottom、島內最高 < 兩缺口外緣（得 %s）' % il)
    k2 = _K(100)
    k2.rows = [r_[:] for r_ in k.rows[:-3]]
    k2.last = k2.rows[-1][3]
    k2.add(k2.last - 0.5, l=k.rows[-6][1] - 0.1)                       # 島內有一根跌回 A 前一根高點之下 → 不懸空
    k2.gap_dn(0.8, 1.0, 1.5, 1.8)
    s_, gs = _gaps(k2.df())
    ok(s_['gaps']['islands'] == [] and not any(x['island'] for x in gs),
       '⑤ 島（反例）：島內有 K 碰回 A 缺口外緣 → 不算島（得 %s）' % s_['gaps']['islands'])
    # (h) 大量K：跌深轉強優先於空頭反彈（與缺口「突破優先於反彈」同一原則）＋鏡像。鋸齒緩跌 150 根（空頭）後一根爆量小紅K；
    #     dn 大 → 距 60 日高 5～6 ATR（LOW）；dn 小 → 距高 <5 ATR（MID）。鏡像 K−p：紅變黑、空頭變多頭、距高變距低。
    def _zig(dn):
        k = _K(130)
        for j_ in range(150):
            k.add(k.last + (0.9 if j_ % 2 == 0 else -(0.9 + dn)))
        k.add(k.last + 0.3, o=k.last - 0.2, v=500)
        for d_ in (0.1, -0.1):
            k.add(k.last + d_)
        return k.df()

    def _tv0(df_):
        t = compute_signals(df_, 'us')[0]['top_volume']['items'][0]
        return t, (t['candle'], t['trend'], t['position'], t['basis']['rise_atr'], t['basis']['drop_atr'], t['read'])
    dh = _zig(0.25)
    t_, dsc = _tv0(dh)
    ok(t_['candle'] in ('長紅', '紅K') and t_['trend'] == TREND_BEAR and t_['position'] == 'LOW'
       and ATR_DEEP <= t_['basis']['drop_atr'] < ATR_HIGH and t_['read'] == READ_TURN,
       '⑤ 大量K 跌深轉強優先：空頭趨勢裡跌深（距 60 日高 5～6 ATR）後的大量紅K＝可能轉強，不是空頭反彈（得 %s）' % (dsc,))
    t_, dsc = _tv0(_mir(dh, 300))
    ok(t_['candle'] in ('長黑', '黑K') and t_['trend'] == TREND_BULL and t_['position'] == 'MID'
       and ATR_DEEP <= t_['basis']['rise_atr'] < ATR_HIGH and t_['read'] == READ_TURN_DN,
       '⑤ 鏡像：多頭趨勢裡漲多（高檔起跌：距 60 日低 5～6 ATR）後的大量黑K＝可能轉弱，不是先看支撐（得 %s）' % (dsc,))
    dh = _zig(0.15)
    t_, dsc = _tv0(dh)
    ok(t_['candle'] in ('長紅', '紅K') and t_['trend'] == TREND_BEAR and t_['position'] == 'MID'
       and t_['basis']['drop_atr'] < ATR_DEEP and t_['read'] == READ_REBOUND,
       '⑤ 大量K（對照）：空頭裡沒跌深（距 60 日高 <5 ATR）的大量紅K＝空頭反彈（得 %s）' % (dsc,))
    t_, dsc = _tv0(_mir(dh, 300))
    ok(t_['candle'] in ('長黑', '黑K') and t_['trend'] == TREND_BULL and t_['position'] == 'MID'
       and t_['basis']['rise_atr'] < ATR_DEEP and t_['read'] == READ_BULL_BLACK,
       '⑤ 鏡像（對照）：多頭中段、沒漲多（距 60 日低 <5 ATR）的大量黑K＝先看支撐（得 %s）' % (dsc,))
    print('selftest：%s（%d 項失敗）' % ('全過' if not fails else '有失敗', len(fails)))
    return not fails


def main(argv):
    if '--selftest' in argv:
        sys.exit(0 if selftest() else 1)
    asof = None
    if '--asof' in argv:
        asof = argv[argv.index('--asof') + 1]
    syms = [a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or argv[i - 1] != '--asof')]
    if not syms:
        print(__doc__.split('───')[0])
        sys.exit(2)
    live = '--offline' not in argv
    legacy = '--legacy' in argv
    res = []
    for s in syms:
        try:
            d = analyze(s, asof=asof, live=live, refresh='--refresh' in argv, legacy=legacy)
        except Exception as e:
            d = {'symbol': s, 'error': '%s: %s' % (type(e).__name__, e)}
        if '--compact' in argv and 'chart' in d:
            d.pop('chart')
        res.append(d)
    if '--summary' in argv:
        for d in res:
            print(d.get('error') and ('%s  ERROR %s' % (d['symbol'], d['error']))
                  or (summary_line_legacy(d) if legacy else summary_line(d)))
    else:
        print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main(sys.argv[1:])
