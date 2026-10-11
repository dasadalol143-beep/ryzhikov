import { randomUUID } from "node:crypto";
import { verifyInitData, roleFor } from "./auth.mjs";
import { DEFAULT_OFFERS, DEFAULT_SETTINGS, CATEGORIES, STAGES, OFFER_STATUSES } from "./offers.mjs";

const OFFERS_KEY = "offers";
const SETTINGS_KEY = "settings";
const LEAD_PREFIX = "leads/";

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

  let user = verifyInitData(initData, env.BOT_TOKEN);
  if (!user && env.DEV_MODE === "1" && !initData) {
    return { user: { id: 0, first_name: "Dev" }, role: "admin" };
  }
  if (!user) return null;
  return { user, role: roleFor(user.id, env) };
}

const displayName = (u) => [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || String(u.id);

const loadOffers = async (store) => (await store.getJSON(OFFERS_KEY)) || DEFAULT_OFFERS;
const loadSettings = async (store) => ({ ...DEFAULT_SETTINGS, ...((await store.getJSON(SETTINGS_KEY)) || {}) });

async function loadLeads(store) {
  const keys = await store.list(LEAD_PREFIX);
  const leads = await Promise.all(keys.map((k) => store.getJSON(k)));
  return leads.filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

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

function applyLeadPatch(lead, body, offers) {
  if ("telegram" in body) lead.telegram = normTelegram(body.telegram);
  if ("fio" in body) lead.fio = str(body.fio, 120);
  if ("source" in body) lead.source = str(body.source, 120);
  if ("note" in body) lead.note = str(body.note, 2000);
  if ("payout" in body) lead.payout = money(body.payout);
  if ("stage" in body && STAGES.includes(body.stage)) lead.stage = body.stage;

  if (body.offers && typeof body.offers === "object") {
    const catalog = new Map(offers.map((o) => [o.id, o]));
    for (const [offerId, patch] of Object.entries(body.offers)) {
      const offer = catalog.get(offerId);
      if (!offer || !patch || typeof patch !== "object") continue;
      const current = lead.offers[offerId] || { status: "none", amount: offer.amount, cost: offer.cost || 0, comment: "" };
      if (OFFER_STATUSES.includes(patch.status) && patch.status !== current.status) {
        current.status = patch.status;
        current.changedAt = new Date().toISOString();
      }
      if ("amount" in patch) current.amount = money(patch.amount);
      if ("cost" in patch) current.cost = money(patch.cost);
      if ("comment" in patch) current.comment = str(patch.comment, 200);
      lead.offers[offerId] = current;
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
    offers: {},
    ownerId: auth.user.id,
    ownerName: displayName(auth.user),
    createdAt: now,
    updatedAt: now,
  };
}

export function createHandler({ store, env }) {
  return async function handle(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();

    const auth = authenticate(req, env);
    if (!auth) return json({ error: "unauthorized" }, 401);
    if (!auth.role) return json({ error: "forbidden", userId: auth.user.id }, 403);
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
      await store.setJSON(LEAD_PREFIX + lead.id, lead);
      return json(lead, 201);
    }

    const leadMatch = path.match(/^\/leads\/([0-9a-f-]{36})$/);
    if (leadMatch) {
      const key = LEAD_PREFIX + leadMatch[1];
      const lead = await store.getJSON(key);
      if (!lead || !canSee(auth, lead)) return json({ error: "not_found" }, 404);

      if (method === "PATCH") {
        applyLeadPatch(lead, body, await loadOffers(store));
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
        applyLeadPatch(lead, lead.telegram ? rest : item, offers);
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
