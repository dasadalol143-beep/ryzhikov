---
name: ryzhikov-montage
description: >-
  Монтаж Петра Рыжикова: рилсы, шортсы, YouTube, рекламные видео, ролики без лица, моушен-графика и монтаж
  говорящей головы в его стиле (счётчики денег золотом, плашки, «ПИШИ «РКО»», холод → тепло). Используй КАЖДЫЙ раз,
  когда Петя просит смонтировать, собрать ролик, сделать рилс/шортс/видео без лица, анимацию, субтитры, скинул
  референс («сделай как тут»), исходники, голос или раскадровку. Сначала читает этот скил, потом remotion-motion-graphics.
---

# Монтаж Рыжикова

Всё для монтажа лежит в `montage/` в корне репозитория. Стиль: `montage/STYLE.md`, он обязателен для каждого ролика.

## Связка скилов (вызывай по ситуации)
| Задача | Скил |
| --- | --- |
| Любая анимация и моушен в Remotion | `remotion-motion-graphics` (правила 1–10 обязательны) |
| Хуки, форматы рекламы, ролики без лица, iMessage-ролики, моушен-реклама | `ad-creative` (references/hook-system.md, motion-video-ads.md, imessage-video-ads.md, short-form-video-specs.md) |
| Разбор референса → покадровый план | `video` (references/edit-anatomy.md) + `montage/tools/analyze_ref.py` |
| Кривая, длительность, «нужна ли анимация» | `animate`, `animation-vocabulary` (назвать эффект), `review-animations` (финальная проверка) |
| Полировка, Apple-подача, плавная физика | `emil-design-eng`, `apple-design` |
| Изометрические схемы (как работает партнёрка, маршрут по банкам) | `anatomy` |
| Сценарий и текст для голоса | `copywriting`, `social`, `marketing-psychology`, `humanizer-ru` |
| Сгенерировать B-roll, картинку, голос | Higgsfield MCP (`generate_video`, `generate_image`, `generate_audio`), скил `image` для промптов |

## Три режима

### 1. Референс → «сделай так же»
1. `python3 montage/tools/analyze_ref.py "<ссылка или файл>"`. Для Instagram может понадобиться `--cookies`.
2. Открыть `work/ref_*/sheet_*.png` и `summary.txt`. Посмотреть каждый лист, не гадать по описанию.
3. Написать покадровый план по `video/references/edit-anatomy.md`: таблица по битам и 3–5 фирменных приёмов. Копируем приёмы монтажа (ритм, субтитры, движение, звук), а не чужой текст, футаж или музыку.
4. Показать план Пете, после «да» собирать (режим 2 или 3).

### 2. Без лица (моушен, голос за кадром, архивные фото)
- Проект `montage/remotion/`. Компоненты в `src/components/`:
  - `Scene` (5 слоёв и выход) и `KenBurns` (медленный зум на каждом фото);
  - `MoneyCounter` (рывками по банкам, gold/loss), `BigText`, `Plate`, `Push`, `Flow`, `CTA`, `Entrance`;
  - `Captions` (по словам, мат со звёздочками).
- Образец: `src/scenes/InviteFriendDemo.tsx`. Новый ролик = новая сцена в `src/scenes/` и `Composition` в `src/Root.tsx`.
- Голос: `python3 montage/tools/transcribe.py input/voice.wav` даёт `work/voice.words.json`. Импортируй его в `Captions`, тайминг сцен ставь по словам.
- Фото и видео из `montage/input/` копируй в `remotion/public/media/` и подключай через `staticFile("media/...")`. Видео только через `<OffthreadVideo>`.
- Звуки: `public/sfx/*.wav` (notification, cash_push, click, tick, impact, whoosh, riser, scratch, bass_drop, type_key, slap). SFX ставь за 2 кадра до визуала.
- Рендер: `cd montage/remotion && npx remotion render src/index.ts <Id> ../output/<имя>.mp4 --codec h264 --crf 17 --concurrency 4`.

### 3. Говорящая голова (дубли с Osmo)
1. `auto-editor input/raw.mp4 --margin 0.12s -o work/cut.mp4` вырезает паузы и вдохи. Проверь, что первая фраза не обрезана.
2. `transcribe.py work/cut.mp4` даёт слова с таймкодами.
3. В Remotion: `<OffthreadVideo src={staticFile("media/cut.mp4")}/>` как слой ассетов, поверх графика по раскадровке. Пробивка зумом 1.0 → 1.08 на каждое новое предложение, `Captions` внизу, `BigText`/`MoneyCounter` на цифрах.
4. Быстрый вариант без Remotion: `subs.py` → ASS → `ffmpeg -vf ass=...`, счётчики через `counter.py`.

## Проверка (обязательно, не пропускать)
- Вытащи кадры ffmpeg-ом (`-ss <сек> -frames:v 1`) в ключевые моменты и в каждой смене сцены, склей в лист и посмотри глазами.
- Ищи: текст у краёв и вне безопасной зоны (верх 230, низ 380 px), слипшиеся слова в субтитрах, наезд графики на субтитры, страницу субтитров через конец фразы, элементы до входа или после выхода.
- Пройди чеклист из `remotion-motion-graphics/references/design-rules.md`.
- Чини → рендер → снова смотри. Пете отдаёшь только после чистого прохода.

## Чего не делать
- Линейный изинг, вход одной прозрачностью, всё появляется одновременно.
- Эмодзи вместо иконок, системный шрифт в хуке.
- Больше одного золотого (hero) элемента в кадре.
- Ролик без звука. Тишина допустима только как приём, на крючке.
- Копировать чужой креатив целиком. Из референса берём грамматику монтажа.
- Не размытые номера карт, чужие имена и балансы в кабинетах.
