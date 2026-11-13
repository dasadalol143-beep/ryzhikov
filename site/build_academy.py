# -*- coding: utf-8 -*-
import io
SRC="/home/user/ryzhikov/site/index.html"
OUT="/home/user/ryzhikov/site/academy-presentation.html"
head = io.open(SRC,encoding="utf-8").read().split("</head>")[0] + "</head>\n"

PRINT_CSS = '''<style id="pdfstatic">
  html{scroll-behavior:auto}
  header,.nav,.menu,.progress,.hint,.burger{display:none!important}
  .cut,.drop,.godhand,.horizon,.note-h,.final-bg{display:none!important}
  .js [data-r],[data-r]{opacity:1!important;transform:none!important;transition:none!important}
  section.blk{position:relative;overflow:hidden}
  .ac-wrap{max-width:1160px;margin-inline:auto;padding-inline:clamp(20px,5vw,64px);position:relative;z-index:2}
  /* греческие вставки */
  .gk{position:absolute;z-index:1;pointer-events:none;user-select:none;opacity:.95;filter:drop-shadow(0 22px 42px rgba(0,0,0,.28))}
  .gk.cl{opacity:.42;mix-blend-mode:multiply;filter:none}
  .gk.dk{opacity:.5;filter:drop-shadow(0 20px 50px rgba(0,0,0,.6))}
  @media(max-width:760px){.gk{opacity:.5}.gk.hideS{display:none}}
  .ac-stats{display:flex;flex-wrap:wrap;gap:28px 48px;margin-top:30px}
  .ac-stats div b{font-family:var(--fd);font-weight:700;font-size:clamp(30px,4vw,48px);line-height:1;color:var(--kob);display:block}
  .ac-stats div span{font-size:14px;color:var(--ink2);text-transform:uppercase;letter-spacing:.04em}
  .ac-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
  .ac-card{background:var(--marble);border:1px solid var(--line);border-radius:14px;padding:22px 24px}
  .ac-card .n{font-family:var(--fd);font-weight:700;color:var(--kob);font-size:15px;letter-spacing:.06em;text-transform:uppercase}
  .ac-card h4{margin:6px 0 8px;font-size:21px;letter-spacing:-.01em}
  .ac-card p{margin:0;color:var(--ink2);font-size:15.5px;line-height:1.5}
  .ac-card .res{margin-top:12px;padding-top:10px;border-top:1px dashed var(--line);font-size:14.5px;color:var(--ink)}
  .ac-card .res b{color:var(--kob)}
  .ac-card ul{margin:10px 0 0;padding-left:18px;color:var(--ink2);font-size:15px;line-height:1.55}
  .ac-card ul b{color:var(--ink)}
  .ac-money{font-family:var(--fd);font-weight:700;color:var(--kob);font-size:clamp(26px,3vw,36px);line-height:1}
  .ac-step{position:relative}
  .ac-step .sn{font-family:var(--fd);font-weight:700;font-size:48px;line-height:1;color:transparent;-webkit-text-stroke:1.6px var(--kob);display:block;margin-bottom:4px}
  .ac-mod{background:var(--marble);border:1px solid var(--line);border-left:5px solid var(--kob);border-radius:14px;padding:24px 26px;margin-bottom:16px}
  .ac-mod .mh{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
  .ac-mod .mh .mn{font-family:var(--fd);font-weight:700;font-size:34px;color:var(--kob);line-height:1}
  .ac-mod .mh h3{margin:0;font-size:24px}
  .ac-mod .mh .tg{font-family:var(--fd);font-weight:600;text-transform:uppercase;font-size:12px;letter-spacing:.05em;background:var(--kob);color:#fff;padding:3px 9px;border-radius:40px}
  .ac-mod ol{margin:14px 0 0;padding-left:20px;color:var(--ink2);font-size:15.5px;line-height:1.6}
  .ac-mod .res{margin-top:14px;padding:10px 14px;background:rgba(29,61,242,.07);border-radius:10px;font-size:15px}
  .ac-mod .res b{color:var(--kob)}
  .ac-mod.bonus{border-left-color:#c2912f;background:linear-gradient(180deg,#fbf4e6,#fbf9f4)}
  .ac-mod.bonus .mh .mn{color:#c2912f}
  .ac-mod.bonus .mh .tg{background:#c2912f}
  .ac-mod.bonus .res{background:rgba(194,145,47,.12)}
  .ac-mod.bonus .res b{color:#9c6f18}
  .ac-cur{display:grid;grid-template-columns:96px 1fr;gap:18px;align-items:center;background:var(--marble);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
  .ac-cur img{width:96px;height:96px;object-fit:cover;border-radius:14px}
  .ac-cur h4{margin:0 0 2px;font-size:20px}
  .ac-cur .role{font-family:var(--fs);font-style:italic;color:var(--kob);font-size:16px}
  .ac-cur p{margin:6px 0 0;color:var(--ink2);font-size:14.5px;line-height:1.5}
  .ac-cur .m{font-family:var(--fd);font-weight:700;color:var(--kob);font-size:22px;white-space:nowrap}
  .ac-feat{display:grid;grid-template-columns:300px 1fr;gap:28px;align-items:start;background:var(--marble);border:1px solid var(--line);border-radius:16px;padding:26px;margin-bottom:18px}
  .ac-feat .ph img{width:100%;border-radius:12px;display:block}
  .ac-feat .who{margin-top:10px;font-family:var(--fs);font-style:italic;color:var(--kob)}
  .ac-feat .sum{font-family:var(--fd);font-weight:700;font-size:40px;color:var(--kob);line-height:1}
  .ac-feat h3{margin:4px 0 10px;font-size:24px}
  .ac-feat .txt{color:var(--ink2);font-size:15.5px;line-height:1.6}
  .ac-feat blockquote{margin:14px 0 0;padding:14px 18px;border-left:3px solid var(--kob);background:rgba(29,61,242,.05);font-family:var(--fs);font-style:italic;font-size:17px;color:var(--ink);border-radius:0 10px 10px 0}
  .ac-shots{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
  .ac-shots figure{margin:0}
  .ac-shots img{width:100%;border-radius:10px;border:1px solid var(--line);display:block}
  .ac-shots figcaption{font-size:12.5px;color:var(--ink2);margin-top:5px}
  .ac-shots figcaption b{color:var(--kob)}
  .ac-quotes{columns:2;column-gap:16px}
  @media(max-width:720px){.ac-quotes{columns:1}.ac-feat{grid-template-columns:1fr}.ac-cur{grid-template-columns:72px 1fr}.ac-cur img{width:72px;height:72px}}
  .ac-q{break-inside:avoid;background:var(--marble);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:16px}
  .ac-q p{margin:0;font-size:14.5px;line-height:1.55;color:var(--ink)}
  .ac-q .qa{margin-top:10px;font-weight:600;font-size:14px}.ac-q .qa span{color:var(--kob);font-family:var(--fs);font-style:italic;font-weight:500}
  .ac-tbl{width:100%;border-collapse:collapse;font-size:16px}
  .ac-tbl td{padding:13px 10px;border-bottom:1px solid var(--line)}
  .ac-tbl td:last-child{text-align:right;font-family:var(--fd);font-weight:700;color:var(--kob);white-space:nowrap}
  .ac-tbl tr.tot td{border-bottom:none;border-top:2px solid var(--ink);font-size:19px;font-weight:700}
  .ac-price{background:var(--kob);color:#fff;border-radius:20px;padding:40px clamp(24px,5vw,54px);text-align:center}
  .ac-price .was{opacity:.7;text-decoration:line-through;font-size:22px}
  .ac-price .now{font-family:var(--fd);font-weight:700;font-size:clamp(64px,11vw,108px);line-height:.9;margin:6px 0}
  .ac-price .mo{font-size:18px;opacity:.9;margin-bottom:22px}
  .ac-price .cta{display:inline-block;background:#fff;color:var(--kob);font-family:var(--fd);font-weight:700;text-transform:uppercase;letter-spacing:.03em;padding:18px 34px;border-radius:12px;text-decoration:none;font-size:19px}
  .ac-price .seats{margin-top:16px;font-size:14px;opacity:.85}
  .ac-incl{list-style:none;padding:0;margin:0 auto 26px;max-width:560px;text-align:left}
  .ac-incl li{padding:9px 0 9px 30px;position:relative;border-bottom:1px solid rgba(255,255,255,.15)}
  .ac-incl li::before{content:"✓";position:absolute;left:0;color:#fff;font-weight:700}
  .ac-two{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:22px}
  @media(max-width:720px){.ac-two{grid-template-columns:1fr}.ac-shots{grid-template-columns:1fr}}
  .faq summary::after{display:none}
  section.scene{display:none!important}
</style>
</head>'''

head = head.replace("</head>\n", PRINT_CSS)

BODY = r'''<body>
<main>

<!-- HERO -->
<section class="blk" id="top">
  <img class="gk cl" src="assets/v3/cloud.webp" alt="" style="width:clamp(240px,34vw,460px);left:-6%;top:40px">
  <img class="gk hideS" src="assets/v4/nike.webp" alt="" style="width:clamp(170px,24vw,340px);right:-10px;top:30px;rotate:4deg">
  <div class="ac-wrap">
    <span class="eyebrow">Ryzhikov Academy · программа по РКО</span>
    <h1 class="h1">Освой РКО и выйди на <em style="font-style:normal;color:var(--kob)">300&nbsp;000&nbsp;₽</em> за 60 дней.</h1>
    <p class="lead" style="max-width:34em">Программа для парней 18–25 из небольших городов. Даже если ты сейчас в найме за 30к и ни разу не работал в онлайне.</p>
    <div class="ac-stats">
      <div><b>180</b><span>учеников</span></div>
      <div><b>250–350к</b><span>средний доход ученика</span></div>
      <div><b>20 млн ₽</b><span>заработал сам</span></div>
      <div><b>30 млн ₽</b><span>заработали ученики</span></div>
      <div><b>13</b><span>банков в связке</span></div>
    </div>
  </div>
</section>

<!-- I ПУТЬ -->
<section class="blk bg2 torn" id="hall-1" data-chap="Глава I · Путь">
  <div class="ac-wrap">
    <img class="gk hideS" src="assets/v3/runner.webp" alt="" style="width:clamp(150px,19vw,280px);right:-30px;top:30px;rotate:-5deg">
    <div class="head center"><span class="eyebrow">Маршрут ученика</span><h2 class="h2">От полного нуля до 300к/мес.</h2><p class="lead">Не абстрактный «путь роста», а конкретные этапы с понятным результатом на каждом. Восемь шагов, которые проходит каждый ученик.</p></div>
    <div class="ac-grid">
      <div class="ac-card ac-step"><span class="sn">01</span><div class="n">0 ₽ · старт</div><h4>Полный ноль</h4><p>В найме за 22к. Долги. Нет маршрута.</p></div>
      <div class="ac-card ac-step"><span class="sn">02</span><div class="n">+15 000 ₽</div><h4>Регистрация ИП</h4><p>Открываешь ИП через Альфу. Первые 15к уже на карте.</p></div>
      <div class="ac-card ac-step"><span class="sn">03</span><div class="n">13 банков</div><h4>Первые связки</h4><p>Модуль 2. Изучаешь 13 банков, настраиваешь КЭП.</p></div>
      <div class="ac-card ac-step"><span class="sn">04</span><div class="n">30 000 ₽ с лида</div><h4>Первый лид</h4><p>Приводишь клиента через 2 банка.</p></div>
      <div class="ac-card ac-step"><span class="sn">05</span><div class="n">95 000 ₽ с клиента</div><h4>Полный круг</h4><p>Докручиваешь одного лида по всем банкам.</p></div>
      <div class="ac-card ac-step"><span class="sn">06</span><div class="n">100 000 ₽ / мес</div><h4>Первые 100к</h4><p>Стабильно 2–3 лида в неделю. Первый плюсовой месяц.</p></div>
      <div class="ac-card ac-step"><span class="sn">07</span><div class="n">лиды приходят сами</div><h4>Личный бренд</h4><p>Подключаешь блог. Клиенты идут через контент.</p></div>
      <div class="ac-card ac-step"><span class="sn">08</span><div class="n">300 000 ₽+ / мес</div><h4>Стабильные 300к+</h4><p>Системный доход, а не разовые всплески.</p></div>
    </div>
  </div>
</section>

<!-- II ПЕРЕМЕНЫ -->
<section class="blk" id="hall-2" data-chap="Глава II · Что нового">
  <div class="ac-wrap">
    <img class="gk hideS" src="assets/v3/column.webp" alt="" style="width:clamp(110px,14vw,210px);right:-10px;top:24px">
    <div class="head center"><span class="eyebrow">Часть 01 · обзор</span><h2 class="h2">Что нового в этом потоке.</h2><p class="lead">Мы пересобрали академию под текущий рынок. Пять главных изменений.</p></div>
    <div class="ac-grid">
      <div class="ac-card"><div class="n">01</div><h4>Модуль РКО переписан под 13 банков</h4><p>Полный маршрут от Т-Банка до Сбер КЭП. Актуальные выплаты и связки.</p></div>
      <div class="ac-card"><div class="n">02</div><h4>Четыре сильных куратора</h4><p>Дамир, Дима, Рома и Астемир лично ведут тебя до первых денег.</p></div>
      <div class="ac-card"><div class="n">03</div><h4>Живой чат учеников</h4><p>Общий чат на SkillSpace. Разбираем связки, делимся кейсами, помогаем друг другу.</p></div>
      <div class="ac-card"><div class="n">04</div><h4>Уникальная связка от Петра</h4><p>Внутри модуля «Личный бренд». Личная механика Петра, которой нет ни в одном другом обучении по РКО.</p></div>
      <div class="ac-card"><div class="n">05</div><h4>Новые связки и источники трафика</h4><p>Кредитование, закупы рекламы, свой сайт через Claude, 6+ часов по личному бренду от Никиты Комлева и отдельный <b>бонусный модуль по УБТ</b> (Threads, Reels, TikTok, Shorts).</p></div>
    </div>
    <div class="head" style="margin-top:40px"><span class="eyebrow">Формат обучения</span><h3 class="h3">Группа и личный куратор.</h3><p class="lead">Ты учишься в своём темпе, но не один: куратор ведёт тебя от первого банка до полного открута клиента.</p></div>
    <div class="ac-grid">
      <div class="ac-card"><h4>Платформа SkillSpace</h4><p>Все уроки, задания и материалы в одном месте.</p></div>
      <div class="ac-card"><h4>Закрытый чат обучения</h4><p>Кураторы отвечают на вопросы, ученики делятся опытом.</p></div>
      <div class="ac-card"><h4>Личное сопровождение</h4><p>Куратор ведёт за руку: от первого банка до полного открута клиента.</p></div>
      <div class="ac-card"><h4>Живые эфиры</h4><p>Разборы связок, обновлений по банкам и кейсов учеников.</p></div>
    </div>
  </div>
</section>

<!-- III ПРОГРАММА -->
<section class="blk bg2 torn" id="hall-3" data-chap="Глава III · Программа">
  <div class="ac-wrap">
    <img class="gk hideS" src="assets/v3/bust.webp" alt="" style="width:clamp(150px,20vw,290px);right:-34px;top:20px;rotate:3deg">
    <div class="head center"><span class="eyebrow">Часть 02 · программа</span><h2 class="h2">7 модулей, которые ведут от нуля до 300к.</h2><p class="lead">Проходишь, применяешь, получаешь результат, идёшь дальше.</p></div>
    <div class="ac-mod"><div class="mh"><span class="mn">00</span><h3>Вводный модуль</h3><span class="tg">Старт</span></div><ol><li>Организация работы: как устроены академия, чат, кураторы и платформа.</li><li>Словарь терминов: РКО, КЭП, 115-ФЗ, CPA, лид, оффер.</li><li>Диагностика знаний в сфере РКО — тест, который показывает твою точку старта.</li></ol><div class="res"><b>Результат:</b> знаешь язык ниши и понимаешь, как устроена академия.</div></div>
    <div class="ac-mod"><div class="mh"><span class="mn">01</span><h3>Мир продуктов</h3><span class="tg">+15 000 ₽</span></div><ol><li>Мир банковских продуктов и безопасность: за что банки платят и как работать юридически чисто.</li><li>Регистрация на партнёрках: RKO Group, FCN, Бизнес Система.</li><li>Регистрация ИП и самозанятости: «Мой налог» → ИП на НПД через Альфу, до 15 000 ₽ за первый шаг.</li><li>Тест по банковским продуктам.</li></ol><div class="res"><b>Результат:</b> кабинеты во всех партнёрках, ИП оформлено, первая выплата на карте.</div></div>
    <div class="ac-mod"><div class="mh"><span class="mn">02</span><h3>РКО. Ключ к золоту</h3><span class="tg">Основной</span></div><ol><li>РКО как основной актив: почему один лид даёт от 30 до 130 тысяч, а не 5к.</li><li>13 банков: Т-Банк, Газпромбанк, ВТБ, Точка, OZON, Локо, Уралсиб, Свой Банк, Контур, Ак Барс, Левобережный, ПСБ, Сбер КЭП. Выплаты и условия по каждому.</li><li>Настройка КЭП — электронная подпись и вывод денег через партнёрскую сеть.</li><li>Тонкости по банкам, редкие связки, ситуации из практики.</li><li>Юридическая часть: как работать по закону и не поймать блок или проверку.</li><li>Тестирование по РКО.</li></ol><div class="res"><b>Результат:</b> маршрут по 13 банкам. Один клиент докручивается на 95к+ по полному кругу.</div></div>
    <div class="ac-mod"><div class="mh"><span class="mn">03</span><h3>МФО-связки</h3><span class="tg">×1,5–2 с лида</span></div><ol><li>МФО как второй актив: почему он идёт в связке с РКО, а не отдельно.</li><li>Новый список МФО: актуальные офферы, выплаты, условия.</li><li>Технический модуль: как всё настроить, чтобы заявки засчитывались и выплаты доходили.</li><li>Тестирование по МФО-связкам.</li></ol><div class="res"><b>Результат:</b> один клиент докручен и на РКО, и на МФО. С лида в 1,5–2 раза больше.</div></div>
    <div class="ac-mod"><div class="mh"><span class="mn">04</span><h3>Маскировка и трафик</h3><span class="tg">Кредитование · УБТ</span></div><ol><li>Маскировка и трафик: как не сгореть под 115-ФЗ и работать так, чтобы у банка не было вопросов.</li><li>Свой сайт через Claude — собираешь сайт под заявки без программиста.</li><li>Связка «Закупы рекламы»: как покупать трафик и окупать бюджет с плюсом.</li><li>Работа по откликам: лиды через вакансии и объявления.</li><li>Связки: кредитование, УБТ, закупы рекламы и другие.</li><li>Трафик → продажа: как связать поток людей с закрытием и выйти на объём.</li></ol><div class="res"><b>Результат:</b> несколько источников клиентов, а не один. Доход становится стабильным.</div></div>
    <div class="ac-mod"><div class="mh"><span class="mn">05</span><h3>Масштабирование</h3><span class="tg">500к+ · модуль Андрея Фадеева</span></div><ol><li>Как из первых 100–200к вырасти в системный доход от 500к: найм первых людей, делегирование, распределение прибыли.</li></ol><div class="res"><b>Результат:</b> понимаешь, как из соло-исполнителя стать человеком с командой.</div></div>
    <div class="ac-mod"><div class="mh"><span class="mn">06</span><h3>Личный бренд</h3><span class="tg">Эксклюзив · связка Петра</span></div><ol><li>Уникальная связка Петра — механика, которую он собрал под себя и не выкладывает: ни на YouTube, ни в чужих обучениях по РКО.</li><li>Развитие и поведение в соцсетях: упаковка и контент, после которого люди сами приходят за счётом.</li><li>Никита Комлев: видео на 6+ часов по личному бренду.</li></ol><div class="res"><b>Результат:</b> связка, которой нет у конкурентов, и личный бренд, который её кормит. «Спокойно выходишь на 1–2+ ляма».</div></div>
    <div class="ac-mod bonus"><div class="mh"><span class="mn">★</span><h3>Бонусный модуль · УБТ</h3><span class="tg">Бонус · сильно расширен</span></div><ol><li>Условно-бесплатный трафик с нуля: <b>Threads, Reels, TikTok, Shorts</b> — как снимать и что выкладывать, чтобы заходило.</li><li>Как переливать <b>мотивированный трафик с УБТ в свой блог</b> — а не сливать охваты в пустоту.</li><li>Как вести блог, после которого люди сами приходят за счётом.</li><li>Как переводить в личные сообщения и <b>обрабатывать мотивированный трафик</b> до заявки.</li><li>Как в принципе вести Threads: от первого поста до входящих заявок.</li></ol><div class="res"><b>Результат:</b> бесплатный поток тёплых лидов, которые пишут сами. Без бюджета на рекламу.</div></div>
  </div>
</section>

<!-- IV КОМАНДА -->
<section class="blk" id="hall-4" data-chap="Глава IV · Команда">
  <div class="ac-wrap">
    <img class="gk hideS" src="assets/v5/hermes.webp" alt="" style="width:clamp(150px,20vw,290px);right:-30px;top:18px;rotate:-3deg">
    <div class="head center"><span class="eyebrow">Комьюнити</span><h2 class="h2">Закрытый чат РКО-бойцов.</h2><p class="lead">Не абстрактный «чат учеников», а среда, где 180 человек делают деньги руками прямо сейчас. Ты внутри с первого дня.</p></div>
    <div class="ac-stats" style="justify-content:center"><div><b>180</b><span>учеников</span></div><div><b>24/7</b><span>активность</span></div><div><b>4</b><span>куратора в чате</span></div></div>
    <div class="ac-grid" style="margin-top:26px">
      <div class="ac-card"><h4>Обновления по банкам в реальном времени</h4><p>Какой банк отвалился, где выросли выплаты, какие связки завезли — всё в чате раньше, чем в открытых источниках.</p></div>
      <div class="ac-card"><h4>Кейсы учеников каждый день</h4><p>Ребята выкладывают выплаты и разбирают, что зашло. Учишься на живом опыте всей группы.</p></div>
      <div class="ac-card"><h4>Кураторы на связи</h4><p>Задал вопрос вечером — к утру максимум получил ответ.</p></div>
    </div>
    <div class="head" style="margin-top:44px"><span class="eyebrow">Наши кураторы</span><h3 class="h3">Четыре человека, которые ведут тебя.</h3><p class="lead">Не теоретики. Каждый сам зарабатывает в нише прямо сейчас.</p></div>
    <div class="ac-grid">
      <div class="ac-cur"><img src="assets/img/case-damir.webp" alt="Дамир"><div><h4>Дамир</h4><span class="role">старший куратор</span><p>Основной куратор по РКО и МФО. Ведёт учеников от старта до полного открута клиента.</p><span class="m">900 000 ₽ <small style="font-weight:400;color:var(--ink2)">за квартал</small></span></div></div>
      <div class="ac-cur"><img src="assets/img/case-dima.webp" alt="Дима"><div><h4>Дима</h4><span class="role">куратор</span><p>Мой лучший друг. Был монтажником при −40, вышел на 400к в нише, теперь ведёт учеников.</p><span class="m">400 000 ₽ <small style="font-weight:400;color:var(--ink2)">в месяц</small></span></div></div>
      <div class="ac-cur"><img src="assets/img/cur-roma.webp" alt="Рома Смирнов"><div><h4>Рома Смирнов</h4><span class="role">куратор · продажи</span><p>Лучший по откликам. За первый месяц личного бренда сделал 800к.</p><span class="m">800 000 ₽ <small style="font-weight:400;color:var(--ink2)">первый месяц бренда</small></span></div></div>
      <div class="ac-cur"><img src="assets/img/cur-astemir.webp" alt="Астемир"><div><h4>Астемир</h4><span class="role">куратор</span><p>Начинал с полного нуля. Переехал в Москву, сотрудничает со мной по академии.</p><span class="m">250 000 ₽ <small style="font-weight:400;color:var(--ink2)">в месяц</small></span></div></div>
    </div>
  </div>
</section>

<!-- V ИНСТРУМЕНТЫ -->
<section class="blk bg2 torn" id="hall-5" data-chap="Глава V · Инструменты">
  <div class="ac-wrap">
    <img class="gk hideS" src="assets/v3/column.webp" alt="" style="width:clamp(110px,14vw,200px);left:-8px;top:28px">
    <div class="head center"><span class="eyebrow">Часть 03 · фишки академии</span><h2 class="h2">Что даёт академия, чего нет нигде.</h2></div>
    <div class="ac-grid">
      <div class="ac-card"><div class="n">Оружие 01</div><h4>Готовые скрипты общения с лидами</h4><ul><li><b>Первое сообщение</b> — как зацепить лида, чтобы он ответил.</li><li><b>Возражения</b> — «подумаю», «боюсь», «у меня уже есть счёт».</li><li><b>Дожим до открытия</b> — от согласия до реального открытия счёта.</li></ul></div>
      <div class="ac-card"><div class="n">Оружие 02</div><h4>Мини-обучение по продажам</h4><ul><li><b>Психология покупателя.</b></li><li><b>Структура диалога</b> — от первого контакта до подтверждения.</li><li><b>Разбор реальных диалогов.</b></li><li><b>50+ возражений</b> и как из каждого выйти в согласие.</li></ul></div>
      <div class="ac-card"><div class="n">Оружие 03</div><h4>Модуль по личному бренду</h4><ul><li><b>Упаковка</b> — оффер, позиционирование, визуал.</li><li><b>Контент, который продаёт.</b></li><li><b>Продажи через контент</b> — из подписчика в клиента.</li></ul></div>
      <div class="ac-card"><div class="n">Оружие 04 · только для тех, кто сейчас</div><h4>Бессрочный доступ к обучению и чату</h4><p>Обычно доступ даётся на 3 месяца. Если заходишь <b>в течение 24 часов</b> — он становится бессрочным. Пришёл через год — ты всё ещё внутри.</p></div>
    </div>
  </div>
</section>

<!-- VI РЕЗУЛЬТАТЫ -->
<section class="blk" id="hall-6" data-chap="Глава VI · Результаты">
  <div class="ac-wrap">
    <img class="gk hideS" src="assets/v4/coin.webp" alt="" style="width:clamp(80px,10vw,150px);right:20px;top:34px;rotate:8deg">
    <div class="head center"><span class="eyebrow">Часть 04 · кейсы</span><h2 class="h2">Какие результаты делают ученики.</h2><p class="lead">Каждого можно проверить в моём Telegram. Средний доход учеников — 250–350 тысяч в месяц.</p></div>

    <div class="ac-feat">
      <div class="ph"><img src="assets/img/vitya.webp" alt="Витя"><p class="who">Витя · @GauzRko</p></div>
      <div>
        <div class="sum">140 000 ₽</div><h3>За первый месяц на одном РКО.</h3>
        <p class="txt">Работал через знакомого: за каждого клиента получал 5 000 ₽, хотя договаривались делить поровну. Где брать партнёрки, не объясняли два месяца. На первом созвоне за 20 минут получил то, что от него скрывали — где брать партнёрки и как заводить людей напрямую. Обучение окупилось за полтора месяца.</p>
        <blockquote>«Первый профит — 140 тысяч сугубо на РКО. Это были самые лёгкие деньги в моей жизни. Пацаны, если сомневаетесь так же, как сомневался я — не ссыте. Работайте и топите до талого.»</blockquote>
        <div class="ac-shots">
          <figure><img src="assets/img/vitya-pay1.webp" alt="Выплата 90 385 ₽"><figcaption><b>+90 385 ₽</b> от «Бизнес Система»</figcaption></figure>
          <figure><img src="assets/img/vitya-pay2.webp" alt="Выплата 29 000 ₽"><figcaption><b>+29 000 ₽</b> от «РКО Групп»</figcaption></figure>
        </div>
      </div>
    </div>

    <div class="ac-feat">
      <div class="ph"><img src="assets/img/anton.webp" alt="Антон"><p class="who">Антон · @takemmn</p></div>
      <div>
        <div class="sum">230 000+ ₽</div><h3>За сентябрь с онлайн-трафика.</h3>
        <p class="txt">Был студентом: шабашки, подработки. Увидел видео на YouTube, созвонился — зашёл. Первый месяц закрыл с себя (100 000+ ₽), потом полез в онлайн-трафик, получил по лбу и вышел на объём.</p>
        <blockquote>«Лёгких денег здесь нет. Это такая же работа, где нужно вкладываться. При правильном подходе окупается в разы. Нытики скажут, что это инфоцыганство, но только „тигры“ изменят свою жизнь.»</blockquote>
        <div class="ac-shots">
          <figure><img src="assets/img/anton-pay1.webp" alt="Оплаченные счета"><figcaption><b>110 900 + 49 000 + 46 400 ₽</b> — оплаченные счета</figcaption></figure>
          <figure><img src="assets/img/anton-deals.webp" alt="Сделки по банкам"><figcaption><b>Засчитанные сделки:</b> ПСБ, Уралсиб, ВТБ, Альфа</figcaption></figure>
        </div>
      </div>
    </div>

    <div class="head center sub-head" style="margin-top:36px"><h3 class="h3">Витя и Антон — не исключение.</h3></div>
    <div class="ac-grid">
      <div class="ac-card"><div class="n">Кейс 01 · Дамир</div><p>Крутился по темкам. Пришёл учеником, вырос в куратора.</p><div class="res"><b>900 000 ₽</b> за квартал</div></div>
      <div class="ac-card"><div class="n">Кейс 02 · Кирилл</div><p>Работал в магазине у брата, потолок 30к. Купил Ford Focus.</p><div class="res"><b>500 000 ₽</b> в месяц</div></div>
      <div class="ac-card"><div class="n">Кейс 03 · Дима</div><p>Монтажник, бурил стены при −40. Сейчас куратор академии.</p><div class="res"><b>400 000 ₽</b> в месяц</div></div>
      <div class="ac-card"><div class="n">Кейс 04 · Слава</div><p>Ишимбай, завод. Знал только «темки». Стал куратором.</p><div class="res"><b>300 000 ₽</b> в месяц</div></div>
      <div class="ac-card"><div class="n">Кейс 05 · Максим, 26</div><p>Не верил, что для него это реально. Поверил в себя.</p><div class="res"><b>200 000 ₽</b> в месяц</div></div>
      <div class="ac-card"><div class="n">Кейс 06 · Тимур, 18</div><p>Ноль опыта в онлайне. Один из самых быстрых стартов.</p><div class="res"><b>159 000 ₽</b> первый месяц</div></div>
    </div>

    <div class="head center sub-head" style="margin-top:40px"><span class="eyebrow">Отзывы</span><h3 class="h3">Что пишут ученики.</h3><p class="lead">Реальные сообщения из чата академии. Без копирайтерской правки.</p></div>
    <div class="ac-quotes">
      <div class="ac-q"><p>Я даже рад, что принял нерациональное решение, отдав последние деньги за обучение. Недавно вышел модуль по личному бренду, благодаря которому разъёбываешь вымышленный потолок. Спокойно выходишь на 1–2+ ляма.</p><div class="qa">Максим · <span>выход на 300–500 тысяч</span></div></div>
      <div class="ac-q"><p>На счёт курса всё, что смогу сказать — это просто мясо! За месяц изучил всю теорию и начал зарабатывать сам. Курс максимально открывает кругозор в нише РКО и МФО.</p><div class="qa">Никита · <span>первый месяц в нише</span></div></div>
      <div class="ac-q"><p>Петя — человек, который поменял мою жизнь в буквальном смысле. Куча неочевидной информации даёт понять, что это один из лучших продуктов на рынке. Инфа постоянно дополняется.</p><div class="qa">Даниил · <span>про продукт</span></div></div>
      <div class="ac-q"><p>Увидел пост про бесплатный разбор и записался. Была проблема с рассрочкой — Петя пошёл навстречу. Информация подана как будто брат пишет брату, всё чётко.</p><div class="qa">Artemiy · <span>ясная картина ниши</span></div></div>
      <div class="ac-q"><p>Петя — один из самых надёжных сенсеев в мире РКО, МФО и личного бренда. Постоянные обновления в курсе и актив в приватке.</p><div class="qa">Лёха · <span>про подход</span></div></div>
      <div class="ac-q"><p>Огромная благодарность за возможность работать в такой команде. Всем, кто ещё не начал, советую сделать это. Знайте, пацаны, мечты сбываются.</p><div class="qa">Ученик · <span>купил MacBook</span></div></div>
      <div class="ac-q"><p>Когда заходил, вообще не понимал, что такое РКО. На практике всё намного понятнее. Материал простым языком, без воды, даже с нуля можно разобраться.</p><div class="qa">Mikhail · <span>заход с нуля</span></div></div>
      <div class="ac-q"><p>По сравнению с тем, что есть в открытом доступе, обучение Пети — как раскраска для детей: всё уже готово и разжёвано, осталось только делать.</p><div class="qa">Artem G · <span>2 месяца в нише</span></div></div>
    </div>
  </div>
</section>

<!-- VII КАЛЬКУЛЯТОР -->
<section class="blk bg2 torn" id="hall-7" data-chap="Глава VII · Калькулятор">
  <div class="ac-wrap">
    <img class="gk hideS" src="assets/v4/coin.webp" alt="" style="width:clamp(90px,11vw,160px);right:-10px;top:30px;rotate:-10deg">
    <div class="head center"><span class="eyebrow">Калькулятор мечты</span><h2 class="h2">Сколько лидов стоит твоя мечта.</h2><p class="lead">Один полностью открученный лид — это 130 000 ₽. Не абстрактный «доход в месяц», а конкретные деньги с одного человека.</p></div>
    <div class="ac-card" style="max-width:720px;margin-inline:auto">
      <table class="ac-tbl">
        <tr><td>iPhone 18 Pro — 130 000 ₽</td><td>1 лид</td></tr>
        <tr><td>MacBook Pro 14 — 180 000 ₽</td><td>1,4 лида</td></tr>
        <tr><td>Питбайк — 350 000 ₽</td><td>2,7 лида</td></tr>
        <tr><td>Месяц на Пхукете — 450 000 ₽</td><td>3,5 лида</td></tr>
        <tr><td>Тигр — 600 000 ₽</td><td>4,6 лида</td></tr>
        <tr><td>Mercedes E-класс купе — 2 000 000 ₽</td><td>15,4 лида</td></tr>
      </table>
      <p class="small" style="margin-top:14px">А теперь главное: <b>обучение стоит меньше одного лида.</b> Первый же человек, которого ты доведёшь до конца, закрывает его полностью и оставляет тебе сверху.</p>
    </div>
  </div>
</section>

<!-- VIII ЦЕННОСТЬ И ВХОД -->
<section class="blk" id="hall-8" data-chap="Глава VIII · Ценность и вход">
  <div class="ac-wrap">
    <img class="gk hideS" src="assets/v4/temple.webp" alt="" style="width:clamp(170px,23vw,330px);right:-30px;top:24px">
    <div class="head center"><span class="eyebrow">Часть 05 · ценность и вход</span><h2 class="h2">Сколько реально стоит академия.</h2><p class="lead">Посчитаем всё, что ты получаешь внутри. Не по ощущениям, а по рыночной цене каждого куска.</p></div>
    <div class="ac-card" style="max-width:720px;margin-inline:auto">
      <table class="ac-tbl">
        <tr><td>7 модулей по РКО, МФО и трафику с полным маршрутом</td><td>150 000 ₽</td></tr>
        <tr><td>Личное сопровождение куратора до первых денег</td><td>80 000 ₽</td></tr>
        <tr><td>Готовые скрипты продаж и работы с лидами</td><td>40 000 ₽</td></tr>
        <tr><td>Мини-обучение по продажам</td><td>50 000 ₽</td></tr>
        <tr><td>Модуль по личному бренду и продажам через контент</td><td>60 000 ₽</td></tr>
        <tr><td>Закрытый чат со 180 учениками и кураторами</td><td>20 000 ₽</td></tr>
        <tr class="tot"><td>Общая ценность</td><td>400 000 ₽+</td></tr>
      </table>
    </div>
    <div class="head center sub-head" style="margin-top:40px"><span class="eyebrow">Единственный тариф</span><h3 class="h3">Один тариф. Без урезанных версий.</h3><p class="lead">Я не режу академию на «начальный / средний / продвинутый». Либо ты внутри с полным доступом, либо нет.</p></div>
    <div class="head center sub-head" style="margin-top:40px"><span class="eyebrow">Бонусы · если заходишь в течение 24 часов</span><h3 class="h3">Пять бонусов для тех, кто решает сразу.</h3></div>
    <div class="ac-grid">
      <div class="ac-card"><div class="n">01 · 20 000 ₽</div><h4>Бессрочный доступ к чату</h4><p>Обычно чат открыт 3 месяца. Тебе — навсегда.</p></div>
      <div class="ac-card"><div class="n">02 · 30 000 ₽</div><h4>Бессрочный доступ к обучению</h4><p>Стандартно материалы на 3 месяца. Ты забираешь их на всю жизнь со всеми обновлениями.</p></div>
      <div class="ac-card"><div class="n">03 · специальная цена</div><h4>Вход дешевле 120к</h4><p>Сумму увидишь в конце — на странице решения.</p></div>
      <div class="ac-card"><div class="n">04 · рассрочка</div><h4>До 24 месяцев без нагрузки</h4><p>Разбиваем оплату через банк-партнёр. Платёж в месяц — дешевле пары походов в кафе.</p></div>
      <div class="ac-card"><div class="n">05 · бесценно</div><h4>Приоритет к сильному куратору</h4><p>Кураторы берут ограниченное число учеников. Тех, кто заходит сейчас, распределяем первыми.</p></div>
    </div>
    <div class="note" style="margin-top:22px;max-width:720px;margin-inline:auto"><b>Всего 5 мест по специальной цене. Занято 3 из 5.</b> Осталось 2 места. Дальше — полная стоимость 150 000 ₽.</div>
    <p class="small center" style="text-align:center;margin-top:18px">Рассрочка через 8 банков (оформление 10–15 минут онлайн): Т-Банк, Альфа-Банк, Уралсиб, Локо-Банк, Сбер, Ренессанс, ОТП, Совкомбанк.</p>
  </div>
</section>

<!-- IX РЕШЕНИЕ -->
<section class="blk final dark" id="hall-9" data-chap="Глава IX · Решение">
  <div class="ac-wrap">
    <img class="gk dk hideS" src="assets/v3/hand.webp" alt="" style="width:clamp(160px,22vw,320px);right:-20px;bottom:40px;rotate:-6deg">
    <div class="head center"><span class="eyebrow">Финальное решение</span><h2 class="h1">Ты либо внутри сегодня, либо снаружи завтра.</h2></div>
    <ul class="ac-incl">
      <li>7 модулей: РКО, МФО, трафик, масштабирование, личный бренд</li>
      <li>Уникальная связка Петра</li>
      <li>Личный куратор до первых денег</li>
      <li>Закрытый чат со 180 учениками</li>
      <li>Скрипты и мини-обучение по продажам</li>
      <li>Бессрочный доступ к обучению и чату</li>
    </ul>
    <div class="ac-price">
      <div class="was">120 000 ₽</div>
      <div class="now">99 900 ₽</div>
      <div class="mo">или 4 163 ₽ / мес в рассрочку на 24 месяца · −20 100 ₽ сегодня</div>
      <a class="cta" href="https://link.tbank-online.com/8Wc6E4OkwHn">Забрать место за 99 900 ₽</a>
      <div class="seats">Осталось 2 места из 5 по этой цене</div>
    </div>
    <div class="ac-two">
      <div class="tile"><h4>Путь 01 · открутка на себе</h4><p>Проходишь маршрут сам: самозанятость → ИП на НПД → РКО по банкам. Только это <b>минимум окупает</b> обучение. Ещё до первого клиента.</p></div>
      <div class="tile"><h4>Путь 02 · всего один лид</h4><p>Один человек, доведённый по цепочке офферов до конца, — это <b>до 130 000 ₽</b>. Больше, чем стоит обучение. Один лид — и ты в плюсе.</p></div>
    </div>
    <p class="lead center" style="text-align:center;margin-top:26px">Обучение окупается. Вопрос только — на ком. Как всегда, ваш <b>Пётр</b>.</p>
    <p class="small center" style="text-align:center;opacity:.7">© Ryzhikov Academy · 2026</p>
  </div>
</section>

</main>
</body>
</html>'''

io.open(OUT,"w",encoding="utf-8").write(head + BODY)
print("WROTE", OUT, len(head+BODY), "bytes")
