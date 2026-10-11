// Разбор сообщения боту в данные лида: пересланное сообщение, контакт или текст «@ник ФИО телефон».
const NICK_RE = /(?:^|[\s(])(?:@|(?:https?:\/\/)?t\.me\/)([A-Za-z][A-Za-z0-9_]{3,31})\b/;
const PHONE_RE = /(?:\+7|8|7)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}|\+\d[\d\s()-]{9,16}\d/;
const NAME_RE = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё.'-]*(?:\s+[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё.'-]*){0,3}$/;

const fullName = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(" ");

export function parseLeadMessage(msg) {
  const text = (msg.text || msg.caption || "").trim();
  const origin = msg.forward_origin;

  // Пересланное сообщение: берём автора оригинала.
  if (origin?.type === "user" || msg.forward_from) {
    const u = origin?.sender_user || msg.forward_from;
    return { kind: "forward", telegram: u.username ? `@${u.username}` : "", fio: fullName(u), tgId: u.id, note: text ? `Переслано: «${text.slice(0, 300)}»` : "" };
  }
  if (origin?.type === "hidden_user" || msg.forward_sender_name) {
    return { kind: "hidden", telegram: "", fio: origin?.sender_user_name || msg.forward_sender_name, note: `Ник скрыт настройками приватности — допиши вручную.${text ? ` Переслано: «${text.slice(0, 300)}»` : ""}` };
  }
  // Контакт из Telegram.
  if (msg.contact) {
    const c = msg.contact;
    return { kind: "contact", telegram: "", fio: fullName(c), phone: c.phone_number?.startsWith("+") || !c.phone_number ? c.phone_number || "" : `+${c.phone_number}`, tgId: c.user_id };
  }
  // Текст: «@ник Иванов Иван +7 900…» в любом порядке.
  if (!text || text.startsWith("/")) return null;
  const nick = text.match(NICK_RE)?.[1];
  const phone = text.match(PHONE_RE)?.[0];
  let rest = text;
  if (nick) rest = rest.replace(NICK_RE, " ");
  if (phone) rest = rest.replace(phone, " ");
  rest = rest.replace(/\s+/g, " ").replace(/^[,;.\s-]+|[,;.\s-]+$/g, "").trim();
  if (!nick && !phone) return rest && NAME_RE.test(rest) && rest.length <= 60 ? { kind: "text", telegram: "", fio: rest } : null;
  const fio = rest && NAME_RE.test(rest) && rest.length <= 60 ? rest : "";
  return { kind: "text", telegram: nick ? `@${nick}` : "", fio, phone: phone ? phone.replace(/[^\d+]/g, "").replace(/^8(?=\d{10}$)/, "+7").replace(/^7(?=\d{10}$)/, "+7") : "", note: rest && !fio ? rest.slice(0, 300) : "" };
}

export const BOT_HELP = [
  "🤖 <b>Как завести лида через бота</b>",
  "",
  "• <b>Перешли</b> сюда любое сообщение человека — создам лида с его ником и именем",
  "• <b>Отправь контакт</b> (скрепка → Контакт) — заведу с телефоном",
  "• Или просто напиши: <code>@nick Иванов Иван +79001234567</code> — в любом порядке, лишнее можно не писать",
  "",
  "Дубли не создаю: если лид уже есть, пришлю кнопку на него.",
  "",
  "⏰ <b>Напоминания</b> — пиши как человеку:",
  "• <code>напомни завтра в 12 сделать ЦД с @nick</code>",
  "• <code>напомни через 2 часа позвонить @nick</code>",
  "• <code>напомни в пятницу в 10 проверить отчёт ОТП</code>",
  "Время — московское. Список и отмена: «мои напоминания».",
].join("\n");
