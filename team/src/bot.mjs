// Бот команды: напоминания о созвонах, отметки «пришёл / НДЗ» прямо из Telegram, утренняя сводка.
import { escapeHtml as h } from "./telegram.mjs";
import {
  ROLES, isClosed, currentCall, clientTitle, mskKey, mskTime, fmtWhen, needsReport, followupState, statusLabel, monthSummary, addDaysKey, weekday,
} from "../public/lib/model.js";
import { rnp } from "../public/lib/stats.js";
import { parseBooking, parseBookings, parseWindows, parseRelay, parseSetWindows } from "./nlp.mjs";
import { addFeed } from "./notify.mjs";
import { isReportText, parseReportText } from "../public/lib/report.js";
import { dispatch } from "./notify.mjs";
import { DEFAULT_PAY_LINKS, REPORT_FIELDS, AFTER_CALL, daySlots, rangesText, toMin } from "../public/lib/model.js";
import { loadWindows } from "./api.mjs";

const AI_STATUS_SET = new Set(["held", "ndz", "paid", "prepaid", "thinking", "resched", "refuse_bank", "refuse_personal", "ignore", "invalid"]);

export const BOT_COMMANDS = [
  { command: "start", description: "Открыть приложение и что умеет бот" },
  { command: "today", description: "Мои созвоны и задачи на сегодня" },
  { command: "tomorrow", description: "Созвоны на завтра" },
  { command: "windows", description: "Свободные окна диагностов на завтра" },
  { command: "links", description: "Ссылки на оплату" },
  { command: "export", description: "Выгрузить базу (Excel + бэкап)" },
  { command: "payouts", description: "Кому сколько выплатить (руководство)" },
  { command: "ai", description: "Проверка ИИ и расход (руководство)" },
];

export const BOT_HELP = [
  "<b>Что я умею</b>",
  "",
  "📅 <b>Записать на созвон</b> — пиши как человеку:",
  "• <code>созвон завтра в 15 к Тёме @ivan Иван</code>",
  "• <code>на завтра поставил лида Теме на 19:00 @nick</code>",
  "• Несколько сразу: <code>завтра: Теме в 18 с Антоном @anton, в 19 с Мишей; Диме на 20:00 Олег</code>",
  "• Созвон уже был, а в CRM его нет: <code>сегодня у Димы в 14:00 был созвон с @ivan</code> — внесу и спрошу итог.",
  "• <code>запиши Олега на созвон в пятницу 18:30 к Диме +79001234567</code>",
  "Диагност сразу получит уведомление. Нет такого клиента — заведу.",
  "",
  "🕐 <b>Окна</b>: посмотреть — <code>окна завтра</code>; открыть — <code>окна Тёме завтра с 18 до 21</code>; закрыть — <code>закрой окна Теме завтра</code>",
  "💬 <b>Написать человеку</b>: <code>Теме: перезвони Глебу</code>, <code>всем: планёрка в 11</code> — отвечают реплаем, ответ придёт тебе.",
  "✔️ <b>Статус одной строкой</b>: <code>@ivan пришёл</code>, <code>@ivan ндз</code>, <code>@ivan оплатил 100к</code>, <code>@ivan думает 80к</code>, <code>@ivan отказ банки</code>",
  "📋 /today, /tomorrow — мои созвоны и задачи",
  "💳 /links — ссылки на оплату",
  "📝 <b>Итог диагностики</b> — пришли свой обычный блок «Потребность/запрос клиента: …» с @ником клиента, сохраню в карточку и спрошу статус.",
  "📦 /export — вся база в Excel (руководству ещё ведомость и полный бэкап).",
  "↪️ Перешли мне сообщение клиента — заведу лида.",
  "",
  "🎙 <b>Голосовые</b> — наговори созвон, статус или отчёт, расшифрую и внесу.",
  "🧠 <b>Пиши как человеку</b> — пойму и сделаю: <code>тёмычу двоих на завтра, антон в 6 и миша после него</code>, <code>отмени его</code>, <code>сколько у Димы продаж за неделю?</code>, <code>кто не сдал отчёт?</code>, <code>напиши текст для дожима Олега</code>",
  "",
  "⏰ Сам напомню диагносту за 2 часа, за час и за 15 минут до созвона, после — спрошу «пришёл или НДЗ».",
].join("\n");

const MIN = 60_000;
const nowIso = () => new Date().toISOString();
const rub = (n) => `${Math.round(n || 0).toLocaleString("ru-RU")} ₽`;
const openApp = (appUrl, text = "Открыть приложение", query = "") => ({ text, web_app: { url: `${appUrl}${query}` } });
const who = (c) => [c.name, c.telegram].filter(Boolean).map(h).join(" · ") || "клиент";

async function activeUsers(store, env) {
  const users = (await store.all("user")).filter((u) => u.active);
  for (const id of String(env.OWNER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!users.some((u) => u.id === id)) users.push({ id, role: "owner", name: "Собственник", active: true });
    else users.find((u) => u.id === id).role = "owner";
  }
  return users;
}

// ---------- входящие ----------
export async function handleUpdate(update, { store, env, tg, appUrl }) {
  // Telegram повторяет апдейт, если мы долго отвечали (ИИ думает) — второй раз не обрабатываем.
  if (update.update_id != null && (await seenUpdate(store, update.update_id))) return;
  if (update.callback_query) return handleCallback(update.callback_query, { store, env, tg, appUrl });
  const msg = update.message;
  if (!msg?.from || msg.chat?.type !== "private") return;
  const users = await activeUsers(store, env);
  const me = users.find((u) => u.id === String(msg.from.id));
  const said = [];
  const reply = (text, markup) => (said.push(text), tg.sendMessage(msg.chat.id, text, markup).catch(() => {}));
  if (!me) {
    await store.put("pending", String(msg.from.id), {
      id: String(msg.from.id),
      name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || msg.from.username || String(msg.from.id),
      username: msg.from.username || "",
      at: nowIso(),
    });
    return reply(`Привет! Это рабочее пространство команды Рыжикова.\n\nДоступа пока нет. Твой ID: <code>${msg.from.id}</code>\nПетя или Андрей выдадут роль в приложении — ты уже в списке заявок.`);
  }
  // Диалог запоминаем для ИИ: «его», «этого клиента» в следующем сообщении будут понятны.
  const turn = { text: "" };
  try {
    return await handleMessage(msg, { me, users, reply, store, env, tg, appUrl, turn });
  } finally {
    if (env.ANTHROPIC_API_KEY && turn.text) {
      const { remember } = await import("./ai.mjs");
      await remember(store, me.id, turn.text, said).catch(() => {});
    }
  }
}

async function seenUpdate(store, id) {
  const doc = (await store.get("meta", "tg-seen")) || { ids: [] };
  if (doc.ids.includes(id)) return true;
  await store.put("meta", "tg-seen", { id: "tg-seen", ids: [...doc.ids.slice(-99), id] });
  return false;
}

// Вопрос — сразу ИИ, а не правилам: «сколько созвонов у Темы завтра в 18?» — это не запись на созвон.
const QUESTION = /\?\s*$|^(сколько|кто|что|чт[оа]|когда|как|почему|зачем|какой|какая|какие|каких|где|есть ли|покажи|расскажи|подскажи|помоги|объясни|напомни,? что|дай)(?![а-я])/i;

async function handleMessage(msg, { me, users, reply, store, env, tg, appUrl, turn }) {
  // Запоминаем, что человек запустил бота: только таким можно писать напоминания.
  const tgName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || msg.from.username || me.id;
  if (!me.botStarted || me.name === "Собственник") {
    me.name = me.name === "Собственник" ? tgName : me.name;
    await store.put("user", me.id, { ...me, botStarted: true, username: msg.from.username || me.username || "" });
  }
  let text = (msg.text || msg.caption || "").trim();
  // Голосовое / кружок → текст (Whisper в Cloudflare), дальше как обычное сообщение.
  const voice = msg.voice || msg.audio || msg.video_note;
  if (voice && !text) {
    const { transcribe } = await import("./ai.mjs");
    tg.sendChatAction?.(msg.chat.id).catch(() => {});
    text = (await transcribe(voice, { env, tg }).catch(() => null)) || "";
    if (!text) return reply(env.AI ? "Не разобрал голосовое 🙏 Скажи ещё раз чётче или напиши текстом." : "Голосовые пока не подключены — напиши текстом.");
    await reply(`🎙 <i>${h(text)}</i>`);
  }
  turn.text = text;
  const now = Date.now();
  const aiOn = Boolean(env.ANTHROPIC_API_KEY);
  const ask = aiOn && QUESTION.test(text);
  if (/^\/ai\b/.test(text) && ["owner", "rop"].includes(me.role)) {
    const { aiStatus } = await import("./ai.mjs");
    return reply(h(await aiStatus({ store, env, users, now, client: env.__aiClient || null })));
  }
  const clients = await store.all("client");
  const closers = users.filter((u) => ["mop", "rop"].includes(u.role));
  const settings = (await store.get("meta", "settings")) || {};
  const usersMap = Object.fromEntries(users.map((u) => [u.id, u]));

  // Пересланное сообщение клиента → новый лид
  const fwd = msg.forward_origin;
  if (fwd || msg.forward_from || msg.forward_sender_name) {
    const su = fwd?.sender_user || msg.forward_from;
    const nick = su?.username ? `@${su.username}` : "";
    const name = su ? [su.first_name, su.last_name].filter(Boolean).join(" ") : fwd?.sender_user_name || msg.forward_sender_name || "";
    const dup = nick && clients.find((c) => c.telegram?.toLowerCase() === nick.toLowerCase());
    if (dup) return reply(`Уже есть: <b>${who(dup)}</b> — ${statusLabel(dup.status)}`, { inline_keyboard: [[openApp(appUrl, "Открыть карточку", `?client=${dup.id}`)]] });
    const { blankClient, log } = await import("./api.mjs");
    const c = blankClient(me.id);
    Object.assign(c, { name: name.slice(0, 120), telegram: nick, info: text.slice(0, 1000), lidorubId: me.role === "lidorub" ? me.id : null });
    log(c, me.id, "Клиент создан из пересланного сообщения");
    await store.put("client", c.id, c);
    return reply(`🆕 Лид заведён: <b>${who(c)}</b>${nick ? "" : "\n⚠️ Ника нет (скрыт) — допиши телефон или ник в карточке."}\n\nЗаписать: <code>созвон завтра в 15 к Тёме ${nick || h(name)}</code>`, { inline_keyboard: [[openApp(appUrl, "📅 Записать на созвон", `?client=${c.id}&book=1`)]] });
  }

  if (/^\/today/.test(text) || /^(сегодня|мои созвоны)\??$/i.test(text)) {
    return reply(dayPlan(me, clients, now) || "На сегодня созвонов и долгов нет 👌", { inline_keyboard: [[openApp(appUrl)]] });
  }
  if (/^\/tomorrow/.test(text) || /^завтра\??$/i.test(text)) {
    return reply(dayCalls(me, clients, addDaysKey(mskKey(now), 1), usersMap) || "На завтра созвонов нет", { inline_keyboard: [[openApp(appUrl)]] });
  }
  if (/^\/payouts/.test(text) || /^(выплаты|кому выплатить|кому платить)\??$/i.test(text)) {
    if (!["owner", "rop"].includes(me.role)) return reply("Выплаты видят только Петя и Андрей.");
    const msgP = await payoutMessage({ store, env, now, forOwner: me.role === "owner" });
    return reply(msgP.text, msgP.markup(appUrl));
  }
  if (/^\/export/.test(text) || /^(выгрузка|выгрузи|бэкап)/i.test(text)) {
    const { sendExport } = await import("./export.mjs");
    const res = await sendExport({ store, tg, to: me.id, withMoney: ["owner", "rop"].includes(me.role) });
    return reply(`✅ Выгрузил: ${res.clients} клиентов${["owner", "rop"].includes(me.role) ? `, ${res.payments} оплат` : ""}.`);
  }
  if (isReportText(text)) return handleReportMessage(text, { me, clients, store, tg, appUrl, reply, usersMap, settings, env, users });

  if (/^\/links/.test(text) || /^ссылк/i.test(text)) {
    const want = Number((text.match(/(\d{2,3})\s*к?/) || [])[1]) * 1000 || null;
    const links = (settings.payLinks?.length ? settings.payLinks : DEFAULT_PAY_LINKS).filter((l) => !want || l.amount === want);
    if (!links.length) return reply("Таких ссылок нет. Напиши /links — пришлю все.");
    const groups = {};
    for (const l of links) (groups[l.provider] ||= []).push(l);
    const body = Object.entries(groups).map(([p, ls]) => `<b>${h(p)}</b>\n${ls.map((l) => `• ${h(l.label)}${l.note ? ` — <i>${h(l.note)}</i>` : ""}\n${h(l.url)}`).join("\n")}`).join("\n\n");
    return reply(`💳 <b>Ссылки на оплату</b>\n\n${body}\n\nОтправил ссылку — отметь в карточке клиента «💳 Ссылка»: при оплате чистая сама подставится в ведомость.`);
  }

  // «окна Тёме завтра с 18 до 21» — открыть окна (любой из команды)
  const setW = !ask && parseSetWindows(text, closers, { now, sender: ["mop", "rop"].includes(me.role) ? me : null });
  if (setW) {
    if (!setW.mop) return reply(`Кому окна? ${closers.map((u) => h(u.name)).join(" / ") || "Сначала добавь диагностов в приложении"}\nПример: <code>окна Тёме завтра с 18 до 21</code>`);
    const { setWindows } = await import("./api.mjs");
    await setWindows(store, { by: me, users: usersMap, mopId: setW.mop.id, days: [setW.day], ranges: setW.ranges });
    const wins = await loadWindows(store);
    if (setW.mop.id !== me.id) await tg.sendMessage(setW.mop.id, `🕐 <b>${h(me.name)} ${setW.ranges.length ? `открыл тебе окна` : "закрыл тебе окна"}</b> на ${setW.day.slice(8)}.${setW.day.slice(5, 7)}${setW.ranges.length ? `: ${rangesText(setW.ranges)}` : ""}`).catch(() => {});
    return reply(`✅ ${setW.ranges.length ? "Окна открыты" : "Окна закрыты"}\n\n${windowsText(setW.day, [setW.mop], clients, wins)}`, { inline_keyboard: [[openApp(appUrl, "Окна в приложении", "?tab=calendar")]] });
  }

  const win = /^\/windows/.test(text) ? { day: addDaysKey(mskKey(now), 1), mop: null } : !ask && parseWindows(text, closers, now);
  if (win) return reply(windowsText(win.day, win.mop ? [win.mop] : closers, clients, await loadWindows(store)));

  // Один или несколько созвонов одним сообщением: «Теме в 18 с Антоном, Диме в 19 @ivan»
  const many = ask ? [] : parseBookings(text, closers, { now, sender: ["mop", "rop"].includes(me.role) ? me : null });
  if (many.length) return handleBookings(many, { me, text, clients, closers, store, tg, appUrl, reply, usersMap, settings, env });
  const book = !ask && parseBooking(text, closers, now);
  if (book) return handleBooking(book, { me, msg, text, clients, closers, store, tg, appUrl, reply, usersMap, settings, env });

  // «@ivan оплатил 100к», «@ivan ндз», «@ivan пришел», «@ivan думает 80к», «@ivan отказ банки»
  const st = !ask && parseStatusCommand(text);
  if (st) {
    const c = clients.find((x) => x.telegram?.toLowerCase() === `@${st.nick}`.toLowerCase());
    if (!c) return reply(`Не нашёл @${h(st.nick)} в CRM. Сначала запиши на созвон или перешли его сообщение — заведу.`);
    return applyStatus(c, st, { me, store, tg, appUrl, reply, usersMap, settings, env });
  }

  // Ответ реплаем на пересланное ботом сообщение — обратно автору
  const replyTo = msg.reply_to_message && (await store.get("relay", `${msg.chat.id}:${msg.reply_to_message.message_id}`));
  if (replyTo && text) {
    const back = usersMap[replyTo.from];
    return relay(me, back, text, { store, tg, reply, appUrl, answer: true });
  }

  // «Теме: перезвони Глебу», «всем: планёрка в 11»
  // С ИИ «сколько продаж у Димы?» — вопрос, а не сообщение Диме: правилом ловим только «Диме: …».
  const others = users.filter((u) => u.id !== me.id);
  const rel = text && (!aiOn || /^\s*\S+(?:\s\S+)?\s*:/.test(text)) && parseRelay(text, others);
  if (rel?.all) return relayAll(me, others, rel.text, { store, tg, appUrl, reply });
  if (rel?.to) return relay(me, rel.to, rel.text, { store, tg, reply, appUrl });

  if (aiOn && text && !text.startsWith("/")) {
    const done = await handleAI(text, { me, users, clients, closers, store, tg, appUrl, reply, usersMap, settings, env, msg, now });
    if (done) return;
  }

  return reply(`Привет, ${h(me.name)}! Роль: <b>${ROLES[me.role]}</b>.\n\n${BOT_HELP}`, { inline_keyboard: [[openApp(appUrl)]] });
}

// Статус клиента из бота: «пришёл / НДЗ» закрывают ближайший созвон, остальное — статус карточки.
async function applyStatus(c, st, { me, store, tg, appUrl, reply, usersMap, settings, env }) {
  const { applyAction } = await import("./api.mjs");
  const ctx = { by: me.id, store, users: usersMap, settings, notes: [] };
  try {
    if (st.action === "held" || st.action === "ndz") {
      const open = (c.calls || []).filter((x) => !x.outcome).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
      if (!open) return reply(`У ${who(c)} нет назначенного созвона. Запиши: <code>сегодня у Димы в 14:00 был созвон с ${h(c.telegram || c.name || "клиента")}</code>`);
      await applyAction(c, { type: st.action, callId: open.id }, ctx);
    } else await applyAction(c, { type: "status", status: st.action, sum: st.sum || c.wantedSum || 0 }, ctx);
  } catch (e) {
    return reply(`⚠️ ${h(e.message)}`);
  }
  c.updatedAt = new Date().toISOString();
  await store.put("client", c.id, c);
  await dispatch(ctx.notes, c, { store, env, tg, appUrl, by: me.id, users: usersMap, settings });
  const kb = [[openApp(appUrl, st.action === "held" ? "Заполнить отчёт" : "Карточка", `?client=${c.id}${st.action === "held" ? "&report=1" : ""}`)]];
  return reply(`✅ ${who(c)} → <b>${st.action === "held" ? "созвон проведён" : statusLabel(c.status)}</b>${st.sum ? ` · ${rub(st.sum)}` : ""}${st.action === "held" ? "\nТеперь итог диагностики: пришли блок «Потребность/запрос клиента: …» с @ником или заполни в приложении." : ""}`, { inline_keyboard: kb });
}

async function relayAll(me, to, text, { store, tg, appUrl, reply }) {
  const ok = [];
  for (const u of to) if (await relay(me, u, text, { store, tg, appUrl, silent: true })) ok.push(u.name);
  await addFeed(store, { type: "comment", text: `📣 ${me.name} → всем: ${text}`, by: me.id, to: to.map((u) => u.id) });
  return reply(`📣 Отправил: ${ok.map(h).join(", ") || "никому — ещё никто не запустил бота"}`);
}

// ИИ: разговор как с человеком. Действия выполняются тем же кодом, что и команды.
async function handleAI(text, { me, users, clients, closers, store, tg, appUrl, reply, usersMap, settings, env, msg, now }) {
  const { chat, findClient } = await import("./ai.mjs");
  const { blankClient, log, applyAction } = await import("./api.mjs");
  tg.sendChatAction?.(msg.chat.id).catch(() => {});
  const legacy = (await store.get("meta", "legacy")) || {};
  const pick = async (ref) => {
    const { c, list } = findClient(clients, ref);
    if (!c) await reply(list.length > 1 ? `Таких клиентов несколько: ${list.slice(0, 5).map(who).join(", ")}. Уточни @ником.` : `Не нашёл «${h(ref)}» в CRM. Напиши @ник или телефон клиента.`);
    return c;
  };
  const save = async (c, ctx) => {
    c.updatedAt = new Date().toISOString();
    await store.put("client", c.id, c);
    await dispatch(ctx.notes, c, { store, env, tg, appUrl, by: me.id, users: usersMap, settings });
  };
  const nickOf = (v) => {
    const n = String(v || "").replace(/^@/, "").trim();
    return /^[A-Za-z][\w]{3,31}$/.test(n) ? n : null;
  };
  const act = async (name, inp) => {
    const ctx = { by: me.id, store, users: usersMap, settings, notes: [] };
    try {
      if (name === "book_calls") {
        const items = (Array.isArray(inp.items) ? inp.items : []).map((it) => {
          const time = /^\d{1,2}:\d{2}$/.test(it.time || "") ? it.time.padStart(5, "0") : null;
          const at = time && /^\d{4}-\d{2}-\d{2}$/.test(it.date || "") ? Date.parse(`${it.date}T${time}:00+03:00`) : NaN;
          return { at, day: it.date, time, mop: closers.find((u) => u.name === it.mop) || null, nick: nickOf(it.client_nick), name: String(it.client_name || "").trim().slice(0, 120), phone: String(it.phone || "").replace(/[^\d+]/g, ""), text };
        }).filter((b) => Number.isFinite(b.at));
        if (!items.length) return reply("Не понял дату или время созвона 🤔 Напиши, например: <code>завтра в 18 к Теме Антон @anton</code>");
        return handleBookings(items, { me, text, clients, closers, store, tg, appUrl, reply, usersMap, settings, env });
      }
      if (name === "set_status") {
        if (!AI_STATUS_SET.has(inp.status)) return;
        const c = await pick(inp.client);
        return c && applyStatus(c, { action: inp.status, sum: Number(inp.sum) || 0 }, { me, store, tg, appUrl, reply, usersMap, settings, env });
      }
      if (name === "save_report") {
        const c = await pick(inp.client);
        if (!c) return;
        const report = Object.fromEntries(REPORT_FIELDS.map((f) => [f.id, inp[f.id] ? String(inp[f.id]) : ""]));
        const pending = (c.calls || []).some((x) => x.outcome === "held" && !x.reportAt);
        const status = AFTER_CALL.includes(inp.status) ? inp.status : null;
        await applyAction(c, { type: "report", report, newCall: !pending, date: new Date().toISOString(), mopId: ["mop", "rop"].includes(me.role) ? me.id : c.mopId || me.id, ...(status ? { status, sum: Number(inp.sum) || c.wantedSum || 0 } : {}) }, ctx);
        await save(c, ctx);
        return reply(`📝 <b>Отчёт сохранён</b> — ${who(c)}${status ? ` · ${statusLabel(c.status)}` : ""}`, { inline_keyboard: [[openApp(appUrl, "Открыть карточку", `?client=${c.id}`)]] });
      }
      if (name === "add_comment") {
        const c = await pick(inp.client);
        if (!c || !inp.text) return;
        await applyAction(c, { type: "comment", text: String(inp.text) }, ctx);
        await save(c, ctx);
        return reply(`💬 Записал в карточку ${who(c)}`);
      }
      if (name === "create_lead") {
        const nick = nickOf(inp.nick);
        const dup = nick && clients.find((x) => x.telegram?.toLowerCase() === `@${nick}`.toLowerCase());
        if (dup) return reply(`Уже есть: <b>${who(dup)}</b> — ${statusLabel(dup.status)}`);
        if (!nick && !inp.name && !inp.phone) return reply("Кого завести? Нужно имя, @ник или телефон.");
        const c = blankClient(me.id);
        Object.assign(c, { name: String(inp.name || "").slice(0, 120), telegram: nick ? `@${nick}` : "", phone: String(inp.phone || "").replace(/[^\d+]/g, ""), info: String(inp.info || "").slice(0, 1000), lidorubId: me.role === "lidorub" ? me.id : null });
        log(c, me.id, "Клиент создан из бота");
        clients.push(c);
        await store.put("client", c.id, c);
        return reply(`🆕 Лид заведён: <b>${who(c)}</b>`, { inline_keyboard: [[openApp(appUrl, "📅 Записать на созвон", `?client=${c.id}&book=1`)]] });
      }
      if (name === "cancel_call") {
        const c = await pick(inp.client);
        if (!c) return;
        const call = (c.calls || []).filter((x) => !x.outcome).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
        if (!call) return reply(`У ${who(c)} нет назначенного созвона.`);
        Object.assign(call, { outcome: "moved", movedAt: nowIso() });
        if (!c.calls.some((x) => !x.outcome)) c.status = "new";
        log(c, me.id, "Запись на созвон отменена");
        await save(c, ctx);
        if (call.mopId !== me.id) await tg.sendMessage(call.mopId, `🚫 <b>Созвон отменён</b>: ${fmtWhen(Date.parse(call.at))} — ${who(c)} (${h(me.name)})`).catch(() => {});
        return reply(`🚫 Отменил созвон ${fmtWhen(Date.parse(call.at))} — ${who(c)}${call.mopId !== me.id ? `. ${h(usersMap[call.mopId]?.name || "")} в курсе.` : ""}`);
      }
      if (name === "set_windows") {
        const mop = closers.find((u) => u.name === inp.mop);
        if (!mop) return reply("Кому окна? Назови диагноста.");
        const { setWindows } = await import("./api.mjs");
        const res = await setWindows(store, { by: me, users: usersMap, mopId: mop.id, days: inp.dates || [], ranges: inp.ranges || [] });
        const dd = res.days.map((d) => `${d.slice(8)}.${d.slice(5, 7)}`).join(", ");
        if (mop.id !== me.id) await tg.sendMessage(mop.id, `🕐 <b>${h(me.name)} ${res.ranges.length ? "открыл тебе окна" : "закрыл тебе окна"}</b>: ${dd}${res.ranges.length ? ` · ${rangesText(res.ranges)}` : ""}`).catch(() => {});
        return reply(`🕐 ${res.ranges.length ? "Окна открыты" : "Окна закрыты"} — <b>${h(mop.name)}</b>: ${dd}${res.ranges.length ? ` · ${rangesText(res.ranges)}` : ""}`, { inline_keyboard: [[openApp(appUrl, "Окна в приложении", "?tab=calendar")]] });
      }
      if (name === "send_message") {
        if (!inp.text) return;
        const others = users.filter((u) => u.id !== me.id);
        if (inp.to === "всем") return relayAll(me, others, String(inp.text), { store, tg, appUrl, reply });
        return relay(me, others.find((u) => u.name === inp.to), String(inp.text), { store, tg, reply, appUrl });
      }
    } catch (e) {
      return reply(`⚠️ ${h(e.message)}`);
    }
  };
  const windows = await loadWindows(store);
  const res = await chat(text, { me, users, clients, legacy, settings, windows, store, env, now, client: env.__aiClient || null, act });
  if (!res) return false;
  if (res.error) {
    if (res.error === "refusal") return reply("С этим не помогу 🙅 Давай по работе.");
    const why = { limit: "дневной лимит сообщений к ИИ исчерпан", budget: "месячный бюджет на ИИ исчерпан", key: "ключ ANTHROPIC_API_KEY не подходит", balance: "на балансе Anthropic закончились деньги", rate: "Anthropic просит притормозить — попробуй через минуту" }[res.error] || "ИИ сейчас недоступен";
    // Руководству — причина; остальным — обычная справка, как без ИИ.
    if (!["owner", "rop"].includes(me.role)) return false;
    await reply(`⚠️ ${why}${res.error === "api" ? `: ${h(res.detail || "")}` : ""}. Проверка — /ai. Команды работают как обычно.`);
    return true;
  }
  if (res.text) await reply(h(res.text));
  return Boolean(res.text || res.acted);
}

// Сообщение члену команды от имени бота. Ответ реплаем вернётся автору.
async function relay(from, to, text, { store, tg, reply, appUrl, answer = false, silent = false }) {
  if (!to) {
    if (!silent) await reply("Не нашёл, кому передать.");
    return false;
  }
  const head = answer ? `↩️ <b>Ответ от ${h(from.name)}</b>` : `📩 <b>${h(from.name)} пишет тебе</b>`;
  try {
    const sent = await tg.sendMessage(to.id, `${head}\n\n${h(text)}\n\n<i>Ответь на это сообщение (свайп влево → «Ответить») — передам ${h(from.name)}.</i>`, { inline_keyboard: [[openApp(appUrl)]] });
    if (sent?.message_id) await store.put("relay", `${to.id}:${sent.message_id}`, { id: `${to.id}:${sent.message_id}`, from: from.id, at: new Date().toISOString() });
    if (!silent) {
      await addFeed(store, { type: "comment", text: `💬 ${from.name} → ${to.name}: ${text}`, by: from.id, to: [to.id] });
      await reply(`✅ Передал ${h(to.name)}`);
    }
    return true;
  } catch {
    if (!silent) await reply(`⚠️ Не дошло до ${h(to.name)}: он ещё не нажал Start у бота (или заблокировал его).`);
    return false;
  }
}

// Итог диагностики текстом из чата → отчёт в карточке, потом кнопки статуса.
async function handleReportMessage(text, { me, clients, store, tg, appUrl, reply, usersMap, settings, env, users }) {
  const team = new Set(users.map((u) => (u.username || "").toLowerCase()).filter(Boolean));
  const nick = (text.match(/@([A-Za-z][\w]{3,31})/g) || []).map((n) => n.slice(1)).find((n) => !team.has(n.toLowerCase()));
  if (!nick) return reply("Чей это отчёт? Добавь @ник клиента в сообщение и пришли ещё раз.");
  const { blankClient, log, applyAction } = await import("./api.mjs");
  let c = clients.find((x) => x.telegram?.toLowerCase() === `@${nick}`.toLowerCase());
  let created = false;
  if (!c) {
    c = blankClient(me.id);
    Object.assign(c, { telegram: `@${nick}` });
    log(c, me.id, "Клиент создан из отчёта в боте");
    created = true;
  }
  const r = parseReportText(text.replace(new RegExp(`@${nick}`, "g"), ""));
  const pending = (c.calls || []).some((x) => x.outcome === "held" && !x.reportAt);
  const ctx = { by: me.id, store, users: usersMap, settings, notes: [] };
  await applyAction(c, { type: "report", report: r, newCall: !pending, date: new Date().toISOString(), mopId: ["mop", "rop"].includes(me.role) ? me.id : c.mopId || me.id }, ctx);
  c.updatedAt = new Date().toISOString();
  await store.put("client", c.id, c);
  const S = [["paid", "💰 Оплатил"], ["prepaid", "💵 Предоплата"], ["thinking", "🤔 Думает"], ["resched", "🔁 Перенос"], ["refuse_bank", "🏦 Отказ банки"], ["refuse_personal", "✋ Отказ личн."], ["ignore", "🙈 Игнор"], ["invalid", "🚫 Невалид"]];
  const kb = [];
  for (let i = 0; i < S.length; i += 2) kb.push(S.slice(i, i + 2).map(([s, l]) => ({ text: l, callback_data: `rs:${c.id}:${s}` })));
  kb.push([openApp(appUrl, "Открыть карточку", `?client=${c.id}`)]);
  return reply(`📝 <b>Отчёт сохранён</b> — ${who(c)}${created ? " (новый клиент)" : ""}\n${r.need ? `Запрос: ${h(r.need.slice(0, 120))}\n` : ""}${r.dream ? `Боль: ${h(r.dream.slice(0, 120))}\n` : ""}\n<b>Итоговый статус?</b>`, { inline_keyboard: kb });
}

// Свободные окна: 10:00–21:00 по часу, занятые — с именем клиента.
const SLOTS = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
function busyOf(mopId, day, clients) {
  const out = [];
  for (const c of clients) for (const call of c.calls || []) if (call.mopId === mopId && !["moved", "ndz"].includes(call.outcome) && mskKey(Date.parse(call.at)) === day) out.push({ time: mskTime(Date.parse(call.at)), c });
  return out.sort((a, b) => a.time.localeCompare(b.time));
}
// Окна дня: заданные окна диагностов со свободными/занятыми слотами; окон нет — как раньше, по часу 10–21.
export function windowsText(day, mops, clients, windows = []) {
  const now = Date.now();
  const parts = mops.map((m) => {
    const busy = busyOf(m.id, day, clients);
    const w = windows.find((x) => x.mopId === m.id && x.day === day);
    if (w?.ranges?.length) {
      const slots = daySlots(day, w.ranges, busy, now);
      const free = slots.filter((x) => x.state === "free").map((x) => x.time);
      return `<b>${h(m.name)}</b> · окно ${rangesText(w.ranges)}\n${slots.filter((x) => x.state === "busy").map((x) => `🔴 ${x.time} — ${who(x.item.c)}${x.inWindow ? "" : " (вне окна)"}`).join("\n")}${slots.some((x) => x.state === "busy") ? "\n" : ""}🟢 свободно: ${free.join(", ") || "нет"}`;
    }
    const taken = new Set(busy.map((b) => b.time.slice(0, 2)));
    const free = SLOTS.filter((s) => !taken.has(s.slice(0, 2)) && Date.parse(`${day}T${s}:00+03:00`) > now);
    return `<b>${h(m.name)}</b> · окна не заданы\n${busy.length ? busy.map((b) => `🔴 ${b.time} — ${who(b.c)}`).join("\n") + "\n" : ""}⚪️ не занято: ${free.join(", ") || "нет"}`;
  });
  return `🕐 <b>Окна на ${day.slice(8)}.${day.slice(5, 7)} (${weekday(day)})</b>\n\n${parts.join("\n\n") || "Нет диагностов в команде"}\n\n<i>Открыть окна: «окна Тёме завтра с 18 до 21» или в приложении → Окна.</i>`;
}

function dayCalls(user, clients, day, usersMap) {
  const boss = ["owner", "rop", "lidorub"].includes(user.role);
  const list = [];
  for (const c of clients) for (const call of c.calls || []) if (!call.outcome && mskKey(Date.parse(call.at)) === day && (boss || call.mopId === user.id)) list.push({ c, call });
  list.sort((a, b) => Date.parse(a.call.at) - Date.parse(b.call.at));
  if (!list.length) return "";
  return `📅 <b>Созвоны ${day.slice(8)}.${day.slice(5, 7)} (${list.length})</b>\n${list.map(({ c, call }) => `• ${mskTime(Date.parse(call.at))} — ${who(c)}${boss ? ` · ${h(usersMap[call.mopId]?.name || "")}` : ""}`).join("\n")}`;
}

// Короткая команда статуса по @нику клиента.
export function parseStatusCommand(text) {
  const t = String(text || "").toLowerCase().replace(/ё/g, "е");
  const nick = (text.match(/@([A-Za-z][\w]{3,31})/) || [])[1];
  if (!nick || t.length > 200) return null;
  const k = (re) => re.test(t);
  let action = null;
  if (k(/оплатил|купил|оплата прошла|продажа/)) action = "paid";
  else if (k(/предоплат|бронь|забронировал/)) action = "prepaid";
  else if (k(/отказ\S*\s+(?:по\s+)?банк|банк\S*\s+отказ|не одобрил/)) action = "refuse_bank";
  else if (k(/невалид|неквал/)) action = "invalid";
  else if (k(/отказ|не будет брать|не интересно/)) action = "refuse_personal";
  else if (k(/игнор|пропал|не отвечает/)) action = "ignore";
  else if (k(/(?:^|[^а-я])ндз(?![а-я])|не приш[её]л|не дош[её]л|не вышел/)) action = "ndz";
  else if (k(/приш[её]л|дош[её]л|провел|провели|был на созвоне/)) action = "held";
  else if (k(/думает|подумать/)) action = "thinking";
  else if (k(/перенос/)) action = "resched";
  if (!action) return null;
  const m = t.match(/(\d{2,3})\s?к(?![а-я])|(\d{2,3}[\s.]?\d{3})\s*(?:р|руб|₽)?/);
  const sum = m ? (m[1] ? +m[1] * 1000 : +m[2].replace(/\D/g, "")) : 0;
  return { nick, action, sum };
}

// Пакет созвонов: каждый — в CRM, каждому менеджеру — уведомление, автору — сводка и «Отменить всё».
async function handleBookings(items, { me, text, clients, closers, store, tg, appUrl, reply, usersMap, settings, env }) {
  const { blankClient, log, applyAction } = await import("./api.mjs");
  const now = Date.now();
  const done = [];
  const skipped = [];
  const taken = [];
  const wins = await loadWindows(store);
  for (const b of items) {
    const label = `${b.time}${b.mop ? ` ${h(b.mop.name)}` : ""}${b.nick || b.name ? ` — ${h(b.nick ? `@${b.nick}` : b.name)}` : ""}`;
    if (!b.mop) {
      skipped.push(`${label}: к кому? (${closers.map((u) => h(u.name)).join(" / ")})`);
      continue;
    }
    if (!b.nick && !b.name && !b.phone) {
      skipped.push(`${label}: с кем? добавь имя или @ник`);
      continue;
    }
    if (b.at < now - 3 * 86400_000) {
      skipped.push(`${label}: это было больше 3 дней назад`);
      continue;
    }
    const day = mskKey(b.at);
    const busy = [...busyOf(b.mop.id, day, clients).map((x) => ({ t: Date.parse(`${day}T${x.time}:00+03:00`), c: x.c })), ...taken.filter((x) => x.mop === b.mop.id).map((x) => ({ t: x.at, c: x.c }))];
    const nick = b.nick ? `@${b.nick}` : "";
    let c =
      (nick && clients.find((x) => x.telegram?.toLowerCase() === nick.toLowerCase())) ||
      (b.phone && clients.find((x) => x.phone?.replace(/\D/g, "").endsWith(b.phone.replace(/\D/g, "").slice(-10)))) ||
      (!nick && !b.phone && b.name && clients.find((x) => !isClosed(x.status) && x.name?.toLowerCase() === b.name.toLowerCase())) ||
      null;
    const clash = busy.find((x) => Math.abs(x.t - b.at) < 45 * 60_000 && x.c.id !== c?.id);
    if (clash) {
      skipped.push(`${label}: у ${h(b.mop.name)} уже ${mskTime(clash.t)} — ${who(clash.c)}`);
      continue;
    }
    let created = false;
    if (!c) {
      c = blankClient(me.id);
      Object.assign(c, { name: b.name, telegram: nick, phone: b.phone, lidorubId: me.role === "lidorub" ? me.id : null });
      log(c, me.id, "Клиент создан из бота");
      clients.push(c);
      created = true;
    }
    const ctx = { by: me.id, store, users: usersMap, settings, notes: [] };
    await applyAction(c, { type: "call", at: new Date(b.at).toISOString(), mopId: b.mop.id }, ctx);
    c.updatedAt = new Date().toISOString();
    await store.put("client", c.id, c);
    for (const n of ctx.notes) if (n.t === "call") n.text = items.length > 1 ? b.text : text;
    await dispatch(ctx.notes, c, { store, env, tg, appUrl, by: me.id, users: usersMap, settings });
    const call = c.calls.at(-1);
    taken.push({ mop: b.mop.id, at: b.at, c });
    const w = wins.find((x) => x.mopId === b.mop.id && x.day === day);
    const m = toMin(mskTime(b.at));
    const outside = w && !w.ranges.some((r) => toMin(r.from) <= m && m < toMin(r.to));
    done.push({ c, call, b, created, past: b.at < now, outside: outside ? rangesText(w.ranges) : "" });
  }
  if (!done.length) return reply(`Ничего не внёс 🤔\n${skipped.map((x) => `• ${x}`).join("\n")}\n\nПример: <code>завтра: Теме в 18 с Антоном @anton, Диме в 19:30 Иван</code>`);
  const batchId = Math.random().toString(36).slice(2, 10);
  await store.put("batch", batchId, { id: batchId, by: me.id, items: done.map((d) => ({ clientId: d.c.id, callId: d.call.id })), at: new Date().toISOString() });
  const lines = done
    .sort((x, y) => x.b.at - y.b.at)
    .map((d) => `• ${fmtWhen(d.b.at)} · <b>${h(d.b.mop.name)}</b> — ${who(d.c)}${d.created ? " 🆕" : ""}${d.past ? " ⏱ уже прошёл — отметь итог" : ""}${d.outside ? ` ⚠️ вне окна (${d.outside})` : ""}`);
  const notified = [...new Set(done.filter((d) => d.b.mop.id !== me.id).map((d) => d.b.mop.name))];
  const kb = [];
  for (const d of done.filter((x) => x.past)) kb.push([{ text: `✅ ${d.b.time} пришёл`, callback_data: `held:${d.c.id}:${d.call.id}` }, { text: `❌ ${d.b.time} НДЗ`, callback_data: `ndz:${d.c.id}:${d.call.id}` }]);
  kb.push([openApp(appUrl, "Созвоны в приложении"), { text: done.length > 1 ? "Отменить всё" : "Отменить", callback_data: `ub:${batchId}` }]);
  return reply(
    `✅ <b>Внёс в CRM: ${done.length} ${done.length === 1 ? "созвон" : done.length < 5 ? "созвона" : "созвонов"}</b>\n${lines.join("\n")}${notified.length ? `\n\n🔔 Уведомил: ${notified.map(h).join(", ")}. Напоминания придут за 2 ч, 1 ч и 15 мин.` : ""}${skipped.length ? `\n\n⚠️ Не внёс:\n${skipped.map((x) => `• ${x}`).join("\n")}` : ""}`,
    { inline_keyboard: kb },
  );
}

async function handleBooking(book, { me, text, clients, closers, store, tg, appUrl, reply, usersMap, settings, env }) {
  const example = "<code>созвон завтра в 15 к Тёме @ivan Иван</code>";
  if (book.needTime) return reply(`Во сколько? Напиши с временем, например:\n${example}`);
  if (book.past) return reply("Это время уже прошло 🙂 Напиши другое.");
  const mop = book.mop || (["mop", "rop"].includes(me.role) ? me : null);
  if (!mop) return reply(`К кому записать? Добавь имя диагноста: ${closers.map((u) => h(u.name)).join(" / ") || "—"}\n${example}`);
  if (!book.nick && !book.name && !book.phone) return reply(`Кого записать? Добавь @ник или имя клиента:\n${example}`);
  // Пересечение: у диагноста уже созвон в этот час
  const clash = busyOf(mop.id, mskKey(book.at), clients).find((b) => Math.abs(Date.parse(`${mskKey(book.at)}T${b.time}:00+03:00`) - book.at) < 45 * 60_000);
  if (clash) return reply(`⛔️ У ${h(mop.name)} уже созвон в ${clash.time} — ${who(clash.c)}.\n\n${windowsText(mskKey(book.at), [mop], clients, await loadWindows(store))}`);

  const { blankClient, log, applyAction } = await import("./api.mjs");
  const nick = book.nick ? `@${book.nick}` : "";
  let c = (nick && clients.find((x) => x.telegram?.toLowerCase() === nick.toLowerCase())) || (book.phone && clients.find((x) => x.phone?.replace(/\D/g, "").endsWith(book.phone.replace(/\D/g, "").slice(-10)))) || null;
  let created = false;
  if (!c) {
    c = blankClient(me.id);
    Object.assign(c, { name: book.name, telegram: nick, phone: book.phone, lidorubId: me.role === "lidorub" ? me.id : null });
    log(c, me.id, "Клиент создан из бота");
    created = true;
  }
  const ctx = { by: me.id, store, users: usersMap, settings, notes: [] };
  await applyAction(c, { type: "call", at: new Date(book.at).toISOString(), mopId: mop.id }, ctx);
  c.updatedAt = new Date().toISOString();
  await store.put("client", c.id, c);
  // Исходную фразу — диагносту целиком: там бывают детали, которых нет в карточке.
  for (const n of ctx.notes) if (n.t === "call") n.text = text;
  await dispatch(ctx.notes, c, { store, env, tg, appUrl, by: me.id, users: usersMap, settings });
  const call = c.calls.at(-1);
  return reply(
    `✅ <b>Записал${created ? " нового клиента" : ""}</b>\n👤 ${who(c)}\n📅 ${fmtWhen(book.at)} МСК · ${h(mop.name)}${mop.id !== me.id ? "\n\n" + h(mop.name) + " получил уведомление." : ""}`,
    { inline_keyboard: [[openApp(appUrl, "Карточка", `?client=${c.id}`), { text: "Отменить", callback_data: `uncall:${c.id}:${call.id}` }]] },
  );
}

async function handleCallback(cb, { store, env, tg, appUrl }) {
  const [action, clientId, callId] = String(cb.data || "").split(":");
  const users = await activeUsers(store, env);
  const me = users.find((u) => u.id === String(cb.from.id));
  const answer = (text) => tg.answerCallback(cb.id, text).catch(() => {});
  if (!me) return answer("Нет доступа");
  if (action === "po") {
    // po:<role>:<personId> — «Выплатил» из понедельничного напоминания
    if (me.role !== "owner") return answer("Выплаты отмечает Петя");
    const { markPayout, loadSettings } = await import("./api.mjs");
    const usersMap = Object.fromEntries(users.map((u) => [u.id, u]));
    try {
      const res = await markPayout(store, { by: me, users: usersMap, settings: await loadSettings(store), role: clientId, personId: callId, tg });
      await answer(`Отмечено: ${res.payout.name} ${rub(res.payout.amount)}`);
      const fresh = await payoutMessage({ store, env, forOwner: true });
      await tg.editMessage(cb.message.chat.id, cb.message.message_id, `${fresh.text}\n\n✅ <i>Выплачено ${h(res.payout.name)}: ${rub(res.payout.amount)}</i>`, fresh.markup(appUrl)).catch(() => {});
    } catch (e) {
      await answer(e.message);
    }
    return;
  }
  if (action === "ub") {
    const batch = await store.get("batch", clientId);
    if (!batch) return answer("Уже неактуально");
    let n = 0;
    for (const it of batch.items) {
      const cl = await store.get("client", it.clientId);
      const call = cl?.calls.find((x) => x.id === it.callId);
      if (!call || call.outcome) continue;
      Object.assign(call, { outcome: "moved", movedAt: new Date().toISOString() });
      if (!cl.calls.some((x) => !x.outcome)) cl.status = "new";
      cl.history = [{ at: new Date().toISOString(), by: me.id, text: "Запись на созвон отменена" }, ...(cl.history || [])];
      await store.put("client", cl.id, cl);
      await tg.sendMessage(call.mopId, `❌ Отменён созвон ${fmtWhen(Date.parse(call.at))} — ${who(cl)}`).catch(() => {});
      n++;
    }
    await store.del("batch", batch.id);
    await answer(n ? `Отменено: ${n}` : "Уже неактуально");
    await tg.editMessage(cb.message.chat.id, cb.message.message_id, `❌ <s>${h(cb.message.text || "")}</s>\nОтменено`).catch(() => {});
    return;
  }
  const c = await store.get("client", clientId);
  if (!c) return answer("Клиент не найден");
  const { applyAction } = await import("./api.mjs");
  if (action === "held" || action === "ndz") {
    const call = c.calls.find((x) => x.id === callId);
    if (call?.outcome) return answer("Уже отмечено");
    await applyAction(c, { type: action, callId }, { by: me.id, store });
    c.updatedAt = nowIso();
    await store.put("client", c.id, c);
    await answer(action === "held" ? "Отмечено: созвон проведён" : `Отмечено: ${statusLabel(c.status)}`);
    const tail = action === "held" ? "\n\n✅ Проведён. Заполни отчёт — без него созвон не закрыт." : `\n\n❌ ${statusLabel(c.status)}. Клиент ушёл в дожим.`;
    const kb = { inline_keyboard: [[openApp(appUrl, action === "held" ? "Заполнить отчёт" : "Открыть карточку", `?client=${c.id}${action === "held" ? "&report=1" : ""}`)]] };
    await tg.editMessage(cb.message.chat.id, cb.message.message_id, `${cb.message.text || ""}${tail}`, kb).catch(() => {});
    return;
  }
  if (action === "rs") {
    const status = callId;
    const { applyAction } = await import("./api.mjs");
    const settings = (await store.get("meta", "settings")) || {};
    const usersMap = Object.fromEntries(users.map((u) => [u.id, u]));
    const sumFromText = Number(((cb.message?.text || "").match(/(\d{2,3})\s?к(?![а-я])/i) || [])[1]) * 1000 || null;
    const ctx = { by: me.id, store, users: usersMap, settings, notes: [] };
    await applyAction(c, { type: "status", status, sum: sumFromText || c.wantedSum || 0 }, ctx);
    c.updatedAt = new Date().toISOString();
    await store.put("client", c.id, c);
    await dispatch(ctx.notes, c, { store, env, tg, appUrl, by: me.id, users: usersMap, settings });
    await answer(`Статус: ${statusLabel(status)}`);
    const needSum = ["paid", "prepaid", "thinking", "resched", "refuse_bank"].includes(status) && !c.wantedSum && !sumFromText;
    await tg.editMessage(cb.message.chat.id, cb.message.message_id, `${h(cb.message.text || "")}\n\n✅ Статус: <b>${statusLabel(status)}</b>${needSum ? "\n⚠️ Сумма не указана — впиши тариф в карточке." : ""}`, { inline_keyboard: [[openApp(appUrl, "Открыть карточку", `?client=${c.id}`)]] }).catch(() => {});
    return;
  }
  if (action === "uncall") {
    const call = c.calls.find((x) => x.id === callId);
    if (!call || call.outcome) return answer("Уже неактуально");
    Object.assign(call, { outcome: "moved", movedAt: new Date().toISOString() });
    if (!c.calls.some((x) => !x.outcome)) c.status = "new";
    c.history = [{ at: new Date().toISOString(), by: me.id, text: "Запись на созвон отменена" }, ...(c.history || [])];
    await store.put("client", c.id, c);
    await answer("Запись отменена");
    await tg.editMessage(cb.message.chat.id, cb.message.message_id, `❌ <s>${h(cb.message.text || "")}</s>\nЗапись отменена`).catch(() => {});
    await tg.sendMessage(call.mopId, `❌ Отменён созвон ${fmtWhen(Date.parse(call.at))} — ${who(c)}`).catch(() => {});
    return;
  }
  return answer("Неизвестная кнопка");
}

// ---------- напоминания о созвонах ----------
// Ступени по регламенту: −2ч подтвердить встречу, −1ч напомнить себе, −15м напомнить клиенту, +15м отметить итог.
const STAGES = [
  { id: "h2", offset: -120 * MIN },
  { id: "h1", offset: -60 * MIN },
  { id: "m15", offset: -15 * MIN },
  { id: "after", offset: 15 * MIN },
];

function callMessage(stage, c, call, users) {
  const lr = users.find((u) => u.id === c.lidorubId);
  const line = `👤 ${who(c)}${c.chatUrl ? `\n💬 <a href="${h(c.chatUrl)}">чат с клиентом</a>` : ""}${c.info ? `\n📝 ${h(c.info.slice(0, 300))}` : ""}${lr ? `\n🪓 лидоруб: ${h(lr.name)}` : ""}`;
  const time = `${mskTime(Date.parse(call.at))} МСК`;
  if (stage === "h2") return `📅 <b>Через 2 часа созвон — ${time}</b>\n${line}\n\nПодтверди встречу в чате с клиентом.`;
  if (stage === "h1") return `⏰ <b>Через час созвон — ${time}</b>\n${line}\n\nОткрой скрипт, проверь, что запись звонка включится.`;
  if (stage === "m15") return `🔔 <b>Через 15 минут созвон — ${time}</b>\n${line}\n\nНапомни клиенту в чате. Не отвечает — звони по телефону${c.phone ? ` ${h(c.phone)}` : ""}.`;
  return `❓ <b>Созвон в ${time} — клиент пришёл?</b>\n${line}\n\nЖдём 15 минут, потом НДЗ.`;
}

function callButtons(stage, c, call, appUrl) {
  const rows = [];
  if (stage === "after") rows.push([{ text: "✅ Пришёл, провёл", callback_data: `held:${c.id}:${call.id}` }, { text: "❌ НДЗ", callback_data: `ndz:${c.id}:${call.id}` }]);
  const second = [openApp(appUrl, "Карточка", `?client=${c.id}`)];
  if (c.chatUrl && /^https:\/\/t\.me\//.test(c.chatUrl)) second.unshift({ text: "Чат с клиентом", url: c.chatUrl });
  rows.push(second);
  return { inline_keyboard: rows };
}

// Раз в минуту: что пора отправить. Отправленное помечаем в созвоне — дублей не будет.
export async function runReminders({ store, env, tg, appUrl, now = Date.now() }) {
  // Один раз после обновления: проиндексировать клиентов, сохранённых до появления индекса
  if (store.watch && !(await store.get("meta", "watch_v1"))) {
    const { needsWatch } = await import("./store.mjs");
    for (const c of await store.all("client")) if (needsWatch(c)) await store.watch(c.id, true);
    await store.put("meta", "watch_v1", { at: new Date().toISOString() });
  }
  const clients = await store.watched();
  const users = await activeUsers(store, env);
  const sent = [];
  for (const c of clients) {
    let dirty = false;
    for (const call of c.calls || []) {
      if (call.outcome) continue;
      const at = Date.parse(call.at);
      if (now - at > 6 * 3600_000) continue; // древние неотмеченные не дёргаем
      call.notified ||= {};
      // Последняя наступившая ступень; ранние, если проспали (созвон назначили за 20 минут), пропускаем.
      const due = STAGES.filter((s) => now >= at + s.offset);
      const stage = due.at(-1);
      if (!stage || call.notified[stage.id]) continue;
      for (const s of due) call.notified[s.id] = call.notified[s.id] || nowIso();
      dirty = true;
      const to = call.mopId;
      try {
        await tg.sendMessage(to, callMessage(stage.id, c, call, users), callButtons(stage.id, c, call, appUrl));
        sent.push(`${stage.id}:${c.id}`);
      } catch {
        // менеджер не запустил бота — отметим и пойдём дальше
      }
    }
    // Созвон проведён, а отчёта нет через 30 минут — пнуть.
    for (const call of c.calls || []) {
      if (call.outcome !== "held" || call.reportAt || call.notified?.report) continue;
      if (now - Date.parse(call.outcomeAt || call.at) < 30 * MIN) continue;
      call.notified = { ...(call.notified || {}), report: nowIso() };
      dirty = true;
      await tg
        .sendMessage(call.mopId, `📝 <b>Отчёт после диагностики</b>\n👤 ${who(c)}\n\nПо регламенту отчёт и CRM — сразу после созвона.`, { inline_keyboard: [[openApp(appUrl, "Заполнить отчёт", `?client=${c.id}&report=1`)]] })
        .then(() => sent.push(`report:${c.id}`))
        .catch(() => {});
    }
    if (dirty) await store.put("client", c.id, c);
  }
  return sent;
}

// ---------- сводки ----------
export function dayPlan(user, clients, now = Date.now()) {
  const today = mskKey(now);
  const mine = (c) => c.mopId === user.id || c.lidorubId === user.id || ["owner", "rop"].includes(user.role);
  const calls = [];
  for (const c of clients) for (const call of c.calls || []) if (!call.outcome && mskKey(Date.parse(call.at)) === today && (call.mopId === user.id || ["owner", "rop"].includes(user.role))) calls.push({ c, call });
  calls.sort((a, b) => Date.parse(a.call.at) - Date.parse(b.call.at));
  const reports = clients.filter((c) => needsReport(c) && (c.mopId === user.id || ["owner", "rop"].includes(user.role)));
  const follow = clients.filter((c) => mine(c) && c.mopId && (c.mopId === user.id || ["owner", "rop"].includes(user.role)) && followupState(c, now)?.due);
  const fresh = user.role === "lidorub" ? clients.filter((c) => c.status === "new" && (!c.lidorubId || c.lidorubId === user.id)) : [];
  const parts = [];
  if (calls.length) parts.push(`📞 <b>Созвоны сегодня (${calls.length})</b>\n${calls.map(({ c, call }) => `• ${mskTime(Date.parse(call.at))} — ${who(c)}`).join("\n")}`);
  if (reports.length) parts.push(`📝 <b>Нет отчёта (${reports.length})</b>\n${reports.slice(0, 10).map((c) => `• ${who(c)}`).join("\n")}`);
  if (follow.length) parts.push(`🔁 <b>Дожим — касание сегодня (${follow.length})</b>\n${follow.slice(0, 10).map((c) => `• ${who(c)} — ${statusLabel(c.status)}`).join("\n")}`);
  if (fresh.length) parts.push(`🪓 <b>Новые лиды без созвона (${fresh.length})</b>\n${fresh.slice(0, 10).map((c) => `• ${who(c)}`).join("\n")}`);
  return parts.join("\n\n");
}

export async function runMorning({ store, env, tg, appUrl, now = Date.now() }) {
  const users = await activeUsers(store, env);
  const clients = await store.all("client");
  const legacy = (await store.get("meta", "legacy")) || {};
  const settings = (await store.get("meta", "settings")) || {};
  const payments = await store.all("payment");
  const yesterday = addDaysKey(mskKey(now), -1);
  const y = rnp(clients, legacy, { from: yesterday, to: yesterday, aliases: settings.aliases }).total;
  const month = monthSummary(payments, mskKey(now).slice(0, 7), settings.rates);
  const results = [];
  // По понедельникам — бэкап базы собственнику, чтобы ничего не пропало.
  if (new Date(now + 3 * 3600_000).getUTCDay() === 1) {
    const { sendExport } = await import("./export.mjs");
    for (const u of users.filter((x) => x.role === "owner")) await sendExport({ store, tg, to: u.id, withMoney: true, now }).catch(() => {});
  }
  for (const u of users) {
    const plan = dayPlan(u, clients, now);
    let text = `☀️ <b>Доброе утро, ${h(u.name || "")}!</b>`;
    if (["owner", "rop"].includes(u.role)) {
      text += `\n\n📊 <b>Вчера (${yesterday.slice(8)}.${yesterday.slice(5, 7)})</b>: лидов ${y.leads} · назначено ${y.scheduled} · проведено ${y.held} · продаж ${y.sales} на ${rub(y.salesSum)}`;
      text += `\n💰 Месяц: выручка ${rub(month.totals.tariff)}, чистыми после всех выплат ${rub(month.totals.left)}`;
      if (month.pending.count) text += `\n⚠️ Не верифицировано оплат: ${month.pending.count} на ${rub(month.pending.tariff)}`;
    }
    text += plan ? `\n\n${plan}` : "\n\nСозвонов и долгов на сегодня нет.";
    try {
      await tg.sendMessage(u.id, text, { inline_keyboard: [[openApp(appUrl)]] });
      results.push({ id: u.id, ok: true });
    } catch (e) {
      results.push({ id: u.id, ok: false, error: e.message });
    }
  }
  return results;
}

// Вечером РОПу и собственнику: кто не закрыл день (нет отчётов, неотмеченные созвоны).
export async function runEvening({ store, env, tg, appUrl, now = Date.now() }) {
  const users = await activeUsers(store, env);
  const clients = await store.all("client");
  const today = mskKey(now);
  const byMop = {};
  for (const c of clients) {
    for (const call of c.calls || []) {
      if (mskKey(Date.parse(call.at)) !== today) continue;
      const m = (byMop[call.mopId] ||= { open: 0, noReport: 0 });
      if (!call.outcome && Date.parse(call.at) < now) m.open++;
      if (call.outcome === "held" && !call.reportAt) m.noReport++;
    }
  }
  const lines = Object.entries(byMop)
    .filter(([, m]) => m.open || m.noReport)
    .map(([id, m]) => `• ${h(users.find((u) => u.id === id)?.name || id)}: ${[m.open && `не отмечено созвонов ${m.open}`, m.noReport && `нет отчётов ${m.noReport}`].filter(Boolean).join(", ")}`);
  if (!lines.length) return [];
  const text = `🌙 <b>День не закрыт</b>\n${lines.join("\n")}`;
  const out = [];
  for (const u of users.filter((x) => ["owner", "rop"].includes(x.role))) {
    await tg.sendMessage(u.id, text, { inline_keyboard: [[openApp(appUrl)]] }).then(() => out.push(u.id)).catch(() => {});
  }
  return out;
}

export { fmtWhen, currentCall, clientTitle };

// ---------- выплаты команде ----------
// Кому сколько заплатить: РОПу и лидорубу (по понедельникам). МОПу Петя платит сразу — в напоминании не показываем.
export async function payoutMessage({ store, env, now = Date.now(), forOwner = true }) {
  const { ensurePayoutFlags, loadSettings, mopResolver } = await import("./api.mjs");
  const { payoutsOwed, PAYOUT_ROLES } = await import("../public/lib/model.js");
  const [payments, settings, users] = await Promise.all([ensurePayoutFlags(store), loadSettings(store), activeUsers(store, env)]);
  const name = (id) => users.find((u) => u.id === id)?.name || String(id || "").replace(/^legacy:/, "");
  const mopOf = mopResolver(settings);
  const { groups, pending } = payoutsOwed(payments, users, settings.rates, { roles: ["rop", "lidorub"], mopOf });
  const today = mskKey(now);
  const dd = (d) => `${d.slice(8)}.${d.slice(5, 7)}`;
  const total = groups.reduce((sum, g) => sum + g.total, 0);
  const parts = [`💸 <b>Выплаты команде · ${weekday(today)} ${dd(today)}</b>`];
  if (!groups.length) parts.push("\nРОПу и лидорубу ничего не должны 👌");
  for (const g of groups) {
    parts.push(`\n<b>${PAYOUT_ROLES[g.role]} ${h(name(g.personId))} — ${rub(g.total)}</b> (${g.items.length} опл.)`);
    for (const it of g.items) parts.push(`• ${dd(it.p.date)} ${h(it.p.clientName || "оплата")} · ${h(name(mopOf(it.p)))} · ${rub(it.p.tariff)} → <b>${rub(it.amount)}</b>`);
  }
  if (groups.length > 1) parts.push(`\n<b>Итого: ${rub(total)}</b>`);
  if (pending.length) parts.push(`\n⚠️ Не входят — нет чистой суммы (Андрею верифицировать):\n${pending.map((p) => `• ${dd(p.date)} ${h(p.clientName || "оплата")} · ${h(name(mopOf(p)))} · ${rub(p.tariff)}`).join("\n")}`);
  return {
    text: parts.join("\n"),
    total,
    groups,
    markup: (appUrl) => ({
      inline_keyboard: [
        ...(forOwner ? groups.map((g) => [{ text: `✅ ${name(g.personId)} — выплатил ${rub(g.total)}`, callback_data: `po:${g.role}:${g.personId}` }]) : []),
        [openApp(appUrl, "Выплаты в приложении", "?tab=more&more=payouts")],
      ],
    }),
  };
}

// Понедельник, после 10:00 МСК — один раз собственнику: кому сколько заплатить.
export async function runPayoutReminder({ store, env, tg, appUrl, now = Date.now() }) {
  const msk = new Date(now + 3 * 3600_000);
  if (msk.getUTCDay() !== 1 || msk.getUTCHours() < 10) return null;
  const today = mskKey(now);
  if ((await store.get("meta", "payout-remind"))?.day === today) return null;
  const msg = await payoutMessage({ store, env, now, forOwner: true });
  // Нечего платить (или ведомость ещё не загружена) — не «сжигаем» понедельник, проверим через минуту.
  if (!msg.total) return { sent: 0 };
  await store.put("meta", "payout-remind", { id: "payout-remind", day: today, at: new Date(now).toISOString() });
  const owners = (await activeUsers(store, env)).filter((u) => u.role === "owner");
  let sent = 0;
  for (const u of owners) await tg.sendMessage(u.id, msg.text, msg.markup(appUrl)).then(() => sent++).catch(() => {});
  return { sent, total: msg.total };
}
