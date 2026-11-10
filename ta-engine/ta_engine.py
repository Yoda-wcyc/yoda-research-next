# -*- coding: utf-8 -*-
r"""ta_engine.py — 會員技術分析「網站版」計算引擎（Yoda 2026-11-08）

正本在 Skill\；Next repo 的 ta-engine\ 是 `--sync` 出去的副本（連 analyze_symbol.py 一起；11-09 起引擎不用 ta_trade.py），
vendor.json 記 sha256，兩邊各有檢查，副本不能偷偷漂移：
    python "G:\Yoda x Claude\Skill\ta_engine.py" --sync "G:\Yoda x Claude\_deploy\yoda-research-next\ta-engine"
    python "G:\Yoda x Claude\Skill\ta_engine.py" --check-vendor "G:\Yoda x Claude\_deploy\yoda-research-next\ta-engine"
    python ta_engine.py --selftest          # 合成資料＋mock HTTP；在副本資料夾跑還會驗 vendor.json

資料  Yahoo chart API v8（純 urllib，不用 yfinance、不讀本機 pkl）。1H＝interval=1h range=730d；日K＝interval=1d 10 年。
      4H＝1H 依「每天開盤起每 4 根」切（台股 09:00–13:00｜13:00–13:30；美股 09:30–13:30｜13:30–16:00）。
      週K＝日K 依週一～週五合併，標在該週最後一個交易日。開高低收依除息事件往前還原（同 Yahoo adjclose 口徑），量不動。
      Yahoo 1H 的「收盤那一刻」假 K（台股 13:30、美股 16:00、量 0）丟掉；美股提早收盤日 13:00 那根有價動，併進前一個整點 1H；有價動卻量 0 的 K＝缺量，當 NaN（量比／前五大量跳過）。
未定  K 棒結束時間還沒到＝盤中未定；收盤那根（日K、週K、盤中最後一段）要收盤＋15 分鐘（週K：該週五收盤＋15 分鐘）。未定那根只上圖，訊號與回測一律只用定案 K。
訊號  analyze_symbol.compute_signals（前五大量／缺口分類／撐壓）原封不動套在所選週期的 K；均線排列算三組：
      短 SMA5/10/20、中 SMA8/13/34、長 SMA20/60/120（規則同 analyze_symbol._ma_group）。「近 120 天」＝近 120 根。
進出場 11-09 起不在引擎算：回應帶 history（全部 K 的開高低收量，價格取 6 位小數；前 bars_completed 根＝定案），
      瀏覽器用 yoda-research-next/lib/ta-trade.js 依「交易規則控制面板」的參數即時回測（與 ta_trade.py 逐筆一致，
      tests/ta_trade_parity.py 驗）。引擎不再回 trade，免得兩份打架。
授權  handle() 第一步就驗 X-TA-Engine-Key＝HMAC-SHA256(TA_ENGINE_KEY, "ta-engine") 小寫 hex（引擎專用密鑰，跟會員登入用的密鑰分開）；
      不對或引擎沒設 TA_ENGINE_KEY 就 401，不碰 Yahoo。原始密鑰不上線路，只傳衍生值。
期貨  11-10：美國期貨連續月 ES／NQ／YM／RTY／GC／CL（ES1!、ES=F、/ES、小那…，special()）＋ 指數只收 ^SOX。期貨盤別＝CME 交易日
      （前一天 18:00～當天 17:00 美東；1H 23 根、4H 從 18:00 起切、日K 用 Yahoo 交易日＋結算價）。換月：用「期貨 ÷ 參考標的」價差跳動找
      （find_rolls），價格不還原，換月那根不算缺口、回應 chart.overlays.rolls 標「換月」。整段沒有量（^SOX）→ has_volume=false。
      只加欄位，舊頁面拿到新回應不會壞（docs/ta-engine-contract.md §2.1／§2.2）。
"""
import os, re, sys, json, time, hmac, hashlib, shutil, urllib.request, urllib.parse, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import numpy as np
import pandas as pd
import analyze_symbol as A

SCHEMA = 'ta-engine-3'          # 11-09：拿掉 trade／chart.ema10，加 history；11-09 晚：缺口／島狀反轉改整段、前五大量改瀏覽器依區間算
CHART_N = 120
MIN_BARS = 30
TFS = {'1H': '1h', '4H': '1h', 'D': '1d', 'W': '1d'}
MA_SETS = (('short', (5, 10, 20)), ('mid', (8, 13, 34)), ('long', (20, 60, 120)))
MA_ZH = {'short': '短', 'mid': '中', 'long': '長'}
SMA_NS = (5, 8, 10, 13, 20, 34, 60, 120)
GRACE = 15 * 60                          # 收盤後再等 15 分鐘才算定案（Yahoo 收盤價晚一點進來）
TTL_INTRA = 15 * 60
TTL_MISS = 3600
CACHE_MAX = 64
SESS = {'tw': (9 * 60, 13 * 60 + 30), 'us': (9 * 60 + 30, 16 * 60),
        'fut': (18 * 60, 17 * 60)}   # 開盤／收盤（交易所當地分鐘）；期貨＝前一天 18:00 開、當天 17:00 收（美東，CME 交易日）
FUT_SHIFT = pd.Timedelta(hours=6)        # 期貨交易日＝(時間＋6 小時) 的日期：18:00 開盤那根算隔天
HOSTS = ('query1.finance.yahoo.com', 'query2.finance.yahoo.com')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
OK_TYPES = ('EQUITY', 'ETF')             # 一般代號只收個股／ETF；期貨、費半走下面的白名單
# 期貨（Yahoo 連續月 =F）：根 → (Yahoo, 換月偵測的參考標的, 換月規則, 中文名, 交易所)
FUT = {'ES': ('ES=F', '^GSPC', 'eq', 'E-mini 標普 500 期貨', 'CME'),
       'NQ': ('NQ=F', '^NDX', 'eq', 'E-mini 那斯達克 100 期貨', 'CME'),
       'YM': ('YM=F', '^DJI', 'eq', 'E-mini 道瓊期貨', 'CBOT'),
       'RTY': ('RTY=F', '^RUT', 'eq', 'E-mini 羅素 2000 期貨', 'CME'),
       'GC': ('GC=F', 'GLD', 'gc', '黃金期貨', 'COMEX'),
       'CL': ('CL=F', 'USO', 'cl', '輕原油期貨', 'NYMEX')}
FUT_BARE = ('NQ', 'YM', 'RTY', 'GC')     # 不帶 =F／1!／斜線也當期貨（Yahoo 沒有同名股票）；純 ES＝Eversource、純 CL＝Colgate，照查股票
FUT_SOON = ('TXF', 'SXF')                # 台指期、費半期（TAIFEX）下一階段才接
SOX = {'yahoo': '^SOX', 'code': '^SOX', 'market': 'us', 'type': 'INDEX', 'name': '費城半導體指數', 'exchange': 'Nasdaq'}
ALIAS = {'小那': 'NQ1!', '小那斯達克': 'NQ1!', '那指期': 'NQ1!', '那斯達克期': 'NQ1!', '小道': 'YM1!', '小道瓊': 'YM1!', '道瓊期': 'YM1!',
         '小標普': 'ES1!', '標普期': 'ES1!', '小羅素': 'RTY1!', '羅素期': 'RTY1!', '黃金期': 'GC1!', '原油期': 'CL1!', '輕原油': 'CL1!',
         'SOX': '^SOX', '費半': '^SOX', '費城半導體': '^SOX', '台指期': 'TXF1!', '小台': 'TXF1!', '費半期': 'SXF1!'}
FUT_IN = re.compile(r'^(/)?([A-Z]{2,3})(=F|1!)?$')
ROLL_LABEL = '換月'
TW_IN = re.compile(r'^(\d{4,6}[A-Z]?)(\.TWO?)?$')
US_IN = re.compile(r'^[A-Z][A-Z0-9]{0,5}([.\-][A-Z]{1,2})?$')
REN = {'o': 'Open', 'h': 'High', 'l': 'Low', 'c': 'Close', 'v': 'Volume'}
UNFINISHED = '盤中未定'
KEY_ENV = 'TA_ENGINE_KEY'
VENDOR = ('analyze_symbol.py', 'ta_engine.py')
GAP_COLS = ('i', 'dir', 'bottom', 'top', 'fill', 'fill_i', 'open_bottom', 'open_top', 'type', 'type_short', 'island',
            'trend', 'position_zh', 'seq', 'vol_ratio', 'size_pct', 'dist_pct', 'notes')   # overlays.gaps 精簡格式的欄位
GAP_ENUMS = ('dir', 'fill', 'type', 'type_short', 'trend', 'position_zh')
HIST_ND = 6                              # history 價格小數位（瀏覽器回測用；tests/ta_engine_check.py --regress 驗跟原始精度交易一致）
LEGEND = [
    {'key': 'support', 'label': '支撐', 'desc': '白色實線：今收下方最強的一條（±10% 內優先）'},
    {'key': 'resistance', 'label': '壓力', 'desc': '白色虛線：今收上方最強的一條（±10% 內優先）'},
    {'key': 'top_volume', 'label': '前五大量', 'desc': '目前可見區間（只算定案 K）量最大的 5 根，金框＋①～⑤；高低點是撐壓候選'},
    {'key': 'gap', 'label': '缺口', 'desc': '方框＝還沒補的缺口區間（部分回補只畫剩下那段）；補滿的畫到回補那根'},
    {'key': 'unfinished', 'label': UNFINISHED, 'desc': '最後一根還在交易中，只上圖，不進訊號與回測'},
]
LEGEND_ROLL = {'key': 'roll', 'label': ROLL_LABEL,
               'desc': '灰色細虛線：期貨連續月換到下一個合約的那根（價格沒有還原）；那根的跳空不算缺口、不進撐壓、不算島狀反轉'}


class EngineError(Exception):
    def __init__(self, status, code, msg):
        Exception.__init__(self, msg)
        self.status, self.code, self.msg = status, code, msg


# ═════════════════════════ 授權 ═════════════════════════

def engine_key(secret):
    return hmac.new(secret.encode('utf-8'), b'ta-engine', hashlib.sha256).hexdigest()


def check_key(key, secret):
    return bool(secret) and bool(key) and hmac.compare_digest(str(key), engine_key(secret))


# ═════════════════════════ Yahoo ═════════════════════════

def _http_get(url, timeout=12):
    """回 (status, dict|None)；連不上回 (None, None)。"""
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8'))
        except Exception:
            return e.code, None
    except Exception:
        return None, None


def yahoo_chart(ysym, interval, now, http=_http_get):
    """回 chart.result[0]；代號不存在回 None；Yahoo 掛了 raise 502。"""
    q = {'interval': interval, 'includePrePost': 'false', 'events': 'div|split'}
    q['range'] = '730d' if interval == '1h' else '10y'   # 1h：Yahoo 上限 730d（用 range 拿到的比 period1/period2 多）
    qs = urllib.parse.urlencode(q)
    last = None
    for h in HOSTS:
        st, body = http('https://%s/v8/finance/chart/%s?%s' % (h, urllib.parse.quote(ysym), qs))
        ch = (body or {}).get('chart') or {}
        if st == 200 and ch.get('result'):
            return ch['result'][0]
        if st == 404 or (st == 200 and (ch.get('error') or {}).get('code') == 'Not Found'):
            return None
        last = st
    raise EngineError(502, 'upstream', 'Yahoo 暫時沒有回應（%s），請稍後再試' % last)


_CACHE = {}


def _fresh(entry, interval, now):
    t, res = entry
    if res is None:
        return now - t < TTL_MISS
    if now - t < TTL_INTRA:
        return True
    if interval == '1d':
        m = res.get('meta') or {}
        end = ((m.get('currentTradingPeriod') or {}).get('regular') or {}).get('end')
        # shortcut: 收盤後抓的日K沿用到收盤後 17 小時（台股、美股隔天開盤前；期貨 17:00 收、18:00 就開，只沿用到收盤後 1 小時），
        # 之後退回 15 分鐘；週末會多抓幾次，要省再接交易日曆
        hold = 3600 if m.get('instrumentType') == 'FUTURE' else 17 * 3600
        return bool(end) and t >= end + GRACE and now < end + hold
    return False


def cached_chart(ysym, interval, now, http=_http_get):
    """同代號＋週期：1H 15 分鐘內、日K 到下個交易時段前不重抓。只在本行程記憶體（不對外）。回 (res, cached, fetched_at)。"""
    k = (ysym, interval)
    e = _CACHE.get(k)
    if e and _fresh(e, interval, now):
        return e[1], True, e[0]
    res = yahoo_chart(ysym, interval, now, http)
    _CACHE[k] = (now, res)
    while len(_CACHE) > CACHE_MAX:
        _CACHE.pop(min(_CACHE, key=lambda x: _CACHE[x][0]))
    return res, False, now


def candidates(raw):
    """回 (Yahoo 代號候選, market, 顯示代號)。台股數字代號先 .TW 再 .TWO；字母＝美股；指數（^）與怪格式擋掉。"""
    s = (raw or '').strip().upper()
    m = TW_IN.match(s)
    if m:
        code, suf = m.group(1), m.group(2)
        return ([code + suf] if suf else [code + '.TW', code + '.TWO']), 'tw', code
    if s.startswith('^') or not US_IN.match(s):
        raise EngineError(400, 'bad_symbol', '代號格式不對：台股填數字代號（如 2330、00878），美股填英文代號（如 NVDA），'
                                             '期貨填 ES1!、NQ1!、YM1!、RTY1!、GC1!、CL1!；指數只收 ^SOX（費半）')
    return [s.replace('.', '-')], 'us', s


def special(raw):
    """期貨與費半（白名單）→ dict(yahoo, code, market, type, name, exchange[, root, ref, kind])；一般代號回 None（走 candidates）。
    收 ES=F／ES1!／/ES、純 NQ／YM／RTY／GC、中文別名（ALIAS）；台指期／費半期（TXF、SXF）先回「整合中」。"""
    s = (raw or '').strip().upper().replace(' ', '')
    s = ALIAS.get(s, s)
    if s == '^SOX':
        return dict(SOX)
    m = FUT_IN.match(s)
    if not m:
        return None
    root, marked = m.group(2), bool(m.group(1) or m.group(3))
    if root in FUT_SOON and (marked or s == root):
        raise EngineError(422, 'coming_soon', '台指期／費半期資料整合中')
    if root not in FUT or not (marked or root in FUT_BARE):
        return None
    y, ref, kind, name, ex = FUT[root]
    return {'yahoo': y, 'code': root + '1!', 'market': 'fut', 'type': 'FUTURE', 'name': name, 'exchange': ex,
            'root': root, 'ref': ref, 'kind': kind}


def _local(epoch, tz):
    return pd.Timestamp(epoch, unit='s', tz='UTC').tz_convert(tz).tz_localize(None)


def frame(res, interval):
    """chart.result → DataFrame o/h/l/c/v（index＝交易所當地時間、tz-naive；日K 正規化到日期），已除息還原。"""
    m = res.get('meta') or {}
    tz = m.get('exchangeTimezoneName') or 'UTC'
    ts = res.get('timestamp') or []
    cols = ['o', 'h', 'l', 'c', 'v']
    if not ts:
        return pd.DataFrame(columns=cols, dtype='float64')
    q = ((res.get('indicators') or {}).get('quote') or [{}])[0]
    idx = pd.to_datetime(np.asarray(ts, dtype='int64'), unit='s', utc=True).tz_convert(tz).tz_localize(None)
    df = pd.DataFrame({k: np.array(q.get(src) or [None] * len(ts), dtype='float64')
                       for k, src in zip(cols, ('open', 'high', 'low', 'close', 'volume'))}, index=idx)
    df = df.dropna(subset=['o', 'h', 'l', 'c'])
    if interval == '1d':
        df.index = df.index.normalize()
    df = df[~df.index.duplicated(keep='last')].sort_index()
    return div_adjust(df, (res.get('events') or {}).get('dividends'), tz)


def div_adjust(df, divs, tz):
    """除息往前還原：除息日之前的開高低收 ×(1 − 息 ÷ 除息前一根收盤)，多次相乘；量不動（＝Yahoo adjclose 口徑）。"""
    if not divs or df.empty:
        return df
    days = df.index.normalize().values
    f = np.ones(len(df))
    for ev in divs.values():
        amt, t = ev.get('amount'), ev.get('date')
        if not amt or not t:
            continue
        k = int(np.searchsorted(days, _local(t, tz).normalize().to_datetime64(), 'left'))   # 第一根 ≥ 除息日
        if 0 < k < len(df):
            pc = float(df['c'].iat[k - 1])
            if pc > amt:
                f[:k] *= 1 - amt / pc
    df = df.copy()
    for k in ('o', 'h', 'l', 'c'):
        df[k] = df[k].to_numpy() * f
    return df


# ═════════════════════════ 1H／4H／日／週 ═════════════════════════

def _tod(idx):
    return idx.hour * 60 + idx.minute


def _tday(idx):
    """期貨交易日（00:00）：前一天 18:00 起到當天 17:00。"""
    return (idx + FUT_SHIFT).normalize()


def _merge(df, key):
    g = df.groupby(key)
    return pd.DataFrame({'o': g['o'].first(), 'h': g['h'].max(), 'l': g['l'].min(), 'c': g['c'].last(), 'v': g['v'].sum(min_count=1)})


def _fut_1h(df):
    """期貨 1H（18:00～隔天 16:00 共 23 根整點 K）：丟 17:00 那根雜訊 K（休市時段）、丟沒對齊整點又沒價動的即時跳動點；
    提早收盤日對齊 :30 的 K 併進所在的整點；有價動卻量 0（18:00 開盤那根常見）＝缺量 → NaN。結束＝下一個整點，最晚交易日 17:00。"""
    t = _tod(df.index)
    moved = (df['h'] > df['l']) | (df['o'] != df['c'])
    on_hour = (df.index.minute == 0) & (df.index.second == 0)
    df = df[((t < 17 * 60) | (t >= 18 * 60)) & (on_hour | moved)].copy()
    df.loc[(df['v'] == 0) & ((df['h'] > df['l']) | (df['o'] != df['c'])), 'v'] = np.nan
    if not ((df.index.minute == 0) & (df.index.second == 0)).all():
        df = _merge(df, df.index.floor('h'))
    end = np.minimum(df.index + pd.Timedelta(hours=1), _tday(df.index) + pd.Timedelta(hours=17))
    return df, pd.DatetimeIndex(end)


def _fut_4h_key(idx):
    """期貨 4H 從 18:00 起切：18、22、02、06、10、14（14:00～17:00 那段只有 3 小時，同 TradingView）。"""
    return (idx + FUT_SHIFT).floor('4h') - FUT_SHIFT


def _fut_dvol(d1):
    """期貨日K 的量：0＝沒給、跟前一根一模一樣＝Yahoo 抄前一天（最近一個收完的交易日常見，事後才補正）→ 都當缺量 NaN。"""
    v = d1['v']
    bad = (v == 0) | (v == v.shift())
    if not bad.any():
        return d1
    d1 = d1.copy()
    d1.loc[bad, 'v'] = np.nan
    return d1


def bars_1h(df, market):
    """只留開盤起整點對齊的 1H（丟掉收盤那刻的假 K）；有價動卻量 0＝缺量 → NaN。回 (df, end)。
    盤中沒對齊整點、但有價動的 K（美股提早收盤日 13:00 那根）不丟，併進它所在那根 1H。期貨見 _fut_1h。"""
    if market == 'fut':
        return _fut_1h(df)
    o_m, c_m = SESS[market]
    t = _tod(df.index)
    moved = (df['h'] > df['l']) | (df['o'] != df['c'])
    df = df[(t >= o_m) & (t < c_m) & (((t - o_m) % 60 == 0) | moved)].copy()
    miss = (df['v'] == 0) & ((df['h'] > df['l']) | (df['o'] != df['c']))
    df.loc[miss, 'v'] = np.nan
    t = _tod(df.index)
    if ((t - o_m) % 60 != 0).any():
        key = df.index.normalize() + pd.to_timedelta(o_m + (t - o_m) // 60 * 60, unit='m')
        g = df.groupby(key)
        df = pd.DataFrame({'o': g['o'].first(), 'h': g['h'].max(), 'l': g['l'].min(), 'c': g['c'].last(),
                           'v': g['v'].sum(min_count=1)})
    day = df.index.normalize()
    end = np.minimum(df.index + pd.Timedelta(hours=1), day + pd.Timedelta(minutes=c_m))
    return df, pd.DatetimeIndex(end)


def bars_4h(h1, market):
    """1H → 4H：每個交易日從開盤起每 4 根 1H 一根（依時間切，缺根不會錯位）；標在該段開始時間。期貨見 _fut_4h_key。"""
    if market == 'fut':
        out = _merge(h1, _fut_4h_key(h1.index))
        end = np.minimum(out.index + pd.Timedelta(hours=4), _tday(out.index) + pd.Timedelta(hours=17))
        return out, pd.DatetimeIndex(end)
    o_m, c_m = SESS[market]
    day = h1.index.normalize()
    k = (_tod(h1.index) - o_m) // 240
    key = day + pd.to_timedelta(o_m + k * 240, unit='m')
    g = h1.groupby(key)
    out = pd.DataFrame({'o': g['o'].first(), 'h': g['h'].max(), 'l': g['l'].min(), 'c': g['c'].last(),
                        'v': g['v'].sum(min_count=1)})
    end = np.minimum(out.index + pd.Timedelta(minutes=240), out.index.normalize() + pd.Timedelta(minutes=c_m))
    return out, pd.DatetimeIndex(end)


def bars_d(d1, market):
    """日K：結束＝當天收盤。期貨用 Yahoo 的交易日（K 標在交易日 00:00＝前一天 18:00～當天 17:00，收盤＝結算價），結束＝當天 17:00。"""
    if market == 'fut':
        d1 = _fut_dvol(d1)
    return d1, d1.index + pd.Timedelta(minutes=SESS[market][1])


def bars_w(d1, market):
    """日K → 週K（週一～週五）；標在該週最後一個交易日；結束＝該週五收盤（週五休市也一樣，晚半天定案而已）。"""
    if market == 'fut':
        d1 = _fut_dvol(d1)
    mon = d1.index - pd.to_timedelta(d1.index.weekday, unit='D')
    g = d1.groupby(mon)
    out = pd.DataFrame({'o': g['o'].first(), 'h': g['h'].max(), 'l': g['l'].min(), 'c': g['c'].last(),
                        'v': g['v'].sum(min_count=1)})
    last = pd.Series(d1.index, index=d1.index).groupby(mon).last()
    end = out.index + pd.Timedelta(days=4, minutes=SESS[market][1])
    out.index = pd.DatetimeIndex(last.values)
    return out, pd.DatetimeIndex(end)


BUILD = {'1H': bars_1h, 'D': bars_d, 'W': bars_w}


def build(df, tf, market, now_local, data_t=None):
    """回 (bars, final)；final[i]＝該根已收完：結束時間 ≤ 現在；結束在收盤的那根（含日K、週K）要再等 GRACE。
    now_local 要傳「資料抓下來的時間」（快取的資料不會有抓之後的成交）。
    期貨盤中的 K（不是收在 17:00 那根）：Yahoo 期貨資料晚約 10 分鐘 → 要資料時間 data_t（meta.regularMarketTime）已過結束時間才定案；
    沒給 data_t 就等 GRACE；data_t 一直沒過（提早收盤日停在休市前最後一筆）就等滿 1 小時。"""
    if tf == '4H':
        h1, _ = bars_1h(df, market)
        b, end = bars_4h(h1, market)
    else:
        b, end = BUILD[tf](df, market)
    at_close = _tod(end) == SESS[market][1]
    fin = end + pd.to_timedelta(np.where(at_close, GRACE, 0), unit='s') <= now_local
    if market == 'fut':
        if data_t is None:
            mid = end + pd.Timedelta(seconds=GRACE) <= now_local
        else:
            mid = (end <= data_t) | (end + pd.Timedelta(hours=1) <= now_local)
        fin = np.where(at_close, fin, mid)
    return b, np.asarray(fin, dtype=bool)


# ═════════════════════════ 期貨換月（價格不還原，只標出換月那根） ═════════════════════════
# Yahoo 連續月（=F）到期前直接接下一個合約、沒有還原，也拿不到過期合約。
#   日K／週K：日曆＋量（2026-11-10 用 ESZ26、CLZ26、GCZ26 逐根比對確認，歷史各季／各月用「量的跳升固定比價格換月早一天」佐證）：
#     股指＝季月第三個週五 E（遇假日往前）後的第一個交易日；CL＝LTD＋1（LTD＝25 日，不是營業日就用它前面最後一個營業日，再往前 3 個營業日）；
#     GC＝FND（交割月 G/J/M/Q/Z 前一個月最後營業日）或 FND＋1：{FND−1, FND} 裡量跳升最大那天的隔天；量看不出來（跳升 < 1.3 倍）才改挑開盤跳空大的那天。
#     （舊做法在窗口裡挑價差／跳空最大那天，波動大的時期會被雜訊騙走：CL 三成標在 LTD、股指 2016／2018／2020 差好幾天。）
#   1H／4H：Yahoo 比日K 早幾天、在 K 中間換 → 從「期貨 ÷ 參考標的」價差（basis）的跳動找那一天：
#     股指窗口 [E−8 天, E+3 天]；GC 窗口 FND−5～+2 營業日；CL 窗口 LTD−5～+2 營業日；窗口內 |Δln(F/R)| 最大那天、要大於 max(15bp, 3×近一年 MAD)
#     （窗口裡一定有一次換月，門檻只是擋純雜訊；CL 2025-11、2026-02 價差只有 −0.21%／−0.25%）。
#     價差跳動 < 25bp（弱）時只在「不是缺口」的 K 裡挑：價差這麼小，換月本身不會做出缺口，挑錯也不能把真的缺口藏掉。
#     F 用 15:00 那根 1H 的收盤（收在 16:00＝參考標的收盤）。換月那根＝當天「|報酬| × √(量跳升倍數÷同時段平常倍數)」最大、方向和 Δbasis 一樣的那根：
#     舊合約快到期時量很小、新合約一接上量就暴增，所以拼接那根的量跳升特別大（GC 2026-07-29 03:00 是平常的 4.8 倍；同一天 14:00 的 FOMC 行情 K 只有 3.2 倍）。
#   拼接有固定形狀時先認形狀、不看價差（2026-11-10 對 Yahoo 1H 逐根核對）：
#     ①平盤爆量那根：整根 h＝l、量 ≥ 近 200 根中位數 20 倍＝新合約接上時塞進來的一根（股指 2024-06-21／09-20／12-20、2025-06-20 16:00，
#       CL 2024-09-20、2025-06-20 16:00）→ 窗口內有這根就是它。
#     ②資料斷層後第一根：LTD＋1（股指 E＋1、GC FND）那天的第一根，前面跟上一個交易日之間斷了 8～24 小時
#       （CL 2024-08～2025-07：Yahoo 一路跟舊合約到 LTD 14:30 結算，之後沒資料，隔天 03:00 才接新合約）。
#   參考標的抓不到：1H／4H 只認上面兩種形狀（日K／週K 本來就只用日曆）。
ROLL_MIN = 0.0015
ROLL_MAD_K = 3
ROLL_STRONG = 0.0025
ROLL_FLAT_X = 20
ROLL_HOLE_H = (8, 24)


def roll_windows(kind, days):
    """回 [(窗口內交易日, 兩天候選(GC／CL 日K 用), 只用日曆時的換月日, 股指到期日 E)]；days＝交易日（已排序）。
    資料最後一天之後用平日補（還沒到的到期日也算得出窗口；窗口裡沒資料的日子偵測時自然跳過）。"""
    out = []
    if not len(days):
        return out
    # 前後用平日補：還沒到的到期日也算得出窗口；資料第一天之前的窗口（CL 第一個 LTD 在資料開頭）也要算，窗口裡沒資料的日子偵測時自然跳過
    days = pd.bdate_range(end=days[0] - pd.Timedelta(days=1), periods=10).append(days).append(
        pd.bdate_range(days[-1] + pd.Timedelta(days=1), periods=45))
    D = lambda k: days[k] if 0 <= k < len(days) else None
    last_le = lambda x: int(days.searchsorted(x, 'right')) - 1
    for y in range(days[0].year, days[-1].year + 1):
        for mth in range(1, 13):
            if kind == 'eq':
                if mth % 3:
                    continue
                d1 = pd.Timestamp(y, mth, 1)
                f3 = d1 + pd.Timedelta(days=(4 - d1.weekday()) % 7 + 14)        # 第三個週五
                k = last_le(f3)
                E = D(k)
                if E is None or E.month != mth:
                    continue
                hi = max(E + pd.Timedelta(days=3), D(k + 1))                  # 週四到期（週五休市）也要含下週一
                out.append((days[(days >= E - pd.Timedelta(days=8)) & (days <= hi)], None, D(k + 1), E))
            else:
                if kind == 'gc':
                    if mth not in (1, 3, 5, 7, 11):                             # 交割月 G J M Q Z 的前一個月（跳過 V）
                        continue
                    k = last_le(pd.Timestamp(y, mth, 1) + pd.offsets.MonthEnd(0))
                    if D(k) is None or D(k).month != mth:
                        continue
                    fb = D(k)
                else:
                    k0 = last_le(pd.Timestamp(y, mth, 25))
                    if D(k0) is None or D(k0).month != mth:
                        continue
                    k = k0 - 3
                    fb = D(k + 1)
                if k - 5 < 0 or k + 2 >= len(days):
                    continue
                out.append((days[k - 5:k + 3], days[k:k + 2], fb, None))
    return out


def roll_days(kind, F, R, gap_o=None, fill=False, days=None, v=None):
    """F：期貨每個交易日的比較價（index＝日期）；R：參考標的日K 收盤（None＝抓不到）；gap_o：ln(開/前收)（GC／CL 日K 給）；
    fill：True＝日K／週K，用日曆＋量（見上面）；False＝1H／4H，在窗口裡找價差跳動那天。
    days：交易日（不給＝F 的日期；1H 要給全部交易日，到期日那天常沒有 15:00 那根）。v：日K 的量（GC 用）。
    回 [(換月日＝第一根新合約那天, 前一個比對日或 None, Δbasis／跳空 或 None, 股指到期日 E 或 None)]。"""
    out = []
    days = F.index if days is None else days
    wins = roll_windows(kind, days)
    seen = lambda d: d is not None and days[0] <= d <= days[-1]   # 還沒到（或資料開始前）的日子不標
    db = None
    if R is not None:
        j = pd.concat([F.rename('f'), R.rename('r')], axis=1, join='inner').dropna()
        # 股指日K：到期日那天 Yahoo 的收盤是到期合約的最後結算價（早盤特別開盤價），不是收盤 → 那天不比，Δbasis 直接跨過去
        j = j[(j['f'] > 0) & (j['r'] > 0) & ~(fill and j.index.isin([w[3] for w in wins if w[3] is not None]))]
        if len(j) > 30:
            db = np.log(j['f'] / j['r']).diff().dropna()
    if fill:
        lv = None if v is None else np.log(v.where(v > 0)).diff()
        for win, cand, fb, E in wins:
            d = fb
            if kind == 'gc':
                k = int(days.searchsorted(cand[0]))
                jv = lv.reindex(days[max(k - 1, 0):k + 1]).dropna() if lv is not None else pd.Series(dtype=float)
                g = gap_o.reindex(cand).abs() if gap_o is not None else None
                if len(jv) and jv.max() >= np.log(1.3):
                    d = days[days.get_loc(jv.idxmax()) + 1]
                elif g is not None and g.notna().all():
                    d = g.idxmax()
            if not seen(d):
                continue
            # 標籤上的跳動：GC／CL 用開盤跳空（日K 結算時間跟 ETF 收盤不同，價差雜訊大）；股指用價差
            step = gap_o.get(d) if gap_o is not None else db.get(d) if db is not None else None
            out.append((d, None, None if step is None or not np.isfinite(step) else float(step), E))
        return out
    if db is None:
        return out
    tail = db.iloc[-260:]
    thr = max(ROLL_MIN, ROLL_MAD_K * float((tail - tail.median()).abs().median()))
    for win, cand, fb, E in wins:
        x = db.reindex(win).dropna()
        d = x.abs().idxmax() if len(x) else None
        if d is not None and abs(x[d]) > thr:
            k = db.index.get_loc(d)
            out.append((d, db.index[k - 1] if k else None, float(x[d]), E))
    return out


def _splices(kind, src, days, R):
    """1H 換月拼接那根：回 [(T＝那根 1H 的時間, 跳動 log 或 None)]。先認形狀（平盤爆量、資料斷層，見上面），再看價差跳動。"""
    s15 = src['c'][(src.index.hour == 15) & (src.index.minute == 0)]
    F = pd.Series(s15.to_numpy(), index=s15.index.normalize())
    F = F[~F.index.duplicated(keep='last')]
    tdi = _tday(src.index)
    ret = np.log(src['c'] / src['c'].shift())
    lr = np.log(src['v'].where(src['v'] > 0)).ffill().diff()       # 量跳升倍數（log），扣掉同時段近 20 天的中位數
    base = lr.groupby(src.index.hour).transform(lambda x: x.rolling(20, min_periods=5).median().shift())
    vz = np.exp(lr - base).fillna(1.0).clip(lower=1.0)
    med = src['v'].rolling(200, min_periods=20).median().shift()
    flat = ((src['h'] == src['l']) & (src['v'] >= ROLL_FLAT_X * med)).to_numpy()
    kd = days.searchsorted(tdi)
    dh = np.r_[0.0, np.diff(src.index.asi8) / 3.6e12]
    hole = (dh >= ROLL_HOLE_H[0]) & (dh < ROLL_HOLE_H[1]) & (np.r_[0, np.diff(kd)] == 1)
    isgap = (src['l'] > src['h'].shift()) | (src['h'] < src['l'].shift())
    byday = {d: (prev, step) for d, prev, step, _ in roll_days(kind, F, R, days=days)}
    out = []
    for win, cand, fb, E in roll_windows(kind, days):
        T = src.index[tdi.isin(win) & flat]
        if not len(T):
            T = src.index[(tdi == fb) & hole]
        if len(T):
            out.append((T[0], float(ret[T[0]]) if np.isfinite(ret[T[0]]) else None))
            continue
        d = next((x for x in win if x in byday), None)
        if d is None:
            continue
        prev, step = byday[d]
        if prev is None:                                          # 價差第一個比對日（1H 歷史開頭）：往前一個交易日起算，不能只看當天
            k = int(days.searchsorted(d))
            prev = days[k - 1] if k else None
        lo = prev + pd.Timedelta(hours=15) if prev is not None else src.index[0] - pd.Timedelta(hours=1)
        seg = ret[(ret.index > lo) & (ret.index <= d + pd.Timedelta(hours=15))].dropna()
        if abs(step) < ROLL_STRONG:
            seg = seg[~isgap.reindex(seg.index).to_numpy()]
        same = seg[np.sign(seg) == np.sign(step)]
        seg = same if len(same) else seg
        if seg.empty:
            continue
        T = (seg.abs() * np.sqrt(vz.reindex(seg.index))).idxmax()
        e16 = E + pd.Timedelta(hours=16) if E is not None else None   # 2025-06 以前股指 1H 在到期日 16:00 那根換（那天 15:00 常沒有 K）
        if e16 is not None and e16 in seg.index:
            T = e16
        out.append((T, step))
    return out


def find_rolls(kind, tf, src, bars, R):
    """src：1H（tf＝1H／4H，已過 bars_1h）或日K（D／W，已修量）；bars：要輸出的 K；R：參考標的日K 收盤。
    回 [{i, t, dir, step_pct, label}]（i＝bars 的位置；dir／step_pct＝換月那根的跳動，只靠日曆時是 None）。"""
    out = []
    if tf in ('1H', '4H'):
        days = pd.DatetimeIndex(_tday(src.index).unique()).sort_values()
        hits = []
        for T, step in _splices(kind, src, days, R):
            key = T if tf == '1H' else _fut_4h_key(pd.DatetimeIndex([T]))[0]
            hits.append((np.flatnonzero(bars.index == key), step))
    else:
        F = src['c']
        F = F[~F.index.duplicated(keep='last')]
        gap_o = None if kind == 'eq' else np.log(src['o'] / src['c'].shift())
        mon = bars.index - pd.to_timedelta(bars.index.weekday, unit='D')
        hits = [(np.flatnonzero(bars.index == d) if tf == 'D' else np.flatnonzero(mon == d - pd.Timedelta(days=d.weekday())), step)
                for d, _, step, _ in roll_days(kind, F, R, gap_o, fill=True, v=src['v'])]
    for hit, step in hits:
        if not len(hit):
            continue
        i = int(hit[0])
        if out and out[-1]['i'] == i:
            continue
        out.append({'i': i, 't': A._d(bars.index[i]), 'dir': None if step is None else 'up' if step >= 0 else 'down',
                    'step_pct': None if step is None else round(float(np.exp(step) - 1) * 100, 2), 'label': ROLL_LABEL})
    return out


# ═════════════════════════ 純函式：K → 訊號＋進出場＋圖 ═════════════════════════

def _clean(o):
    """JSON 安全：numpy → python、NaN/inf → None、Timestamp → 字串。"""
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (bool, np.bool_)):
        return bool(o)
    if isinstance(o, (int, np.integer)):
        return int(o)
    if isinstance(o, (float, np.floating)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, pd.Timestamp):
        return A._d(o)
    return o


def ma_sets(c, idx):
    out = {k: A._ma_group(c, ns, idx) for k, ns in MA_SETS}
    b = {k: MA_ZH[k] + A.MA_BADGE[out[k]['state']] for k, _ in MA_SETS}
    b['text'] = '・'.join(b[k] for k, _ in MA_SETS)
    out['badge'] = b
    return out


def gaps_full(dc, skip=()):
    """整段定案 K 的缺口（含分類、回補到最後一根）與島狀反轉；口徑＝analyze_symbol.compute_signals 把視窗放到整段（k0=0、tx=0）。
    分類只看缺口那根以前的 K（趨勢／位置／第幾個／當時壓力），回補與距現價看到最後一根，所以最近 120 根那段＝signals.gaps
    （tests/ta_engine_check.py --regress 驗）。唯一可能的差：島的 A 缺口在 120 根視窗左邊、B 在視窗內 → 整段版會標成島、視窗版不會。
    skip＝期貨換月那幾根（不算缺口，所以也不分類、不配成島；signals 同一份 skip）。"""
    idx = dc.index
    o_raw, h_raw, l_raw, c_raw, v = (dc[k].to_numpy('float64') for k in ('o', 'h', 'l', 'c', 'v'))
    rnd = lambda a: np.array([np.nan if A._p(x) is None else A._p(x) for x in a], 'float64')
    O, H, L, Cc = rnd(o_raw), rnd(h_raw), rnd(l_raw), rnd(c_raw)
    gp = A._sig_gaps(idx, H, L, Cc, v, 0, skip)
    A._classify(gp, {'items': []}, A._gap_ctx(H, L, Cc, c_raw, h_raw, l_raw, 0), idx, O, H, L, Cc, v, 0)
    return gp


def analyze_bars(df, market, final=None, rolls=None):
    """純函式。df：o/h/l/c/v（index＝K 棒時間，舊到新）；final：每根是否定案（None＝全部定案；未定只能在尾巴）；
    rolls：期貨換月那幾根（find_rolls 的輸出，i＝df 位置）→ 那根不算缺口，上圖標「換月」。
    訊號、均線排列只用定案 K；圖＝最後 120 根定案 K ＋ 尾巴的盤中未定 K；history＝全部 K（瀏覽器回測只用前 bars_completed 根）。
    整段定案 K 的量全是 0／缺＝沒有成交量（指數）：量全部當缺（history.v 全 null）、has_volume=false。"""
    df = df[['o', 'h', 'l', 'c', 'v']].astype('float64')
    fin = np.ones(len(df), bool) if final is None else np.asarray(final, bool)
    nf = int(fin.sum())
    if not fin[:nf].all():
        raise ValueError('未定的 K 只能在尾巴')
    if nf < MIN_BARS:
        raise EngineError(422, 'too_few_bars', '只有 %d 根定案 K，至少要 %d 根' % (nf, MIN_BARS))
    has_vol = bool((df['v'].to_numpy()[:nf] > 0).any())
    if not has_vol:
        df = df.assign(v=np.nan)
    rolls = list(rolls or [])
    skip = {r['i'] for r in rolls}
    dc = df.iloc[:nf]
    sig, _chart = A.compute_signals(dc, market, skip)
    sig['ma_align'] = ma_sets(dc['c'].to_numpy('float64'), dc.index)
    sig['badges']['ma'] = sig['ma_align']['badge']['text']
    k0 = max(0, nf - CHART_N)
    w = df.iloc[k0:]
    wf = fin[k0:]
    c_all = df['c'].to_numpy('float64')
    sma = {str(n): [A._p(x) for x in A.sma(c_all, n)[k0:]] for n in SMA_NS}
    bars = [{'t': A._d(t), 'o': A._p(r.o), 'h': A._p(r.h), 'l': A._p(r.l), 'c': A._p(r.c), 'v': A._f(r.v, 0),
             'final': bool(f)} for t, r, f in zip(w.index, w.itertuples(), wf)]
    # 缺口／島狀反轉：整段歷史（i、fill_i、i0、i1＝history 的絕對位置）；1H 缺口幾百個，用欄位表（cols＋rows）省 payload
    hi = {A._d(t): i for i, t in enumerate(df.index)}
    gf = gaps_full(dc, skip)
    # 文字欄（方向、回補、類型、趨勢、位置）存成 enums[欄] 的序號：日K 十年五百多個缺口，省三成 payload
    en = {c: sorted({g.get(c) for g in gf['items']} - {None}) for c in GAP_ENUMS}
    code = {c: {x: k for k, x in enumerate(v)} for c, v in en.items()}

    def col(g, c):
        if c == 'i':
            return hi[g['date']]
        if c == 'fill_i':
            return hi.get(g['fill_date'])
        x = g.get(c)
        return code[c][x] if c in code and x is not None else x
    gaps = {'cols': list(GAP_COLS), 'enums': en, 'rows': [[col(g, c) for c in GAP_COLS] for g in gf['items']]}
    isl = [{'kind': x['kind'], 'name': x['name'], 'i0': hi[x['start']], 'i1': hi[x['end']], 'start': x['start'], 'end': x['end'],
            'bars': x['bars'], 'high': x['high'], 'low': x['low']} for x in gf['islands']]
    sr = sig['sr_levels']
    srl = [{'kind': k, 'price': x['price'], 'style': 'solid' if k == 'support' else 'dashed', 'color': '#ffffff',
            'pick_scope': x['pick_scope'], 'dist_pct': x['dist_pct']}
           for k in ('support', 'resistance') for x in sr[k]]
    rd = lambda col: [round(float(x), HIST_ND) for x in df[col].to_numpy()]
    hist = {'n': int(len(df)), 't': [A._d(t) for t in df.index], 'o': rd('o'), 'h': rd('h'), 'l': rd('l'), 'c': rd('c'),
            'v': [int(x) if x == x else None for x in df['v'].to_numpy()]}
    notes = []
    nv = int(np.isnan(dc['v'].to_numpy()[k0:]).sum())
    if not has_vol:
        notes.append('這檔 Yahoo 不給成交量（指數沒有量）：量比、前五大量、量的進出場條件都停用')
    elif nv:
        why = {'tw': '（台股盤中第一根常見）', 'fut': '（期貨每天 18:00 開盤那根、日K 最近一天常見）'}.get(market, '')
        notes.append('近 %d 根裡有 %d 根 Yahoo 沒給量%s，量比與前五大量會跳過這些 K' % (nf - k0, nv, why))
    if market == 'fut':
        notes.append('期貨連續月是 Yahoo 直接接下一個合約、價格沒有還原：換月那根（圖上標「%s」）的跳空不算缺口、不進撐壓、不算島狀反轉'
                     % ROLL_LABEL)
    legend = [x for x in LEGEND if has_vol or x['key'] != 'top_volume'] + ([LEGEND_ROLL] if rolls else [])
    out = {'asof': A._d(dc.index[-1]), 'bars_total': int(len(df)), 'bars_completed': nf,
           'unfinished': bool(not wf[-1]), 'unfinished_label': UNFINISHED if not wf[-1] else None, 'has_volume': has_vol,
           'chart': {'n': len(bars), 'bars': bars, 'sma': sma, 'ma_sets': {k: list(ns) for k, ns in MA_SETS},
                     'overlays': {'sr': srl, 'gaps': gaps, 'islands': isl, 'rolls': rolls}, 'legend': legend},
           'signals': sig, 'history': hist, 'notes': notes}
    return _clean(out)


# ═════════════════════════ 對外：run／handle ═════════════════════════

def run(raw, tf, now=None, http=None):
    now = time.time() if now is None else float(now)
    tf = (tf or 'D').upper()
    if tf not in TFS:
        raise EngineError(400, 'bad_tf', '週期只能是 1H、4H、D、W')
    http = http or _http_get
    sp = special(raw)
    cands, market, code = ([sp['yahoo']], sp['market'], sp['code']) if sp else candidates(raw)
    res = None
    for ysym in cands:
        res, cached, fetched = cached_chart(ysym, TFS[tf], now, http)
        if res is not None:
            break
    if res is None:
        raise EngineError(404, 'not_found', '查不到這個代號：%s' % code)
    m = res.get('meta') or {}
    if m.get('instrumentType') not in ((sp['type'],) if sp else OK_TYPES):
        raise EngineError(422, 'not_supported', '只支援個股與 ETF（%s 是 %s）' % (code, m.get('instrumentType')))
    tz = m.get('exchangeTimezoneName') or ('Asia/Taipei' if market == 'tw' else 'America/New_York')
    src = frame(res, TFS[tf])
    rmt = m.get('regularMarketTime') if market == 'fut' else None
    bars, final = build(src, tf, market, _local(min(now, fetched), tz), _local(rmt, tz) if rmt else None)
    rolls = None
    if market == 'fut':
        R = None
        try:
            rr = cached_chart(sp['ref'], '1d', now, http)[0]
            R = frame(rr, '1d')['c'] if rr else None
        except EngineError:
            pass                                   # 參考標的抓不到 → 只用日曆
        rolls = find_rolls(sp['kind'], tf, bars if tf == '1H' else bars_1h(src, 'fut')[0] if tf == '4H' else src, bars, R)
    out = analyze_bars(bars, market, final, rolls)
    sym = {'input': raw, 'code': code, 'yahoo': ysym, 'market': market, 'type': m.get('instrumentType'),
           'name': m.get('longName') or m.get('shortName'), 'exchange': m.get('fullExchangeName'),
           'currency': m.get('currency'), 'timezone': tz, 'has_volume': out['has_volume']}
    if sp:                                         # 期貨／費半：中文名＋交易所；期貨另給目前合約（Yahoo shortName，例 E-Mini S&P 500 Dec 26）
        sym.update(name=sp['name'], exchange=sp['exchange'])
        if market == 'fut':
            sym.update(contract=m.get('shortName'), continuous=True)
    out = dict({'ok': True, 'schema': SCHEMA, 'tf': tf, 'symbol': sym,
                'generated_at': int(now), 'fetched_at': int(fetched), 'cached': bool(cached)}, **out)
    return out


def handle(path, key, secret, now=None, http=None):
    """HTTP 入口（api/engine.py 與本機 dev_server 共用）。回 (status, dict)。先驗金鑰，沒過不碰 Yahoo。
    secret＝環境變數 TA_ENGINE_KEY 的值（api/engine.py 讀環境變數後傳進來）。"""
    if not secret:
        print('ta-engine: %s 沒設，全部請求回 401' % KEY_ENV, file=sys.stderr, flush=True)
    if not check_key(key, secret):
        return 401, {'ok': False, 'error': {'code': 'unauthorized', 'message': 'unauthorized'}}
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)
    try:
        return 200, run((q.get('symbol') or [''])[0], (q.get('tf') or ['D'])[0], now, http)
    except EngineError as e:
        return e.status, {'ok': False, 'error': {'code': e.code, 'message': e.msg}}
    except Exception as e:
        return 500, {'ok': False, 'error': {'code': 'internal', 'message': type(e).__name__}}


# ═════════════════════════ 副本同步（Skill → Next repo ta-engine\） ═════════════════════════

def _sha(p):
    with open(p, 'rb') as f:
        return hashlib.sha256(f.read().replace(b'\r\n', b'\n')).hexdigest()   # 換行正規化（git autocrlf 不算漂移）


def sync(dst):
    for n in VENDOR:
        shutil.copyfile(os.path.join(HERE, n), os.path.join(dst, n))
    man = {'note': '這些檔是 Skill\\ 的副本，不要在這裡改；改 Skill\\ 再 python ta_engine.py --sync',
           'files': {n: _sha(os.path.join(dst, n)) for n in VENDOR}}
    with open(os.path.join(dst, 'vendor.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(man, f, ensure_ascii=False, indent=2)
        f.write('\n')
    return man


def vendor_drift(dst, src=HERE):
    """回漂移清單 [(檔名, 原因)]：src 與 dst 不同、或 dst 與 vendor.json 不同。"""
    bad = []
    mp = os.path.join(dst, 'vendor.json')
    man = json.load(open(mp, encoding='utf-8')).get('files', {}) if os.path.exists(mp) else {}
    for n in VENDOR:
        d = os.path.join(dst, n)
        if not os.path.exists(d):
            bad.append((n, '副本不存在'))
            continue
        if man.get(n) != _sha(d):
            bad.append((n, '副本與 vendor.json 不符（有人直接改了副本）'))
        if src != dst and os.path.exists(os.path.join(src, n)) and _sha(os.path.join(src, n)) != _sha(d):
            bad.append((n, 'Skill 正本已改、副本沒同步'))
    return bad


# ═════════════════════════ 自檢 ═════════════════════════

def _mkts(rows, start, step):
    return pd.DataFrame(rows, columns=['o', 'h', 'l', 'c', 'v'], index=pd.date_range(start, periods=len(rows), freq=step))


def _trend_df(n=260, up=True, start='2024-01-01'):
    rows, c = [], 100.0
    for i in range(n):
        d = (1 if up else -1) * (0.4 + 0.05 * (i % 3))
        rows.append([c, max(c, c + d) + .3, min(c, c + d) - .3, c + d, 1000 + 400 * (i % 7 == 0)])
        c += d
    return pd.DataFrame(rows, columns=['o', 'h', 'l', 'c', 'v'], index=pd.bdate_range(start, periods=n))


def _fake_chart(sym, typ='EQUITY', tz='Asia/Taipei', n=300):
    t0 = int(pd.Timestamp('2025-06-02 09:00', tz=tz).timestamp())
    ts = [t0 + 86400 * i for i in range(n)]
    c = [100 + i * .5 for i in range(n)]
    return {'meta': {'instrumentType': typ, 'exchangeTimezoneName': tz, 'longName': sym + ' Inc', 'currency': 'TWD',
                     'fullExchangeName': 'X'},
            'timestamp': ts, 'indicators': {'quote': [{'open': c, 'high': [x + 1 for x in c], 'low': [x - 1 for x in c],
                                                      'close': c, 'volume': [1000] * n}]}}


def selftest():
    bad = []

    def ok(cond, msg):
        print(('  ok  ' if cond else '  FAIL') + ' ' + msg)
        if not cond:
            bad.append(msg)

    # 1H：台股 09–13 五根＋13:30 假 K；第一根量 0 但有價動 → NaN
    rows = []
    for d in ('2026-11-05', '2026-11-06'):
        for hh in ('09:00', '10:00', '11:00', '12:00', '13:00', '13:30'):
            v = 0 if hh in ('09:00', '13:30') else 100
            rows.append((pd.Timestamp(d + ' ' + hh), [10, 12, 9, 11, v] if hh != '13:30' else [11, 11, 11, 11, 0]))
    tw = pd.DataFrame([r for _, r in rows], index=[t for t, _ in rows], columns=['o', 'h', 'l', 'c', 'v'], dtype='float64')
    h1, e1 = bars_1h(tw, 'tw')
    ok(len(h1) == 10 and '13:30' not in set(h1.index.strftime('%H:%M')) and np.isnan(h1['v'].iloc[0]) and h1['v'].iloc[1] == 100
       and e1[4] == pd.Timestamp('2026-11-05 13:30'), '1H 台股：丟 13:30 假 K、第一根量 0 有價動 → 缺量 NaN、13:00 那根結束在 13:30')
    h4, e4 = bars_4h(h1, 'tw')
    ok(list(h4.index.strftime('%m-%d %H:%M')) == ['11-05 09:00', '11-05 13:00', '11-06 09:00', '11-06 13:00']
       and h4['v'].iloc[0] == 300 and h4['h'].iloc[0] == 12 and h4['l'].iloc[0] == 9 and h4['c'].iloc[1] == 11
       and list(e4.strftime('%H:%M')[:2]) == ['13:00', '13:30'], '4H 台股：09:00–13:00 四根一根、13:00–13:30 一根；量加總（缺量不算）')
    us = []
    for i, hh in enumerate(('09:30', '10:30', '11:30', '12:30', '13:30', '14:30', '15:30', '16:00')):
        us.append((pd.Timestamp('2026-11-06 ' + hh), [i + 1, i + 3, i, i + 2, 0 if hh == '16:00' else 10 * (i + 1)]))
    usd = pd.DataFrame([r for _, r in us], index=[t for t, _ in us], columns=['o', 'h', 'l', 'c', 'v'], dtype='float64')
    u1, _ = bars_1h(usd, 'us')
    u4, ue4 = bars_4h(u1, 'us')
    ok(len(u1) == 7 and list(u4.index.strftime('%H:%M')) == ['09:30', '13:30'] and u4['o'].iloc[0] == 1 and u4['c'].iloc[0] == 5
       and u4['v'].iloc[0] == 100 and u4['v'].iloc[1] == 50 + 60 + 70 and u4['h'].iloc[1] == 9
       and list(ue4.strftime('%H:%M')) == ['13:30', '16:00'], '4H 美股：09:30–13:30 四根、13:30–16:00 三根；16:00 假 K 丟掉')
    # 美股提早收盤日：13:00 那根有價動、量 0 → 併進 12:30 那根（高低收跟著更新、量不變），不丟
    hd = usd.iloc[:4].copy()
    hd.loc[pd.Timestamp('2026-11-06 13:00')] = [5, 20, 1, 7, 0]
    h1d, _ = bars_1h(hd.sort_index(), 'us')
    h4d, _ = bars_4h(h1d, 'us')
    ok(len(h1d) == 4 and h1d['c'].iloc[-1] == 7 and h1d['h'].iloc[-1] == 20 and h1d['l'].iloc[-1] == 1
       and h1d['v'].iloc[-1] == 40 and h1d['o'].iloc[-1] == 4 and h4d['c'].iloc[0] == 7 and h4d['h'].iloc[0] == 20,
       '1H 美股提早收盤：13:00 有價動的 K 併進 12:30 那根，4H 收盤／高低含它')
    # 缺一根（盤中停牌）不錯位
    u4b, _ = bars_4h(u1.drop(u1.index[1]), 'us')
    ok(list(u4b.index.strftime('%H:%M')) == ['09:30', '13:30'] and u4b['v'].iloc[1] == 180, '4H 依時間切：中間缺一根 1H 也不錯位')
    t6 = tw.iloc[6:11]                                     # 11-06 09:00–13:00
    fa = build(t6, '1H', 'tw', pd.Timestamp('2026-11-06 11:00'))[1]
    fb = build(t6, '1H', 'tw', pd.Timestamp('2026-11-06 13:40'))[1]
    fc = build(t6, '1H', 'tw', pd.Timestamp('2026-11-06 13:45'))[1]
    f4 = build(t6, '4H', 'tw', pd.Timestamp('2026-11-06 13:05'))[1]
    ok(list(fa) == [True, True, False, False, False] and not fb[-1] and fb[:-1].all() and fc.all() and list(f4) == [True, False],
       '盤中 K 收完就定案（10:00 那根 11:00 定案）；收盤那根要收盤＋15 分鐘（13:00 那根 13:45 才定案）')

    # 週K：第一週一～五、第二週一～四（週五休市）
    days = list(pd.bdate_range('2026-11-02', '2026-11-12'))
    dd = pd.DataFrame([[10 + i, 12 + i, 9 + i, 11 + i, 100 * (i + 1)] for i in range(len(days))], index=days,
                      columns=['o', 'h', 'l', 'c', 'v'], dtype='float64')
    wk, we = bars_w(dd, 'tw')
    ok(list(wk.index.strftime('%Y-%m-%d')) == ['2026-11-06', '2026-11-12'] and wk['o'].iloc[0] == 10 and wk['c'].iloc[0] == 15
       and wk['h'].iloc[0] == 16 and wk['l'].iloc[0] == 9 and wk['v'].iloc[0] == 1500 and wk['v'].iloc[1] == 600 + 700 + 800 + 900,
       '週K：週一～五合併、標在該週最後交易日（週五休市標週四）')
    _, f1 = build(dd, 'W', 'tw', pd.Timestamp('2026-11-12 15:00'))
    _, f2 = build(dd, 'W', 'tw', pd.Timestamp('2026-11-13 13:50'))
    _, fd = build(dd, 'D', 'tw', pd.Timestamp('2026-11-12 13:40'))
    _, fd2 = build(dd, 'D', 'tw', pd.Timestamp('2026-11-12 13:46'))
    ok(list(f1) == [True, False] and list(f2) == [True, True] and not fd[-1] and fd[:-1].all() and fd2[-1],
       '未定：週K 到週五收盤＋15 分鐘才定案；日K 收盤 13:30＋15 分鐘才定案')

    # 未定那根不進訊號與回測
    base = _trend_df(260)
    fin = np.ones(len(base), bool)
    fin[-1] = False
    a1, a2 = analyze_bars(base, 'tw', fin), analyze_bars(base.iloc[:-1], 'tw')
    h1, h2 = a1['history'], a2['history']
    ok(a1['signals'] == a2['signals'] and a1['unfinished'] and not a2['unfinished']
       and a1['chart']['bars'][-1]['final'] is False and a1['chart']['n'] == 121 and a2['chart']['n'] == 120
       and a1['asof'] == a2['asof'] and a1['bars_completed'] == 259 and h1['n'] == 260 and h2['n'] == 259
       and all(h1[k][:259] == h2[k] for k in 'tohlcv') and 'trade' not in a1,
       '最後一根盤中未定：只上圖（多一根、final=False），訊號跟拿掉它完全一樣；history 帶全部 260 根（瀏覽器回測只用前 259 根）')
    try:
        analyze_bars(base, 'tw', np.r_[fin[:-2], False, True])
        ok(False, '未定在中間要報錯')
    except ValueError:
        ok(True, '未定 K 不在尾巴 → 報錯')

    # 三組均線排列
    up, dn = analyze_bars(_trend_df(260, True), 'us'), analyze_bars(_trend_df(260, False), 'us')
    ma = up['signals']['ma_align']
    ok([ma[k]['lines_n'] for k in ('short', 'mid', 'long')] == [[5, 10, 20], [8, 13, 34], [20, 60, 120]]
       and all(ma[k]['state'] == A.MA_BULL for k in ('short', 'mid', 'long'))
       and all(dn['signals']['ma_align'][k]['state'] == A.MA_BEAR for k in ('short', 'mid', 'long'))
       and ma['badge']['text'] == '短多・中多・長多', '均線三組：短 5/10/20、中 8/13/34、長 20/60/120；一路漲全多頭、一路跌全空頭')
    sh = _trend_df(60, True)
    ok(analyze_bars(sh, 'us')['signals']['ma_align']['long']['state'] == A.MA_NA
       and analyze_bars(sh, 'us')['signals']['ma_align']['mid']['state'] == A.MA_BULL, 'K 不夠 121 根 → 長組資料不足、中組照算')
    js = json.dumps(up, allow_nan=False, ensure_ascii=False)
    hc = _trend_df(260, True)
    ok(set(up['chart']['sma']) == {str(n) for n in SMA_NS} and len(js) > 1000 and 'ema10' not in up['chart']
       and up['history']['t'][0] == '2024-01-01' and len(up['history']['c']) == 260
       and max(abs(a - b) for a, b in zip(up['history']['c'], hc['c'])) < 1e-6 and up['history']['v'][0] == 1400,
       '輸出是合法 JSON（無 NaN），8 條 SMA 跟 120 根對齊；history＝全部 K（價格 6 位小數、量整數）')

    # 缺口／島狀反轉整段：第 20 根往上跳 50、第 23 根跳回來（20～22 懸空＝頂部島）；第 200 根往上跳 50 → 視窗內也有
    gd = _trend_df(260, True)
    gd.iloc[20:23, :4] += 50
    gd.iloc[200:, :4] += 50
    og = analyze_bars(gd, 'us')
    G = og['chart']['overlays']['gaps']
    rows = [dict(zip(G['cols'], r)) for r in G['rows']]
    ts = og['history']['t']
    ok(sorted(ts[r['i']] for r in rows) == ['2024-01-29', '2024-02-01', '2024-10-07']
       and [ts[r['i']] for r in rows if r['i'] >= 259 - CHART_N] == [x['date'] for x in og['signals']['gaps']['items']]
       and og['chart']['overlays']['islands'][0]['i0'] == 20 and og['chart']['overlays']['islands'][0]['i1'] == 22
       and 'top_volume' not in og['chart']['overlays'],
       '缺口／島狀反轉算整段（i＝history 絕對位置、欄位表格式）；視窗內那段＝signals.gaps；前五大量不在 overlays（瀏覽器依區間算）')

    # 除息還原
    dv =pd.DataFrame([[100, 101, 99, 100, 1], [95, 96, 94, 95, 1]], index=pd.to_datetime(['2026-07-01', '2026-07-02']),
                      columns=['o', 'h', 'l', 'c', 'v'], dtype='float64')
    t_ex = int(pd.Timestamp('2026-07-02 09:00', tz='Asia/Taipei').timestamp())
    ad = div_adjust(dv, {str(t_ex): {'amount': 5.0, 'date': t_ex}}, 'Asia/Taipei')
    ok(abs(ad['c'].iloc[0] - 95) < 1e-9 and ad['c'].iloc[1] == 95 and ad['v'].iloc[0] == 1, '除息往前還原：前一根 ×(1−5/100)，當根不動、量不動')

    # 代號解析（mock HTTP）
    calls = []

    def mock(url):
        sym = urllib.parse.unquote(url.split('/chart/')[1].split('?')[0])
        calls.append(sym)
        if sym in ('6488.TW', 'ZZZZ'):
            return 404, {'chart': {'result': None, 'error': {'code': 'Not Found'}}}
        if sym == 'IDXX':
            return 200, {'chart': {'result': [_fake_chart(sym, 'INDEX')]}}
        return 200, {'chart': {'result': [_fake_chart(sym, 'ETF' if sym.startswith('00') else 'EQUITY')]}}
    _CACHE.clear()
    now = pd.Timestamp('2026-11-08 12:00', tz='UTC').timestamp()
    r = run('6488', 'D', now, mock)
    ok(r['symbol']['yahoo'] == '6488.TWO' and calls[:2] == ['6488.TW', '6488.TWO'] and r['symbol']['market'] == 'tw'
       and r['symbol']['name'] == '6488.TWO Inc', '6488：先試 .TW（404）再 .TWO；帶出名稱')
    calls.clear()
    ok(run('2330', 'D', now, mock)['symbol']['yahoo'] == '2330.TW' and calls == ['2330.TW'], '2330：.TW 有就不試 .TWO')
    ok(run('00878', 'W', now, mock)['symbol']['type'] == 'ETF' and run(' nvda ', 'D', now, mock)['symbol']['yahoo'] == 'NVDA'
       and run('BRK.B', 'D', now, mock)['symbol']['yahoo'] == 'BRK-B', '00878 ETF、小寫加空白、BRK.B → BRK-B')
    calls.clear()
    run('6488', 'D', now + 60, mock)
    ok(calls == [], '同代號＋週期 15 分鐘內走快取（含 .TW 查無的負快取），不重打 Yahoo')
    for sym, code in (('^TWII', 'bad_symbol'), ('2330.HK', 'bad_symbol'), ('BTC-USD', 'bad_symbol'), ('IDXX', 'not_supported'),
                      ('ZZZZ', 'not_found')):
        try:
            run(sym, 'D', now, mock)
            ok(False, sym)
        except EngineError as e:
            ok(e.code == code, '%s → %s' % (sym, code))
    try:
        run('2330', '15m', now, mock)
        ok(False, 'bad tf')
    except EngineError as e:
        ok(e.code == 'bad_tf', '週期只收 1H／4H／D／W')

    # ── 期貨／費半（11-10）──
    sp = lambda x: (special(x) or {}).get('yahoo')
    ok([sp(x) for x in ('ES1!', 'es=f', '/ES', 'NQ', 'nq1!', '小那', '小道瓊', 'RTY', 'GC', '黃金期', 'CL1!', '輕原油', '^SOX', 'sox', '費半')]
       == ['ES=F', 'ES=F', 'ES=F', 'NQ=F', 'NQ=F', 'NQ=F', 'YM=F', 'RTY=F', 'GC=F', 'GC=F', 'CL=F', 'CL=F', '^SOX', '^SOX', '^SOX']
       and special('ES') is None and special('CL') is None and special('MES=F') is None and special('2330') is None
       and special('NVDA') is None and special('NQ1!')['code'] == 'NQ1!' and special('NQ1!')['market'] == 'fut',
       '期貨代號：X=F／X1!／/X、純 NQ YM RTY GC、中文別名；純 ES／CL 照查股票（Eversource／Colgate）；^SOX／費半')
    for x in ('TXF1!', 'SXF1!', '台指期', '費半期', '/TXF'):
        try:
            special(x)
            ok(False, x)
        except EngineError as e:
            ok(e.code == 'coming_soon' and e.msg == '台指期／費半期資料整合中', '%s → 台指期／費半期資料整合中' % x)
    # 期貨 1H：17:00 雜訊 K 丟、18:00 量 0 有價動＝缺量、提早收盤 :30 併進整點、即時跳動點丟；16:00 那根結束在 17:00
    fr = [('2026-11-05 15:00', [10, 11, 9, 10.5, 50]), ('2026-11-05 16:00', [10.5, 11, 10, 10.8, 40]),
          ('2026-11-05 17:00', [10.8, 10.8, 10.8, 10.8, 1]), ('2026-11-05 18:00', [11, 12, 10.9, 11.5, 0]),
          ('2026-11-05 19:00', [11.5, 12, 11, 11.8, 30]), ('2026-11-05 19:30', [11.8, 12.5, 11.7, 12.2, 5]),
          ('2026-11-05 20:36:03', [12.2, 12.2, 12.2, 12.2, 0])]
    fdf = pd.DataFrame([r for _, r in fr], index=pd.DatetimeIndex([pd.Timestamp(t) for t, _ in fr]), columns=['o', 'h', 'l', 'c', 'v'], dtype='float64')
    f1, fe = bars_1h(fdf, 'fut')
    ok(list(f1.index.strftime('%H:%M')) == ['15:00', '16:00', '18:00', '19:00'] and np.isnan(f1['v'].iloc[2])
       and f1['c'].iloc[3] == 12.2 and f1['h'].iloc[3] == 12.5 and f1['v'].iloc[3] == 35
       and fe[1] == pd.Timestamp('2026-11-05 17:00') and fe[2] == pd.Timestamp('2026-11-05 19:00'),
       '期貨 1H：丟 17:00 雜訊 K 與即時跳動點、18:00 量 0 有價動 → NaN、19:30 併進 19:00；16:00 那根結束在 17:00')
    hrs = pd.date_range('2026-11-08 18:00', '2026-11-09 16:00', freq='h')
    hh = pd.DataFrame({'o': 1.0, 'h': 2.0, 'l': .5, 'c': 1.5, 'v': 10.0}, index=hrs)
    g4, e4f = bars_4h(hh, 'fut')
    ok(list(g4.index.strftime('%m-%d %H:%M')) == ['11-08 18:00', '11-08 22:00', '11-09 02:00', '11-09 06:00', '11-09 10:00', '11-09 14:00']
       and list(g4['v']) == [40, 40, 40, 40, 40, 30] and e4f[-1] == pd.Timestamp('2026-11-09 17:00') and e4f[0] == pd.Timestamp('2026-11-08 22:00'),
       '期貨 4H：從 18:00 起 18／22／02／06／10／14，14:00 那段到 17:00（3 根）')
    # 定案：週日 18:00 開盤；週五 16:00 那根 17:15 才定案；週末全部定案
    wk1 = pd.DataFrame({'o': 1.0, 'h': 2.0, 'l': .5, 'c': 1.5, 'v': 10.0},
                       index=pd.to_datetime(['2026-11-06 15:00', '2026-11-06 16:00', '2026-11-08 18:00']))
    fa = build(wk1, '1H', 'fut', pd.Timestamp('2026-11-06 17:10'))[1]
    fb = build(wk1, '1H', 'fut', pd.Timestamp('2026-11-07 12:00'))[1]
    fc = build(wk1, '1H', 'fut', pd.Timestamp('2026-11-08 18:30'))[1]
    dd2 = pd.DataFrame({'o': 1.0, 'h': 2.0, 'l': .5, 'c': 1.5, 'v': [10.0, 20.0, 20.0, 0.0]},
                       index=pd.to_datetime(['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09']))
    fd1 = build(dd2, 'D', 'fut', pd.Timestamp('2026-11-06 17:20'))
    fd2 = build(dd2, 'D', 'fut', pd.Timestamp('2026-11-08 19:00'))[1]
    fw = build(dd2, 'W', 'fut', pd.Timestamp('2026-11-06 17:20'))[1]
    ok(list(fa) == [True, False, False] and list(fb) == [True, True, False] and list(fc) == [True, True, False]
       and list(fd1[1]) == [True, True, True, False] and list(fd2) == [True, True, True, False] and list(fw) == [True, False]
       and np.isnan(fd1[0]['v'].iloc[2]) and np.isnan(fd1[0]['v'].iloc[3]) and fd1[0]['v'].iloc[1] == 20,
       '期貨定案：週五 16:00 那根 17:15 才定案、週末全定案、週日 18:00 起週一那根盤中；日K 17:15 定案；量抄前一天／量 0 → NaN')
    # 換月：股指每季第三個週五後的週一價差跳 +80bp（其他天 ±2bp 雜訊）→ 偵測到週一；沒有參考標的 → 退回日曆
    rng = np.random.RandomState(7)
    dts = pd.bdate_range('2025-01-02', '2026-11-06')
    Rr = pd.Series(5000 * np.exp(np.cumsum(rng.normal(0, .01, len(dts)))), index=dts)
    E3 = [d for d in dts if d.month % 3 == 0 and d.weekday() == 4 and 15 <= d.day <= 21]
    bas = np.cumsum([.008 if (d - pd.Timedelta(days=3)) in E3 else 0 for d in dts]) + rng.normal(0, .0002, len(dts))
    Ff = Rr * np.exp(bas)
    got = [str(d.date()) for d, *_ in roll_days('eq', Ff, Rr, fill=True)]
    want = [str((d + pd.Timedelta(days=3)).date()) for d in E3]
    ok(got == want and [str(d.date()) for d, *_ in roll_days('eq', Ff, None, fill=True)] == want,
       '換月偵測（股指日K）：每季第三個週五後的週一；參考標的抓不到 → 日曆（同一天）：%s' % got[-2:])
    gdf = pd.DataFrame({'o': Ff.to_numpy(), 'h': Ff.to_numpy() * 1.01, 'l': Ff.to_numpy() * .99, 'c': Ff.to_numpy(), 'v': 1000.0}, index=dts)
    jump = [d + pd.Timedelta(days=3) for d in E3]
    for k, d in enumerate(dts):                            # 換月那根做成往上跳空
        if d in jump:
            gdf.iloc[k:, :4] *= 1.05
    rl = find_rolls('eq', 'D', gdf, gdf, Rr)
    ag = analyze_bars(gdf, 'fut', rolls=rl)
    G = ag['chart']['overlays']['gaps']
    gi = {r_[G['cols'].index('i')] for r_ in G['rows']}
    ok(len(rl) >= 6 and not (gi & {x['i'] for x in rl}) and all(x['label'] == ROLL_LABEL for x in ag['chart']['overlays']['rolls'])
       and all(x['date'] not in {y['t'] for y in rl} for x in ag['signals']['gaps']['items'])
       and any(x['key'] == 'roll' for x in ag['chart']['legend']) and any('換月' in n for n in ag['notes']),
       '換月那根的跳空不算缺口（整段、近 120 根都沒有）、上圖標「換月」、圖例與註記有說明')
    # GC 日K：FND／FND+1 兩天挑開盤跳空大的那根；CL：LTD／LTD+1
    gd2 = pd.DataFrame({'o': 100.0, 'h': 101.0, 'l': 99.0, 'c': 100.0, 'v': 1.0}, index=dts)
    for dstr in ('2025-07-31', '2025-12-01', '2026-02-02'):  # FND 7/31（Q）、11/28 → 隔一天 12/01（Z）、1/30 → 2/02（G）
        k = dts.get_loc(pd.Timestamp(dstr))
        gd2.iloc[k:, :4] *= 1.02
    gr = [x['t'] for x in find_rolls('gc', 'D', gd2, gd2, None)]
    ok({'2025-07-31', '2025-12-01', '2026-02-02'} <= set(gr), 'GC 日K：量看不出來時，FND 當天或隔一天挑開盤跳空大的：%s' % gr[-5:])
    # 量看得出來：FND 11/28 那天量跳 5 倍 → 換月是隔天 12/01，就算 11/28 有更大的真跳空（2025-11-28 CME 當機那天）
    gd3 = pd.DataFrame({'o': 100.0, 'h': 101.0, 'l': 99.0, 'c': 100.0, 'v': 1000.0}, index=dts)
    gd3.loc[pd.Timestamp('2025-11-28'):, 'v'] = 5000.0
    gd3.iloc[dts.get_loc(pd.Timestamp('2025-11-28')):, :4] *= 1.03
    gd3.iloc[dts.get_loc(pd.Timestamp('2025-12-01')):, :4] *= 1.005
    gr3 = [x['t'] for x in find_rolls('gc', 'D', gd3, gd3, None)]
    # CL：LTD 那天有更大的跳空也不管，換月一律 LTD+1（2026-06：LTD＝06-22 → 06-23）
    cl3 = pd.DataFrame({'o': 70.0, 'h': 71.0, 'l': 69.0, 'c': 70.0, 'v': 1000.0}, index=dts)
    cl3.iloc[dts.get_loc(pd.Timestamp('2026-06-22')):, :4] *= 0.96
    cr3 = [x['t'] for x in find_rolls('cl', 'D', cl3, cl3, None)]
    ok('2025-12-01' in gr3 and '2025-11-28' not in gr3 and '2026-06-23' in cr3 and '2026-06-22' not in cr3,
       'GC 日K：{FND−1, FND} 量跳升那天的隔天；CL 日K：一律 LTD+1（不被跳空騙）')
    # 1H 換月那根：拼接 K（03:00，舊合約量只剩一成、接上新合約量暴增）報酬 +1.5%；同一天 14:00 的消息 K +1.6% 但量只多一點 → 標 03:00
    hrs = [h_ for h_ in range(24) if h_ != 17]
    tds = pd.bdate_range('2026-05-01', '2026-08-07')
    hi = pd.DatetimeIndex([td + pd.Timedelta(hours=h_ - (24 if h_ >= 18 else 0)) for td in tds for h_ in hrs])
    px = pd.Series(100.0, index=hi)
    vv = pd.Series(np.where(hi.hour == 3, 3000.0, 1000.0), index=hi)
    sp_t, nw_t = pd.Timestamp('2026-07-29 03:00'), pd.Timestamp('2026-07-29 14:00')
    px[hi >= sp_t] *= 1.015
    px[hi == nw_t] *= 1.016
    vv[(hi >= pd.Timestamp('2026-07-28 18:00')) & (hi < sp_t)] = 100.0
    vv[hi == nw_t] = 1500.0
    h1 = pd.DataFrame({'o': px.shift().fillna(100.0), 'h': px * 1.001, 'l': px * .999, 'c': px, 'v': vv})
    h1['o'] = h1['o'].where(h1.index != sp_t, 100.0)
    ri = [x['t'] for x in find_rolls('gc', '1H', h1, h1, pd.Series(100.0, index=tds))]
    ok(ri == ['2026-07-29 03:00'], 'GC 1H 換月那根＝報酬×量跳升最大的拼接 K，不是同一天報酬稍大的消息 K：%s' % ri)

    def h1_of(start, end):
        tds_ = pd.bdate_range(start, end)
        ix = pd.DatetimeIndex([td + pd.Timedelta(hours=h_ - (24 if h_ >= 18 else 0)) for td in tds_ for h_ in hrs])
        return tds_, pd.DataFrame({'o': 100.0, 'h': 100.1, 'l': 99.9, 'c': 100.0, 'v': 1000.0}, index=ix.sort_values())
    # 股指：資料第一天就是到期日，拼接是到期日 16:00 那根平盤爆量 K（ES 2024-06-21）→ 標那根，不被「第一個比對日」縮掉
    tq, eq1 = h1_of('2026-03-19', '2026-05-29')
    sp_e = pd.Timestamp('2026-03-20 16:00')
    eq1.loc[eq1.index >= sp_e, ['o', 'h', 'l', 'c']] *= 1.013
    eq1.loc[sp_e, ['h', 'l', 'v']] = [eq1.at[sp_e, 'o'], eq1.at[sp_e, 'o'], 200000.0]
    eq1.loc[sp_e, 'c'] = eq1.at[sp_e, 'o']
    re1 = [x['t'] for x in find_rolls('eq', '1H', eq1, eq1, pd.Series(100.0, index=tq))]
    re4 = [x['t'] for x in find_rolls('eq', '4H', eq1, bars_4h(eq1, 'fut')[0], pd.Series(100.0, index=tq))]
    # CL：LTD（2026-06-22）14:00 以後沒資料、隔天 03:00 才接新合約（−1.5%）；LTD 當天 03:00 有一根量暴增的假動作 → 標 06-23 03:00
    tc, cl1 = h1_of('2026-06-01', '2026-07-10')
    sp_c, fake = pd.Timestamp('2026-06-23 03:00'), pd.Timestamp('2026-06-22 03:00')
    cl1 = cl1[(cl1.index <= pd.Timestamp('2026-06-22 14:00')) | (cl1.index >= sp_c)].copy()
    cl1.loc[cl1.index >= sp_c, ['o', 'h', 'l', 'c']] *= 0.985
    cl1.loc[fake, ['c', 'l', 'v']] = [99.0, 98.9, 30000.0]
    rc1 = [x['t'] for x in find_rolls('cl', '1H', cl1, cl1, pd.Series(100.0, index=tc))]
    rc0 = [x['t'] for x in find_rolls('cl', '1H', cl1, cl1, None)]
    ok(re1 == ['2026-03-20 16:00'] and re4 == ['2026-03-20 14:00'] and rc1 == ['2026-06-23 03:00'] and rc0 == rc1,
       '1H 換月認形狀：平盤爆量那根（資料開頭的第一次換月也抓得到）、LTD 後資料斷層的第一根（參考標的抓不到也一樣）：%s %s %s' % (re1, re4, rc1))
    # 期貨盤中定案看資料時間：Yahoo 期貨晚約 10 分鐘，03:04 抓到的資料只到 02:54 → 02:00 那根還沒定案
    wk2 = pd.DataFrame({'o': 1.0, 'h': 2.0, 'l': .5, 'c': 1.5, 'v': 10.0},
                       index=pd.to_datetime(['2026-11-10 01:00', '2026-11-10 02:00', '2026-11-10 11:00', '2026-11-10 12:00']))
    T_ = pd.Timestamp
    g1 = build(wk2.iloc[:2], '1H', 'fut', T_('2026-11-10 03:04:43'), T_('2026-11-10 02:54:36'))[1]
    g2 = build(wk2.iloc[:2], '1H', 'fut', T_('2026-11-10 03:13'), T_('2026-11-10 03:03'))[1]
    g3 = build(wk2.iloc[:2], '1H', 'fut', T_('2026-11-10 03:10'))[1]
    g4_ = build(wk2.iloc[:2], '4H', 'fut', T_('2026-11-10 06:20'), T_('2026-11-10 05:59:59'))[1]
    g5 = build(wk2, '1H', 'fut', T_('2026-11-10 14:05'), T_('2026-11-10 12:59:58'))[1]   # 提早收盤 13:00：資料停在休市前
    ok(list(g1) == [True, False] and list(g2) == [True, True] and list(g3) == [True, False] and list(g4_) == [True, False]
       and list(g5) == [True, True, True, True],
       '期貨盤中定案：資料時間過了結束才算（沒給資料時間就等 15 分鐘；資料一直沒過就等滿 1 小時）')

    def mock_f(url):
        sym = urllib.parse.unquote(url.split('/chart/')[1].split('?')[0])
        if sym == '^SOX':
            c = _fake_chart(sym, 'INDEX', 'America/New_York')
            c['indicators']['quote'][0]['volume'] = [0] * len(c['timestamp'])
            return 200, {'chart': {'result': [c]}}
        if sym.endswith('=F'):
            c = _fake_chart(sym, 'FUTURE', 'America/New_York')
            c['meta']['shortName'] = 'Nasdaq 100 Dec 26'
            return 200, {'chart': {'result': [c]}}
        if sym == '^NDX':
            return 502, None
        return mock(url)
    _CACHE.clear()
    rs = run('費半', 'D', now, mock_f)
    rq = run('NQ1!', 'D', now, mock_f)
    ok(rs['symbol']['yahoo'] == '^SOX' and rs['symbol']['type'] == 'INDEX' and rs['has_volume'] is False
       and rs['symbol']['has_volume'] is False and set(rs['history']['v']) == {None} and '指數沒有量' in rs['notes'][0]
       and not any(x['key'] == 'top_volume' for x in rs['chart']['legend']) and rs['chart']['overlays']['rolls'] == [],
       '^SOX：指數白名單放行、量全 0 → has_volume=false、history.v 全 null、圖例沒有前五大量')
    ok(rq['symbol']['market'] == 'fut' and rq['symbol']['yahoo'] == 'NQ=F' and rq['symbol']['name'] == 'E-mini 那斯達克 100 期貨'
       and rq['symbol']['exchange'] == 'CME' and rq['symbol']['contract'] == 'Nasdaq 100 Dec 26' and rq['has_volume'] is True
       and isinstance(rq['chart']['overlays']['rolls'], list),
       'NQ1!：期貨白名單、中文名＋CME＋目前合約；參考標的 ^NDX 抓不到也照算（只用日曆）')
    for sym, code in (('ES', 'not_found'), ('IDXX', 'not_supported'), ('TXF1!', 'coming_soon')):
        try:
            run(sym, 'D', now, lambda u: (404, None) if '/ES?' in u else mock_f(u))
            ok(False, sym)
        except EngineError as e:
            ok(e.code == code, '%s → %s（純 ES 走股票查法；其他指數照擋）' % (sym, code))

    # 授權
    calls.clear()
    sec = 'test-secret'
    good = engine_key(sec)
    ok(good == hmac.new(b'test-secret', b'ta-engine', hashlib.sha256).hexdigest() and len(good) == 64, '金鑰＝HMAC-SHA256(TA_ENGINE_KEY, "ta-engine") hex')
    st = [handle('/api/engine?symbol=2330&tf=D', k, s, now, mock)[0] for k, s in
          ((None, sec), ('', sec), ('x' * 64, sec), (good.upper(), sec), (good, None), (good, ''))]
    ok(st == [401] * 6 and calls == [], '沒金鑰／錯金鑰／大寫／TA_ENGINE_KEY 沒設 → 401，而且完全沒打 Yahoo')
    src = open(os.path.abspath(__file__), encoding='utf-8').read()
    ok(src.count('JWT' + '_SECRET') == 0, '引擎原始碼完全不讀 JWT' + '_SECRET')
    s2, b2 = handle('/api/engine?symbol=2330&tf=D', good, sec, now, mock)
    s3, b3 = handle('/api/engine?symbol=%5ETWII', good, sec, now, mock)
    ok(s2 == 200 and b2['ok'] and s3 == 400 and b3['error']['code'] == 'bad_symbol', '對的金鑰 → 200；壞代號 → 400 帶錯誤碼')

    # 副本：在 Next repo 的 ta-engine\ 跑時驗 vendor.json
    if os.path.exists(os.path.join(HERE, 'vendor.json')):
        d = vendor_drift(HERE)
        ok(not d, '副本與 vendor.json 一致 %s' % (d or ''))
    print('selftest %s（%d 項失敗）' % ('全過' if not bad else '有失敗', len(bad)))
    return not bad


def main(argv):
    if '--selftest' in argv:
        return 0 if selftest() else 1
    if '--sync' in argv:
        dst = argv[argv.index('--sync') + 1]
        print(json.dumps(sync(dst), ensure_ascii=False, indent=2))
        return 0
    if '--check-vendor' in argv:
        d = vendor_drift(argv[argv.index('--check-vendor') + 1])
        print('副本一致' if not d else '\n'.join('漂移：%s — %s' % x for x in d))
        return 0 if not d else 1
    if len(argv) >= 2 and not argv[0].startswith('-'):
        print(json.dumps(run(argv[0], argv[1]), ensure_ascii=False)[:3000])
        return 0
    print(__doc__)
    return 0


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    sys.exit(main(sys.argv[1:]))
