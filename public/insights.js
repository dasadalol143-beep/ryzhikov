// Что делать сегодня и как идут деньги — общая логика для экрана «Сегодня», статистики и утренней сводки.
import { ACTIVE_STAGES } from "./economics.js";

const DAY = 86400000;
export const TZ_OFFSET_HOURS = 3; // рабочий день считаем по Москве

export const dayKey = (iso, offset = TZ_OFFSET_HOURS) => new Date(new Date(iso).getTime() + offset * 3600000).toISOString().slice(0, 10);
export const todayKey = (now = Date.now()) => dayKey(new Date(now).toISOString());
export const addDays = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const daysSince = (iso, now = Date.now()) => (iso ? Math.floor((now - Date.parse(iso)) / DAY) : null);

const offerName = (offers, id) => offers.find((o) => o.id === id)?.name || id;

export function worklist(leads, offers, now = Date.now()) {
  const today = todayKey(now);
  const reminders = [];
  const needCd = [];
  const waiting = [];
  const applied = [];
  const stale = [];
  const dues = [];
  const onCard = [];

  for (const lead of leads) {
    const active = ACTIVE_STAGES.has(lead.stage);
    if (lead.remindAt && lead.remindAt <= today) reminders.push({ lead, overdue: lead.remindAt < today });

    const by = { opened: [], done: [], applied: [] };
    for (const [id, lo] of Object.entries(lead.offers || {})) {
      if (lo.dueAt && lo.dueAt <= today && !["paid", "rejected", "exists"].includes(lo.status)) {
        dues.push({ lead, id, name: offerName(offers, id), status: lo.status, amount: lo.amount, dueAt: lo.dueAt, overdue: lo.dueAt < today });
      }
      if (lo.status === "paid" && lo.onCard) onCard.push({ lead, id, name: offerName(offers, id), amount: lo.amount, days: daysSince(lo.changedAt, now) });
      if (by[lo.status]) by[lo.status].push({ id, name: offerName(offers, id), amount: lo.amount, days: daysSince(lo.changedAt, now) });
    }
    const sum = (items) => items.reduce((s, i) => s + i.amount, 0);
    const oldest = (items) => Math.max(0, ...items.map((i) => i.days ?? 0));

    if (active && by.opened.length) needCd.push({ lead, items: by.opened, sum: sum(by.opened), days: oldest(by.opened) });
    if (by.done.length) waiting.push({ lead, items: by.done, sum: sum(by.done), days: oldest(by.done) });
    if (active && by.applied.length) applied.push({ lead, items: by.applied, sum: sum(by.applied), days: oldest(by.applied) });

    const idle = daysSince(lead.updatedAt, now);
    if (active && idle >= 5 && (by.opened.length || by.applied.length)) stale.push({ lead, days: idle, sum: sum(by.opened) + sum(by.applied) });
  }

  const bySum = (a, b) => b.sum - a.sum;
  return {
    dues: dues.sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    reminders: reminders.sort((a, b) => (a.lead.remindAt || "").localeCompare(b.lead.remindAt || "")),
    needCd: needCd.sort(bySum),
    waiting: waiting.sort((a, b) => b.days - a.days || b.sum - a.sum),
    applied: applied.sort(bySum),
    stale: stale.sort((a, b) => b.days - a.days),
    onCard: onCard.sort((a, b) => (b.days ?? 0) - (a.days ?? 0)),
  };
}

// Засчитанные офферы с датой засчёта (у импортированных из таблицы даты нет — они идут только в «за всё время»).
export function paidEvents(leads, offers) {
  const catalog = new Map(offers.map((o) => [o.id, o]));
  const out = [];
  for (const lead of leads) {
    for (const [id, lo] of Object.entries(lead.offers || {})) {
      if (lo.status !== "paid") continue;
      const o = catalog.get(id);
      out.push({ lead, offerId: id, name: o?.name || id, partner: lo.network || o?.partner || "", category: o?.category || "rko", amount: lo.amount, day: lo.changedAt ? dayKey(lo.changedAt) : null });
    }
  }
  return out;
}

export const netOf = (income, settings) => {
  const tax = (income * settings.taxRate) / 100;
  return income - tax - ((income - tax) * settings.partnerShare) / 100;
};

// Сверка с партнёрскими сетями: засчитано vs получено, по каждому офферу.
export const networkOf = (lo, offer) => lo.network || offer?.partner || "Без сети";

export function networkReport(leads, offers, payouts = []) {
  const catalog = new Map(offers.map((o) => [o.id, o]));
  const nets = new Map();
  const get = (name) => {
    if (!nets.has(name)) nets.set(name, { network: name, paid: 0, received: 0, waiting: 0, unpaid: [], payouts: 0 });
    return nets.get(name);
  };
  for (const lead of leads) {
    for (const [id, lo] of Object.entries(lead.offers || {})) {
      if (lo.status !== "paid" && lo.status !== "done") continue;
      const o = catalog.get(id);
      const n = get(networkOf(lo, o));
      if (lo.status === "done") {
        n.waiting += lo.amount;
        continue;
      }
      n.paid += lo.amount;
      if (lo.received) n.received += lo.amount;
      else n.unpaid.push({ lead, offerId: id, name: o?.name || id, amount: lo.amount, day: lo.changedAt ? dayKey(lo.changedAt) : null });
    }
  }
  for (const p of payouts) get(p.network).payouts += p.amount;
  return [...nets.values()]
    .map((n) => ({ ...n, debt: n.paid - n.received, unpaid: n.unpaid.sort((a, b) => (a.day || "").localeCompare(b.day || "")) }))
    .sort((a, b) => b.debt - a.debt || b.paid - a.paid);
}
