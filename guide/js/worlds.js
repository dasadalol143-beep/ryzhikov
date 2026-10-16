/* =====================================================================
   RYZHIKOV · МИРЫ
   У каждого зала свой мир: фон-декорация, частицы, свет, врата
   и цвет дракона. Мир сменяется в момент, когда дракон ныряет во врата.
   ===================================================================== */
(function () {
  'use strict';

  function hex(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  /* ---------------------------------------------------------- темы
     bg - верх/низ неба, tone/tone2 - свет зала, panel - стекло карточек,
     door - створки врат, fx - частицы, dragon - окрас дракона */
  var T = [
    { id: 'sakura', name: 'Сад сакуры', bg: ['30,10,34', '8,3,12'], tone: '236,110,160', tone2: '255,190,215', panel: ['46,16,40', '16,5,16'],
      door: ['#5a0f22', '#2a0610', '255,170,200'], fx: [['petal', 1]],
      dragon: { b1: '#fbf1f6', b2: '#e4a9c6', b3: '#6e2a52', edge: '#ff9cc4', belly: '#fff0f6', scale: '#c64b86', glow: '#ff7fb6', spine: '#ff6fa5', eye: '#ff3d7f' } },
    { id: 'egypt', name: 'Египет', bg: ['10,15,42', '4,5,15'], tone: '60,90,200', tone2: '230,180,70', panel: ['16,22,60', '6,8,24'],
      door: ['#16205a', '#080c26', '240,196,80'], fx: [['sand', 1], ['dust', .4]],
      dragon: { b1: '#2f52d8', b2: '#1a2b8a', b3: '#0a1238', edge: '#f0c350', belly: '#f5d778', scale: '#f0c350', glow: '#5a82ff', spine: '#f0c350', eye: '#ffe28a' } }
  ];

  /* ---------------------------------------------------------- миры-кадры
     img - картина мира, fx/fy - точка фокуса при обрезке под экран,
     live - живые слои поверх картины (координаты в % от кадра 16:9) */
  function blossoms(r, pts, n) {
    var s = '', cols = ['#ffc4dc', '#ff9cc4', '#ffe0ec', '#ff7fb2'];
    for (var i = 0; i < n; i++) {
      var p = pts[Math.floor(r() * pts.length)];
      var x = p[0] + (r() - .5) * 90, y = p[1] + (r() - .5) * 60;
      s += '<circle cx="' + x.toFixed(0) + '" cy="' + y.toFixed(0) + '" r="' + (5 + r() * 11).toFixed(1) + '" fill="' + cols[i % 4] + '" opacity="' + (.55 + r() * .4).toFixed(2) + '"/>';
    }
    return s;
  }
  var SCN = [
    { img: 'sakura', fx: 0.62, fy: 0.45, live: [
      ['glow', 56, 18, 5, '255,250,235', 'pulse'], ['glow', 18.5, 70, 3.2, '255,200,120', 'flicker'], ['glow', 75, 69.5, 3.2, '255,200,120', 'flicker'],
      ['glow', 90, 69, 2.6, '255,200,120', 'flicker'], ['glow', 34, 71, 1.8, '255,200,120', 'flicker'], ['glow', 81, 40, 7, '255,60,80', 'pulse'],
      ['shimmer', 18, 76, 62, 22, '255,190,225'], ['haze', 70, 18, '255,190,220', 70]] },
    { img: 'egypt', fx: 0.45, fy: 0.55, live: [
      ['glow', 57, 82, 5, '255,190,100', 'flicker'], ['glow', 28, 88, 3, '255,180,90', 'flicker'], ['glow', 39, 10, 3, '230,230,255', 'pulse'],
      ['sandwind', 0, 74, 100, 26], ['haze', 88, 14, '210,170,110', 50]] }
  ];

  function liveLayer(l) {
    var t = l[0], el = document.createElement('div');
    el.className = 'lv lv-' + t;
    var st = el.style;
    if (t === 'glow') {
      st.left = l[1] + '%'; st.top = l[2] + '%'; st.width = st.height = (l[3] * 2) + '%';
      st.background = 'radial-gradient(circle, rgba(' + l[4] + ',.75) 0%, rgba(' + l[4] + ',.28) 32%, rgba(' + l[4] + ',0) 70%)';
      el.classList.add('lv-' + l[5]);
      st.animationDelay = (-Math.random() * 4).toFixed(2) + 's';
    } else if (t === 'haze') {
      st.top = l[1] + '%'; st.height = l[2] + '%';
      st.background = 'radial-gradient(ellipse 40% 50% at 30% 50%, rgba(' + l[3] + ',.22), transparent 70%), radial-gradient(ellipse 35% 45% at 75% 55%, rgba(' + l[3] + ',.18), transparent 70%)';
      st.animationDuration = l[4] + 's';
    } else if (t === 'rays') {
      st.left = l[1] + '%'; st.top = l[2] + '%';
      st.background = 'repeating-conic-gradient(from 0deg, rgba(' + l[3] + ',.16) 0deg 4deg, rgba(' + l[3] + ',0) 4deg 13deg)';
    } else {
      st.left = l[1] + '%'; st.top = l[2] + '%'; st.width = l[3] + '%'; st.height = l[4] + '%';
      if (t === 'shimmer') st.setProperty('--c', l[5]);
    }
    return el;
  }
  /* ---------------------------------------------------------- сборка
     у мира постер (появляется сразу) и видео-петля поверх него;
     играет только видео текущего мира */
  var layer = document.createElement('div');
  layer.className = 'worlds';
  layer.setAttribute('aria-hidden', 'true');
  var Perf = window.RyzhikovPerf;
  var tierNow = Perf ? Perf.tier() : 3;
  var canVideo = !window.matchMedia('(prefers-reduced-motion: reduce)').matches && tierNow >= 2;
  var scenes = SCN.map(function (sc) {
    var d = document.createElement('div');
    d.className = 'world-scene';
    d.innerHTML = '<div class="ws-fly"><div class="ws-par"><div class="ws-box"><div class="ws-img"></div></div></div></div><div class="ws-blur"></div>';
    d._blur = d.querySelector('.ws-blur');
    var box = d.querySelector('.ws-box');
    box.style.setProperty('--fx', sc.fx);
    box.style.setProperty('--fy', sc.fy);
    d._img = d.querySelector('.ws-img');
    d._box = box;
    d._name = sc.img;
    d._par = d.querySelector('.ws-par');
    layer.appendChild(d);
    return d;
  });
  function ensureImg(n) {
    var d = scenes[n];
    if (!d || d._loaded) return;
    d._loaded = true;
    var src = 'assets/worlds/' + d._name + '.jpg';
    var im = new Image();
    im.decoding = 'async';
    im.onload = function () { d._img.style.backgroundImage = 'url("' + src + '")'; d.classList.add('ready'); };
    im.src = src;
    d._blur.style.backgroundImage = 'url("assets/worlds/' + d._name + '-blur.jpg")';
    addVideo(d);
  }
  function addVideo(d) {
    if (canVideo && !d._vid && d._loaded) {
      var v = document.createElement('video');
      v.className = 'ws-vid';
      v.muted = true; v.loop = true; v.playsInline = true;
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('preload', 'auto');
      var s1 = document.createElement('source'); s1.src = 'assets/worlds/' + d._name + '.mp4'; s1.type = 'video/mp4';
      var s2 = document.createElement('source'); s2.src = 'assets/worlds/' + d._name + '.webm'; s2.type = 'video/webm';
      v.appendChild(s1); v.appendChild(s2);
      v.addEventListener('playing', function () { d.classList.add('vid'); });
      s2.addEventListener('error', function () { v.remove(); d._vid = null; });
      d._box.appendChild(v);
      d._vid = v;
    }
  }
  function dropVideo(d) {
    if (!d._vid) return;
    var v = d._vid;
    d._vid = null; d.classList.remove('vid');
    try { v.pause(); while (v.firstChild) v.removeChild(v.firstChild); v.removeAttribute('src'); v.load(); } catch (e) {}
    v.remove();
  }
  function dropVideos() { scenes.forEach(dropVideo); }
  // режим чтения: пока на экране текст, видео стоит, вместо него размытый кадр
  var reading = false;
  function playOnly(n) {
    scenes.forEach(function (d, i) {
      if (!d._vid) return;
      if (i === n && !reading) { var pr = d._vid.play(); if (pr && pr.catch) pr.catch(function () {}); }
      else if (i === n && reading) { var vv = d._vid; setTimeout(function () { if (reading && vv && !vv.paused) vv.pause(); }, 900); }
      else if (!d._vid.paused) {
        var v = d._vid;
        setTimeout(function () { if (i !== current && v && !v.paused) v.pause(); }, 1800);
      }
    });
  }
  var atmo = document.querySelector('.atmo');
  if (atmo && atmo.parentNode) atmo.parentNode.insertBefore(layer, atmo.nextSibling);

  // врата: фотореалистичные врата мира (вырезанные, с прозрачным проёмом)
  var GATES = {"sakura": {"r": 1.2115, "o": [0.3115, 0.391, 0.6885, 0.9193]}, "hell": {"r": 1.1667, "o": [0.3456, 0.2852, 0.6549, 0.9419]}, "greece": {"r": 1.3108, "o": [0.4108, 0.4885, 0.5897, 0.8991]}, "rome": {"r": 1.1665, "o": [0.3871, 0.4807, 0.6229, 0.9994]}, "north": {"r": 1.2207, "o": [0.3616, 0.4587, 0.6384, 0.9994]}, "egypt": {"r": 1.4349, "o": [0.4215, 0.4356, 0.579, 0.9987]}, "gold": {"r": 1.2484, "o": [0.3832, 0.3896, 0.6237, 0.9988]}, "neon": {"r": 1.1191, "o": [0.3113, 0.2485, 0.6882, 0.9994]}, "volcano": {"r": 1.2933, "o": [0.2862, 0.2402, 0.7152, 0.8006]}};
  document.querySelectorAll('.gate').forEach(function (gate) {
    var n = parseInt(gate.dataset.wi || gate.dataset.room, 10), th = T[n];
    if (!th) return;
    gate.dataset.world = th.id;
    var st = gate.style;
    st.setProperty('--door1', th.door[0]);
    st.setProperty('--door2', th.door[1]);
    st.setProperty('--door-line', th.door[2]);
    st.setProperty('--g1', th.tone);
    st.setProperty('--g2', th.tone2);
    var gd = GATES[th.id];
    var frame = gate.querySelector('.gate-frame');
    var svg = gate.querySelector('.gate-frame > svg');
    if (!gd || !frame) return;
    frame.classList.add('has-art');
    frame.style.setProperty('--gr', gd.r);
    frame.style.setProperty('--ox', (gd.o[0] * 100).toFixed(2) + '%');
    frame.style.setProperty('--oy', (gd.o[1] * 100).toFixed(2) + '%');
    frame.style.setProperty('--ow', ((gd.o[2] - gd.o[0]) * 100).toFixed(2) + '%');
    frame.style.setProperty('--oh', ((gd.o[3] - gd.o[1]) * 100).toFixed(2) + '%');
    var img = document.createElement('img');
    img.className = 'gate-art';
    img.alt = '';
    img.decoding = 'async';
    img.src = 'assets/gates/' + th.id + '.webp';
    if (svg) svg.replaceWith(img); else frame.appendChild(img);
  });

  /* ---------------------------------------------------------- частицы */
  var cv = document.createElement('canvas');
  cv.id = 'world-fx';
  cv.setAttribute('aria-hidden', 'true');
  layer.parentNode.insertBefore(cv, layer.nextSibling);
  var ctx = cv.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var vw = 0, vh = 0, dpr = 1, mobile = false;
  var parts = [];
  var mix = T[0].fx;
  var lastY = window.scrollY || 0;

  function resize() {
    vw = window.innerWidth; vh = window.innerHeight;
    // на больших мониторах частицы рисуем в пониженном разрешении: они мягкие, разницы не видно
    dpr = Math.min(1, Math.sqrt(1.5e6 / (vw * vh)));
    mobile = vw < 760;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
  }
  function pickType() {
    var sum = 0, i; for (i = 0; i < mix.length; i++) sum += mix[i][1];
    var x = Math.random() * sum;
    for (i = 0; i < mix.length; i++) { x -= mix[i][1]; if (x <= 0) return mix[i][0]; }
    return mix[0][0];
  }
  function spawn(p, anywhere) {
    var t = pickType();
    p.t = t; p.life = 1; p.fade = 0; p.ph = Math.random() * 10; p.rot = Math.random() * 6.28;
    p.x = Math.random() * vw;
    var fromTop = t === 'petal' || t === 'snow' || t === 'coin' || t === 'ash' || t === 'rain';
    var fromBottom = t === 'ember' || t === 'spark';
    p.y = anywhere ? Math.random() * vh : (fromTop ? -20 : fromBottom ? vh + 20 : Math.random() * vh);
    if (t === 'sand' && !anywhere) { p.x = -20; p.y = Math.random() * vh; }
    switch (t) {
      case 'petal': p.vx = 20 + Math.random() * 30; p.vy = 30 + Math.random() * 40; p.r = 5 + Math.random() * 6; p.c = Math.random() < .5 ? '255,183,213' : '255,140,190'; break;
      case 'ember': p.vx = (Math.random() - .5) * 20; p.vy = -(30 + Math.random() * 60); p.r = .8 + Math.random() * 2; p.c = Math.random() < .6 ? '255,140,40' : '255,210,90'; break;
      case 'dust': p.vx = (Math.random() - .5) * 8; p.vy = -(4 + Math.random() * 10); p.r = .6 + Math.random() * 1.6; p.c = '243,220,160'; break;
      case 'sand': p.vx = 60 + Math.random() * 80; p.vy = (Math.random() - .5) * 10; p.r = .6 + Math.random() * 1.4; p.c = '235,200,140'; break;
      case 'snow': p.vx = (Math.random() - .5) * 14; p.vy = 25 + Math.random() * 35; p.r = 1 + Math.random() * 2.6; p.c = '235,250,255'; break;
      case 'coin': p.vx = (Math.random() - .5) * 12; p.vy = 50 + Math.random() * 60; p.r = 5 + Math.random() * 4; p.c = '255,210,90'; break;
      case 'spark': p.vx = (Math.random() - .5) * 10; p.vy = -(40 + Math.random() * 70); p.r = 1 + Math.random() * 1.4; p.c = Math.random() < .5 ? '80,230,255' : '255,79,216'; break;
      case 'ash': p.vx = (Math.random() - .5) * 18; p.vy = 18 + Math.random() * 22; p.r = 1 + Math.random() * 2; p.c = '160,140,130'; break;
      case 'rain': p.vx = -60; p.vy = 700 + Math.random() * 400; p.r = 10 + Math.random() * 16; p.c = Math.random() < .3 ? '255,120,220' : '170,200,255'; break;
      case 'firefly': p.vx = (Math.random() - .5) * 16; p.vy = (Math.random() - .5) * 16; p.r = 1.2 + Math.random() * 1.6; p.c = '255,225,140'; break;
      case 'mote': p.vx = 4 + Math.random() * 10; p.vy = -(2 + Math.random() * 8); p.r = .6 + Math.random() * 1.2; p.c = '255,220,160'; break;
    }
    p.a = .35 + Math.random() * .55;
  }
  var PART = [0, .35, .6, 1];
  function initParts() {
    parts = [];
    var n = reduce ? 0 : Math.round((mobile ? 40 : 90) * PART[tierNow]);
    for (var i = 0; i < n; i++) { var p = {}; spawn(p, true); parts.push(p); }
  }

  function sprite(stops) {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    stops.forEach(function (st) { gr.addColorStop(st[0], st[1]); });
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return c;
  }
  var glowSprite = sprite([[0, 'rgba(255,225,140,1)'], [1, 'rgba(255,225,140,0)']]);
  var flameSprite = sprite([[0, 'rgba(255,245,210,.8)'], [.4, 'rgba(255,160,50,.5)'], [1, 'rgba(220,50,10,0)']]);

  // пламя над ценой: отдельный холст внутри блока цены
  var flames = [];
  function addFlameHost(host, intensity) {
    var c = document.createElement('canvas');
    c.className = 'price-fire';
    host.appendChild(c);
    var f = { host: host, c: c, x: c.getContext('2d'), list: [], k: intensity || 0, w: 0, h: 0 };
    flames.push(f);
    return f;
  }
  function sizeFlame(f) {
    var r = f.c.getBoundingClientRect();
    if (Math.abs(r.width - f.w) > 1 || Math.abs(r.height - f.h) > 1) {
      f.w = r.width; f.h = r.height;
      f.c.width = Math.round(r.width * dpr); f.c.height = Math.round(r.height * dpr);
    }
  }
  function stepFlame(f, dt) {
    var r = f.c.getBoundingClientRect();
    if (r.bottom < -100 || r.top > vh + 100) { f.list.length = 0; return; }
    sizeFlame(f);
    var n = Math.round((mobile ? 45 : 90) * f.k * dt * (tierNow >= 2 ? 1 : .5));
    for (var i = 0; i < n; i++) {
      f.list.push({ x: f.w * (.12 + Math.random() * .76), y: f.h * .78, vx: (Math.random() - .5) * 30, vy: -(80 + Math.random() * 140) * (.6 + f.k * .6), r: 6 + Math.random() * 16 * (.5 + f.k * .5), life: .5 + Math.random() * .7 });
    }
    var g = f.x;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, f.w, f.h);
    g.globalCompositeOperation = 'lighter';
    for (var j = f.list.length - 1; j >= 0; j--) {
      var p = f.list[j];
      p.life -= dt;
      if (p.life <= 0) { f.list.splice(j, 1); continue; }
      p.x += p.vx * dt + Math.sin((p.y + j) * .05) * .6; p.y += p.vy * dt; p.r *= 1 - dt * .55;
      g.globalAlpha = Math.min(1, p.life * 1.6);
      g.drawImage(flameSprite, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  var t = 0, last = 0, raf = null;
  var current = -1, enterY = 0, parY = 0;
  function frame(now) {
    var dt = Math.min(.05, (now - last) / 1000 || .016); last = now; t += dt;
    var y = window.scrollY || 0, dS = y - lastY; lastY = y;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    var pLimit = reading ? Math.ceil(parts.length * .3) : parts.length;
    for (var i = 0; i < pLimit; i++) {
      var p = parts[i];
      if (p.fade) { p.life -= dt * 1.4; if (p.life <= 0) { spawn(p, false); continue; } }
      p.x += (p.vx + Math.sin(t * 1.3 + p.ph) * (p.t === 'petal' ? 34 : p.t === 'firefly' ? 14 : 6)) * dt;
      if (p.t === 'firefly') p.y += Math.cos(t * 1.1 + p.ph) * 10 * dt;
      p.y += p.vy * dt - dS * (p.t === 'sand' ? .1 : .25);
      p.rot += dt * (p.t === 'coin' ? 4 : 1.6);
      if (p.y > vh + 30 || p.y < -40 || p.x > vw + 30 || p.x < -40) { spawn(p, false); continue; }
      var a = p.a * p.life;
      if (p.t === 'petal') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, .25 + .75 * Math.abs(Math.sin(p.rot * 1.3)));
        ctx.fillStyle = 'rgba(' + p.c + ',' + a.toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(-p.r, 0); ctx.quadraticCurveTo(0, -p.r * .8, p.r, -p.r * .1); ctx.quadraticCurveTo(p.r * .6, p.r * .25, p.r * .85, p.r * .45); ctx.quadraticCurveTo(0, p.r * .7, -p.r, 0); ctx.fill(); ctx.restore();
      } else if (p.t === 'coin') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.scale(Math.cos(p.rot), 1);
        ctx.fillStyle = 'rgba(255,214,98,' + a.toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(0, 0, p.r, 0, 6.2832); ctx.fill();
        ctx.strokeStyle = 'rgba(180,120,30,' + a.toFixed(3) + ')'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
      } else if (p.t === 'rain') {
        ctx.strokeStyle = 'rgba(' + p.c + ',' + (a * .45).toFixed(3) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.r * .08, p.y - p.r); ctx.stroke();
      } else if (p.t === 'firefly') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a * (.35 + .65 * Math.max(0, Math.sin(t * 2.4 + p.ph * 3)));
        ctx.drawImage(glowSprite, p.x - p.r * 5, p.y - p.r * 5, p.r * 10, p.r * 10);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      } else if (p.t === 'sand') {
        ctx.fillStyle = 'rgba(' + p.c + ',' + (a * .6).toFixed(3) + ')';
        ctx.fillRect(p.x, p.y, p.r * 4, p.r * .7);
      } else {
        var glow = p.t === 'ember' || p.t === 'spark';
        if (glow) ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(' + p.c + ',' + (a * (.6 + .4 * Math.sin(t * 3 + p.ph))).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
        if (glow) ctx.globalCompositeOperation = 'source-over';
      }
    }
    if (current >= 0 && scenes[current]) {
      var py = Math.max(-70, Math.min(70, -(y - enterY) * .05));
      var np = parY + (py - parY) * Math.min(1, dt * 4);
      if (Math.abs(np - parY) > .15) {
        parY = np;
        scenes[current]._par.style.transform = 'translate3d(0,' + parY.toFixed(1) + 'px,0)';
      }
    }
    for (var f = 0; f < flames.length; f++) if (flames[f].k > 0 || flames[f].list.length) stepFlame(flames[f], dt);
    raf = requestAnimationFrame(frame);
  }

  resize(); initParts();
  if (Perf) Perf.onChange(function (t) {
    tierNow = t;
    if (t < 2) { canVideo = false; dropVideos(); }
    initParts();
  });
  window.addEventListener('resize', function () { var m = mobile; resize(); if (m !== mobile) initParts(); }, { passive: true });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = null; }
    else if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  });
  last = performance.now(); raf = requestAnimationFrame(frame);

  /* ---------------------------------------------------------- API */
  var root = document.documentElement;
  window.RyzhikovWorlds = {
    themes: T,
    count: T.length,
    activate: function (n, instant) {
      n = Math.max(0, Math.min(T.length - 1, n | 0));
      if (n === current) return;
      var prev = current;
      current = n;
      enterY = window.scrollY || 0; parY = 0;
      var th = T[n];
      ensureImg(n); ensureImg(n + 1); if (n > 0) ensureImg(n - 1);
      // в памяти держим видео только текущего мира и соседей
      scenes.forEach(function (d, i) {
        if (Math.abs(i - n) > 1) dropVideo(d); else addVideo(d);
      });
      playOnly(n);
      scenes.forEach(function (s, i) {
        s.classList.toggle('on', i === n);
        s.classList.toggle('back', prev >= 0 && i === n && n < prev);
        if (i !== n) s._par.style.transform = '';
      });
      mix = th.fx;
      for (var i = 0; i < parts.length; i++) if (instant) spawn(parts[i], true); else parts[i].fade = 1;
      var vars = { '--tone': th.tone, '--tone2': th.tone2, '--bg-top': th.bg[0], '--bg-bot': th.bg[1], '--panel': th.panel[0], '--panel-d': th.panel[1] };
      for (var k in vars) root.style.setProperty(k, vars[k]);
      root.dataset.world = th.id;
      return th;
    },
    flame: addFlameHost,
    setReading: function (on) {
      on = !!on;
      if (on === reading) return;
      reading = on;
      layer.classList.toggle('is-reading', on);
      if (current >= 0) playOnly(current);
    },
    current: function () { return current; }
  };
})();
