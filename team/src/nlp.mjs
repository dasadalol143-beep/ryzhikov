// Разбор дат и времени из обычного текста (МСК): «завтра в 15», «в пятницу 18:30», «через 2 часа».
// Время — московское. Без нейросетей: правила для того, как реально пишут в чате.
const MSK = 3;
const HOUR = 3600000;
const WORD_NUM = { один: 1, одну: 1, пару: 2, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, пятнадцать: 15, двадцать: 20, тридцать: 30, сорок: 40 };
const MONTHS = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
const WEEKDAYS = { "понедельник": 1, "вторник": 2, "сред": 3, "четверг": 4, "пятниц": 5, "суббот": 6, "воскресень": 0 };
export const WEEKDAY_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

// Московские «сейчас» в виде компонент.
const mskParts = (ms) => {
  const d = new Date(ms + MSK * HOUR);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
};
const fromMsk = (y, m, d, h, mi) => Date.UTC(y, m, d, h - MSK, mi);

export function formatMsk(ms) {
  const p = mskParts(ms);
  return `${String(p.d).padStart(2, "0")}.${String(p.m + 1).padStart(2, "0")} (${WEEKDAY_SHORT[p.wd]}) в ${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")} МСК`;
}
export const mskDateKey = (ms) => {
  const p = mskParts(ms);
  return `${p.y}-${String(p.m + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
};

export function parseReminder(text, now = Date.now(), { force = false } = {}) {
  if (!force && !/напомн|напоминани/i.test(text)) return null;
  let t = ` ${text.replace(/ё/gi, "е")} `;
  const cut = (re) => {
    const m = t.match(re);
    if (m) t = t.replace(m[0], " ");
    return m;
  };

  const nick = cut(/@([A-Za-z][A-Za-z0-9_]{3,31})/)?.[1] || null;
  const lower = () => t.toLowerCase();
  const n = mskParts(now);
  let day = null; // { y, m, d }
  let time = null; // { h, mi }
  let due = null;
  let explicitDay = false;

  // «через 2 часа», «через полчаса», «через 15 минут», «через 3 дня», «через неделю»
  const rel = lower().match(/через\s+(\d+|полчаса|пол|час|один|одну|пару|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|пятнадцать|двадцать|тридцать|сорок)?\s*(минут[уы]?|мин(?![а-я])|час(?:а|ов)?|дн(?:я|ей)|день|недел[юи]|)/);
  if (rel && (rel[1] || rel[2])) {
    let qty = rel[1] === undefined ? 1 : /^\d+$/.test(rel[1]) ? +rel[1] : rel[1] === "пол" || rel[1] === "полчаса" ? 0.5 : rel[1] === "час" ? 1 : WORD_NUM[rel[1]];
    let unit = rel[2] || (rel[1] === "полчаса" ? "час" : rel[1] === "час" ? "час" : "");
    if (rel[1] === "полчаса") unit = "час";
    if (qty && unit) {
      const ms = unit.startsWith("мин") ? qty * 60000 : unit.startsWith("час") ? qty * HOUR : unit.startsWith("недел") ? qty * 7 * 24 * HOUR : qty * 24 * HOUR;
      due = now + ms;
      if (unit.startsWith("д") || unit.startsWith("недел")) {
        const p = mskParts(due);
        day = { y: p.y, m: p.m, d: p.d };
        due = null; // день знаем, время возьмём из текста или по умолчанию
        explicitDay = true;
      }
      t = t.replace(new RegExp(rel[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
    }
  }

  // День: сегодня / завтра / послезавтра / в пятницу / 15.10 / 15 октября
  const dayWords = { "послезавтра": 2, "завтра": 1, "сегодня": 0 };
  for (const [w, add] of Object.entries(dayWords)) {
    if (!day && new RegExp(`(^|[^а-я])${w}([^а-я]|$)`).test(lower())) {
      const p = mskParts(Date.UTC(n.y, n.m, n.d + add, 12));
      day = { y: p.y, m: p.m, d: p.d };
      explicitDay = true;
      t = t.replace(new RegExp(w, "i"), " ");
    }
  }
  if (!day) {
    const wdm = lower().match(/(?:во?\s+)?(понедельник|вторник|сред[уа]|четверг|пятниц[уа]|суббот[уа]|воскресень[ея])/);
    if (wdm) {
      const target = Object.entries(WEEKDAYS).find(([k]) => wdm[1].startsWith(k))[1];
      let add = (target - n.wd + 7) % 7;
      const p = mskParts(Date.UTC(n.y, n.m, n.d + add, 12));
      day = { y: p.y, m: p.m, d: p.d, sameWeekday: add === 0 };
      explicitDay = true;
      t = t.replace(new RegExp(wdm[0], "i"), " ");
    }
  }
  if (!day) {
    const dm = lower().match(/(?:^|\s)(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?=\s|$|[,!?])/);
    if (dm && +dm[1] <= 31 && +dm[2] >= 1 && +dm[2] <= 12) {
      const y = dm[3] ? (dm[3].length === 2 ? 2000 + +dm[3] : +dm[3]) : n.y;
      day = { y, m: +dm[2] - 1, d: +dm[1] };
      if (!dm[3] && fromMsk(y, day.m, day.d, 23, 59) < now) day.y++;
      explicitDay = true;
      t = t.replace(dm[0], " ");
    }
  }
  if (!day) {
    const mm = lower().match(/(\d{1,2})\s+(январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-я]*/);
    if (mm) {
      const m = MONTHS.findIndex((x) => mm[2].startsWith(x));
      day = { y: n.y, m, d: +mm[1] };
      if (fromMsk(n.y, m, +mm[1], 23, 59) < now) day.y++;
      explicitDay = true;
      t = t.replace(new RegExp(mm[0], "i"), " ");
    }
  }

  // Время: «в 12», «в 12:30», «12:30», «к 9 утра», «в 3 дня», «12 по мск», «в полдень», «утром/днём/вечером»
  let tm =
    lower().match(/(?:в|к|на)\s*(\d{1,2})[:.](\d{2})\s*(утра|дня|вечера|ночи)?/) ||
    lower().match(/(?:^|\s)(\d{1,2}):(\d{2})\s*(утра|дня|вечера|ночи)?/) ||
    lower().match(/(?:в|к|на)\s*(\d{1,2})()\s*(?:час(?:а|ов)?\s*)?(утра|дня|вечера|ночи)?(?=\s|$|[,.!?])/) ||
    lower().match(/(?:^|\s)(\d{1,2})()\s*(?:час(?:а|ов)?\s*)?(утра|дня|вечера|ночи)?\s*(?=по\s*мск)/);
  if (tm && +tm[1] <= 24 && (!tm[2] || +tm[2] < 60)) {
    let h = +tm[1];
    if ((tm[3] === "дня" || tm[3] === "вечера") && h < 12) h += 12;
    if (tm[3] === "ночи" && h === 12) h = 0;
    time = { h: h % 24, mi: tm[2] ? +tm[2] : 0 };
    t = t.replace(new RegExp(tm[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
  } else {
    const soft = lower().match(/в\s+полдень|утром|днем|вечером/);
    if (soft) {
      time = { h: soft[0].includes("полдень") ? 12 : soft[0] === "утром" ? 10 : soft[0] === "днем" ? 14 : 19, mi: 0 };
      t = t.replace(new RegExp(soft[0], "i"), " ");
    }
  }
  t = t.replace(/\(?\s*по\s*мск\s*\)?|\bмск\b|по\s+москве/gi, " ");

  if (!due) {
    if (!day && !time) return { needTime: true, nick, task: cleanTask(t, nick), rest: t };
    const base = day || { y: n.y, m: n.m, d: n.d };
    const tt = time || { h: 10, mi: 0 };
    due = fromMsk(base.y, base.m, base.d, tt.h, tt.mi);
    if (due <= now) {
      if (day?.sameWeekday) due += 7 * 24 * HOUR;
      else if (!explicitDay) due += 24 * HOUR; // «в 9» вечером → завтра в 9
      else return { past: true, dueAt: due, nick, task: cleanTask(t, nick), rest: t };
    }
  }
  return { dueAt: due, nick, task: cleanTask(t, nick), explicitTime: !!time || !!rel, rest: t };
}

function cleanTask(t, nick) {
  let s = t
    .replace(/^\s*(привет|здорово|хай|слушай|бот)[,!.\s]*/i, " ")
    .replace(/(пожалуйста|плз|pls)/gi, " ")
    .replace(/напомни(те|ть)?(\s+мне)?|напоминание/gi, " ")
    .replace(/\s(о|об|про)\s+(том|то),?\s*(что|чтобы)?/gi, " ")
    .replace(/^[\s,.:;—-]*(что|чтобы)\s/i, " ")
    .replace(/(с|у|для|по)\s+лид(ом|а|у)?(?=[\s,.!?]|$)/gi, " ")
    .replace(nick ? /(^|\s)лид(ом|а|у)?(?=[\s,.!?]|$)/gi : /$^/, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.:;—-]+|[\s,.:;—-]+$/g, "")
    .trim();
  s = s.replace(/^(что|чтобы)\s+/i, "");
  if (!s) s = nick ? "Вернуться к лиду" : "Напоминание";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- команда: «созвон завтра в 15 к Тёме @ivan Иван» ----------
const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е");
// Короткие формы имён: Тёма/Артём, Дима/Дмитрий, Андрей, Лёха/Алексей.
const NAME_FORMS = {
  артем: ["тема", "тем", "артем", "темы", "теме", "тему", "темой", "артема", "артему"],
  дмитрий: ["дима", "димы", "диме", "диму", "димой", "дмитрий", "дмитрию", "дмитрия"],
  андрей: ["андрей", "андрея", "андрею", "андреем", "андрюха"],
  алексей: ["леха", "лехе", "леху", "лехи", "алексей", "алексею", "алексея", "леша", "леше"],
};

export function findUserInText(text, users) {
  const words = norm(text).split(/[^a-zа-я0-9_]+/).filter(Boolean);
  for (const u of users) {
    const first = norm(u.name).split(/\s+/)[0];
    const forms = new Set([first, first.slice(0, -1) + "е", first.slice(0, -1) + "ы", first.slice(0, -1) + "у", first + "у", first + "а", first + "е"]);
    for (const [, list] of Object.entries(NAME_FORMS)) if (list.includes(first)) list.forEach((f) => forms.add(f));
    if (u.username) forms.add(norm(u.username));
    if (words.some((w) => w.length >= 3 && forms.has(w))) return u;
  }
  return null;
}

// Запись на созвон из текста. null — это не про созвон.
export function parseBooking(text, users, now = Date.now()) {
  const strong = /созвон|запиш|диагностик|звонок на|окно на/i.test(text);
  // «поставил лида Теме на 19», «назначь Диме на завтра 15:00» — запись, если есть время
  const weak = /постав|назнач/i.test(text);
  if (!strong && !weak) return null;
  const when = parseReminder(text, now, { force: true });
  if (!strong && !when.dueAt) return null;
  const mop = findUserInText(text, users);
  const STOP = new Set(["созвон", "созвона", "созвоне", "созвоны", "запиши", "запишите", "записал", "записала", "диагностика", "диагностику", "звонок", "окно", "на", "к", "ко", "у", "с", "в", "во", "для", "клиент", "клиента", "лид", "лида", "по", "мск", "и", "это", "его", "ее", "лида", "лид", "лиду", "поставил", "поставила", "поставь", "поставлю", "назначил", "назначила", "назначь", "назначаю", "напомни", "напомнить", "прямо", "сейчас", "срочно", "пожалуйста", "ему", "ей", "плиз", "тоже", "уже", "а", "так"]);
  let raw = String(when.rest || "");
  const phone = (raw.match(/\+?\d[\d\s()-]{9,}\d/) || [])[0]?.replace(/[^\d+]/g, "") || "";
  if (phone) raw = raw.replace(/\+?\d[\d\s()-]{9,}\d/, " ");
  const tokens = raw.split(/[^A-Za-zА-Яа-яЁё-]+/).filter(Boolean).filter((w) => {
    const n = norm(w);
    return n.length > 1 && !STOP.has(n) && !(mop && findUserInText(n, [mop]));
  });
  const name = tokens.slice(0, 3).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  return {
    at: when.dueAt || null,
    needTime: !!when.needTime || (when.dueAt && !when.explicitTime),
    past: !!when.past,
    mop,
    nick: when.nick,
    name,
    phone,
  };
}

// «окна завтра у Темы», «свободно в пятницу Дима»
export function parseWindows(text, users, now = Date.now()) {
  if (!/^\s*(окна|окно|свободн|когда свободен)/i.test(text)) return null;
  const when = parseReminder(text, now, { force: true });
  const day = when.dueAt ? mskDateKey(when.dueAt) : mskDateKey(now);
  return { day, mop: findUserInText(text, users) };
}

// «Теме: перезвони клиенту», «напиши Диме что …», «всем: планерка в 11» → кому и что.
export function parseRelay(text, users) {
  const all = text.match(/^\s*(всем|команде|команда)\s*[:,—-]?\s*([\s\S]+)/i);
  if (all) return { all: true, text: all[2].trim() };
  const target = findUserInText(text.split(/[:\n]/)[0].slice(0, 60), users) || findUserInText(text, users);
  if (!target) return null;
  return { to: target, text: text.trim() };
}
