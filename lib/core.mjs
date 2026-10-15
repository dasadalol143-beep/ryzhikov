import { randomUUID } from "node:crypto";
import { checkInitData, roleFor, parseIds } from "./auth.mjs";
import { DEFAULT_OFFERS, DEFAULT_SETTINGS, CATEGORIES, STAGES, OFFER_STATUSES } from "./offers.mjs";
import { STAGE_LABELS, STATUS_SHORT } from "../public/labels.js";
import { telegram, webhookSecret, escapeHtml } from "./telegram.mjs";
import { parseLeadMessage, BOT_HELP } from "./bot.mjs";
import { networkOf } from "../public/insights.js";
import { parseReminder, formatMsk, mskDateKey } from "./nlp.mjs";
import { REMINDERS_KEY, loadReminders, reminderText, reminderButtons } from "./reminders.mjs";
import { MENU, menuKeyboard, HELP, ADD_HELP, leadCard, offerButtons, nextStatus, numbersText, searchLeads, resultsMarkup } from "./botmenu.mjs";
import { buildDigest } from "./report.mjs";
import { sendBackup } from "./report.mjs";

const OFFERS_KEY = "offers";
const SETTINGS_KEY = "settings";
const LEAD_PREFIX = "leads/";
const ACCESS_KEY = "access";
const PAYOUTS_KEY = "payouts";
const WEBHOOK_KEY = "bot_webhook";
// Индекс «ник → id лида». list() в KV отстаёт до минуты, а get по ключу — нет:
// индекс не даёт повторному импорту или боту создать копию только что заведённого лида.
const INDEX_KEY = "lead_index";
const ROLES = ["admin", "manager"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const str = (v, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const money = (v) => {
  const n = Math.round(Number(String(v ?? "").replace(",", ".").replace(/\s/g, "")) * 100) / 100;
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 10_000_000) : 0;
};
const percent = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
};
const normTelegram = (v) => {
  const s = str(v, 64).replace(/^https?:\/\/t\.me\//i, "");
  if (!s) return "";
  return s.startsWith("@") || /^\+?\d/.test(s) ? s : `@${s}`;
};

function authenticate(req, env) {
  const header = req.headers.get("authorization") || "";
  const initData = header.startsWith("tma ") ? header.slice(4) : "";

  const { user, reason } = checkInitData(initData, env.BOT_TOKEN);
  if (!user && env.DEV_MODE === "1" && !initData) {
    return { user: { id: 0, first_name: "Dev" }, role: "admin" };
  }
  if (!user) return { reason };
  return { user, role: roleFor(user.id, env) };
}

const displayName = (u) => [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || String(u.id);

const loadOffers = async (store) => (await store.getJSON(OFFERS_KEY)) || DEFAULT_OFFERS;
const loadSettings = async (store) => ({ ...DEFAULT_SETTINGS, ...((await store.getJSON(SETTINGS_KEY)) || {}) });

async function loadLeads(store) {
  const keys = await store.list(LEAD_PREFIX);
  const leads = await Promise.all(keys.map((k) => store.getJSON(k)));
  return leads.filter(Boolean).map(normalizeLead).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// Доступ, выданный из приложения: { roles: { id: {role, name, username} }, pending: { id: {name, username, at} } }.
// ADMIN_IDS / MANAGER_IDS из окружения главнее и из приложения не меняются.
const loadAccess = async (store) => ({ roles: {}, pending: {}, ...((await store.getJSON(ACCESS_KEY)) || {}) });

const canSee = (auth, lead) => auth.role === "admin" || lead.ownerId === auth.user.id;

function sanitizeOffers(input) {
  if (!Array.isArray(input)) return null;
  const seen = new Set();
  const out = [];
  for (const o of input.slice(0, 200)) {
    const name = str(o?.name, 80);
    if (!name) continue;
    let id = str(o.id, 40).replace(/[^a-z0-9_-]/gi, "") || `o_${randomUUID().slice(0, 8)}`;
    if (seen.has(id)) id = `${id}_${out.length}`;
    seen.add(id);
    out.push({
      id,
      category: CATEGORIES.includes(o.category) ? o.category : "rko",
      name,
      partner: str(o.partner, 80),
      amount: money(o.amount),
      cost: money(o.cost),
      active: o.active !== false,
      note: str(o.note, 200),
    });
  }
  return out;
}

function sanitizeSettings(input, current) {
  return {
    taxRate: percent(input?.taxRate, current.taxRate),
    partnerShare: percent(input?.partnerShare, current.partnerShare),
    partnerName: str(input?.partnerName, 40) || current.partnerName,
    monthlyGoal: input && "monthlyGoal" in input ? money(input.monthlyGoal) : current.monthlyGoal,
    templates: Array.isArray(input?.templates)
      ? input.templates.map((t) => str(t, 600)).filter(Boolean).slice(0, 20)
      : current.templates,
  };
}

// История в самом лиде: кто и что поменял (последние 40 событий).
function logEvent(lead, by, text) {
  if (!by) return;
  lead.history = [{ at: new Date().toISOString(), by, text }, ...(lead.history || [])].slice(0, 40);
}

const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

const isIso = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));

// Старый импорт ставил офферам дату импорта, будто их засчитали в тот день. У лидов без истории
// убираем дату, если она совпадает с моментом создания: у засчётов из таблицы даты нет.
function normalizeLead(lead) {
  if (!lead) return lead;
  // Импорт из таблицы писал чужую сеть в комментарий («сеть: Leadgid») — поднимаем в поле.
  for (const lo of Object.values(lead.offers || {})) {
    const m = !lo.network && lo.comment?.match(/сеть: ([^·]+)/);
    if (m) lo.network = m[1].trim();
  }
  if (lead.history?.length) return lead;
  const created = Date.parse(lead.createdAt);
  for (const lo of Object.values(lead.offers || {})) {
    if (lo.changedAt && Math.abs(Date.parse(lo.changedAt) - created) < 5000) delete lo.changedAt;
  }
  return lead;
}

function applyLeadPatch(lead, body, offers, by, { importing = false } = {}) {
  if ("telegram" in body) lead.telegram = normTelegram(body.telegram);
  if ("fio" in body) lead.fio = str(body.fio, 120);
  if ("phone" in body) lead.phone = str(body.phone, 40);
  if ("source" in body) lead.source = str(body.source, 120);
  if ("note" in body) lead.note = str(body.note, 2000);
  if ("addPayout" in body && money(body.addPayout)) {
    lead.payout = money((lead.payout || 0) + money(body.addPayout));
    logEvent(lead, by, `Выплата лиду +${money(body.addPayout)} ₽ (итого ${lead.payout} ₽)`);
  }
  if ("payout" in body && money(body.payout) !== (lead.payout || 0)) {
    lead.payout = money(body.payout);
    logEvent(lead, by, `Выплачено лиду: ${lead.payout} ₽`);
  }
  if ("nextStep" in body) lead.nextStep = str(body.nextStep, 200);
  if ("remindAt" in body && (body.remindAt === "" || body.remindAt === null || isDate(body.remindAt))) {
    lead.remindAt = body.remindAt || "";
    if (by) logEvent(lead, by, lead.remindAt ? `Напоминание на ${lead.remindAt.split("-").reverse().join(".")}${lead.nextStep ? `: ${lead.nextStep}` : ""}` : "Напоминание снято");
  }
  if ("stage" in body && STAGES.includes(body.stage) && body.stage !== lead.stage) {
    lead.stage = body.stage;
    logEvent(lead, by, `Этап: ${STAGE_LABELS[lead.stage]}`);
  }

  if (body.offers && typeof body.offers === "object") {
    const catalog = new Map(offers.map((o) => [o.id, o]));
    for (const [offerId, patch] of Object.entries(body.offers)) {
      const offer = catalog.get(offerId);
      if (!offer || !patch || typeof patch !== "object") continue;
      const current = lead.offers[offerId] || { status: "none", amount: offer.amount, cost: offer.cost || 0, comment: "" };
      if (OFFER_STATUSES.includes(patch.status) && patch.status !== current.status) {
        current.status = patch.status;
        if (!importing) current.changedAt = new Date().toISOString();
        else if (isIso(patch.changedAt)) current.changedAt = patch.changedAt;
        else delete current.changedAt;
        logEvent(lead, by, `${offer.name}: ${STATUS_SHORT[current.status]}`);
      }
      if ("amount" in patch) current.amount = money(patch.amount);
      if ("cost" in patch) current.cost = money(patch.cost);
      if ("comment" in patch) current.comment = str(patch.comment, 200);
      if ("network" in patch) current.network = str(patch.network, 60);
      if ("received" in patch) {
        current.received = patch.received === true;
        current.receivedAt = current.received ? new Date().toISOString() : "";
        if (!current.received) delete current.payoutId;
        logEvent(lead, by, `${offer.name}: ${current.received ? "деньги от сети получены" : "отметка «получено» снята"}`);
      }
      // Срок по офферу: маскировка МФО, «отчёт в конце месяца», дата встречи.
      if ("dueAt" in patch && (patch.dueAt === "" || patch.dueAt === null || isDate(patch.dueAt))) current.dueAt = patch.dueAt || "";
      if ("addCost" in patch && money(patch.addCost)) {
        current.cost = money((current.cost || 0) + money(patch.addCost));
        logEvent(lead, by, `${offer.name}: затраты +${money(patch.addCost)} ₽ (итого ${current.cost} ₽)`);
      }
      lead.offers[offerId] = current;
    }
    // Этап подтягивается сам: появился засчёт — «Докрутка», взяли первый оффер — «В работе».
    if (!("stage" in body)) {
      const statuses = Object.values(lead.offers).map((o) => o.status);
      const next = statuses.includes("paid") && ["new", "in_work"].includes(lead.stage) ? "offers"
        : lead.stage === "new" && statuses.some((st) => st !== "none") ? "in_work" : null;
      if (next) {
        lead.stage = next;
        logEvent(lead, by, `Этап: ${STAGE_LABELS[next]}`);
      }
    }
  }
}

function newLead(auth) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    telegram: "",
    fio: "",
    phone: "",
    source: "",
    note: "",
    stage: "new",
    payout: 0,
    nextStep: "",
    remindAt: "",
    offers: {},
    history: [],
    ownerId: auth.user.id,
    ownerName: displayName(auth.user),
    createdAt: now,
    updatedAt: now,
  };
}

const loadPayouts = async (store) => (await store.getJSON(PAYOUTS_KEY)) || [];

const nickKey = (t) => (t || "").trim().toLowerCase();
async function indexAdd(store, leads) {
  const idx = (await store.getJSON(INDEX_KEY)) || {};
  let changed = false;
  for (const l of leads) {
    const k = nickKey(l.telegram);
    if (k && idx[k] !== l.id) {
      idx[k] = l.id;
      changed = true;
    }
  }
  if (changed) await store.setJSON(INDEX_KEY, idx);
}
// Найти лида по нику: сначала по списку, потом по индексу (свежие, которых ещё нет в list()).
async function findByNick(store, leads, telegram) {
  const k = nickKey(telegram);
  if (!k) return null;
  const hit = leads.find((l) => nickKey(l.telegram) === k);
  if (hit) return hit;
  const id = ((await store.getJSON(INDEX_KEY)) || {})[k];
  return id ? normalizeLead(await store.getJSON(LEAD_PREFIX + id)) : null;
}

// Объединение дублей: офферы берём самые «продвинутые»/свежие, история склеивается, копии удаляются.
const STATUS_RANK = { none: 0, rejected: 1, exists: 1, applied: 2, opened: 3, done: 4, paid: 5 };
function mergeLeads(group) {
  const sorted = [...group].sort((a, b) => (b.history?.length || 0) - (a.history?.length || 0) || b.updatedAt.localeCompare(a.updatedAt));
  const main = structuredClone(sorted[0]);
  for (const other of sorted.slice(1)) {
    for (const f of ["fio", "phone", "source", "note", "nextStep", "remindAt"]) if (!main[f] && other[f]) main[f] = other[f];
    main.payout = Math.max(main.payout || 0, other.payout || 0);
    if (!main.tgId && other.tgId) main.tgId = other.tgId;
    for (const [id, lo] of Object.entries(other.offers || {})) {
      const cur = main.offers[id];
      const newer = (x) => Date.parse(x?.changedAt || 0) || 0;
      if (!cur || newer(lo) > newer(cur) || (newer(lo) === newer(cur) && STATUS_RANK[lo.status] > STATUS_RANK[cur.status])) {
        main.offers[id] = { ...lo, received: lo.received || cur?.received || false };
      } else if (lo.received && !cur.received && lo.status === cur.status) {
        Object.assign(cur, { received: true, receivedAt: lo.receivedAt, payoutId: lo.payoutId });
      }
    }
    const seen = new Set((main.history || []).map((h) => h.at + h.text));
    main.history = [...(main.history || []), ...(other.history || []).filter((h) => !seen.has(h.at + h.text))].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
    if (other.createdAt < main.createdAt) main.createdAt = other.createdAt;
  }
  main.updatedAt = new Date().toISOString();
  return { main, removed: sorted.slice(1).map((l) => l.id) };
}

export function findDuplicates(leads) {
  const groups = new Map();
  for (const l of leads) {
    const k = nickKey(l.telegram) || (l.tgId ? `id:${l.tgId}` : "");
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(l);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

async function ensureWebhook(store, env, fetchImpl, hookUrl, force = false) {
  const saved = await store.getJSON(WEBHOOK_KEY);
  if (!force && saved?.url === hookUrl && saved?.v === 3) return saved;
  const tg = telegram(env.BOT_TOKEN, fetchImpl);
  await tg.setWebhook(hookUrl, await webhookSecret(env.BOT_TOKEN));
  await tg
    .setMyCommands([
      { command: "menu", description: "Меню с кнопками" },
      { command: "digest", description: "Сводка: что сделать сегодня" },
      { command: "stats", description: "Цифры: месяц, прошлый месяц, всё время" },
      { command: "reminders", description: "Мои напоминания" },
      { command: "help", description: "Что умеет бот" },
    ])
    .catch(() => {});
  // Новая версия бота: один раз присылаем админам меню, чтобы кнопки появились без /start.
  if (saved?.v !== 3) {
    const appUrl = env.APP_URL || hookUrl.replace(/api\/tg$/, "");
    for (const id of parseIds(env.ADMIN_IDS)) await tg.sendMessage(id, `🔄 <b>Обновил бота</b> — теперь внизу меню с кнопками.\n\n${HELP}`, menuKeyboard(appUrl)).catch(() => {});
  }
  const info = { url: hookUrl, v: 3, at: new Date().toISOString() };
  await store.setJSON(WEBHOOK_KEY, info);
  return info;
}

async function roleOf(store, env, userId) {
  return roleFor(userId, env) || (await loadAccess(store)).roles[userId]?.role || null;
}

async function createReminder(store, { chatId, by, task, nick, lead, dueAt }) {
  const reminder = {
    id: randomUUID(),
    chatId,
    by,
    task,
    nick: nick || (lead?.telegram?.startsWith("@") ? lead.telegram.slice(1) : null),
    leadId: lead?.id || null,
    leadTitle: lead ? [lead.telegram, lead.fio].filter(Boolean).join(" · ") : null,
    dueAt,
    createdAt: Date.now(),
  };
  const all = await loadReminders(store);
  all.push(reminder);
  await store.setJSON(REMINDERS_KEY, all.slice(-500));
  if (lead) {
    const key = LEAD_PREFIX + lead.id;
    const fresh = normalizeLead(await store.getJSON(key));
    if (fresh) {
      applyLeadPatch(fresh, { nextStep: `${formatMsk(dueAt).split(" в ")[1].replace(" МСК", "")} — ${task}`, remindAt: mskDateKey(dueAt) }, await loadOffers(store), by);
      fresh.updatedAt = new Date().toISOString();
      await store.setJSON(key, fresh);
    }
  }
  return reminder;
}

const BOTSTATE = (chatId) => `botstate/${chatId}`;
const visibleTo = (role, userId) => (l) => role === "admin" || l.ownerId === userId;

// Кнопки под сообщениями бота.
async function handleCallback(cb, { store, env, tg, appUrl }) {
  const [action, a, b] = String(cb.data || "").split(":");
  const chatId = cb.message?.chat?.id;
  const answer = (text) => tg.answerCallback(cb.id, text).catch(() => {});
  const role = await roleOf(store, env, cb.from.id);
  if (!role) return answer("Нет доступа");
  const by = displayName(cb.from);

  if (action === "rmcancel") {
    const all = await loadReminders(store);
    const r = all.find((x) => x.id === a && x.chatId === chatId);
    if (!r) return answer("Уже неактуально");
    await store.setJSON(REMINDERS_KEY, all.filter((x) => x.id !== a));
    await answer("Напоминание отменено");
    if (cb.message?.text?.startsWith("⏰ Напомню")) await tg.editMessage(chatId, cb.message.message_id, `❌ <s>${escapeHtml(cb.message.text.replace(/^⏰\s*/, ""))}</s>\nОтменено`).catch(() => {});
    return;
  }
  if (action === "snooze") {
    const sent = (await store.getJSON("reminders_sent")) || [];
    const r = sent.find((x) => x.id === a && x.chatId === chatId);
    if (!r) return answer("Уже неактуально");
    const next = { ...r, id: randomUUID(), dueAt: Date.now() + 3600000 };
    const all = await loadReminders(store);
    all.push(next);
    await store.setJSON(REMINDERS_KEY, all);
    await answer(`Напомню в ${formatMsk(next.dueAt).split(" в ")[1]}`);
    await tg.editMessage(chatId, cb.message.message_id, `${reminderText(r, { due: true })}\n\n💤 Отложено до ${formatMsk(next.dueAt)}`, reminderButtons(next, appUrl, { due: false })).catch(() => {});
    return;
  }
  if (action === "mk") {
    const st = await store.getJSON(BOTSTATE(chatId));
    if (!st?.create) return answer("Уже неактуально");
    await store.setJSON(BOTSTATE(chatId), {});
    const lead = await createLeadFromBot(store, { from: cb.from, parsed: st.create });
    await answer("Лид создан");
    const card = leadCard(lead, await loadOffers(store), await loadSettings(store), appUrl);
    await tg.sendMessage(chatId, `✅ Лид создан\n\n${card.text}`, card.markup).catch(() => {});
    return;
  }

  // Действия с лидом: a = короткий id
  const leads = (await loadLeads(store)).filter(visibleTo(role, cb.from.id));
  const lead = leads.find((l) => l.id.startsWith(a || "-"));
  if (!lead) return answer("Лид не найден");
  const [offers, settings] = await Promise.all([loadOffers(store), loadSettings(store)]);

  if (action === "lead") {
    await answer();
    const card = leadCard(lead, offers, settings, appUrl);
    await tg.sendMessage(chatId, card.text, card.markup).catch(() => {});
    return;
  }
  if (action === "lstat") {
    await answer();
    await tg.sendMessage(chatId, `🔄 <b>${escapeHtml(lead.telegram || lead.fio)}</b> — нажми оффер, чтобы перевести на следующий шаг:`, offerButtons(lead, offers)).catch(() => {});
    return;
  }
  if (action === "adv") {
    const key = LEAD_PREFIX + lead.id;
    const fresh = normalizeLead(await store.getJSON(key));
    const lo = fresh?.offers?.[b];
    const to = lo && nextStatus(lo.status);
    if (!to) return answer("Уже обновлено");
    applyLeadPatch(fresh, { offers: { [b]: { status: to } } }, offers, by);
    fresh.updatedAt = new Date().toISOString();
    await store.setJSON(key, fresh);
    const name = offers.find((o) => o.id === b)?.name || b;
    await answer(`${name}: ${STATUS_SHORT[to]}${to === "paid" ? " 💸" : ""}`);
    await tg.editMessage(chatId, cb.message.message_id, `🔄 <b>${escapeHtml(fresh.telegram || fresh.fio)}</b> — ${escapeHtml(name)}: <b>${STATUS_SHORT[to]}</b> ✅\nМожно продолжить:`, offerButtons(fresh, offers)).catch(() => {});
    return;
  }
  if (action === "rem1") {
    const p = new Date(Date.now() + 3 * 3600000);
    const dueAt = Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate() + 1, 10 - 3, 0);
    const r = await createReminder(store, { chatId, by, task: lead.nextStep?.replace(/^\d\d:\d\d — /, "") || "Вернуться к лиду", lead, dueAt });
    await answer("Напомню завтра в 10:00");
    await tg.sendMessage(chatId, reminderText(r), reminderButtons(r, appUrl)).catch(() => {});
    return;
  }
  return answer();
}

async function createLeadFromBot(store, { from, parsed }) {
  const lead = newLead({ user: from });
  Object.assign(lead, { telegram: parsed.telegram || "", fio: parsed.fio || "", phone: parsed.phone || "", note: parsed.note || "", source: "Бот" });
  if (parsed.tgId) lead.tgId = parsed.tgId;
  logEvent(lead, displayName(from), "Лид создан из бота");
  await store.setJSON(LEAD_PREFIX + lead.id, lead);
  await indexAdd(store, [lead]);
  return lead;
}

// Сообщения боту. Всегда отвечаем Telegram 200: иначе он будет присылать то же сообщение снова и снова.
async function handleTelegramUpdate(req, { store, env, fetchImpl, origin }) {
  if (!env.BOT_TOKEN || req.headers.get("x-telegram-bot-api-secret-token") !== (await webhookSecret(env.BOT_TOKEN))) {
    return json({ error: "forbidden" }, 403);
  }
  const update = await req.json().catch(() => ({}));
  try {
    await processUpdate(update, { store, env, fetchImpl, origin });
  } catch (e) {
    console.error("bot update failed", e?.stack || e);
  }
  return json({ ok: true });
}

async function processUpdate(update, { store, env, fetchImpl, origin }) {
  const tg = telegram(env.BOT_TOKEN, fetchImpl);
  const appUrl = env.APP_URL || `${origin}/`;
  if (update.callback_query) return handleCallback(update.callback_query, { store, env, tg, appUrl });
  const msg = update.message;
  if (!msg?.from || msg.chat?.type !== "private") return;

  const openBtn = (text, query = "") => ({ inline_keyboard: [[{ text, web_app: { url: `${appUrl}${query}` } }]] });
  const reply = (text, markup) => tg.sendMessage(msg.chat.id, text, markup).catch(() => {});

  const role = await roleOf(store, env, msg.from.id);
  if (!role) return reply("Привет! Это CRM команды. Доступа у тебя пока нет — нажми кнопку ниже, запрос уйдёт админу.", openBtn("Запросить доступ"));
  const text = (msg.text || "").trim();
  const by = displayName(msg.from);
  const [offers, settings] = await Promise.all([loadOffers(store), loadSettings(store)]);
  const allLeads = () => loadLeads(store).then((ls) => ls.filter(visibleTo(role, msg.from.id)));
  const sendCard = (lead, prefix = "") => {
    const card = leadCard(lead, offers, settings, appUrl);
    return reply(`${prefix}${card.text}`, card.markup);
  };

  if (/^\/(start|help|menu)\b/.test(text) || text === MENU.help) return reply(HELP, menuKeyboard(appUrl));
  if (text === MENU.add) return reply(ADD_HELP);
  if (text === MENU.search) return reply("🔎 Напиши ник, имя или телефон — пришлю карточку лида.\nНапример: <code>Иванов</code> или <code>@nick</code> или <code>9001234</code>");
  if (text === MENU.digest || /^\/digest\b/.test(text)) {
    const leads = await allLeads();
    return reply(buildDigest(leads, offers, settings, Date.now(), { networks: role === "admin" }), openBtn("📱 Открыть CRM"));
  }
  if (text === MENU.numbers || /^\/stats\b/.test(text)) {
    const leads = await allLeads();
    return reply(numbersText(leads, offers, settings, role === "admin" ? await loadPayouts(store) : [], { networks: role === "admin" }), openBtn("📊 Статистика в CRM", "?tab=stats"));
  }
  if (text === MENU.reminders || /^\/reminders\b|^(мои\s+)?напоминания\??$/i.test(text)) {
    const mine = (await loadReminders(store)).filter((r) => r.chatId === msg.chat.id).sort((a, b) => a.dueAt - b.dueAt);
    if (!mine.length) return reply("Активных напоминаний нет.\n\nПоставить: напиши, например, <code>напомни завтра в 12 сделать ЦД с @nick</code>\nИли открой карточку лида и нажми «⏰ Завтра в 10».");
    return reply(
      `⏰ <b>Твои напоминания (${mine.length})</b>\n\n${mine.slice(0, 15).map((r, i) => `${i + 1}. ${formatMsk(r.dueAt)} — ${escapeHtml(r.task)}${r.nick ? ` (@${escapeHtml(r.nick)})` : ""}`).join("\n")}`,
      { inline_keyboard: mine.slice(0, 15).map((r, i) => [{ text: `❌ Отменить ${i + 1}`, callback_data: `rmcancel:${r.id}` }]) },
    );
  }

  // «напомни завтра в 12 сделать ЦД с @nick»
  const forwarded = msg.forward_origin || msg.forward_from || msg.forward_sender_name;
  const rem = forwarded ? null : parseReminder(text);
  if (rem) {
    if (rem.needTime) return reply("Когда напомнить? 🙂 Напиши со временем, например:\n• <code>напомни завтра в 12 сделать ЦД с @nick</code>\n• <code>напомни через 2 часа позвонить @nick</code>\n• <code>напомни в пятницу в 10 проверить отчёт</code>");
    if (rem.past) return reply(`Это время уже прошло (${formatMsk(rem.dueAt)}). Напиши другое 🙂`);
    const lead = rem.nick ? await findByNick(store, await allLeads(), `@${rem.nick}`) : null;
    const r = await createReminder(store, { chatId: msg.chat.id, by, task: rem.task, nick: rem.nick, lead, dueAt: rem.dueAt });
    return reply(reminderText(r), reminderButtons(r, appUrl));
  }

  const parsed = parseLeadMessage(msg);
  const leads = await allLeads();

  // Просто текст без ника и телефона — это поиск. Не нашли — предложим создать.
  if (!forwarded && !msg.contact && (!parsed || (!parsed.telegram && !parsed.phone))) {
    const q = text.replace(/^🔎\s*/, "");
    if (!q) return reply(HELP, menuKeyboard(appUrl));
    const found = searchLeads(leads, q);
    if (found.length === 1) return sendCard(found[0]);
    if (found.length > 1) return reply(`🔎 Нашёл ${found.length}:`, resultsMarkup(found));
    if (parsed?.fio) {
      await store.setJSON(BOTSTATE(msg.chat.id), { create: { fio: parsed.fio }, at: Date.now() });
      return reply(`Лида «${escapeHtml(q)}» нет в CRM. Создать?`, { inline_keyboard: [[{ text: `➕ Создать лида «${q.slice(0, 30)}»`, callback_data: "mk" }]] });
    }
    return reply(`Не понял 🤔 Нажми «❓ Помощь» внизу — там всё, что я умею.`, menuKeyboard(appUrl));
  }

  // Ник, телефон, пересылка или контакт: есть — покажем карточку, нет — создадим.
  const dup =
    (parsed.telegram && (await findByNick(store, leads, parsed.telegram))) ||
    leads.find(
      (l) =>
        (parsed.tgId && l.tgId === parsed.tgId) ||
        (parsed.phone && l.phone && l.phone.replace(/\D/g, "").slice(-10) === parsed.phone.replace(/\D/g, "").slice(-10)),
    );
  if (dup) return sendCard(dup, "Этот лид уже есть 👇\n\n");
  const lead = await createLeadFromBot(store, { from: msg.from, parsed });
  return sendCard(lead, `✅ Лид создан${parsed.kind === "hidden" ? " (ник скрыт — допиши в карточке)" : ""}\n\n`);
}

// Для ежедневной рассылки: все данные и кому слать.
export async function loadAll(store) {
  const [offers, settings, leads, access] = await Promise.all([loadOffers(store), loadSettings(store), loadLeads(store), loadAccess(store)]);
  return { offers, settings, leads, access };
}

export function recipientsOf(env, access) {
  const out = new Map();
  for (const [id, r] of Object.entries(access.roles || {})) out.set(Number(id), r.role);
  for (const id of parseIds(env.MANAGER_IDS)) out.set(id, "manager");
  for (const id of parseIds(env.ADMIN_IDS)) out.set(id, "admin");
  return [...out].map(([id, role]) => ({ id, role }));
}

export function createHandler({ store, env, fetch: fetchImpl = globalThis.fetch }) {
  return async function handle(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();

    if (path === "/tg" && method === "POST") return handleTelegramUpdate(req, { store, env, fetchImpl, origin: url.origin });

    const auth = authenticate(req, env);
    if (!auth.user) return json({ error: "unauthorized", reason: auth.reason }, 401);
    if (!auth.role) {
      const access = await loadAccess(store);
      auth.role = access.roles[auth.user.id]?.role || null;
      if (!auth.role) {
        if (!access.pending[auth.user.id] && Object.keys(access.pending).length < 50) {
          access.pending[auth.user.id] = { name: displayName(auth.user), username: auth.user.username || "", at: new Date().toISOString() };
          await store.setJSON(ACCESS_KEY, access);
        }
        return json({ error: "forbidden", userId: auth.user.id }, 403);
      }
    }
    const isAdmin = auth.role === "admin";

    const body = ["POST", "PATCH", "PUT"].includes(method) ? await req.json().catch(() => ({})) : {};

    if (method === "GET" && path === "/state") {
      const [offers, settings, leads, payouts] = await Promise.all([loadOffers(store), loadSettings(store), loadLeads(store), isAdmin ? loadPayouts(store) : []]);
      // Бот сам подключается к CRM при первом заходе админа.
      if (isAdmin) await ensureWebhook(store, env, fetchImpl, `${url.origin}/api/tg`).catch(() => {});
      return json({
        me: { id: auth.user.id, name: displayName(auth.user), role: auth.role },
        offers,
        settings,
        payouts,
        leads: leads.filter((l) => canSee(auth, l)),
      });
    }

    if (method === "POST" && path === "/bot/setup") {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      try {
        return json(await ensureWebhook(store, env, fetchImpl, `${url.origin}/api/tg`, true));
      } catch (e) {
        return json({ error: "telegram_failed", detail: e.message }, 502);
      }
    }

    // Выплаты от партнёрских сетей: платёж + какие засчитанные офферы он закрыл.
    if (method === "POST" && path === "/payouts") {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      const network = str(body.network, 60);
      if (!network) return json({ error: "network_required" }, 400);
      const payout = {
        id: randomUUID(),
        network,
        amount: money(body.amount),
        date: isDate(body.date) ? body.date : new Date().toISOString().slice(0, 10),
        note: str(body.note, 200),
        items: [],
        covered: 0,
        by: displayName(auth.user),
        at: new Date().toISOString(),
      };
      const byLead = new Map();
      for (const it of Array.isArray(body.items) ? body.items.slice(0, 500) : []) {
        if (!it?.leadId || !it?.offerId) continue;
        if (!byLead.has(it.leadId)) byLead.set(it.leadId, []);
        byLead.get(it.leadId).push(String(it.offerId));
      }
      const offersCat = await loadOffers(store);
      for (const [leadId, offerIds] of byLead) {
        const key = LEAD_PREFIX + leadId;
        const lead = normalizeLead(await store.getJSON(key));
        if (!lead) continue;
        for (const offerId of offerIds) {
          const lo = lead.offers[offerId];
          // только засчитанные офферы этой же сети
          if (!lo || lo.status !== "paid" || networkOf(lo, offersCat.find((o) => o.id === offerId)) !== network) continue;
          lo.received = true;
          lo.receivedAt = payout.at;
          lo.payoutId = payout.id;
          payout.items.push({ leadId, offerId });
          payout.covered += lo.amount;
          const name = offersCat.find((o) => o.id === offerId)?.name || offerId;
          logEvent(lead, payout.by, `${name}: деньги от ${network} получены (платёж ${payout.amount} ₽ от ${payout.date.split("-").reverse().join(".")})`);
        }
        lead.updatedAt = new Date().toISOString();
        await store.setJSON(key, lead);
      }
      const payouts = await loadPayouts(store);
      payouts.unshift(payout);
      await store.setJSON(PAYOUTS_KEY, payouts.slice(0, 500));
      return json(payout, 201);
    }

    const payoutMatch = path.match(/^\/payouts\/([0-9a-f-]{36})$/);
    if (payoutMatch && method === "DELETE") {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      const payouts = await loadPayouts(store);
      const payout = payouts.find((p) => p.id === payoutMatch[1]);
      if (!payout) return json({ error: "not_found" }, 404);
      for (const leadId of new Set(payout.items.map((i) => i.leadId))) {
        const key = LEAD_PREFIX + leadId;
        const lead = await store.getJSON(key);
        if (!lead) continue;
        for (const lo of Object.values(lead.offers || {})) {
          if (lo.payoutId === payout.id) {
            lo.received = false;
            lo.receivedAt = "";
            delete lo.payoutId;
          }
        }
        await store.setJSON(key, lead);
      }
      await store.setJSON(PAYOUTS_KEY, payouts.filter((p) => p.id !== payout.id));
      return json({ ok: true });
    }

    if (method === "POST" && path === "/leads") {
      const lead = newLead(auth);
      applyLeadPatch(lead, body, await loadOffers(store));
      if (!lead.telegram && !lead.fio) return json({ error: "telegram_or_fio_required" }, 400);
      logEvent(lead, displayName(auth.user), "Лид создан");
      await store.setJSON(LEAD_PREFIX + lead.id, lead);
      await indexAdd(store, [lead]);
      return json(lead, 201);
    }

    const leadMatch = path.match(/^\/leads\/([0-9a-f-]{36})$/);
    if (leadMatch) {
      const key = LEAD_PREFIX + leadMatch[1];
      const lead = normalizeLead(await store.getJSON(key));
      if (!lead || !canSee(auth, lead)) return json({ error: "not_found" }, 404);

      if (method === "PATCH") {
        applyLeadPatch(lead, body, await loadOffers(store), displayName(auth.user));
        lead.updatedAt = new Date().toISOString();
        await store.setJSON(key, lead);
        return json(lead);
      }
      if (method === "DELETE") {
        if (!isAdmin) return json({ error: "forbidden" }, 403);
        await store.delete(key);
        const idx = (await store.getJSON(INDEX_KEY)) || {};
        const k = nickKey(lead.telegram);
        if (k && idx[k] === lead.id) {
          delete idx[k];
          await store.setJSON(INDEX_KEY, idx);
        }
        return json({ ok: true });
      }
    }

    // Новый оффер прямо из карточки лида — дописывается в каталог, остальное не трогаем.
    if (method === "POST" && path === "/offers") {
      const name = str(body.name, 80);
      if (!name) return json({ error: "name_required" }, 400);
      const offers = await loadOffers(store);
      const same = offers.find((o) => o.name.toLowerCase() === name.toLowerCase());
      if (same) return json({ offer: same, offers, existed: true });
      const offer = sanitizeOffers([{ ...body, name, id: `o_${randomUUID().slice(0, 8)}`, active: true }])[0];
      offers.push(offer);
      await store.setJSON(OFFERS_KEY, offers);
      return json({ offer, offers }, 201);
    }

    if (method === "POST" && path === "/dedupe") {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      const groups = findDuplicates(await loadLeads(store));
      let removed = 0;
      for (const g of groups) {
        const { main, removed: ids } = mergeLeads(g);
        logEvent(main, displayName(auth.user), `Объединены дубли (${g.length} шт.)`);
        await store.setJSON(LEAD_PREFIX + main.id, main);
        for (const id of ids) await store.delete(LEAD_PREFIX + id);
        removed += ids.length;
        await indexAdd(store, [main]);
      }
      return json({ groups: groups.length, removed });
    }

    if (method === "PUT" && path === "/offers") {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      const offers = sanitizeOffers(body.offers);
      if (!offers) return json({ error: "bad_offers" }, 400);
      await store.setJSON(OFFERS_KEY, offers);
      return json(offers);
    }

    if (method === "PUT" && path === "/settings") {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      const settings = sanitizeSettings(body, await loadSettings(store));
      await store.setJSON(SETTINGS_KEY, settings);
      return json(settings);
    }

    if (path === "/access" && (method === "GET" || method === "PUT")) {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      const access = await loadAccess(store);
      const fixed = new Map([
        ...[...parseIds(env.MANAGER_IDS)].map((id) => [id, "manager"]),
        ...[...parseIds(env.ADMIN_IDS)].map((id) => [id, "admin"]),
      ]);
      if (method === "PUT") {
        const id = Number(body.id);
        if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "bad_id" }, 400);
        if (fixed.has(id)) return json({ error: "fixed_in_config" }, 400);
        if (ROLES.includes(body.role)) {
          const known = access.roles[id] || access.pending[id] || {};
          access.roles[id] = { role: body.role, name: str(known.name, 80), username: str(known.username, 64) };
        } else {
          delete access.roles[id];
        }
        delete access.pending[id];
        await store.setJSON(ACCESS_KEY, access);
      }
      const list = (obj) => Object.entries(obj).map(([id, v]) => ({ id: Number(id), ...v }));
      return json({
        fixed: [...fixed].map(([id, role]) => ({ id, role })),
        users: list(access.roles).filter((u) => !fixed.has(u.id)),
        pending: list(access.pending).sort((a, b) => b.at.localeCompare(a.at)),
      });
    }

    if (method === "POST" && path === "/backup") {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      const { offers, settings, leads } = await loadAll(store);
      try {
        await sendBackup(telegram(env.BOT_TOKEN, fetchImpl), auth.user.id, leads, offers, settings);
      } catch (e) {
        return json({ error: "telegram_failed", detail: e.message }, 502);
      }
      return json({ ok: true, leads: leads.length });
    }

    // Импорт из таблиц: лид с тем же Telegram обновляется, остальные создаются.
    if (method === "POST" && path === "/import") {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      if (!Array.isArray(body.leads)) return json({ error: "bad_import" }, 400);
      const [offers, existing] = await Promise.all([loadOffers(store), loadLeads(store)]);
      const byTelegram = new Map(existing.filter((l) => l.telegram).map((l) => [l.telegram.toLowerCase(), l]));
      const index = (await store.getJSON(INDEX_KEY)) || {};
      let created = 0;
      let updated = 0;
      for (const item of body.leads.slice(0, 1000)) {
        if (!item || typeof item !== "object") continue;
        const tg = normTelegram(item.telegram).toLowerCase();
        let lead = tg && (byTelegram.get(tg) || (index[tg] && normalizeLead(await store.getJSON(LEAD_PREFIX + index[tg]))));
        if (lead) updated++;
        else {
          lead = newLead(auth);
          created++;
        }
        const { telegram, ...rest } = item;
        applyLeadPatch(lead, lead.telegram ? rest : item, offers, undefined, { importing: true });
        if (!lead.telegram && !lead.fio) {
          created--;
          continue;
        }
        lead.updatedAt = new Date().toISOString();
        if (lead.telegram) byTelegram.set(lead.telegram.toLowerCase(), lead);
        await store.setJSON(LEAD_PREFIX + lead.id, lead);
      }
      await indexAdd(store, [...byTelegram.values()]);
      return json({ created, updated });
    }

    return json({ error: "not_found" }, 404);
  };
}
