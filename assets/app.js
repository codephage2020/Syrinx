/* Syrinx — UI + D-pad navigation.
   Written for the Android TV WebView (Chrome 66): no optional chaining,
   no nullish coalescing, no Array.prototype.flat, no flex gap. */

(function () {
  'use strict';

  // ---------------------------------------------------------------- helpers

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function artistNames(list) {
    if (!list || !list.length) return '';
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (typeof a === 'string') out.push(a);
      else if (a && a.name) out.push(a.name);
    }
    return out.join(' / ');
  }

  function trackOf(item) {
    return (item && item.track) ? item.track : item;
  }

  function coverUrl(coverId, size) {
    if (!coverId) return '';
    return '/api/static/cover?coverId=' + encodeURIComponent(coverId) +
           '&size=' + (size || 600);
  }

  function bgStyle(url) {
    if (!url) return '';
    return ' style="background-image:url(' + esc(url) + ')"';
  }

  // ------------------------------------------------------------ skeletons
  // Loading placeholders keep the shape of whatever is coming, so the page
  // does not jump when it arrives. They are plain divs: nothing to focus.

  function skelRows(n) {
    var html = '';
    for (var i = 0; i < n; i++) {
      html += '<div class="sk-row"><div class="sk sk-cover"></div>' +
        '<div class="sk-lines"><div class="sk sk-t1"></div><div class="sk sk-t2"></div></div></div>';
    }
    return '<div class="sk-wrap">' + html + '</div>';
  }

  function skelCards(n) {
    var html = '';
    for (var i = 0; i < n; i++) {
      html += '<div class="sk-card"><div class="sk sk-art"></div>' +
        '<div class="sk sk-name"></div><div class="sk sk-sub"></div></div>';
    }
    return '<div class="sk-wrap cards">' + html + '</div>';
  }

  function skelHero() {
    return '<div class="sk-hero"><div class="sk sk-art-big"></div>' +
      '<div class="sk-lines"><div class="sk sk-kind"></div>' +
      '<div class="sk sk-h1"></div><div class="sk sk-h2"></div></div></div>';
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3000);
  }

  // ------------------------------------------------------------------ state

  var state = {
    status: null,
    current: null,          // current view spec
    stack: [],              // back stack of view specs
    focusEl: null,
    scope: '#shell',
    section: 'home',        // section the rail should light up
    saved: {},              // viewKey -> data-key of last focused element
    list: [],               // tracks currently listed on screen
    albumPage: 1,
    trackPage: 1,
    queue: [],
    index: -1,
    shuffle: false,
    repeat: 0,
    playing: false,
    seeking: false,
    osk: { input: null, prev: null },
    lyric: { guid: null, lines: [], idx: -1, open: true, full: false, timed: true },
    npbar: { shown: false, timer: null },
    hero: { items: [], i: 0, timer: null, built: false },
    sorts: {                // list order per page, remembered across launches
      album: readSort('album'),
      artist: readSort('artist')
    },
    roam: { active: false, id: null }
  };

  // Stroke icons, 24x24, matched weights so the sidebar reads as one set.
  var NAV_ICONS = {
    home: '<path d="M3 10.6 12 3.4l9 7.2"/><path d="M5.6 9.6V20.4h12.8V9.6"/>',
    albums: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="2.4"/>',
    artists: '<circle cx="12" cy="8.2" r="3.9"/><path d="M4.6 20.8c0-4 3.3-6.4 7.4-6.4s7.4 2.4 7.4 6.4"/>',
    playlists: '<path d="M4 6.5h11M4 12h11M4 17.5h6.5"/><circle cx="17.4" cy="17.4" r="2.6"/><path d="M20 17.4V8.2"/>',
    tracks: '<path d="M9 17.4V4.8l10-2v12.6"/><circle cx="6.4" cy="17.9" r="2.6"/><circle cx="16.4" cy="15.9" r="2.6"/>',
    roam: '<circle cx="12" cy="12" r="8.6"/><path d="m15.4 8.6-2 5.4-5.4 2 2-5.4z"/>',
    history: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2v5.1l3.4 2"/>',
    favorites: '<path d="M12 20.2s-7.2-4.5-7.2-9.5A4.2 4.2 0 0 1 12 7.5a4.2 4.2 0 0 1 7.2 3.2c0 5-7.2 9.5-7.2 9.5z"/>',
    search: '<circle cx="11" cy="11" r="6.6"/><path d="m15.9 15.9 4.4 4.4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
  };

  // Transport glyphs. They are filled, not stroked, so the shapes stay crisp
  // at the small size the player bar gives them.
  var CTL_ICONS = {
    prev: '<path d="M18.6 5.4v13.2L9.2 12z"/><rect x="5" y="5.1" width="1.9" height="13.8" rx=".95"/>',
    next: '<path d="M5.4 5.4v13.2L14.8 12z"/><rect x="17.1" y="5.1" width="1.9" height="13.8" rx=".95"/>',
    play: '<path d="M7.4 4.6v14.8L19.4 12z"/>',
    pause: '<rect x="6.2" y="4.6" width="4" height="14.8" rx="1.2"/>' +
      '<rect x="13.8" y="4.6" width="4" height="14.8" rx="1.2"/>',
    queue: '<path d="M4 6.6h12M4 12h16M4 17.4h9" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round"/>',
    lyric: '<path d="M4 6.6h16M4 12h10M4 17.4h13" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round"/>',
    fs: '<path d="M4.2 9.2V4.4h4.8M19.8 9.2V4.4h-4.8M4.2 14.8v4.8h4.8M19.8 14.8v4.8h-4.8" ' +
      'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
    // Play mode: 顺序 / 列表循环 / 单曲循环 / 随机.
    seq: '<path d="M4.4 12h12.2" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round"/><path d="m12.9 6.9 5.1 5.1-5.1 5.1" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    repeat: '<path d="M7 7h10v3l4-4-4-4v3H5v6h2zM17 17H7v-3l-4 4 4 4v-3h12v-6h-2z"/>',
    repeat1: '<path d="M7 7h10v3l4-4-4-4v3H5v6h2zM17 17H7v-3l-4 4 4 4v-3h12v-6h-2zm-4-2v-6h-1l-2 1v1h1.5v4z"/>',
    shuffle: '<path d="M10.6 9.2 5.4 4 4 5.4l5.2 5.2zM14.5 4l2 2L4 18.6 5.4 20 17.9 7.5 20 9.5V4zm.3 9.4-1.4 1.4 3.1 3.1L14.5 20H20v-5.5l-2 2z"/>'
  };

  // The glyph alone carries the meaning, so no label rides along.
  function ctlBtn(act, key, icon, primary) {
    return '<button class="f icon-btn' + (primary ? ' primary' : '') + '" tabindex="-1"' +
      ' data-act="' + act + '" data-key="' + key + '">' + ctlIcon(icon) + '</button>';
  }

  function ctlIcon(name) {
    return name ? '<svg class="btn-ico" viewBox="0 0 24 24">' + (CTL_ICONS[name] || '') + '</svg>' : '';
  }

  // Pins LEFT/RIGHT to the row's own order. The play key is taller than the
  // keys beside it and the seek bar sits directly above them, so pure geometry
  // has too many ways to guess wrong when the remote walks the transport.
  function wireRow(row) {
    if (!row) return;
    var keys = row.querySelectorAll('[data-key]');
    for (var i = 0; i < keys.length; i++) {
      if (i > 0) keys[i].setAttribute('data-left', keys[i - 1].getAttribute('data-key'));
      if (i < keys.length - 1) keys[i].setAttribute('data-right', keys[i + 1].getAttribute('data-key'));
    }
  }

  // Rewrites a button's glyph while it keeps its focus. Left alone when the
  // glyph is already right, so the fade-in only plays on a real change.
  function setCtl(btn, icon) {
    if (!btn) return;
    var html = ctlIcon(icon);
    if (btn.innerHTML !== html) btn.innerHTML = html;
  }

  var SECTIONS = [
    { key: 'home', label: '首页' },
    { key: 'albums', label: '专辑' },
    { key: 'artists', label: '歌手' },
    { key: 'playlists', label: '歌单' },
    { key: 'tracks', label: '歌曲' },
    { key: 'roam', label: '漫游' },
    { key: 'history', label: '最近播放' },
    { key: 'favorites', label: '我的收藏' },
    { key: 'search', label: '搜索' },
    { key: 'settings', label: '设置' }
  ];

  var au = $('au');

  // -------------------------------------------------------------------- api

  function api(path, params, opts) {
    opts = opts || {};
    var qs = '';
    if (params) {
      var parts = [];
      for (var k in params) {
        if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
        var v = params[k];
        if (v === undefined || v === null || v === '') continue;
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
      }
      if (parts.length) qs = '?' + parts.join('&');
    }

    var init = { method: opts.method || 'GET', headers: {} };
    if (opts.body) {
      init.body = JSON.stringify(opts.body);
      init.headers['Content-Type'] = 'application/json';
    }

    return fetch('/api/' + path + qs, init).then(function (res) {
      if (res.status === 401) {
        var err401 = new Error('登录已过期，请重新登录');
        err401.code = 401;
        throw err401;
      }
      return res.text().then(function (text) {
        var env;
        try {
          env = JSON.parse(text);
        } catch (e) {
          throw new Error('服务器返回异常 (HTTP ' + res.status + ')');
        }
        if (env.code !== 0 && env.code !== 200) {
          var err = new Error(env.msg || ('请求失败 (' + env.code + ')'));
          err.code = env.code;
          throw err;
        }
        return env.data;
      });
    });
  }

  // ------------------------------------------------------- focus navigation

  function isVisible(el) {
    if (!el || !el.getClientRects().length) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  }

  function candidates() {
    var root = document.querySelector(state.scope);
    if (!root) return [];
    var els = root.querySelectorAll('.f');
    var out = [];
    for (var i = 0; i < els.length; i++) {
      if (els[i].hasAttribute('disabled')) continue;
      if (!isVisible(els[i])) continue;
      out.push(els[i]);
    }
    return out;
  }

  function isTextField(el) {
    if (!el || !el.tagName) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
  }

  function setFocus(el) {
    if (!el || el === state.focusEl) return;
    if (state.focusEl) state.focusEl.classList.remove('focused');
    state.focusEl = el;
    el.classList.add('focused');

    // Moving the highlight must not open the IME — on a TV the on-screen
    // keyboard covers half the screen. Only OK on a text field starts editing.
    if (!isTextField(el) && document.activeElement && document.activeElement.blur &&
        isTextField(document.activeElement)) {
      document.activeElement.blur();
    }

    if (el.scrollIntoView) {
      try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
    }
    if (el.getAttribute('data-key')) {
      state.saved[viewKey(state.current)] = el.getAttribute('data-key');
    }
  }

  function clearFocus() {
    var els = document.querySelectorAll('.focused');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('focused');
    state.focusEl = null;
  }

  function focusFirst() {
    // Prefer the content area: after picking a sidebar section the next key
    // press should land in the list, not on another sidebar item.
    var root = document.querySelector(state.scope === '#osk' ? '#osk' : '#content');
    if (root) {
      var inner = root.querySelectorAll('.f');
      for (var i = 0; i < inner.length; i++) {
        if (inner[i].hasAttribute('data-skip')) continue;
        if (!inner[i].hasAttribute('disabled') && isVisible(inner[i])) {
          setFocus(inner[i]);
          return;
        }
      }
    }
    var list = candidates();
    if (!list.length) return;
    // An empty section leaves nothing in the content area, so focus lands on
    // the sidebar — keep it on the section we are actually in, not on 首页.
    var cur = state.current;
    var active = cur && cur.type === 'section'
      ? document.querySelector('.nav-item[data-section="' + cur.key + '"]') : null;
    setFocus(active && list.indexOf(active) !== -1 ? active : list[0]);
  }

  function ensureFocus() {
    // With the playing page open and its bar away there is deliberately
    // nothing focused; a repaint must not pull focus back onto the page.
    if (overlayOpen() && !state.npbar.shown) return;
    if (!state.focusEl || !document.contains(state.focusEl) || !isVisible(state.focusEl)) {
      focusFirst();
    } else if (state.focusEl.classList.contains('nav-item')) {
      // The section painted an empty skeleton, so focus had nowhere to go and
      // fell back to the sidebar. Now that rows exist, move into the content.
      focusFirst();
    }
    // Lists are rebuilt asynchronously, so the playing row has to be re-marked
    // every time fresh rows land; the check below makes this a no-op otherwise.
    paintRows();
  }

  // ------------------------------------------------- on-screen keyboard

  // The TV's own IME (Sogou) only floats a thin compose bar without a visible
  // keyboard, so a remote cannot type letters with it. This is a plain D-pad
  // keypad; the search API accepts pinyin, so latin input is enough.
  var OSK_ROWS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm']
  ];

  function buildOsk() {
    var html = '';
    for (var r = 0; r < OSK_ROWS.length; r++) {
      html += '<div class="osk-row">';
      for (var c = 0; c < OSK_ROWS[r].length; c++) {
        var ch = OSK_ROWS[r][c];
        html += '<button class="f osk-key" tabindex="-1" data-act="osk" data-okey="' + ch + '">' + ch + '</button>';
      }
      html += '</div>';
    }
    html += '<div class="osk-row">' +
      '<button class="f osk-key osk-wide" tabindex="-1" data-act="osk" data-okey="clear">清空</button>' +
      '<button class="f osk-key osk-wide" tabindex="-1" data-act="osk" data-okey="space">空格</button>' +
      '<button class="f osk-key osk-wide" tabindex="-1" data-act="osk" data-okey="bksp">退格</button>' +
      '<button class="f osk-key osk-wide" tabindex="-1" data-act="osk" data-okey="done">确定</button>' +
      '</div>';
    $('osk-keys').innerHTML = html;

    // Rows are uneven, so D-pad movement is index based — geometry alone would
    // make RIGHT on the action row jump up into the letters.
    var rowEls = $('osk-keys').querySelectorAll('.osk-row');
    state.osk.rows = [];
    for (var i = 0; i < rowEls.length; i++) {
      state.osk.rows.push(rowEls[i].querySelectorAll('.osk-key'));
    }
  }

  function oskFocus(r, c) {
    var rows = state.osk.rows;
    if (!rows || !rows.length) return;
    r = Math.max(0, Math.min(rows.length - 1, r));
    var row = rows[r];
    c = Math.max(0, Math.min(row.length - 1, c));
    state.osk.r = r;
    state.osk.c = c;
    setFocus(row[c]);
  }

  function oskMove(dir) {
    var r = state.osk.r || 0;
    var c = state.osk.c || 0;
    if (dir === 'left') oskFocus(r, c - 1);
    else if (dir === 'right') oskFocus(r, c + 1);
    else if (dir === 'up') oskFocus(r - 1, c);
    else oskFocus(r + 1, c);
  }

  function paintOskText() {
    var input = state.osk.input;
    var text = input ? input.value : '';
    var shown = text;
    if (input && input.type === 'password') shown = new Array(text.length + 1).join('•');
    var box = $('osk-text');
    box.textContent = shown || (input && input.getAttribute('placeholder')) || '';
    box.className = shown ? 'osk-text' : 'osk-text empty';
  }

  function oskOpen(input) {
    if (!input) return;
    state.osk.input = input;
    state.osk.prev = state.scope;
    state.scope = '#osk';
    $('osk').hidden = false;
    $('osk-label').textContent = input.id === 'search-box'
      ? '搜索' : (input.getAttribute('placeholder') || '输入');
    paintOskText();
    // Start on 'a' — the first letter of most pinyin queries.
    oskFocus(2, 0);
  }

  function oskClose() {
    var input = state.osk.input;
    $('osk').hidden = true;
    state.osk.input = null;
    state.scope = state.osk.prev || '#shell';
    if (!input) { ensureFocus(); return; }
    clearFocus();
    setFocus(input);
    if (input.id === 'search-box') {
      var q = input.value.trim();
      if (q) runSearch(q);
    } else if (input.id === 'lg-pass') {
      // After the password, the next useful stop is the login button.
      var btn = $('lg-btn');
      if (btn) setFocus(btn);
    }
  }

  function oskPress(key) {
    var input = state.osk.input;
    if (!input) return;
    if (key === 'done') { oskClose(); return; }
    if (key === 'bksp') input.value = input.value.slice(0, -1);
    else if (key === 'clear') input.value = '';
    else if (key === 'space') input.value += ' ';
    else input.value += key;
    paintOskText();
  }

  function intervalGap(a1, a2, b1, b2) {
    if (a2 < b1) return b1 - a2;
    if (b2 < a1) return a1 - b2;
    return 0;
  }

  function navigate(dir) {
    var list = candidates();
    if (!list.length) return;

    var cur = state.focusEl;
    if (!cur || list.indexOf(cur) === -1 || !isVisible(cur)) {
      setFocus(list[0]);
      return;
    }

    // RIGHT on the carousel pages it (wrapping at the end). LEFT is left to the
    // normal navigator so it always reaches the rail: a carousel that swallows
    // LEFT is a keyboard trap once it has auto-advanced off the first slide.
    if (cur.id === 'hero' && dir === 'right') {
      heroStep(1);
      return;
    }

    // An explicit neighbour (data-left/right/up/down holds a data-key) beats the
    // geometric guess, for pairs that sit side by side but far apart in space.
    var jumpKey = cur.getAttribute('data-' + dir);
    if (jumpKey) {
      var jumpTo = document.querySelector('[data-key="' + jumpKey + '"]');
      if (jumpTo && list.indexOf(jumpTo) !== -1) {
        setFocus(jumpTo);
        return;
      }
    }

    // The top row of a grid goes up to the toolbar above it, not to the rail:
    // the chips sit at the far right, so the geometric pick from the left-hand
    // cards would never find them, and the rail is only one LEFT away anyway.
    if (dir === 'up' && cur.classList.contains('card')) {
      var bar = document.querySelector('.chips');
      var barR = bar && isVisible(bar) ? bar.getBoundingClientRect() : null;
      var cr0 = cur.getBoundingClientRect();
      if (barR && cr0.top - barR.bottom < 220) {
        var near = null, nearD = Infinity;
        var chips = bar.querySelectorAll('.chip');
        for (var ci = 0; ci < chips.length; ci++) {
          if (!isVisible(chips[ci])) continue;
          var rr = chips[ci].getBoundingClientRect();
          var d = Math.abs(rr.left + rr.width / 2 - (cr0.left + cr0.width / 2));
          if (d < nearD) { nearD = d; near = chips[ci]; }
        }
        if (near) { setFocus(near); return; }
      }
    }

    var cr = cur.getBoundingClientRect();
    var cx = cr.left + cr.width / 2;
    var cy = cr.top + cr.height / 2;

    var best = null;
    var bestScore = Infinity;

    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el === cur) continue;
      var r = el.getBoundingClientRect();
      var ex = r.left + r.width / 2;
      var ey = r.top + r.height / 2;

      var primary;
      var perpGap;
      var perpDelta;

      if (dir === 'right') {
        primary = ex - cx;
        perpGap = intervalGap(cr.top, cr.bottom, r.top, r.bottom);
        perpDelta = Math.abs(ey - cy);
      } else if (dir === 'left') {
        primary = cx - ex;
        perpGap = intervalGap(cr.top, cr.bottom, r.top, r.bottom);
        perpDelta = Math.abs(ey - cy);
      } else if (dir === 'down') {
        primary = ey - cy;
        perpGap = intervalGap(cr.left, cr.right, r.left, r.right);
        perpDelta = Math.abs(ex - cx);
      } else {
        primary = cy - ey;
        perpGap = intervalGap(cr.left, cr.right, r.left, r.right);
        perpDelta = Math.abs(ex - cx);
      }

      if (primary <= 2) continue;

      // A candidate that still overlaps the current element along the movement
      // axis does not really sit "in that direction". Without this the
      // full-width seek bar, which reaches further right than any button,
      // steals RIGHT presses at the end of the player control row.
      if (dir === 'right' && r.left < cr.right - 4) continue;
      if (dir === 'left' && r.right > cr.left + 4) continue;
      if (dir === 'down' && r.top < cr.bottom - 4) continue;
      if (dir === 'up' && r.bottom > cr.top + 4) continue;

      var score = primary + perpGap * 4 + perpDelta * 0.12;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }

    // Leaving the content column to the left lands on the rail. Which icon
    // that is should follow the page you are on, not whichever one happens to
    // sit at the same height, so the rail reads as "you are here".
    if (best && dir === 'left' && best.classList.contains('nav-item') && state.section) {
      var here = document.querySelector('.nav-item[data-section="' + state.section + '"]');
      if (here && list.indexOf(here) !== -1) best = here;
    }

    if (best) setFocus(best);
  }

  // ------------------------------------------------------------------- views

  function viewKey(spec) {
    if (!spec) return 'none';
    if (spec.type === 'section') return 's:' + spec.key;
    return spec.type + ':' + (spec.id || '');
  }

  function rememberFocus() {
    if (state.focusEl && state.focusEl.getAttribute('data-key')) {
      state.saved[viewKey(state.current)] = state.focusEl.getAttribute('data-key');
    }
  }

  function restoreFocus() {
    var key = state.saved[viewKey(state.current)];
    if (key) {
      var el = document.querySelector('[data-key="' + key.replace(/"/g, '\\"') + '"]');
      if (el && isVisible(el)) { setFocus(el); return; }
    }
    focusFirst();
  }

  function setContent(html) {
    $('content').innerHTML = html;
    $('content').scrollTop = 0;
  }

  function render(spec, opts) {
    rememberFocus();
    state.current = spec;
    if (state.hero) clearInterval(state.hero.timer);
    markSidebar(spec);
    clearFocus();

    var done = function () {
      if (opts && opts.restore) restoreFocus();
      else focusFirst();
    };

    if (spec.type === 'section') renderSection(spec.key, done);
    else if (spec.type === 'album') renderAlbum(spec.id, spec.name, done);
    else if (spec.type === 'artist') renderArtist(spec.id, spec.name, done);
    else if (spec.type === 'playlist') renderPlaylist(spec.id, spec.name, done);
    else renderSection('home', done);
  }

  function openView(spec, restore) {
    if (state.current) state.stack.push(state.current);
    render(spec, { restore: !!restore });
  }

  function goSection(key) {
    state.stack = [];
    render({ type: 'section', key: key });
  }

  function goBack() {
    if (overlayOpen() && state.lyric.full) { setLyricView('pane'); return; }
    if (overlayOpen()) { closeOverlay(); return; }
    if (state.stack.length) {
      var prev = state.stack.pop();
      render(prev, { restore: true });
      return;
    }
    if (state.current && !(state.current.type === 'section' && state.current.key === 'home')) {
      goSection('home');
      return;
    }
    if (window.TV && window.TV.exit) window.TV.exit();
  }

  function markSidebar(spec) {
    var key = spec.type === 'section' ? spec.key : null;
    // Detail pages keep the rail lit on the section they were opened from.
    if (key) state.section = key;
    var items = document.querySelectorAll('.nav-item');
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (key && it.getAttribute('data-section') === key) it.classList.add('active');
      else if (key) it.classList.remove('active');
    }
  }

  // ---------------------------------------------------------------- sidebar

  function buildSidebar() {
    var html = '';
    for (var i = 0; i < SECTIONS.length; i++) {
      var s = SECTIONS[i];
      // The rail is icon-only; the section name slides out beside the icon
      // while that item has focus, so the rail stays quiet but nothing is a
      // guess. The label is not focusable and does not take pointer events.
      html += '<div class="nav-item f" tabindex="-1" data-act="nav" data-section="' +
        s.key + '" data-key="nav:' + s.key + '">' +
        '<span class="nav-ico"><svg viewBox="0 0 24 24">' +
        (NAV_ICONS[s.key] || '') + '</svg></span>' +
        '<span class="nav-label">' + s.label + '</span></div>';
    }
    $('nav-list').innerHTML = html;

    var user = state.status && state.status.user;
    var name = user ? (user.nickname || user.name || user.username || '') : '';
    $('nav-user').textContent = name ? ('已登录：' + name) : '已登录';
  }

  // ---------------------------------------------------------------- sections

  function sectionHead(title, note) {
    return '<div class="section-head"><h2>' + esc(title) + '</h2>' +
      (note ? '<div class="more">' + esc(note) + '</div>' : '') + '</div>';
  }

  function renderSection(key, done) {
    if (key === 'home') return renderHome(done);
    if (key === 'albums') return renderAlbums(done);
    if (key === 'artists') return renderArtists(done);
    if (key === 'playlists') return renderPlaylists(done);
    if (key === 'tracks') return renderTracks(done);
    if (key === 'roam') return renderRoam(done);
    if (key === 'history') return renderHistory(done);
    if (key === 'favorites') return renderFavorites(done);
    if (key === 'search') return renderSearch(done);
    if (key === 'settings') return renderSettings(done);
    return renderHome(done);
  }

  function albumCard(a) {
    var sub = artistNames(a.artists) ||
      ((a.trackCount || 0) ? (a.trackCount + ' 首') : '');
    return '<div class="card f" tabindex="-1" data-act="album" data-id="' + esc(a.guid) +
      '" data-key="album:' + esc(a.guid) + '">' +
      '<div class="cover' + (a.coverId ? '' : ' noart') + '"' +
      bgStyle(coverUrl(a.coverId, 600)) + '></div>' +
      '<div class="name">' + esc(a.name || '未知专辑') + '</div>' +
      (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') +
      '</div>';
  }

  function playlistCard(p) {
    var sub = (p.trackCount || 0) + ' 首';
    return '<div class="card f" tabindex="-1" data-act="playlist" data-id="' + esc(p.guid) +
      '" data-key="pl:' + esc(p.guid) + '">' +
      '<div class="cover' + (p.coverId ? '' : ' noart') + '"' +
      bgStyle(coverUrl(p.coverId, 600)) + '></div>' +
      '<div class="name">' + esc(p.name || '未命名歌单') + '</div>' +
      '<div class="sub">' + esc(sub) + '</div>' +
      '</div>';
  }

  // Chora's artist card is a "compact card": no caption under the art, the name
  // sits inside it on a soft scrim, so a page of faces stays a grid of faces.
  function artistCard(a) {
    var initial = (a.name || '?').charAt(0);
    var cid = a.coverId || a.avatarId;
    return '<div class="card compact f" tabindex="-1" data-act="artist" data-id="' + esc(a.guid) +
      '" data-key="artist:' + esc(a.guid) + '">' +
      '<div class="cover avatar"' + bgStyle(coverUrl(cid, 600)) + '>' +
      (cid ? '' : esc(initial)) +
      '<div class="name">' + esc(a.name || '未知歌手') + '</div>' +
      '</div></div>';
  }

  // Chora lists songs as cover + title + artist, nothing else: on a TV the
  // index is dead weight and the duration is a number nobody squints at.
  // On an album every row would repeat the same cover, so the number takes its
  // place there (Chora's TvHorizontalSongCard does the same with showTrackNumber).
  function trackRow(t, i, listId, opt) {
    var cid = t.coverId || (t.album && t.album.coverId);
    var album = (t.album && t.album.name) || '';
    var sub = [artistNames(t.artists), album].filter(Boolean).join(' · ');
    var lead = opt && opt.num
      ? '<div class="rnum">' + esc(String(t.trackNo != null ? t.trackNo
        : (t.trackNumber != null ? t.trackNumber : i + 1))) + '</div>'
      : '<div class="rcover' + (cid ? '' : ' noart') + '"' + bgStyle(coverUrl(cid, 160)) + '></div>';
    return '<div class="row f" tabindex="-1" data-act="track" data-i="' + i +
      '" data-list="' + esc(listId) + '" data-key="t:' + i + ':' + esc(t.guid) + '">' +
      lead +
      '<div class="rbody"><div class="rtitle">' + esc(t.title || t.name || '未知曲目') + '</div>' +
      (sub ? '<div class="rsub">' + esc(sub) + '</div>' : '') + '</div>' +
      '</div>';
  }

  // -------------------------------------------------------------- home hero
  // Chora's TV home opens on a carousel, not a heading. The most recent albums
  // fill one wide card: artwork on the right dissolving into the album's own
  // dominant colour, the title block on that colour at the left, one Play pill.
  // LEFT/RIGHT on the hero pages through it; it also turns on its own.

  function heroItem(a, fallbackArtist) {
    var bits = ['专辑'];
    var ar = artistNames(a.artists) || fallbackArtist || '';
    if (ar) bits.push(ar);
    if (a.trackCount) bits.push(a.trackCount + ' 首');
    return {
      guid: a.guid,
      name: a.name || '未知专辑',
      coverId: a.coverId || a.avatarId,
      kicker: bits.join(' · ')
    };
  }

  function heroSet(i) {
    var h = state.hero;
    if (!h || !h.items.length) return;
    i = ((i % h.items.length) + h.items.length) % h.items.length;
    h.i = i;
    var it = h.items[i];
    var hero = $('hero');
    if (!hero) return;

    var url = coverUrl(it.coverId, 800);
    $('hero-art').style.backgroundImage = url ? 'url("' + url + '")' : 'none';
    $('hero-kicker').textContent = it.kicker;
    $('hero-title').textContent = it.name;
    hero.setAttribute('data-id', it.guid || '');
    hero.setAttribute('data-name', it.name);
    hero.setAttribute('data-act', it.guid ? 'album' : '');

    var dots = $('hero-dots').children;
    for (var d = 0; d < dots.length; d++) {
      dots[d].className = 'hero-dot' + (d === i ? ' on' : '');
    }

    tintEl(hero, url);
  }

  function heroStep(dir) {
    if (!state.hero || state.hero.items.length < 2) return;
    heroSet(state.hero.i + dir);
    heroRestart();
  }

  function heroRestart() {
    clearInterval(state.hero.timer);
    state.hero.timer = setInterval(function () {
      var c = state.current;
      if (overlayOpen() || !c || c.type !== 'section' || c.key !== 'home') return;
      heroStep(1);
    }, 9000);
  }

  // Only the first non-empty source wins: recent plays when there are any,
  // otherwise the newest albums, so the carousel is never an empty frame.
  function heroBuild(items) {
    if (!state.hero || !items || !items.length || state.hero.built) return;
    state.hero.built = true;
    var seen = {};
    var out = [];
    for (var i = 0; i < items.length && out.length < 6; i++) {
      var a = items[i];
      if (!a || !a.guid || seen[a.guid]) continue;
      seen[a.guid] = 1;
      out.push(a);
    }
    if (!out.length) return;

    state.hero.items = out;
    state.hero.i = 0;

    var dots = '';
    for (var d = 0; d < out.length; d++) dots += '<span class="hero-dot"></span>';
    $('hero-dots').innerHTML = dots;
    $('hero').hidden = false;
    heroSet(0);
    heroRestart();
    ensureFocus();
  }

  function heroPlay() {
    var h = state.hero;
    if (!h || !h.items.length) return;
    var it = h.items[h.i];
    if (!it.guid) { toast('无法播放这张专辑'); return; }
    api('track/album-detail/list', {
      albumGUID: it.guid, page: 1, size: 300, sort: 'trackNo,asc'
    }).then(function (data) {
      var tracks = (data && data.list) || [];
      if (!tracks.length) { toast('这张专辑没有曲目'); return; }
      playQueue(tracks, 0);
      paintRows();
      toast('正在播放：' + it.name);
    }).catch(function (e) { toast(e.message); });
  }

  function renderHome(done) {
    setContent(
      '<div class="page">' +
      '<div class="hero f" id="hero" hidden tabindex="-1" data-key="hero" data-act="heroplay">' +
      '<div class="hero-art" id="hero-art"></div>' +
      '<div class="hero-shade"></div>' +
      '<div class="hero-info">' +
      '<div class="hero-kicker" id="hero-kicker"></div>' +
      '<div class="hero-title" id="hero-title"></div>' +
      '<button class="play-key f" tabindex="-1" data-act="heroplay" data-key="heroplay" data-up="hero">' +
      '<svg viewBox="0 0 24 24"><path d="M7.4 4.6v14.8L19.4 12z"/></svg></button>' +
      '</div>' +
      '<div class="hero-dots" id="hero-dots"></div>' +
      '</div>' +
      sectionHead('最近播放') +
      '<div id="home-history" class="list">' + skelRows(6) + '</div>' +
      '<div class="section-gap"></div>' +
      sectionHead('最近添加') +
      '<div id="home-albums" class="grid">' + skelCards(5) + '</div>' +
      '<div class="section-gap"></div>' +
      sectionHead('我的歌单') +
      '<div id="home-lists" class="grid">' + skelCards(5) + '</div>' +
      '</div>'
    );

    state.hero = { items: [], i: 0, timer: null, built: false };

    var historyReq = api('play-history/list', { page: 1, size: 12 }).then(function (data) {
      var items = (data && data.list) || [];
      var tracks = [];
      for (var i = 0; i < items.length; i++) tracks.push(trackOf(items[i]));
      state.historyList = tracks;
      $('home-history').innerHTML = tracks.length
        ? tracks.map(function (t, i) { return trackRow(t, i, 'history'); }).join('')
        : '<div class="empty">还没有播放记录</div>';

      // The carousel wants albums, the history gives tracks: take each track's
      // album once, in the order it was played.
      var albums = [];
      for (var j = 0; j < tracks.length; j++) {
        var al = tracks[j].album;
        if (al && al.guid) albums.push(heroItem(al, artistNames(tracks[j].artists)));
      }
      heroBuild(albums);
      ensureFocus();
    }).catch(function () {
      $('home-history').innerHTML = '<div class="empty">还没有播放记录</div>';
      ensureFocus();
    });
    if (done) historyReq.then(done);

    api('album/list', { page: 1, size: 12 }).then(function (data) {
      var items = (data && data.list) || [];
      $('home-albums').innerHTML = items.length
        ? items.map(albumCard).join('')
        : '<div class="empty">音乐库还是空的</div>';
      heroBuild(items.map(function (a) { return heroItem(a); }));
      ensureFocus();
    }).catch(function (e) {
      $('home-albums').innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
      ensureFocus();
    });

    api('playlist/list', { page: 1, size: 12 }).then(function (data) {
      var items = (data && data.list) || [];
      $('home-lists').innerHTML = items.length
        ? items.map(playlistCard).join('')
        : '<div class="empty">还没有歌单</div>';
      ensureFocus();
    }).catch(function () {
      $('home-lists').innerHTML = '<div class="empty">还没有歌单</div>';
      ensureFocus();
    });
  }

  function pagedGrid(kind, path, params, done) {
    var box = $('grid-box');
    var size = params.size || 36;
    box.innerHTML = skelCards(10);

    var load = function (page) {
      var p = {};
      for (var k in params) p[k] = params[k];
      p.page = page;
      return api(path, p).then(function (data) {
        var items = (data && data.list) || [];
        var total = (data && data.total) || 0;
        var html = items.map(kind === 'album' ? albumCard
          : kind === 'playlist' ? playlistCard : artistCard).join('');

        var firstNew = null;
        if (page === 1) {
          box.innerHTML = html || '<div class="empty">暂无内容</div>';
        } else {
          var pager = box.querySelector('.pager');
          if (pager) pager.parentNode.removeChild(pager);
          var before = box.querySelectorAll('.card').length;
          box.insertAdjacentHTML('beforeend', html);
          firstNew = box.querySelectorAll('.card')[before] || null;
        }

        if (items.length > 0 && page * size < total) {
          box.insertAdjacentHTML('beforeend',
            '<div class="pager"><button class="f btn" tabindex="-1" data-act="more" ' +
            'data-page="' + (page + 1) + '" data-key="more">加载更多</button></div>');
        }

        if (firstNew) setFocus(firstNew);
        ensureFocus();
      }).catch(function (e) {
        if (page === 1) box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
        toast(e.message);
        ensureFocus();
      });
    };

    state.loadMore = load;
    // Focus only after the first page exists, otherwise focusFirst() falls back
    // to the sidebar and the grid stays unfocused when the cards appear.
    var firstPage = load(1);
    if (done) firstPage.then(done);
  }

  function renderAlbums(done) {
    setContent('<div class="page">' +
      '<div class="section-head bar"><h2>专辑</h2>' + sortBar('album') + '</div>' +
      '<div id="grid-box" class="grid"></div></div>');
    pagedGrid('album', 'album/list', listParams('album'), done);
  }

  // ------------------------------------------------------------ list order
  // fnOS honours only a couple of order fields per endpoint and silently drops
  // the rest, falling back to its own default. Verified against the `sort`
  // echo in the response body:
  //   album/list  → name, trackCount              (default: newest first)
  //   artist/list → name, trackCount, albumCount  (default: trackCount,desc)
  // createdAt, updatedAt, firstLetter, pinyin, random etc. are all ignored.

  // [key, label, server field (null = no param), natural direction when picked]
  function sortDefs(kind) {
    return kind === 'artist'
      ? [['track', '歌曲数', 'trackCount', 'desc'],
         ['name', '名称', 'name', 'asc'],
         ['album', '专辑数', 'albumCount', 'desc']]
      : [['recent', '最近添加', null, 'desc'],
         ['name', '名称', 'name', 'asc'],
         ['count', '歌曲数', 'trackCount', 'desc']];
  }

  function sortField(kind, key) {
    var defs = sortDefs(kind);
    for (var i = 0; i < defs.length; i++) if (defs[i][0] === key) return defs[i][2];
    return null;
  }

  function sortDefDir(kind, key) {
    var defs = sortDefs(kind);
    for (var i = 0; i < defs.length; i++) if (defs[i][0] === key) return defs[i][3];
    return 'desc';
  }

  function sortStore(kind) {
    return kind === 'artist' ? 'syrinx.asort' : 'syrinx.sort';
  }

  function readSort(kind) {
    var defs = sortDefs(kind);
    try {
      var s = JSON.parse(localStorage.getItem(sortStore(kind)) || 'null');
      if (s && (s.dir === 'asc' || s.dir === 'desc')) {
        for (var i = 0; i < defs.length; i++) {
          if (defs[i][0] === s.key) return { key: s.key, dir: s.dir };
        }
      }
    } catch (e) {}
    // "Newest first" is the server's own album order, so it needs no direction.
    return kind === 'artist' ? { key: 'track', dir: 'desc' } : { key: 'recent', dir: 'desc' };
  }

  function listParams(kind) {
    var s = state.sorts[kind];
    var p = { size: 36 };
    var field = sortField(kind, s.key);
    if (field) p.sort = field + ',' + s.dir;
    return p;
  }

  function sortBar(kind) {
    var s = state.sorts[kind];
    var defs = sortDefs(kind);
    var html = '<div class="chips">';
    for (var i = 0; i < defs.length; i++) {
      var on = s.key === defs[i][0];
      // The active chip carries the order arrow itself, so one key both picks
      // the sort and flips its direction — no second button in the row.
      html += '<button class="f chip' + (on ? ' on' : '') + '" ' +
        'tabindex="-1" data-skip data-act="sort" data-kind="' + kind + '" ' +
        'data-sort="' + defs[i][0] + '" data-key="sort:' + kind + ':' + defs[i][0] + '">' +
        esc(defs[i][1]) +
        (on && sortField(kind, s.key)
          ? '<span class="chip-dir">' + (s.dir === 'asc' ? '↑' : '↓') + '</span>' : '') +
        '</button>';
    }
    return html + '</div>';
  }

  // The chips stay in the document while the grid reloads, so the remote keeps
  // its place instead of being pushed back to the rail.
  function setSort(kind, key, dir) {
    // Pressing the chip that is already on flips its order instead of
    // reloading the same list in the same direction.
    var cur = state.sorts[kind];
    if (!dir && cur.key === key && sortField(kind, key)) dir = cur.dir === 'asc' ? 'desc' : 'asc';
    var next = { key: key, dir: sortField(kind, key) ? (dir || sortDefDir(kind, key)) : 'desc' };
    state.sorts[kind] = next;
    try { localStorage.setItem(sortStore(kind), JSON.stringify(next)); } catch (e) {}

    var bar = document.querySelector('.chips');
    if (bar) {
      var chips = bar.querySelectorAll('.chip');
      var arrow = bar.querySelector('.chip-dir');
      if (arrow && arrow.parentNode) arrow.parentNode.removeChild(arrow);
      for (var i = 0; i < chips.length; i++) {
        var on = chips[i].getAttribute('data-sort') === key;
        chips[i].classList.toggle('on', on);
        if (on && sortField(kind, key)) {
          var span = document.createElement('span');
          span.className = 'chip-dir';
          span.textContent = next.dir === 'asc' ? '↑' : '↓';
          chips[i].appendChild(span);
        }
      }
    }

    var box = $('grid-box');
    if (box) {
      box.innerHTML = skelCards(10);
      pagedGrid(kind, kind + '/list', listParams(kind));
    }
  }

  function renderArtists(done) {
    setContent('<div class="page">' +
      '<div class="section-head bar"><h2>歌手</h2>' + sortBar('artist') + '</div>' +
      '<div id="grid-box" class="grid"></div></div>');
    pagedGrid('artist', 'artist/list', listParams('artist'), done);
  }

  function renderPlaylists(done) {
    setContent('<div class="page">' + sectionHead('歌单') +
      '<div id="grid-box" class="grid"></div></div>');
    pagedGrid('playlist', 'playlist/list', { size: 36 }, done);
  }

  function renderTracks(done) {
    setContent('<div class="page">' + sectionHead('歌曲') +
      '<div id="grid-box" class="list">' + skelRows(10) + '</div></div>');
    api('track/list', { page: 1, size: 100 }).then(function (data) {
      var items = (data && data.list) || [];
      state.list = items;
      $('grid-box').innerHTML = items.length
        ? items.map(function (t, i) { return trackRow(t, i, 'list'); }).join('')
        : '<div class="empty">暂无歌曲</div>';
      ensureFocus();
    }).catch(function (e) {
      $('grid-box').innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
      ensureFocus();
    });
    if (done) done();
  }

  function renderHistory(done) {
    setContent('<div class="page">' + sectionHead('最近播放') +
      '<div id="grid-box" class="list">' + skelRows(10) + '</div></div>');
    api('play-history/list', { page: 1, size: 100 }).then(function (data) {
      var items = (data && data.list) || [];
      var tracks = items.map(trackOf);
      state.list = tracks;
      $('grid-box').innerHTML = tracks.length
        ? tracks.map(function (t, i) { return trackRow(t, i, 'list'); }).join('')
        : '<div class="empty">还没有播放记录</div>';
      ensureFocus();
    }).catch(function (e) {
      $('grid-box').innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
      ensureFocus();
    });
    if (done) done();
  }

  function renderFavorites(done) {
    setContent('<div class="page">' + sectionHead('我的收藏') +
      '<div id="grid-box" class="list">' + skelRows(10) + '</div></div>');
    api('favorite-track/list', { page: 1, size: 100 }).then(function (data) {
      var items = (data && data.list) || [];
      state.list = items;
      $('grid-box').innerHTML = items.length
        ? items.map(function (t, i) { return trackRow(t, i, 'list'); }).join('')
        : '<div class="empty">还没有收藏的歌曲</div>';
      ensureFocus();
    }).catch(function (e) {
      $('grid-box').innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
      ensureFocus();
    });
    if (done) done();
  }

  // ---------------------------------------------------------------- roam
  // The server keeps a "漫游" (roam) session: it picks the next track from the
  // whole library itself, so we only need to hold the roam id. That gives the
  // endless-playback feel of a private FM without any recommender of our own.

  function roamDeviceId() {
    var d = '';
    try { d = localStorage.getItem('syrinx.deviceId') || ''; } catch (e) {}
    if (d.length !== 32) {
      d = '';
      for (var i = 0; i < 32; i++) {
        d += '0123456789abcdef'.charAt(Math.floor(Math.random() * 16));
      }
      try { localStorage.setItem('syrinx.deviceId', d); } catch (e) {}
    }
    return d;
  }

  function applyRoam(d) {
    var cur = d && d.current;
    if (!cur || !cur.track) return false;
    state.roam.active = true;
    state.roam.id = cur.roamId;
    // Keep the upcoming track in the queue so the now-playing panel can show it.
    state.queue = [cur.track];
    if (d.next && d.next.track) state.queue.push(d.next.track);
    state.index = 0;
    return true;
  }

  function roamStart() {
    api('track/roam-start', { deviceId: roamDeviceId() }).then(function (d) {
      if (!applyRoam(d)) { toast('漫游暂时没有可播放的歌曲'); return; }
      startPlayback();
      if (state.current && state.current.key === 'roam') {
        render({ type: 'section', key: 'roam' }, { restore: true });
      }
    }).catch(function (e) { toast('漫游失败：' + e.message); });
  }

  function roamStep(back) {
    api(back ? 'track/roam-previous' : 'track/roam-next',
      { deviceId: roamDeviceId(), relativeRoamId: state.roam.id }).then(function (d) {
      if (!applyRoam(d)) { toast(back ? '没有上一首了' : '没有下一首了'); return; }
      startPlayback();
      if (state.current && state.current.key === 'roam') {
        render({ type: 'section', key: 'roam' }, { restore: true });
      }
    }).catch(function (e) { toast('漫游中断：' + e.message); });
  }

  function renderRoam(done) {
    if (!state.roam.active) roamStart();
    var t = currentTrack();
    var html = '<div class="page">' +
      '<div class="section-head"><h2>漫游</h2>' +
      '<span class="more">从整个音乐库随机连续播放</span></div>';
    if (state.roam.active && t) {
      var cid = t.coverId || (t.album && t.album.coverId);
      html += detailHead('正在漫游', t.title || '未知曲目', artistNames(t.artists), cid, '');
    }
    html += '<div class="detail-actions">' +
      '<button class="f play-key shuffle" tabindex="-1" data-act="roam" ' +
      'data-key="roam:next">' + ctlIcon('shuffle') + '</button></div></div>';
    setContent(html);
    done();
  }

  function renderSearch(done) {
    setContent(
      '<div class="page">' + sectionHead('搜索') +
      '<input id="search-box" class="f field" tabindex="-1" type="text" ' +
      'placeholder="输入歌名、专辑或歌手" data-key="search-input">' +
      '<div class="section-gap"></div>' +
      '<div id="grid-box" class="list">' +
      '<div class="hint">' +
      '<div class="hint-ico"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.6"/>' +
      '<path d="m15.9 15.9 4.4 4.4"/></svg></div>' +
      '<div class="hint-title">按确认键开始搜索</div>' +
      '<div class="hint-sub">歌名、专辑、歌手都可以，直接输入拼音也行</div>' +
      '</div></div>' +
      '</div>'
    );
    state.list = [];
    if (done) done();
  }

  function renderSettings(done) {
    var s = state.status || {};
    var user = s.user || {};
    var name = user.nickname || user.name || user.username || '未知';
    setContent(
      '<div class="page">' + sectionHead('设置') +
      '<div class="set-card">' +
      '<div class="set-user">' +
      '<div class="set-avatar">' + esc(name.charAt(0)) + '</div>' +
      '<div class="set-user-info">' +
      '<div class="set-user-name">' + esc(name) + '</div>' +
      '<div class="set-user-sub">已连接到 fnOS 音乐库</div>' +
      '</div></div>' +
      '<div class="set-row"><span class="set-key">服务器</span>' +
      '<span class="set-val mono">' + esc(s.host || '未设置') + '</span></div>' +
      '<div class="set-row"><span class="set-key">账号</span>' +
      '<span class="set-val">' + esc(name) + '</span></div>' +
      '</div>' +
      '<div class="section-gap"></div>' +
      '<button class="f btn btn-danger" tabindex="-1" data-act="logout" data-key="logout">退出登录</button>' +
      '</div>'
    );
    if (done) done();
  }

  // ---------------------------------------------------------------- details

  function detailHead(kind, title, meta, coverId, extra) {
    return '<div class="detail-hero">' +
      '<div class="hero-bg"></div>' +
      '<div class="detail-head">' +
      '<div class="detail-cover' + (coverId ? '' : ' noart') + '"' +
      bgStyle(coverUrl(coverId, 800)) + '></div>' +
      '<div class="detail-info">' +
      '<div class="detail-kind">' + esc(kind) + '</div>' +
      '<div class="detail-title">' + esc(title || '') + '</div>' +
      '<div class="detail-meta">' + esc(meta || '') + '</div>' +
      (extra || '') +
      '</div></div></div>';
  }

  function playAllButton(html) {
    return '<div class="detail-actions">' + html + '</div>';
  }

  function renderAlbum(guid, name, done) {
    setContent('<div class="page">' + skelHero() + skelRows(5) + '</div>');

    var headP = api('album/detail', { guid: guid }).catch(function () { return null; });
    var tracksP = api('track/album-detail/list', {
      albumGUID: guid, page: 1, size: 300, sort: 'trackNo,asc'
    }).catch(function () { return { list: [], total: 0 }; });

    Promise.all([headP, tracksP]).then(function (res) {
      var album = res[0];
      if (album && album.album) album = album.album;
      var tracks = (res[1] && res[1].list) || [];
      state.list = tracks;

      var title = (album && album.name) || name || '未知专辑';
      var artist = artistNames(album && album.artists);
      var bits = [];
      if (artist) bits.push(artist);
      if (tracks.length) bits.push(tracks.length + ' 首');
      if (album && album.originalReleaseYear) bits.push(album.originalReleaseYear + ' 年');

      setContent(
        '<div class="page">' +
        detailHead('专辑', title, bits.join(' · '), album && album.coverId,
          playAllButton('<button class="f play-key" tabindex="-1" data-act="playall" ' +
            'data-key="playall"><svg viewBox="0 0 24 24">' +
            '<path d="M7.4 4.6v14.8L19.4 12z"/></svg></button>')) +
        '<div class="list">' +
        (tracks.length ? tracks.map(function (t, i) {
          return trackRow(t, i, 'list', { num: true });
        }).join('') : '<div class="empty">这张专辑没有曲目</div>') +
        '</div></div>'
      );
      tintEl(document.querySelector('.detail-hero'), coverUrl(album && album.coverId, 400));
      done();
    });
  }

  function renderArtist(guid, name, done) {
    setContent('<div class="page">' + skelHero() + skelRows(5) + '</div>');

    var headP = api('artist/detail', { guid: guid }).catch(function () { return null; });
    var tracksP = api('track/artist-detail/list', {
      artistGUID: guid, page: 1, size: 50
    }).catch(function () { return { list: [] }; });
    var albumsP = api('album/artist-detail/list', {
      artistGUID: guid, page: 1, size: 24
    }).catch(function () { return { list: [] }; });

    Promise.all([headP, tracksP, albumsP]).then(function (res) {
      var artist = res[0];
      if (artist && artist.artist) artist = artist.artist;
      var tracks = (res[1] && res[1].list) || [];
      var albums = (res[2] && res[2].list) || [];
      state.list = tracks;

      var title = (artist && artist.name) || name || '未知歌手';
      var coverId = artist && (artist.coverId || artist.avatarId);

      setContent(
        '<div class="page">' +
        detailHead('歌手', title,
          (albums.length ? albums.length + ' 张专辑' : '') +
          (tracks.length ? (albums.length ? ' · ' : '') + tracks.length + ' 首热门' : ''),
          coverId) +
        sectionHead('热门歌曲') +
        '<div class="list">' +
        (tracks.length ? tracks.map(function (t, i) {
          return trackRow(t, i, 'list');
        }).join('') : '<div class="empty">暂无歌曲</div>') +
        '</div>' +
        '<div class="section-gap"></div>' +
        sectionHead('专辑') +
        '<div class="grid">' +
        (albums.length ? albums.map(albumCard).join('') : '<div class="empty">暂无专辑</div>') +
        '</div></div>'
      );
      tintEl(document.querySelector('.detail-hero'), coverUrl(coverId, 400));
      done();
    });
  }

  function renderPlaylist(guid, name, done) {
    setContent('<div class="page">' + skelHero() + skelRows(5) + '</div>');

    var headP = api('playlist/detail', { guid: guid }).catch(function () { return null; });
    var tracksP = api('track/playlist-detail/list', {
      playlistGUID: guid, page: 1, size: 300
    }).catch(function () { return { list: [] }; });

    Promise.all([headP, tracksP]).then(function (res) {
      var pl = res[0];
      if (pl && pl.playlist) pl = pl.playlist;
      var tracks = (res[1] && res[1].list) || [];
      state.list = tracks;

      var title = (pl && pl.name) || name || '未命名歌单';

      setContent(
        '<div class="page">' +
        detailHead('歌单', title, tracks.length ? (tracks.length + ' 首') : '',
          pl && pl.coverId,
          playAllButton('<button class="f play-key" tabindex="-1" data-act="playall" ' +
            'data-key="playall"><svg viewBox="0 0 24 24">' +
            '<path d="M7.4 4.6v14.8L19.4 12z"/></svg></button>')) +
        '<div class="list">' +
        (tracks.length ? tracks.map(function (t, i) {
          return trackRow(t, i, 'list');
        }).join('') : '<div class="empty">这个歌单还没有歌曲</div>') +
        '</div></div>'
      );
      tintEl(document.querySelector('.detail-hero'), coverUrl(pl && pl.coverId, 400));
      done();
    });
  }

  // --------------------------------------------------------------- playback

  function currentTrack() {
    return state.queue[state.index] || null;
  }

  function playQueue(tracks, start) {
    if (!tracks || !tracks.length) { toast('没有可播放的歌曲'); return; }
    state.roam.active = false;
    state.queue = tracks.slice();
    state.index = Math.max(0, Math.min(start || 0, tracks.length - 1));
    startPlayback();
  }

  function startPlayback() {
    var t = currentTrack();
    if (!t) return;
    resuming = false;
    var url = '/api/track/stream?guid=' + encodeURIComponent(t.guid);
    au.src = url;
    au.play().then(function () {
      state.playing = true;
      paintPlayer();
    }).catch(function (e) {
      state.playing = false;
      paintPlayer();
      toast('播放失败：' + (e && e.message ? e.message : '未知错误'));
    });
    paintPlayer();
    paintOverlay();
    loadLyric(t);
    savePlayer(true, 0);
    updateMediaSession(t);
  }

  function togglePlay() {
    if (!currentTrack()) { toast('还没有选择歌曲'); return; }
    if (au.paused) {
      au.play().catch(function () {});
    } else {
      au.pause();
    }
  }

  function nextTrack() {
    if (state.roam.active) { roamStep(false); return; }
    if (!state.queue.length) return;
    if (state.repeat === 2) { au.currentTime = 0; au.play().catch(function () {}); return; }
    if (state.shuffle) {
      var n = state.queue.length;
      if (n > 1) {
        var r = state.index;
        while (r === state.index) r = Math.floor(Math.random() * n);
        state.index = r;
      }
    } else {
      state.index = state.index + 1;
      if (state.index >= state.queue.length) {
        if (state.repeat === 1) state.index = 0;
        else { state.index = state.queue.length - 1; au.pause(); return; }
      }
    }
    startPlayback();
  }

  function prevTrack() {
    if (!state.queue.length) return;
    if (au.currentTime > 4) { au.currentTime = 0; return; }
    if (state.roam.active) { roamStep(true); return; }
    state.index = state.index - 1;
    if (state.index < 0) state.index = state.repeat === 1 ? state.queue.length - 1 : 0;
    startPlayback();
  }

  function updateMediaSession(t) {
    try {
      if (!('mediaSession' in navigator)) return;
      var art = [];
      var cid = t.coverId || (t.album && t.album.coverId);
      if (cid) art.push({ src: coverUrl(cid, 600), sizes: '600x600', type: 'image/jpeg' });
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title || '',
        artist: artistNames(t.artists),
        album: (t.album && t.album.name) || '',
        artwork: art
      });
    } catch (e) {}
  }

  function paintPlayer() {
    var t = currentTrack();
    if (!t) return;
    var cid = t.coverId || (t.album && t.album.coverId);
    $('pb-cover').style.backgroundImage = cid ? 'url("' + coverUrl(cid, 200) + '")' : '';
    $('pb-title').textContent = t.title || '未知曲目';
    $('pb-artist').textContent = artistNames(t.artists) ||
      ((t.album && t.album.name) || '');
    var btn = $('pb-buttons').querySelector('[data-act="pp"]');
    setCtl(btn, au.paused ? 'play' : 'pause');
    // The playing page owns the same control while it is open, and play/pause
    // fires at times the overlay never repaints, so keep its button in step too.
    var npBtn = document.querySelector('#np-controls [data-act="pp"]');
    if (npBtn) setCtl(npBtn, au.paused ? 'play' : 'pause');
    var mi = modeIcon();
    var pbMode = $('pb-buttons').querySelector('[data-act="mode"]');
    if (pbMode) setCtl(pbMode, mi);
    var npMode = document.querySelector('#np-controls [data-act="mode"]');
    if (npMode) setCtl(npMode, mi);
    document.body.classList.toggle('is-paused', !!au.paused);
  }

  function paintProgress() {
    var d = au.duration || 0;
    var c = au.currentTime || 0;
    var pct = d ? Math.min(100, (c / d) * 100) : 0;
    $('pb-bar').style.width = pct + '%';
    $('pb-cur').textContent = fmtTime(c);
    $('pb-dur').textContent = fmtTime(d);
    $('np-cur').textContent = fmtTime(c);
    $('np-dur').textContent = fmtTime(d);
    $('np-seek-fill').style.width = pct + '%';
  }

  function paintOverlay() {
    if (!overlayOpen()) return;
    var t = currentTrack();
    if (!t) return;
    var cid = t.coverId || (t.album && t.album.coverId);
    var url = cid ? coverUrl(cid, 800) : '';
    $('np-cover').className = 'np-cover' + (url ? '' : ' noart');
    $('np-cover').style.backgroundImage = url ? 'url("' + url + '")' : '';
    applyTint(url);
    $('np-title').textContent = t.title || '未知曲目';
    $('np-artist').textContent = artistNames(t.artists);
    // Chora puts "album • year" on one line under the title.
    var alb = t.album || {};
    $('np-album').textContent = [alb.name, alb.originalReleaseYear || alb.year]
      .filter(Boolean).join(' · ');

    var pp = $('np-controls').querySelector('[data-act="pp"]');
    setCtl(pp, au.paused ? 'play' : 'pause');

    var q = [];
    for (var i = state.index + 1; i < state.queue.length && q.length < 6; i++) {
      var it = state.queue[i];
      var qc = it.coverId || (it.album && it.album.coverId);
      q.push('<div class="row f" tabindex="-1" data-act="queue" data-i="' + i +
        '" data-key="q:' + i + '">' +
        '<div class="rcover"' + bgStyle(coverUrl(qc, 120)) + '></div>' +
        '<div class="rbody"><div class="rtitle">' + esc(it.title || '') + '</div>' +
        '<div class="rsub">' + esc(artistNames(it.artists)) + '</div></div></div>');
    }
    $('np-queue').innerHTML = q.length ? q.join('') : '<div class="empty">已是最后一首</div>';
  }

  function overlayOpen() {
    return !$('np').hidden;
  }

  // ------------------------------------------------------------ artwork tint

  // The playing page is the one screen people sit and watch, so it takes its
  // colour from the album art: the cover is drawn onto a 20x20 canvas, the
  // saturated pixels are averaged, and the result is pushed into a range that
  // still reads as a backdrop for white text. Grey artwork keeps the brand blue.
  var DEFAULT_TINT = { c: [89, 194, 255], hi: [150, 216, 255] };
  var tintCache = {};
  var tintToken = 0;

  function rgbToHsl(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    var h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: h, s: s, l: l };
  }

  function hslToRgb(h, s, l) {
    function f(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    if (!s) {
      var v = Math.round(l * 255);
      return [v, v, v];
    }
    var q = l < .5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    return [
      Math.round(f(p, q, h + 1 / 3) * 255),
      Math.round(f(p, q, h) * 255),
      Math.round(f(p, q, h - 1 / 3) * 255)
    ];
  }

  function tintOf(img) {
    try {
      var n = 20;
      var cv = document.createElement('canvas');
      cv.width = n;
      cv.height = n;
      var ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, n, n);
      var d = ctx.getImageData(0, 0, n, n).data;
      var ar = 0, ag = 0, ab = 0, aw = 0;
      for (var i = 0; i < d.length; i += 4) {
        var r = d[i], g = d[i + 1], b = d[i + 2];
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        var l = (mx + mn) / 510;
        if (l < .12 || l > .95) continue;
        var s = mx === mn ? 0
          : (mx - mn) / (mx + mn > 255 ? 510 - mx - mn : mx + mn);
        if (s < .22) continue;
        // weight by saturation, favouring mid-tones over blown highlights
        var w = s * (1 - Math.abs(l - .5));
        ar += r * w; ag += g * w; ab += b * w; aw += w;
      }
      if (aw <= 0) return null;
      var x = rgbToHsl([ar / aw, ag / aw, ab / aw]);
      if (x.s < .08) return null;
      return {
        c: hslToRgb(x.h, Math.max(.55, Math.min(1, x.s * 1.2)),
                    Math.max(.55, Math.min(.66, x.l))),
        hi: hslToRgb(x.h, Math.max(.45, Math.min(1, x.s)),
                     Math.min(.86, Math.max(.55, x.l) + .2))
      };
    } catch (e) {
      return null;   // unreadable canvas: keep the default tint
    }
  }

  function setTint(t) {
    var np = $('np');
    np.style.setProperty('--np-rgb', t.c.join(','));
    np.style.setProperty('--np-rgb-2', t.hi.join(','));
    // The background wants one deep field under the bright ones, so the same
    // hue goes in again at about 40% before it is blurred.
    np.style.setProperty('--np-rgb-3',
      Math.round(t.c[0] * .42) + ',' + Math.round(t.c[1] * .42) + ',' + Math.round(t.c[2] * .42));
  }

  // One sampler for every block that takes its colour from the art. The result
  // is cached per URL: a cover is sampled once and reused wherever it appears.
  function tintFor(url, cb) {
    if (!url) { cb(DEFAULT_TINT); return; }
    if (tintCache[url]) { cb(tintCache[url]); return; }
    var img = new Image();
    img.onload = function () {
      var t = tintOf(img) || DEFAULT_TINT;
      tintCache[url] = t;
      cb(t);
    };
    img.onerror = function () { cb(DEFAULT_TINT); };
    img.src = url;
  }

  function applyTint(url) {
    var token = ++tintToken;
    tintFor(url, function (t) {
      if (token === tintToken) setTint(t);   // the track changed while we sampled
    });
  }

  // Same idea for an element that carries its own --hero-rgb (detail header,
  // home carousel). A per-element token keeps a slow image from repainting a
  // block that has already moved on.
  function tintEl(el, url) {
    if (!el) return;
    var token = (el.__tint || 0) + 1;
    el.__tint = token;
    tintFor(url, function (t) {
      if (el.__tint !== token) return;
      el.style.setProperty('--hero-rgb', t.c.join(','));
      el.style.setProperty('--hero-rgb-2', t.hi.join(','));
      el.style.setProperty('--hero-rgb-3',
        Math.round(t.c[0] * .42) + ',' + Math.round(t.c[1] * .42) + ',' + Math.round(t.c[2] * .42));
    });
  }

  // --------------------------------------------------------------- lyrics

  // The library stores lyrics as plain LRC text (source 3 = embedded in the
  // file), so the timeline has to be parsed client-side.
  function parseLrc(text) {
    var out = [];
    if (!text) return out;
    var offset = 0;
    var mo = /\[offset:\s*(-?\d+)\s*\]/i.exec(text);
    if (mo) offset = parseInt(mo[1], 10) || 0;

    var rows = text.split(/\r?\n/);
    var stamp = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    for (var i = 0; i < rows.length; i++) {
      var line = rows[i];
      var times = [];
      var m;
      stamp.lastIndex = 0;
      while ((m = stamp.exec(line))) {
        var frac = m[3] ? parseInt(m[3], 10) : 0;
        if (m[3] && m[3].length === 2) frac *= 10;
        times.push(Math.max(0, parseInt(m[1], 10) * 60 + parseInt(m[2], 10) +
          frac / 1000 + offset / 1000));
      }
      if (!times.length) continue;      // metadata lines such as [ti:...]
      var body = line.replace(stamp, '').trim();
      for (var j = 0; j < times.length; j++) out.push({ t: times[j], text: body });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  // Embedded lyrics (source 3) are often plain text without a single timestamp,
  // so a failed LRC parse must not be read as "this track has no lyrics".
  function plainLyrics(text) {
    var out = [];
    var rows = String(text).split(/\r?\n/);
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i].replace(/\[[^\]]*\]/g, '').trim();
      if (t) out.push({ t: null, text: t });
    }
    return out;
  }

  function loadLyric(t) {
    var guid = t && t.guid;
    if (!guid || state.lyric.guid === guid) return;
    state.lyric.guid = guid;
    state.lyric.lines = [];
    state.lyric.idx = -1;
    state.lyric.timed = true;
    paintLyric();

    api('lyric/list', { trackGUID: guid }).then(function (data) {
      if (state.lyric.guid !== guid) return;   // the track changed meanwhile
      var list = (data && data.list) || [];
      var pick = null;
      for (var i = 0; i < list.length; i++) {
        if (data.preferred && list[i].guid === data.preferred) pick = list[i];
      }
      if (!pick && list.length) pick = list[0];
      var text = pick ? (pick.content || '') : '';
      state.lyric.lines = parseLrc(text);
      state.lyric.timed = true;
      if (!state.lyric.lines.length && text.trim()) {
        state.lyric.lines = plainLyrics(text);
        state.lyric.timed = false;
      }
      state.lyric.idx = -1;
      paintLyric();
      syncLyric();
    }).catch(function () {});
  }

  function paintLyric() {
    var box = $('np-lyric-box');
    if (!box) return;
    var lines = state.lyric.lines;
    if (!lines.length) {
      box.innerHTML = '<div class="lyric-inner empty"><div class="lyric-empty">' +
        (state.lyric.guid ? '这首歌没有歌词' : '') + '</div></div>';
      return;
    }
    var html = '<div class="lyric-inner' + (state.lyric.timed ? '' : ' plain') + '">';
    for (var i = 0; i < lines.length; i++) {
      html += '<div class="lyric-line">' + (esc(lines[i].text) || '&nbsp;') + '</div>';
    }
    box.innerHTML = html + '</div>';
  }

  // The whole list is shifted with one transform instead of scrolling a box, so
  // the active line always sits exactly in the middle and the move can be eased
  // by CSS. Line heights stay fixed, otherwise the offset would drift.
  function syncLyric() {
    var box = $('np-lyric-box');
    if (!box || $('np-lyric').hidden) return;
    var lines = state.lyric.lines;
    if (!lines.length) return;

    // Plain lyrics carry no timeline; drift them at the rate of the track instead.
    if (!state.lyric.timed) {
      var pin = box.querySelector('.lyric-inner');
      if (!pin) return;
      var room = pin.offsetHeight - box.clientHeight;
      if (room <= 0) { pin.style.transform = 'translateY(0px)'; return; }
      var p = au.duration ? (au.currentTime || 0) / au.duration : 0;
      p = Math.max(0, Math.min(1, p));
      pin.style.transform = 'translateY(' + (-p * room) + 'px)';
      return;
    }

    var c = au.currentTime || 0;
    var lo = 0, hi = lines.length - 1, idx = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (lines[mid].t <= c) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (idx === state.lyric.idx) return;
    state.lyric.idx = idx;

    var inner = box.querySelector('.lyric-inner');
    if (!inner) return;
    var els = inner.children;
    for (var i = 0; i < els.length; i++) {
      els[i].className = i === idx ? 'lyric-line on' : 'lyric-line';
    }
    if (idx >= 0 && els[idx]) {
      var line = els[idx];
      inner.style.transform = 'translateY(' + (-(line.offsetTop + line.offsetHeight / 2)) + 'px)';
    }
  }

  // 接下来 / 歌词 / 全屏歌词 — three views of the same right pane, so one key
  // walks them in a ring. The glyph shows where the press takes you, and a
  // toast names the view that just arrived.
  function lyricView() {
    return !state.lyric.open ? 'queue' : state.lyric.full ? 'full' : 'pane';
  }

  var LYRIC_NEXT = { queue: 'pane', pane: 'full', full: 'queue' };
  var LYRIC_ICON = { queue: 'lyric', pane: 'fs', full: 'queue' };
  var LYRIC_NAME = { queue: '接下来', pane: '歌词', full: '全屏歌词' };

  function cycleLyric() {
    var next = LYRIC_NEXT[lyricView()];
    setLyricView(next);
    toast(LYRIC_NAME[next]);
  }

  function setLyricView(v) {
    var open = v !== 'queue';
    var full = v === 'full';
    if (open === state.lyric.open && full === state.lyric.full) return;

    var reopened = open && !state.lyric.open;
    state.lyric.open = open;
    state.lyric.full = full;
    $('np').classList.toggle('lyr', open);
    $('np').classList.toggle('fs', full);
    $('np-lyric').hidden = !open;
    $('np-next').hidden = open;

    // Rebuild only when the pane comes back: the lines stay mounted while it is
    // open, so pane → full must not throw the measured offsets away.
    if (reopened) paintLyric();

    var btn = document.querySelector('#np-controls [data-act="lyric"]');
    setCtl(btn, LYRIC_ICON[v]);
    // The pane just changed width and font size, so the cached offset is stale.
    state.lyric.idx = -1;
    if (open) syncLyric();

    // The queue rows disappear with the pane, so focus may have landed on a
    // hidden node — fall back to this key instead of leaving nothing lit.
    var f = state.focusEl;
    if (!f || !document.contains(f) || !isVisible(f)) {
      clearFocus();
      if (btn) setFocus(btn);
    }
  }

  // The transport is out of the way until the remote is touched, the way
  // Chora's playing page works: the record and its lyrics first, controls on
  // demand. Opening the page counts as a touch, so the bar shows once.
  function npShowBar(focus) {
    if (!overlayOpen()) return;
    clearTimeout(state.npbar.timer);
    $('np').classList.remove('nobar');
    state.npbar.shown = true;
    state.npbar.timer = setTimeout(npHideBar, 5000);
    if (focus) {
      var pp = document.querySelector('#np-controls [data-act="pp"]');
      if (pp) setFocus(pp); else focusFirst();
    }
  }

  function npHideBar() {
    clearTimeout(state.npbar.timer);
    state.npbar.timer = null;
    state.npbar.shown = false;
    if (!overlayOpen()) return;
    $('np').classList.add('nobar');
    // Nothing inside the bar can hold focus while it is away, or the next
    // D-pad press would move from an element nobody can see.
    if (state.focusEl && $('np').contains(state.focusEl)) clearFocus();
  }

  var npCloseTimer = null;

  function openOverlay() {
    if (!currentTrack()) { toast('还没有选择歌曲'); return; }
    clearTimeout(npCloseTimer);
    $('np').classList.remove('closing');
    state.focusBeforeOverlay = state.focusEl;
    $('np').hidden = false;
    state.scope = '#np';
    paintOverlay();
    // The pane was hidden while the page was closed, so its offsets are stale.
    if (state.lyric.open) {
      paintLyric();
      state.lyric.idx = -1;
      syncLyric();
    }
    npShowBar(true);
  }

  function closeOverlay() {
    npHideBar();
    // [hidden] wins with !important, so the section cannot fade itself out —
    // animate the contents, then drop it once the 180ms are up.
    var np = $('np');
    clearTimeout(npCloseTimer);
    np.classList.add('closing');
    npCloseTimer = setTimeout(function () {
      np.hidden = true;
      np.classList.remove('closing');
    }, 170);
    if (state.lyric.full) setLyricView('pane');
    state.scope = '#shell';
    var back = state.focusBeforeOverlay;
    state.focusBeforeOverlay = null;
    if (back && document.contains(back) && isVisible(back)) setFocus(back);
    else ensureFocus();
  }

  // --------------------------------------------------------------- actions

  function activate(el) {
    var act = el.getAttribute('data-act');
    if (!act) return;

    if (act === 'nav') {
      goSection(el.getAttribute('data-section'));
    } else if (act === 'album') {
      openView({ type: 'album', id: el.getAttribute('data-id'), name: el.getAttribute('data-name') });
    } else if (act === 'artist') {
      openView({ type: 'artist', id: el.getAttribute('data-id') });
    } else if (act === 'playlist') {
      openView({ type: 'playlist', id: el.getAttribute('data-id') });
    } else if (act === 'track') {
      var i = parseInt(el.getAttribute('data-i'), 10) || 0;
      var listId = el.getAttribute('data-list');
      var tracks = state.list;
      if (listId === 'history' && state.historyList) tracks = state.historyList;
      if (listId === 'queue') tracks = state.queue;
      playQueue(tracks, i);
      paintRows();
    } else if (act === 'queue') {
      state.index = parseInt(el.getAttribute('data-i'), 10) || 0;
      startPlayback();
      paintOverlay();
    } else if (act === 'playall') {
      playQueue(state.list, 0);
      paintRows();
    } else if (act === 'sort') {
      setSort(el.getAttribute('data-kind'), el.getAttribute('data-sort'));
    } else if (act === 'heroplay') {
      heroPlay();
    } else if (act === 'pp') {
      togglePlay();
    } else if (act === 'next') {
      nextTrack();
    } else if (act === 'prev') {
      prevTrack();
    } else if (act === 'mode') {
      cycleMode();
    } else if (act === 'np') {
      openOverlay();
    } else if (act === 'lyric') {
      cycleLyric();
    } else if (act === 'roam') {
      if (state.roam.active) { roamStep(false); } else { roamStart(); }
    } else if (act === 'more') {
      var page = parseInt(el.getAttribute('data-page'), 10) || 2;
      if (state.loadMore) state.loadMore(page);
    } else if (act === 'logout') {
      doLogout();
    } else if (act === 'login') {
      submitLogin();
    } else if (act === 'osk') {
      oskPress(el.getAttribute('data-okey'));
    }
  }

  function paintRows() {
    var t = currentTrack();
    var rows = document.querySelectorAll('.row[data-act="track"]');
    for (var i = 0; i < rows.length; i++) {
      var guid = null;
      var key = rows[i].getAttribute('data-key') || '';
      var parts = key.split(':');
      guid = parts.slice(2).join(':');
      var now = !!(t && guid === t.guid);
      rows[i].classList.toggle('now', now);
      // With no track number in the row, the cover itself becomes the marker:
      // a dimmed veil with a small equaliser while the track is playing.
      var cov = rows[i].querySelector('.rcover');
      if (cov) {
        var eq = cov.querySelector('.eq');
        // Rewriting the markup would restart the animation, so only swap it
        // when the row actually changes state.
        if (now && !eq) cov.insertAdjacentHTML('beforeend', '<span class="eq"><i></i><i></i><i></i></span>');
        else if (!now && eq) cov.removeChild(eq);
      }
    }
    document.body.classList.toggle('is-paused', !!au.paused);
  }

  function modeIcon() {
    return state.shuffle ? 'shuffle'
      : state.repeat === 2 ? 'repeat1'
      : state.repeat === 1 ? 'repeat' : 'seq';
  }

  function modeName() {
    return state.shuffle ? '随机'
      : state.repeat === 2 ? '单曲循环'
      : state.repeat === 1 ? '列表循环' : '顺序播放';
  }

  function cycleMode() {
    if (!state.shuffle && state.repeat === 0) { state.repeat = 1; }        // 顺序 -> 列表循环
    else if (state.repeat === 1) { state.repeat = 2; }                     // -> 单曲
    else if (state.repeat === 2) { state.repeat = 0; state.shuffle = true; }
    else { state.shuffle = false; }                                        // -> 顺序
    paintPlayer();
    // The button is glyph-only now, so the toast is where the mode gets named.
    toast('播放模式：' + modeName());
  }

  // ------------------------------------------------------------------ auth

  function showLogin() {
    $('login').hidden = false;
    $('shell').hidden = true;
    state.scope = '#login';
    clearFocus();
    var host = (state.status && state.status.host) || '';
    $('lg-host').value = host;
    $('lg-user').value = '';
    $('lg-pass').value = '';
    $('lg-err').hidden = true;
    setFocus($('lg-btn'));
  }

  function submitLogin() {
    var host = $('lg-host').value.trim();
    var user = $('lg-user').value.trim();
    var pass = $('lg-pass').value;
    if (!host) { loginError('请输入服务器地址'); return; }
    if (!user) { loginError('请输入用户名'); return; }

    var btn = $('lg-btn');
    btn.disabled = true;
    btn.textContent = '登录中…';

    fetch('/_login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: host, username: user, password: pass })
    }).then(function (r) { return r.json(); }).then(function (res) {
      btn.disabled = false;
      btn.textContent = '登录';
      if (!res || !res.ok) {
        loginError((res && res.msg) || '登录失败');
        return;
      }
      state.status = { ok: true, host: host, loggedIn: true, user: res.user };
      $('login').hidden = true;
      $('shell').hidden = false;
      state.scope = '#shell';
      boot();
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = '登录';
      loginError(e.message || '网络错误');
    });
  }

  function loginError(msg) {
    var box = $('lg-err');
    box.textContent = msg;
    box.hidden = false;
    toast(msg);
  }

  function doLogout() {
    fetch('/_logout', { method: 'POST' }).then(function () {
      state.status = { ok: true, loggedIn: false };
      state.queue = [];
      state.index = -1;
      try { localStorage.removeItem('syrinx.player'); } catch (e) {}
      au.pause();
      au.removeAttribute('src');
      $('shell').hidden = true;
      showLogin();
    }).catch(function () { toast('退出失败'); });
  }

  // ------------------------------------------------------------------ input

  function runSearch(q) {
    if (!q) return;
    $('grid-box').innerHTML = skelRows(6);

    // The library has separate search indexes per type, so one query lights up
    // four sections instead of a track-only list.
    var empty = function () { return { list: [] }; };
    Promise.all([
      // 116 song hits would bury the artist/album rows under a lot of D-pad
      // presses, so the track section stays short; refine the query instead.
      api('search/track', { q: q, page: 1, size: 20 }).catch(empty),
      api('search/album', { q: q, page: 1, size: 12 }).catch(empty),
      api('search/artist', { q: q, page: 1, size: 12 }).catch(empty),
      api('search/playlist', { q: q, page: 1, size: 12 }).catch(empty)
    ]).then(function (res) {
      var tracks = (res[0] && res[0].list) || [];
      var allTracks = tracks.length;
      // The server ignores ?size= for search and returns every hit, so the trim
      // has to happen here or the artist/album rows sit behind 100+ key presses.
      tracks = tracks.slice(0, 20);
      var albums = (res[1] && res[1].list) || [];
      var artists = (res[2] && res[2].list) || [];
      var lists = (res[3] && res[3].list) || [];
      state.list = tracks;

      if (!tracks.length && !albums.length && !artists.length && !lists.length) {
        $('grid-box').innerHTML = '<div class="empty">没有找到相关内容</div>';
        ensureFocus();
        return;
      }

      var html = '';
      if (tracks.length) {
        html += sectionHead('歌曲', allTracks > tracks.length
          ? ('前 ' + tracks.length + ' 首 / 共 ' + allTracks + ' 首')
          : (tracks.length + ' 首')) +
          '<div class="list">' + tracks.map(function (t, i) {
            return trackRow(t, i, 'list');
          }).join('') + '</div>';
      }
      if (artists.length) {
        if (html) html += '<div class="section-gap"></div>';
        html += sectionHead('歌手') + '<div class="grid">' +
          artists.map(artistCard).join('') + '</div>';
      }
      if (albums.length) {
        if (html) html += '<div class="section-gap"></div>';
        html += sectionHead('专辑') + '<div class="grid">' +
          albums.map(albumCard).join('') + '</div>';
      }
      if (lists.length) {
        if (html) html += '<div class="section-gap"></div>';
        html += sectionHead('歌单') + '<div class="grid">' +
          lists.map(playlistCard).join('') + '</div>';
      }
      $('grid-box').innerHTML = html;
      ensureFocus();
    }).catch(function (e) {
      $('grid-box').innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
      ensureFocus();
    });
  }

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;

    // Editing a text field: the IME owns the remote. BACK (handled natively)
    // leaves the field, OK finishes editing; only the search box submits.
    if (isTextField(document.activeElement)) {
      if (k === 13) {
        e.preventDefault();
        var el = document.activeElement;
        el.blur();
        if (el.id === 'search-box') runSearch(el.value.trim());
        return;
      }
      return;
    }

    // Playing page: any key wakes the transport bar and restarts its five
    // seconds. While it is away, LEFT/RIGHT scrub the track directly — the
    // timeline is the one control worth keeping one press away.
    if (overlayOpen()) {
      if (state.npbar.shown) {
        clearTimeout(state.npbar.timer);
        state.npbar.timer = setTimeout(npHideBar, 5000);
      } else if (k === 37 || k === 38 || k === 39 || k === 40 || k === 13 || k === 32) {
        e.preventDefault();
        if (k === 37 || k === 39) {
          if (au.duration) {
            au.currentTime = Math.max(0, Math.min(au.duration,
              (au.currentTime || 0) + (k === 39 ? 10 : -10)));
            paintProgress();
          }
          return;
        }
        npShowBar(true);
        return;
      }
    }

    if (state.focusEl && state.focusEl.id === 'np-seek' && (k === 37 || k === 39)) {
      e.preventDefault();
      if (au.duration) {
        var t = au.currentTime + (k === 39 ? 10 : -10);
        au.currentTime = Math.max(0, Math.min(au.duration, t));
        paintProgress();
      }
      return;
    }

    if (k === 37 || k === 38 || k === 39 || k === 40) {
      e.preventDefault();
      var dir = k === 37 ? 'left' : k === 39 ? 'right' : k === 38 ? 'up' : 'down';
      if (state.osk.input) oskMove(dir); else navigate(dir);
      return;
    }

    if (k === 13 || k === 32) {
      e.preventDefault();
      var f = state.focusEl;
      if (!f) { focusFirst(); return; }
      if (f.id === 'np-seek') return;
      if (isTextField(f)) { oskOpen(f); return; }
      f.click();
      return;
    }
  }, true);

  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document.body) {
      if (el.classList && el.classList.contains('f')) {
        setFocus(el);
        activate(el);
        return;
      }
      el = el.parentNode;
    }
  });

  // ------------------------------------------------------- resume on launch

  // The TV is turned off from the remote, so the app is killed and restarted
  // often. Keep the queue and position on disk and come back to them paused.
  var saveAt = 0;
  var resuming = false;
  function savePlayer(force, pos) {
    var now = Date.now();
    if (!force && now - saveAt < 4000) return;
    saveAt = now;
    try {
      localStorage.setItem('syrinx.player', JSON.stringify({
        q: state.queue.slice(0, 200),
        i: state.index,
        t: pos === undefined ? (au.currentTime || 0) : pos,
        s: state.shuffle ? 1 : 0,
        r: state.repeat || 0
      }));
    } catch (e) {}
  }

  function restorePlayer() {
    var raw = null;
    try { raw = localStorage.getItem('syrinx.player'); } catch (e) {}
    if (!raw) return false;
    var d;
    try { d = JSON.parse(raw); } catch (e) { return false; }
    if (!d || !d.q || !d.q.length) return false;

    state.queue = d.q;
    state.index = Math.max(0, Math.min(d.i || 0, d.q.length - 1));
    state.shuffle = !!d.s;
    state.repeat = d.r || 0;
    var t = currentTrack();
    if (!t) return false;

    resuming = true;
    au.src = '/api/track/stream?guid=' + encodeURIComponent(t.guid);
    au.addEventListener('loadedmetadata', function resume() {
      au.removeEventListener('loadedmetadata', resume);
      if (d.t > 0 && (!au.duration || d.t < au.duration - 5)) au.currentTime = d.t;
      paintProgress();
    });
    paintPlayer();
    paintProgress();
    loadLyric(t);
    updateMediaSession(t);
    return true;
  }

  // ------------------------------------------------------------- boot

  function boot() {
    buildSidebar();
    render({ type: 'section', key: 'home' });
    if (restorePlayer()) toast('已回到上次的播放位置');
  }

  window.TV = {
    onBack: function () {
      if (state.osk.input) { oskClose(); return; }
      var ae = document.activeElement;
      if (isTextField(ae)) { ae.blur(); return; }
      goBack();
    },
    onMedia: function (kind) {
      if (kind === 'playpause') togglePlay();
      else if (kind === 'next') nextTrack();
      else if (kind === 'prev') prevTrack();
      else if (kind === 'stop') { au.pause(); au.currentTime = 0; }
    },
    // Remote MENU/INFO key: jump to now-playing from anywhere, instead of
    // scrolling to the end of a long list to reach the player bar.
    onMenu: function () {
      if (overlayOpen()) closeOverlay(); else openOverlay();
    }
  };

  // player bar buttons
  buildOsk();

  // Transport is glyph-only. The whole left chip already opens the playing page,
  // so the bar no longer spends a button on it, and the mode toggle sits with the
  // rest of the transport instead of out at the far right edge.
  $('pb-buttons').innerHTML =
    ctlBtn('prev', 'p:prev', 'prev') +
    ctlBtn('pp', 'p:pp', 'play', true) +
    ctlBtn('next', 'p:next', 'next') +
    ctlBtn('mode', 'p:mode', modeIcon());
  wireRow($('pb-buttons'));

  // The cover sits far left of the transport row, so pure geometry would send
  // LEFT off into the content grid.
  var pbPrev = $('pb-buttons').querySelector('[data-key="p:prev"]');
  if (pbPrev) pbPrev.setAttribute('data-left', 'pb:np');

  $('np-controls').innerHTML =
    ctlBtn('lyric', 'n:lyric', LYRIC_ICON[lyricView()]) +
    ctlBtn('prev', 'n:prev', 'prev') +
    ctlBtn('pp', 'n:pp', 'play', true) +
    ctlBtn('next', 'n:next', 'next') +
    ctlBtn('mode', 'n:mode', modeIcon());
  wireRow($('np-controls'));
  // UP off the transport lands on the timeline, and DOWN comes straight back
  // to the play key rather than wherever geometry happens to land.
  var npSeek = $('np-seek');
  if (npSeek) npSeek.setAttribute('data-down', 'n:pp');

  au.addEventListener('timeupdate', paintProgress);
  au.addEventListener('timeupdate', syncLyric);
  au.addEventListener('timeupdate', function () { savePlayer(false); });
  au.addEventListener('pause', function () { if (!resuming) savePlayer(true); });
  au.addEventListener('play', function () { resuming = false; });
  window.addEventListener('pagehide', function () { savePlayer(true); });
  au.addEventListener('play', function () { state.playing = true; paintPlayer(); });
  au.addEventListener('pause', function () { state.playing = false; paintPlayer(); });
  au.addEventListener('ended', nextTrack);
  au.addEventListener('error', function () {
    if (au.error) toast('音频加载失败 (' + au.error.code + ')');
  });
  au.addEventListener('loadedmetadata', paintProgress);

  // gesture support on the seek bar
  $('np-seek').addEventListener('click', function (e) {
    var r = this.getBoundingClientRect();
    var pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    if (au.duration) au.currentTime = au.duration * pct;
  });

  fetch('/_status').then(function (r) { return r.json(); }).then(function (s) {
    state.status = s;
    if (s && s.loggedIn) {
      $('shell').hidden = false;
      state.scope = '#shell';
      boot();
    } else {
      showLogin();
    }
  }).catch(function () {
    showLogin();
  });
})();
