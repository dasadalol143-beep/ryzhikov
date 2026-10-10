/* =====================================================================
   ГАЙД РЫЖИКОВА · сценарий
   Три мира: сакура → врата ада → Египет. Дракон ведёт читателя,
   во время чтения отходит на край, на вратах ныряет в новый мир.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- Яндекс Метрика ----------
     Впиши сюда номер счётчика из metrika.yandex.ru (только цифры).
     Пока 0 — метрика не грузится. Вебвизор включён: в нём есть карта
     скроллинга, карта кликов и записи сессий. */
  var METRIKA_ID = 0;
  if (METRIKA_ID) {
    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      k = e.createElement(t); a = e.getElementsByTagName(t)[0];
      k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
    window.ym(METRIKA_ID, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: true });
  }
  var goalsHit = {};
  function goal(name, once) {
    if (once && goalsHit[name]) return;
    goalsHit[name] = true;
    if (METRIKA_ID && window.ym) window.ym(METRIKA_ID, 'reachGoal', name);
  }

  var root = document.documentElement;
  var body = document.body;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var Dragon = window.RyzhikovDragon || { setPlan: function () {}, breathe: function () {}, setPalette: function () {}, isMobile: function () { return false; } };
  var Worlds = window.RyzhikovWorlds || null;
  var isMobile = function () { return window.innerWidth < 760; };

  if (reduce) root.classList.add('reduced');
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });

  /* ---------- плавный скролл (колесо мыши; на тач-экранах нативный) ---------- */
  var lenis = null;
  if (!reduce && typeof Lenis === 'function') {
    lenis = new Lenis({
      duration: 1.25,
      easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
      smoothWheel: true,
      wheelMultiplier: 0.9
    });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
    gsap.ticker.lagSmoothing(0);
    lenis.stop();
  }

  function scrollToEl(el) {
    if (!el) return;
    if (lenis) lenis.scrollTo(el, { duration: 2.2, easing: function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; } });
    else el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-jump]');
    if (!a) return;
    var id = a.getAttribute('href');
    if (!id || id.charAt(0) !== '#') return;
    e.preventDefault();
    if (id === '#top') { if (lenis) lenis.scrollTo(0, { duration: 2.2 }); else window.scrollTo(0, 0); return; }
    scrollToEl(document.querySelector(id));
  });

  /* ---------- главы: имя в шапке ---------- */
  var rooms = {};
  document.querySelectorAll('[data-room][data-name]').forEach(function (s) { rooms[s.dataset.room] = s.dataset.name; });
  var hudRoom = document.querySelector('#hudRoom span');
  var depthLinks = Array.prototype.slice.call(document.querySelectorAll('#depthList a'));
  var currentRoom = -1;
  function setRoom(n) {
    n = parseInt(n, 10);
    if (n === currentRoom) return;
    currentRoom = n;
    if (hudRoom && rooms[n]) {
      gsap.to(hudRoom.parentNode, { opacity: 0, duration: .2, onComplete: function () {
        hudRoom.textContent = 'Глава ' + rooms[n];
        gsap.to(hudRoom.parentNode, { opacity: 1, duration: .4 });
      } });
    }
    depthLinks.forEach(function (a) {
      var f = parseInt(a.dataset.for, 10);
      a.classList.toggle('on', f === n);
      a.classList.toggle('past', f < n);
    });
  }

  var currentWorld = -1;
  function setWorld(n) {
    if (!Worlds || n === currentWorld) return;
    var first = currentWorld < 0;
    currentWorld = n;
    var th = Worlds.activate(n, first);
    if (th) Dragon.setPalette(th.dragon, first || (Dragon.state && Dragon.state().alpha < .35));
  }

  /* ---------- планы полёта ----------
     hero  - дракон крупно, хозяин кадра
     side  - читатель читает: дракон уходит к краю и почти гаснет
     show  - интерактив: дракон ближе, но не поверх текста
     gate  - зависает над вратами и ныряет
     final - над кнопкой, дышит огнём */
  var PLANS = {
    hero:  function () { return isMobile() ? { tx: .56, ty: .17, scale: 1.05, alpha: 1, wander: .7, k: 1.7 } : { tx: .74, ty: .5, scale: 1.15, alpha: 1, wander: 1, k: 1.7 }; },
    side:  function () { return isMobile() ? { tx: .97, ty: .52, scale: .6, alpha: .2, wander: .25, k: 1.7 } : { tx: .95, ty: .5, scale: .9, alpha: window.innerWidth < 1300 ? .32 : .55, wander: .35, k: 1.7 }; },
    show:  function () { return isMobile() ? { tx: .9, ty: .16, scale: .62, alpha: .55, wander: .3, k: 1.7 } : { tx: .9, ty: .3, scale: 1, alpha: .85, wander: .5, k: 1.7 }; },
    gate:  function () { return { tx: .5, ty: .3, scale: isMobile() ? 1 : 1.25, alpha: 1, wander: .3, k: 5 }; },
    final: function () { return isMobile() ? { tx: .5, ty: .14, scale: .9, alpha: 1, wander: .3, k: 1.7 } : { tx: .84, ty: .3, scale: 1.1, alpha: 1, wander: .35, k: 1.7 }; }
  };
  function plan(name) { Dragon.setPlan(PLANS[name]()); }
  plan('hero');
  setWorld(0);

  /* ---------- где мы сейчас: по геометрии ---------- */
  var zones = Array.prototype.slice.call(document.querySelectorAll('[data-room]'));
  var GATE_A = 1.09;
  var zoneTops = [];
  var currentPlan = '';
  var isReading = false;
  function measureZones() {
    var sy = window.scrollY || 0;
    zoneTops = zones.map(function (el) {
      var box = el.classList.contains('gate') && el.parentNode.classList.contains('pin-spacer') ? el.parentNode : el;
      return box.getBoundingClientRect().top + sy;
    });
  }
  function trackZones() {
    if (zoneTops.length !== zones.length) measureZones();
    var vh = window.innerHeight, line = vh * .55, active = null, gatePhase = false, world = 0, sy = window.scrollY || 0;
    for (var i = 0; i < zones.length; i++) {
      var el = zones[i];
      var top = zoneTops[i] - sy;
      if (top <= line) {
        active = el;
        var isGate = el.classList.contains('gate');
        var room = parseInt(el.dataset.room, 10) || 0;
        gatePhase = isGate && top > -vh * GATE_A;
        world = isGate ? (-top / (vh * GATE_A) < .8 ? room - 1 : room) : room;
      }
    }
    if (!active) active = zones[0];
    var reading = !gatePhase && active.dataset.dragon !== 'hero';
    if (reading !== isReading) {
      isReading = reading;
      root.classList.toggle('reading', reading);
      if (Worlds && Worlds.setReading) Worlds.setReading(reading);
    }
    setRoom(active.dataset.room);
    setWorld(Math.max(0, world));
    var want = gatePhase ? 'gate' : (active.dataset.dragon || currentPlan || 'hero');
    if (want !== currentPlan) {
      var fromGate = currentPlan === 'gate';
      currentPlan = want;
      plan(want);
      if (fromGate && want !== 'gate' && Dragon.state && Dragon.state().alpha < .2 && Dragon.reenter) Dragon.reenter();
    }
  }
  var zq = false;
  function trackQueued() { if (zq) return; zq = true; requestAnimationFrame(function () { zq = false; trackZones(); }); }
  window.addEventListener('scroll', trackQueued, { passive: true });
  window.addEventListener('resize', function () { plan(currentPlan || 'hero'); trackQueued(); }, { passive: true });
  ScrollTrigger.addEventListener('refresh', function () { measureZones(); trackQueued(); });

  /* ---------- загрузка ---------- */
  var loader = document.getElementById('loader');
  var bar = document.getElementById('loaderBar');
  if (bar) requestAnimationFrame(function () { bar.style.width = '45%'; });
  if (!reduce) {
    gsap.set('.hero h1 .ln > span', { yPercent: 115 });
    gsap.set('.h-in', { autoAlpha: 0, y: 26 });
  }
  function heroIn() {
    setRoom(0);
    if (reduce) return;
    gsap.timeline({ defaults: { ease: 'expo.out' } })
      .to('.hero h1 .ln > span', { yPercent: 0, duration: 1.5, stagger: .11 }, .1)
      .to('.h-in', { autoAlpha: 1, y: 0, duration: 1.3, stagger: .1 }, .5);
  }
  var loaded = false;
  function finishLoad() {
    if (loaded) return;
    loaded = true;
    if (bar) bar.style.width = '100%';
    setTimeout(function () {
      body.classList.remove('is-loading');
      if (lenis) lenis.start();
      ScrollTrigger.refresh();
      if (loader) gsap.to(loader, { autoAlpha: 0, duration: reduce ? .2 : 1, ease: 'power2.inOut', onComplete: function () { loader.remove(); } });
      heroIn();
    }, reduce ? 50 : 380);
  }
  var pageLoad = new Promise(function (r) { if (document.readyState === 'complete') r(); else window.addEventListener('load', r); });
  var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([Promise.all([pageLoad, fontsReady]), new Promise(function (r) { setTimeout(r, 2800); })]).then(finishLoad);

  if (!reduce) {
    gsap.to('.hero .wrap', { yPercent: -12, opacity: 0, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('.scroll-cue', { opacity: 0, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: '20% top', scrub: true } });
  }

  /* ---------- врата ---------- */
  var lbT = document.querySelector('.lb--t'), lbB = document.querySelector('.lb--b'), lbLast = -1;
  function setLB(k) {
    k = Math.round(k * 100) / 100;
    if (k === lbLast || !lbT) return;
    lbLast = k;
    lbT.style.transform = 'scaleY(' + k + ')';
    lbB.style.transform = 'scaleY(' + k + ')';
  }
  document.querySelectorAll('.gate').forEach(function (gate) {
    if (reduce) return;
    var frame = gate.querySelector('.gate-frame');
    var doorL = gate.querySelector('.door--l');
    var doorR = gate.querySelector('.door--r');
    var light = gate.querySelector('.gate-light');
    var copy = gate.querySelector('.gate-copy .inner');
    var num = gate.querySelector('.gate-num');
    var title = gate.querySelector('.gate-title');
    var tl = gsap.timeline({
      scrollTrigger: {
        trigger: gate, start: 'top top', end: '+=190%', pin: true, scrub: 1, anticipatePin: 1,
        onToggle: function (self) { if (!self.isActive) setLB(0); },
        onUpdate: function (self) {
          var p = Math.min(1, self.progress / .574);
          if (currentPlan === 'gate' && p < 1) {
            var dive = Math.max(0, Math.min(1, (p - .38) / .42));
            var e = dive * dive * (3 - 2 * dive);
            Dragon.setPlan({
              tx: .5, ty: .3 + e * .36, wander: .3 * (1 - e), k: 6,
              scale: (isMobile() ? 1 : 1.25) * (1 - e * .68),
              alpha: 1 - Math.max(0, (dive - .55) / .45)
            });
          }
          setLB(Math.sin(p * Math.PI));
        }
      }
    });
    tl.fromTo(frame, { scale: .84, y: 50 }, { scale: 1, y: 0, duration: .32, ease: 'power1.out' }, 0)
      .fromTo(copy, { autoAlpha: 0, y: 60 }, { autoAlpha: 1, y: 0, duration: .24, ease: 'power2.out' }, 0)
      .fromTo(num, { scale: .7, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: .34, ease: 'power2.out' }, 0)
      .fromTo(title, { letterSpacing: '.12em' }, { letterSpacing: '-.01em', duration: .3, ease: 'power2.out' }, 0)
      .to(copy, { autoAlpha: 0, y: -50, duration: .16, ease: 'power1.in' }, .42)
      .to(num, { autoAlpha: 0, scale: 1.3, duration: .2 }, .42)
      .to(doorL, { rotateY: -112, duration: .34, ease: 'power2.inOut' }, .44)
      .to(doorR, { rotateY: 112, duration: .34, ease: 'power2.inOut' }, .44)
      .to(light, { autoAlpha: 1, scale: 1.5, duration: .38, ease: 'power1.out' }, .44)
      .to(frame, { scale: 2.2, duration: .46, ease: 'power2.in' }, .56)
      .to(frame, { opacity: .3, duration: .14 }, .88)
      .to(frame, { opacity: 0, duration: .5, ease: 'none' }, 1.1)
      .to({}, { duration: .18 }, 1.6);
  });

  /* ---------- появление блоков ---------- */
  var rvEls = Array.prototype.slice.call(document.querySelectorAll('.rv'));
  if (reduce || !('IntersectionObserver' in window)) {
    rvEls.forEach(function (el) { el.classList.add('in'); });
  } else {
    var rvIO = new IntersectionObserver(function (entries) {
      var k = 0;
      entries.forEach(function (e) {
        if (!e.isIntersecting && e.boundingClientRect.top > 0) return;
        var el = e.target;
        el.style.transitionDelay = e.isIntersecting ? (Math.min(k++, 5) * 70) + 'ms' : '0ms';
        el.classList.add('in');
        rvIO.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
    rvEls.forEach(function (el) { rvIO.observe(el); });
  }

  var refreshT = null;
  function refreshSoon(delay) { clearTimeout(refreshT); refreshT = setTimeout(function () { ScrollTrigger.refresh(); }, delay || 80); }
  var fmt = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };

  /* ---------- золотой круг ---------- */
  (function () {
    var chips = Array.prototype.slice.call(document.querySelectorAll('#calc .chip'));
    if (!chips.length) return;
    var sumEl = document.getElementById('calcSum');
    var hint = document.getElementById('calcHint');
    var barEl = document.getElementById('calcBar');
    var all = document.getElementById('calcAll');
    var shown = { v: 0 };
    var MAX = 130000;
    var hit = false;
    function render() {
      var total = 0, n = 0;
      chips.forEach(function (c) { if (c.classList.contains('on')) { total += parseInt(c.dataset.v, 10); n++; } });
      gsap.to(shown, { v: total, duration: .55, ease: 'power3.out', onUpdate: function () { sumEl.textContent = fmt(shown.v) + ' ₽'; } });
      barEl.style.transform = 'scaleX(' + Math.min(1, total / MAX).toFixed(3) + ')';
      hint.textContent = n === 0 ? 'Нажми на банки ниже' : ('Выбрано: ' + n + ' из ' + chips.length + (total >= 100000 ? ' · это уже больше 100 тысяч' : ''));
      all.textContent = n === chips.length ? 'Сбросить' : 'Открыть все';
      if (total >= 100000 && !hit) { hit = true; Dragon.breathe(1.2); goal('calc_100k', true); }
      if (total < 100000) hit = false;
    }
    chips.forEach(function (c) {
      c.setAttribute('aria-pressed', 'false');
      c.addEventListener('click', function () {
        var on = !c.classList.contains('on');
        c.classList.toggle('on', on);
        c.setAttribute('aria-pressed', String(on));
        render();
      });
    });
    all.addEventListener('click', function () {
      goal('calc_all', true);
      var on = !chips.every(function (c) { return c.classList.contains('on'); });
      chips.forEach(function (c, i) {
        setTimeout(function () { c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); render(); }, on && !reduce ? i * 70 : 0);
      });
    });
  })();

  /* ---------- табы офферов ---------- */
  document.querySelectorAll('#board .tab').forEach(function (t, _, all) {
    t.addEventListener('click', function () {
      all.forEach(function (x) { var on = x === t; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); });
      document.querySelectorAll('#board .tpane').forEach(function (p) { p.classList.toggle('on', p.dataset.p === t.dataset.t); });
      goal('tab_' + t.dataset.t, true);
      refreshSoon(60);
    });
  });

  /* ---------- параллакс фото ---------- */
  if (!reduce) {
    document.querySelectorAll('.par').forEach(function (el) {
      gsap.fromTo(el, { yPercent: -6 }, { yPercent: 6, ease: 'none', scrollTrigger: { trigger: el.parentNode, start: 'top bottom', end: 'bottom top', scrub: true } });
    });
    document.querySelectorAll('.beach-ph img').forEach(function (img) {
      gsap.fromTo(img, { scale: 1.18 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: img.parentNode, start: 'top bottom', end: 'center center', scrub: true } });
    });
  }

  /* ---------- вопросы ---------- */
  document.querySelectorAll('.qa').forEach(function (qa) {
    var btn = qa.querySelector('.qa-h');
    var b = qa.querySelector('.qa-b');
    btn.addEventListener('click', function () {
      var open = !qa.classList.contains('open');
      qa.classList.toggle('open', open);
      if (open) goal('faq_open', true);
      btn.setAttribute('aria-expanded', String(open));
      gsap.to(b, { height: open ? 'auto' : 0, duration: reduce ? 0 : .55, ease: 'expo.inOut', onComplete: function () { refreshSoon(30); } });
    });
  });

  /* ---------- тест «подходит ли ниша» ---------- */
  (function () {
    var box = document.getElementById('quizBox');
    if (!box) return;
    var res = document.getElementById('quizRes');
    var ans = {};
    var qs = Array.prototype.slice.call(box.querySelectorAll('.qz'));
    var TXT = {
      age: 'До 18 лет РКО открыть нельзя. Но есть продукты, которые оформляются с согласия родителей, — расскажем на созвоне, с чего начать уже сейчас.',
      gov: 'Госслужащим и сотрудникам оборонных предприятий ИП открывать нельзя. Есть другие варианты работы в нише — обсудим на созвоне.',
      time: 'Без пары часов в день результата не будет — это честно. Но начать на себе можно и в выходные. Приходи на созвон, прикинем реальный темп.',
      talk: 'Кнопки «бабло» нет. Здесь платят за общение с людьми. Хорошая новость — это навык, и он качается за первые 10 диалогов.'
    };
    function render() {
      if (Object.keys(ans).length < qs.length) return;
      var miss = Object.keys(ans).filter(function (k) { return !ans[k]; });
      if (!miss.length) {
        res.innerHTML = '<b>Ты подходишь.</b><p>У тебя есть всё, чтобы сделать первые деньги уже в этом месяце. Осталось собрать маршрут.</p><a class="btn btn--gold btn--sm" href="#final" data-jump>Забрать место на созвон</a>';
        Dragon.breathe(1);
      } else {
        res.innerHTML = '<b>Есть нюанс.</b><p>' + TXT[miss[0]] + '</p><a class="btn btn--ghost btn--sm" href="#final" data-jump>Обсудить на созвоне</a>';
      }
      res.classList.add('on');
      goal(miss.length ? 'quiz_nuance' : 'quiz_fit', true);
      refreshSoon(400);
    }
    qs.forEach(function (q) {
      q.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          q.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
          ans[q.dataset.k] = b.dataset.a === '1';
          q.classList.add('done');
          render();
        });
      });
    });
  })();

  /* ---------- чек-лист: запоминаем отметки у читателя ---------- */
  (function () {
    var boxes = Array.prototype.slice.call(document.querySelectorAll('#todo input'));
    var saved = [];
    try { saved = JSON.parse(localStorage.getItem('rz-guide-todo') || '[]'); } catch (e) {}
    boxes.forEach(function (b, i) {
      b.checked = !!saved[i];
      b.addEventListener('change', function () {
        if (b.checked) goal('todo_' + (i + 1), true);
        try { localStorage.setItem('rz-guide-todo', JSON.stringify(boxes.map(function (x) { return x.checked; }))); } catch (e) {}
        if (b.checked && i === boxes.length - 1) scrollToEl(document.getElementById('final'));
      });
    });
  })();

  /* ---------- кейсы: на компьютере листаются колесом ---------- */
  var row = document.getElementById('casesRow');
  if (row) {
    row.addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      var max = row.scrollWidth - row.clientWidth;
      if ((e.deltaY > 0 && row.scrollLeft >= max - 2) || (e.deltaY < 0 && row.scrollLeft <= 2)) return;
      e.preventDefault();
      row.scrollLeft += e.deltaY;
    }, { passive: false });
  }

  /* ---------- счётчики ---------- */
  function countUp(el) {
    var raw = el.textContent;
    var m = raw.match(/\d[\d\s ]*\d|\d/);
    if (!m) return;
    var target = parseInt(m[0].replace(/\D/g, ''), 10);
    if (!target) return;
    var before = raw.slice(0, m.index), after = raw.slice(m.index + m[0].length);
    var o = { v: 0 };
    gsap.to(o, { v: target, duration: 1.6, ease: 'power3.out', onUpdate: function () { el.textContent = before + fmt(o.v) + after; }, onComplete: function () { el.textContent = raw; } });
  }
  if (!reduce) {
    document.querySelectorAll('[data-count]').forEach(function (el) {
      ScrollTrigger.create({ trigger: el, start: 'top 92%', once: true, onEnter: function () { countUp(el); } });
    });
  }

  /* ---------- финал: дракон дышит огнём на кнопку ---------- */
  var offer = document.getElementById('offer');
  var cta = document.getElementById('finalCta');
  function fireAt(el, sec) {
    if (!el || !Dragon.state) return Dragon.breathe(sec, Math.PI / 2);
    var r = el.getBoundingClientRect(), st = Dragon.state();
    Dragon.breathe(sec, Math.atan2(r.top + r.height / 2 - st.hy, r.left + r.width / 2 - st.hx));
  }
  if (offer && cta && !reduce && Worlds) {
    var flame = Worlds.flame(cta, 0);
    var io = new IntersectionObserver(function (en) {
      en.forEach(function (e) {
        if (!e.isIntersecting) return;
        fireAt(cta, 1.8);
        gsap.fromTo(flame, { k: 1.5 }, { k: .55, duration: 2.4, ease: 'power2.out' });
      });
    }, { threshold: .5 });
    io.observe(cta);
  }

  /* ---------- липкая кнопка: появляется во второй главе, прячется у финала ---------- */
  var sticky = document.getElementById('stickyCta');
  var finalEl = document.getElementById('final');
  var ch2 = document.getElementById('ch-2');
  var stickyOn = false;
  function stickyCheck() {
    if (!sticky || !finalEl || !ch2) return;
    var vh = window.innerHeight;
    var after = ch2.getBoundingClientRect().top < -vh * 1.5;
    var nearEnd = finalEl.getBoundingClientRect().top < vh * 1.1;
    var on = after && !nearEnd && !(currentPlan === 'gate');
    if (on !== stickyOn) { stickyOn = on; sticky.classList.toggle('on', on); }
  }

  /* ---------- цели метрики: кнопки и дочитывание ---------- */
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (!a) return;
    if (a.id === 'finalCta') goal('cta_telegram');
    else if (a.id === 'stickyCta') goal('cta_sticky');
    else if (a.getAttribute('href') === '#final') goal('cta_to_final');
  });
  if ('IntersectionObserver' in window) {
    var marks = [['ch-2', 'read_ch2'], ['ch-3', 'read_ch3'], ['anton', 'read_cases'], ['final', 'read_final']];
    var mIO = new IntersectionObserver(function (en) {
      en.forEach(function (e) { if (e.isIntersecting) { goal(e.target.dataset.goal, true); mIO.unobserve(e.target); } });
    }, { threshold: .15 });
    marks.forEach(function (m) { var el = document.getElementById(m[0]); if (el) { el.dataset.goal = m[1]; mIO.observe(el); } });
  }

  /* ---------- прогресс ---------- */
  var progress = document.getElementById('progress');
  var depthM = document.getElementById('depthM');
  var pLast = -1;
  ScrollTrigger.create({
    start: 0, end: 'max',
    onUpdate: function (self) {
      if (progress) progress.style.transform = 'scaleX(' + self.progress.toFixed(3) + ')';
      var pc = Math.round(self.progress * 100);
      if (depthM && pc !== pLast) { pLast = pc; depthM.textContent = pc + '%'; }
      stickyCheck();
    }
  });

  ScrollTrigger.sort();
  trackQueued();
  document.querySelectorAll('img').forEach(function (img) {
    if (!img.complete) img.addEventListener('load', function () { refreshSoon(200); }, { once: true });
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { refreshSoon(100); });
})();
