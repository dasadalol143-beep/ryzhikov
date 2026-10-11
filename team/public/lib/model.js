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
];
export const STATUS_IDS = STATUSES.map((s) => s.id);
export const statusLabel = (id) => STATUSES.find((s) => s.id === id)?.label || id;
export const statusGroup = (id) => STATUSES.find((s) => s.id === id)?.group || "lead";
export const isClosed = (status) => ["paid", "refuse_personal", "refuse_bank", "ignore", "invalid"].includes(status);

// Чем закончился созвон / что ставит диагност после созвона.
export const AFTER_CALL = ["paid", "prepaid", "thinking", "resched", "refuse_personal", "refuse_bank"];

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
export const needsReport = (c) => (c.calls || []).some((x) => x.outcome === "held" && !x.reportAt);

// Дожим: «Думает»/«Перенос без даты»/«НДЗ» без нового созвона — касания каждый день, 3 подряд.
export function followupState(c, now = Date.now()) {
  if (!["thinking", "ndz1", "ndz2", "ndz3", "prepaid"].includes(c.status)) return null;
  if (currentCall(c)) return null;
  const since = c.statusAt ? Date.parse(c.statusAt) : now;
  const touches = (c.touches || []).filter((t) => Date.parse(t.at) >= since);
  const touchedToday = touches.some((t) => mskKey(Date.parse(t.at)) === mskKey(now));
  return { touches: touches.length, touchedToday, due: !touchedToday && touches.length < FOLLOWUP_TOUCHES, exhausted: touches.length >= FOLLOWUP_TOUCHES };
}
