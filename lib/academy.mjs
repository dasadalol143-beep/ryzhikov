// CRM для учеников академии: свой бот, своя база (D1), у каждого ученика — отдельный кабинет.
// Внутри кабинета работает та же логика, что и в нашей CRM (createHandler), но на хранилище
// с префиксом u/<id>/ — ученики физически не видят ни нашу базу, ни друг друга.
import { randomBytes } from "node:crypto";
import { createHandler, loadAll } from "./core.mjs";
import { checkInitData, parseIds } from "./auth.mjs";
import { telegram, escapeHtml as h } from "./telegram.mjs";
import { leadMoney, sumMoney, ACTIVE_STAGES } from "../public/economics.js";
import { paidEvents, todayKey } from "../public/insights.js";

// Хранилище «ключ → JSON» поверх D1 с тем же интерфейсом, что и KV.
export function d1Store(db) {
  let ready;
  const init = () => (ready ||= db.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)").run());
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
      // диапазон вместо LIKE: в ключах бывают _ и %
      const { results } = await db.prepare("SELECT k FROM kv WHERE k >= ? AND k < ? ORDER BY k").bind(prefix, prefix + "￿").all();
      return results.map((r) => r.k);
    },
  };
}

// Кабинет одного ученика: свои ключи под префиксом; чего нет — берётся из fallbacks.
export function prefixStore(base, prefix, fallbacks = {}) {
  return {
    getJSON: async (key) => (await base.getJSON(prefix + key)) ?? (fallbacks[key] ? await fallbacks[key]() : null),
    setJSON: (key, value) => base.setJSON(prefix + key, value),
    delete: (key) => base.delete(prefix + key),
    list: async (p) => (await base.list(prefix + p)).map((k) => k.slice(prefix.length)),
  };
}

// У ученика по умолчанию: НПД 6%, без партнёра. Шаблоны сообщений — общие.
const STUDENT_SETTINGS = { taxRate: 6, partnerShare: 0, partnerName: "Партнёр", monthlyGoal: 0 };

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const nameOf = (u) => [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || String(u.id);
const newCode = () => [...randomBytes(6)].map((b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

const workspace = (store, mainStore, uid) =>
  prefixStore(store, `u/${uid}/`, {
    // ставки и офферы — наши живые, пока ученик не поправил свой каталог
    offers: () => mainStore?.getJSON("offers"),
    settings: async () => STUDENT_SETTINGS,
  });

async function join(store, user, code) {
  const c = normCode(code);
  if (!c) return { error: "code_required" };
  const rec = await store.getJSON(`codes/${c}`);
  if (!rec) return { error: "bad_code" };
  if (rec.usedBy && rec.usedBy !== user.id) return { error: "code_used" };
  const member = { id: user.id, name: nameOf(user), username: user.username || "", note: rec.note || "", code: c, joinedAt: new Date().toISOString(), active: true };
  await store.setJSON(`members/${user.id}`, member);
  await store.setJSON(`codes/${c}`, { ...rec, usedBy: user.id, usedAt: member.joinedAt });
  return { member };
}

// Сводка по ученику для наставника — только цифры, без самих лидов.
async function studentStats(store, mainStore, m, now = Date.now()) {
  const { leads, offers, settings } = await loadAll(workspace(store, mainStore, m.id));
  const month = todayKey(now).slice(0, 7);
  const t = sumMoney(leads.map((l) => leadMoney(l, offers, settings)));
  const paidMonth = paidEvents(leads, offers).filter((e) => e.day?.startsWith(month)).reduce((s, e) => s + e.amount, 0);
  const last = leads.reduce((a, l) => (l.updatedAt > a ? l.updatedAt : a), "");
  return { ...m, leads: leads.length, activeLeads: leads.filter((l) => ACTIVE_STAGES.has(l.stage)).length, income: t.income, paidMonth, inWork: t.inWork, waiting: t.waiting, lastActivity: last };
}

async function botUsername(store, token, fetchImpl) {
  const saved = await store.getJSON("bot_me");
  if (saved?.username) return saved.username;
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json()).catch(() => null);
  if (res?.result?.username) await store.setJSON("bot_me", { username: res.result.username });
  return res?.result?.username || "";
}

async function ensureWebhook(store, env, fetchImpl, hookUrl) {
  const saved = await store.getJSON("bot_webhook");
  if (saved?.url === hookUrl) return;
  const tg = telegram(env.ACADEMY_BOT_TOKEN, fetchImpl);
  await tg.setWebhook(hookUrl, await webhookSecretFor(env.ACADEMY_BOT_TOKEN));
  await tg.setMyCommands([{ command: "start", description: "Открыть CRM" }]).catch(() => {});
  await store.setJSON("bot_webhook", { url: hookUrl });
}

export async function webhookSecretFor(token) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("academy:" + token));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

// Бот академии: /start КОД — активирует доступ, дальше кнопка «Открыть CRM».
async function handleBot(req, { store, env, fetchImpl, appUrl }) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== (await webhookSecretFor(env.ACADEMY_BOT_TOKEN))) return new Response("forbidden", { status: 403 });
  try {
    const update = await req.json();
    const msg = update.message;
    if (!msg?.from || msg.chat?.type !== "private") return new Response("ok");
    const tg = telegram(env.ACADEMY_BOT_TOKEN, fetchImpl);
    const open = { inline_keyboard: [[{ text: "📱 Открыть CRM", web_app: { url: appUrl } }]] };
    const code = (msg.text || "").match(/^\/start\s+(\S+)/)?.[1];
    const isMentor = parseIds(env.ACADEMY_MENTOR_IDS).has(Number(msg.from.id));
    let member = await store.getJSON(`members/${msg.from.id}`);
    let note = "";
    if (!member && code) {
      const r = await join(store, msg.from, code);
      member = r.member;
      if (r.error) note = r.error === "code_used" ? "Этот код уже использован другим учеником. Попроси новый у наставника." : "Код не подошёл. Проверь его или попроси новый у наставника.";
    }
    const text = member?.active || isMentor
      ? [
          `🎓 <b>RYZHIKOV ACADEMY · CRM</b>`,
          `<i>Приватный доступ — бонус для учеников академии</i>`,
          "",
          `👋 ${h(msg.from.first_name || "")}, это твоя система для работы с лидами по РКО, МФО и картам.`,
          "",
          "<b>Что внутри:</b>",
          "• все твои лиды, офферы и статусы в одном месте",
          "• план на день: кому написать, где нужна ЦД, кто остывает",
          "• деньги: засчитано, в работе, ждём, чистыми после налога",
          "• статистика по месяцам и сверка с партнёрскими сетями",
          "• актуальные ставки академии — обновляются сами",
          "",
          "🔒 Твоих лидов видишь только ты.",
          "",
          "При первом входе откроется пошаговая инструкция — пролистай её до конца, это 2 минуты. Жми кнопку 👇",
        ].join("\n")
      : member
        ? "Доступ к CRM закрыт. Напиши наставнику."
        : `${note || "CRM доступна ученикам академии."}\n\nЕсли у тебя есть код доступа — открой CRM и введи его, или пришли сюда: <code>/start КОД</code>`;
    await tg.sendMessage(msg.chat.id, text, open).catch(() => {});
  } catch (e) {
    console.log("academy bot error", e.message);
  }
  return new Response("ok");
}

export function createAcademyHandler({ store, mainStore, env, fetch: fetchImpl = globalThis.fetch }) {
  return async function handle(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/academy\/api/, "").replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();
    const appUrl = `${url.origin}/academy/`;
    if (!env.ACADEMY_BOT_TOKEN) return json({ error: "no_bot_token", detail: "Не задан ACADEMY_BOT_TOKEN" }, 500);

    if (path === "/tg" && method === "POST") return handleBot(req, { store, env, fetchImpl, appUrl });
    // Бот подключается сам при первом же обращении к CRM учеников.
    await ensureWebhook(store, env, fetchImpl, `${url.origin}/academy/api/tg`).catch((e) => console.log("academy webhook", e.message));

    const header = req.headers.get("authorization") || "";
    const { user, reason } = checkInitData(header.startsWith("tma ") ? header.slice(4) : "", env.ACADEMY_BOT_TOKEN);
    if (!user) return json({ error: "unauthorized", reason }, 401);
    const uid = String(user.id);
    const isMentor = parseIds(env.ACADEMY_MENTOR_IDS).has(Number(uid));
    let member = await store.getJSON(`members/${uid}`);

    if (method === "POST" && path === "/join") {
      if (member?.active || isMentor) return json({ ok: true });
      if (member && !member.active) return json({ error: "disabled" }, 403);
      const r = await join(store, user, (await req.json().catch(() => ({}))).code);
      return r.error ? json({ error: r.error }, 400) : json({ ok: true });
    }
    if (isMentor && !member) {
      member = { id: user.id, name: nameOf(user), username: user.username || "", note: "Наставник", joinedAt: new Date().toISOString(), active: true, mentor: true };
      await store.setJSON(`members/${uid}`, member);
    }
    if (!member) return json({ error: "not_member", userId: user.id }, 403);
    if (!member.active && !isMentor) return json({ error: "disabled" }, 403);

    // ---- кабинет наставника ----
    if (path.startsWith("/mentor")) {
      if (!isMentor) return json({ error: "forbidden" }, 403);
      const body = ["POST", "PATCH"].includes(method) ? await req.json().catch(() => ({})) : {};
      if (method === "GET" && path === "/mentor") {
        const [memberKeys, codeKeys] = await Promise.all([store.list("members/"), store.list("codes/")]);
        const members = (await Promise.all(memberKeys.map((k) => store.getJSON(k)))).filter((m) => m && !m.mentor);
        const students = await Promise.all(members.map((m) => studentStats(store, mainStore, m)));
        const codes = (await Promise.all(codeKeys.map((k) => store.getJSON(k)))).filter((c) => c && !c.usedBy).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return json({ students: students.sort((a, b) => b.paidMonth - a.paidMonth || b.income - a.income), codes, bot: await botUsername(store, env.ACADEMY_BOT_TOKEN, fetchImpl) });
      }
      if (method === "POST" && path === "/mentor/codes") {
        const code = { code: newCode(), note: String(body.note || "").trim().slice(0, 60), createdAt: new Date().toISOString() };
        await store.setJSON(`codes/${code.code}`, code);
        return json(code, 201);
      }
      const codeM = path.match(/^\/mentor\/codes\/([A-Z0-9]+)$/);
      if (method === "DELETE" && codeM) {
        await store.delete(`codes/${codeM[1]}`);
        return json({ ok: true });
      }
      const stM = path.match(/^\/mentor\/students\/(\d+)$/);
      if (method === "PATCH" && stM) {
        const m = await store.getJSON(`members/${stM[1]}`);
        if (!m || m.mentor) return json({ error: "not_found" }, 404);
        if ("active" in body) m.active = body.active === true;
        if ("note" in body) m.note = String(body.note || "").trim().slice(0, 60);
        await store.setJSON(`members/${stM[1]}`, m);
        return json(m);
      }
      return json({ error: "not_found" }, 404);
    }

    // Наш бот, команда и импорт из таблицы ученикам не нужны.
    if (["/tg", "/bot/setup", "/access"].includes(path)) return json({ error: "forbidden" }, 403);

    const inner = new Request(`${url.origin}/api${path === "/" ? "" : path}${url.search}`, req);
    const res = await createHandler({
      store: workspace(store, mainStore, uid),
      env: { ...env, BOT_TOKEN: env.ACADEMY_BOT_TOKEN, ADMIN_IDS: uid, MANAGER_IDS: "", ACADEMY: "1", ACADEMY_MENTOR: isMentor ? "1" : "" },
      fetch: fetchImpl,
    })(inner);
    return res;
  };
}
