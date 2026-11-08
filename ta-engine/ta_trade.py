# -*- coding: utf-8 -*-
r"""ta_trade.py — 均線＋量能進出場規則（Yoda 2026-11-08 · 本機 ta_local 與會員網站版 ta_engine 共用；11-08 Yoda：網站上有開通的人都看得到）

規則正本＝scratchpad nq_sys.py（NQ 4h，EARLY=0、RR=2），本檔一字不改搬成純函式。全部收盤確認、不偷看未來：
  均線  EMA5／10／20＝Close.ewm(span=n, adjust=False)（從序列第一根起算）。
        多頭排列＝EMA5>EMA10>EMA20；空頭排列＝EMA5<EMA10<EMA20。
  量比  vol_ratio 不給時＝本根量 ÷ 前 10 根平均（不含本根；shift(1).rolling(10, min_periods=5)，量缺值不算）。
  進場  （空手時）排列「剛成立」＝本根成立、且前 3 根不是全部成立；＋本根量比 ≥ vol_in（1.2）；
        ＋收盤在 EMA5 同側（多：收>EMA5；空：收<EMA5）。進場價＝本根收盤。先判多、再判空。
        前 25 根當暖身不進場。某根剛出場，同一根不再進場。
  停損  近 3 根（含進場根）最低點（空單：最高點）。R＝|進場−停損|，R≤0 不進。
        之後每根盤中先查停損：碰到即全部出，成交價＝min(開盤, 停損)（空單 max）；已停利一半後這筆叫「保本出」。
  停利  到 進場 ± rr×R（2R）先出一半（成交價＝該價位），停損移到進場價。同一根同時碰停損與停利＝算停損。
  剩一半 收盤破 EMA10（空單：收盤站上）→ 收盤價出（「收破10線」）。
  爆量反向K 量比 ≥ vol_out（2）＋收反向K（多單收<開；空單收>開）＋收破 EMA5（空單站上）→ 收盤價全出，
        停利前後都適用（停利前就是整筆出）。
加碼  （pyramid=True，Yoda 11-08 拍板；False＝完全等於舊規則）只在停利一半之後（停損已在保本）：
        某根（停利那根之後）低點碰到／穿過 EMA10、但收盤在 EMA10 上（空單：高點碰、收在下）＝回測沒收破；
        緊接的下一根收在 EMA5 上（空單：下）＋量比 ≥ vol_in → 該根收盤加 0.5 單位。
        加碼停損＝近 3 根（含加碼根）最低（空單最高），碰到只出加碼那 0.5（「加碼停損」）；原單一半仍守保本停損。
        之後剩下的（原單一半＋加碼）一起照「剩一半」規則出。一筆最多加碼一次。同一根先查所有停損、再看其他。
損益  legs＝(時間, 成交價, qty, 原因, 該段進場價)；pts＝Σ 各段 qty×(成交−該段進場)×方向（qty：整筆 1、一半 0.5、加碼 0.5）；
      pct＝pts÷原進場×100（一單位部位、不計手續費滑價）。trade['add']＝None 或 {t, px, stop, qty}（qty 0＝已出）。
統計  adds＝有加碼的筆數；wins＝pts>0 的筆數；虧損＝其餘；sum_pct＝各筆 pct 相加（不複利）；max_consec_loss＝最多連續幾筆非獲利。

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


def trade_signals(df, vol_ratio=None, rr=2.0, vol_in=1.2, vol_out=2.0, pyramid=True):
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
        if pos:   # 持倉管理：盤中先停損（原單、加碼各自的停損）、再停利；同根都碰到算停損
            s, a = pos['side'], pos['add']

            def hit(st):
                return L[i] <= st if s == 1 else H[i] >= st

            def fill(st):
                return min(O[i], st) if s == 1 else max(O[i], st)
            if pos['qty'] > 0 and hit(pos['stop']):
                pos['legs'].append((t, fill(pos['stop']), pos['qty'], '停損' if not pos['tp1_done'] else '保本出', pos['entry']))
                pos['qty'] = 0
            if a and a['qty'] > 0 and hit(a['stop']):
                pos['legs'].append((t, fill(a['stop']), a['qty'], '加碼停損', a['px']))
                a['qty'] = 0
            if pos['qty'] > 0 and not pos['tp1_done'] and ((H[i] >= pos['tp1']) if s == 1 else (L[i] <= pos['tp1'])):
                pos['legs'].append((t, pos['tp1'], 0.5, '停利一半(2R)', pos['entry']))
                pos['qty'] = 0.5
                pos['tp1_done'] = True
                pos['tp1_i'] = i
                pos['stop'] = pos['entry']
            ma_exit = (C[i] < E10[i]) if s == 1 else (C[i] > E10[i])
            vol_exit = vr[i] >= vol_out and ((C[i] < O[i] and C[i] < E5[i]) if s == 1 else (C[i] > O[i] and C[i] > E5[i]))
            aq = a['qty'] if a else 0
            if pos['qty'] + aq > 0 and (vol_exit or (pos['tp1_done'] and ma_exit)):   # 剩下的（原單＋加碼）一起出
                why = '爆量反向K' if vol_exit else '收破10線'
                if pos['qty'] > 0:
                    pos['legs'].append((t, C[i], pos['qty'], why, pos['entry']))
                if aq > 0:
                    pos['legs'].append((t, C[i], aq, why, a['px']))
                pos['qty'] = 0
                if a:
                    a['qty'] = 0
            elif pyramid and pos['tp1_done'] and a is None and pos['qty'] > 0:
                # 加碼：前一根回測碰 EMA10 沒收破 → 本根收在 EMA5 外側＋量比 ≥ vol_in → 收盤加 0.5，停損＝近 3 根（含本根）低點
                if pos['touch_i'] == i - 1 and vr[i] >= vol_in and ((C[i] > E5[i]) if s == 1 else (C[i] < E5[i])):
                    ast = L[i - 2:i + 1].min() if s == 1 else H[i - 2:i + 1].max()
                    if (C[i] - ast) * s > 0:
                        pos['add'] = dict(t=t, px=C[i], stop=ast, qty=0.5)
                if pos['add'] is None and i > pos['tp1_i'] and                         ((L[i] <= E10[i] <= C[i]) if s == 1 else (H[i] >= E10[i] >= C[i])):
                    pos['touch_i'] = i
            if pos['qty'] == 0 and not (pos['add'] and pos['add']['qty'] > 0):
                pos['exit_t'] = t
                pos['pts'] = sum(q * (px - e) * pos['side'] for _, px, q, _, e in pos['legs'])
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
                    R = abs(C[i] - stop)
                    if R <= 0:
                        continue
                    pos = dict(side=s, entry=C[i], entry_t=t, stop=stop, stop0=stop, tp1=C[i] + s * rr * R,
                               qty=1.0, tp1_done=False, legs=[], vr=vr[i], add=None, tp1_i=None, touch_i=None)
                    break
    for tr in trades:
        for k in ('qty', 'stop', 'tp1_done', 'tp1_i', 'touch_i'):
            tr.pop(k, None)
    opn = None if pos is None else {k: pos[k] for k in ('side', 'entry_t', 'entry', 'stop', 'stop0', 'tp1', 'tp1_done', 'qty', 'add')}
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
            'max_consec_loss': mcl, 'adds': sum(1 for t in trades if t.get('add')),
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
    r = trade_signals(_mk(rows))
    p = r['open']
    ok(p is not None and p['side'] == 1 and p['entry_t'] == _mk(rows).index[e] and not r['trades'],
       '剛成立＋帶量＋收在 EMA5 上 → 進多單、目前持倉')
    entry, stop, tp1 = p['entry'], p['stop'], p['tp1']
    ok(abs(stop - min(x[2] for x in rows[e - 2:e + 1])) < 1e-9 and abs(tp1 - (entry + 2 * (entry - stop))) < 1e-9,
       '停損＝近 3 根最低、停利一半＝進場＋2R')

    # A 同根同時碰停損與停利 → 算停損，成交 min(開, 停損)
    ra = trade_signals(_mk(rows + [[entry + .5, tp1 + 1, stop - 1, entry, 1000]]))
    t = ra['trades'][0] if ra['trades'] else {}
    ok(len(ra['trades']) == 1 and len(t['legs']) == 1 and t['legs'][0][3] == '停損' and t['legs'][0][2] == 1.0
       and abs(t['legs'][0][1] - stop) < 1e-9 and t['pts'] < 0, '同一根碰停損也碰 2R → 整筆停損（不先停利）')
    ra2 = trade_signals(_mk(rows + [[stop - 2, stop - 1, stop - 3, stop - 2, 1000]]))
    ok(abs(ra2['trades'][0]['legs'][0][1] - (stop - 2)) < 1e-9, '跳空開在停損下 → 成交價＝開盤')

    # B 到 2R 出一半、停損移保本；下一根跌回進場價 → 保本出
    up1 = [tp1 - 1, tp1 + .5, tp1 - 1.5, tp1, 1000]
    rb = trade_signals(_mk(rows + [up1]))
    ok(rb['open'] and rb['open']['tp1_done'] and abs(rb['open']['stop'] - entry) < 1e-9 and not rb['trades'],
       '到 2R → 停利一半、停損移到進場價、剩一半續抱')
    rb2 = trade_signals(_mk(rows + [up1, [entry + 1, entry + 1.5, entry - 2, entry - 1, 1000]]))
    t = rb2['trades'][0]
    ok([x[3] for x in t['legs']] == ['停利一半(2R)', '保本出'] and abs(t['legs'][1][1] - entry) < 1e-9
       and abs(t['pts'] - .5 * (tp1 - entry)) < 1e-9, '跌回進場價 → 保本出，整筆＝0.5×2R')

    # C 爆量反向K：先兩根小漲把 EMA5 拉離停損，再一根量 3 倍、收黑、收破 EMA5、沒碰停損 → 整筆出
    rc = list(rows)
    for _ in range(2):
        c = rc[-1][3]
        rc.append([c, c + .6, c - .2, c + .5, 1000])
    e5 = _ema(rc, 5)
    cl = e5 - .1
    ok(cl - .2 > stop and rc[-1][3] + .6 < tp1, '（前提）反向K 收在 EMA5 下但低點高於停損、前面沒碰 2R')
    rc.append([cl + 1, cl + 1.2, cl - .2, cl, 3000])
    t = trade_signals(_mk(rc))['trades']
    ok(len(t) == 1 and t[0]['legs'][0][3] == '爆量反向K' and t[0]['legs'][0][2] == 1.0 and abs(t[0]['legs'][0][1] - cl) < 1e-9,
       '爆量（≥2 倍）收黑且收破 EMA5 → 收盤價全出')
    rc[-1][4] = 1500
    ok(not trade_signals(_mk(rc))['trades'], '同一根量不到 2 倍 → 不出（停利前不看 10 線）')

    # D 排列已成立很久才放量 → 不進；剛成立那根才進
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

    # 統計欄位
    s = rb2['stats']
    ok(s['n'] == 1 and s['wins'] == 1 and s['win_rate'] == 100 and s['max_consec_loss'] == 0, 'stats 筆數／勝率／連虧')

    # E 加碼：停利一半後再漲 4 根 → 回測碰 EMA10 收在上面（touch）→ 下一根收在 EMA5 上＋量比 ≥1.2 → 加 0.5
    def climb(rs, k=4):
        rs = list(rs)
        for _ in range(k):
            c = rs[-1][3]
            rs.append([c, c + .6, c - .2, c + .5, 1000])
        return rs

    def touch(rs, below=False):
        e10, c = _ema(rs, 10), rs[-1][3]
        return rs + [[c, c + .1, e10 - .2, e10 - (.3 if below else -.3), 1000]]

    def addbar(rs, vol=2000, under=False):
        e5, c = _ema(rs, 5), rs[-1][3]
        cl = e5 - .1 if under else e5 + 1
        return rs + [[c, cl + .2, c - .1, cl, vol]]
    re_ = addbar(touch(climb(rows + [up1])))
    pe = trade_signals(_mk(re_))['open']
    a = pe and pe['add']
    ok(bool(a) and a['t'] == _mk(re_).index[-1] and abs(a['px'] - re_[-1][3]) < 1e-9
       and abs(a['stop'] - min(x[2] for x in re_[-3:])) < 1e-9 and a['stop'] > entry,
       '停利一半後：碰 EMA10 收在上 → 下一根收 EMA5 上＋帶量 → 收盤加碼 0.5，加碼停損＝近 3 根最低')
    pf = trade_signals(_mk(re_), pyramid=False)['open']
    ok(pf and pf['add'] is None and {k: pf[k] for k in pf if k != 'add'} == {k: pe[k] for k in pe if k != 'add'},
       'pyramid=False → 同一段不加碼，其餘持倉欄位相同')
    pre = addbar(touch(climb(rows)))
    ok(min(x[2] for x in pre[e + 1:]) > stop and max(x[1] for x in pre[e + 1:]) < tp1,
       '（前提）停利前的同樣型態：沒碰停損、也沒碰 2R')
    ok(trade_signals(_mk(pre))['open']['add'] is None, '還沒停利一半 → 不加碼')
    base_t = touch(climb(rows + [up1]))
    ok(trade_signals(_mk(addbar(base_t, vol=1000)))['open']['add'] is None
       and trade_signals(_mk(addbar(base_t, under=True)))['open']['add'] is None,
       '下一根量比 <1.2、或收在 EMA5 下 → 不加碼')
    tb = trade_signals(_mk(addbar(touch(climb(rows + [up1]), below=True))))
    ok(len(tb['trades']) == 1 and tb['trades'][0]['legs'][-1][3] == '收破10線' and tb['trades'][0]['add'] is None,
       '回測那根收破 EMA10 → 是出場不是加碼')
    r2 = addbar(touch(re_))
    ok(min(x[2] for x in r2[-2:]) > a['stop'], '（前提）第二次碰 10 線沒碰加碼停損')
    p2 = trade_signals(_mk(r2))['open']
    ok(p2 and p2['add']['t'] == a['t'], '一筆最多加碼一次')
    c = re_[-1][3]
    rs_ = re_ + [[c, c + .2, a['stop'] - .1, c, 1000]]
    ok(rs_[-1][3] > _ema(rs_, 10), '（前提）碰加碼停損那根收在 EMA10 上')
    ps = trade_signals(_mk(rs_))
    ok(ps['open'] and not ps['trades'] and ps['open']['qty'] == .5 and ps['open']['add']['qty'] == 0
       and ps['open']['add'] and abs(ps['open']['add']['stop'] - a['stop']) < 1e-9,
       '碰加碼停損 → 只出加碼那 0.5，原單一半續抱')
    rj = re_ + [[c, c + .1, a['stop'] + .05, a['stop'] + .3, 1000]]
    cl = rj[-1][3]
    ok(cl < _ema(rj, 10), '（前提）出場那根收破 EMA10、低點沒碰加碼停損')
    tj = trade_signals(_mk(rj))['trades']
    want = .5 * (tp1 - entry) + .5 * (cl - entry) + .5 * (cl - a['px'])
    ok(len(tj) == 1 and [(x[3], x[4]) for x in tj[0]['legs']] == [('停利一半(2R)', entry), ('收破10線', entry), ('收破10線', a['px'])]
       and abs(tj[0]['pts'] - want) < 1e-9 and abs(tj[0]['pct'] - want / entry * 100) < 1e-9,
       '收破 10 線 → 原單一半＋加碼一起出；損益各段用自己的進場價、pct 對原進場價')
    tf = trade_signals(_mk(rj), pyramid=False)
    ok([x[3] for x in tf['trades'][0]['legs']] == ['停利一半(2R)', '收破10線']
       and abs(tf['trades'][0]['pts'] - (.5 * (tp1 - entry) + .5 * (cl - entry))) < 1e-9 and tf['stats']['adds'] == 0
       and trade_signals(_mk(rj))['stats']['adds'] == 1, 'pyramid=False → 舊結果；stats.adds 算加碼筆數')
    mir = [[200 - o, 200 - lo, 200 - hi, 200 - cc, v] for o, hi, lo, cc, v in rj]   # 價格上下翻 → 空單鏡像
    tm = trade_signals(_mk(mir))['trades']
    ok(len(tm) == 1 and tm[0]['side'] == -1 and tm[0]['add'] and [x[3] for x in tm[0]['legs']] == [x[3] for x in tj[0]['legs']]
       and abs(tm[0]['pts'] - tj[0]['pts']) < 1e-6, '空單鏡像：同樣加碼、同樣出場、同樣點數')
    print('selftest %s（%d 項失敗）' % ('全過' if not bad else '有失敗', len(bad)))
    return not bad


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    if '--selftest' in sys.argv:
        sys.exit(0 if selftest() else 1)
    print(__doc__)
