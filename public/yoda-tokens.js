/* yoda-tokens.js — 樣式 JSON → CSS（瀏覽器端算繪，與 Skill/yoda_tokens.py 的 render() 同一套規則）
 *
 * ⚠ 這支跟 Skill/yoda_tokens.py 是「兩個實作、一組規則」。改任一邊都要跑：
 *      python "G:\Yoda x Claude\Skill\tokens_parity.py"
 *   它會拿樣式庫每一套 × 每個家族比對兩邊輸出，逐字不同就報錯。
 *
 * 用法：YodaTokens.render(styleJson, family, override, forceColors) → CSS 字串
 */
(function (root) {
  var COLOR_MAP = {
    fmfb: { bg: ['--bg'], surface: ['--surface'], surface2: ['--surface2'], border: ['--border'],
            text: ['--text'], text2: ['--text2'], dim: ['--dim'], accent: ['--accent'],
            up: ['--red'], down: ['--green'], warn: ['--yellow'], orange: ['--orange'] },
    apple: { bg: ['--bg'], surface: ['--bg2'], surface2: ['--bg3', '--bg4'], border: ['--border', '--border2'],
             text: ['--text'], text2: ['--text2'], dim: ['--text3', '--muted'], accent: ['--accent', '--accent3'],
             up: ['--up'], down: ['--down'], warn: ['--accent2'], orange: ['--accent2'] },
    brief: { bg: ['--bg'], surface: ['--bg2'], surface2: ['--bg3', '--bg4'], border: ['--border', '--border2'],
             text: ['--text'], text2: ['--text2'], dim: ['--text3', '--muted'], accent: ['--accent3'],
             up: ['--danger'], down: ['--accent'], warn: ['--accent2'], orange: ['--accent2'] },
    forecast: { bg: ['--bg'], surface: ['--surface'], surface2: ['--surface2', '--bg2'], border: ['--border'],
                text: ['--text'], text2: ['--dim'], dim: ['--faint'], accent: ['--accent'],
                up: ['--up'], down: ['--down'], warn: ['--warn'], orange: ['--orange'] },
    shell: { bg: ['--bg'], surface: ['--surface'], surface2: ['--surface'], border: ['--border'],
             text: ['--text'], text2: ['--dim'], dim: ['--dim'], accent: ['--gold'],
             up: ['--up'], down: ['--down'], warn: ['--warn'], orange: ['--orange'] },
    key: {}
  };
  var FONT_MAP = {
    fmfb: { ui: ['--fb'], data: ['--fm'], narrative: [] },
    apple: { ui: ['--sans'], data: ['--mono'], narrative: ['--serif'] },
    brief: { ui: ['--sans'], data: ['--mono'], narrative: ['--serif'] },
    key: { ui: ['--sans'], data: ['--mono', '--fm'], narrative: ['--serif'] },
    forecast: { ui: ['--sans'], data: ['--mono'], narrative: [] },
    shell: { ui: ['--sans'], data: [], narrative: [] }
  };
  var LIGHT_SEL = { fmfb: 'body.light', apple: '[data-theme="light"]', brief: '[data-theme="light"]',
                    key: '[data-theme="light"]', forecast: ':root[data-theme="light"]', shell: null };
  var DARK_SEL = { fmfb: ':root', apple: ':root,[data-theme="dark"]', brief: ':root,[data-theme="dark"]',
                   key: ':root,[data-theme="dark"]', forecast: ':root', shell: ':root' };
  var FONT_STACKS = {
    sans: "-apple-system,BlinkMacSystemFont,'PingFang TC','Microsoft JhengHei','Noto Sans TC','Segoe UI',sans-serif",
    serif: "'Noto Serif TC',Georgia,serif",
    mono: "'SF Mono','Consolas','Monaco','Courier New',monospace"
  };
  var SHAPE_KEY = { radiusS: 'r-s', radiusM: 'r-m', radiusPill: 'r-pill', borderW: 'bw', borderLead: 'bw-lead' };
  var TYPE_FAMILY = { us_stock: 'fmfb', tw_stock: 'fmfb', mw: 'fmfb', hub: 'fmfb',
                      md: 'apple', 'ai-bubble': 'apple', pro: 'apple', topic: 'apple',
                      brief: 'brief', key: 'key', forecast: 'forecast', 'free-shell': 'shell' };

  function decl(name, val, imp) { return '  ' + name + ':' + val + (imp ? ' !important' : '') + ';\n'; }
  function items(d) {
    var out = [];
    for (var k in (d || {})) {
      if (!Object.prototype.hasOwnProperty.call(d, k)) continue;
      var v = d[k];
      if (k.charAt(0) !== '_' && (typeof v === 'string' || typeof v === 'number')) out.push([k, v]);
    }
    return out;
  }
  function num(v) { /* 讓 1.0 印成 1.0（對齊 Python repr 行為）*/ return String(v); }

  function render(style, family, override, forceColors) {
    style = style || {}; family = family || 'fmfb';
    var imp = !!override;
    var T = style.typography || {}, C = style.colors || {}, S = style.shape || {};
    var SP = style.spacing || {}, TB = style.table || {}, MO = style.motion || {};
    var fonts = T.fonts || {};
    var stacks = {}; for (var k0 in FONT_STACKS) stacks[k0] = FONT_STACKS[k0];
    var custom = fonts.stacks || {}; for (var k1 in custom) stacks[k1] = custom[k1];
    var meta = style.meta || {};
    var out = ['/* yoda-tokens · 樣式「' + (meta.name || '?') + '」 v' + (meta.version || '?') +
               ' · family=' + family + (override ? ' · override' : '') + ' */\n'];

    var root = '';
    root += decl('--fs', (T.base === undefined ? 24 : T.base) + 'px', false);
    items(T.ladder).forEach(function (e) { root += decl('--fs-' + e[0], 'calc(var(--fs)*' + num(e[1]) + '*var(--fs-scale,1)*var(--scale,1))', imp); });
    ['narrative', 'data', 'ui'].forEach(function (role) {
      var val = fonts[role];
      if (val) root += decl('--ff-' + (role === 'narrative' ? 'narr' : role), stacks[val] || val, imp);
    });
    items(T.lineHeights).forEach(function (e) { root += decl('--lh-' + e[0], num(e[1]), imp); });
    items(T.weights).forEach(function (e) { root += decl('--fw-' + e[0], num(e[1]), imp); });
    var ls = T.letterSpacing || {};
    items(ls).forEach(function (e) { if (e[0] !== 'unit') root += decl('--ls-' + e[0], num(e[1]) + (ls.unit || 'em'), imp); });
    var u = S.unit || 'px';
    items(S).forEach(function (e) {
      if (e[0] === 'unit') return;
      root += decl('--' + (SHAPE_KEY[e[0]] || e[0]), num(e[1]) + (typeof e[1] === 'number' ? u : ''), imp);
    });
    if (SP.unit) {
      root += decl('--sp', SP.unit + 'px', imp);
      [2, 3, 4, 6, 8].forEach(function (i) { root += decl('--sp' + i, (SP.unit * i) + 'px', imp); });
    }
    if (TB && Object.keys(TB).length) {
      var cp = TB.cellPadding || null;
      if (cp) root += decl('--tbl-pad', (cp.top === undefined ? 6 : cp.top) + 'px ' + (cp.right === undefined ? 10 : cp.right) +
        'px ' + (cp.bottom === undefined ? 6 : cp.bottom) + 'px ' + (cp.left === undefined ? 10 : cp.left) + 'px', imp);
      root += decl('--tbl-zebra', TB.zebra ? 'var(--c-surface2)' : 'transparent', imp);
      if (TB.rowHeight) root += decl('--tbl-row-h', TB.rowHeight + 'px', imp);
      if (TB.headerHeight) root += decl('--tbl-head-h', TB.headerHeight + 'px', imp);
      if (TB.minColWidth) root += decl('--tbl-min-col', TB.minColWidth + 'px', imp);
    }
    if (MO.transition !== undefined && MO.transition !== null) root += decl('--tr', num(MO.transition) + (MO.unit || 's'), imp);
    var fm = FONT_MAP[family] || {};
    for (var role2 in fm) {
      var val2 = fonts[role2];
      if (!val2) continue;
      fm[role2].forEach(function (n) { root += decl(n, stacks[val2] || val2, imp); });
    }
    out.push(':root{\n' + root + '}\n');

    var cmap = COLOR_MAP[family] || {};
    if (family === 'key' && forceColors) cmap = COLOR_MAP.apple;
    function block(theme) {
      var pal = C[theme] || {}, s = '';
      for (var k in pal) {
        if (!Object.prototype.hasOwnProperty.call(pal, k)) continue;
        var v = pal[k];
        if (k.charAt(0) === '_' || typeof v !== 'string') continue;
        s += decl('--c-' + k, v, imp);
        (cmap[k] || []).forEach(function (n) { s += decl(n, v, imp); });
      }
      return s;
    }
    var dk = block('dark');
    if (dk) out.push(DARK_SEL[family] + '{\n' + dk + '}\n');
    var lt = block('light');
    if (lt && LIGHT_SEL[family]) out.push(LIGHT_SEL[family] + '{\n' + lt + '}\n');

    var roles = (style.roles || {}).items || [];
    var rules = '';
    roles.forEach(function (r) {
      var sel = r.selector, t = r.after || r.tokens;
      if (!sel || !t) return;
      if (r.families && r.families.indexOf(family) < 0) return;
      var d = '';
      if (t.ff) d += 'font-family:var(--ff-' + (t.ff === 'narrative' ? 'narr' : t.ff) + ')' + (imp ? ' !important' : '') + ';';
      if (t.fs) d += 'font-size:var(--fs-' + t.fs + ')' + (imp ? ' !important' : '') + ';';
      if (t.lh) d += 'line-height:var(--lh-' + t.lh + ')' + (imp ? ' !important' : '') + ';';
      if (t.fw) d += 'font-weight:var(--fw-' + t.fw + ')' + (imp ? ' !important' : '') + ';';
      if (t.col) d += 'color:var(--c-' + t.col + ')' + (imp ? ' !important' : '') + ';';
      if (t.ls) d += 'letter-spacing:var(--ls-' + t.ls + ')' + (imp ? ' !important' : '') + ';';
      if (d) rules += sel + '{' + d + '}\n';
    });
    if (TB.applyToAll) {
      rules += 'table th,table td{padding:var(--tbl-pad)' + (imp ? ' !important' : '') + ';}\n';
      if (TB.zebra) rules += 'table tbody tr:nth-child(even) td{background:var(--c-surface2)' + (imp ? ' !important' : '') + ';}\n';
    }
    var bodyFont = (style.roles || {}).bodyFont;
    if (fonts.narrative && (bodyFont === undefined ? true : bodyFont)) {
      rules += 'body{font-family:var(--ff-narr)' + (imp ? ' !important' : '') + ';}\n';
    }
    if (rules) out.push('/* 角色綁定 */\n' + rules);
    return out.join('');
  }

  /* ── 接管：報告既有字級→階梯、行高→三檔（規則與 Python bind_rules 相同）── */
  var LADDER_ORDER = ['micro', 'xs', 'sm', 'note', 'body', 'lead', 'h3', 'h2', 'h1'];
  /* 歸類用的基準階梯固定不動（與 Python REF_LADDER 相同）：元素屬於哪一級由它決定，樣式只改那一級多大 */
  var REF_LADDER = { micro: 0.4, xs: 0.46, sm: 0.52, note: 0.6, body: 0.7, lead: 0.8, h3: 0.92, h2: 1.05, h1: 1.3 };
  var SKIP_LH = /ascii|af-|dtree|pre|fig|svg|code|mono/i;
  var SKIP_SEL = /^\s*(@|from|to|\d+%)|::?(before|after)\s*$/i;
  function mult(v, base) {
    v = String(v || '').trim(); var m;
    if ((m = v.match(/^calc\(\s*var\(--fs\)\s*\*\s*([\d.]+)\s*\)$/))) return parseFloat(m[1]);
    if ((m = v.match(/^calc\(\s*([\d.]+)px\s*\*\s*var\(--(?:scale|fs-scale)(?:,\s*1)?\)\s*\)$/))) return parseFloat(m[1]) / base;
    if ((m = v.match(/^([\d.]+)px$/))) return parseFloat(m[1]) / base;
    return null;
  }
  function snapStep(k, ladder) {
    var steps = LADDER_ORDER.filter(function (n) { return n in ladder; }).map(function (n) { return [n, parseFloat(ladder[n])]; });
    if (!steps.length) return null;
    var lo = steps[0][1] * 0.8, hi = steps[steps.length - 1][1] * 1.25;
    if (k < lo || k > hi) return null;
    var best = steps[0], bd = Infinity;
    steps.forEach(function (t) { var d = Math.abs(Math.log(k) - Math.log(t[1])); if (d < bd) { bd = d; best = t; } });
    return best[0];
  }
  function snapLh(v) {
    var t = String(v).trim(); if (!/^[0-9.]+$/.test(t)) return null;   /* 有單位（em/px）或 normal 一律不動 */
    var x = parseFloat(t); if (isNaN(x)) return null;
    if (x < 1.45) return 'title'; if (x <= 1.72) return 'data'; return 'body';
  }
  /* 從瀏覽器 CSSOM 收割（iframe 同源）：回 [media, selector, fsMult, lhValue] */
  function harvestFromDoc(doc, base) {
    var seen = {}, order = [];
    function walk(rules, media) {
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (r.type === 4 /* MEDIA */) { walk(r.cssRules, '@media ' + r.conditionText); continue; }
        if (r.type !== 1) continue;
        var st = r.style, fs = st.getPropertyValue('font-size'), lh = st.getPropertyValue('line-height');
        if (!fs && !lh) continue;
        var fsm = fs ? mult(fs, base) : null, lhv = lh ? lh.trim() : null;
        r.selectorText.split(',').forEach(function (one) {
          one = one.trim(); if (!one || SKIP_SEL.test(one)) return;
          var key = (media || '') + '|#|' + one;
          if (!(key in seen)) { seen[key] = [media || null, one, null, null]; order.push(key); }
          if (fsm !== null) seen[key][2] = fsm;
          if (lhv !== null) seen[key][3] = lhv;
        });
      }
    }
    for (var s = 0; s < doc.styleSheets.length; s++) {
      var sh = doc.styleSheets[s];
      if (sh.ownerNode && /^yoda-tokens/.test(sh.ownerNode.id || '')) continue;
      var rules; try { rules = sh.cssRules; } catch (e) { continue; }
      if (rules) walk(rules, null);
    }
    return order.map(function (k) { return seen[k]; });
  }
  function bindRules(harvest, style, imp) {
    var T = style.typography || {}, ladder = T.ladder || {}, B = style.bind || {};
    var doFs = B.fontSize === undefined ? true : B.fontSize, doLh = B.lineHeight === undefined ? true : B.lineHeight;
    var I = imp ? ' !important' : '';
    var groups = {}, gorder = [], stats = { rules: 0, fs: 0, lh: 0, skipped: 0, jumps: [] };
    harvest.forEach(function (h) {
      var media = h[0], sel = h[1], fsm = h[2], lhv = h[3], d = '';
      if (doFs && fsm !== null && fsm !== undefined) {
        var st = snapStep(fsm, REF_LADDER);
        if (st) {
          d += 'font-size:var(--fs-' + st + ')' + I + ';'; stats.fs++;
          var ratio = parseFloat(st in ladder ? ladder[st] : REF_LADDER[st]) / fsm;
          if (ratio > 1.18 || ratio < 0.85) stats.jumps.push([sel.slice(0, 40), Math.round(fsm * 1000) / 1000, st, Math.round(ratio * 100) / 100]);
        } else stats.skipped++;
      }
      if (doLh && lhv !== null && lhv !== undefined && !SKIP_LH.test(sel)) {
        var t = snapLh(lhv);
        if (t) { d += 'line-height:var(--lh-' + t + ')' + I + ';'; stats.lh++; }
      }
      if (d) {
        var mk = media || '';
        if (!(mk in groups)) { groups[mk] = []; gorder.push(mk); }
        groups[mk].push(sel + '{' + d + '}'); stats.rules++;
      }
    });
    var NL = String.fromCharCode(10);
    var out = '/* 接管：報告既有字級→階梯、行高→三檔 */' + NL;
    gorder.forEach(function (mk) {
      var body = groups[mk].join(NL) + NL;
      out += mk ? (mk + '{' + NL + body + '}' + NL) : body;
    });
    return { css: out, stats: stats };
  }

  var API = { render: render, harvestFromDoc: harvestFromDoc, bindRules: bindRules, snapStep: snapStep, snapLh: snapLh, mult: mult, COLOR_MAP: COLOR_MAP, FONT_MAP: FONT_MAP, FONT_STACKS: FONT_STACKS,
              LIGHT_SEL: LIGHT_SEL, DARK_SEL: DARK_SEL, TYPE_FAMILY: TYPE_FAMILY };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.YodaTokens = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
