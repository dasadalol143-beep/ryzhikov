#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import re, io, sys

SRC = "/home/user/ryzhikov/site/index.html"
OUT = "/home/user/ryzhikov/site/presentation.html"
html = io.open(SRC, encoding="utf-8").read()

S = re.DOTALL

# ---------- static replacements for the animated "dragon" scenes ----------
HERO = '''<section class="blk" id="hero">
  <div class="wrap">
    <span class="eyebrow" data-r>Пётр Рыжиков · партнёрки банков</span>
    <h1 class="h1" data-r>Научись делать <em style="font-style:normal;color:var(--kob)">14&nbsp;000&nbsp;₽ в&nbsp;день</em> вместе со&nbsp;мной.</h1>
    <p class="lead" data-r style="max-width:30em">Хоть параллельно с работой. Партнёрки платят за новых клиентов, и 14&nbsp;000&nbsp;₽ — это всего один оффер.</p>
    <div class="flow" data-r style="margin-top:30px;max-width:520px">
      <div class="nf"><i>₽</i><div><b>Партнёрка · выплата</b><span>Альфа-Банк · регистрация ИП</span></div><strong>+14&nbsp;000&nbsp;₽</strong></div>
    </div>
  </div>
</section>'''

HOW = '''<section class="blk bg2 torn" id="how" data-chap="Как это работает">
  <div class="wrap">
    <div class="head center">
      <span class="eyebrow" data-r>Как это работает</span>
      <h2 class="h2" data-r>Банки платят за&nbsp;новых клиентов.</h2>
      <p class="lead" data-r><b>200 млрд ₽</b> в год банки тратят на поиск клиентов. Часть этих денег получают те, кто приводит клиентов, — через официальные партнёрские программы. Четыре хода — и ты внутри.</p>
    </div>
    <div class="grid2">
      <article class="tile prod" data-r><span class="k">Ход I · Партнёрка</span><h3>Берёшь ссылку</h3><p>Партнёрка — официальный посредник банка: РКО Групп, Бизнес Система, ФЦН. Регистрация бесплатная, 5 минут. Ты в ней — вебмастер.</p></article>
      <article class="tile prod" data-r style="--i:1"><span class="k">Ход II · Человек</span><h3>Отдаёшь ссылку другу. Или идёшь сам</h3><p>Каждый начинает с себя: первые деньги ты получаешь на своих же оформлениях. Потом подключаешь друзей.</p></article>
      <article class="tile prod" data-r><span class="k">Ход III · Банк</span><h3>Друг бесплатно открывает ИП через Альфу</h3><p>С телефона, без вложений. Банк видит, что клиент пришёл по твоей ссылке, и засчитывает его тебе.</p></article>
      <article class="tile prod main" data-r style="--i:1"><span class="k">Ход IV · Выплата</span><h3>Банк платит</h3><div class="big">14&nbsp;000&nbsp;₽<small>тебе за один оффер</small></div><p>Деньги идут через партнёрку на твою самозанятость. Другу — его часть, например 5 000 ₽ за вечер. И это только один оффер.</p></article>
    </div>
  </div>
</section>'''

INCOME = '''<section class="blk" id="income" data-chap="Доход с одного человека">
  <div class="wrap">
    <div class="head center">
      <span class="eyebrow" data-r>Доход</span>
      <h2 class="h2" data-r>Один человек — это четыре выплаты.</h2>
      <p class="lead" data-r>Один оффер — 14 000 ₽. Но один человек может открыть счета в 8 банках и оформить карты. Вот во что это складывается.</p>
    </div>
    <div class="grid2">
      <article class="tile prod main" data-r><span class="k">1 · Главное</span><h3>Счета для ИП</h3><div class="big">77&nbsp;000&nbsp;₽<small>8 банков × 6–20 тыс.</small></div></article>
      <article class="tile prod" data-r style="--i:1"><span class="k">2</span><h3>Дебетовые карты</h3><div class="big">6&nbsp;000&nbsp;₽<small>3 карты</small></div></article>
      <article class="tile prod" data-r><span class="k">3</span><h3>Кредитные карты</h3><div class="big">9&nbsp;300&nbsp;₽<small>2 карты</small></div></article>
      <article class="tile prod" data-r style="--i:1"><span class="k">4</span><h3>Микрозаймы</h3><div class="big">16&nbsp;577&nbsp;₽<small>4 займа</small></div></article>
    </div>
    <div class="tile win" data-r style="margin-top:18px;text-align:center"><h4>Итого с одного человека</h4><div class="big" style="color:var(--kob)">108&nbsp;877&nbsp;₽</div></div>
    <div class="tried-end" data-r style="margin-top:26px"><span>Один вечер · один человек · один телефон</span><p>Твой инструмент — слово: один вечер на разговор с человеком, которому это выгодно. Банк платит, когда засчитает клиента. <b>14 000 ₽ за один оффер.</b></p></div>
  </div>
</section>'''

ROUTE = '''<section class="blk bg2 torn" id="route" data-chap="Твой маршрут">
  <div class="wrap">
    <div class="head center">
      <span class="eyebrow" data-r>Твой маршрут</span>
      <h2 class="h2" data-r>От нуля до 300–500 тысяч в месяц.</h2>
    </div>
    <div class="ways rt5">
      <article class="way" data-r><span class="tg">Сегодня</span><h4>Понял нишу</h4><p>Откуда деньги, за что платят банки и где новички теряют выплаты. Ты уже здесь.</p><b>0 ₽ — и это нормально</b></article>
      <article class="way" data-r style="--i:1"><span class="tg">Первая неделя</span><h4>Прошёл всё на себе</h4><p>Самозанятость, партнёрки, ИП через Альфу и банки по своим ссылкам. Первые 14 000 ₽ — за первый оффер.</p><b>до ~77 000 ₽ за все счета</b></article>
      <article class="way" data-r style="--i:2"><span class="tg">Вторая неделя</span><h4>Научился говорить с людьми</h4><p>Что написать другу, как ответить на «где подвох?» и как созвониться. Без навязывания.</p><b>первые разговоры</b></article>
      <article class="way" data-r><span class="tg">Первый месяц</span><h4>Первые люди</h4><p>Друзья, их друзья, чаты подработок. Ни рубля на рекламу.</p><b>до 100 000 ₽ с одного человека</b></article>
      <article class="way" data-r style="--i:1"><span class="tg">2–3 месяц</span><h4>Люди из интернета</h4><p>Вакансии, реклама в каналах, свои ролики. Миллион за три месяца не обещаю — это было бы враньё.</p><b>300–500 тысяч в месяц</b></article>
    </div>
  </div>
</section>'''

GEO = '''<section class="blk" id="geo" data-chap="География">
  <div class="wrap">
    <div class="head center">
      <span class="eyebrow" data-r>География</span>
      <h2 class="h2" data-r>Работает из любого города.</h2>
      <p class="lead" data-r>Счёт открывают онлайн, курьер приезжает сам. Москва или посёлок — банку не важно.</p>
    </div>
    <div class="cases">
      <div class="case" data-r><figure class="photo" style="margin:0"><img src="assets/img/sq/case-slava.webp" alt="Слава" loading="lazy" decoding="async"></figure><div class="t"><div class="sum">300 000 ₽</div><div class="who">Слава · Ишимбай, Башкирия</div><p>Маленький город, до этого знал только «темки». Вышел на 300 000 ₽ в месяц, не переезжая. Сейчас куратор в академии.</p></div></div>
      <div class="case gme" data-r style="--i:1"><figure class="photo" style="margin:0"><img src="assets/img/petr.webp" alt="Пётр на Пхукете" loading="lazy" decoding="async"></figure><div class="t"><div class="sum">Пхукет</div><div class="who">Пётр · веду дела отсюда</div><p>Весь бизнес — в телефоне. Нужны только телефон и интернет. Где ты живёшь — не важно.</p></div></div>
    </div>
  </div>
</section>'''

repls = {"hero": HERO, "how": HOW, "income": INCOME, "route": ROUTE, "geo": GEO}

# replace each scene section by id; drop evening (hermes, folded into income) and temple (redundant)
for sid, rep in repls.items():
    pat = re.compile(r'<section class="scene"[^>]*id="%s".*?</section>' % re.escape(sid), S)
    html, n = pat.subn(rep, html)
    print("scene", sid, "->", n)

for sid in ("evening", "temple"):
    pat = re.compile(r'<section class="scene"[^>]*id="%s".*?</section>' % re.escape(sid), S)
    html, n = pat.subn("", html)
    print("drop", sid, "->", n)

# any leftover scenes?
left = re.findall(r'<section class="scene"[^>]*id="([^"]+)"', html)
print("LEFTOVER scenes:", left)

# ---------- open all FAQ answers ----------
html = html.replace("<details>", "<details open>")

# ---------- remove interactive quiz + its sub-head ----------
html = re.sub(r'<div class="head center" style="margin-top:[^"]*"><span class="eyebrow"[^>]*>30 секунд.*?</section>',
              '</section>', html, flags=S)

# ---------- strip scripts ----------
html = re.sub(r'<script\b.*?</script>', '', html, flags=S)

# ---------- remove nav / menu / progress / hint chrome ----------
html = re.sub(r'<nav class="nav".*?</nav>', '', html, flags=S)
html = re.sub(r'<div class="menu" id="menu".*?</div>\s*(?=<div class="progress")', '', html, flags=S)
html = re.sub(r'<div class="progress">.*?</div>', '', html, flags=S)
html = re.sub(r'<div class="hint" id="hint".*?</div>', '', html, flags=S)

# ---------- inject print-static CSS before </head> ----------
CSS = '''<style id="pdfstatic">
  html{scroll-behavior:auto}
  header,.nav,.menu,.progress,.hint,.burger{display:none!important}
  .cut,.drop,.godhand,.horizon,.note-h{display:none!important}
  .js [data-r],[data-r]{opacity:1!important;transform:none!important;transition:none!important}
  .foot [data-f],[data-f]{opacity:1!important;transform:none!important;transition:none!important}
  .tree .node,.tree::before{opacity:1!important;transform:none!important}
  .cap{opacity:1!important;position:static!important;color:inherit!important}
  .faq summary::after{display:none}
  .calc{display:flex!important;justify-content:center!important;gap:0!important}
  .calc .tile:not(.cres){display:none!important}
  .calc .cres{max-width:480px;width:100%}
  .calc .formula:empty,.calc .cmp:empty,.calc .net:empty{display:none!important}
  .quiz{display:none!important}
  .freq{display:none!important}
  .pipe-coin,.pipe-line i{display:none!important}
  .rt5{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
  .rt5 .way b{display:block;margin-top:10px;color:var(--kob);font-family:var(--fd);font-weight:600}
  section.scene{display:none!important}
  /* keep everything on light paper for print clarity where a dark bg isn't core */
  .final-bg{opacity:.18!important}
</style>
</head>'''
html = html.replace("</head>", CSS, 1)

io.open(OUT, "w", encoding="utf-8").write(html)
print("WROTE", OUT, len(html), "bytes")
