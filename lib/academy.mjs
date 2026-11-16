// CRM для учеников академии: свой бот, своя база (D1), у каждого ученика — отдельный кабинет.
// Внутри кабинета работает та же логика, что и в нашей CRM (createHandler), но на хранилище
// с префиксом u/<id>/ — ученики физически не видят ни нашу базу, ни друг друга.
//
// Лимит D1 на бесплатном тарифе — 50 запросов на один вызов воркера. Поэтому всё, что читает или
// пишет много записей, делается пачкой (entries / setMany / deleteMany), а наставник читает готовые
// сводки stats/<id>, которые обновляются при каждом изменении у ученика.
import { randomBytes } from "node:crypto";
import { createHandler, loadAll } from "./core.mjs";
import { checkInitData, parseIds } from "./auth.mjs";
import { telegram, escapeHtml as h } from "./telegram.mjs";
import { sendBackup } from "./report.mjs";
import { leadMoney, sumMoney, ACTIVE_STAGES } from "../public/economics.js";
import { paidEvents, todayKey, daysSince } from "../public/insights.js";

// ---------- хранилище ----------
export function d1Store(db) {
  let ready = null;
  // Если создание таблицы упало (сеть, холодный старт) — не запоминаем ошибку, пробуем снова.
  const init = () => (ready ||= db.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)").run().catch((e) => {
    ready = null;
    throw e;
  }));
  const range = (prefix) => [prefix, prefix + "￿"]; // диапазон вместо LIKE: в ключах бывают _ и %
  return {
    async getJSON(key) {
      await init();
      const row = await db.prepare("SELECT v FROM kv WHERE k = ?").bind(key).first();
      return row ? JSON.parse(row.v) : null;
    },
    async setJSON(key, value) {
      await init();
      await db.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(key, JSON.stringify(value)).run();
    },
    async delete(key) {
      await init();
      await db.prepare("DELETE FROM kv WHERE k = ?").bind(key).run();
    },
    async list(prefix) {
      await init();
      const { results } = await db.prepare("SELECT k FROM kv WHERE k >= ? AND k < ? ORDER BY k").bind(...range(prefix)).all();
      return results.map((r) => r.k);
    },
    // все записи с префиксом — одним запросом
    async entries(prefix) {
      await init();
      const { results } = await db.prepare("SELECT k, v FROM kv WHERE k >= ? AND k < ? ORDER BY k").bind(...range(prefix)).all();
      return results.map((r) => [r.k, JSON.parse(r.v)]);
    },
    // до 45 записей одним запросом (у D1 не больше 100 параметров на запрос)
    async setMany(pairs) {
      if (!pairs.length) return;
      await init();
      for (let i = 0; i < pairs.length; i += 45) {
        const part = pairs.slice(i, i + 45);
        await db
          .prepare(`INSERT INTO kv (k, v) VALUES ${part.map(() => "(?, ?)").join(", ")} ON CONFLICT(k) DO UPDATE SET v = excluded.v`)
          .bind(...part.flatMap(([k, v]) => [k, JSON.stringify(v)]))
          .run();
      }
    },
    async deleteMany(keys) {
      if (!keys.length) return;
      await init();
      for (let i = 0; i < keys.length; i += 90) {
        const part = keys.slice(i, i + 90);
        await db.prepare(`DELETE FROM kv WHERE k IN (${part.map(() => "?").join(", ")})`).bind(...part).run();
      }
    },
    // Атомарно занять место по групповой ссылке: +1 к uses, только если ещё есть места.
    async claim(key) {
      await init();
      const r = await db
        .prepare("UPDATE kv SET v = json_set(v, '$.uses', COALESCE(json_extract(v, '$.uses'), 0) + 1) WHERE k = ? AND COALESCE(json_extract(v, '$.uses'), 0) < COALESCE(json_extract(v, '$.max'), 1)")
        .bind(key)
        .run();
      return (r.meta?.changes || 0) > 0;
    },
  };
}

// Кабинет одного ученика: свои ключи под префиксом; чего нет — берётся из fallbacks.
export function prefixStore(base, prefix, fallbacks = {}) {
  const strip = (pairs) => pairs.map(([k, v]) => [k.slice(prefix.length), v]);
  return {
    getJSON: async (key) => {
      const own = await base.getJSON(prefix + key);
      return fallbacks[key] ? fallbacks[key](own) : own;
    },
    setJSON: (key, value) => base.setJSON(prefix + key, value),
    delete: (key) => base.delete(prefix + key),
    list: async (p) => (await base.list(prefix + p)).map((k) => k.slice(prefix.length)),
    ...(base.entries ? { entries: async (p) => strip(await base.entries(prefix + p)) } : {}),
    ...(base.setMany ? { setMany: (pairs) => base.setMany(pairs.map(([k, v]) => [prefix + k, v])) } : {}),
    ...(base.deleteMany ? { deleteMany: (keys) => base.deleteMany(keys.map((k) => prefix + k)) } : {}),
  };
}

// У ученика по умолчанию: НПД 6%, без партнёра. Шаблоны сообщений — общие.
const STUDENT_SETTINGS = { taxRate: 6, partnerShare: 0, partnerName: "Партнёр", monthlyGoal: 0 };

// Каталог ученика = его правки + наши офферы, которых у него ещё нет (новые банки появляются сами).
const mergeOffers = (own, main) => {
  if (!Array.isArray(own)) return Array.isArray(main) ? main : null;
  const ids = new Set(own.map((o) => o.id));
  return [...own, ...(Array.isArray(main) ? main.filter((o) => !ids.has(o.id)) : [])];
};

// Наш каталог читается на каждом действии каждого ученика — держим копию в памяти на минуту.
let offersCache = { at: 0, data: null, src: null };
export const resetOffersCache = () => (offersCache = { at: 0, data: null, src: null });
async function mainOffers(mainStore) {
  if (!mainStore) return null;
  if (offersCache.src === mainStore && Date.now() - offersCache.at < 60000) return offersCache.data;
  const data = await mainStore.getJSON("offers").catch(() => offersCache.data);
  offersCache = { at: Date.now(), data, src: mainStore };
  return data;
}

const workspace = (store, mainStore, uid) =>
  prefixStore(store, `u/${uid}/`, {
    offers: async (own) => mergeOffers(own, await mainOffers(mainStore)),
    settings: async (own) => own || STUDENT_SETTINGS,
  });

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const nameOf = (u) => clean([u.first_name, u.last_name].filter(Boolean).join(" "), 60) || (u.username ? `@${u.username}` : `ID ${u.id}`);
const newCode = () => [...randomBytes(6)].map((b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
const EXPORT_EVERY = [0, 1, 3, 7];
const DEFAULT_EXPORT_EVERY = 3;

// Вход по коду. Личный код — один человек, групповая ссылка — до max человек.
async function join(store, user, code, name) {
  const existing = await store.getJSON(`members/${user.id}`);
  if (existing) return existing.active ? { member: existing } : { error: "disabled" };
  const c = normCode(code);
  if (!c) return { error: "code_required" };
  const rec = await store.getJSON(`codes/${c}`);
  if (!rec || rec.revoked) return { error: "bad_code" };
  if (rec.group) {
    if (rec.expiresAt && rec.expiresAt < new Date().toISOString()) return { error: "code_expired" };
    const ok = store.claim ? await store.claim(`codes/${c}`) : (rec.uses || 0) < rec.max && (await store.setJSON(`codes/${c}`, { ...rec, uses: (rec.uses || 0) + 1 }), true);
    if (!ok) return { error: "code_full" };
  } else if (rec.usedBy && rec.usedBy !== user.id) {
    return { error: "code_used" };
  }
  const custom = clean(name, 60);
  const member = {
    id: user.id,
    name: custom || nameOf(user),
    customName: !!custom,
    username: user.username || "",
    note: rec.group ? "" : rec.note || "",
    code: c,
    group: !!rec.group,
    joinedAt: new Date().toISOString(),
    active: true,
    exportEvery: DEFAULT_EXPORT_EVERY,
  };
  await store.setJSON(`members/${user.id}`, member);
  if (!rec.group) await store.setJSON(`codes/${c}`, { ...rec, usedBy: user.id, usedAt: member.joinedAt });
  return { member, joined: true };
}

// Сводка ученика для наставника — только цифры, без самих лидов. Хранится готовой: stats/<id>.
async function refreshStats(store, mainStore, uid, now = Date.now()) {
  const { leads, offers, settings } = await loadAll(workspace(store, mainStore, uid));
  const month = todayKey(now).slice(0, 7);
  const t = sumMoney(leads.map((l) => leadMoney(l, offers, settings)));
  const stats = {
    leads: leads.length,
    activeLeads: leads.filter((l) => ACTIVE_STAGES.has(l.stage)).length,
    income: t.income,
    paidMonth: paidEvents(leads, offers).filter((e) => e.day?.startsWith(month)).reduce((s, e) => s + e.amount, 0),
    month,
    inWork: t.inWork,
    waiting: t.waiting,
    lastActivity: leads.reduce((a, l) => (l.updatedAt > a ? l.updatedAt : a), ""),
    seenAt: new Date(now).toISOString(),
    at: new Date(now).toISOString(),
  };
  await store.setJSON(`stats/${uid}`, stats);
  return stats;
}

async function botUsername(store, token, fetchImpl) {
  const saved = await store.getJSON("bot_me");
  if (saved?.username) return saved.username;
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json()).catch(() => null);
  if (res?.result?.username) await store.setJSON("bot_me", { username: res.result.username });
  return res?.result?.username || "";
}

const WEBHOOK_V = 2;
// Проверили один раз в этом процессе — дальше базу не трогаем (минус запрос на каждый клик).
let webhookOk = "";
async function ensureWebhook(store, env, fetchImpl, hookUrl) {
  if (webhookOk === hookUrl) return;
  const saved = await store.getJSON("bot_webhook");
  if (saved?.url === hookUrl && saved?.v === WEBHOOK_V) {
    webhookOk = hookUrl;
    return;
  }
  if (saved?.url === hookUrl && saved?.v === WEBHOOK_V) return;
  const tg = telegram(env.ACADEMY_BOT_TOKEN, fetchImpl);
  const r = await tg.setWebhook(hookUrl, await webhookSecretFor(env.ACADEMY_BOT_TOKEN));
  if (r && r.ok === false) throw new Error(r.description || "setWebhook failed");
  await tg
    .setMyCommands([
      { command: "start", description: "Открыть CRM" },
      { command: "excel", description: "Прислать Excel со всеми лидами" },
      { command: "help", description: "Что умеет бот" },
    ])
    .catch(() => {});
  await store.setJSON("bot_webhook", { url: hookUrl, v: WEBHOOK_V });
  webhookOk = hookUrl;
}

export async function webhookSecretFor(token) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("academy:" + token));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

const JOIN_ERRORS = {
  bad_code: "Код не подошёл. Проверь его или попроси новую ссылку у наставника.",
  code_used: "Этот код уже использован другим учеником. Попроси новый у наставника.",
  code_full: "По этой ссылке уже зашло максимальное число учеников. Попроси новую ссылку у наставника.",
  code_expired: "Срок действия ссылки закончился. Попроси новую у наставника.",
  disabled: "Доступ к CRM закрыт. Напиши наставнику.",
};

const WELCOME = (first) =>
  [
    `🎓 <b>RYZHIKOV ACADEMY · CRM</b>`,
    `<i>Приватный доступ — бонус для учеников академии</i>`,
    "",
    `👋 ${h(first || "")}, это твоя система для работы с лидами по РКО, МФО и картам.`,
    "",
    "<b>Что внутри:</b>",
    "• все твои лиды, офферы и статусы в одном месте",
    "• план на день: кому написать, где нужна ЦД, кто остывает",
    "• деньги: засчитано, в работе, ждём, чистыми после налога",
    "• статистика по месяцам и сверка с партнёрскими сетями",
    "• актуальные ставки академии — обновляются сами",
    "• Excel со всеми лидами — по команде /excel и автоматически раз в 3 дня",
    "",
    "🔒 Твоих лидов видишь только ты.",
    "",
    "При первом входе откроется пошаговая инструкция — пролистай её до конца, это 2 минуты. Жми кнопку 👇",
  ].join("\n");

// ---------- бот академии ----------
async function handleBot(req, { store, mainStore, env, fetchImpl, appUrl }) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== (await webhookSecretFor(env.ACADEMY_BOT_TOKEN))) return new Response("forbidden", { status: 403 });
  // Telegram повторяет запрос, если мы ответили ошибкой, — поэтому всегда 200.
  try {
    const update = await req.json();
    const msg = update.message;
    if (!msg?.from || msg.chat?.type !== "private") return new Response("ok");
    const tg = telegram(env.ACADEMY_BOT_TOKEN, fetchImpl);
    const open = { inline_keyboard: [[{ text: "📱 Открыть CRM", web_app: { url: appUrl } }]] };
    const text = (msg.text || "").trim();
    const isMentor = parseIds(env.ACADEMY_MENTOR_IDS).has(Number(msg.from.id));
    let member = await store.getJSON(`members/${msg.from.id}`);
    const code = text.match(/^\/start\s+(\S+)/)?.[1];
    let note = "";
    if (!member && code) {
      const r = await join(store, msg.from, code);
      member = r.member;
      if (r.error) note = JOIN_ERRORS[r.error] || JOIN_ERRORS.bad_code;
    }
    const allowed = isMentor || member?.active;
    if (!allowed) {
      const reply = member ? JOIN_ERRORS.disabled : `${note || "CRM — приватный бонус для учеников Ryzhikov Academy."}\n\nВойти можно по ссылке-приглашению от наставника или по коду: открой CRM кнопкой ниже и введи его.`;
      await tg.sendMessage(msg.chat.id, reply, open).catch(() => {});
      return new Response("ok");
    }
    if (/^\/excel\b/.test(text)) {
      const ws = workspace(store, mainStore, msg.from.id);
      const [{ leads, offers, settings }, expenses] = await Promise.all([loadAll(ws), ws.getJSON("expenses")]);
      if (!leads.length) await tg.sendMessage(msg.chat.id, "Лидов пока нет — заведи первого в CRM, и выгрузка появится.", open).catch(() => {});
      else await sendBackup(tg, msg.chat.id, leads, offers, settings, new Date(), { json: false, expenses: expenses || [] }).catch(() => tg.sendMessage(msg.chat.id, "Не получилось собрать файл, попробуй через минуту.").catch(() => {}));
      return new Response("ok");
    }
    if (/^\/start\b/.test(text)) {
      await tg.sendMessage(msg.chat.id, WELCOME(msg.from.first_name), open).catch(() => {});
      return new Response("ok");
    }
    await tg
      .sendMessage(
        msg.chat.id,
        "Вся работа — в CRM, жми кнопку ниже 👇\n\n/excel — прислать Excel со всеми лидами\n\nАвтовыгрузку можно настроить в CRM: «Ещё» → «Бэкап и выгрузка».",
        open,
      )
      .catch(() => {});
  } catch (e) {
    console.log("academy bot error", e.message);
  }
  return new Response("ok");
}

// ---------- автовыгрузка Excel ----------
// Каждую минуту с 08:00 до 10:59 МСК берём до 3 учеников, кому пора, и шлём файл.
// Шлём только если с прошлой выгрузки что-то менялось — без спама одинаковыми файлами.
export async function runAcademyExports({ store, mainStore, env, now = Date.now(), fetchImpl = globalThis.fetch, batch = 3 }) {
  if (!env.ACADEMY_BOT_TOKEN || !store.entries) return [];
  const mskHour = (new Date(now).getUTCHours() + 3) % 24;
  if (mskHour < 8 || mskHour > 10) return [];
  const today = todayKey(now);
  // Всем, кому надо, уже отправили — следующие 30 минут не перечитываем список учеников.
  const idle = await store.getJSON("exports_idle");
  if (idle?.day === today && now - idle.at < 1800000) return [];
  const [members, stats] = await Promise.all([store.entries("members/"), store.entries("stats/")]);
  const statById = new Map(stats.map(([k, v]) => [k.slice(6), v]));
  const due = members
    .map(([, m]) => m)
    .filter((m) => {
      if (!m?.active) return false;
      const every = m.exportEvery ?? DEFAULT_EXPORT_EVERY;
      if (!every) return false;
      if (m.lastExportDay && daysSince(`${m.lastExportDay}T00:00:00Z`, Date.parse(`${today}T00:00:00Z`)) < every) return false;
      const st = statById.get(String(m.id));
      return st?.leads > 0 && (!m.lastExportAt || (st.lastActivity || "") > m.lastExportAt);
    })
    .slice(0, batch);
  if (!due.length) {
    await store.setJSON("exports_idle", { day: today, at: now });
    return [];
  }
  const tg = telegram(env.ACADEMY_BOT_TOKEN, fetchImpl);
  const out = [];
  for (const m of due) {
    // отмечаем заранее: если Telegram недоступен или ученик заблокировал бота — не долбим каждую минуту
    const mark = { ...m, lastExportDay: today, lastExportAt: new Date(now).toISOString() };
    try {
      const ws = workspace(store, mainStore, m.id);
      const [{ leads, offers, settings }, expenses] = await Promise.all([loadAll(ws), ws.getJSON("expenses")]);
      await sendBackup(tg, m.id, leads, offers, settings, new Date(now), {
        json: false,
        expenses: expenses || [],
        caption: `📊 Автовыгрузка CRM: ${leads.length} лидов на ${today.split("-").reverse().join(".")}.\nВсё сохранено и у тебя под рукой. Частоту можно поменять: «Ещё» → «Бэкап и выгрузка».`,
      });
      out.push({ id: m.id, ok: true });
    } catch (e) {
      mark.lastExportError = String(e.message).slice(0, 120);
      out.push({ id: m.id, ok: false, error: e.message });
    }
    await store.setJSON(`members/${m.id}`, mark);
  }
  return out;
}

// ---------- API ----------
export function createAcademyHandler({ store, mainStore, env, fetch: fetchImpl = globalThis.fetch }) {
  return async function handle(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/academy\/api/, "").replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();
    const appUrl = `${url.origin}/academy/`;
    if (!env.ACADEMY_BOT_TOKEN) return json({ error: "no_bot_token", detail: "Не задан ACADEMY_BOT_TOKEN" }, 500);

    if (path === "/tg" && method === "POST") return handleBot(req, { store, mainStore, env, fetchImpl, appUrl });
    // Бот подключается сам при первом же обращении к CRM учеников.
    await ensureWebhook(store, env, fetchImpl, `${url.origin}/academy/api/tg`).catch((e) => console.log("academy webhook", e.message));

    const header = req.headers.get("authorization") || "";
    const { user, reason } = checkInitData(header.startsWith("tma ") ? header.slice(4) : "", env.ACADEMY_BOT_TOKEN);
    if (!user) return json({ error: "unauthorized", reason }, 401);
    const uid = String(user.id);
    const isMentor = parseIds(env.ACADEMY_MENTOR_IDS).has(Number(uid));
    let member = await store.getJSON(`members/${uid}`);

    if (method === "POST" && path === "/join") {
      if (isMentor) return json({ ok: true });
      const body = await req.json().catch(() => ({}));
      const r = await join(store, user, body.code, body.name);
      return r.error ? json({ error: r.error }, r.error === "disabled" ? 403 : 400) : json({ ok: true });
    }
    if (isMentor && !member) {
      member = { id: user.id, name: nameOf(user), username: user.username || "", note: "Наставник", joinedAt: new Date().toISOString(), active: true, mentor: true, exportEvery: DEFAULT_EXPORT_EVERY };
      await store.setJSON(`members/${uid}`, member);
    }
    if (!member) return json({ error: "not_member", userId: user.id }, 403);
    if (!member.active && !isMentor) return json({ error: "disabled" }, 403);

    // Имя и ник из Telegram держим свежими (если ученик не задал своё имя сам).
    const tgName = nameOf(user);
    if ((!member.customName && member.name !== tgName) || (member.username || "") !== (user.username || "")) {
      member = { ...member, name: member.customName ? member.name : tgName, username: user.username || "" };
      await store.setJSON(`members/${uid}`, member);
    }

    // ---- профиль ученика: имя и частота автовыгрузки ----
    if (path === "/me" && method === "PATCH") {
      const body = await req.json().catch(() => ({}));
      if ("name" in body) {
        const n = clean(body.name, 60);
        member = { ...member, name: n || tgName, customName: !!n };
      }
      if ("exportEvery" in body && EXPORT_EVERY.includes(Number(body.exportEvery))) member = { ...member, exportEvery: Number(body.exportEvery) };
      await store.setJSON(`members/${uid}`, member);
      return json(publicMember(member));
    }

    // ---- кабинет наставника ----
    if (path.startsWith("/mentor")) {
      if (!isMentor) return json({ error: "forbidden" }, 403);
      const body = ["POST", "PATCH"].includes(method) ? await req.json().catch(() => ({})) : {};
      if (method === "GET" && path === "/mentor") {
        const [members, stats, codes] = await Promise.all([store.entries ? store.entries("members/") : [], store.entries ? store.entries("stats/") : [], store.entries ? store.entries("codes/") : []]);
        const statById = new Map(stats.map(([k, v]) => [k.slice(6), v]));
        const month = todayKey().slice(0, 7);
        const students = members
          .map(([, m]) => m)
          .filter((m) => m && !m.mentor)
          .map((m) => {
            const st = statById.get(String(m.id)) || {};
            return { ...publicMember(m), leads: st.leads || 0, activeLeads: st.activeLeads || 0, income: st.income || 0, paidMonth: st.month === month ? st.paidMonth || 0 : 0, inWork: st.inWork || 0, waiting: st.waiting || 0, lastActivity: st.lastActivity || "", seenAt: st.seenAt || "" };
          })
          .sort((a, b) => Number(b.active) - Number(a.active) || b.paidMonth - a.paidMonth || b.income - a.income);
        const open = codes
          .map(([, c]) => c)
          .filter((c) => c && !c.revoked && (c.group ? (c.uses || 0) < c.max : !c.usedBy))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return json({ students, codes: open, bot: await botUsername(store, env.ACADEMY_BOT_TOKEN, fetchImpl) });
      }
      if (method === "POST" && path === "/mentor/codes") {
        const group = body.group === true;
        const code = {
          code: newCode(),
          note: clean(body.note, 60),
          createdAt: new Date().toISOString(),
          ...(group ? { group: true, max: Math.max(1, Math.min(500, Math.round(Number(body.max) || 50))), uses: 0 } : {}),
        };
        await store.setJSON(`codes/${code.code}`, code);
        return json(code, 201);
      }
      const codeM = path.match(/^\/mentor\/codes\/([A-Z0-9]+)$/);
      if (method === "DELETE" && codeM) {
        const c = await store.getJSON(`codes/${codeM[1]}`);
        // групповую ссылку не удаляем, а отзываем: по ней уже вошли люди
        if (c?.group) await store.setJSON(`codes/${codeM[1]}`, { ...c, revoked: true });
        else await store.delete(`codes/${codeM[1]}`);
        return json({ ok: true });
      }
      const stM = path.match(/^\/mentor\/students\/(\d+)$/);
      if (method === "PATCH" && stM) {
        const m = await store.getJSON(`members/${stM[1]}`);
        if (!m || m.mentor) return json({ error: "not_found" }, 404);
        if ("active" in body) m.active = body.active === true;
        if ("note" in body) m.note = clean(body.note, 60);
        await store.setJSON(`members/${stM[1]}`, m);
        return json(publicMember(m));
      }
      return json({ error: "not_found" }, 404);
    }

    // Наш бот и команда ученикам не нужны.
    if (["/tg", "/bot/setup", "/access"].includes(path)) return json({ error: "forbidden" }, 403);

    const inner = new Request(`${url.origin}/api${path === "/" ? "" : path}${url.search}`, req);
    const res = await createHandler({
      store: workspace(store, mainStore, uid),
      env: { ...env, BOT_TOKEN: env.ACADEMY_BOT_TOKEN, ADMIN_IDS: uid, MANAGER_IDS: "", ACADEMY: "1", ACADEMY_MENTOR: isMentor ? "1" : "" },
      fetch: fetchImpl,
    })(inner);

    // Сводка для наставника пересчитывается не чаще раза в 5 минут — пересчёт читает всех лидов ученика,
    // а это главный расход строк в базе. Первое изменение у новичка видно сразу.
    if (res.ok && !isMentor && (method !== "GET" || path === "/state")) {
      const prev = await store.getJSON(`stats/${uid}`);
      const age = Date.now() - Date.parse(prev?.at || 0);
      if (!prev || age > 300000 || (method !== "GET" && !prev.leads)) await refreshStats(store, mainStore, uid).catch((e) => console.log("academy stats", e.message));
    }
    if (method === "GET" && path === "/state" && res.ok) {
      const data = await res.json();
      return json({ ...data, member: publicMember(member) });
    }
    return res;
  };
}

const publicMember = (m) => ({ id: m.id, name: m.name, customName: !!m.customName, username: m.username || "", note: m.note || "", active: m.active !== false, joinedAt: m.joinedAt, group: !!m.group, exportEvery: m.exportEvery ?? DEFAULT_EXPORT_EVERY, lastExportDay: m.lastExportDay || "" });
