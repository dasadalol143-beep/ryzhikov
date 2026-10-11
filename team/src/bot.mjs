// Бот команды: напоминания о созвонах, отметки «пришёл / НДЗ» прямо из Telegram, утренняя сводка.
import { escapeHtml as h } from "./telegram.mjs";
import {
  ROLES, currentCall, clientTitle, mskKey, mskTime, fmtWhen, needsReport, followupState, statusLabel, monthSummary, addDaysKey,
} from "../public/lib/model.js";
import { rnp } from "../public/lib/stats.js";

export const BOT_COMMANDS = [
  { command: "start", description: "Открыть приложение команды" },
  { command: "today", description: "Мои созвоны и задачи на сегодня" },
];

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
  if (update.callback_query) return handleCallback(update.callback_query, { store, env, tg, appUrl });
  const msg = update.message;
  if (!msg?.from || msg.chat?.type !== "private") return;
  const users = await activeUsers(store, env);
  const me = users.find((u) => u.id === String(msg.from.id));
  const reply = (text, markup) => tg.sendMessage(msg.chat.id, text, markup).catch(() => {});
  if (!me) {
    await store.put("pending", String(msg.from.id), {
      id: String(msg.from.id),
      name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || msg.from.username || String(msg.from.id),
      username: msg.from.username || "",
      at: nowIso(),
    });
    return reply(`Привет! Это рабочее пространство команды Рыжикова.\n\nДоступа пока нет. Твой ID: <code>${msg.from.id}</code>\nПетя или Андрей выдадут роль в приложении — ты уже в списке заявок.`);
  }
  // Запоминаем, что человек запустил бота: только таким можно писать напоминания.
  if (!me.botStarted) await store.put("user", me.id, { ...me, botStarted: true });
  const text = (msg.text || "").trim();
  if (/^\/today/.test(text)) {
    const clients = await store.all("client");
    return reply(dayPlan(me, clients, Date.now()) || "На сегодня созвонов и долгов нет 👌", { inline_keyboard: [[openApp(appUrl)]] });
  }
  return reply(`Привет, ${h(me.name)}! Роль: <b>${ROLES[me.role]}</b>.\n\nЗа 2 часа, за час и за 15 минут до созвона напомню, после созвона спрошу «пришёл или НДЗ», утром пришлю план на день.\n\n/today — мои созвоны и задачи на сегодня`, {
    inline_keyboard: [[openApp(appUrl)]],
  });
}

async function handleCallback(cb, { store, env, tg, appUrl }) {
  const [action, clientId, callId] = String(cb.data || "").split(":");
  const users = await activeUsers(store, env);
  const me = users.find((u) => u.id === String(cb.from.id));
  const answer = (text) => tg.answerCallback(cb.id, text).catch(() => {});
  if (!me) return answer("Нет доступа");
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
  const clients = await store.all("client");
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
