/* =====================================================================
   RYZHIKOV ACADEMY · сценарий спуска
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- НАСТРОЙКИ ----------
     pay - ссылка на оплату обучения (страница оплаты SkillSpace или банка).
     Её открывает кнопка «Забрать место за 99 900 ₽» в финале.
     Все остальные золотые кнопки ведут к финалу с ценой. */
  var CONFIG = {
    pay: 'https://link.tbank-online.com/8Wc6E4OkwHn'
  };

  var root = document.documentElement;
  var body = document.body;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var Dragon = window.RyzhikovDragon || { setPlan: function () {}, breathe: function () {}, isMobile: function () { return false; } };
  var isMobile = function () { return window.innerWidth < 760; };

  if (reduce) root.classList.add('reduced');
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });

  /* ---------- плавный скролл ---------- */
  var lenis = null;
  if (!reduce && typeof Lenis === 'function') {
    lenis = new Lenis({
      duration: 1.35,
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
    if (lenis) lenis.scrollTo(el, { duration: 2.4, easing: function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; } });
    else el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  }

  /* ---------- кнопки ---------- */
  document.querySelectorAll('[data-cta]').forEach(function (a) {
    if (CONFIG.pay) {
      a.href = CONFIG.pay;
      a.target = '_blank';
      a.rel = 'noopener';
    } else {
      a.setAttribute('data-jump', '');
    }
  });
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-jump]');
    if (!a) return;
    var id = a.getAttribute('href');
    if (!id || id.charAt(0) !== '#') return;
    e.preventDefault();
    if (id === '#top') { if (lenis) lenis.scrollTo(0, { duration: 2.4 }); else window.scrollTo(0, 0); return; }
    scrollToEl(document.querySelector(id));
  });

  /* ---------- залы: имя, цвет света, план полёта дракона ---------- */
  var rooms = {};
  document.querySelectorAll('[data-room][data-name]').forEach(function (s) {
    rooms[s.dataset.room] = { name: s.dataset.name, tone: s.dataset.tone, tone2: s.dataset.tone2 };
  });
  var hudRoom = document.querySelector('#hudRoom span');
  var depthLinks = Array.prototype.slice.call(document.querySelectorAll('#depthList a'));
  var currentRoom = -1;

  function setRoom(n) {
    n = parseInt(n, 10);
    if (n === currentRoom) return;
    currentRoom = n;
    var r = rooms[n];
    if (!r) return;
    if (hudRoom) {
      gsap.to(hudRoom.parentNode, { opacity: 0, duration: .2, onComplete: function () {
        hudRoom.textContent = n === 0 ? 'Врата' : 'Зал ' + r.name;
        gsap.to(hudRoom.parentNode, { opacity: 1, duration: .4 });
      } });
    }
    depthLinks.forEach(function (a) {
      var f = parseInt(a.dataset.for, 10);
      a.classList.toggle('on', f === n);
      a.classList.toggle('past', f < n);
    });
    gsap.to(root, { '--tone': r.tone, '--tone2': r.tone2, duration: 1.8, ease: 'power2.out' });
  }

  var PLANS = {
    hero:  function () { return { tx: isMobile() ? .7 : .74, ty: isMobile() ? .62 : .5, scale: 1.15, alpha: 1, wander: 1 , k: 1.7 }; },
    right: function () { return { tx: isMobile() ? .84 : .905, ty: .46, scale: isMobile() ? .8 : 1, alpha: isMobile() ? .45 : .8, wander: .6 , k: 1.7 }; },
    left:  function () { return { tx: isMobile() ? .16 : .095, ty: .46, scale: isMobile() ? .8 : 1, alpha: isMobile() ? .45 : .8, wander: .6 , k: 1.7 }; },
    gate:  function () { return { tx: .5, ty: .3, scale: 1.25, alpha: 1, wander: .3, k: 5 }; },
    final: function () { return { tx: .5, ty: isMobile() ? .2 : .2, scale: 1.25, alpha: 1, wander: .3 , k: 1.7 }; }
  };
  function plan(name) { Dragon.setPlan(PLANS[name]()); }
  plan('hero');

  /* какой зал сейчас в кадре - считаем по геометрии, без зависимости
     от порядка триггеров и пинов */
  var zones = Array.prototype.slice.call(document.querySelectorAll('[data-room]'));
  var currentPlan = '';
  function trackZones() {
    var vh = window.innerHeight, line = vh * .55, active = null, gatePhase = false;
    for (var i = 0; i < zones.length; i++) {
      var el = zones[i];
      var box = el.classList.contains('gate') && el.parentNode.classList.contains('pin-spacer') ? el.parentNode : el;
      var top = box.getBoundingClientRect().top;
      if (top <= line) {
        active = el;
        gatePhase = el.classList.contains('gate') && top > -vh * 1.35;
      }
    }
    if (!active) active = zones[0];
    setRoom(active.dataset.room);
    var want = gatePhase ? 'gate' : (active.dataset.dragon || currentPlan || 'hero');
    if (want !== currentPlan) {
      var fromGate = currentPlan === 'gate';
      currentPlan = want;
      plan(want);
      // нырнул во врата - в новом зале влетает сверху
      if (fromGate && want !== 'gate' && Dragon.state && Dragon.state().alpha < .2 && Dragon.reenter) Dragon.reenter();
    }
  }
  var zq = false;
  function trackQueued() { if (zq) return; zq = true; requestAnimationFrame(function () { zq = false; trackZones(); }); }
  window.addEventListener('scroll', trackQueued, { passive: true });
  window.addEventListener('resize', trackQueued, { passive: true });
  ScrollTrigger.addEventListener('refresh', trackQueued);

  /* ---------- загрузка и вход в hero ---------- */
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
    var tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    tl.to('.hero h1 .ln > span', { yPercent: 0, duration: 1.5, stagger: .11 }, .1)
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
      setTimeout(sweepReveals, 300);
    }, reduce ? 50 : 420);
  }
  var pageLoad = new Promise(function (r) { if (document.readyState === 'complete') r(); else window.addEventListener('load', r); });
  var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([Promise.all([pageLoad, fontsReady]), new Promise(function (r) { setTimeout(r, 3200); })]).then(finishLoad);

  /* ---------- hero уходит при скролле ---------- */
  if (!reduce) {
    gsap.to('.hero .wrap', {
      yPercent: -14, opacity: 0, ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true }
    });
    gsap.to('.scroll-cue', {
      opacity: 0, ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: '20% top', scrub: true }
    });
  }

  /* ---------- врата: кинокадр, створки, пролёт ---------- */
  var lbMax = function () { return window.innerHeight * (isMobile() ? .06 : .09); };
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
        trigger: gate,
        start: 'top top',
        end: '+=235%',
        pin: true,
        scrub: 1,
        anticipatePin: 1,
        onToggle: function (self) {
          if (!self.isActive) root.style.setProperty('--lb', '0px');
        },
        onUpdate: function (self) {
          var p = Math.min(1, self.progress / .574);
          // дракон: зависает над вратами, затем ныряет в проём и растворяется в свете
          if (currentPlan === 'gate' && p < 1) {
            var dive = Math.max(0, Math.min(1, (p - .38) / .42));
            var e = dive * dive * (3 - 2 * dive);
            Dragon.setPlan({
              tx: .5, ty: .3 + e * .36, wander: .3 * (1 - e), k: 6,
              scale: (isMobile() ? 1 : 1.25) * (1 - e * .68),
              alpha: 1 - Math.max(0, (dive - .55) / .45)
            });
          }
          root.style.setProperty('--lb', (Math.sin(p * Math.PI) * lbMax()).toFixed(1) + 'px');
        }
      }
    });

    tl.fromTo(frame, { scale: .84, y: 50 }, { scale: 1, y: 0, duration: .32, ease: 'power1.out' }, 0)
      .fromTo(copy, { autoAlpha: 0, y: 60, filter: 'blur(12px)' }, { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: .24, ease: 'power2.out' }, 0)
      .fromTo(num, { scale: .7, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: .34, ease: 'power2.out' }, 0)
      .fromTo(title, { letterSpacing: '.12em' }, { letterSpacing: '-.01em', duration: .3, ease: 'power2.out' }, 0)
      .to(copy, { autoAlpha: 0, y: -50, filter: 'blur(10px)', duration: .16, ease: 'power1.in' }, .42)
      .to(num, { autoAlpha: 0, scale: 1.3, duration: .2 }, .42)
      .to(doorL, { rotateY: -112, duration: .34, ease: 'power2.inOut' }, .44)
      .to(doorR, { rotateY: 112, duration: .34, ease: 'power2.inOut' }, .44)
      .to(light, { autoAlpha: 1, scale: 1.5, duration: .38, ease: 'power1.out' }, .44)
      .to(frame, { scale: 3.4, duration: .46, ease: 'power2.in' }, .56)
      .to(frame, { opacity: .3, duration: .14 }, .88)
      // зал выезжает поверх света из открытых врат, затем свет гаснет
      .to(frame, { opacity: 0, duration: .5, ease: 'none' }, 1.1)
      .to({}, { duration: .18 }, 1.6);
  });

  /* ---------- появление блоков ----------
     Считаем по геометрии на каждом кадре скролла: так блоки проявляются
     и при плавном скролле, и после прыжка по якорю. */
  var pendingRv = reduce ? [] : Array.prototype.slice.call(document.querySelectorAll('.rv'));
  if (!reduce) gsap.set(pendingRv, { opacity: 0, y: 34, filter: 'blur(6px)' });
  function sweepReveals() {
    if (!pendingRv.length) return;
    var vh = window.innerHeight, now = [];
    for (var i = pendingRv.length - 1; i >= 0; i--) {
      var r = pendingRv[i].getBoundingClientRect();
      if (r.top < vh * .92 && (r.bottom > 0 || r.height === 0)) { now.unshift(pendingRv[i]); pendingRv.splice(i, 1); }
      else if (r.bottom <= 0) { gsap.set(pendingRv[i], { opacity: 1, y: 0, filter: 'none' }); pendingRv.splice(i, 1); }
    }
    if (now.length) gsap.to(now, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.15, ease: 'expo.out', stagger: .08, overwrite: true });
  }
  window.addEventListener('scroll', function () { requestAnimationFrame(sweepReveals); }, { passive: true });

  /* ---------- зал пути ---------- */
  var path = document.getElementById('path');
  if (path) {
    if (!reduce) {
      gsap.to('.path-spine i', { scaleY: 1, ease: 'none', scrollTrigger: { trigger: path, start: 'top 62%', end: 'bottom 62%', scrub: .6 } });
    } else {
      gsap.set('.path-spine i', { scaleY: 1 });
    }
    path.querySelectorAll('.step').forEach(function (step, i) {
      var card = step.querySelector('.step-card');
      if (reduce) { step.classList.add('lit'); return; }
      ScrollTrigger.create({ trigger: step, start: 'top 62%', onEnter: function () { step.classList.add('lit'); }, onLeaveBack: function () { step.classList.remove('lit'); } });
      var dir = isMobile() ? 40 : (i % 2 ? 70 : -70);
      gsap.fromTo(card, { opacity: 0, x: dir, filter: 'blur(8px)' }, {
        opacity: 1, x: 0, filter: 'blur(0px)', duration: 1.2, ease: 'expo.out',
        scrollTrigger: { trigger: step, start: 'top 85%', toggleActions: 'play none none none' }
      });
    });
  }

  /* ---------- свитки (аккордеон) ---------- */
  var refreshT = null;
  function refreshSoon(delay) {
    clearTimeout(refreshT);
    refreshT = setTimeout(function () { ScrollTrigger.refresh(); }, delay || 80);
  }
  document.querySelectorAll('.scroll').forEach(function (sc, i) {
    var btn = sc.querySelector('.scroll-h');
    var b = sc.querySelector('.scroll-b');
    if (i === 2) { sc.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); b.style.height = 'auto'; }
    btn.addEventListener('click', function () {
      var open = !sc.classList.contains('open');
      sc.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
      gsap.to(b, {
        height: open ? 'auto' : 0, duration: reduce ? 0 : .7, ease: 'expo.inOut',
        onComplete: function () { refreshSoon(30); }
      });
      if (open && !reduce) gsap.fromTo(b.querySelectorAll('.mline, .mres'), { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: .6, stagger: .05, delay: .2, ease: 'power2.out' });
    });
  });

  /* ---------- отзывы: «читать полностью» ---------- */
  document.querySelectorAll('.quote').forEach(function (q) {
    var more = q.querySelector('.quote-more');
    var btn = q.querySelector('.quote-btn');
    btn.addEventListener('click', function () {
      var open = !q.classList.contains('open');
      q.classList.toggle('open', open);
      more.style.maxHeight = open ? more.scrollHeight + 'px' : '';
      btn.firstChild.textContent = open ? 'Свернуть ' : 'Читать полностью ';
      btn.querySelector('span').textContent = open ? '↑' : '↓';
      refreshSoon(850);
    });
  });

  /* ---------- параллакс фото ---------- */
  if (!reduce) {
    document.querySelectorAll('.phone').forEach(function (ph) {
      var d = parseFloat(ph.dataset.tilt || 1);
      gsap.fromTo(ph, { y: 40 * d, rotate: -2 * d }, { y: -40 * d, rotate: 2 * d, ease: 'none', scrollTrigger: { trigger: ph, start: 'top bottom', end: 'bottom top', scrub: true } });
    });
    document.querySelectorAll('.portrait img').forEach(function (img) {
      gsap.fromTo(img, { yPercent: -6 }, { yPercent: 6, ease: 'none', scrollTrigger: { trigger: img.parentNode, start: 'top bottom', end: 'bottom top', scrub: true } });
    });
  }

  /* ---------- горизонтальная галерея кейсов ---------- */
  var track = document.getElementById('galleryTrack');
  if (track && !reduce) {
    ScrollTrigger.matchMedia({
      '(min-width: 900px)': function () {
        var dist = function () { return Math.max(0, track.scrollWidth - window.innerWidth); };
        var tw = gsap.to(track, {
          x: function () { return -dist(); },
          ease: 'none',
          scrollTrigger: {
            trigger: '#gallery',
            start: 'center center',
            end: function () { return '+=' + dist(); },
            pin: true,
            scrub: 1,
            invalidateOnRefresh: true
          }
        });
        var cards = track.querySelectorAll('.case, .case-end');
        cards.forEach(function (c) {
          gsap.fromTo(c, { rotateY: -14, opacity: .35, scale: .94 }, {
            rotateY: 0, opacity: 1, scale: 1, ease: 'none',
            scrollTrigger: { trigger: c, containerAnimation: tw, start: 'left 100%', end: 'left 55%', scrub: true }
          });
        });
      }
    });
  }

  /* ---------- бегущие отзывы ---------- */
  var mq = document.getElementById('marquee');
  if (mq) {
    Array.prototype.slice.call(mq.children).forEach(function (n) {
      var c = n.cloneNode(true);
      c.setAttribute('aria-hidden', 'true');
      mq.appendChild(c);
    });
  }

  /* ---------- калькулятор мечты ---------- */
  (function () {
    var range = document.getElementById('trRange');
    if (!range) return;
    var sumEl = document.getElementById('trSum');
    var leadsEl = document.getElementById('trLeads');
    var wordEl = document.getElementById('trWord');
    var goals = Array.prototype.slice.call(document.querySelectorAll('.goal'));
    var PER = 130000;
    var shown = { v: 5 * PER };
    var fmt = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };
    var plural = function (n) {
      var a = n % 10, b = n % 100;
      if (a === 1 && b !== 11) return 'лид';
      if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'лида';
      return 'лидов';
    };
    var lastReached = 0;
    function render(animate) {
      var leads = parseInt(range.value, 10);
      var total = leads * PER;
      leadsEl.textContent = leads;
      wordEl.textContent = plural(leads);
      range.style.setProperty('--fill', ((leads - range.min) / (range.max - range.min) * 100).toFixed(1) + '%');
      gsap.to(shown, {
        v: total, duration: animate ? .6 : 0, ease: 'power3.out',
        onUpdate: function () { sumEl.textContent = fmt(shown.v) + ' ₽'; }
      });
      var reached = 0;
      goals.forEach(function (g) {
        var ok = total >= parseInt(g.dataset.price, 10);
        g.classList.toggle('reached', ok);
        if (ok) reached++;
      });
      if (animate && reached > lastReached && reached === goals.length) Dragon.breathe(1.1);
      lastReached = reached;
    }
    range.addEventListener('input', function () { render(true); });
    goals.forEach(function (g) {
      g.addEventListener('click', function () {
        range.value = Math.min(parseInt(range.max, 10), Math.ceil(parseInt(g.dataset.price, 10) / PER));
        render(true);
        Dragon.breathe(.7);
      });
    });
    render(false);
  })();

  /* ---------- счётчики ---------- */
  function countUp(el) {
    var raw = el.textContent;
    var m = raw.match(/\d[\d   ]*\d|\d/);
    if (!m) return;
    var target = parseInt(m[0].replace(/\D/g, ''), 10);
    if (!target) return;
    var grouped = /[   ]/.test(m[0]);
    var before = raw.slice(0, m.index), after = raw.slice(m.index + m[0].length);
    var o = { v: 0 };
    gsap.to(o, {
      v: target, duration: 1.6, ease: 'power3.out',
      onUpdate: function () {
        var s = String(Math.round(o.v));
        if (grouped) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        el.textContent = before + s + after;
      }
    });
  }
  if (!reduce) {
    document.querySelectorAll('[data-count]').forEach(function (el) {
      ScrollTrigger.create({ trigger: el, start: 'top 92%', once: true, onEnter: function () { countUp(el); } });
    });
  }

  /* ---------- финал: цена сгорает до 99 900 и дракон дышит в неё ---------- */
  var deal = document.getElementById('deal');
  var dealPrice = document.getElementById('dealPrice');
  function fireAtPrice(sec) {
    if (!dealPrice || !Dragon.state) return Dragon.breathe(sec, Math.PI / 2);
    var r = dealPrice.getBoundingClientRect(), st = Dragon.state();
    Dragon.breathe(sec, Math.atan2(r.top + r.height / 2 - st.hy, r.left + r.width / 2 - st.hx));
  }
  if (deal && dealPrice) {
    var priceDone = false;
    ScrollTrigger.create({
      trigger: deal, start: 'top 70%',
      onEnter: function () {
        if (priceDone || reduce) return;
        priceDone = true;
        var o = { v: 120000 };
        fireAtPrice(1.8);
        gsap.to(o, {
          v: 99900, duration: 1.8, delay: .35, ease: 'power3.inOut',
          onUpdate: function () { dealPrice.textContent = String(Math.round(o.v / 100) * 100).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0') + '\u00A0\u20BD'; },
          onComplete: function () { dealPrice.textContent = '99\u00A0900\u00A0\u20BD'; }
        });
      },
      onEnterBack: function () { fireAtPrice(1.2); }
    });
  }

  /* ---------- прогресс и глубина ---------- */
  var progress = document.getElementById('progress');
  var depthM = document.getElementById('depthM');
  ScrollTrigger.create({
    start: 0, end: 'max',
    onUpdate: function (self) {
      if (progress) progress.style.transform = 'scaleX(' + self.progress.toFixed(4) + ')';
      if (depthM) depthM.textContent = Math.round(self.progress * 1240) + ' м';
    }
  });

  /* ---------- мобильная кнопка ---------- */
  var dock = document.getElementById('dock');
  if (dock) {
    ScrollTrigger.create({
      trigger: '.hero', start: 'bottom 30%', endTrigger: '#final', end: 'top 80%',
      onToggle: function (self) { dock.classList.toggle('on', self.isActive); }
    });
  }

  ScrollTrigger.sort();
  trackQueued();

  /* ---------- пересчёт после загрузки картинок и шрифтов ---------- */
  document.querySelectorAll('img').forEach(function (img) {
    if (!img.complete) img.addEventListener('load', function () { refreshSoon(200); }, { once: true });
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { refreshSoon(100); });
})();
