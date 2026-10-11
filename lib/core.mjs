import { randomUUID } from "node:crypto";
import { checkInitData, roleFor, parseIds } from "./auth.mjs";
import { DEFAULT_OFFERS, DEFAULT_SETTINGS, CATEGORIES, STAGES, OFFER_STATUSES } from "./offers.mjs";
import { STAGE_LABELS, STATUS_SHORT } from "../public/labels.js";
import { telegram } from "./telegram.mjs";
import { sendBackup } from "./report.mjs";

const OFFERS_KEY = "offers";
const SETTINGS_KEY = "settings";
const LEAD_PREFIX = "leads/";
const ACCESS_KEY = "access";
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
  if (!lead || lead.history?.length) return lead;
  const created = Date.parse(lead.createdAt);
  for (const lo of Object.values(lead.offers || {})) {
    if (lo.changedAt && Math.abs(Date.parse(lo.changedAt) - created) < 5000) delete lo.changedAt;
  }
  return lead;
}

function applyLeadPatch(lead, body, offers, by, { importing = false } = {}) {
  if ("telegram" in body) lead.telegram = normTelegram(body.telegram);
  if ("fio" in body) lead.fio = str(body.fio, 120);
  if ("source" in body) lead.source = str(body.source, 120);
  if ("note" in body) lead.note = str(body.note, 2000);
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
      const [offers, settings, leads] = await Promise.all([loadOffers(store), loadSettings(store), loadLeads(store)]);
      return json({
        me: { id: auth.user.id, name: displayName(auth.user), role: auth.role },
        offers,
        settings,
        leads: leads.filter((l) => canSee(auth, l)),
      });
    }

    if (method === "POST" && path === "/leads") {
      const lead = newLead(auth);
      applyLeadPatch(lead, body, await loadOffers(store));
      if (!lead.telegram && !lead.fio) return json({ error: "telegram_or_fio_required" }, 400);
      logEvent(lead, displayName(auth.user), "Лид создан");
      await store.setJSON(LEAD_PREFIX + lead.id, lead);
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
        return json({ ok: true });
      }
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
      let created = 0;
      let updated = 0;
      for (const item of body.leads.slice(0, 1000)) {
        if (!item || typeof item !== "object") continue;
        const tg = normTelegram(item.telegram).toLowerCase();
        let lead = tg && byTelegram.get(tg);
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
      return json({ created, updated });
    }

    return json({ error: "not_found" }, 404);
  };
}
