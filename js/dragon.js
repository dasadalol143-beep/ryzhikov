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
  var ctx = canvas.getContext('2d');

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var N = 72;                 // сегментов в теле
  var PI = Math.PI;

  var vw = 0, vh = 0, dpr = 1, mobile = false;
  var W0 = 30;                // базовая толщина тела
  var L = 28;                 // длина сегмента

  var pts = [];               // тело, координаты документа
  var head = { x: 0, y: 0, vx: 0, vy: 0 };
  var heading = PI / 2;
  var t = 0;

  // план полёта: куда тянется голова (доли экрана), масштаб, прозрачность
  var plan = { tx: 0.72, ty: 0.5, scale: 1, alpha: 1, wander: 1 };
  var cur = { tx: 0.72, ty: 0.5, scale: 1, alpha: 0 };

  var lastScroll = window.scrollY || 0;
  var scrollVel = 0;

  var whiskers = [[], []];
  var WN = 11;

  var embers = [];
  var fire = [];
  var breathT = 0;
  var breathAim = null;       // куда развернуть пасть во время дыхания
  var jaw = 0;

  /* ---------------------------------------------------- размеры */
  function resize() {
    vw = window.innerWidth;
    vh = window.innerHeight;
    dpr = Math.min(1.75, window.devicePixelRatio || 1);
    mobile = vw < 760;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
    W0 = Math.max(13, Math.min(34, Math.min(vw, vh) * (mobile ? 0.036 : 0.034)));
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
    var count = mobile ? 34 : 70;
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

    var k = Math.min(1, dt * 1.7);
    cur.tx += (plan.tx - cur.tx) * k;
    cur.ty += (plan.ty - cur.ty) * k;
    cur.scale += (plan.scale - cur.scale) * Math.min(1, dt * 2.2);
    cur.alpha += (plan.alpha - cur.alpha) * Math.min(1, dt * 1.6);

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

  function drawLeg(i, side, phase, back) {
    var o = S[i];
    var w = o.w;
    var sw = Math.sin(t * 4.2 + phase) * 0.55;
    var sx = o.x - o.nx * w * 0.55 * side, syy = o.y - o.ny * w * 0.55 * side;
    // направление лапы: от тела наружу и назад
    var ox = -o.nx * side, oy = -o.ny * side;
    var bx = -o.tx, by = -o.ty;
    var l1 = w * 1.55, l2 = w * 1.35;
    var a1x = ox * Math.cos(sw) + bx * Math.sin(sw) * 0.9 + bx * 0.5;
    var a1y = oy * Math.cos(sw) + by * Math.sin(sw) * 0.9 + by * 0.5;
    var al = Math.hypot(a1x, a1y) || 1;
    var kx = sx + a1x / al * l1, ky = syy + a1y / al * l1;
    var fx = kx + (o.tx * 0.6 + ox * 0.5) * l2, fy = ky + (o.ty * 0.6 + oy * 0.5) * l2;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(sx, syy);
    ctx.quadraticCurveTo(kx, ky, fx, fy);
    ctx.strokeStyle = back ? 'rgba(160,125,55,.45)' : 'rgba(212,166,74,.85)';
    ctx.lineWidth = w * 0.62;
    ctx.stroke();
    ctx.strokeStyle = back ? '#070c1f' : '#0d1a44';
    ctx.lineWidth = w * 0.46;
    ctx.stroke();

    // когти
    ctx.strokeStyle = back ? 'rgba(200,170,110,.45)' : 'rgba(243,213,138,.95)';
    ctx.lineWidth = Math.max(1, w * 0.1);
    for (var c = -1; c <= 1; c++) {
      var ca = Math.atan2(fy - ky, fx - kx) + c * 0.5;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.quadraticCurveTo(
        fx + Math.cos(ca) * w * 0.45, fy + Math.sin(ca) * w * 0.45,
        fx + Math.cos(ca + 0.7 * side) * w * 0.6, fy + Math.sin(ca + 0.7 * side) * w * 0.6
      );
      ctx.stroke();
    }
  }

  function drawBody() {
    var head0 = S[0], tail = S[N - 1];

    // дальние лапы - за телом
    drawLeg(9, -1, 1.7, true);
    drawLeg(33, -1, 4.2, true);

    // свечение
    bodyPath();
    ctx.save();
    ctx.shadowColor = 'rgba(70,115,255,.55)';
    ctx.shadowBlur = mobile ? 18 : 34;
    ctx.fillStyle = '#0a1536';
    ctx.fill();
    ctx.restore();

    var gr = ctx.createLinearGradient(head0.x, head0.y, tail.x, tail.y);
    gr.addColorStop(0, '#1a2f78');
    gr.addColorStop(0.35, '#10205a');
    gr.addColorStop(1, '#070d24');
    ctx.fillStyle = gr;
    ctx.fill();

    // брюхо: золотые пластины
    ctx.save();
    bodyPath();
    ctx.clip();
    ctx.lineCap = 'round';
    for (var i = 1; i < N - 2; i++) {
      var o = S[i];
      var w = o.w;
      var al = 0.55 * (1 - i / N);
      ctx.strokeStyle = 'rgba(243,213,138,' + al.toFixed(3) + ')';
      ctx.lineWidth = Math.max(0.6, w * 0.07);
      ctx.beginPath();
      ctx.moveTo(o.x - o.nx * w * 0.38, o.y - o.ny * w * 0.38);
      ctx.lineTo(o.x - o.nx * w * 1.05, o.y - o.ny * w * 1.05);
      ctx.stroke();
    }
    // чешуя
    ctx.lineWidth = 1;
    for (var j = 2; j < N - 3; j++) {
      var s = S[j];
      var ws = s.w;
      var dir = Math.atan2(-s.ty, -s.tx);
      var rows = j % 2 ? [0.62, 0.05] : [0.34, -0.22];
      var aa = 0.42 * (1 - j / N) + 0.06;
      ctx.strokeStyle = 'rgba(123,155,255,' + aa.toFixed(3) + ')';
      for (var r = 0; r < rows.length; r++) {
        var cx = s.x + s.nx * ws * rows[r], cy = s.y + s.ny * ws * rows[r];
        ctx.beginPath();
        ctx.arc(cx, cy, ws * 0.3, dir - 1.15, dir + 1.15);
        ctx.stroke();
      }
    }
    // блик по спине
    ctx.strokeStyle = 'rgba(150,180,255,.22)';
    ctx.lineWidth = W0 * 0.12;
    ctx.beginPath();
    for (var b = 1; b < N - 4; b++) {
      var q = S[b];
      var bx = q.x + q.nx * q.w * 0.55, by = q.y + q.ny * q.w * 0.55;
      if (b === 1) ctx.moveTo(bx, by); else ctx.lineTo(bx, by);
    }
    ctx.stroke();
    ctx.restore();

    // контур
    bodyPath();
    ctx.strokeStyle = 'rgba(212,166,74,.55)';
    ctx.lineWidth = Math.max(1, W0 * 0.05);
    ctx.stroke();

    // гребень
    for (var k = 3; k < N - 5; k += 2) {
      var g = S[k];
      var gw = g.w;
      var bx2 = g.x + g.nx * gw * 0.9, by2 = g.y + g.ny * gw * 0.9;
      var h = gw * (0.75 + 0.25 * Math.sin(t * 3.6 + k * 0.45));
      var tipx = bx2 + g.nx * h - g.tx * gw * 0.7, tipy = by2 + g.ny * h - g.ty * gw * 0.7;
      ctx.beginPath();
      ctx.moveTo(bx2 + g.tx * gw * 0.32, by2 + g.ty * gw * 0.32);
      ctx.quadraticCurveTo(bx2 + g.nx * h * 0.6, by2 + g.ny * h * 0.6, tipx, tipy);
      ctx.lineTo(bx2 - g.tx * gw * 0.36, by2 - g.ty * gw * 0.36);
      ctx.closePath();
      var al2 = 0.92 * (1 - k / N) + 0.08;
      ctx.fillStyle = 'rgba(212,166,74,' + al2.toFixed(3) + ')';
      ctx.fill();
    }

    // хвостовой плавник
    var tb = S[N - 7];
    ctx.lineCap = 'round';
    for (var f = 0; f < 7; f++) {
      var src = S[N - 7 + f];
      var spread = (f - 3) * 0.22 + Math.sin(t * 3 + f) * 0.12;
      var dx = -src.tx * Math.cos(spread) - src.ty * Math.sin(spread);
      var dy = -src.ty * Math.cos(spread) + src.tx * Math.sin(spread);
      var len = W0 * cur.scale * (2.2 + Math.sin(f * 1.7) * 0.6);
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.quadraticCurveTo(
        src.x + dx * len * 0.5 + tb.nx * W0 * 0.6 * Math.sin(t * 2.4 + f),
        src.y + dy * len * 0.5 + tb.ny * W0 * 0.6 * Math.sin(t * 2.4 + f),
        src.x + dx * len, src.y + dy * len
      );
      ctx.strokeStyle = 'rgba(243,213,138,' + (0.55 - Math.abs(f - 3) * 0.1).toFixed(2) + ')';
      ctx.lineWidth = Math.max(1, W0 * 0.09);
      ctx.stroke();
    }

    // ближние лапы
    drawLeg(9, 1, 0, false);
    drawLeg(33, 1, 2.6, false);

    // грива вдоль шеи
    for (var m = 1; m < 12; m++) {
      var mn = S[m];
      var mw = mn.w;
      var wv = Math.sin(t * 4 + m * 0.7) * 0.5;
      var sx = mn.x + mn.nx * mw * 0.8, sy2 = mn.y + mn.ny * mw * 0.8;
      ctx.beginPath();
      ctx.moveTo(sx, sy2);
      ctx.quadraticCurveTo(
        sx + mn.nx * mw * 1.3 - mn.tx * mw * 0.8, sy2 + mn.ny * mw * 1.3 - mn.ty * mw * 0.8,
        sx + mn.nx * mw * (1.5 + wv) - mn.tx * mw * 2.6, sy2 + mn.ny * mw * (1.5 + wv) - mn.ty * mw * 2.6
      );
      ctx.strokeStyle = m % 3 ? 'rgba(243,213,138,.55)' : 'rgba(123,155,255,.5)';
      ctx.lineWidth = Math.max(1, mw * 0.08);
      ctx.stroke();
    }
  }

  function updateWhiskers(dt) {
    var h = W0 * cur.scale;
    var c = Math.cos(heading), s = Math.sin(heading);
    var sy = window.scrollY || 0;
    var anchors = [[2.15, -0.05], [1.9, -0.45]];
    var seg = h * 0.62;
    for (var w = 0; w < 2; w++) {
      var ch = whiskers[w];
      var ax = head.x + anchors[w][0] * h * c - anchors[w][1] * h * s;
      var ay = head.y - sy + anchors[w][0] * h * s + anchors[w][1] * h * c;
      ch[0].x = ax; ch[0].y = ay;
      for (var i = 1; i < WN; i++) {
        var p = ch[i], q = ch[i - 1];
        // дрейф назад и волна
        var wave = Math.sin(t * 3.4 - i * 0.6 + w * 1.4) * h * 0.18;
        p.x += (-c * 0.6 - s * wave * 0.05) * dt * 60;
        p.y += (-s * 0.6 + c * wave * 0.05) * dt * 60 + dt * 6;
        var dx = p.x - q.x, dy = p.y - q.y;
        var d = Math.hypot(dx, dy) || 0.001;
        p.x = q.x + dx / d * seg;
        p.y = q.y + dy / d * seg;
      }
    }
  }

  function drawWhiskers() {
    ctx.lineCap = 'round';
    for (var w = 0; w < 2; w++) {
      var ch = whiskers[w];
      for (var i = 1; i < WN; i++) {
        ctx.beginPath();
        ctx.moveTo(ch[i - 1].x, ch[i - 1].y);
        ctx.lineTo(ch[i].x, ch[i].y);
        ctx.strokeStyle = 'rgba(243,213,138,' + (0.85 * (1 - i / WN)).toFixed(3) + ')';
        ctx.lineWidth = Math.max(0.6, W0 * cur.scale * 0.1 * (1 - i / WN));
        ctx.stroke();
      }
    }
  }

  function drawHead(sy) {
    var h = W0 * cur.scale;
    ctx.save();
    ctx.translate(head.x, head.y - sy);
    ctx.rotate(heading);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    var open = jaw * 0.38;

    // рога (дальний)
    ctx.strokeStyle = 'rgba(170,130,60,.7)';
    ctx.lineWidth = h * 0.2;
    ctx.beginPath();
    ctx.moveTo(-0.1 * h, 0.55 * h);
    ctx.bezierCurveTo(-0.9 * h, 1.1 * h, -1.6 * h, 1.2 * h, -2.4 * h, 0.9 * h);
    ctx.stroke();

    // нижняя челюсть
    ctx.save();
    ctx.rotate(-open);
    ctx.beginPath();
    ctx.moveTo(-0.6 * h, -0.2 * h);
    ctx.quadraticCurveTo(0.8 * h, -0.85 * h, 2.15 * h, -0.32 * h);
    ctx.quadraticCurveTo(1.2 * h, -0.2 * h, 0.2 * h, -0.05 * h);
    ctx.closePath();
    ctx.fillStyle = '#0c1a46';
    ctx.fill();
    ctx.strokeStyle = 'rgba(212,166,74,.75)';
    ctx.lineWidth = Math.max(1, h * 0.06);
    ctx.stroke();
    // борода
    for (var b = 0; b < 4; b++) {
      ctx.beginPath();
      ctx.moveTo((0.2 + b * 0.35) * h, -0.62 * h);
      ctx.quadraticCurveTo((-0.2 + b * 0.3) * h, (-1.2 - b * 0.08) * h,
        (-0.9 + b * 0.25 + Math.sin(t * 3 + b) * 0.15) * h, (-1.45 - b * 0.1) * h);
      ctx.strokeStyle = 'rgba(243,213,138,.5)';
      ctx.lineWidth = Math.max(0.8, h * 0.06);
      ctx.stroke();
    }
    ctx.restore();

    // пасть изнутри
    if (open > 0.02) {
      ctx.beginPath();
      ctx.moveTo(0.3 * h, -0.1 * h);
      ctx.lineTo(2.1 * h, -0.15 * h);
      ctx.lineTo(2.0 * h, -0.15 * h - open * 2.2 * h);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,170,60,' + (0.6 * jaw).toFixed(2) + ')';
      ctx.fill();
    }

    // череп
    var skull = ctx.createLinearGradient(-h, h, 2 * h, -h);
    skull.addColorStop(0, '#203a8f');
    skull.addColorStop(0.6, '#132560');
    skull.addColorStop(1, '#0b163d');
    ctx.beginPath();
    ctx.moveTo(-1.1 * h, -0.55 * h);
    ctx.quadraticCurveTo(-1.3 * h, 0.55 * h, -0.6 * h, 0.85 * h);
    ctx.quadraticCurveTo(0.3 * h, 1.05 * h, 0.9 * h, 0.72 * h);
    ctx.quadraticCurveTo(1.6 * h, 0.48 * h, 2.35 * h, 0.42 * h);
    ctx.quadraticCurveTo(2.75 * h, 0.32 * h, 2.65 * h, 0.02 * h);
    ctx.quadraticCurveTo(2.55 * h, -0.2 * h, 2.2 * h, -0.18 * h);
    ctx.quadraticCurveTo(1.2 * h, -0.12 * h, 0.2 * h, -0.3 * h);
    ctx.quadraticCurveTo(-0.5 * h, -0.5 * h, -1.1 * h, -0.55 * h);
    ctx.closePath();
    ctx.save();
    ctx.shadowColor = 'rgba(70,115,255,.6)';
    ctx.shadowBlur = h * 1.2;
    ctx.fillStyle = skull;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(212,166,74,.85)';
    ctx.lineWidth = Math.max(1, h * 0.06);
    ctx.stroke();

    // зубы
    ctx.fillStyle = 'rgba(246,240,224,.9)';
    for (var z = 0; z < 4; z++) {
      var zx = (0.9 + z * 0.35) * h;
      ctx.beginPath();
      ctx.moveTo(zx, -0.17 * h);
      ctx.lineTo(zx + 0.1 * h, -0.17 * h);
      ctx.lineTo(zx + 0.04 * h, -0.36 * h);
      ctx.closePath();
      ctx.fill();
    }

    // ноздря и надбровье
    ctx.strokeStyle = 'rgba(243,213,138,.9)';
    ctx.lineWidth = Math.max(1, h * 0.07);
    ctx.beginPath();
    ctx.arc(2.3 * h, 0.2 * h, 0.12 * h, PI * 0.2, PI * 1.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0.1 * h, 0.72 * h);
    ctx.quadraticCurveTo(0.8 * h, 0.95 * h, 1.35 * h, 0.55 * h);
    ctx.stroke();
    // щёчные завитки
    ctx.lineWidth = Math.max(0.8, h * 0.05);
    ctx.beginPath();
    ctx.arc(-0.35 * h, 0.15 * h, 0.32 * h, PI * 0.1, PI * 1.5);
    ctx.stroke();

    // глаз
    ctx.save();
    ctx.translate(0.82 * h, 0.42 * h);
    ctx.shadowColor = 'rgba(255,205,110,1)';
    ctx.shadowBlur = h * 1.1;
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.27 * h, 0.13 * h, -0.18, 0, PI * 2);
    ctx.fillStyle = '#ffd77a';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.ellipse(0.03 * h, 0, 0.045 * h, 0.12 * h, -0.18, 0, PI * 2);
    ctx.fillStyle = '#120a02';
    ctx.fill();
    ctx.restore();

    // рога (ближний) с отростком
    var hg = ctx.createLinearGradient(0, 0, -2.6 * h, 1.8 * h);
    hg.addColorStop(0, '#f3d58a');
    hg.addColorStop(1, 'rgba(212,166,74,.35)');
    ctx.strokeStyle = hg;
    ctx.lineWidth = h * 0.22;
    ctx.beginPath();
    ctx.moveTo(0.15 * h, 0.75 * h);
    ctx.bezierCurveTo(-0.6 * h, 1.45 * h, -1.5 * h, 1.75 * h, -2.6 * h, 1.45 * h);
    ctx.stroke();
    ctx.lineWidth = h * 0.13;
    ctx.beginPath();
    ctx.moveTo(-1.0 * h, 1.55 * h);
    ctx.quadraticCurveTo(-1.2 * h, 2.1 * h, -0.85 * h, 2.4 * h);
    ctx.stroke();

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

  function drawFire() {
    if (!fire.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < fire.length; i++) {
      var f = fire[i];
      var k = f.life / f.max;
      var g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      g.addColorStop(0, 'rgba(255,240,200,' + (0.85 * k).toFixed(3) + ')');
      g.addColorStop(0.35, 'rgba(255,180,70,' + (0.55 * k).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(200,60,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw() {
    var sy = window.scrollY || 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);

    drawEmbers();

    computeScreen(sy);
    // отсечение: если дракон целиком вне кадра - не рисуем тело
    var minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < N; i += 6) { if (S[i].y < minY) minY = S[i].y; if (S[i].y > maxY) maxY = S[i].y; }
    var visible = maxY > -W0 * 6 && minY < vh + W0 * 6;

    if (visible && cur.alpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = cur.alpha;
      drawBody();
      drawWhiskers();
      drawHead(sy);
      ctx.restore();
    }
    drawFire();
  }

  /* ------------------------------------------------------ цикл */
  var raf = null, last = 0;
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    update(dt);
    updateWhiskers(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }
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
    breathe: function (sec, aim) {
      if (reduce) return;
      breathT = Math.max(breathT, sec || 1.4);
      breathAim = typeof aim === 'number' ? aim : null;
    },
    isMobile: function () { return mobile; },
    state: function () { return { hx: head.x, hy: head.y - (window.scrollY || 0), alpha: cur.alpha, tx: cur.tx, ty: cur.ty, plan: plan }; }
  };
})();
