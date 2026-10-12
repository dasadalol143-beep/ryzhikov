// РнП и воронка лидоруба считаются сами из карточек клиентов.
// История до запуска приложения (таблица «РнП Июль-Август») лежит в legacy и подмешивается.
import { mskKey } from "./model.js";

export const RNP_FIELDS = ["leads", "scheduled", "held", "sales", "salesSum", "prepays", "prepaySum", "bank", "bankSum", "potential", "potentialSum"];
export const LR_FIELDS = ["received", "invalid", "lm", "scheduled", "baseResponses", "baseLm", "baseScheduled"];

const zero = (fields) => Object.fromEntries(fields.map((f) => [f, 0]));
const inRange = (key, from, to) => key && (!from || key >= from) && (!to || key <= to);
const div = (a, b) => (b ? a / b : null);

export function finalizeRnp(m) {
  return {
    ...m,
    crHeld: div(m.held, m.scheduled), // CR назначено → проведено
    crSale: div(m.sales, m.held), // CR проведено → продажа
    crLeadSale: div(m.sales, m.leads), // лид → продажа
    avgCheck: m.sales ? Math.round(m.salesSum / m.sales) : 0,
    cash: m.salesSum + m.prepaySum,
  };
}

export function finalizeLr(m) {
  return {
    ...m,
    crLm: div(m.lm, m.received), // CR получено → отправлен ЛМ
    crLmScheduled: div(m.scheduled, m.lm), // CR отправлен ЛМ → назначено
    crScheduled: div(m.scheduled, m.received - m.invalid), // CR взято → назначено
    crBase: div(m.baseScheduled, m.baseResponses),
  };
}

// Перенос старых имён из таблицы на людей в приложении: { "Тема": "123456" }.
const resolver = (aliases = {}) => (name) => aliases[name] || `legacy:${name}`;

// Все события РнП: [{ person, day, field, value }]. person — id менеджера ОП.
export function rnpEvents(clients, legacy = {}, aliases = {}) {
  const out = [];
  const push = (person, day, field, value = 1) => person && day && out.push({ person, day, field, value });
  for (const c of clients) {
    for (const e of c.events || []) {
      const day = mskKey(Date.parse(e.at));
      if (e.t === "handed") push(e.mop, day, "leads");
      if (e.t === "paid") push(e.mop, day, "sales"), push(e.mop, day, "salesSum", Number(e.sum) || 0);
      if (e.t === "prepaid") push(e.mop, day, "prepays"), push(e.mop, day, "prepaySum", Number(e.sum) || 0);
      if (e.t === "refuse_bank") push(e.mop, day, "bank"), push(e.mop, day, "bankSum", Number(e.sum) || 0);
      if (e.t === "potential") push(e.mop, day, "potential"), push(e.mop, day, "potentialSum", Number(e.sum) || 0);
    }
    for (const call of c.calls || []) {
      // Созвоны из CRM-таблицы уже посчитаны в РнП-истории — не задваиваем.
      if (call.legacy) continue;
      const day = mskKey(Date.parse(call.at));
      // Перенесли заранее — созвона в этот день не было, в «назначено» не идёт.
      if (call.outcome === "moved" && Date.parse(call.movedAt || call.at) < Date.parse(call.at)) continue;
      push(call.mopId, day, "scheduled");
      if (call.outcome === "held") push(call.mopId, day, "held");
    }
  }
  const who = resolver(aliases);
  for (const [name, days] of Object.entries(legacy.rnp || {})) {
    for (const [day, row] of Object.entries(days)) for (const f of RNP_FIELDS) if (row[f]) push(who(name), day, f, row[f]);
  }
  return out;
}

export function lrEvents(clients, legacy = {}, aliases = {}) {
  const out = [];
  const push = (person, day, field, value = 1) => person && day && out.push({ person, day, field, value });
  for (const c of clients) {
    const base = c.source === "Работа по базе";
    const lr = c.lidorubId;
    if (!lr) continue;
    push(lr, mskKey(Date.parse(c.createdAt)), base ? "baseResponses" : "received");
    for (const e of c.events || []) {
      const day = mskKey(Date.parse(e.at));
      if (e.t === "lm") push(lr, day, base ? "baseLm" : "lm");
      if (e.t === "invalid") push(lr, day, "invalid");
    }
    // «Назначено диагностик за сегодня» у лидоруба — по дню, когда он записал на созвон.
    const firstByLr = (c.calls || []).find((x) => x.setBy === lr);
    if (firstByLr) push(lr, mskKey(Date.parse(firstByLr.setAt || firstByLr.at)), base ? "baseScheduled" : "scheduled");
  }
  const who = resolver(aliases);
  for (const [name, days] of Object.entries(legacy.lidorub || {})) {
    for (const [day, row] of Object.entries(days)) for (const f of LR_FIELDS) if (row[f]) push(who(name), day, f, row[f]);
  }
  return out;
}

// Свести события в таблицу: по дням, по людям и итог. people — фильтр (Set id) или null.
export function aggregate(events, fields, { from, to, people = null } = {}) {
  const days = {};
  const byPerson = {};
  const total = zero(fields);
  for (const ev of events) {
    if (!inRange(ev.day, from, to)) continue;
    if (people && !people.has(ev.person)) continue;
    (days[ev.day] ||= zero(fields))[ev.field] += ev.value;
    (byPerson[ev.person] ||= zero(fields))[ev.field] += ev.value;
    total[ev.field] += ev.value;
  }
  return { days, byPerson, total };
}

export function rnp(clients, legacy, opts = {}) {
  const a = aggregate(rnpEvents(clients, legacy, opts.aliases), RNP_FIELDS, opts);
  return {
    total: finalizeRnp(a.total),
    days: Object.fromEntries(Object.entries(a.days).map(([k, v]) => [k, finalizeRnp(v)])),
    byPerson: Object.fromEntries(Object.entries(a.byPerson).map(([k, v]) => [k, finalizeRnp(v)])),
  };
}

export function lidorubStats(clients, legacy, opts = {}) {
  const a = aggregate(lrEvents(clients, legacy, opts.aliases), LR_FIELDS, opts);
  return {
    total: finalizeLr(a.total),
    days: Object.fromEntries(Object.entries(a.days).map(([k, v]) => [k, finalizeLr(v)])),
    byPerson: Object.fromEntries(Object.entries(a.byPerson).map(([k, v]) => [k, finalizeLr(v)])),
  };
}

// Периоды для фильтра статистики.
export function periodRange(id, today = mskKey()) {
  const d = new Date(`${today}T00:00:00Z`);
  const key = (x) => x.toISOString().slice(0, 10);
  const back = (n) => key(new Date(d.getTime() - n * 86400_000));
  if (id === "today") return { from: today, to: today };
  if (id === "yesterday") return { from: back(1), to: back(1) };
  if (id === "7") return { from: back(6), to: today };
  if (id === "30") return { from: back(29), to: today };
  if (id === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (id === "prev_month") {
    const p = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
    return { from: key(p), to: key(end) };
  }
  // Половины месяца — как окна в РнП (1–15 и 16–конец).
  if (id === "half") return today.slice(8) <= "15" ? { from: `${today.slice(0, 7)}-01`, to: today } : { from: `${today.slice(0, 7)}-16`, to: today };
  return { from: null, to: null };
}
