// Записи созвонов. Файлы хранит Telegram (до 2 ГБ, без публичных ссылок), у нас — только file_id.
// Каждую запись бот сразу копирует в архив: закрытый канал-хранилище (если подключён) или в личку собственника.
// Скачать — бот присылает файл в личку тому, кто нажал «Получить»; каждое скачивание пишется в карточку.
import { randomUUID } from "node:crypto";
import { escapeHtml as h } from "./telegram.mjs";
import { clientTitle, fmtWhen, isBossRole } from "../public/lib/model.js";

export const MAX_APP_UPLOAD = 45 * 1024 * 1024; // из приложения через Bot API — до 50 МБ, берём с запасом
export const WAIT_MS = 3 * 3600_000; // «жду файл записи» после кнопки или отчёта
const SEND_LIMIT = 30; // скачиваний на человека в час
const nowIso = () => new Date().toISOString();
const ownersOf = (env) => String(env?.OWNER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

// Что в сообщении похоже на запись созвона. Короткие голосовые — это команды боту, их не трогаем.
export function fileOf(msg, { anyVoice = false } = {}) {
  const f = msg.document || msg.video || msg.audio || msg.video_note || ((msg.voice?.duration || 0) > (anyVoice ? 60 : 300) && msg.voice);
  if (!f) return null;
  const kind = msg.document ? "document" : msg.video ? "video" : msg.audio ? "audio" : msg.video_note ? "video_note" : "voice";
  return {
    kind,
    fileId: f.file_id,
    uniq: f.file_unique_id || f.file_id,
    name: String(f.file_name || { video: "видео", audio: "аудио", voice: "голосовое", video_note: "кружок", document: "файл" }[kind]).slice(0, 120),
    size: Number(f.file_size) || 0,
    mime: String(f.mime_type || "").slice(0, 80),
    duration: Number(f.duration) || 0,
  };
}

export const sizeText = (n) => (!n ? "" : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} ГБ` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
const durText = (s) => (!s ? "" : s >= 3600 ? `${Math.floor(s / 3600)} ч ${Math.round((s % 3600) / 60)} мин` : `${Math.max(1, Math.round(s / 60))} мин`);

// Кто может прикрепить запись: диагност клиента, руководство; к свободному клиенту — диагносты.
export function canUpload(u, c) {
  if (!u) return false;
  if (isBossRole(u.role)) return true;
  if (c.mopId) return c.mopId === u.id;
  return ["mop", "rop"].includes(u.role);
}

// Созвон, к которому относится запись: последний проведённый, иначе последний начавшийся.
function callFor(c, at = Date.now()) {
  const calls = (c.calls || []).filter((x) => x.outcome !== "moved" && Date.parse(x.at) <= at + 30 * 60_000);
  return [...calls].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).find((x) => x.outcome === "held") || calls.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] || null;
}

const caption = (c, rec, users) =>
  `📼 <b>Запись созвона</b>\n👤 ${h(clientTitle(c))}${c.telegram && c.name ? ` · ${h(c.telegram)}` : ""}${rec.callAt ? `\n📅 ${fmtWhen(Date.parse(rec.callAt))}` : ""}\n🎧 ${h(users?.[rec.by]?.name || "")}${rec.size ? ` · ${sizeText(rec.size)}` : ""}${rec.duration ? ` · ${durText(rec.duration)}` : ""}`;

// Копия в архив: канал-хранилище, если подключён, иначе — тихо в личку собственнику.
async function archive(store, env, tg, { fromChat, msgId, file, c, rec, users }) {
  const st = await store.get("meta", "rec-storage");
  const targets = st?.chatId ? [st.chatId] : ownersOf(env).filter((id) => id !== String(fromChat));
  const out = [];
  for (const chat of targets) {
    try {
      const m = fromChat && msgId
        ? await tg.copyMessage(chat, fromChat, msgId, { caption: caption(c, rec, users), parse_mode: "HTML", disable_notification: true })
        : await tg.sendFileById(file.kind, chat, file.fileId, caption(c, rec, users), { disable_notification: true });
      out.push({ chat: String(chat), msg: m?.message_id || null });
    } catch {
      // архив не главное: сама запись уже в карточке
    }
  }
  return out;
}

// Прикрепить файл к клиенту. Повтор того же файла — не дублируем.
export async function attachRecording({ store, env, tg, c, file, by, users, fromChat = null, msgId = null, source = "bot" }) {
  c.recordings ||= [];
  const dup = c.recordings.find((r) => r.uniq === file.uniq && !r.deletedAt);
  if (dup) return { rec: dup, duplicate: true };
  const call = callFor(c);
  const rec = { id: randomUUID().slice(0, 8), ...file, by, at: nowIso(), callId: call?.id || null, callAt: call?.at || null, source, downloads: [] };
  rec.archive = await archive(store, env, tg, { fromChat, msgId, file, c, rec, users });
  c.recordings.push(rec);
  c.history = [{ at: rec.at, by, text: `📼 Выгружена запись созвона${rec.callAt ? ` ${fmtWhen(Date.parse(rec.callAt))}` : ""} (${rec.name}${rec.size ? `, ${sizeText(rec.size)}` : ""})` }, ...(c.history || [])].slice(0, 80);
  c.updatedAt = nowIso();
  await store.put("client", c.id, c);
  return { rec, duplicate: false };
}

// Прислать запись человеку в личку. Только себе и только участнику команды.
export async function sendRecording({ store, tg, c, recId, me, users, settings = {} }) {
  const rec = (c.recordings || []).find((r) => r.id === recId && !r.deletedAt);
  if (!rec) throw Object.assign(new Error("Запись не найдена"), { status: 404 });
  const hourAgo = Date.now() - 3600_000;
  const log = (await store.get("meta", `rec-sends:${me.id}`))?.at || [];
  const recent = log.filter((t) => t > hourAgo);
  if (recent.length >= SEND_LIMIT) throw Object.assign(new Error("Слишком много скачиваний за час — подожди немного"), { status: 429 });
  try {
    await tg.sendFileById(rec.kind, me.id, rec.fileId, caption(c, rec, users), settings.recProtect ? { protect_content: true } : {});
  } catch (e) {
    // Файл у Telegram мог «протухнуть» у этого file_id — пробуем копию из архива.
    const a = (rec.archive || []).find((x) => x.msg);
    if (!a) throw Object.assign(new Error(/chat not found|bot was blocked|initiate/i.test(e.message) ? "Сначала открой бота и нажми «Старт» — иначе он не может прислать файл" : `Telegram не отдал файл: ${e.message}`), { status: 400 });
    await tg.copyMessage(me.id, a.chat, a.msg, settings.recProtect ? { protect_content: true } : {});
  }
  await store.put("meta", `rec-sends:${me.id}`, { id: `rec-sends:${me.id}`, at: [...recent, Date.now()] });
  rec.downloads = [...(rec.downloads || []), { by: me.id, at: nowIso() }].slice(-50);
  c.history = [{ at: nowIso(), by: me.id, text: `⬇️ Скачал запись созвона (${rec.name})` }, ...(c.history || [])].slice(0, 80);
  await store.put("client", c.id, c);
  // Много скачиваний подряд — сигнал собственнику.
  if (recent.length + 1 === 10) {
    const { addFeed } = await import("./notify.mjs");
    await addFeed(store, { type: "comment", text: `⚠️ ${me.name} скачал 10 записей созвонов за час`, by: me.id, to: [] });
  }
  return rec;
}

// Удалить может только собственник: запись скрывается, файл в архиве остаётся.
export async function deleteRecording({ store, c, recId, me }) {
  if (me.role !== "owner") throw Object.assign(new Error("Удалять записи может только Петя"), { status: 403 });
  const rec = (c.recordings || []).find((r) => r.id === recId && !r.deletedAt);
  if (!rec) throw Object.assign(new Error("Запись не найдена"), { status: 404 });
  Object.assign(rec, { deletedAt: nowIso(), deletedBy: me.id });
  c.history = [{ at: nowIso(), by: me.id, text: `🗑 Скрыта запись созвона (${rec.name}) — копия в архиве осталась` }, ...(c.history || [])].slice(0, 80);
  await store.put("client", c.id, c);
  return rec;
}

// Загрузка из приложения: файл → бот шлёт его загрузившему в личку (там же подтверждение) → file_id → архив.
export async function uploadFromApp({ store, env, tg, c, file, me, users }) {
  if (!file || typeof file.arrayBuffer !== "function") throw Object.assign(new Error("Нет файла"), { status: 400 });
  if (file.size > MAX_APP_UPLOAD) throw Object.assign(new Error(`Файл ${sizeText(file.size)} — из приложения до ${sizeText(MAX_APP_UPLOAD)}. Большие файлы — через бота.`), { status: 413, code: "too_big" });
  const name = String(file.name || "запись").replace(/[\\/\0]/g, "_").slice(0, 120);
  const m = await tg.uploadDocument(me.id, new File([await file.arrayBuffer()], name, { type: file.type || "application/octet-stream" }), `📼 Запись созвона — ${h(clientTitle(c))}\nСохранена в CRM ✅`).catch((e) => {
    throw Object.assign(new Error(/chat not found|initiate|blocked/i.test(e.message) ? "Сначала открой бота и нажми «Старт» — файл проходит через него" : `Telegram не принял файл: ${e.message}`), { status: 400 });
  });
  const f = fileOf(m) || fileOf({ document: m?.document });
  if (!f) throw Object.assign(new Error("Telegram не вернул файл"), { status: 502 });
  f.name = name;
  return attachRecording({ store, env, tg, c, file: f, by: me.id, users, fromChat: me.id, msgId: m.message_id, source: "app" });
}

// ---------- ожидание файла в боте ----------
export const waitFor = (store, userId, clientId) => store.put("meta", `rec-wait:${userId}`, { id: `rec-wait:${userId}`, clientId, at: Date.now() });
export async function waiting(store, userId) {
  const w = await store.get("meta", `rec-wait:${userId}`);
  return w && Date.now() - w.at < WAIT_MS ? w : null;
}
export const stopWaiting = (store, userId) => store.del("meta", `rec-wait:${userId}`);

// Клиенты, к которым человек скорее всего выгружает запись: его созвоны за последние 2 дня.
export function likelyClients(clients, me, now = Date.now()) {
  const mine = (x) => x.mopId === me.id || isBossRole(me.role);
  return clients
    .map((c) => ({ c, call: (c.calls || []).filter((x) => mine(x) && x.outcome !== "moved" && Date.parse(x.at) <= now + 3600_000 && Date.parse(x.at) > now - 2 * 86400_000).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] }))
    .filter((x) => x.call && canUpload(me, x.c))
    .sort((a, b) => Date.parse(b.call.at) - Date.parse(a.call.at))
    .slice(0, 6);
}
