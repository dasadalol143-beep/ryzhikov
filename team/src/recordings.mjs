// Записи созвонов. Файлы хранит Telegram (до 2 ГБ, без публичных ссылок), у нас — только file_id.
// Каждую запись бот сразу копирует в архив: закрытый канал-хранилище (если подключён) или в личку собственника.
// Скачать — бот присылает файл в личку тому, кто нажал «Получить»; каждое скачивание пишется в карточку.
import { randomUUID } from "node:crypto";
import { escapeHtml as h } from "./telegram.mjs";
import { clientTitle, fmtWhen, isBossRole } from "../public/lib/model.js";

export const MAX_APP_UPLOAD = 20 * 1024 * 1024; // из приложения: Worker держит файл в памяти — больше гоним через бота
export const WAIT_MS = 3 * 3600_000; // «жду файл записи» после кнопки «Выгрузить созвон»
export const SOFT_WAIT_MS = 3600_000; // после «Пришёл» — подсказка, но с подтверждением
const SEND_LIMIT = 30; // скачиваний на человека в час
const nowIso = () => new Date().toISOString();
const ownersOf = (env) => String(env?.OWNER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

// Что в сообщении похоже на запись созвона. Голосовые, кружки и короткие аудио — это команды боту, их не трогаем.
// explicit — человек сам нажал «Выгрузить созвон»: тогда берём и длинное голосовое.
export function fileOf(msg, { explicit = false } = {}) {
  const long = (x, sec) => x && (x.duration || 0) > sec && x;
  const f = msg.document || msg.video || long(msg.audio, explicit ? 60 : 300) || long(msg.voice, explicit ? 60 : 1e9);
  if (!f) return null;
  const kind = f === msg.document ? "document" : f === msg.video ? "video" : f === msg.audio ? "audio" : "voice";
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
export async function archive(store, env, tg, { fromChat, msgId, file, c, rec, users }) {
  const st = await store.get("meta", "rec-storage");
  const owners = ownersOf(env);
  const copy = async (chat) => {
    const m = fromChat && msgId
      ? await tg.copyMessage(chat, fromChat, msgId, { caption: caption(c, rec, users), parse_mode: "HTML", disable_notification: true })
      : await tg.sendFileById(file.kind, chat, file.fileId, caption(c, rec, users), { disable_notification: true });
    return { chat: String(chat), msg: m?.message_id || null };
  };
  // Канал → иначе собственнику. Собственник сам прислал файл — его сообщение и есть копия.
  for (const chat of [st?.chatId, ...owners].filter(Boolean)) {
    if (!st?.chatId && String(chat) === String(fromChat) && msgId) return [{ chat: String(chat), msg: msgId }];
    try {
      return [await copy(chat)];
    } catch {
      // следующий вариант
    }
  }
  return [];
}

// Копию в архив сделать не удалось — запомним и повторим кроном, Пете — сигнал.
async function noteArchiveFail(store, c, rec) {
  const doc = (await store.get("meta", "rec-archive-retry")) || { id: "rec-archive-retry", items: [] };
  doc.items = [...doc.items.filter((x) => x.recId !== rec.id), { clientId: c.id, recId: rec.id, at: Date.now(), tries: 0 }].slice(-200);
  await store.put("meta", "rec-archive-retry", doc);
  const { addFeed } = await import("./notify.mjs");
  await addFeed(store, { type: "comment", text: `⚠️ Запись созвона ${clientTitle(c)} не скопировалась в архив — повторю сам. Проверь, что бот админ в канале-хранилище (/storage).`, by: "system", to: [] });
}

// Раз в минуту: повторить копии в архив (не больше 5 за раз).
export async function retryArchive({ store, env, tg }) {
  const doc = await store.get("meta", "rec-archive-retry");
  if (!doc?.items?.length) return 0;
  const users = Object.fromEntries((await store.all("user")).map((u) => [u.id, u]));
  const left = [];
  let done = 0;
  for (const it of doc.items) {
    if (done >= 5) {
      left.push(it);
      continue;
    }
    const c = (await store.get("client", it.clientId)) || (await store.get("trash", it.clientId));
    const rec = c?.recordings?.find((r) => r.id === it.recId);
    if (!rec || rec.archive?.length) continue;
    const out = await archive(store, env, tg, { file: rec, c, rec, users });
    done++;
    if (out.length) {
      rec.archive = out;
      await store.put(c.deletedAt ? "trash" : "client", c.id, c);
    } else if (it.tries < 50) left.push({ ...it, tries: it.tries + 1 });
  }
  await store.put("meta", "rec-archive-retry", { ...doc, items: left });
  return done;
}

// Прикрепить файл к клиенту. Повтор того же файла — не дублируем.
// Карточку перечитываем ПОСЛЕ сетевых вызовов: пока шла копия в архив, её могли поменять.
export async function attachRecording({ store, env, tg, c, file, by, users, fromChat = null, msgId = null, source = "bot" }) {
  const dup0 = (c.recordings || []).find((r) => r.uniq === file.uniq && !r.deletedAt);
  if (dup0) return { rec: dup0, duplicate: true, client: c };
  const call = callFor(c);
  const rec = { id: randomUUID().slice(0, 8), ...file, by, at: nowIso(), callId: call?.id || null, callAt: call?.at || null, source, downloads: [] };
  rec.archive = await archive(store, env, tg, { fromChat, msgId, file, c, rec, users });
  const fresh = await store.get("client", c.id);
  if (!fresh) throw Object.assign(new Error("Клиента только что удалили или склеили — восстанови его из корзины и пришли файл ещё раз"), { status: 409 });
  fresh.recordings ||= [];
  const dup = fresh.recordings.find((r) => r.uniq === file.uniq && !r.deletedAt);
  if (dup) return { rec: dup, duplicate: true, client: fresh };
  fresh.recordings.push(rec);
  fresh.history = [{ at: rec.at, by, text: `📼 Выгружена запись созвона${rec.callAt ? ` ${fmtWhen(Date.parse(rec.callAt))}` : ""} (${rec.name}${rec.size ? `, ${sizeText(rec.size)}` : ""})` }, ...(fresh.history || [])].slice(0, 80);
  fresh.updatedAt = nowIso();
  await store.put("client", fresh.id, fresh);
  if (!rec.archive.length) await noteArchiveFail(store, fresh, rec).catch(() => {});
  return { rec, duplicate: false, client: fresh };
}

// Прислать запись человеку в личку. Только себе и только участнику команды.
export async function sendRecording({ store, tg, c, recId, me, users, settings = {} }) {
  const rec = (c.recordings || []).find((r) => r.id === recId && !r.deletedAt);
  if (!rec) throw Object.assign(new Error("Запись не найдена"), { status: 404 });
  const hourAgo = Date.now() - 3600_000;
  const log = (await store.get("meta", `rec-sends:${me.id}`))?.at || [];
  const recent = log.filter((t) => t > hourAgo);
  if (recent.length >= SEND_LIMIT) throw Object.assign(new Error("Слишком много скачиваний за час — подожди немного"), { status: 429 });
  // Считаем до отправки: параллельные запросы не обойдут лимит.
  await store.put("meta", `rec-sends:${me.id}`, { id: `rec-sends:${me.id}`, at: [...recent, Date.now()] });
  const startHint = (e) => (/chat not found|bot was blocked|initiate|user is deactivated/i.test(e.message) ? "Сначала открой бота и нажми «Старт» — иначе он не может прислать файл" : `Telegram не отдал файл: ${e.message}`);
  const opts = settings.recProtect ? { protect_content: true } : {};
  try {
    await tg.sendFileById(rec.kind, me.id, rec.fileId, caption(c, rec, users), opts);
  } catch (e) {
    // Файл у этого file_id мог «протухнуть» — пробуем копию из архива.
    const a = (rec.archive || []).find((x) => x.msg);
    if (!a || /chat not found|bot was blocked|initiate|deactivated/i.test(e.message)) throw Object.assign(new Error(startHint(e)), { status: 400 });
    await tg.copyMessage(me.id, a.chat, a.msg, opts).catch((e2) => {
      throw Object.assign(new Error(startHint(e2)), { status: 400 });
    });
  }
  const fresh = (await store.get("client", c.id)) || c;
  const fr = (fresh.recordings || []).find((r) => r.id === recId) || rec;
  fr.downloads = [...(fr.downloads || []), { by: me.id, at: nowIso() }].slice(-50);
  fresh.history = [{ at: nowIso(), by: me.id, text: `⬇️ Скачал запись созвона (${rec.name})` }, ...(fresh.history || [])].slice(0, 80);
  await store.put("client", fresh.id, fresh);
  Object.assign(c, fresh);
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
  const fresh = (await store.get("client", c.id)) || c;
  const rec = (fresh.recordings || []).find((r) => r.id === recId && !r.deletedAt);
  if (!rec) throw Object.assign(new Error("Запись не найдена"), { status: 404 });
  Object.assign(rec, { deletedAt: nowIso(), deletedBy: me.id });
  fresh.history = [{ at: nowIso(), by: me.id, text: `🗑 Скрыта запись созвона (${rec.name}) — копия в архиве осталась` }, ...(fresh.history || [])].slice(0, 80);
  await store.put("client", fresh.id, fresh);
  Object.assign(c, fresh);
  return rec;
}

// Загрузка из приложения: файл → бот шлёт его загрузившему в личку (там же подтверждение) → file_id → архив.
export async function uploadFromApp({ store, env, tg, c, file, me, users }) {
  if (!file || typeof file.arrayBuffer !== "function") throw Object.assign(new Error("Нет файла"), { status: 400 });
  if (file.size > MAX_APP_UPLOAD) throw Object.assign(new Error(`Файл ${sizeText(file.size)} — из приложения до ${sizeText(MAX_APP_UPLOAD)}. Большие файлы — через бота.`), { status: 413, code: "too_big" });
  const name = String(file.name || "запись").replace(/[\\/\0]/g, "_").slice(0, 120);
  // Файл из formData отдаём как есть — без лишних копий в памяти Worker.
  const m = await tg.uploadDocument(me.id, file, `📼 Запись созвона — ${h(clientTitle(c))}\nСохранена в CRM ✅`, {}, name).catch((e) => {
    throw Object.assign(new Error(/chat not found|initiate|blocked/i.test(e.message) ? "Сначала открой бота и нажми «Старт» — файл проходит через него" : `Telegram не принял файл: ${e.message}`), { status: 400 });
  });
  const f = fileOf(m) || fileOf({ document: m?.document });
  if (!f) throw Object.assign(new Error("Telegram не вернул файл"), { status: 502 });
  f.name = name;
  return attachRecording({ store, env, tg, c, file: f, by: me.id, users, fromChat: me.id, msgId: m.message_id, source: "app" });
}

// ---------- ожидание файла в боте ----------
// explicit — нажал «Выгрузить созвон» (файл сразу к этому клиенту); иначе — подсказка после «Пришёл» (спросим «к нему?»).
export const waitFor = (store, userId, clientId, { explicit = true } = {}) => store.put("meta", `rec-wait:${userId}`, { id: `rec-wait:${userId}`, clientId, explicit, at: Date.now() });
export async function waiting(store, userId) {
  const w = await store.get("meta", `rec-wait:${userId}`);
  return w && Date.now() - w.at < (w.explicit === false ? SOFT_WAIT_MS : WAIT_MS) ? w : null;
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
