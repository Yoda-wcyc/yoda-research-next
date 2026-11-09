# -*- coding: utf-8 -*-
r"""ta_trade.py — 均線＋量能進出場規則（Yoda 2026-11-08 · 本機 ta_local 與會員網站版 ta_engine 共用；11-08 Yoda：網站上有開通的人都看得到）

規則（Yoda 11-09 拍板：進場不變，整筆抱到出場訊號，不分批、不移停損）。全部收盤確認、不偷看未來：
  均線  EMA5／10／20＝Close.ewm(span=n, adjust=False)（從序列第一根起算）。
        多頭排列＝EMA5>EMA10>EMA20；空頭排列＝EMA5<EMA10<EMA20。
  量比  vol_ratio 不給時＝本根量 ÷ 前 10 根平均（不含本根；shift(1).rolling(10, min_periods=5)，量缺值不算）。
  進場  （空手時）排列「剛成立」＝本根成立、且前 3 根不是全部成立；＋本根量比 ≥ vol_in（1.2）；
        ＋收盤在 EMA5 同側（多：收>EMA5；空：收<EMA5）。進場價＝本根收盤。先判多、再判空。
        前 25 根當暖身不進場。某根剛出場，同一根不再進場。
  停損  近 3 根（含進場根）最低點（空單：最高點），整筆持有期間固定不動；停損≥進場（空單≤）不進。
        之後每根盤中先查停損：碰到即整筆出，成交價＝min(開盤, 停損)（空單 max）。同一根也觸發下面的出場＝算停損。
  出場  沒碰停損時看收盤，整筆出、成交價＝收盤：
        爆量反向K＝量比 ≥ vol_out（2）＋收反向K（多單收<開；空單收>開）＋收破 EMA5（空單站上）；
        收破10線＝收盤破 EMA10（空單：收盤站上）。兩個同一根都成立時記「爆量反向K」。
損益  trade：side／entry_t／entry／stop／vr／exit_t／exit_px／why／pts＝(出場−進場)×方向／pct＝pts÷進場×100
      （一單位部位、不計手續費滑價）。open：side／entry_t／entry／stop。
統計  wins＝pts>0 的筆數；虧損＝其餘；sum_pct＝各筆 pct 相加（不複利）；max_consec_loss＝最多連續幾筆非獲利。

用法  from ta_trade import trade_signals; r = trade_signals(df)      # df：Open/High/Low/Close/Volume，index＝日期時間
      python "G:\Yoda x Claude\Skill\ta_trade.py" --selftest
"""
import sys
import numpy as np
import pandas as pd

WARM = 25          # nq_sys.py：for i in range(25, len(b))


def vol_ratio_prev(vol, n=10):
    """本根量 ÷ 前 n 根平均（不含本根）。"""
    v = pd.Series(vol, dtype='float64')
    return v / v.shift(1).rolling(n, min_periods=5).mean()


def trade_signals(df, vol_ratio=None, vol_in=1.2, vol_out=2.0):
    idx = df.index
    O, H, L, C = (df[k].to_numpy('float64') for k in ('Open', 'High', 'Low', 'Close'))
    cs = df['Close'].astype('float64')
    E5, E10, E20 = (cs.ewm(span=n, adjust=False).mean().to_numpy() for n in (5, 10, 20))
    if vol_ratio is None:
        vr = vol_ratio_prev(df['Volume'].to_numpy('float64')).to_numpy()
    else:
        vr = np.asarray(vol_ratio, dtype='float64')
    up = (E5 > E10) & (E10 > E20)
    dn = (E5 < E10) & (E10 < E20)
    trades, pos = [], None
    for i in range(WARM, len(df)):
        t = idx[i]
        if pos:   # 持倉：盤中先查停損（優先）；沒碰再看收盤出場；都是整筆出
            s, st = pos['side'], pos['stop']
            ma_exit = (C[i] < E10[i]) if s == 1 else (C[i] > E10[i])
            vol_exit = vr[i] >= vol_out and ((C[i] < O[i] and C[i] < E5[i]) if s == 1 else (C[i] > O[i] and C[i] > E5[i]))
            if (L[i] <= st) if s == 1 else (H[i] >= st):
                leg = (t, min(O[i], st) if s == 1 else max(O[i], st), '停損')
            elif vol_exit or ma_exit:
                leg = (t, C[i], '爆量反向K' if vol_exit else '收破10線')
            else:
                leg = None
            if leg:
                pos.update(exit_t=t, exit_px=leg[1], why=leg[2], pts=(leg[1] - pos['entry']) * s)
                pos['pct'] = pos['pts'] / pos['entry'] * 100
                trades.append(pos)
                pos = None
                continue
        if pos is None:   # 進場：排列剛成立（前 3 根不是全部成立）＋本根帶量＋收在 EMA5 同側
            for s, col in ((1, up), (-1, dn)):
                fresh = col[i] and not col[i - 3:i].all()
                side_ok = (C[i] > E5[i]) if s == 1 else (C[i] < E5[i])
                if fresh and side_ok and vr[i] >= vol_in:
                    stop = L[i - 2:i + 1].min() if s == 1 else H[i - 2:i + 1].max()
                    if (C[i] - stop) * s <= 0:
                        continue
                    pos = dict(side=s, entry=C[i], entry_t=t, stop=stop, vr=vr[i])
                    break
    opn = None if pos is None else {k: pos[k] for k in ('side', 'entry_t', 'entry', 'stop')}
    return {'trades': trades, 'open': opn, 'stats': _stats(trades, idx)}


def _stats(trades, idx):
    pct = [t['pct'] for t in trades]
    wins = [p for t, p in zip(trades, pct) if t['pts'] > 0]
    loss = [p for t, p in zip(trades, pct) if t['pts'] <= 0]
    mcl = run = 0
    for t in trades:
        run = 0 if t['pts'] > 0 else run + 1
        mcl = max(mcl, run)
    n = len(trades)
    return {'n': n, 'wins': len(wins), 'win_rate': (len(wins) / n * 100) if n else None,
            'sum_pts': sum(t['pts'] for t in trades), 'sum_pct': sum(pct),
            'avg_win_pct': (sum(wins) / len(wins)) if wins else None,
            'avg_loss_pct': (sum(loss) / len(loss)) if loss else None,
            'max_consec_loss': mcl,
            'start': idx[0] if len(idx) else None, 'end': idx[-1] if len(idx) else None}


# ═════════════════════════ 自檢 ═════════════════════════

def _mk(rows):
    return pd.DataFrame(rows, columns=['Open', 'High', 'Low', 'Close', 'Volume'],
                        index=pd.bdate_range('2024-01-01', periods=len(rows)))


def _base():
    """40 根緩跌（量 1000、不帶量所以不進場）→ 緩漲直到多頭排列剛成立那根放量 2000＝進場根。回 (rows, 進場根 index)。"""
    rows, c = [], 100.0
    for _ in range(40):
        rows.append([c + .1, c + .4, c - .5, c - .2, 1000]); c -= .2
    while True:
        rows.append([c, c + 1.3, c - .3, c + 1.0, 1000]); c += 1.0
        cs = _mk(rows).Close
        e = [cs.ewm(span=n, adjust=False).mean().iloc[-1] for n in (5, 10, 20)]
        if e[0] > e[1] > e[2]:
            rows[-1][4] = 2000
            return rows, len(rows) - 1


def _ema(rows, n):
    return _mk(rows).Close.ewm(span=n, adjust=False).mean().iloc[-1]


def selftest():
    bad = []

    def ok(cond, msg):
        print(('  ok  ' if cond else '  FAIL') + ' ' + msg)
        if not cond:
            bad.append(msg)

    rows, e = _base()
    ix = _mk(rows).index
    r = trade_signals(_mk(rows))
    p = r['open']
    ok(p is not None and p['side'] == 1 and p['entry_t'] == ix[e] and not r['trades'] and set(p) == {'side', 'entry_t', 'entry', 'stop'},
       '剛成立＋帶量＋收在 EMA5 上 → 進多單、目前持倉（只有方向／進場時間／進場價／停損）')
    entry, stop = p['entry'], p['stop']
    R = entry - stop
    ok(abs(stop - min(x[2] for x in rows[e - 2:e + 1])) < 1e-9 and R > 0, '停損＝近 3 根最低')

    def climb(rs, k, step=.5):
        rs = list(rs)
        for _ in range(k):
            c = rs[-1][3]
            rs.append([c, c + step + .1, c - .2, c + step, 1000])
        return rs

    # A 漲過 2 倍風險 → 不出、停損不動
    ra = climb(rows, 2, step=1.2 * R)
    ok(max(x[1] for x in ra[e + 1:]) > entry + 2 * R and min(x[2] for x in ra[e + 1:]) > stop, '（前提）漲過進場＋2 倍風險、沒碰停損')
    pa = trade_signals(_mk(ra))
    ok(not pa['trades'] and pa['open'] and abs(pa['open']['stop'] - stop) < 1e-9 and pa['open']['entry_t'] == ix[e],
       '漲過 2 倍風險不出一半、停損不移，整筆續抱')

    # B 漲過 2 倍風險後跌回原停損 → 整筆停損出（停損價＝原停損，不是進場價）
    c = ra[-1][3]
    rb = ra + [[c, c + .1, stop - 1, stop - .5, 1000]]
    t = trade_signals(_mk(rb))['trades']
    ok(len(t) == 1 and t[0]['why'] == '停損' and abs(t[0]['exit_px'] - stop) < 1e-9 and abs(t[0]['stop'] - stop) < 1e-9
       and abs(t[0]['pts'] - (stop - entry)) < 1e-9 and t[0]['pts'] < 0, '漲過 2 倍風險後跌回原停損 → 整筆停損，成交＝原停損（沒移到進場價）')
    rb2 = rows + [[stop - 2, stop - 1, stop - 3, stop - 2, 1000]]
    ok(abs(trade_signals(_mk(rb2))['trades'][0]['exit_px'] - (stop - 2)) < 1e-9, '跳空開在停損下 → 成交價＝開盤')
    rb3 = rows + [[entry + .5, entry + 3 * R, stop - 1, entry - 5, 3000]]
    t = trade_signals(_mk(rb3))['trades'][0]
    ok(t['why'] == '停損' and abs(t['exit_px'] - stop) < 1e-9, '同一根碰停損又收破 10 線／爆量反向K → 算停損')

    # C 收破 EMA10（沒碰停損、量普通）→ 整筆出、收盤價
    rc = climb(rows, 4)
    e10 = _ema(rc, 10)
    c = rc[-1][3]
    cl = e10 - .2
    rc.append([c, c + .1, cl - .1, cl, 1000])
    ok(cl - .1 > stop and cl < _ema(rc, 10), '（前提）收在 EMA10 下、低點沒碰停損')
    t = trade_signals(_mk(rc))['trades']
    ok(len(t) == 1 and t[0]['why'] == '收破10線' and abs(t[0]['exit_px'] - cl) < 1e-9 and abs(t[0]['pts'] - (cl - entry)) < 1e-9,
       '收破 EMA10 → 收盤價整筆出')

    # D 爆量反向K：收在 EMA5 下、EMA10 上，量 3 倍、收黑 → 整筆出；量不到 2 倍 → 不出
    rd = climb(rows, 2)
    e5, e10 = _ema(rd, 5), _ema(rd, 10)
    cl = e5 - .1
    rd.append([cl + 1, cl + 1.2, cl - .2, cl, 3000])
    ok(cl - .2 > stop and _ema(rd, 10) < cl < _ema(rd, 5), '（前提）反向K 收在 EMA5 下、EMA10 上，低點高於停損')
    t = trade_signals(_mk(rd))['trades']
    ok(len(t) == 1 and t[0]['why'] == '爆量反向K' and abs(t[0]['exit_px'] - cl) < 1e-9, '爆量（≥2 倍）收黑且收破 EMA5 → 收盤價整筆出')
    rd[-1][4] = 1500
    ok(not trade_signals(_mk(rd))['trades'], '同一根量不到 2 倍 → 不出')

    # E 排列已成立很久才放量 → 不進；剛成立那根才進
    rows_d, c = [], 100.0
    for k in range(70):
        rows_d.append([c, c + 1.3, c - .3, c + 1.0, 1000]); c += 1.0
    df_d = _mk(rows_d)
    e5, e10, e20 = (df_d.Close.ewm(span=n, adjust=False).mean() for n in (5, 10, 20))
    upd = ((e5 > e10) & (e10 > e20)).to_numpy()
    ok(upd[30:61].all(), '（前提）第 30～60 根一路多頭排列')
    rows_d[60][4] = 3000
    ok(trade_signals(_mk(rows_d))['open'] is None and not trade_signals(_mk(rows_d))['trades'],
       '排列已成立 30 根以上才放量 → 不進場')

    # F 空單鏡像：價格上下翻 → 同樣出場原因、同樣點數
    for src in (rb, rc):
        mir = [[200 - o, 200 - lo, 200 - hi, 200 - cc, v] for o, hi, lo, cc, v in src]
        a_, m_ = trade_signals(_mk(src))['trades'], trade_signals(_mk(mir))['trades']
        ok(len(m_) == 1 and m_[0]['side'] == -1 and m_[0]['why'] == a_[0]['why'] and abs(m_[0]['pts'] - a_[0]['pts']) < 1e-6,
           '空單鏡像（%s）' % a_[0]['why'])

    # 統計欄位
    s = trade_signals(_mk(rc))['stats']
    ok(s['n'] == 1 and s['wins'] == (1 if rc[-1][3] > entry else 0) and s['max_consec_loss'] == (0 if rc[-1][3] > entry else 1)
       and 'adds' not in s, 'stats 筆數／勝率／連虧')
    print('selftest %s（%d 項失敗）' % ('全過' if not bad else '有失敗', len(bad)))
    return not bad


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    if '--selftest' in sys.argv:
        sys.exit(0 if selftest() else 1)
    print(__doc__)
