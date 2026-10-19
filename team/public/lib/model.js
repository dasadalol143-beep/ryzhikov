// Общая модель: роли, статусы из регламента ОП, формулы зарплатной ведомости.
// Файл чистый (без DOM и сети) — его импортируют и фронт, и воркер.

export const ROLES = {
  owner: "Собственник",
  rop: "РОП",
  mop: "Менеджер ОП",
  lidorub: "Лидоруб",
};
// Кто видит зарплатную ведомость и правит настройки.
export const MONEY_ROLES = ["owner", "rop"];
export const canSeeMoney = (role) => MONEY_ROLES.includes(role);

// Статусы CRM из регламента + «Новый» (лидоруб ещё квалифицирует) и «Предоплата» (есть в РнП).
export const STATUSES = [
  { id: "new", label: "Новый", group: "lead" },
  { id: "in_work", label: "В работе", group: "work" },
  { id: "ndz1", label: "НДЗ-1", group: "ndz" },
  { id: "ndz2", label: "НДЗ-2", group: "ndz" },
  { id: "ndz3", label: "НДЗ-3", group: "ndz" },
  { id: "resched", label: "Перенос", group: "work" },
  { id: "thinking", label: "Думает", group: "hot" },
  { id: "prepaid", label: "Предоплата", group: "hot" },
  { id: "paid", label: "Оплатил", group: "won" },
  { id: "refuse_personal", label: "Отказ по личным", group: "lost" },
  { id: "refuse_bank", label: "Отказ по банкам", group: "lost" },
  { id: "ignore", label: "Игнор", group: "lost" },
  { id: "invalid", label: "Невалид", group: "lost" },
  // Был записан в «Окна для звонков», но в CRM-таблицу не попал — храним в базе, в работе не показываем.
  { id: "archive", label: "Архив", group: "lost" },
];
export const STATUS_IDS = STATUSES.map((s) => s.id);
export const statusLabel = (id) => STATUSES.find((s) => s.id === id)?.label || id;
export const statusGroup = (id) => STATUSES.find((s) => s.id === id)?.group || "lead";
export const isClosed = (status) => ["paid", "refuse_personal", "refuse_bank", "ignore", "invalid", "archive"].includes(status);

// Чем закончился созвон / что ставит диагност после созвона.
export const AFTER_CALL = ["paid", "prepaid", "thinking", "resched", "refuse_personal", "refuse_bank", "invalid"];

export const SOURCES = ["Новая заявка", "Работа по базе", "Интенсив", "Рекомендация", "Другое"];

// Форма отчёта после диагностики — поля 1-в-1 из регламента.
export const REPORT_FIELDS = [
  { id: "need", label: "Потребность / запрос клиента" },
  { id: "occupation", label: "Род деятельности" },
  { id: "dream", label: "О чём глобально мечтает (главная боль)" },
  { id: "objection", label: "Основное возражение" },
  { id: "nextStep", label: "Следующий шаг, договорённости" },
];

// Дожим: 3 касания по дням, после третьего без ответа — «Игнор».
export const FOLLOWUP_TOUCHES = 3;

// ---------- время: вся команда живёт по Москве ----------
export const MSK = 3 * 3600_000;
export const mskKey = (ts = Date.now()) => new Date(Number(ts) + MSK).toISOString().slice(0, 10);
export const mskTime = (ts) => new Date(Number(ts) + MSK).toISOString().slice(11, 16);
export const mskMidnight = (key) => Date.parse(`${key}T00:00:00Z`) - MSK; // ts начала дня по МСК
export const addDaysKey = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
export const monthKey = (key) => key.slice(0, 7);
export const fmtDay = (key) => (key ? `${key.slice(8, 10)}.${key.slice(5, 7)}` : "");
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
export const weekday = (key) => WD[new Date(`${key}T00:00:00Z`).getUTCDay()];
export const fmtWhen = (ts) => `${fmtDay(mskKey(ts))} (${weekday(mskKey(ts))}) ${mskTime(ts)}`;
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
export const monthName = (mk) => MONTHS[Number(mk.slice(5, 7)) - 1] || mk;

// ---------- зарплатная ведомость ----------
// Формулы из «Зарплатная ведомость РКО»:
//   комиссия = тариф − чистая;  налог = чистая × 7%;  база = чистая − налог;
//   МОП = база × 10%;  РОП = база × 3%;  лидоруб = база × 2%;
//   остаётся чистыми = чистая − налог − МОП − РОП − лидоруб.
export const DEFAULT_RATES = { tax: 7, mop: 10, rop: 3, lidorub: 2 };

const r2 = (n) => Math.round(n * 100) / 100;

export function payrollRow(p, rates = DEFAULT_RATES) {
  const tariff = Number(p.tariff) || 0;
  const net = Number(p.net) || 0;
  const tax = r2((net * rates.tax) / 100);
  const base = net - tax;
  return {
    tariff,
    net,
    commission: r2(tariff - net),
    commissionPct: tariff ? Math.round(((tariff - net) / tariff) * 1000) / 10 : 0,
    tax,
    mop: r2((base * rates.mop) / 100),
    rop: r2((base * rates.rop) / 100),
    lidorub: r2((base * rates.lidorub) / 100),
  };
}

// Сводка за месяц: как листы «Октябрь», «Сентябрь (закрыт)» + блоки «Итого» у каждого МОПа.
// Считаем только верифицированные оплаты — их и выплачиваем; остальные отдельно «ждут проверки».
export function monthSummary(payments, mk, rates = DEFAULT_RATES) {
  const inMonth = payments.filter((p) => p.date?.startsWith(mk));
  const sum = (rows, f) => r2(rows.reduce((s, r) => s + f(r), 0));
  const verified = inMonth.filter((p) => p.verified);
  const rows = verified.map((p) => ({ p, c: payrollRow(p, rates) }));
  const byMop = {};
  for (const { p, c } of rows) {
    const m = (byMop[p.mopId || "—"] ||= { mopId: p.mopId || null, count: 0, tariff: 0, net: 0, reward: 0 });
    m.count++;
    m.tariff = r2(m.tariff + c.tariff);
    m.net = r2(m.net + c.net);
    m.reward = r2(m.reward + c.mop);
  }
  const totals = {
    count: rows.length,
    tariff: sum(rows, (r) => r.c.tariff),
    net: sum(rows, (r) => r.c.net),
    commission: sum(rows, (r) => r.c.commission),
    tax: sum(rows, (r) => r.c.tax),
    mop: sum(rows, (r) => r.c.mop),
    rop: sum(rows, (r) => r.c.rop),
    lidorub: sum(rows, (r) => r.c.lidorub),
  };
  totals.left = r2(totals.net - totals.tax - totals.mop - totals.rop - totals.lidorub);
  totals.avgCheck = rows.length ? Math.round(totals.tariff / rows.length) : 0;
  const pending = inMonth.filter((p) => !p.verified);
  return {
    month: mk,
    totals,
    byMop: Object.values(byMop).sort((a, b) => b.tariff - a.tariff),
    pending: { count: pending.length, tariff: r2(pending.reduce((s, p) => s + (Number(p.tariff) || 0), 0)) },
  };
}

// ---------- клиент ----------
export const currentCall = (c) => [...(c.calls || [])].reverse().find((x) => !x.outcome) || null;
export const lastCall = (c) => (c.calls || []).at(-1) || null;
export const clientTitle = (c) => c.name || c.telegram || "Без имени";

// Сколько раз клиент не дошёл — следующий НДЗ получит номер +1.
export const ndzCount = (c) => (c.calls || []).filter((x) => x.outcome === "ndz").length;

// Созвон прошёл, а отчёта нет — главный долг диагноста по регламенту.
// Итог диагностики у клиента один. Пересозвон его не требует заново: если итог уже есть, долга нет.
export const latestReport = (c) => [...(c.calls || [])].filter((x) => x.report).sort((a, b) => Date.parse(b.reportAt || b.at) - Date.parse(a.reportAt || a.at))[0] || null;
export const needsReport = (c) => !latestReport(c) && (c.calls || []).some((x) => x.outcome === "held" && !x.reportAt && !x.legacy);
// «Диагностика» — первый проведённый созвон, дальше — «Пересозвон 1, 2…».
export function callKind(c, call) {
  const done = (c.calls || []).filter((x) => x.outcome === "held" || (!x.outcome && x.id === call.id) || x.id === call.id).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const firstHeld = (c.calls || []).filter((x) => x.outcome === "held").sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  if (!firstHeld || Date.parse(call.at) <= Date.parse(firstHeld.at)) return "Диагностика";
  const n = done.filter((x) => Date.parse(x.at) > Date.parse(firstHeld.at) && Date.parse(x.at) <= Date.parse(call.at)).length;
  return n > 1 ? `Пересозвон ${n}` : "Пересозвон";
}

// Дожим: «Думает»/«Перенос без даты»/«НДЗ» без нового созвона — касания каждый день, 3 подряд.
export function followupState(c, now = Date.now()) {
  if (!["thinking", "ndz1", "ndz2", "ndz3", "prepaid"].includes(c.status)) return null;
  if (currentCall(c)) return null;
  // Старые клиенты из CRM-таблицы не сыпем в ежедневный дожим, пока с ними не начали работать в приложении
  if (c.fromSheet && !(c.calls || []).some((x) => !x.legacy) && !(c.touches || []).length) return null;
  const since = c.statusAt ? Date.parse(c.statusAt) : now;
  const touches = (c.touches || []).filter((t) => Date.parse(t.at) >= since);
  const touchedToday = touches.some((t) => mskKey(Date.parse(t.at)) === mskKey(now));
  return { touches: touches.length, touchedToday, due: !touchedToday && touches.length < FOLLOWUP_TOUCHES, exhausted: touches.length >= FOLLOWUP_TOUCHES };
}

// ---------- ссылки на оплату ----------
// commission — комиссия рассрочки в % (чистая = сумма × (1 − комиссия)). null — не знаем, РОП внесёт руками.
export const DEFAULT_PAY_LINKS = [
  { id: "tb-105", provider: "Т-Банк", label: "105к · Т-Банк", amount: 105000, commission: null, url: "https://link.tbank.ru/9GP6Nnmda3A", note: "" },
  { id: "tb-100-31", provider: "Т-Банк", label: "100к · Т-Банк · 31%", amount: 100000, commission: 31, url: "https://link.tinkoff.ru/6thz4EczA4l", note: "" },
  { id: "tb-100-27", provider: "Т-Банк", label: "100к · Т-Банк · 27,5%", amount: 100000, commission: 27.5, url: "https://link.tinkoff.ru/7NVYPhE2z2C", note: "" },
  { id: "tb-100-19", provider: "Т-Банк", label: "100к · Т-Банк · 18,9%", amount: 100000, commission: 18.9, url: "https://link.tinkoff.ru/2UaO7wWdE2D", note: "Для 21+ (шансы выше). Не одобрили — следом ссылка на 31%" },
  { id: "tb-80", provider: "Т-Банк", label: "80к · Т-Банк", amount: 80000, commission: null, url: "https://link.tinkoff.ru/kMUDA45HYU", note: "" },
  { id: "tb-70", provider: "Т-Банк", label: "70к · Т-Банк", amount: 70000, commission: null, url: "https://link.tinkoff.ru/6kIjrDpuk0t", note: "" },
  { id: "tb-50", provider: "Т-Банк", label: "50к · Т-Банк", amount: 50000, commission: null, url: "https://link.tinkoff.ru/6Z7jgR307T7", note: "" },
  { id: "tb-40", provider: "Т-Банк", label: "40к · Т-Банк", amount: 40000, commission: null, url: "https://link.tbank.ru/7Pnl9uIQD1P", note: "" },
  { id: "rr-100", provider: "Ресурс развития", label: "100к · Ресурс развития", amount: 100000, commission: null, url: "https://pay.rrllc.ru/r-b-academy-100000", note: "" },
  { id: "pr-100", provider: "Продамус", label: "100к · Продамус", amount: 100000, commission: null, url: "https://payform.ru/jqbd1JX/", note: "Всегда да, Фреш кредит и др." },
  { id: "pr-90", provider: "Продамус", label: "90к · Продамус", amount: 90000, commission: null, url: "https://payform.ru/omcwxn8/", note: "" },
  { id: "pr-80", provider: "Продамус", label: "80к · Продамус (Фреш кредит)", amount: 80000, commission: null, url: "https://payform.ru/aac051q/", note: "Всегда да, Фреш кредит и др." },
  { id: "pr-70", provider: "Продамус", label: "70к · Продамус", amount: 70000, commission: null, url: "https://payform.ru/8rb9FgL/", note: "Всегда да, Фреш кредит и др." },
  { id: "pr-50", provider: "Продамус", label: "50к · Продамус", amount: 50000, commission: null, url: "https://payform.ru/ljaU8A0/", note: "Всегда да, Фреш кредит и др." },
  { id: "pr-40", provider: "Продамус", label: "40к · Продамус", amount: 40000, commission: null, url: "https://payform.ru/5ncwxta/", note: "" },
  { id: "pr-30", provider: "Продамус", label: "30к · Продамус", amount: 30000, commission: null, url: "https://payform.ru/6scwxtM/", note: "" },
];

// ---------- план и темп ----------
export function daysInMonth(mk) {
  const [y, m] = mk.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
// Сколько уже сделано, где должны быть к сегодняшнему дню, прогноз на конец месяца и сколько нужно в день.
export function pace(done, plan, today) {
  const mk = today.slice(0, 7);
  const total = daysInMonth(mk);
  const day = Number(today.slice(8, 10));
  const expected = plan ? Math.round((plan * day) / total) : 0;
  const forecast = day ? Math.round((done / day) * total) : 0;
  const left = Math.max(0, plan - done);
  const daysLeft = total - day + 1;
  return { done, plan, expected, forecast, left, perDay: daysLeft ? Math.ceil(left / daysLeft) : left, perDayRaw: daysLeft ? left / daysLeft : left, daysLeft, ahead: done - expected, pct: plan ? done / plan : null, dayPct: day / total };
}

// ---------- окна диагностов ----------
// Окно — когда диагност готов брать созвоны: { mopId, day, ranges: [{ from: "18:00", to: "21:00" }] }.
// Созвон ~час: «18–21» = слоты 18:00, 19:00, 20:00. Занят, если созвон ближе 45 минут.
export const SLOT_MIN = 60;
export const toMin = (t) => (/^\d{1,2}:\d{2}$/.test(t || "") ? Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]) : null);
export const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const rangesText = (ranges = []) => ranges.map((r) => `${r.from}–${r.to}`).join(", ");

export function cleanRanges(ranges) {
  const out = [];
  for (const r of Array.isArray(ranges) ? ranges : []) {
    const a = toMin(r?.from);
    const b = toMin(r?.to);
    if (a === null || b === null || b <= a || b > 24 * 60) continue;
    out.push([a, b]);
  }
  out.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [a, b] of out) {
    const last = merged.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged.map(([a, b]) => ({ from: fromMin(a), to: fromMin(b) }));
}

// Слоты дня: окна + созвоны вне окон. busy: [{ time: "HH:MM", ...любые данные }]
// → [{ time, inWindow, state: "free" | "busy" | "past", item }]
export function daySlots(day, ranges, busy = [], now = Date.now()) {
  const marks = new Set();
  for (const r of ranges || []) for (let m = toMin(r.from); m + SLOT_MIN <= toMin(r.to); m += SLOT_MIN) marks.add(m);
  for (const b of busy) if (toMin(b.time) !== null) marks.add(toMin(b.time));
  const taken = [...busy].map((b) => ({ ...b, m: toMin(b.time) }));
  const out = [];
  for (const m of [...marks].sort((a, b) => a - b)) {
    const exact = taken.find((b) => b.m === m);
    // Свободная отметка окна, рядом с которой уже стоит созвон (18:30 рядом с 19:00) — не показываем отдельно.
    const near = !exact && taken.find((b) => Math.abs(b.m - m) < 45);
    if (near) continue;
    const ts = Date.parse(`${day}T${fromMin(m)}:00+03:00`);
    const inWindow = (ranges || []).some((r) => toMin(r.from) <= m && m < toMin(r.to));
    out.push({ time: fromMin(m), inWindow, state: exact ? "busy" : ts < now ? "past" : "free", item: exact || null });
  }
  return out;
}

// ---------- выплаты команде ----------
// МОПу Петя платит сразу после продажи, РОПу и лидорубу — по понедельникам.
// У оплаты p.paid = { mop: "2026-10-12", rop: null, lidorub: null } — когда кому выплачено.
export const PAYOUT_ROLES = { rop: "РОП", lidorub: "Лидоруб", mop: "МОП" };

// Кому сколько не выплачено (только верифицированные — у них есть чистая).
// mopOf(p) — id менеджера оплаты (учитывает имена из таблицы).
export function payoutsOwed(payments, users, rates = DEFAULT_RATES, { roles = ["rop", "lidorub", "mop"], mopOf = (p) => p.mopId } = {}) {
  const active = users.filter((u) => u.active !== false);
  const rop = active.find((u) => u.role === "rop");
  const lrs = active.filter((u) => u.role === "lidorub");
  const groups = {};
  const pending = [];
  for (const p of payments) {
    if (!p.verified) {
      pending.push(p);
      continue;
    }
    const row = payrollRow(p, rates);
    for (const role of roles) {
      if (p.paid?.[role] || !row[role]) continue;
      const person = role === "mop" ? mopOf(p) : role === "rop" ? rop?.id : lrs.some((u) => u.id === p.lidorubId) ? p.lidorubId : lrs[0]?.id;
      if (!person) continue;
      const g = (groups[`${role}:${person}`] ||= { role, personId: person, total: 0, items: [] });
      // Как в таблице: каждая строка — в целых рублях, итог — сумма строк.
      const amount = Math.round(row[role]);
      g.total += amount;
      g.items.push({ p, amount });
    }
  }
  const order = { rop: 0, lidorub: 1, mop: 2 };
  for (const g of Object.values(groups)) g.items.sort((a, b) => a.p.date.localeCompare(b.p.date));
  return { groups: Object.values(groups).sort((a, b) => order[a.role] - order[b.role]), pending: pending.sort((a, b) => a.date.localeCompare(b.date)) };
}

// Ближайший понедельник выплат (сегодня, если понедельник).
export function nextPayday(today) {
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay();
  return addDaysKey(today, (8 - wd) % 7);
}

// ---------- кто может менять клиента ----------
// Пока диагност не назначен — лид общий (лидоруб ведёт, записывает). Взял МОП — менять может только он, РОП и собственник.
export const isBossRole = (role) => role === "owner" || role === "rop";
export const canTouchClient = (u, c) => !!u && (isBossRole(u.role) || !c?.mopId || c.mopId === u.id);
// Удалить: руководство; до назначения МОПа — ещё тот, кто завёл, и лидоруб клиента; после — только его МОП.
export const canDeleteClient = (u, c) => !!u && (isBossRole(u.role) || (c?.mopId ? c.mopId === u.id : [c?.createdBy, c?.lidorubId].includes(u.id)));

// ---------- зависшие лиды ----------
// Лид не должен потеряться: у каждого незакрытого клиента должен быть следующий шаг.
// Возвращает причину, если шага нет, иначе null.
export function stuckReason(c, now = Date.now()) {
  if (isClosed(c.status) || c.status === "archive") return null;
  if (c.fromSheet && !(c.calls || []).some((x) => !x.legacy)) return null; // старые из таблицы, пока не взяли в работу
  const DAY = 86400_000;
  const calls = (c.calls || []).filter((x) => !x.legacy);
  const open = calls.filter((x) => !x.outcome);
  const late = open.find((x) => now - Date.parse(x.at) > DAY);
  if (late) return "созвон прошёл, итог «пришёл / НДЗ» не отмечен";
  if (needsReport(c)) {
    const h = calls.filter((x) => x.outcome === "held" && !x.reportAt).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    if (h && now - Date.parse(h.outcomeAt || h.at) > DAY) return "созвон проведён, итог не заполнен больше суток";
  }
  if (open.length) return null;
  const since = Date.parse(c.statusAt || c.updatedAt || c.createdAt);
  const touched = Math.max(since, ...(c.touches || []).map((t) => Date.parse(t.at)), ...calls.map((x) => Date.parse(x.outcomeAt || x.at)));
  if (c.status === "new" && now - Date.parse(c.createdAt) > 2 * DAY) return "новый лид 2+ дня без записи на созвон";
  if (c.status === "in_work" && now - touched > 2 * DAY) return "в работе, но нет созвона и решения 2+ дня";
  if (["thinking", "prepaid", "resched", "ndz1", "ndz2", "ndz3"].includes(c.status) && now - touched > 4 * DAY) return "дожим заброшен: 4+ дня без касаний";
  if (!c.mopId && !c.lidorubId && now - Date.parse(c.createdAt) > DAY) return "нет ответственного";
  return null;
}
