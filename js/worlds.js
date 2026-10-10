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
    { id: 'sky', name: 'Небеса', bg: ['5,8,23', '3,5,13'], tone: '41,82,229', tone2: '212,166,74', panel: ['16,25,58', '7,11,28'],
      door: ['#0f1a40', '#070c22', '212,166,74'], fx: [['dust', 1]],
      dragon: { b1: '#1a2f78', b2: '#10205a', b3: '#070d24', edge: '#d4a64a', belly: '#f3d58a', scale: '#7b9bff', glow: '#4673ff', spine: '#d4a64a', eye: '#ffd77a' } },
    { id: 'sakura', name: 'Сад сакуры', bg: ['30,10,34', '8,3,12'], tone: '236,110,160', tone2: '255,190,215', panel: ['46,16,40', '16,5,16'],
      door: ['#5a0f22', '#2a0610', '255,170,200'], fx: [['petal', 1]],
      dragon: { b1: '#fbf1f6', b2: '#e4a9c6', b3: '#6e2a52', edge: '#ff9cc4', belly: '#fff0f6', scale: '#c64b86', glow: '#ff7fb6', spine: '#ff6fa5', eye: '#ff3d7f' } },
    { id: 'hell', name: 'Врата ада', bg: ['30,4,2', '6,1,1'], tone: '220,50,20', tone2: '255,140,40', panel: ['44,10,6', '14,3,2'],
      door: ['#5a1208', '#1e0402', '255,110,50'], fx: [['ember', 1]],
      dragon: { b1: '#4a0d07', b2: '#1e0403', b3: '#080101', edge: '#ff5a1e', belly: '#ff9a3c', scale: '#ff4a1a', glow: '#ff3c0a', spine: '#ff6e1e', eye: '#fff060' } },
    { id: 'greece', name: 'Эллада', bg: ['6,32,46', '2,10,16'], tone: '60,170,200', tone2: '235,215,160', panel: ['10,40,54', '4,14,20'],
      door: ['#123a4a', '#06161e', '239,227,191'], fx: [['dust', 1]],
      dragon: { b1: '#f5f1e6', b2: '#c9c1ad', b3: '#5a5446', edge: '#c9a55a', belly: '#f0d896', scale: '#8c8270', glow: '#b4e6ff', spine: '#d4af5f', eye: '#3fd0ff' } },
    { id: 'rome', name: 'Колизей', bg: ['44,18,8', '10,5,2'], tone: '220,120,40', tone2: '240,190,110', panel: ['52,24,10', '16,7,3'],
      door: ['#3a1e0a', '#140902', '240,192,112'], fx: [['sand', 1], ['ember', .25]],
      dragon: { b1: '#c27c32', b2: '#7a4416', b3: '#2a1406', edge: '#ffcd82', belly: '#ffdca0', scale: '#ffbe6e', glow: '#ff8c32', spine: '#e6b45a', eye: '#fff1c0' } },
    { id: 'north', name: 'Север', bg: ['3,26,28', '1,7,8'], tone: '60,230,170', tone2: '150,210,255', panel: ['8,36,40', '2,12,14'],
      door: ['#123236', '#051214', '159,232,255'], fx: [['snow', 1]],
      dragon: { b1: '#e6f9ff', b2: '#80c8e2', b3: '#1b4a63', edge: '#bef0ff', belly: '#e6faff', scale: '#5aaad2', glow: '#78f0ff', spine: '#a0e6ff', eye: '#7dffd2' } },
    { id: 'egypt', name: 'Египет', bg: ['10,15,42', '4,5,15'], tone: '60,90,200', tone2: '230,180,70', panel: ['16,22,60', '6,8,24'],
      door: ['#16205a', '#080c26', '240,196,80'], fx: [['sand', .7], ['dust', .5]],
      dragon: { b1: '#2f52d8', b2: '#1a2b8a', b3: '#0a1238', edge: '#f0c350', belly: '#f5d778', scale: '#f0c350', glow: '#5a82ff', spine: '#f0c350', eye: '#ffe28a' } },
    { id: 'gold', name: 'Эльдорадо', bg: ['4,26,16', '1,8,5'], tone: '40,180,110', tone2: '255,205,80', panel: ['8,38,24', '2,12,8'],
      door: ['#0a3a24', '#03140c', '255,210,90'], fx: [['coin', 1], ['dust', .5]],
      dragon: { b1: '#3ccc90', b2: '#147a52', b3: '#043020', edge: '#ffd75a', belly: '#ffe68c', scale: '#a0ffc8', glow: '#3cffa0', spine: '#ffcd50', eye: '#ffe066' } },
    { id: 'neon', name: 'Неоновый город', bg: ['18,6,42', '5,2,13'], tone: '150,80,255', tone2: '80,220,255', panel: ['26,10,58', '8,3,20'],
      door: ['#1c0a44', '#08031a', '80,230,255'], fx: [['spark', 1]],
      dragon: { b1: '#7432ff', b2: '#3a12a0', b3: '#12053a', edge: '#50e6ff', belly: '#78f0ff', scale: '#c88cff', glow: '#a05aff', spine: '#50e6ff', eye: '#5cf3ff' } },
    { id: 'volcano', name: 'Сердце вулкана', bg: ['34,9,3', '7,2,1'], tone: '255,90,20', tone2: '255,200,90', panel: ['46,14,6', '14,4,2'],
      door: ['#5e1a06', '#200702', '255,170,70'], fx: [['ember', 1], ['ash', .4]],
      dragon: { b1: '#ffd060', b2: '#e0761c', b3: '#5a1406', edge: '#fff0b4', belly: '#fff5c8', scale: '#ff7828', glow: '#ff7814', spine: '#ffdc78', eye: '#ffffff' } }
  ];

  /* ---------------------------------------------------------- декорации */
  function stars(r, n, col, yMax) {
    var s = '';
    for (var i = 0; i < n; i++) {
      var x = (r() * 1600).toFixed(0), y = (r() * (yMax || 520)).toFixed(0), rr = (r() * 1.3 + .4).toFixed(1);
      s += '<circle class="tw" style="animation-delay:' + (r() * 4).toFixed(2) + 's" cx="' + x + '" cy="' + y + '" r="' + rr + '" fill="' + col + '"/>';
    }
    return s;
  }
  function blossoms(r, pts, n) {
    var s = '', cols = ['#ffc4dc', '#ff9cc4', '#ffe0ec', '#ff7fb2'];
    for (var i = 0; i < n; i++) {
      var p = pts[Math.floor(r() * pts.length)];
      var x = p[0] + (r() - .5) * 90, y = p[1] + (r() - .5) * 60;
      s += '<circle cx="' + x.toFixed(0) + '" cy="' + y.toFixed(0) + '" r="' + (5 + r() * 11).toFixed(1) + '" fill="' + cols[i % 4] + '" opacity="' + (.55 + r() * .4).toFixed(2) + '"/>';
    }
    return s;
  }

  var SCENES = [
    // 0 · небеса
    function () {
      var r = rng(11);
      return '<defs><radialGradient id="s0m"><stop offset="0" stop-color="#f3e7c4" stop-opacity=".45"/><stop offset="1" stop-color="#f3e7c4" stop-opacity="0"/></radialGradient></defs>' +
        stars(r, 90, '#cfd8ff') +
        '<circle cx="1260" cy="170" r="190" fill="url(#s0m)"/><circle cx="1260" cy="170" r="58" fill="#efe6c8" opacity=".9"/>' +
        '<g class="drift"><ellipse cx="300" cy="300" rx="320" ry="40" fill="#8aa0ff" opacity=".06"/><ellipse cx="1100" cy="380" rx="380" ry="46" fill="#8aa0ff" opacity=".05"/></g>' +
        '<path d="M0 900 L0 640 L160 560 L300 620 L470 500 L620 600 L780 520 L960 610 L1120 500 L1300 600 L1450 540 L1600 610 L1600 900Z" fill="#0b1434"/>' +
        '<path d="M0 900 L0 740 L220 680 L420 760 L640 690 L880 770 L1100 700 L1340 770 L1600 700 L1600 900Z" fill="#060b1f"/>';
    },
    // 1 · сакура
    function () {
      var r = rng(21);
      var pag = '';
      for (var i = 0; i < 5; i++) {
        var w = 150 - i * 22, y = 770 - i * 52, x = 1380;
        pag += '<rect x="' + (x - w * .3) + '" y="' + (y - 30) + '" width="' + (w * .6) + '" height="30" fill="#0c0410"/>' +
          '<path d="M' + (x - w / 2 - 14) + ' ' + (y - 26) + ' Q' + x + ' ' + (y - 44) + ' ' + (x + w / 2 + 14) + ' ' + (y - 26) + ' L' + (x + w / 2) + ' ' + (y - 16) + ' L' + (x - w / 2) + ' ' + (y - 16) + 'Z" fill="#0c0410"/>';
      }
      var bl = [[60, 120], [180, 130], [300, 110], [420, 150], [540, 150], [620, 120], [260, 60], [480, 210]];
      var br = [[1560, 90], [1440, 110], [1320, 80], [1220, 130], [1380, 170]];
      return '<defs><radialGradient id="s1m"><stop offset="0" stop-color="#ffd9e6" stop-opacity=".5"/><stop offset="1" stop-color="#ffd9e6" stop-opacity="0"/></radialGradient></defs>' +
        stars(r, 50, '#ffd6e8', 400) +
        '<circle cx="1120" cy="250" r="260" fill="url(#s1m)"/><circle cx="1120" cy="250" r="110" fill="#ffdbe8" opacity=".8"/>' +
        '<path d="M180 900 L700 430 Q760 395 820 430 L1340 900Z" fill="#2a1030"/>' +
        '<path d="M640 486 L700 430 Q760 395 820 430 L880 486 L842 470 L806 500 L770 466 L734 502 L700 470Z" fill="#ffe3ef" opacity=".55"/>' +
        '<path d="M0 900 L0 760 Q300 700 600 770 T1200 760 T1600 740 L1600 900Z" fill="#14061a"/>' + pag +
        '<g class="sway"><path d="M-30 110 C150 140 260 90 380 150 S560 160 660 120 M300 120 C320 80 260 50 250 30 M500 150 C520 190 480 220 470 240" stroke="#2a0e18" stroke-width="12" fill="none" stroke-linecap="round"/>' + blossoms(r, bl, 70) + '</g>' +
        '<g class="sway2"><path d="M1640 80 C1500 100 1420 90 1300 70 S1200 120 1180 140 M1400 90 C1390 140 1370 160 1360 180" stroke="#2a0e18" stroke-width="11" fill="none" stroke-linecap="round"/>' + blossoms(r, br, 45) + '</g>';
    },
    // 2 · ад
    function () {
      return '<defs><linearGradient id="s2l" x1="0" x2="1"><stop offset="0" stop-color="#ff3a0a"/><stop offset=".5" stop-color="#ffb02a"/><stop offset="1" stop-color="#ff3a0a"/></linearGradient>' +
        '<radialGradient id="s2g" cx=".5" cy="1" r=".8"><stop offset="0" stop-color="#ff4010" stop-opacity=".45"/><stop offset="1" stop-color="#ff4010" stop-opacity="0"/></radialGradient></defs>' +
        '<rect width="1600" height="900" fill="url(#s2g)"/>' +
        '<path d="M0 900 L0 520 L60 600 L110 380 L170 560 L240 300 L300 540 L360 420 L430 620 L520 460 L600 640 L1000 640 L1080 470 L1160 600 L1230 360 L1300 560 L1360 280 L1430 540 L1500 400 L1560 600 L1600 480 L1600 900Z" fill="#2a0504"/>' +
        '<path d="M0 900 L0 700 L90 640 L150 760 L260 620 L330 780 L460 700 L560 800 L1040 800 L1150 690 L1260 780 L1360 640 L1460 760 L1600 660 L1600 900Z" fill="#120101"/>' +
        '<rect class="lava" y="815" width="1600" height="90" fill="url(#s2l)" opacity=".85"/>' +
        '<g class="lava" stroke="#ff6a1e" stroke-width="3" fill="none" opacity=".8"><path d="M240 300 L250 420 L230 520"/><path d="M1360 280 L1350 400 L1372 520"/><path d="M110 380 L120 480"/><path d="M1230 360 L1220 470"/></g>';
    },
    // 3 · эллада
    function () {
      var r = rng(31), cols = '';
      for (var i = 0; i < 8; i++) {
        var x = 930 + i * 58;
        cols += '<rect x="' + x + '" y="430" width="24" height="150" fill="#d8d0bb" opacity=".2" stroke="#f0e6c8" stroke-opacity=".5"/><rect x="' + (x - 4) + '" y="422" width="32" height="10" fill="#f0e6c8" opacity=".35"/>';
      }
      var sh = '';
      for (var j = 0; j < 26; j++) sh += '<rect class="tw" style="animation-delay:' + (r() * 3).toFixed(2) + 's" x="' + (r() * 1600).toFixed(0) + '" y="' + (680 + r() * 200).toFixed(0) + '" width="' + (20 + r() * 60).toFixed(0) + '" height="2" fill="#bfefff" opacity=".35"/>';
      var leaves = '';
      for (var k = 0; k < 18; k++) {
        var lx = 1300 + k * 18 + r() * 20, ly = 90 + Math.sin(k) * 20 + r() * 30;
        leaves += '<ellipse cx="' + lx.toFixed(0) + '" cy="' + ly.toFixed(0) + '" rx="22" ry="7" transform="rotate(' + (r() * 80 - 40).toFixed(0) + ' ' + lx.toFixed(0) + ' ' + ly.toFixed(0) + ')" fill="#7f9a62" opacity=".55"/>';
      }
      return '<defs><linearGradient id="s3s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d4a5c"/><stop offset="1" stop-color="#03121a"/></linearGradient>' +
        '<radialGradient id="s3m"><stop offset="0" stop-color="#e9f6ff" stop-opacity=".4"/><stop offset="1" stop-color="#e9f6ff" stop-opacity="0"/></radialGradient></defs>' +
        stars(r, 70, '#e6f7ff', 520) +
        '<circle cx="330" cy="200" r="200" fill="url(#s3m)"/><circle cx="330" cy="200" r="64" fill="#f0f6ff" opacity=".85"/>' +
        '<rect y="660" width="1600" height="240" fill="url(#s3s)"/>' + sh +
        '<path d="M700 900 L760 640 Q1150 560 1560 640 L1600 900Z" fill="#06171e"/>' +
        '<rect x="900" y="580" width="500" height="14" fill="#f0e6c8" opacity=".35"/><rect x="890" y="594" width="520" height="12" fill="#f0e6c8" opacity=".25"/>' + cols +
        '<rect x="912" y="398" width="476" height="26" fill="#f0e6c8" opacity=".3"/><path d="M902 398 L1150 330 L1398 398Z" fill="#f0e6c8" opacity=".28"/>' +
        '<g class="sway2"><path d="M1640 70 Q1460 90 1290 110" stroke="#3a3420" stroke-width="5" fill="none"/>' + leaves + '</g>';
    },
    // 4 · колизей
    function () {
      var r = rng(41), tiers = '';
      for (var t = 0; t < 3; t++) {
        var y = 600 - t * 105, x0 = 240 + t * 30, x1 = 1360 - t * 30 - (t === 2 ? 260 : 0);
        tiers += '<rect x="' + x0 + '" y="' + (y - 10) + '" width="' + (x1 - x0) + '" height="115" fill="#2b1608"/><rect x="' + x0 + '" y="' + (y - 18) + '" width="' + (x1 - x0) + '" height="10" fill="#4a2810"/>';
        for (var x = x0 + 22; x < x1 - 40; x += 62) {
          tiers += '<path class="torch" style="animation-delay:' + (r() * 3).toFixed(2) + 's" d="M' + x + ' ' + (y + 95) + ' L' + x + ' ' + (y + 30) + ' Q' + (x + 19) + ' ' + (y + 6) + ' ' + (x + 38) + ' ' + (y + 30) + ' L' + (x + 38) + ' ' + (y + 95) + 'Z" fill="#ff9a3c" opacity="' + (.25 + r() * .5).toFixed(2) + '"/>';
        }
      }
      var cyp = '';
      [110, 170, 1440, 1500, 1540].forEach(function (cx, i) { cyp += '<ellipse cx="' + cx + '" cy="' + (720 - i % 2 * 30) + '" rx="26" ry="' + (170 + i % 2 * 30) + '" fill="#120802"/>'; });
      return '<defs><linearGradient id="s4d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a1a0c" stop-opacity="0"/><stop offset="1" stop-color="#ff7a2a" stop-opacity=".35"/></linearGradient></defs>' +
        stars(r, 40, '#ffe6c8', 300) +
        '<rect width="1600" height="900" fill="url(#s4d)"/><circle cx="400" cy="560" r="110" fill="#ff9a4a" opacity=".3"/>' +
        tiers + '<rect x="200" y="700" width="1200" height="200" fill="#1a0c04"/>' + cyp +
        '<path d="M0 900 L0 820 Q400 790 800 820 T1600 810 L1600 900Z" fill="#0a0502"/>';
    },
    // 5 · север
    function () {
      var r = rng(51), pines = '';
      for (var i = 0; i < 34; i++) {
        var x = i * 50 + r() * 20, h = 70 + r() * 80, y = 900;
        pines += '<path d="M' + x + ' ' + y + ' L' + (x + 24) + ' ' + (y - h) + ' L' + (x + 48) + ' ' + y + 'Z" fill="#031012"/>';
      }
      return '<defs><linearGradient id="s5a" x1="0" x2="1"><stop offset="0" stop-color="#3cffa0" stop-opacity="0"/><stop offset=".4" stop-color="#3cffa0"/><stop offset=".7" stop-color="#3cc8ff"/><stop offset="1" stop-color="#a05aff" stop-opacity="0"/></linearGradient></defs>' +
        stars(r, 110, '#e8fbff', 600) +
        '<g class="aurora a1"><path d="M-100 220 C200 120 500 300 800 180 S1400 120 1700 240" stroke="url(#s5a)" stroke-width="90" fill="none" opacity=".22" stroke-linecap="round"/></g>' +
        '<g class="aurora a2"><path d="M-100 320 C300 220 600 380 900 260 S1400 240 1700 330" stroke="url(#s5a)" stroke-width="60" fill="none" opacity=".18" stroke-linecap="round"/></g>' +
        '<path d="M0 900 L0 620 L180 480 L320 590 L520 400 L700 580 L880 440 L1080 600 L1260 430 L1440 560 L1600 470 L1600 900Z" fill="#0a1d22"/>' +
        '<path d="M520 400 L470 450 L500 445 L520 470 L545 440 L575 455Z M1260 430 L1215 475 L1245 468 L1262 490 L1285 462 L1312 476Z M180 480 L145 512 L172 508 L190 525 L210 505Z" fill="#cfefff" opacity=".5"/>' +
        pines;
    },
    // 6 · египет
    function () {
      var r = rng(61);
      return stars(r, 140, '#fff4d6', 560) +
        '<path d="M1290 120 A70 70 0 1 0 1340 230 A56 56 0 1 1 1290 120Z" fill="#fff0c8" opacity=".85"/>' +
        '<path d="M380 900 L760 420 L1140 900Z" fill="#141533"/><path d="M760 420 L1140 900 L900 900Z" fill="#2a2a55" opacity=".9"/>' +
        '<path d="M1040 900 L1270 600 L1500 900Z" fill="#11122c"/><path d="M1270 600 L1500 900 L1350 900Z" fill="#24244c"/>' +
        '<path d="M120 900 L300 660 L480 900Z" fill="#101129"/>' +
        '<path d="M0 900 L0 800 Q300 740 700 810 T1600 780 L1600 900Z" fill="#0c0d24"/><path d="M0 900 L0 850 Q500 820 900 860 T1600 850 L1600 900Z" fill="#07081a"/>' +
        '<path d="M760 420 L740 448 L780 448Z" fill="#f0c350" opacity=".8"/>';
    },
    // 7 · эльдорадо
    function () {
      var r = rng(71), rays = '', steps = '', leaves = '';
      for (var i = 0; i < 18; i++) rays += '<path d="M800 520 L' + (800 + Math.cos(i / 18 * Math.PI * 2) * 1400).toFixed(0) + ' ' + (520 + Math.sin(i / 18 * Math.PI * 2) * 1400).toFixed(0) + ' L' + (800 + Math.cos((i + .45) / 18 * Math.PI * 2) * 1400).toFixed(0) + ' ' + (520 + Math.sin((i + .45) / 18 * Math.PI * 2) * 1400).toFixed(0) + 'Z" fill="#ffd25a" opacity=".045"/>';
      for (var s = 0; s < 6; s++) { var w = 900 - s * 110; steps += '<rect x="' + (800 - w / 2) + '" y="' + (840 - s * 62) + '" width="' + w + '" height="62" fill="#06301c" stroke="#ffd25a" stroke-opacity=".3"/>'; }
      [[60, 820, -30], [180, 860, 20], [1520, 820, 30], [1420, 870, -20], [100, 700, -60], [1500, 700, 60]].forEach(function (l) {
        leaves += '<path d="M' + l[0] + ' ' + l[1] + ' q60 -160 0 -300 q-60 140 0 300Z" transform="rotate(' + l[2] + ' ' + l[0] + ' ' + l[1] + ')" fill="#031a0e"/>';
      });
      return '<g class="rays">' + rays + '</g>' + stars(r, 40, '#fff1b8', 380) + steps +
        '<rect x="700" y="400" width="200" height="88" fill="#06301c" stroke="#ffd25a" stroke-opacity=".5"/><rect class="torch" x="775" y="430" width="50" height="58" fill="#ffd25a" opacity=".6"/>' + leaves;
    },
    // 8 · неоновый город
    function () {
      var r = rng(81), city = '', grid = '';
      for (var x = 0; x < 1600; x += 48 + Math.floor(r() * 40)) {
        var h = 120 + r() * 260, w = 40 + r() * 50;
        city += '<rect x="' + x + '" y="' + (760 - h).toFixed(0) + '" width="' + w.toFixed(0) + '" height="' + h.toFixed(0) + '" fill="#0c0420"/>';
        for (var wy = 760 - h + 14; wy < 750; wy += 22) for (var wx = x + 8; wx < x + w - 8; wx += 14)
          if (r() < .32) city += '<rect class="' + (r() < .2 ? 'tw' : '') + '" x="' + wx.toFixed(0) + '" y="' + wy.toFixed(0) + '" width="6" height="8" fill="' + (r() < .5 ? '#50e6ff' : '#ff4fd8') + '" opacity="' + (.35 + r() * .5).toFixed(2) + '"/>';
      }
      for (var g = 0; g < 9; g++) { var gy = 770 + Math.pow(g / 8, 2) * 130; grid += '<line x1="0" y1="' + gy.toFixed(0) + '" x2="1600" y2="' + gy.toFixed(0) + '"/>'; }
      for (var v = -10; v <= 10; v++) grid += '<line x1="800" y1="760" x2="' + (800 + v * 200) + '" y2="900"/>';
      return '<defs><linearGradient id="s8s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffcf5a"/><stop offset=".55" stop-color="#ff4fd8"/><stop offset="1" stop-color="#7a2cff"/></linearGradient></defs>' +
        stars(r, 60, '#e2d6ff', 360) +
        '<circle cx="800" cy="520" r="230" fill="url(#s8s)" opacity=".7"/>' +
        '<g fill="#12062a"><rect x="560" y="560" width="480" height="10"/><rect x="560" y="600" width="480" height="14"/><rect x="560" y="645" width="480" height="18"/><rect x="560" y="695" width="480" height="22"/></g>' +
        city + '<rect y="760" width="1600" height="140" fill="#08021a"/><g class="gridfloor" stroke="#b05cff" stroke-opacity=".4" stroke-width="1.5">' + grid + '</g>';
    },
    // 9 · вулкан
    function () {
      return '<defs><linearGradient id="s9l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset=".4" stop-color="#ff7a1a"/><stop offset="1" stop-color="#ff2a0a" stop-opacity=".2"/></linearGradient>' +
        '<radialGradient id="s9g" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#ff5a14" stop-opacity=".45"/><stop offset="1" stop-color="#ff5a14" stop-opacity="0"/></radialGradient></defs>' +
        '<rect width="1600" height="900" fill="url(#s9g)"/>' +
        '<path d="M0 900 L0 700 L300 620 L520 720 L1100 720 L1320 610 L1600 690 L1600 900Z" fill="#0d0402"/>' +
        '<path d="M180 900 L700 380 L760 402 L840 378 L900 400 L1420 900Z" fill="#1a0703"/>' +
        '<ellipse class="lava" cx="800" cy="390" rx="110" ry="22" fill="#ff8a2a"/>' +
        '<g class="lava" fill="none" stroke="url(#s9l)" stroke-linecap="round"><path d="M760 400 C740 520 700 600 660 760" stroke-width="14"/><path d="M840 396 C860 500 920 640 980 820" stroke-width="10"/><path d="M800 402 C805 520 790 640 800 760" stroke-width="7"/></g>' +
        '<g class="smoke"><ellipse cx="780" cy="300" rx="120" ry="50" fill="#3a2a26" opacity=".35"/><ellipse cx="860" cy="220" rx="160" ry="60" fill="#2a1e1c" opacity=".3"/><ellipse cx="740" cy="150" rx="200" ry="70" fill="#1e1614" opacity=".25"/></g>';
    }
  ];

  /* ---------------------------------------------------------- врата миров
     у всех один и тот же проём: x 160-600, y 208-621 */
  var G = {
    sky: null,
    sakura: function () {
      return '<g stroke="#ffb3c8" stroke-width="2" stroke-linejoin="round">' +
        '<rect x="126" y="150" width="34" height="490" fill="#a3162a"/><rect x="600" y="150" width="34" height="490" fill="#a3162a"/>' +
        '<path d="M30 112 Q380 150 730 112 L712 158 Q380 182 48 158Z" fill="#a3162a"/>' +
        '<rect x="62" y="158" width="636" height="18" fill="#2a0610"/>' +
        '<rect x="96" y="200" width="568" height="22" fill="#a3162a"/>' +
        '<rect x="346" y="168" width="68" height="66" fill="#2a0610"/></g>' +
        '<text x="380" y="214" text-anchor="middle" font-family="\'Noto Serif SC\',serif" font-weight="700" font-size="38" fill="#ffd9e6">龍</text>' +
        blossoms(rng(5), [[40, 110], [90, 125], [720, 110], [670, 125]], 30);
    },
    hell: function () {
      return '<path d="M104 640 L104 270 L56 206 L132 214 L150 120 L222 172 L284 64 L336 150 L380 30 L424 150 L476 64 L538 172 L610 120 L628 214 L704 206 L656 270 L656 640Z" fill="#120202" stroke="#ff5a1e" stroke-width="2.5" stroke-linejoin="round"/>' +
        '<rect x="160" y="208" width="440" height="413" fill="none" stroke="#ff8a3c" stroke-opacity=".6"/>' +
        '<circle cx="380" cy="128" r="30" fill="#1e0403" stroke="#ff5a1e" stroke-width="2"/><circle class="lava" cx="369" cy="124" r="6" fill="#ffd040"/><circle class="lava" cx="391" cy="124" r="6" fill="#ffd040"/>' +
        '<path d="M368 142 L372 150 L376 142 L380 150 L384 142 L388 150 L392 142" stroke="#ff5a1e" fill="none"/>' +
        '<g class="lava" stroke="#ff7a28" stroke-width="2" fill="none"><path d="M120 300 L138 360 L124 420 L140 500"/><path d="M640 320 L622 380 L638 460 L620 540"/></g>';
    },
    greece: function () {
      var c = '';
      [92, 126, 602, 636].forEach(function (x) {
        c += '<rect x="' + x + '" y="232" width="32" height="389" fill="#0c2a36"/><rect x="' + (x - 6) + '" y="222" width="44" height="12"/>';
        for (var f = 1; f < 4; f++) c += '<line x1="' + (x + f * 8) + '" y1="240" x2="' + (x + f * 8) + '" y2="615" stroke-opacity=".45"/>';
      });
      return '<g fill="#0c2a36" stroke="#efe3bf" stroke-width="1.6">' + c +
        '<rect x="74" y="188" width="612" height="34"/><path d="M62 188 L380 92 L698 188Z"/>' +
        '<rect x="80" y="621" width="600" height="10"/><rect x="66" y="631" width="628" height="10"/></g>' +
        '<circle cx="380" cy="150" r="14" fill="none" stroke="#efe3bf"/><path d="M366 150 H394 M380 136 V164" stroke="#efe3bf" stroke-opacity=".6"/>';
    },
    rome: function () {
      return '<g fill="#2a1708" stroke="#f0c070" stroke-width="1.8" stroke-linejoin="round">' +
        '<rect x="70" y="40" width="620" height="54"/>' +
        '<path d="M100 640 L100 94 L660 94 L660 640 L600 640 L600 208 Q600 104 380 104 Q160 104 160 208 L160 640Z"/>' +
        '<path d="M354 104 L406 104 L398 140 L362 140Z" fill="#4a2810"/>' +
        '<rect x="108" y="220" width="20" height="400" fill="#3a2010"/><rect x="632" y="220" width="20" height="400" fill="#3a2010"/></g>' +
        '<text x="380" y="78" text-anchor="middle" font-family="Georgia,serif" font-size="26" letter-spacing="8" fill="#f6d79a">RYZHIKOV · ACADEMIA</text>';
    },
    north: function () {
      return '<g fill="#10201f" stroke="#9fe8ff" stroke-width="1.8" stroke-linejoin="round">' +
        '<rect x="118" y="160" width="42" height="480"/><rect x="600" y="160" width="42" height="480"/>' +
        '<rect x="96" y="176" width="568" height="32"/>' +
        '<path d="M60 230 L380 40 L700 230 L676 240 L380 66 L84 240Z"/></g>' +
        '<g fill="none" stroke="#9fe8ff" stroke-width="3" stroke-linecap="round"><path d="M60 230 C30 200 40 160 80 170 C100 176 96 200 76 200"/><path d="M700 230 C730 200 720 160 680 170 C660 176 664 200 684 200"/></g>' +
        '<g stroke="#9fe8ff" stroke-opacity=".7" stroke-width="2"><path d="M132 260 L146 280 L132 300 M132 340 L146 340 L139 360 M139 400 V440 L150 424"/><path d="M614 260 L628 280 L614 300 M621 340 V380 L632 364 M614 420 L628 440"/></g>';
    },
    egypt: function () {
      return '<g fill="#0d1436" stroke="#f0c450" stroke-width="1.8" stroke-linejoin="round">' +
        '<path d="M30 640 L160 640 L160 150 L66 170Z"/><path d="M730 640 L600 640 L600 150 L694 170Z"/>' +
        '<rect x="150" y="150" width="460" height="58"/></g>' +
        '<g fill="#f0c450"><circle cx="380" cy="179" r="16"/><path d="M362 179 C320 160 280 168 236 160 C280 182 320 188 362 184Z M398 179 C440 160 480 168 524 160 C480 182 440 188 398 184Z" opacity=".9"/></g>' +
        '<g stroke="#f0c450" stroke-opacity=".6" fill="none" stroke-width="1.6"><path d="M98 260 h30 M113 245 v30 M98 330 q15 -18 30 0 q-15 18 -30 0 M106 400 h22 v30"/><path d="M640 260 h30 M655 245 v30 M640 330 q15 -18 30 0 q-15 18 -30 0 M648 400 h22 v30"/></g>';
    },
    gold: function () {
      var s = '';
      for (var i = 0; i < 4; i++) {
        var o = i * 22;
        s += '<path d="M' + (160 - o - 22) + ' 640 V' + (208 - o - 22) + ' H' + (600 + o + 22) + ' V640" fill="none" stroke="#ffd25a" stroke-opacity="' + (.8 - i * .15) + '" stroke-width="' + (6 - i) + '"/>';
      }
      return '<rect x="70" y="100" width="620" height="540" fill="#052014"/>' + s +
        '<g fill="#ffd25a"><rect x="350" y="112" width="60" height="44"/><rect x="330" y="96" width="100" height="14"/></g>' +
        '<g fill="#052014"><rect x="362" y="124" width="12" height="10"/><rect x="386" y="124" width="12" height="10"/><rect x="368" y="142" width="24" height="6"/></g>';
    },
    neon: function () {
      return '<g fill="none" stroke-linejoin="round">' +
        '<path d="M120 640 V190 Q120 130 180 130 H580 Q640 130 640 190 V640" stroke="#ff4fd8" stroke-width="5" class="neonA"/>' +
        '<path d="M140 640 V200 Q140 150 190 150 H570 Q620 150 620 200 V640" stroke="#50e6ff" stroke-width="3" class="neonB"/>' +
        '<path d="M120 300 H60 V240 M120 420 H40 M640 300 H700 V240 M640 470 H720 M380 130 V70 M300 130 V96 H250 M460 130 V96 H510" stroke="#50e6ff" stroke-width="2" opacity=".75"/></g>' +
        '<g fill="#50e6ff"><circle cx="60" cy="240" r="5"/><circle cx="40" cy="420" r="5"/><circle cx="700" cy="240" r="5"/><circle cx="720" cy="470" r="5"/><circle cx="380" cy="70" r="6"/><circle cx="250" cy="96" r="4"/><circle cx="510" cy="96" r="4"/></g>';
    },
    volcano: function () {
      return '<path d="M80 640 L96 300 L70 240 L130 160 L120 110 L200 90 L260 40 L360 70 L430 30 L520 80 L600 70 L650 140 L700 200 L670 280 L690 640Z" fill="#1a0703" stroke="#ff8a2a" stroke-width="2.2" stroke-linejoin="round"/>' +
        '<rect x="160" y="208" width="440" height="413" fill="none" stroke="#ffb05a" stroke-opacity=".6"/>' +
        '<g class="lava" fill="none" stroke="#ff9a2a" stroke-width="5" stroke-linecap="round"><path d="M260 40 C250 80 270 120 250 170"/><path d="M520 80 C530 120 510 150 525 190"/><path d="M96 300 C110 360 100 420 112 480"/><path d="M670 280 C660 340 672 400 660 470"/></g>' +
        '<text x="380" y="160" text-anchor="middle" font-family="\'Noto Serif SC\',serif" font-weight="700" font-size="44" fill="#ffdc78" class="lava">龍</text>';
    }
  };

  /* ---------------------------------------------------------- сборка */
  var layer = document.createElement('div');
  layer.className = 'worlds';
  layer.setAttribute('aria-hidden', 'true');
  var scenes = SCENES.map(function (fn, i) {
    var d = document.createElement('div');
    d.className = 'world-scene';
    d.innerHTML = '<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice">' + fn() + '</svg>';
    layer.appendChild(d);
    return d;
  });
  var atmo = document.querySelector('.atmo');
  if (atmo && atmo.parentNode) atmo.parentNode.insertBefore(layer, atmo.nextSibling);

  // врата: свой рисунок и цвета у каждого мира
  document.querySelectorAll('.gate').forEach(function (gate) {
    var n = parseInt(gate.dataset.room, 10), th = T[n];
    if (!th) return;
    gate.dataset.world = th.id;
    var st = gate.style;
    st.setProperty('--door1', th.door[0]);
    st.setProperty('--door2', th.door[1]);
    st.setProperty('--door-line', th.door[2]);
    st.setProperty('--g1', th.tone);
    st.setProperty('--g2', th.tone2);
    var fn = G[th.id];
    var svg = gate.querySelector('.gate-frame > svg');
    if (fn && svg) {
      svg.setAttribute('viewBox', '0 0 760 640');
      svg.innerHTML = fn();
    }
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
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
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
    var fromTop = t === 'petal' || t === 'snow' || t === 'coin' || t === 'ash';
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
    }
    p.a = .35 + Math.random() * .55;
  }
  function initParts() {
    parts = [];
    var n = reduce ? 0 : (mobile ? 46 : 96);
    for (var i = 0; i < n; i++) { var p = {}; spawn(p, true); parts.push(p); }
  }

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
    var n = Math.round((mobile ? 70 : 140) * f.k * dt);
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
      var k = Math.min(1, p.life * 1.6);
      var gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      gr.addColorStop(0, 'rgba(255,245,210,' + (.75 * k).toFixed(3) + ')');
      gr.addColorStop(.4, 'rgba(255,160,50,' + (.5 * k).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(220,50,10,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.2832); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }

  var t = 0, last = 0, raf = null;
  function frame(now) {
    var dt = Math.min(.05, (now - last) / 1000 || .016); last = now; t += dt;
    var y = window.scrollY || 0, dS = y - lastY; lastY = y;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.fade) { p.life -= dt * 1.4; if (p.life <= 0) { spawn(p, false); continue; } }
      p.x += (p.vx + Math.sin(t * 1.3 + p.ph) * (p.t === 'petal' ? 26 : 6)) * dt;
      p.y += p.vy * dt - dS * (p.t === 'sand' ? .1 : .25);
      p.rot += dt * (p.t === 'coin' ? 4 : 1.6);
      if (p.y > vh + 30 || p.y < -40 || p.x > vw + 30 || p.x < -40) { spawn(p, false); continue; }
      var a = p.a * p.life;
      if (p.t === 'petal') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, .55 + .45 * Math.sin(p.rot * 1.7));
        ctx.fillStyle = 'rgba(' + p.c + ',' + a.toFixed(3) + ')';
        ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * .6, 0, 0, 6.2832); ctx.fill(); ctx.restore();
      } else if (p.t === 'coin') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.scale(Math.cos(p.rot), 1);
        ctx.fillStyle = 'rgba(255,214,98,' + a.toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(0, 0, p.r, 0, 6.2832); ctx.fill();
        ctx.strokeStyle = 'rgba(180,120,30,' + a.toFixed(3) + ')'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
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
    for (var f = 0; f < flames.length; f++) if (flames[f].k > 0 || flames[f].list.length) stepFlame(flames[f], dt);
    raf = requestAnimationFrame(frame);
  }

  resize(); initParts();
  window.addEventListener('resize', function () { var m = mobile; resize(); if (m !== mobile) initParts(); }, { passive: true });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = null; }
    else if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  });
  last = performance.now(); raf = requestAnimationFrame(frame);

  /* ---------------------------------------------------------- API */
  var current = -1;
  var root = document.documentElement;
  window.RyzhikovWorlds = {
    themes: T,
    count: T.length,
    activate: function (n, instant) {
      n = Math.max(0, Math.min(T.length - 1, n | 0));
      if (n === current) return;
      current = n;
      var th = T[n];
      scenes.forEach(function (s, i) { s.classList.toggle('on', i === n); });
      mix = th.fx;
      for (var i = 0; i < parts.length; i++) if (instant) spawn(parts[i], true); else parts[i].fade = 1;
      var vars = { '--tone': th.tone, '--tone2': th.tone2, '--bg-top': th.bg[0], '--bg-bot': th.bg[1], '--panel': th.panel[0], '--panel-d': th.panel[1] };
      if (window.gsap && !instant) window.gsap.to(root, Object.assign({ duration: 1.6, ease: 'power2.out' }, vars));
      else for (var k in vars) root.style.setProperty(k, vars[k]);
      root.dataset.world = th.id;
      return th;
    },
    flame: addFlameHost,
    current: function () { return current; }
  };
})();
