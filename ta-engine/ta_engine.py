# -*- coding: utf-8 -*-
r"""ta_engine.py — 會員技術分析「網站版」計算引擎（Yoda 2026-11-08）

正本在 Skill\；Next repo 的 ta-engine\ 是 `--sync` 出去的副本（連 analyze_symbol.py、ta_trade.py 一起），
vendor.json 記 sha256，兩邊各有檢查，副本不能偷偷漂移：
    python "G:\Yoda x Claude\Skill\ta_engine.py" --sync "G:\Yoda x Claude\_deploy\yoda-research-next\ta-engine"
    python "G:\Yoda x Claude\Skill\ta_engine.py" --check-vendor "G:\Yoda x Claude\_deploy\yoda-research-next\ta-engine"
    python ta_engine.py --selftest          # 合成資料＋mock HTTP；在副本資料夾跑還會驗 vendor.json

資料  Yahoo chart API v8（純 urllib，不用 yfinance、不讀本機 pkl）。1H＝interval=1h range=730d；日K＝interval=1d 10 年。
      4H＝1H 依「每天開盤起每 4 根」切（台股 09:00–13:00｜13:00–13:30；美股 09:30–13:30｜13:30–16:00）。
      週K＝日K 依週一～週五合併，標在該週最後一個交易日。開高低收依除息事件往前還原（同 Yahoo adjclose 口徑），量不動。
      Yahoo 1H 的「收盤那一刻」假 K（台股 13:30、美股 16:00、量 0）丟掉；有價動卻量 0 的 K＝缺量，當 NaN（量比／前五大量跳過）。
未定  K 棒結束時間還沒到＝盤中未定；收盤那根（日K、週K、盤中最後一段）要收盤＋15 分鐘（週K：該週五收盤＋15 分鐘）。未定那根只上圖，訊號與回測一律只用定案 K。
訊號  analyze_symbol.compute_signals（前五大量／缺口分類／撐壓）原封不動套在所選週期的 K；均線排列算三組：
      短 SMA5/10/20、中 SMA8/13/34、長 SMA20/60/120（規則同 analyze_symbol._ma_group）。「近 120 天」＝近 120 根。
進出場 ta_trade.trade_signals（含加碼，pyramid 預設開）跑全部定案 K；圖只給最後 120 根內的記號與線。
授權  handle() 第一步就驗 X-TA-Engine-Key＝HMAC-SHA256(JWT_SECRET, "ta-engine") hex；不對就 401，不碰 Yahoo。
"""
import os, re, sys, json, time, hmac, hashlib, shutil, urllib.request, urllib.parse, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import numpy as np
import pandas as pd
import analyze_symbol as A
from ta_trade import trade_signals

SCHEMA = 'ta-engine-1'
CHART_N = 120
MIN_BARS = 30
TFS = {'1H': '1h', '4H': '1h', 'D': '1d', 'W': '1d'}
MA_SETS = (('short', (5, 10, 20)), ('mid', (8, 13, 34)), ('long', (20, 60, 120)))
MA_ZH = {'short': '短', 'mid': '中', 'long': '長'}
SMA_NS = (5, 8, 10, 13, 20, 34, 60, 120)
BAD_MIN_N, BAD_WIN_PCT = 8, 25          # 同 ta_local：≥8 筆且（勝率 <25% 或合計 <0）→ 規則不適用
GRACE = 15 * 60                          # 收盤後再等 15 分鐘才算定案（Yahoo 收盤價晚一點進來）
TTL_INTRA = 15 * 60
TTL_MISS = 3600
CACHE_MAX = 64
SESS = {'tw': (9 * 60, 13 * 60 + 30), 'us': (9 * 60 + 30, 16 * 60)}   # 開盤／收盤（交易所當地分鐘）
HOSTS = ('query1.finance.yahoo.com', 'query2.finance.yahoo.com')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
OK_TYPES = ('EQUITY', 'ETF')
TW_IN = re.compile(r'^(\d{4,6}[A-Z]?)(\.TWO?)?$')
US_IN = re.compile(r'^[A-Z][A-Z0-9]{0,5}([.\-][A-Z]{1,2})?$')
REN = {'o': 'Open', 'h': 'High', 'l': 'Low', 'c': 'Close', 'v': 'Volume'}
NOTE_STATS = '樣本內統計，不代表未來；未計手續費與滑價'
UNFINISHED = '盤中未定'
EMA10_LABEL = 'EMA10（出場線）'
LEG_ABBR = {'停損': '停損', '保本出': '保本', '停利一半(2R)': '停利½', '收破10線': '破10線', '爆量反向K': '爆量反K',
            '加碼停損': '加碼停損'}
VENDOR = ('analyze_symbol.py', 'ta_trade.py', 'ta_engine.py')
LEGEND = [
    {'key': 'support', 'label': '支撐', 'desc': '白色實線：今收下方最強的一條（±10% 內優先）'},
    {'key': 'resistance', 'label': '壓力', 'desc': '白色虛線：今收上方最強的一條（±10% 內優先）'},
    {'key': 'top_volume', 'label': '前五大量', 'desc': '近 120 根量最大的 5 根，金框；高低點是撐壓候選'},
    {'key': 'gap', 'label': '缺口', 'desc': '方框＝還沒補的缺口區間（部分回補只畫剩下那段）；補滿的畫到回補那根'},
    {'key': 'ema10', 'label': EMA10_LABEL, 'desc': '停利一半後，收盤跌破（空單站上）就出剩下的'},
    {'key': 'entry', 'label': '多進／空進', 'desc': '紅箭頭多進、綠箭頭空進：EMA5/10/20 排列剛成立＋量比 ≥1.2＋收在 EMA5 同側'},
    {'key': 'add', 'label': '加碼', 'desc': '停利一半後回測 EMA10 沒收破、下一根帶量收回 EMA5 外側，加 0.5 單位（最多一次）'},
    {'key': 'stop', 'label': '停損', 'desc': '紅虛線：近 3 根最低（空單最高）；停利一半後移到進場價（保本）'},
    {'key': 'add_stop', 'label': '加碼停損', 'desc': '橘虛線：加碼那根起近 3 根最低（空單最高），碰到只出加碼那份'},
    {'key': 'tp1', 'label': '停利 2R', 'desc': '黃點線：進場 ± 2 倍風險，碰到先出一半'},
    {'key': 'exit', 'label': '✕ 出場', 'desc': '✕ 旁邊寫原因：停損／保本／停利½／破10線／爆量反K／加碼停損'},
    {'key': 'open', 'label': '持倉中', 'desc': '還沒出場的線延伸到右緣'},
    {'key': 'unfinished', 'label': UNFINISHED, 'desc': '最後一根還在交易中，只上圖，不進訊號與回測'},
]


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
        end = (((res.get('meta') or {}).get('currentTradingPeriod') or {}).get('regular') or {}).get('end')
        # shortcut: 收盤後抓的日K沿用到收盤後 17 小時（台股、美股隔天開盤前），之後退回 15 分鐘；週末會多抓幾次，要省再接交易日曆
        return bool(end) and t >= end + GRACE and now < end + 17 * 3600
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
        raise EngineError(400, 'bad_symbol', '代號格式不對：台股填數字代號（如 2330、00878），美股填英文代號（如 NVDA）；不支援指數')
    return [s.replace('.', '-')], 'us', s


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


def bars_1h(df, market):
    """只留開盤起整點對齊的 1H（丟掉收盤那刻的假 K）；有價動卻量 0＝缺量 → NaN。回 (df, end)。"""
    o_m, c_m = SESS[market]
    t = _tod(df.index)
    df = df[(t >= o_m) & (t < c_m) & ((t - o_m) % 60 == 0)].copy()
    miss = (df['v'] == 0) & ((df['h'] > df['l']) | (df['o'] != df['c']))
    df.loc[miss, 'v'] = np.nan
    day = df.index.normalize()
    end = np.minimum(df.index + pd.Timedelta(hours=1), day + pd.Timedelta(minutes=c_m))
    return df, pd.DatetimeIndex(end)


def bars_4h(h1, market):
    """1H → 4H：每個交易日從開盤起每 4 根 1H 一根（依時間切，缺根不會錯位）；標在該段開始時間。"""
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
    return d1, d1.index + pd.Timedelta(minutes=SESS[market][1])


def bars_w(d1, market):
    """日K → 週K（週一～週五）；標在該週最後一個交易日；結束＝該週五收盤（週五休市也一樣，晚半天定案而已）。"""
    mon = d1.index - pd.to_timedelta(d1.index.weekday, unit='D')
    g = d1.groupby(mon)
    out = pd.DataFrame({'o': g['o'].first(), 'h': g['h'].max(), 'l': g['l'].min(), 'c': g['c'].last(),
                        'v': g['v'].sum(min_count=1)})
    last = pd.Series(d1.index, index=d1.index).groupby(mon).last()
    end = out.index + pd.Timedelta(days=4, minutes=SESS[market][1])
    out.index = pd.DatetimeIndex(last.values)
    return out, pd.DatetimeIndex(end)


BUILD = {'1H': bars_1h, 'D': bars_d, 'W': bars_w}


def build(df, tf, market, now_local):
    """回 (bars, final)；final[i]＝該根已收完：結束時間 ≤ 現在；結束在收盤的那根（含日K、週K）要再等 GRACE。"""
    if tf == '4H':
        h1, _ = bars_1h(df, market)
        b, end = bars_4h(h1, market)
    else:
        b, end = BUILD[tf](df, market)
    at_close = _tod(end) == SESS[market][1]
    return b, np.asarray(end + pd.to_timedelta(np.where(at_close, GRACE, 0), unit='s') <= now_local, dtype=bool)


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


def _leg_json(t, leg):
    lt, px, q, why, e = leg
    # shortcut: 同 ta_local，用「該段進場價≠原進場價」認加碼段；兩價剛好相同時只會少標「加碼」二字（損益不受影響）
    is_add = why == '加碼停損' or e != t['entry']
    ab = LEG_ABBR.get(why, why)
    return {'t': A._d(lt), 'px': A._p(px), 'qty': q, 'why': why, 'entry_px': A._p(e), 'is_add': bool(is_add),
            'label': ab if (why == '加碼停損' or not is_add) else '加碼' + ab}


def _add_json(a):
    return None if not a else {'t': A._d(a['t']), 'px': A._p(a['px']), 'stop': A._p(a['stop']), 'qty': a['qty']}


def trade_json(trd, n_bars):
    """ta_trade 原始輸出 → JSON（全部筆數、目前持倉、統計、規則不適用旗標）。"""
    tt = trd['trades']
    st = dict(trd['stats'])
    st.update(start=A._d(st['start']) if st['start'] is not None else None,
              end=A._d(st['end']) if st['end'] is not None else None, bars=int(n_bars),
              n_long=sum(1 for t in tt if t['side'] == 1), n_short=sum(1 for t in tt if t['side'] == -1))
    for k in ('win_rate', 'sum_pct', 'avg_win_pct', 'avg_loss_pct'):
        st[k] = A._f(st[k], 2)
    st['sum_pts'] = A._f(st['sum_pts'], 4)
    bad = st['n'] >= BAD_MIN_N and (st['win_rate'] < BAD_WIN_PCT or st['sum_pct'] < 0)
    banner = {'bad': bool(bad), 'min_n': BAD_MIN_N, 'win_pct': BAD_WIN_PCT,
              'text': ('這套規則在這檔的歷史表現不好（%d 筆、勝率 %.1f%%、合計 %+.1f%%），進出場點不適用'
                       % (st['n'], st['win_rate'], st['sum_pct'])) if bad else None}
    trades = [{'side': t['side'], 'entry_t': A._d(t['entry_t']), 'entry': A._p(t['entry']), 'stop0': A._p(t['stop0']),
               'tp1': A._p(t['tp1']), 'exit_t': A._d(t['exit_t']), 'pts': A._f(t['pts'], 4), 'pct': A._f(t['pct'], 2),
               'vr': A._f(t['vr'], 2), 'add': _add_json(t.get('add')), 'legs': [_leg_json(t, g) for g in t['legs']]}
              for t in tt]
    p = trd['open']
    opn = None if not p else {'side': p['side'], 'entry_t': A._d(p['entry_t']), 'entry': A._p(p['entry']),
                              'stop': A._p(p['stop']), 'stop0': A._p(p['stop0']), 'tp1': A._p(p['tp1']),
                              'tp1_done': bool(p['tp1_done']), 'qty': p['qty'], 'add': _add_json(p.get('add'))}
    return {'trades': trades, 'open': opn, 'stats': st, 'banner': banner, 'note': NOTE_STATS}


def trade_marks(trd, ix):
    """同 ta_local.trade_marks 的畫法，改成資料：markers（箭頭／菱形／✕）＋ lines（i0→i1，i1=None＝延伸到右緣）。
    ix(t)：該時間在圖上第幾根；-1＝在視窗左邊（線從左緣畫、不畫記號）。出場在視窗之前的整筆不畫。"""
    mk, ln = [], []

    def seg(kind, i0, i1, y):
        ln.append({'kind': kind, 'i0': i0, 'i1': i1, 'y': A._p(y)})

    for t in trd['trades']:
        ie, iz = ix(t['entry_t']), ix(t['exit_t'])
        if iz < 0:
            continue
        itp = next((ix(lt) for lt, _p, _q, w, _e in t['legs'] if w.startswith('停利')), None)
        seg('stop', ie, itp if itp is not None else iz, t['stop0'])
        if itp is not None and itp < iz:
            seg('stop_be', itp, iz, t['entry'])                      # 停利一半後停損移到進場價
        seg('tp1', ie, itp if itp is not None else iz, t['tp1'])
        if ie >= 0:
            mk.append({'kind': 'entry', 'i': ie, 'side': t['side'], 'px': A._p(t['entry']),
                       'label': '多進' if t['side'] == 1 else '空進'})
        a = t.get('add')
        if a:
            ia = ix(a['t'])
            ast = next((lt for lt, _p, _q, w, _e in t['legs'] if w == '加碼停損'), None)
            seg('add_stop', ia, ix(ast) if ast is not None else iz, a['stop'])
            if ia >= 0:
                mk.append({'kind': 'add', 'i': ia, 'side': t['side'], 'px': A._p(a['px']), 'label': '加碼'})
        for k, leg in enumerate(t['legs']):
            i = ix(leg[0])
            if i >= 0:
                j = _leg_json(t, leg)
                w = leg[3]
                mk.append({'kind': 'exit', 'i': i, 'side': t['side'], 'px': j['px'], 'why': w, 'label': j['label'],
                           'tone': 'tp' if w.startswith('停利') else 'stop' if w == '停損' else
                           'add_stop' if w == '加碼停損' else 'exit', 'stack': k})
    p = trd['open']
    if p:
        ie = ix(p['entry_t'])
        if p['qty'] > 0:
            seg('open_stop', ie, None, p['stop'])
        seg('open_entry', ie, None, p['entry'])
        seg('open_tp1', ie, None, p['tp1'])
        if ie >= 0:
            mk.append({'kind': 'entry', 'i': ie, 'side': p['side'], 'px': A._p(p['entry']),
                       'label': '多進' if p['side'] == 1 else '空進'})
        a = p.get('add')
        if a:
            ia = ix(a['t'])
            if a['qty'] > 0:
                seg('open_add_stop', ia, None, a['stop'])
            if ia >= 0:
                mk.append({'kind': 'add', 'i': ia, 'side': p['side'], 'px': A._p(a['px']), 'label': '加碼'})
    return mk, ln


def analyze_bars(df, market, final=None):
    """純函式。df：o/h/l/c/v（index＝K 棒時間，舊到新）；final：每根是否定案（None＝全部定案；未定只能在尾巴）。
    訊號、均線排列、進出場回測只用定案 K；圖＝最後 120 根定案 K ＋ 尾巴的盤中未定 K。"""
    df = df[['o', 'h', 'l', 'c', 'v']].astype('float64')
    fin = np.ones(len(df), bool) if final is None else np.asarray(final, bool)
    nf = int(fin.sum())
    if not fin[:nf].all():
        raise ValueError('未定的 K 只能在尾巴')
    dc = df.iloc[:nf]
    if nf < MIN_BARS:
        raise EngineError(422, 'too_few_bars', '只有 %d 根定案 K，至少要 %d 根' % (nf, MIN_BARS))
    sig, _chart = A.compute_signals(dc, market)
    sig['ma_align'] = ma_sets(dc['c'].to_numpy('float64'), dc.index)
    sig['badges']['ma'] = sig['ma_align']['badge']['text']
    raw = trade_signals(dc.rename(columns=REN))
    k0 = max(0, nf - CHART_N)
    w = df.iloc[k0:]
    wf = fin[k0:]
    pos = {A._d(t): i for i, t in enumerate(w.index)}
    first = A._d(w.index[0])

    def ix(t):
        s = t if isinstance(t, str) else A._d(t)
        i = pos.get(s)
        return i if i is not None else (-1 if s < first else len(w) - 1)
    c_all = df['c'].to_numpy('float64')
    sma = {str(n): [A._p(x) for x in A.sma(c_all, n)[k0:]] for n in SMA_NS}
    e10 = df['c'].ewm(span=10, adjust=False).mean().to_numpy()[k0:]       # 同 ta_trade 那條（全歷史 ewm）
    bars = [{'t': A._d(t), 'o': A._p(r.o), 'h': A._p(r.h), 'l': A._p(r.l), 'c': A._p(r.c), 'v': A._f(r.v, 0),
             'final': bool(f)} for t, r, f in zip(w.index, w.itertuples(), wf)]
    tv = [{'rank': x['rank'], 'i': ix(x['date']), 't': x['date'], 'high': x['high'], 'low': x['low'],
           'vol_ratio': x['vol_ratio'], 'read': x.get('read')} for x in sig['top_volume']['items']]
    gaps = [{'i': ix(g['date']), 't': g['date'], 'dir': g['dir'], 'top': g['top'], 'bottom': g['bottom'],
             'fill': g['fill'], 'fill_i': ix(g['fill_date']) if g['fill_date'] else None,
             'open_top': g['open_top'], 'open_bottom': g['open_bottom'], 'type': g.get('type'),
             'type_short': g.get('type_short'), 'island': g.get('island')} for g in sig['gaps']['items']]
    isl = [{'kind': x['kind'], 'name': x['name'], 'i0': ix(x['start']), 'i1': ix(x['end']), 'high': x['high'],
            'low': x['low']} for x in sig['gaps'].get('islands', [])]
    sr = sig['sr_levels']
    srl = [{'kind': k, 'price': x['price'], 'style': 'solid' if k == 'support' else 'dashed', 'color': '#ffffff',
            'pick_scope': x['pick_scope'], 'dist_pct': x['dist_pct']}
           for k in ('support', 'resistance') for x in sr[k]]
    mk, ln = trade_marks(raw, ix)
    trade = trade_json(raw, nf)
    trade.update(markers=mk, lines=ln)
    notes = []
    nv = int(np.isnan(dc['v'].to_numpy()[k0:]).sum())
    if nv:
        notes.append('近 %d 根裡有 %d 根 Yahoo 沒給量（台股盤中第一根常見），量比與前五大量會跳過這些 K' % (nf - k0, nv))
    out = {'asof': A._d(dc.index[-1]), 'bars_total': int(len(df)), 'bars_completed': nf,
           'unfinished': bool(not wf[-1]), 'unfinished_label': UNFINISHED if not wf[-1] else None,
           'chart': {'n': len(bars), 'bars': bars, 'sma': sma, 'ma_sets': {k: list(ns) for k, ns in MA_SETS},
                     'ema10': [A._p(x) for x in e10], 'ema10_label': EMA10_LABEL,
                     'overlays': {'sr': srl, 'top_volume': tv, 'gaps': gaps, 'islands': isl}, 'legend': LEGEND},
           'signals': sig, 'trade': trade, 'notes': notes}
    return _clean(out)


# ═════════════════════════ 對外：run／handle ═════════════════════════

def run(raw, tf, now=None, http=None):
    now = time.time() if now is None else float(now)
    tf = (tf or 'D').upper()
    if tf not in TFS:
        raise EngineError(400, 'bad_tf', '週期只能是 1H、4H、D、W')
    cands, market, code = candidates(raw)
    res = None
    for ysym in cands:
        res, cached, fetched = cached_chart(ysym, TFS[tf], now, http or _http_get)
        if res is not None:
            break
    if res is None:
        raise EngineError(404, 'not_found', '查不到這個代號：%s' % code)
    m = res.get('meta') or {}
    if m.get('instrumentType') not in OK_TYPES:
        raise EngineError(422, 'not_supported', '只支援個股與 ETF（%s 是 %s）' % (code, m.get('instrumentType')))
    tz = m.get('exchangeTimezoneName') or ('Asia/Taipei' if market == 'tw' else 'America/New_York')
    bars, final = build(frame(res, TFS[tf]), tf, market, _local(now, tz))
    out = analyze_bars(bars, market, final)
    out = dict({'ok': True, 'schema': SCHEMA, 'tf': tf,
                'symbol': {'input': raw, 'code': code, 'yahoo': ysym, 'market': market, 'type': m.get('instrumentType'),
                           'name': m.get('longName') or m.get('shortName'), 'exchange': m.get('fullExchangeName'),
                           'currency': m.get('currency'), 'timezone': tz},
                'generated_at': int(now), 'fetched_at': int(fetched), 'cached': bool(cached)}, **out)
    return out


def handle(path, key, secret, now=None, http=None):
    """HTTP 入口（api/engine.py 與本機 dev_server 共用）。回 (status, dict)。先驗金鑰，沒過不碰 Yahoo。"""
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
    man = {'note': '這三個檔是 Skill\\ 的副本，不要在這裡改；改 Skill\\ 再 python ta_engine.py --sync',
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
    ok(a1['signals'] == a2['signals'] and a1['trade'] == a2['trade'] and a1['unfinished'] and not a2['unfinished']
       and a1['chart']['bars'][-1]['final'] is False and a1['chart']['n'] == 121 and a2['chart']['n'] == 120
       and a1['asof'] == a2['asof'] and a1['bars_completed'] == 259,
       '最後一根盤中未定：只上圖（多一根、final=False），訊號與回測跟拿掉它完全一樣')
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
    ok(len(up['chart']['ema10']) == 120 and set(up['chart']['sma']) == {str(n) for n in SMA_NS} and len(js) > 1000,
       '輸出是合法 JSON（無 NaN），EMA10＋8 條 SMA 跟 120 根對齊')

    # 除息還原
    dv = pd.DataFrame([[100, 101, 99, 100, 1], [95, 96, 94, 95, 1]], index=pd.to_datetime(['2026-07-01', '2026-07-02']),
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

    # 授權
    calls.clear()
    sec = 'test-secret'
    good = engine_key(sec)
    ok(good == hmac.new(b'test-secret', b'ta-engine', hashlib.sha256).hexdigest() and len(good) == 64, '金鑰＝HMAC-SHA256(JWT_SECRET, "ta-engine") hex')
    st = [handle('/api/engine?symbol=2330&tf=D', k, s, now, mock)[0] for k, s in
          ((None, sec), ('', sec), ('x' * 64, sec), (good.upper(), sec), (good, None), (good, ''))]
    ok(st == [401] * 6 and calls == [], '沒金鑰／錯金鑰／大寫／JWT_SECRET 沒設 → 401，而且完全沒打 Yahoo')
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
