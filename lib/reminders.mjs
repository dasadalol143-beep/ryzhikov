// Напоминания из бота: хранятся одним списком, крон раз в минуту рассылает наступившие.
import { formatMsk } from "./nlp.mjs";
import { escapeHtml } from "./telegram.mjs";

export const REMINDERS_KEY = "reminders";
export const loadReminders = async (store) => (await store.getJSON(REMINDERS_KEY)) || [];

export function reminderText(r, { due = false } = {}) {
  const who = r.leadTitle ? `\n👤 ${escapeHtml(r.leadTitle)}` : r.nick ? `\n👤 @${escapeHtml(r.nick)} (нет в CRM)` : "";
  return due ? `⏰ <b>Напоминание</b>\n${escapeHtml(r.task)}${who}` : `⏰ Напомню <b>${formatMsk(r.dueAt)}</b>\n${escapeHtml(r.task)}${who}`;
}

export function reminderButtons(r, appUrl, { due = false } = {}) {
  const row = [];
  if (r.leadId && appUrl) row.push({ text: "Открыть лида", web_app: { url: `${appUrl}?lead=${r.leadId}` } });
  row.push(due ? { text: "Отложить на час", callback_data: `snooze:${r.id}` } : { text: "Отменить", callback_data: `rmcancel:${r.id}` });
  return { inline_keyboard: [row] };
}

// Отправить наступившие. Пишем в хранилище, только если что-то ушло, и перечитываем перед записью,
// чтобы не потерять напоминание, созданное в эту же секунду.
export async function runReminders({ store, tg, appUrl, now = Date.now() }) {
  const due = (await loadReminders(store)).filter((r) => r.dueAt <= now + 30000);
  if (!due.length) return [];
  const sent = [];
  for (const r of due) {
    try {
      await tg.sendMessage(r.chatId, reminderText(r, { due: true }), reminderButtons(r, appUrl, { due: true }));
    } catch {
      // заблокировали бота или чат недоступен — всё равно убираем, чтобы не долбить каждую минуту
    }
    sent.push(r);
  }
  const done = new Set(sent.map((r) => r.id));
  const fresh = await loadReminders(store);
  await store.setJSON(REMINDERS_KEY, fresh.filter((r) => !done.has(r.id)));
  // отправленные держим 2 суток для «Отложить на час»
  const archive = ((await store.getJSON("reminders_sent")) || []).filter((r) => r.dueAt > now - 2 * 86400000);
  await store.setJSON("reminders_sent", [...sent, ...archive].slice(0, 200));
  return sent.map((r) => r.id);
}
