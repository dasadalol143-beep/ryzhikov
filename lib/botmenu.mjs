// Тексты и кнопки бота: меню, карточка лида, цифры, поиск. Чистые функции — легко тестировать.
import { leadMoney, sumMoney, ACTIVE_STAGES } from "../public/economics.js";
import { paidEvents, todayKey, networkReport } from "../public/insights.js";
import { STAGE_LABELS, TAG_LABELS, statusKey, statusLabel, nextStatusFor } from "../public/labels.js";
import { escapeHtml as h } from "./telegram.mjs";

const rub = (n) => `${Math.round(n || 0).toLocaleString("ru-RU")} ₽`;
export const shortId = (id) => id.slice(0, 12);

export const MENU = {
  digest: "☀️ Сводка",
  numbers: "📊 Цифры",
  reminders: "⏰ Напоминания",
  search: "🔎 Найти лида",
  add: "➕ Завести лида",
  help: "❓ Помощь",
};

// Постоянная клавиатура внизу чата — всегда видно, что можно нажать.
export const menuKeyboard = (appUrl) => ({
  keyboard: [
    [{ text: "📱 Открыть CRM", web_app: { url: appUrl } }],
    [{ text: MENU.digest }, { text: MENU.numbers }],
    [{ text: MENU.reminders }, { text: MENU.search }],
    [{ text: MENU.add }, { text: MENU.help }],
  ],
  resize_keyboard: true,
  is_persistent: true,
});

export const HELP = [
  "👋 <b>Это бот вашей CRM.</b> Всё, что умеет, — в кнопках внизу.",
  "",
  "📱 <b>Открыть CRM</b> — само приложение: лиды, офферы, деньги, статистика.",
  "☀️ <b>Сводка</b> — что сделать сегодня: напоминания, кому нужна ЦД, кого пинать за засчёт.",
  "📊 <b>Цифры</b> — сколько засчитали за месяц, прошлый месяц и всё время, сколько в работе.",
  "⏰ <b>Напоминания</b> — список твоих напоминаний, любое можно отменить.",
  "🔎 <b>Найти лида</b> — напиши ник, имя или телефон, пришлю карточку с кнопками.",
  "➕ <b>Завести лида</b> — как добавить нового человека.",
  "",
  "<b>Быстро без кнопок:</b>",
  "• Перешли сообщение человека — заведу лида",
  "• <code>@nick</code> — открою карточку (или создам, если нет)",
  "• <code>напомни завтра в 12 сделать ЦД с @nick</code> — напомню в срок (время МСК)",
].join("\n");

export const ADD_HELP = [
  "➕ <b>Как завести лида — 3 способа:</b>",
  "",
  "1️⃣ <b>Перешли</b> сюда любое сообщение этого человека — возьму ник и имя.",
  "2️⃣ <b>Отправь контакт</b>: скрепка 📎 → Контакт — возьму имя и телефон.",
  "3️⃣ <b>Напиши</b>: <code>@nick Иванов Иван +79001234567</code> — в любом порядке, лишнее можно не писать.",
  "",
  "Если такой лид уже есть — не создам копию, а покажу его карточку.",
].join("\n");

export function leadCard(lead, offers, settings, appUrl) {
  const m = leadMoney(lead, offers, settings);
  const catalog = new Map(offers.map((o) => [o.id, o]));
  const live = Object.entries(lead.offers || {}).filter(([, lo]) => ["applied", "opened", "done", "paid"].includes(lo.status));
  const order = { opened: 0, applied: 1, done: 2, paid: 3 };
  live.sort((a, b) => order[a[1].status] - order[b[1].status]);
  const lines = [
    `👤 <b>${h(lead.telegram || lead.fio || "Без имени")}</b>${lead.telegram && lead.fio ? ` · ${h(lead.fio)}` : ""}`,
    `Этап: <b>${STAGE_LABELS[lead.stage] || lead.stage}</b>${lead.tags?.length ? ` · 🏷 ${lead.tags.map((t) => TAG_LABELS[t]).join(", ")}` : ""}${lead.phone ? ` · 📞 ${h(lead.phone)}` : ""}`,
    "",
    `💰 Чистыми: <b>${rub(m.net)}</b> · в работе: ${rub(m.inWork)} · ждём засчёта: ${rub(m.waiting)}`,
  ];
  if (live.length) {
    lines.push("", "<b>Офферы:</b>");
    for (const [id, lo] of live.slice(0, 12)) lines.push(`• ${h(catalog.get(id)?.name || id)} — ${statusLabel(statusKey(lo), catalog.get(id)?.category, true)} · ${rub(lo.amount)}`);
  }
  if (lead.nextStep) lines.push("", `➡️ Следующий шаг: ${h(lead.nextStep)}${lead.remindAt ? ` (${lead.remindAt.split("-").reverse().slice(0, 2).join(".")})` : ""}`);
  const kb = [[{ text: "📱 Открыть в CRM", web_app: { url: `${appUrl}?lead=${lead.id}` } }]];
  const row = [];
  if (lead.telegram?.startsWith("@")) row.push({ text: "✉️ Написать", url: `https://t.me/${lead.telegram.slice(1)}` });
  row.push({ text: "⏰ Завтра в 10", callback_data: `rem1:${shortId(lead.id)}` });
  kb.push(row);
  if (live.some(([, lo]) => lo.status !== "paid")) kb.push([{ text: "🔄 Отметить прогресс по офферам", callback_data: `lstat:${shortId(lead.id)}` }]);
  return { text: lines.join("\n"), markup: { inline_keyboard: kb } };
}

// Кнопки «следующий шаг» по каждому офферу в работе.
export function offerButtons(lead, offers) {
  const catalog = new Map(offers.map((o) => [o.id, o]));
  const cat = (id) => catalog.get(id)?.category;
  const rows = Object.entries(lead.offers || {})
    .filter(([id, lo]) => nextStatusFor(lo.status, cat(id)))
    .slice(0, 10)
    .map(([id, lo]) => [{ text: `${(catalog.get(id)?.name || id).replace(/ — РКО$/, "")}: ${statusLabel(lo.status, cat(id), true)} → ${statusLabel(nextStatusFor(lo.status, cat(id)), cat(id), true)}`, callback_data: `adv:${shortId(lead.id)}:${id}` }]);
  rows.push([{ text: "← К карточке", callback_data: `lead:${shortId(lead.id)}` }]);
  return { inline_keyboard: rows };
}

export function numbersText(leads, offers, settings, payouts, { networks = false, now = Date.now() } = {}) {
  const today = todayKey(now);
  const thisMonth = today.slice(0, 7);
  const d = new Date(`${thisMonth}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  const prevMonth = d.toISOString().slice(0, 7);
  const paid = paidEvents(leads, offers);
  const sum = (arr) => arr.reduce((s, e) => s + e.amount, 0);
  const cur = sum(paid.filter((e) => e.day?.startsWith(thisMonth)));
  const prev = sum(paid.filter((e) => e.day?.startsWith(prevMonth)));
  const t = sumMoney(leads.map((l) => leadMoney(l, offers, settings)));
  const active = leads.filter((l) => ACTIVE_STAGES.has(l.stage)).length;
  const lines = [
    "📊 <b>Цифры</b>",
    "",
    `Этот месяц: <b>${rub(cur)}</b> засчитано${settings.monthlyGoal ? ` · план ${rub(settings.monthlyGoal)} (${Math.round((cur / settings.monthlyGoal) * 100)}%)` : ""}`,
    `Прошлый месяц: ${rub(prev)}`,
    `За всё время: <b>${rub(t.income)}</b> · чистыми ${rub(t.net)}`,
    "",
    `⏳ Ждём засчёта: ${rub(t.waiting)}`,
    `🎯 В работе (заявки и счета): ${rub(t.inWork)}`,
    `👥 Лидов: ${leads.length}, активных ${active}`,
  ];
  if (networks) {
    const debt = networkReport(leads, offers, payouts).reduce((s, n) => s + n.debt, 0);
    if (debt) lines.push(`🏦 Сети не доплатили: <b>${rub(debt)}</b>`);
  }
  return lines.join("\n");
}

export function searchLeads(leads, query) {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  const digits = q.replace(/\D/g, "");
  if (!q) return [];
  return leads
    .filter((l) => {
      const nick = (l.telegram || "").toLowerCase().replace(/^@/, "");
      const fio = (l.fio || "").toLowerCase();
      const phone = (l.phone || "").replace(/\D/g, "");
      return nick.includes(q) || fio.includes(q) || (digits.length >= 4 && phone.includes(digits));
    })
    .slice(0, 10);
}

export const resultsMarkup = (found) => ({
  inline_keyboard: found.map((l) => [{ text: `${l.telegram || l.fio}${l.telegram && l.fio ? ` · ${l.fio}` : ""} — ${STAGE_LABELS[l.stage] || ""}`, callback_data: `lead:${shortId(l.id)}` }]),
});
