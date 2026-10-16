/* =====================================================================
   RYZHIKOV DRAGON
   Процедурный восточный дракон на canvas.
   Тело - цепочка сегментов в координатах документа: голова держится
   в кадре, а при скролле вниз тело тянется шлейфом вверх, будто дракон
   ныряет в глубину. Сверху - пыль, искры и огненное дыхание.
   ===================================================================== */
(function () {
  'use strict';

  var canvas = document.getElementById('dragon');
  if (!canvas) return;
  var mainCtx = canvas.getContext('2d');
  var buf = document.createElement('canvas');
  var bufCtx = buf.getContext('2d');
  var ctx = mainCtx;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var N = 72;                 // сегментов в теле
  var Perf = window.RyzhikovPerf;
  var tier = Perf ? Perf.tier() : 3;
  var RES = [.7, .8, .92, 1];  // доля разрешения холста по ступеням качества
  var PI = Math.PI;

  var vw = 0, vh = 0, dpr = 1, mobile = false;
  var W0 = 30;                // базовая толщина тела
  var L = 28;                 // длина сегмента

  var pts = [];               // тело, координаты документа
  var head = { x: 0, y: 0, vx: 0, vy: 0 };
  var heading = PI / 2;
  var t = 0;

  // план полёта: куда тянется голова (доли экрана), масштаб, прозрачность
  var plan = { tx: 0.72, ty: 0.5, scale: 1, alpha: 1, wander: 1, k: 1.7 };
  var cur = { tx: 0.72, ty: 0.5, scale: 1, alpha: 0 };

  var lastScroll = window.scrollY || 0;
  var scrollVel = 0;

  var whiskers = [[], []];
  var WN = 11;

  /* ---------- окрас: текущий и целевой, плавно перетекают ---------- */
  var KEYS = ['b1', 'b2', 'b3', 'edge', 'belly', 'scale', 'glow', 'spine', 'eye'];
  function hx(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  var DEF = { b1: '#1a2f78', b2: '#10205a', b3: '#070d24', edge: '#d4a64a', belly: '#f3d58a', scale: '#7b9bff', glow: '#4673ff', spine: '#d4a64a', eye: '#ffd77a' };
  var pal = {}, palT = {};
  KEYS.forEach(function (k) { pal[k] = hx(DEF[k]); palT[k] = pal[k].slice(); });
  var palRate = 1.4;
  function C(k, a) {
    var c = pal[k];
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a === undefined ? 1 : a) + ')';
  }

  var embers = [];
  var fire = [];
  var breathT = 0;
  var breathAim = null;       // куда развернуть пасть во время дыхания
  var jaw = 0;

  /* ---------------------------------------------------- размеры */
  function mobileGuess() { return window.innerWidth < 1100 || ('ontouchstart' in window); }
  function resize() {
    vw = window.innerWidth;
    vh = window.innerHeight;
    // телефон: экран маленький, поэтому можем позволить чёткость почти Retina
    dpr = Math.min(2, window.devicePixelRatio || 1) * RES[tier];
    // потолок по пикселям: Retina-мониторы и iPad Pro не должны гонять холст на 8 млн точек
    var cap = (('ontouchstart' in window) ? 1.7e6 : 3.0e6) * (tier >= 3 ? 1 : 0.8);
    dpr = Math.min(dpr, Math.sqrt(cap / (vw * vh)));
    mobile = vw < 760;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    buf.width = canvas.width;
    buf.height = canvas.height;
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
    W0 = Math.max(15, Math.min(34, Math.min(vw, vh) * (mobile ? 0.047 : 0.034)));
    L = W0 * 0.95;
  }

  function init() {
    resize();
    var sy = window.scrollY || 0;
    head.x = vw * plan.tx;
    head.y = sy - vh * 0.35;          // стартует над экраном и влетает сверху
    pts = [];
    for (var i = 0; i < N; i++) {
      pts.push({ x: head.x + Math.sin(i * 0.35) * W0 * 2, y: head.y - i * L });
    }
    for (var w = 0; w < 2; w++) {
      whiskers[w] = [];
      for (var j = 0; j < WN; j++) whiskers[w].push({ x: head.x, y: head.y - sy });
    }
    embers = [];
    var count = 0;
    for (var e = 0; e < count; e++) embers.push(newEmber(true));
  }

  function newEmber(anywhere) {
    return {
      x: Math.random() * vw,
      y: anywhere ? Math.random() * vh : vh + 10,
      r: 0.5 + Math.random() * 1.7,
      vy: -(10 + Math.random() * 38),
      ph: Math.random() * 10,
      a: 0.25 + Math.random() * 0.6,
      gold: Math.random() < 0.72
    };
  }

  /* --------------------------------------------- профиль толщины */
  function widthAt(i) {
    var u = i / (N - 1);
    var neck = Math.min(1, 0.62 + u * 6);                 // шея тоньше
    var tail = Math.pow(1 - u, 1.15);                     // хвост сходит на нет
    return W0 * cur.scale * neck * (0.18 + 0.82 * tail) * (mobile ? 0.95 : 1);
  }

  /* ------------------------------------------------------ физика */
  function update(dt) {
    t += dt;
    var sy = window.scrollY || 0;
    var dS = sy - lastScroll;
    lastScroll = sy;
    scrollVel += ((dS / Math.max(dt, 0.001)) - scrollVel) * Math.min(1, dt * 6);

    var rate = plan.k || 1.7;
    var k = Math.min(1, dt * rate);
    cur.tx += (plan.tx - cur.tx) * k;
    cur.ty += (plan.ty - cur.ty) * k;
    cur.scale += (plan.scale - cur.scale) * Math.min(1, dt * rate * 1.3);
    cur.alpha += (plan.alpha - cur.alpha) * Math.min(1, dt * rate * 1.1);

    var pk = Math.min(1, dt * palRate);
    for (var pi = 0; pi < KEYS.length; pi++) {
      var a0 = pal[KEYS[pi]], a1 = palT[KEYS[pi]];
      a0[0] += (a1[0] - a0[0]) * pk; a0[1] += (a1[1] - a0[1]) * pk; a0[2] += (a1[2] - a0[2]) * pk;
    }

    var calm = 1 - Math.min(1, Math.abs(scrollVel) / 1800);
    var wa = reduce ? 0 : plan.wander * (0.35 + 0.65 * calm);

    var Tx = vw * cur.tx + (Math.sin(t * 0.61) * 0.075 + Math.sin(t * 1.43 + 2) * 0.03) * vw * wa;
    var Ty = sy + vh * cur.ty + (Math.sin(t * 0.83 + 1) * 0.085 + Math.cos(t * 0.37) * 0.05) * vh * wa;

    // голова держится за камерой: почти весь скролл переносим сразу,
    // тело остаётся в координатах документа и тянется шлейфом
    head.y += dS * 0.88;

    // большой прыжок (якорь, перезагрузка) - переносим дракона целиком
    var jx = Tx - head.x, jy = Ty - head.y;
    if (Math.abs(jy) > vh * 2.6) {
      var shift = jy - Math.sign(jy) * vh * 0.5;
      head.y += shift;
      for (var s = 0; s < N; s++) pts[s].y += shift;
      jy = Ty - head.y;
    }

    // пружина: плавные дуги вместо рывков
    var stiff = 7.5, damp = 4.6;
    head.vx += (jx * stiff - head.vx * damp) * dt;
    head.vy += (jy * stiff - head.vy * damp) * dt;
    var sp = Math.hypot(head.vx, head.vy);
    var maxSp = vh * 3.2;
    if (sp > maxSp) { head.vx *= maxSp / sp; head.vy *= maxSp / sp; sp = maxSp; }
    head.x += head.vx * dt;
    head.y += head.vy * dt;

    if (breathT > 0 && breathAim !== null) {
      var da = breathAim - heading;
      while (da > PI) da -= PI * 2;
      while (da < -PI) da += PI * 2;
      heading += da * Math.min(1, dt * 5);
    } else if (sp > 6) {
      var target = Math.atan2(head.vy, head.vx);
      var d = target - heading;
      while (d > PI) d -= PI * 2;
      while (d < -PI) d += PI * 2;
      heading += d * Math.min(1, dt * 7);
    }

    // цепочка тела
    pts[0].x = head.x;
    pts[0].y = head.y;
    var seg = L * cur.scale;
    for (var i = 1; i < N; i++) {
      var p = pts[i], q = pts[i - 1];
      var dx = p.x - q.x, dy = p.y - q.y;
      var dd = Math.hypot(dx, dy) || 0.0001;
      p.x = q.x + dx / dd * seg;
      p.y = q.y + dy / dd * seg;
    }

    // искры
    for (var e = 0; e < embers.length; e++) {
      var m = embers[e];
      m.y += m.vy * dt - dS * 0.22;
      m.x += Math.sin(t * 0.9 + m.ph) * 9 * dt;
      if (m.y < -12) { embers[e] = newEmber(false); }
      else if (m.y > vh + 14) { m.y = -10; }
    }

    // дыхание
    jaw += ((breathT > 0 ? 1 : 0) - jaw) * Math.min(1, dt * 8);
    if (breathT > 0) {
      breathT -= dt;
      var n = Math.round((mobile ? 90 : 160) * dt);
      for (var f = 0; f < n; f++) emitFire(sy);
    }
    for (var g = fire.length - 1; g >= 0; g--) {
      var fp = fire[g];
      fp.life -= dt;
      if (fp.life <= 0) { fire.splice(g, 1); continue; }
      fp.x += fp.vx * dt;
      fp.y += fp.vy * dt;
      fp.vx *= 1 - dt * 1.6;
      fp.vy *= 1 - dt * 1.6;
      fp.vy -= 40 * dt;
      fp.r += dt * fp.grow;
    }
  }

  function mouthPoint(sy) {
    var h = W0 * cur.scale;
    var c = Math.cos(heading), s = Math.sin(heading);
    var lx = 2.55 * h, ly = -0.18 * h;
    return { x: head.x + lx * c - ly * s, y: head.y - sy + lx * s + ly * c };
  }

  function emitFire(sy) {
    var mp = mouthPoint(sy);
    var a = heading + (Math.random() - 0.5) * 0.42;
    var v = (mobile ? 420 : 620) * (0.55 + Math.random() * 0.6);
    fire.push({
      x: mp.x, y: mp.y,
      vx: Math.cos(a) * v + head.vx * 0.3,
      vy: Math.sin(a) * v + head.vy * 0.3,
      r: W0 * 0.18 + Math.random() * W0 * 0.2,
      grow: W0 * (1.2 + Math.random() * 1.4),
      life: 0.55 + Math.random() * 0.55,
      max: 1.1
    });
  }

  /* ------------------------------------------------------ рисунок */
  var S = [];   // экранные точки с нормалями
  for (var z = 0; z < N; z++) S.push({ x: 0, y: 0, tx: 0, ty: 0, nx: 0, ny: 0, w: 0 });

  function computeScreen(sy) {
    var amp = reduce ? 0 : W0 * cur.scale * 0.55;
    for (var i = 0; i < N; i++) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)];
      var tx = a.x - b.x, ty = a.y - b.y;
      var tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      var o = S[i];
      o.tx = tx; o.ty = ty;
      o.nx = -ty; o.ny = tx;
      var wave = Math.sin(i * 0.3 - t * 3.1) * amp * Math.min(1, i / 10);
      o.x = pts[i].x + o.nx * wave;
      o.y = pts[i].y - sy + o.ny * wave;
      o.w = widthAt(i);
    }
  }

  function bodyPath() {
    ctx.beginPath();
    var i, o, x, y, px, py;
    o = S[0];
    ctx.moveTo(o.x + o.nx * o.w, o.y + o.ny * o.w);
    for (i = 1; i < N; i++) {
      o = S[i];
      var p = S[i - 1];
      x = o.x + o.nx * o.w; y = o.y + o.ny * o.w;
      px = p.x + p.nx * p.w; py = p.y + p.ny * p.w;
      ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
    }
    o = S[N - 1];
    ctx.lineTo(o.x, o.y);
    for (i = N - 2; i >= 0; i--) {
      o = S[i];
      var q = S[i + 1];
      x = o.x - o.nx * o.w; y = o.y - o.ny * o.w;
      px = q.x - q.nx * q.w; py = q.y - q.ny * q.w;
      ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
    }
    o = S[0];
    ctx.lineTo(o.x - o.nx * o.w, o.y - o.ny * o.w);
    ctx.closePath();
  }

  /* =====================================================================
     ВНЕШНОСТЬ v2
     Тело - тёмная основа, поверх чешуя внахлёст из готового спрайта,
     светотень, перепонка-плавник по спине, грива, хвостовой веер.
     roll: какой стороной дракон повёрнут к зрителю (+1 / -1). Когда он
     разворачивается, спина плавно перекатывается через бок.
     ===================================================================== */
  var roll = 1, rollT = 1;
  var blinkT = 2.5, blink = 0;
  var pulse = 0;
  var motes = [];

  /* чешуйка: перерисовывается, только когда сменился окрас */
  var scaleSpr = document.createElement('canvas');
  scaleSpr.width = scaleSpr.height = 64;
  var sprKey = '';
  function palKey() {
    var k = '';
    for (var i = 0; i < KEYS.length; i++) { var c = pal[KEYS[i]]; k += (c[0] >> 3) + '.' + (c[1] >> 3) + '.' + (c[2] >> 3) + '|'; }
    return k;
  }
  function buildScale() {
    var key = palKey();
    if (key === sprKey) return;
    sprKey = key;
    var g = scaleSpr.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, 64, 64);
    g.translate(32, 32);
    // форма: закруглённый край смотрит к голове (+x), открытый - к хвосту
    g.beginPath();
    g.moveTo(-28, -24);
    g.quadraticCurveTo(24, -30, 29, 0);
    g.quadraticCurveTo(24, 30, -28, 24);
    g.quadraticCurveTo(-12, 0, -28, -24);
    g.closePath();
    var gr = g.createRadialGradient(16, -8, 2, 6, 0, 36);
    gr.addColorStop(0, C('scale', 0.9));
    gr.addColorStop(0.5, C('b1', 1));
    gr.addColorStop(1, C('b2', 1));
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,.45)';
    g.stroke();
    g.lineWidth = 1.6;
    g.strokeStyle = C('edge', 0.55);
    g.stroke();
    // блик по краю чешуйки
    g.beginPath();
    g.moveTo(-4, -19);
    g.quadraticCurveTo(20, -20, 25, -3);
    g.lineWidth = 2.2;
    g.strokeStyle = 'rgba(255,248,230,.42)';
    g.stroke();
  }

  /* мягкое пятно света для свечения, искр и дыма */
  var dotSpr = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.3, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return c;
  })();
  var glowSpr = document.createElement('canvas');
  glowSpr.width = glowSpr.height = 64;
  var glowKey = '';
  function buildGlow() {
    var c = pal.glow, key = (c[0] >> 3) + '.' + (c[1] >> 3) + '.' + (c[2] >> 3);
    if (key === glowKey) return;
    glowKey = key;
    var g = glowSpr.getContext('2d');
    g.clearRect(0, 0, 64, 64);
    var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, C('glow', .9)); gr.addColorStop(.35, C('glow', .35)); gr.addColorStop(1, C('glow', 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  }

  function updateLife(dt) {
    // разворот через бок
    var ny = S[3].ny;
    if (ny > 0.22) rollT = -1; else if (ny < -0.22) rollT = 1;
    roll += (rollT - roll) * Math.min(1, dt * 3.2);
    // моргание
    blinkT -= dt;
    if (blinkT <= 0) { blink = 1; blinkT = 3 + Math.random() * 4; }
    blink = Math.max(0, blink - dt * 7);
    // волна света бежит от головы к хвосту
    pulse = (pulse + dt * 0.55) % 1.6;
    // золотые искры с чешуи
    if (!reduce && cur.alpha > 0.4 && Math.random() < dt * (tier >= 2 ? 14 : 6)) {
      var i = 4 + Math.floor(Math.random() * (N - 14)), o = S[i];
      motes.push({ x: o.x + o.nx * o.w * roll * 0.8, y: o.y + o.ny * o.w * roll * 0.8, vx: (Math.random() - .5) * 14, vy: -12 - Math.random() * 22, life: 1.2 + Math.random() * 1.2, max: 2.4, r: 1 + Math.random() * 1.8 });
    }
    for (var m = motes.length - 1; m >= 0; m--) {
      var p = motes[m];
      p.life -= dt;
      if (p.life <= 0) { motes.splice(m, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt;
    }
  }

  // линия вдоль тела со смещением k (плюс - спина, минус - брюхо)
  function sideLine(k, from, to) {
    ctx.beginPath();
    for (var b = from || 1; b < (to || N - 4); b++) {
      var q = S[b];
      var x = q.x + q.nx * q.w * k * roll, y = q.y + q.ny * q.w * k * roll;
      if (b === (from || 1)) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  }

  /* лапа: бедро, голень, кисть и золотые когти */
  function drawLeg(i, side, phase, back) {
    var o = S[i], w = o.w;
    var s = -side * roll;                     // наружу от тела, в сторону брюха
    var sw = Math.sin(t * 3.6 + phase);
    var bx = o.x + o.nx * w * 0.35 * s, by = o.y + o.ny * w * 0.35 * s;
    var ox = o.nx * s, oy = o.ny * s, tx = -o.tx, ty = -o.ty;
    var kx = bx + (ox * 1.05 + tx * (0.55 + sw * 0.35)) * w * 1.25;
    var ky = by + (oy * 1.05 + ty * (0.55 + sw * 0.35)) * w * 1.25;
    var fx = kx + (ox * 0.35 - tx * (0.75 - sw * 0.3)) * w * 1.1;
    var fy = ky + (oy * 0.35 - ty * (0.75 - sw * 0.3)) * w * 1.1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(kx, ky, fx, fy);
    ctx.strokeStyle = back ? C('b3') : C('edge', .9);
    ctx.lineWidth = w * 0.78;
    ctx.stroke();
    ctx.strokeStyle = back ? C('b3') : C('b2');
    ctx.lineWidth = w * 0.62;
    ctx.stroke();
    if (!back) {
      ctx.strokeStyle = C('scale', .35);
      ctx.lineWidth = w * 0.16;
      ctx.beginPath();
      ctx.moveTo(bx + ox * w * .12, by + oy * w * .12);
      ctx.quadraticCurveTo(kx, ky, fx, fy);
      ctx.stroke();
    }
    // когти
    var ca0 = Math.atan2(fy - ky, fx - kx);
    ctx.fillStyle = back ? C('edge', .5) : C('belly');
    for (var c = -1; c <= 1; c++) {
      var a = ca0 + c * 0.55, len = w * (c === 0 ? 0.75 : 0.6);
      var ex = fx + Math.cos(a) * len, ey = fy + Math.sin(a) * len;
      var cx2 = fx + Math.cos(a + 0.9 * s) * len * 0.6, cy2 = fy + Math.sin(a + 0.9 * s) * len * 0.6;
      var px = -Math.sin(a) * w * 0.08, py = Math.cos(a) * w * 0.08;
      ctx.beginPath();
      ctx.moveTo(fx + px, fy + py);
      ctx.quadraticCurveTo(cx2, cy2, ex, ey);
      ctx.quadraticCurveTo(cx2 - px, cy2 - py, fx - px, fy - py);
      ctx.fill();
    }
  }

  /* перепонка вдоль спины: волна, лучи и золотая кромка */
  function drawFin() {
    var from = 3, to = N - 9;
    var base = [], tip = [];
    for (var i = from; i <= to; i++) {
      var o = S[i], w = o.w;
      var u = (i - from) / (to - from);
      var hgt = w * (0.55 + 0.45 * Math.sin(u * PI)) * (0.8 + 0.25 * Math.sin(t * 2.6 - i * 0.42));
      if (i % 4 === 0) hgt *= 1.45;               // шипы-лучи
      var bk = 0.82 * roll;
      base.push([o.x + o.nx * w * bk, o.y + o.ny * w * bk]);
      tip.push([o.x + o.nx * (w * bk + hgt * roll) - o.tx * w * 0.35, o.y + o.ny * (w * bk + hgt * roll) - o.ty * w * 0.35]);
    }
    ctx.beginPath();
    ctx.moveTo(base[0][0], base[0][1]);
    for (var a = 0; a < tip.length; a++) ctx.lineTo(tip[a][0], tip[a][1]);
    for (var b = base.length - 1; b >= 0; b--) ctx.lineTo(base[b][0], base[b][1]);
    ctx.closePath();
    var mid = base[Math.floor(base.length / 2)], mt = tip[Math.floor(tip.length / 2)];
    var gr = ctx.createLinearGradient(mid[0], mid[1], mt[0], mt[1]);
    gr.addColorStop(0, C('b2', .95));
    gr.addColorStop(0.7, C('spine', .55));
    gr.addColorStop(1, C('spine', .25));
    ctx.fillStyle = gr;
    ctx.fill();
    // лучи
    ctx.lineWidth = Math.max(1, W0 * cur.scale * 0.05);
    ctx.strokeStyle = C('spine', .45);
    ctx.beginPath();
    for (var r = 0; r < tip.length; r += 4) { ctx.moveTo(base[r][0], base[r][1]); ctx.lineTo(tip[r][0], tip[r][1]); }
    ctx.stroke();
    // кромка
    ctx.beginPath();
    ctx.moveTo(tip[0][0], tip[0][1]);
    for (var e = 1; e < tip.length; e++) ctx.lineTo(tip[e][0], tip[e][1]);
    ctx.lineWidth = Math.max(1, W0 * cur.scale * 0.045);
    ctx.strokeStyle = C('edge', .9);
    ctx.stroke();
  }

  /* хвостовой веер из длинных прядей */
  function drawTail() {
    var tb = S[N - 6];
    ctx.lineCap = 'round';
    for (var f = 0; f < 9; f++) {
      var src = S[N - 9 + Math.min(7, f)];
      var spread = (f - 4) * 0.2 + Math.sin(t * 2.2 + f * 0.7) * 0.18;
      var dx = -src.tx * Math.cos(spread) - src.ty * Math.sin(spread);
      var dy = -src.ty * Math.cos(spread) + src.tx * Math.sin(spread);
      var len = W0 * cur.scale * (2.6 + Math.sin(f * 1.9) * 0.7);
      var sway = Math.sin(t * 2.8 + f) * W0 * cur.scale * 0.7;
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.bezierCurveTo(
        src.x + dx * len * 0.35 + tb.nx * sway * 0.4, src.y + dy * len * 0.35 + tb.ny * sway * 0.4,
        src.x + dx * len * 0.7 + tb.nx * sway, src.y + dy * len * 0.7 + tb.ny * sway,
        src.x + dx * len, src.y + dy * len
      );
      var al = 0.55 - Math.abs(f - 4) * 0.09;
      ctx.strokeStyle = f % 2 ? C('belly', al) : C('spine', al);
      ctx.lineWidth = Math.max(1, W0 * cur.scale * (0.13 - Math.abs(f - 4) * 0.012));
      ctx.stroke();
    }
  }

  /* грива: пряди вдоль шеи, развеваются назад */
  function drawMane() {
    var n = tier >= 2 ? 9 : 6;
    ctx.lineCap = 'round';
    for (var m = 0; m < n; m++) {
      var i = 1 + Math.floor(m * 10 / n), o = S[i], w = o.w;
      var wv = Math.sin(t * 3.2 + m * 0.8);
      var sx = o.x + o.nx * w * 0.7 * roll, sy2 = o.y + o.ny * w * 0.7 * roll;
      var len = w * (1.6 + (m % 3) * 0.35);
      ctx.beginPath();
      ctx.moveTo(sx, sy2);
      ctx.bezierCurveTo(
        sx + (o.nx * 0.9 * roll - o.tx * 0.6) * len * 0.5, sy2 + (o.ny * 0.9 * roll - o.ty * 0.6) * len * 0.5,
        sx + (o.nx * (0.6 + wv * 0.3) * roll - o.tx * 1.1) * len, sy2 + (o.ny * (0.6 + wv * 0.3) * roll - o.ty * 1.1) * len,
        sx + (o.nx * (0.3 + wv * 0.4) * roll - o.tx * 1.6) * len, sy2 + (o.ny * (0.3 + wv * 0.4) * roll - o.ty * 1.6) * len
      );
      ctx.strokeStyle = m % 3 === 0 ? C('belly', .55) : (m % 3 === 1 ? C('spine', .5) : C('scale', .45));
      ctx.lineWidth = Math.max(1, w * (0.1 - (m % 3) * 0.02));
      ctx.stroke();
    }
  }

  /* чешуя внахлёст: от хвоста к голове, чтобы передние лежали сверху */
  function drawScales() {
    buildScale();
    var rows = tier >= 2 ? [0.7, 0.42, 0.14] : [0.6, 0.2];
    var step = tier >= 2 ? 1 : 2;
    for (var i = N - 5; i >= 2; i -= step) {
      var o = S[i], w = o.w;
      if (w < 3) continue;
      var c = o.tx, s = o.ty, sz = Math.max(7, w * (rows.length === 3 ? 0.6 : 0.75));
      var stg = (i & 1) ? 0.08 : -0.08;
      for (var r = 0; r < rows.length; r++) {
        var k = (rows[r] + stg) * roll;
        var x = o.x + o.nx * w * k, y = o.y + o.ny * w * k;
        ctx.setTransform(dpr * c, dpr * s, -dpr * s, dpr * c, dpr * x, dpr * y);
        ctx.globalAlpha = 0.8;
        ctx.drawImage(scaleSpr, -sz / 2, -sz / 2, sz, sz);
      }
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawBody() {
    var head0 = S[0], tail = S[N - 1];
    buildGlow();

    // свечение вокруг тела
    if (tier >= 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.16;
      for (var g = 2; g < N - 6; g += 3) {
        var go = S[g], gs = go.w * 4.2;
        ctx.drawImage(glowSpr, go.x - gs / 2, go.y - gs / 2, gs, gs);
      }
      ctx.restore();
    }

    drawLeg(10, -1, 1.7, true);
    drawLeg(34, -1, 4.2, true);
    drawTail();
    drawFin();

    // основа и тёмный силуэт
    bodyPath();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(4,2,8,.75)';
    ctx.lineWidth = Math.max(2, W0 * cur.scale * 0.18);
    ctx.stroke();
    var gr = ctx.createLinearGradient(head0.x, head0.y, tail.x, tail.y);
    gr.addColorStop(0, C('b2'));
    gr.addColorStop(0.5, C('b3'));
    gr.addColorStop(1, C('b3'));
    ctx.fillStyle = gr;
    ctx.fill();

    ctx.save();
    bodyPath();
    ctx.clip();
    drawScales();
    // брюхо: сплошная светлая полоса с тонкими швами между пластинами
    ctx.beginPath();
    for (var i = 2; i < N - 4; i++) { var o = S[i]; var x = o.x - o.nx * o.w * 0.5 * roll, y = o.y - o.ny * o.w * 0.5 * roll; if (i === 2) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    for (var j = N - 5; j >= 2; j--) { var q = S[j]; ctx.lineTo(q.x - q.nx * q.w * 1.1 * roll, q.y - q.ny * q.w * 1.1 * roll); }
    ctx.closePath();
    var bg = ctx.createLinearGradient(S[2].x, S[2].y, S[N - 5].x, S[N - 5].y);
    bg.addColorStop(0, C('belly', .72)); bg.addColorStop(1, C('belly', .35));
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = Math.max(0.8, W0 * cur.scale * 0.035);
    ctx.strokeStyle = 'rgba(60,30,15,.35)';
    ctx.beginPath();
    for (var k2 = 3; k2 < N - 5; k2 += 2) {
      var e2 = S[k2];
      ctx.moveTo(e2.x - e2.nx * e2.w * 0.52 * roll, e2.y - e2.ny * e2.w * 0.52 * roll);
      ctx.quadraticCurveTo(e2.x - e2.nx * e2.w * 0.8 * roll - e2.tx * e2.w * 0.18, e2.y - e2.ny * e2.w * 0.8 * roll - e2.ty * e2.w * 0.18, e2.x - e2.nx * e2.w * 1.05 * roll, e2.y - e2.ny * e2.w * 1.05 * roll);
    }
    ctx.stroke();
    // объём: каждый сегмент освещён как цилиндр (тень у брюха, блик по спине)
    var stp = tier >= 2 ? 1 : 2;
    for (var ci = 1; ci < N - 3; ci += stp) {
      var c0 = S[ci], c1 = S[Math.min(N - 2, ci + stp)], cw = c0.w * 1.15, cw1 = c1.w * 1.15;
      var gx0 = c0.x - c0.nx * cw * roll, gy0 = c0.y - c0.ny * cw * roll, gx1 = c0.x + c0.nx * cw * roll, gy1 = c0.y + c0.ny * cw * roll;
      var cg = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      cg.addColorStop(0, 'rgba(0,0,0,.55)');
      cg.addColorStop(0.3, 'rgba(0,0,0,.12)');
      cg.addColorStop(0.55, 'rgba(255,240,215,0)');
      cg.addColorStop(0.74, 'rgba(255,240,215,.2)');
      cg.addColorStop(0.84, 'rgba(255,250,236,.32)');
      cg.addColorStop(1, 'rgba(0,0,0,.4)');
      ctx.beginPath();
      ctx.moveTo(gx0, gy0); ctx.lineTo(gx1, gy1);
      ctx.lineTo(c1.x + c1.nx * cw1 * roll + c1.tx * -1, c1.y + c1.ny * cw1 * roll + c1.ty * -1);
      ctx.lineTo(c1.x - c1.nx * cw1 * roll + c1.tx * -1, c1.y - c1.ny * cw1 * roll + c1.ty * -1);
      ctx.closePath();
      ctx.fillStyle = cg;
      ctx.fill();
    }
    ctx.restore();

    // золотой контур
    bodyPath();
    ctx.strokeStyle = C('edge', .8);
    ctx.lineWidth = Math.max(1.1, W0 * cur.scale * 0.055);
    ctx.stroke();

    drawLeg(10, 1, 0, false);
    drawLeg(34, 1, 2.6, false);
    drawMane();

    // бегущая волна света
    if (tier >= 1) {
      var pi = Math.floor(pulse * (N - 6));
      if (pi < N - 8) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (var q = -3; q <= 3; q++) {
          var po = S[Math.max(1, Math.min(N - 6, pi + q))];
          var ps = po.w * 2.4;
          ctx.globalAlpha = 0.16 * (1 - Math.abs(q) / 4);
          ctx.drawImage(glowSpr, po.x - ps / 2, po.y - ps / 2, ps, ps);
        }
        ctx.restore();
      }
    }
  }

  function updateWhiskers(dt) {
    var h = W0 * cur.scale;
    var c = Math.cos(heading), s = Math.sin(heading);
    var sy = window.scrollY || 0;
    var anchors = [[2.35, -0.12], [2.05, -0.5]];
    var seg = h * 0.7;
    for (var w = 0; w < 2; w++) {
      var ch = whiskers[w];
      var ay0 = anchors[w][1] * roll;
      var ax = head.x + anchors[w][0] * h * c - ay0 * h * s;
      var ay = head.y - sy + anchors[w][0] * h * s + ay0 * h * c;
      ch[0].x = ax; ch[0].y = ay;
      for (var i = 1; i < WN; i++) {
        var p = ch[i], q = ch[i - 1];
        var wave = Math.sin(t * 3 - i * 0.55 + w * 1.6) * h * 0.22;
        p.x += (-c * 0.7 - s * wave * 0.06) * dt * 60;
        p.y += (-s * 0.7 + c * wave * 0.06) * dt * 60 + dt * 5;
        var dx = p.x - q.x, dy = p.y - q.y;
        var d = Math.hypot(dx, dy) || 0.001;
        p.x = q.x + dx / d * seg;
        p.y = q.y + dy / d * seg;
      }
    }
  }

  function drawWhiskers() {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var w = 0; w < 2; w++) {
      var ch = whiskers[w];
      for (var pass = 0; pass < 2; pass++) {
        for (var i = 1; i < WN; i++) {
          var u = 1 - i / WN;
          ctx.beginPath();
          ctx.moveTo(ch[i - 1].x, ch[i - 1].y);
          ctx.lineTo(ch[i].x, ch[i].y);
          ctx.strokeStyle = pass ? C('belly', (0.8 * u).toFixed(3)) : C('glow', (0.18 * u).toFixed(3));
          ctx.lineWidth = Math.max(0.7, W0 * cur.scale * (pass ? 0.1 : 0.22) * u);
          ctx.stroke();
        }
      }
    }
  }

  /* голова в своих координатах: +x к морде, +y к спине */
  function drawHead(sy) {
    var h = W0 * cur.scale;
    ctx.save();
    ctx.translate(head.x, head.y - sy);
    ctx.rotate(heading);
    var fl = roll >= 0 ? Math.max(0.35, roll) : Math.min(-0.35, roll);
    ctx.scale(1, fl);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    var open = jaw * 0.42;

    // дальний рог
    horn(0.15 * h, 0.82 * h, -2.5 * h, 1.55 * h, h, true);

    // жабры-веер за челюстью
    for (var f = 0; f < 6; f++) {
      var fa = 2.35 + f * 0.17 + Math.sin(t * 3 + f) * 0.05;
      var fl2 = h * (1.25 - Math.abs(f - 2.5) * 0.12);
      ctx.beginPath();
      ctx.moveTo(-0.55 * h, -0.05 * h);
      ctx.quadraticCurveTo(-0.55 * h + Math.cos(fa - .2) * fl2 * .6, -0.05 * h - Math.sin(fa - .2) * fl2 * .6, -0.55 * h + Math.cos(fa) * fl2, -0.05 * h - Math.sin(fa) * fl2);
      ctx.strokeStyle = C('spine', .8);
      ctx.lineWidth = Math.max(1, h * 0.09);
      ctx.stroke();
    }

    // нижняя челюсть
    ctx.save();
    ctx.translate(0.2 * h, -0.12 * h);
    ctx.rotate(-open);
    ctx.beginPath();
    ctx.moveTo(-0.7 * h, 0);
    ctx.quadraticCurveTo(0.9 * h, -0.62 * h, 2.35 * h, -0.2 * h);
    ctx.lineTo(2.3 * h, -0.02 * h);
    ctx.quadraticCurveTo(1.2 * h, -0.05 * h, -0.4 * h, 0.12 * h);
    ctx.closePath();
    ctx.fillStyle = C('b2');
    ctx.fill();
    ctx.strokeStyle = C('edge', .85);
    ctx.lineWidth = Math.max(1, h * 0.06);
    ctx.stroke();
    // нижние зубы и борода
    ctx.fillStyle = 'rgba(250,244,228,.95)';
    for (var z = 0; z < 4; z++) { var zx = (1.05 + z * 0.3) * h; ctx.beginPath(); ctx.moveTo(zx, -0.04 * h); ctx.lineTo(zx + 0.09 * h, -0.04 * h); ctx.lineTo(zx + 0.04 * h, 0.13 * h); ctx.closePath(); ctx.fill(); }
    for (var b = 0; b < 5; b++) {
      ctx.beginPath();
      ctx.moveTo((0.1 + b * 0.32) * h, -0.42 * h);
      ctx.quadraticCurveTo((-0.3 + b * 0.28) * h, (-1.0 - b * 0.06) * h, (-1.05 + b * 0.22 + Math.sin(t * 2.6 + b) * 0.16) * h, (-1.35 - b * 0.08) * h);
      ctx.strokeStyle = b % 2 ? C('belly', .7) : C('spine', .7);
      ctx.lineWidth = Math.max(0.8, h * 0.075);
      ctx.stroke();
    }
    ctx.restore();

    // огонь в пасти
    if (open > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = jaw;
      ctx.drawImage(dotSpr, 0.9 * h, -0.9 * h, 1.8 * h, 1.2 * h);
      ctx.restore();
    }

    // череп
    ctx.beginPath();
    ctx.moveTo(-1.15 * h, -0.45 * h);
    ctx.bezierCurveTo(-1.35 * h, 0.35 * h, -0.85 * h, 0.95 * h, -0.1 * h, 0.98 * h);
    ctx.bezierCurveTo(0.45 * h, 1.0 * h, 0.75 * h, 0.82 * h, 1.05 * h, 0.66 * h);
    ctx.bezierCurveTo(1.6 * h, 0.5 * h, 2.3 * h, 0.5 * h, 2.7 * h, 0.32 * h);
    ctx.quadraticCurveTo(2.95 * h, 0.15 * h, 2.78 * h, -0.08 * h);
    ctx.quadraticCurveTo(2.6 * h, -0.22 * h, 2.3 * h, -0.2 * h);
    ctx.bezierCurveTo(1.5 * h, -0.14 * h, 0.6 * h, -0.2 * h, 0.1 * h, -0.32 * h);
    ctx.quadraticCurveTo(-0.55 * h, -0.5 * h, -1.15 * h, -0.45 * h);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(4,2,8,.8)';
    ctx.lineWidth = Math.max(2, h * 0.2);
    ctx.stroke();
    var sk = ctx.createLinearGradient(0, 1.0 * h, 0, -0.4 * h);
    sk.addColorStop(0, C('b1'));
    sk.addColorStop(0.55, C('b2'));
    sk.addColorStop(1, C('b3'));
    ctx.fillStyle = sk;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // рельеф: скула и тень под глазом
    ctx.beginPath();
    ctx.moveTo(-0.9 * h, 0.1 * h);
    ctx.bezierCurveTo(-0.2 * h, 0.35 * h, 0.6 * h, 0.15 * h, 1.4 * h, 0.12 * h);
    ctx.strokeStyle = 'rgba(0,0,0,.3)';
    ctx.lineWidth = h * 0.28;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-0.45 * h, 0.35 * h, 0.38 * h, PI * 1.1, PI * 1.85);
    ctx.strokeStyle = C('edge', .5);
    ctx.lineWidth = Math.max(1, h * 0.05);
    ctx.stroke();
    // блик по переносице
    ctx.beginPath();
    ctx.moveTo(-0.6 * h, 0.82 * h);
    ctx.bezierCurveTo(0.4 * h, 0.95 * h, 1.4 * h, 0.55 * h, 2.6 * h, 0.28 * h);
    ctx.strokeStyle = 'rgba(255,245,225,.22)';
    ctx.lineWidth = h * 0.22;
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = C('edge', .95);
    ctx.lineWidth = Math.max(1, h * 0.055);
    ctx.stroke();

    // верхние зубы и клык
    ctx.fillStyle = 'rgba(250,244,228,.97)';
    for (var tz = 0; tz < 4; tz++) { var tx2 = (1.05 + tz * 0.32) * h; ctx.beginPath(); ctx.moveTo(tx2, -0.18 * h); ctx.lineTo(tx2 + 0.1 * h, -0.18 * h); ctx.lineTo(tx2 + 0.045 * h, -0.34 * h); ctx.closePath(); ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(2.28 * h, -0.17 * h); ctx.lineTo(2.44 * h, -0.17 * h); ctx.lineTo(2.33 * h, -0.5 * h); ctx.closePath(); ctx.fill();

    // ноздря и дымок
    ctx.beginPath();
    ctx.ellipse(2.55 * h, 0.2 * h, 0.1 * h, 0.06 * h, -0.3, 0, PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.7)';
    ctx.fill();
    if (tier >= 1 && !reduce) {
      ctx.save();
      ctx.globalAlpha = 0.18;
      for (var sm = 0; sm < 3; sm++) {
        var ph = (t * 0.7 + sm / 3) % 1;
        var smx = 2.7 * h + ph * 0.9 * h, smy = 0.3 * h + ph * 0.7 * h + Math.sin(t * 3 + sm) * 0.15 * h, sr = h * (0.25 + ph * 0.6);
        ctx.globalAlpha = 0.16 * (1 - ph);
        ctx.drawImage(dotSpr, smx - sr, smy - sr, sr * 2, sr * 2);
      }
      ctx.restore();
    }

    // надбровная пластина
    ctx.beginPath();
    ctx.moveTo(0.2 * h, 0.66 * h);
    ctx.quadraticCurveTo(0.85 * h, 1.02 * h, 1.55 * h, 0.6 * h);
    ctx.quadraticCurveTo(0.9 * h, 0.78 * h, 0.2 * h, 0.66 * h);
    ctx.fillStyle = C('spine');
    ctx.fill();

    // глаз: свечение, радужка, вертикальный зрачок, блик, моргание
    ctx.save();
    ctx.translate(0.95 * h, 0.44 * h);
    ctx.rotate(-0.15);
    var pl = 0.8 + 0.2 * Math.sin(t * 2.4);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 * pl;
    var eg = h * 1.3;
    ctx.drawImage(glowSpr, -eg / 2, -eg / 2, eg, eg);
    ctx.restore();
    var op = 1 - blink;
    ctx.scale(1, Math.max(0.08, op));
    ctx.beginPath();
    ctx.moveTo(-0.3 * h, 0);
    ctx.quadraticCurveTo(0, 0.2 * h, 0.3 * h, 0);
    ctx.quadraticCurveTo(0, -0.2 * h, -0.3 * h, 0);
    var ir = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.3 * h);
    ir.addColorStop(0, '#fff6d0');
    ir.addColorStop(0.4, C('eye'));
    ir.addColorStop(1, C('edge'));
    ctx.fillStyle = ir;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0.02 * h, 0, 0.035 * h, 0.13 * h, 0, 0, PI * 2);
    ctx.fillStyle = '#100604';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-0.08 * h, 0.05 * h, 0.035 * h, 0, PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    ctx.fill();
    ctx.restore();

    // ближний рог
    horn(0.25 * h, 0.9 * h, -2.75 * h, 1.85 * h, h, false);

    ctx.restore();
  }

  /* рог-рога: сужается к концу, с отростком */
  function horn(x0, y0, x1, y1, h, far) {
    var mx = (x0 + x1) / 2 + 0.2 * h, my = Math.max(y0, y1) + 0.55 * h;
    var steps = 10;
    var px = x0, py = y0;
    for (var i = 1; i <= steps; i++) {
      var u = i / steps, a = 1 - u;
      var x = a * a * x0 + 2 * a * u * mx + u * u * x1;
      var y = a * a * y0 + 2 * a * u * my + u * u * y1;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.strokeStyle = far ? C('spine', .55) : (u < 0.5 ? C('belly') : C('spine'));
      ctx.lineWidth = Math.max(0.8, h * (0.26 - u * 0.21));
      ctx.stroke();
      px = x; py = y;
    }
    if (!far) {
      var bxp = 0.5 * x0 + 0.5 * mx - 0.6 * h, byp = 0.5 * y0 + 0.5 * my + 0.2 * h;
      ctx.beginPath();
      ctx.moveTo(bxp + 0.3 * h, byp - 0.05 * h);
      ctx.quadraticCurveTo(bxp, byp + 0.5 * h, bxp + 0.25 * h, byp + 0.85 * h);
      ctx.strokeStyle = C('spine');
      ctx.lineWidth = h * 0.12;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(mx, my, x1, y1);
      ctx.strokeStyle = 'rgba(255,250,230,.35)';
      ctx.lineWidth = h * 0.05;
      ctx.stroke();
    }
  }

  function drawMotes() {
    if (!motes.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i], k = m.life / m.max, r = m.r * 4;
      ctx.globalAlpha = Math.min(1, k * 1.4) * 0.8;
      ctx.drawImage(glowSpr, m.x - r, m.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  function drawEmbers() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < embers.length; i++) {
      var e = embers[i];
      var tw = 0.55 + 0.45 * Math.sin(t * 2.2 + e.ph * 3);
      ctx.globalAlpha = e.a * tw;
      ctx.fillStyle = e.gold ? '#f3c96a' : '#86a6ff';
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  var fireSprite = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,240,200,.9)'); gr.addColorStop(.35, 'rgba(255,180,70,.6)'); gr.addColorStop(1, 'rgba(200,60,20,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return c;
  })();
  function drawFire() {
    if (!fire.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < fire.length; i++) {
      var f = fire[i];
      ctx.globalAlpha = Math.max(0, f.life / f.max);
      ctx.drawImage(fireSprite, f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
    }
    ctx.restore();
  }

  function draw() {
    var sy = window.scrollY || 0;
    ctx = mainCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    computeScreen(sy);
    var minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < N; i += 6) { if (S[i].y < minY) minY = S[i].y; if (S[i].y > maxY) maxY = S[i].y; }
    var visible = maxY > -W0 * 6 && minY < vh + W0 * 6;

    if (visible && cur.alpha > 0.01) {
      // рисуем дракона целиком в буфер, затем кладём на экран одной картинкой
      ctx = bufCtx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, buf.width, buf.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      drawBody();
      drawWhiskers();
      drawHead(sy);
      ctx = mainCtx;
      ctx.globalAlpha = Math.min(1, cur.alpha);
      ctx.drawImage(buf, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (cur.alpha > 0.3) { ctx.globalAlpha = cur.alpha; drawMotes(); ctx.globalAlpha = 1; }
    drawFire();
  }

  /* ------------------------------------------------------ цикл */
  var raf = null, last = 0;
  var odd = false;
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    update(dt);
    computeScreen(window.scrollY || 0);
    updateLife(dt);
    updateWhiskers(dt);
    odd = !odd;
    if (tier > 0 || odd) draw();
    raf = requestAnimationFrame(frame);
  }
  if (Perf) Perf.onChange(function (t) { tier = t; resize(); });
  function start() { if (raf === null) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function stop() { if (raf !== null) { cancelAnimationFrame(raf); raf = null; } }

  init();
  window.addEventListener('resize', function () {
    var oldW = vw;
    resize();
    if (Math.abs(oldW - vw) > 1) { for (var i = 0; i < embers.length; i++) embers[i].x = Math.random() * vw; }
  }, { passive: true });
  document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
  start();

  /* ------------------------------------------------------ API */
  window.RyzhikovDragon = {
    setPlan: function (p) {
      for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) plan[k] = p[k];
    },
    // дракон заново влетает сверху (после того как нырнул во врата)
    reenter: function () {
      var sy = window.scrollY || 0;
      head.x = vw * plan.tx;
      head.y = sy - vh * 0.25;
      head.vx = 0; head.vy = vh * 0.8;
      heading = PI / 2;
      for (var i = 0; i < N; i++) { pts[i].x = head.x + Math.sin(i * 0.4) * W0; pts[i].y = head.y - i * L * plan.scale; }
      for (var w = 0; w < 2; w++) for (var j = 0; j < WN; j++) { whiskers[w][j].x = head.x; whiskers[w][j].y = head.y - sy; }
      cur.scale = plan.scale; cur.tx = plan.tx;
    },
    setPalette: function (p, instant) {
      if (!p) return;
      KEYS.forEach(function (k) {
        if (!p[k]) return;
        palT[k] = hx(p[k]);
        if (instant) pal[k] = palT[k].slice();
      });
    },
    breathe: function (sec, aim) {
      if (reduce) return;
      breathT = Math.max(breathT, sec || 1.4);
      breathAim = typeof aim === 'number' ? aim : null;
    },
    isMobile: function () { return mobile; },
    state: function () { return { hx: head.x, hy: head.y - (window.scrollY || 0), alpha: cur.alpha, tx: cur.tx, ty: cur.ty, plan: plan }; }
  };
})();
