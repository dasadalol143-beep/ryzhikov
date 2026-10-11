import { randomUUID } from "node:crypto";
import { checkInitData, parseIds } from "./auth.mjs";
import { telegram, webhookSecret } from "./telegram.mjs";
import { handleUpdate, BOT_COMMANDS } from "./bot.mjs";
import {
  ROLES, STATUS_IDS, SOURCES, REPORT_FIELDS, AFTER_CALL, DEFAULT_RATES, FOLLOWUP_TOUCHES,
  canSeeMoney, currentCall, ndzCount, clientTitle, statusLabel, fmtWhen,
} from "../public/lib/model.js";

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const str = (v, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
export const money = (v) => {
  const n = Math.round(Number(String(v ?? "").replace(",", ".").replace(/[\s₽р.]/g, "")) * 100) / 100;
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 100_000_000) : 0;
};
const normTelegram = (v) => {
  const s = str(v, 64).replace(/^https?:\/\/t\.me\//i, "").replace(/\s/g, "");
  if (!s) return "";
  return s.startsWith("@") || /^\+?\d/.test(s) ? s : `@${s}`;
};
const isoOrNull = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const nowIso = () => new Date().toISOString();

export const DEFAULT_SETTINGS = { rates: DEFAULT_RATES, monthPlan: 0, aliases: {} };
export const loadSettings = async (store) => {
  const s = (await store.get("meta", "settings")) || {};
  return { ...DEFAULT_SETTINGS, ...s, rates: { ...DEFAULT_RATES, ...(s.rates || {}) } };
};

// ---------- доступ ----------
// OWNER_IDS из окружения — всегда собственник. Остальных добавляют в приложении (вкладка «Команда»).
export async function userOf(store, env, tgUser) {
  const id = String(tgUser.id);
  const saved = await store.get("user", id);
  if (parseIds(env.OWNER_IDS).has(id)) {
    return { ...(saved || {}), id, role: "owner", active: true, name: saved?.name || displayName(tgUser), username: tgUser.username || saved?.username || "" };
  }
  return saved?.active ? saved : null;
}

export const displayName = (u) => [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || String(u.id);

async function authenticate(req, env, store) {
  const header = req.headers.get("authorization") || "";
  const initData = header.startsWith("tma ") ? header.slice(4) : "";
  let { user, reason } = checkInitData(initData, env.BOT_TOKEN);
  if (!user && env.DEV_MODE === "1" && !initData) user = { id: Number(env.DEV_USER || 1), first_name: "Dev" };
  if (!user) return { reason };
  const me = await userOf(store, env, user);
  if (!me) {
    // Запомнить, кто стучался: собственник выдаст роль в один тап.
    await store.put("pending", String(user.id), { id: String(user.id), name: displayName(user), username: user.username || "", at: nowIso() });
    return { tg: user, reason: "no_access" };
  }
  return { tg: user, me };
}

// ---------- клиент ----------
function blankClient(by) {
  const at = nowIso();
  return {
    id: randomUUID(),
    name: "",
    telegram: "",
    phone: "",
    source: SOURCES[0],
    status: "new",
    statusAt: at,
    lidorubId: null,
    mopId: null,
    chatUrl: "",
    info: "",
    wantedSum: 0,
    calls: [],
    events: [],
    touches: [],
    history: [],
    createdAt: at,
    createdBy: by,
    updatedAt: at,
  };
}

const log = (c, by, text) => {
  c.history = [{ at: nowIso(), by, text }, ...(c.history || [])].slice(0, 60);
};
const event = (c, t, by, extra = {}) => {
  c.events = [...(c.events || []), { t, at: nowIso(), by, ...extra }];
};

function applyFields(c, body) {
  if ("name" in body) c.name = str(body.name, 120);
  if ("telegram" in body) c.telegram = normTelegram(body.telegram);
  if ("phone" in body) c.phone = str(body.phone, 40);
  if ("source" in body) c.source = SOURCES.includes(body.source) ? body.source : c.source;
  if ("chatUrl" in body) c.chatUrl = str(body.chatUrl, 300);
  if ("info" in body) c.info = str(body.info, 3000);
  if ("wantedSum" in body) c.wantedSum = money(body.wantedSum);
  if ("lidorubId" in body) c.lidorubId = body.lidorubId ? String(body.lidorubId) : null;
}

// Смена статуса + события для РнП. sum — сумма продажи/предоплаты/потенциала/отказа.
async function setStatus(c, status, { by, sum, store }) {
  if (!STATUS_IDS.includes(status) || status === c.status) return;
  const mop = c.mopId;
  const amount = money(sum) || c.wantedSum || 0;
  c.status = status;
  c.statusAt = nowIso();
  c.touches = [];
  if (status === "paid") {
    event(c, "paid", by, { mop, sum: amount });
    // Продажа сразу падает в ведомость черновиком — РОП вносит чистую сумму и верифицирует.
    if (store) {
      const p = {
        id: randomUUID(),
        date: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10),
        clientId: c.id,
        clientName: clientTitle(c),
        mopId: mop,
        lidorubId: c.lidorubId,
        tariff: amount,
        net: null,
        verified: false,
        note: "",
        createdBy: by,
        createdAt: nowIso(),
      };
      await store.put("payment", p.id, p);
    }
  }
  if (status === "prepaid") event(c, "prepaid", by, { mop, sum: money(sum) });
  if (status === "thinking" || status === "resched") event(c, "potential", by, { mop, sum: amount });
  if (status === "refuse_bank") event(c, "refuse_bank", by, { mop, sum: amount });
  if (status === "invalid") event(c, "invalid", by);
  if (["paid", "refuse_personal", "refuse_bank", "ignore", "invalid"].includes(status)) {
    // Закрытому клиенту созвоны не нужны.
    for (const call of c.calls) if (!call.outcome) Object.assign(call, { outcome: "moved", movedAt: nowIso() });
  }
  const shown = status === "prepaid" ? money(sum) : amount;
  log(c, by, `Статус → ${statusLabel(status)}${shown && ["paid", "prepaid", "thinking", "resched", "refuse_bank"].includes(status) ? ` · ${shown.toLocaleString("ru-RU")} ₽` : ""}`);
}

// Действия с карточкой: созвоны, итоги, отчёт, касания дожима.
export async function applyAction(c, body, { by, store, users }) {
  const type = body.type;
  if (type === "call") {
    const at = isoOrNull(body.at);
    const mopId = body.mopId ? String(body.mopId) : c.mopId;
    if (!at || !mopId) throw Object.assign(new Error("Нужны время и менеджер"), { status: 400 });
    const cur = currentCall(c);
    if (cur) Object.assign(cur, { outcome: "moved", movedAt: nowIso() });
    // Первый раз отдали этому менеджеру — это «лид в работе» в РнП.
    if (!(c.events || []).some((e) => e.t === "handed" && e.mop === mopId)) event(c, "handed", by, { mop: mopId });
    c.calls.push({ id: randomUUID().slice(0, 8), at, mopId, setAt: nowIso(), setBy: by, outcome: null, notified: {} });
    c.mopId = mopId;
    if (!["paid"].includes(c.status)) {
      c.status = "in_work";
      c.statusAt = nowIso();
      c.touches = [];
    }
    log(c, by, `Созвон назначен на ${fmtWhen(Date.parse(at))} МСК`);
    return;
  }
  if (type === "held" || type === "ndz") {
    const call = (body.callId && c.calls.find((x) => x.id === body.callId)) || currentCall(c);
    if (!call) throw Object.assign(new Error("Нет назначенного созвона"), { status: 400 });
    if (call.outcome) return; // уже отмечено (например, из бота)
    call.outcome = type;
    call.outcomeAt = nowIso();
    call.outcomeBy = by;
    if (type === "ndz") {
      const n = Math.min(ndzCount(c), 3);
      c.status = `ndz${n}`;
      c.statusAt = nowIso();
      c.touches = [];
      event(c, "ndz", by, { mop: call.mopId });
      log(c, by, `НДЗ-${n}`);
    } else {
      log(c, by, "Созвон проведён");
    }
    return;
  }
  if (type === "report") {
    const call = (body.callId && c.calls.find((x) => x.id === body.callId)) || [...c.calls].reverse().find((x) => x.outcome === "held");
    if (!call) throw Object.assign(new Error("Сначала отметь, что созвон проведён"), { status: 400 });
    const report = {};
    for (const f of REPORT_FIELDS) report[f.id] = str(body.report?.[f.id], 1500);
    report.presented = !!body.report?.presented;
    report.offeredPay = !!body.report?.offeredPay;
    call.report = report;
    call.reportAt = nowIso();
    if ("wantedSum" in body) c.wantedSum = money(body.wantedSum);
    if (AFTER_CALL.includes(body.status)) await setStatus(c, body.status, { by, sum: body.sum, store, users });
    log(c, by, "Отчёт после диагностики");
    if (body.status === "resched" && isoOrNull(body.nextAt)) await applyAction(c, { type: "call", at: body.nextAt, mopId: call.mopId }, { by, store, users });
    return;
  }
  if (type === "status") {
    await setStatus(c, body.status, { by, sum: body.sum, store, users });
    return;
  }
  if (type === "touch") {
    c.touches = [...(c.touches || []), { at: nowIso(), by, answered: !!body.answered, text: str(body.text, 300) }];
    log(c, by, body.answered ? "Касание: ответил" : "Касание: без ответа");
    // Регламент: 3 касания подряд без ответа → «Игнор».
    const silent = c.touches.filter((t) => !t.answered).length;
    if (!body.answered && silent >= FOLLOWUP_TOUCHES && !["paid", "invalid"].includes(c.status)) await setStatus(c, "ignore", { by, store, users });
    if (body.answered) c.touches = [];
    return;
  }
  if (type === "lm") {
    if ((c.events || []).some((e) => e.t === "lm")) return;
    event(c, "lm", by);
    c.lmAt = nowIso();
    log(c, by, "Отправлен лид-магнит");
    return;
  }
  if (type === "comment") {
    const text = str(body.text, 1000);
    if (text) log(c, by, `💬 ${text}`);
    return;
  }
  throw Object.assign(new Error("Неизвестное действие"), { status: 400 });
}

// ---------- ведомость ----------
function applyPayment(p, body) {
  if ("date" in body && isDay(body.date)) p.date = body.date;
  if ("tariff" in body) p.tariff = money(body.tariff);
  if ("net" in body) p.net = body.net === null || body.net === "" ? null : money(body.net);
  if ("mopId" in body) p.mopId = body.mopId ? String(body.mopId) : null;
  if ("clientName" in body) p.clientName = str(body.clientName, 120);
  if ("note" in body) p.note = str(body.note, 300);
  if ("verified" in body) p.verified = !!body.verified && p.net !== null;
}

// ---------- роутер ----------
export function createHandler({ store, env, fetch: fetchImpl = fetch }) {
  return async (req) => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, "");
    try {
      if (path === "/tg" && req.method === "POST") {
        if (!env.BOT_TOKEN || req.headers.get("x-telegram-bot-api-secret-token") !== (await webhookSecret(env.BOT_TOKEN))) return json({ error: "forbidden" }, 403);
        const update = await req.json().catch(() => ({}));
        await handleUpdate(update, { store, env, tg: telegram(env.BOT_TOKEN, fetchImpl), appUrl: env.APP_URL || `${url.origin}/` });
        return json({ ok: true });
      }

      const auth = await authenticate(req, env, store);
      if (!auth.me) return json({ error: "unauthorized", reason: auth.reason, id: auth.tg?.id || null, name: auth.tg ? displayName(auth.tg) : null }, auth.tg ? 403 : 401);
      const me = auth.me;
      const by = me.id;
      const money_ = canSeeMoney(me.role);
      const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await req.json().catch(() => ({})) : {};
      const users = Object.fromEntries((await store.all("user")).map((u) => [u.id, u]));
      users[me.id] = { ...(users[me.id] || {}), ...me };

      if (path === "/state" && req.method === "GET") {
        // Бот подключается сам при первом входе собственника.
        if (me.role === "owner" && env.BOT_TOKEN) await ensureWebhook(store, env, fetchImpl, `${url.origin}/api/tg`).catch(() => {});
        const [clients, settings, legacy, pending] = await Promise.all([store.all("client"), loadSettings(store), store.get("meta", "legacy"), store.all("pending")]);
        return json({
          me,
          users: Object.values(users),
          pending: me.role === "owner" || me.role === "rop" ? pending : [],
          clients,
          settings,
          legacy: legacy || {},
          payments: money_ ? await store.all("payment") : null,
          serverNow: Date.now(),
        });
      }

      // клиенты
      if (path === "/clients" && req.method === "POST") {
        const c = blankClient(by);
        applyFields(c, body);
        if (!c.lidorubId && me.role === "lidorub") c.lidorubId = me.id;
        if (!c.name && !c.telegram && !c.phone) return json({ error: "Нужно имя, ник или телефон" }, 400);
        if (c.telegram) {
          const dup = (await store.all("client")).find((x) => x.telegram && x.telegram.toLowerCase() === c.telegram.toLowerCase());
          if (dup) return json({ error: "duplicate", client: dup }, 409);
        }
        log(c, by, "Клиент создан");
        if (body.call?.at) await applyAction(c, { type: "call", ...body.call }, { by, store, users });
        await store.put("client", c.id, c);
        return json({ client: c });
      }
      const cm = path.match(/^\/clients\/([\w-]+)(\/action)?$/);
      if (cm) {
        const c = await store.get("client", cm[1]);
        if (!c) return json({ error: "not_found" }, 404);
        if (req.method === "DELETE") {
          if (!money_) return json({ error: "forbidden" }, 403);
          await store.del("client", c.id);
          return json({ ok: true });
        }
        if (cm[2] && req.method === "POST") await applyAction(c, body, { by, store, users });
        else if (req.method === "PATCH") {
          applyFields(c, body);
          log(c, by, "Изменены данные");
        } else return json({ error: "not_found" }, 404);
        c.updatedAt = nowIso();
        await store.put("client", c.id, c);
        return json({ client: c, payments: money_ ? await store.all("payment") : null });
      }

      // ведомость — только собственник и РОП
      if (path.startsWith("/payments")) {
        if (!money_) return json({ error: "forbidden" }, 403);
        const pm = path.match(/^\/payments\/([\w-]+)$/);
        if (path === "/payments" && req.method === "POST") {
          const p = { id: randomUUID(), date: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10), tariff: 0, net: null, verified: false, mopId: null, clientName: "", note: "", createdBy: by, createdAt: nowIso() };
          applyPayment(p, body);
          applyPayment(p, { verified: body.verified });
          await store.put("payment", p.id, p);
          return json({ payment: p });
        }
        if (pm) {
          const p = await store.get("payment", pm[1]);
          if (!p) return json({ error: "not_found" }, 404);
          if (req.method === "DELETE") {
            await store.del("payment", p.id);
            return json({ ok: true });
          }
          if (req.method === "PATCH") {
            applyPayment(p, body);
            if ("verified" in body) p.verifiedBy = p.verified ? by : null;
            await store.put("payment", p.id, p);
            return json({ payment: p });
          }
        }
        return json({ error: "not_found" }, 404);
      }

      if (path === "/settings" && req.method === "PUT") {
        if (!money_) return json({ error: "forbidden" }, 403);
        const cur = await loadSettings(store);
        const pct = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100 ? Number(v) : d);
        const next = {
          rates: Object.fromEntries(Object.keys(DEFAULT_RATES).map((k) => [k, pct(body.rates?.[k], cur.rates[k])])),
          monthPlan: "monthPlan" in body ? money(body.monthPlan) : cur.monthPlan,
          aliases: body.aliases && typeof body.aliases === "object" ? Object.fromEntries(Object.entries(body.aliases).map(([k, v]) => [str(k, 40), str(String(v), 40)]).filter(([, v]) => v)) : cur.aliases,
        };
        await store.put("meta", "settings", next);
        return json({ settings: next });
      }

      // команда
      if (path === "/users" && req.method === "POST") {
        if (!["owner", "rop"].includes(me.role)) return json({ error: "forbidden" }, 403);
        const id = str(String(body.id || ""), 20);
        if (!/^\d+$/.test(id) || !ROLES[body.role]) return json({ error: "Нужны Telegram ID и роль" }, 400);
        // РОП добавляет менеджеров и лидорубов, роли выше — только собственник.
        if (me.role === "rop" && !["mop", "lidorub"].includes(body.role)) return json({ error: "forbidden" }, 403);
        const prev = (await store.get("user", id)) || (await store.get("pending", id)) || {};
        const u = { id, name: str(body.name, 60) || prev.name || id, username: prev.username || "", role: body.role, active: body.active !== false, addedBy: by, addedAt: prev.addedAt || nowIso() };
        await store.put("user", id, u);
        await store.del("pending", id);
        return json({ user: u });
      }
      const um = path.match(/^\/users\/(\d+)$/);
      if (um && req.method === "DELETE") {
        if (me.role !== "owner") return json({ error: "forbidden" }, 403);
        const u = await store.get("user", um[1]);
        if (u) await store.put("user", u.id, { ...u, active: false });
        await store.del("pending", um[1]);
        return json({ ok: true });
      }

      // импорт истории из Google-таблиц (seed/*.json)
      if (path === "/import" && req.method === "POST") {
        if (me.role !== "owner") return json({ error: "forbidden" }, 403);
        const res = await importSeed(store, body);
        return json(res);
      }

      return json({ error: "not_found" }, 404);
    } catch (e) {
      return json({ error: e.message || "error" }, e.status || 500);
    }
  };
}

export async function importSeed(store, body) {
  const out = { payments: 0, legacy: false, clients: 0 };
  if (Array.isArray(body.payments)) {
    const items = body.payments.filter((p) => p.id && isDay(p.date)).map((p) => ({ net: null, verified: false, ...p, tariff: money(p.tariff), net: p.net === null ? null : money(p.net) }));
    await store.putMany("payment", items);
    out.payments = items.length;
  }
  if (body.legacy) {
    await store.put("meta", "legacy", body.legacy);
    out.legacy = true;
  }
  if (Array.isArray(body.clients)) {
    await store.putMany("client", body.clients.filter((c) => c.id));
    out.clients = body.clients.length;
  }
  return out;
}

async function ensureWebhook(store, env, fetchImpl, hookUrl) {
  const saved = await store.get("meta", "webhook");
  if (saved?.url === hookUrl && saved?.v === 1) return;
  const tg = telegram(env.BOT_TOKEN, fetchImpl);
  await tg.setWebhook(hookUrl, await webhookSecret(env.BOT_TOKEN));
  await tg.setMyCommands(BOT_COMMANDS).catch(() => {});
  await store.put("meta", "webhook", { url: hookUrl, v: 1, at: nowIso() });
}
