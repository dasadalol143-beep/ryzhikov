/* =====================================================================
   АВТОПИЛОТ КАЧЕСТВА
   Меряет реальную частоту кадров и, если кадр не успевает, по ступеням
   снижает нагрузку: 3 - максимум, 2 - легче, 1 - без видео, 0 - минимум.
   Слабые и сенсорные устройства стартуют со ступени 2.
   Качество только снижается, чтобы картинка не «прыгала» туда-обратно.
   ===================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;
  var listeners = [];
  var nav = navigator;
  var touch = ('ontouchstart' in window) || nav.maxTouchPoints > 0;
  var weak = (nav.deviceMemory && nav.deviceMemory <= 4) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4);
  var saveData = nav.connection && nav.connection.saveData;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var tier = reduce ? 0 : saveData ? 1 : (touch || weak) ? 2 : 3;
  // ручная настройка для проверки: ?q=0..3
  var m = /[?&]q=(\d)/.exec(location.search);
  if (m) tier = Math.max(0, Math.min(3, +m[1]));

  function apply() {
    root.classList.remove('q-0', 'q-1', 'q-2', 'q-3');
    root.classList.add('q-' + tier);
  }
  apply();

  function setTier(t) {
    t = Math.max(0, Math.min(3, t));
    if (t === tier) return;
    tier = t;
    apply();
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](tier); } catch (e) { /* модуль не должен ронять остальных */ }
    }
  }

  /* ---------- замер: окна по 1,5 с, считаем средний и «плохие» кадры ---------- */
  var locked = !!m || reduce;
  var last = 0, acc = 0, n = 0, slow = 0, badWindows = 0, startAt = 0;
  var target = 1000 / 50;          // ниже 50 к/с считаем просадкой
  function loop(now) {
    if (!startAt) startAt = now;
    if (last) {
      var dt = now - last;
      if (dt < 250) {               // паузы вкладки и сна не считаем
        acc += dt; n++;
        if (dt > 34) slow++;
      }
    }
    last = now;
    // первые 2,5 с не судим: идёт загрузка
    if (acc > 1500 && now - startAt > 2500) {
      var avg = acc / n, slowShare = slow / n;
      if (avg > target || slowShare > 0.12) badWindows++;
      else badWindows = Math.max(0, badWindows - 1);
      if (badWindows >= 2 && tier > 0) { setTier(tier - 1); badWindows = 0; }
      acc = 0; n = 0; slow = 0;
    }
    if (!locked) requestAnimationFrame(loop);
  }
  if (!locked) requestAnimationFrame(loop);
  document.addEventListener('visibilitychange', function () { last = 0; });

  window.RyzhikovPerf = {
    tier: function () { return tier; },
    onChange: function (fn) { listeners.push(fn); },
    set: setTier,
    touch: touch
  };
})();
