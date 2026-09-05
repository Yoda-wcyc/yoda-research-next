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
    items(T.ladder).forEach(function (e) { root += decl('--fs-' + e[0], 'calc(var(--fs)*' + num(e[1]) + ')', imp); });
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

  var API = { render: render, COLOR_MAP: COLOR_MAP, FONT_MAP: FONT_MAP, FONT_STACKS: FONT_STACKS,
              LIGHT_SEL: LIGHT_SEL, DARK_SEL: DARK_SEL, TYPE_FAMILY: TYPE_FAMILY };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.YodaTokens = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
