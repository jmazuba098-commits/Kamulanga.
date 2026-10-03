/* Glass layer behaviour: floating books + "Centre of Excellence", instant press feedback, progress bar. */
(function () {
  'use strict';
  var small = matchMedia('(max-width:640px)').matches;

  /* ---- deterministic randomness so the layout is the same on every visit ---- */
  var seed = 7;
  function r() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  function pick(a) { return a[Math.floor(r() * a.length)]; }

  /* ---- background ---- */
  var COVERS = ['#ff7a7a', '#ffb27a', '#79e3c3', '#f3d9a6', '#9ad9ff', '#ff9fb0', '#23a58a'];
  function book(c) {
    return '<svg class="book" viewBox="0 0 50 64" aria-hidden="true"><rect x="4" y="3" width="42" height="58" rx="4" fill="' + c + '"/>' +
      '<rect x="4" y="3" width="9" height="58" rx="3" fill="rgba(6,46,38,.28)"/><rect x="18" y="14" width="22" height="3" rx="1.5" fill="rgba(255,255,255,.75)"/>' +
      '<rect x="18" y="21" width="15" height="3" rx="1.5" fill="rgba(255,255,255,.55)"/><rect x="8" y="58" width="36" height="3" fill="rgba(255,255,255,.8)"/></svg>';
  }
  function floater(html, cls, x, y, extra) {
    var d = document.createElement('div');
    d.className = 'fl ' + cls;
    var dx = (r() - .5) * 90, dy = (r() - .5) * 110;
    d.style.cssText = '--x:' + x + '%;--y:' + y + '%;--t:' + (14 + r() * 16).toFixed(1) + 's;--d:-' + (r() * 14).toFixed(1) + 's;' +
      '--dx:' + dx.toFixed(0) + 'px;--dy:' + dy.toFixed(0) + 'px;--r0:' + ((r() - .5) * 30).toFixed(0) + 'deg;--r1:' + ((r() - .5) * 40).toFixed(0) + 'deg;' + (extra || '');
    d.innerHTML = html;
    return d;
  }
  function buildBackground() {
    var bg = document.createElement('div');
    bg.id = 'kss-bg'; bg.setAttribute('aria-hidden', 'true');
    bg.innerHTML = '<i class="blob b1"></i><i class="blob b2"></i><i class="blob b3"></i>';
    var books = small ? 7 : 13, words = small ? 3 : 5, i;
    for (i = 0; i < books; i++) bg.appendChild(floater(book(pick(COVERS)), 'bk', (4 + r() * 88).toFixed(1), (3 + r() * 88).toFixed(1), '--s:' + Math.round((small ? 26 : 30) + r() * (small ? 22 : 34)) + 'px'));
    var spots = [[4, 10], [46, 34], [8, 58], [52, 78], [24, 90]];
    for (i = 0; i < words; i++) bg.appendChild(floater('Centre of Excellence', 'wd word', spots[i][0], spots[i][1], '--fs:' + Math.round(26 + r() * 30) + 'px'));
    document.body.insertBefore(bg, document.body.firstChild);
  }

  /* ---- progress bar (route changes + server work) ---- */
  var bar, barT = 0, busyCount = 0;
  function barStart() {
    clearTimeout(barT); bar.className = ''; void bar.offsetWidth; bar.className = 'on';
  }
  function barDone() {
    clearTimeout(barT); barT = setTimeout(function () { bar.className = 'done'; }, 120);
  }
  function busy(on) {
    busyCount = Math.max(0, busyCount + (on ? 1 : -1));
    if (on && busyCount === 1) barStart(); else if (!busyCount) barDone();
  }

  /* ---- instant feedback ---- */
  var PRESS = '.btn,.tab,.chip-btn,.icon-btn,.seg a,.brand,.pw-toggle';
  function ripple(e) {
    var el = e.target.closest && e.target.closest(PRESS);
    if (!el || el.disabled) return;
    el.classList.add('kss-rip');
    var b = el.getBoundingClientRect(), s = Math.max(b.width, b.height) * 2.2, x = e.clientX - b.left, y = e.clientY - b.top;
    var d = document.createElement('span');
    d.className = 'rip';
    d.style.cssText = 'width:' + s + 'px;height:' + s + 'px;left:' + (x - s / 2) + 'px;top:' + (y - s / 2) + 'px';
    el.appendChild(d);
    setTimeout(function () { d.remove(); }, 600);
    if (navigator.vibrate) { try { navigator.vibrate(6); } catch (err) { /* not supported */ } }
  }
  var raf = 0;
  function light(e) {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      var p = e.target.closest && e.target.closest('.panel,.stage,.topbar');
      if (!p) return;
      var b = p.getBoundingClientRect();
      p.style.setProperty('--mx', ((e.clientX - b.left) / b.width * 100).toFixed(0) + '%');
      p.style.setProperty('--my', ((e.clientY - b.top) / b.height * 100).toFixed(0) + '%');
    });
  }

  function init() {
    bar = document.createElement('div'); bar.id = 'kss-bar'; document.body.appendChild(bar);
    buildBackground();
    document.addEventListener('pointerdown', ripple, { passive: true });
    document.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse') light(e); }, { passive: true });
    addEventListener('hashchange', function () { barStart(); setTimeout(barDone, 260); });
  }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);

  /* Connect an SDK client so the bar shows while the server is working:
       KSSGlass.attach(KSS.create({ baseUrl: 'https://your-api' })) */
  window.KSSGlass = { busy: busy, attach: function (client) { return client.on('busy', function (b) { busy(b); }); } };
})();
