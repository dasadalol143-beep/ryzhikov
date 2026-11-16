// Что делать сегодня и как идут деньги — общая логика для экрана «Сегодня», статистики и утренней сводки.
import { ACTIVE_STAGES } from "./economics.js";
import { DIR_LABELS } from "./labels.js";

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

// Направления (РКО / МФО / дебетовые / кредитные / общее): засчитано, попытки, затраты на ЦД, общие расходы.
// range = { from, to } по дням МСК; офферы без даты попадают только в «всё время».
export function directionStats(leads, offers, expenses = [], range = null) {
  const catalog = new Map(offers.map((o) => [o.id, o]));
  const inRange = (day) => !range || (day && day >= range.from && day <= range.to);
  const dirs = Object.fromEntries(Object.keys(DIR_LABELS).map((d) => [d, { key: d, label: DIR_LABELS[d], tried: 0, paid: 0, income: 0, costs: 0, general: 0, costItems: [] }]));
  for (const l of leads)
    for (const [id, lo] of Object.entries(l.offers || {})) {
      if (!inRange(lo.changedAt ? dayKey(lo.changedAt) : null)) continue;
      const d = dirs[catalog.get(id)?.category] || dirs.all;
      if (lo.cost) {
        d.costs += lo.cost;
        d.costItems.push({ lead: l, offerId: id, name: catalog.get(id)?.name || id, cost: lo.cost, status: lo.status });
      }
      if (lo.status === "none" || lo.status === "exists") continue;
      d.tried++;
      if (lo.status === "paid") {
        d.paid++;
        d.income += lo.amount || 0;
      }
    }
  for (const e of expenses) if (inRange(e.date)) (dirs[e.dir] || dirs.all).general += e.amount || 0;
  return Object.values(dirs).map((d) => ({ ...d, net: d.income - d.costs - d.general }));
}

// Источники лидов: сколько привели, сколько из них принесли деньги, сколько потрачено, окупаемость.
export function sourceStats(leads, offers, expenses = [], leadMoneyFn) {
  const map = new Map();
  const get = (name) => {
    const k = (name || "").trim() || "Не указано";
    const key = k.toLowerCase();
    if (!map.has(key)) map.set(key, { label: k, leads: 0, paidLeads: 0, active: 0, income: 0, costs: 0, general: 0, inWork: 0 });
    return map.get(key);
  };
  for (const l of leads) {
    const s = get(l.source);
    const m = leadMoneyFn(l);
    s.leads++;
    if (m.income > 0) s.paidLeads++;
    if (ACTIVE_STAGES.has(l.stage)) s.active++;
    s.income += m.income;
    s.costs += m.costs + m.payout;
    s.inWork += m.inWork;
  }
  for (const e of expenses) if (e.source) get(e.source).general += e.amount || 0;
  return [...map.values()]
    .map((s) => ({ ...s, spent: s.costs + s.general, net: s.income - s.costs - s.general, conv: s.leads ? Math.round((s.paidLeads / s.leads) * 100) : 0, roi: s.costs + s.general ? Math.round(((s.income - s.costs - s.general) / (s.costs + s.general)) * 100) : null }))
    .sort((a, b) => b.income - a.income || b.leads - a.leads);
}
