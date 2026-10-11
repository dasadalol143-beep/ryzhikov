import { randomUUID } from "node:crypto";
import { verifyInitData, roleFor } from "./auth.mjs";
import { DEFAULT_OFFERS, STAGES, OFFER_STATUSES } from "./offers.mjs";

const OFFERS_KEY = "offers";
const LEAD_PREFIX = "leads/";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const str = (v, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const money = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 10_000_000) : 0;
};

function authenticate(req, env) {
  const header = req.headers.get("authorization") || "";
  const initData = header.startsWith("tma ") ? header.slice(4) : "";

  let user = verifyInitData(initData, env.BOT_TOKEN);
  if (!user && env.DEV_MODE === "1" && !initData) {
    user = { id: 0, first_name: "Dev" };
    return { user, role: "admin" };
  }
  if (!user) return null;
  const role = roleFor(user.id, env);
  return role ? { user, role } : { user, role: null };
}

const displayName = (u) => [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || String(u.id);

async function loadOffers(store) {
  return (await store.getJSON(OFFERS_KEY)) || DEFAULT_OFFERS;
}

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
  for (const o of input.slice(0, 100)) {
    const name = str(o?.name, 80);
    if (!name) continue;
    let id = str(o.id, 40).replace(/[^a-z0-9_-]/gi, "") || `o_${randomUUID().slice(0, 8)}`;
    if (seen.has(id)) id = `${id}_${out.length}`;
    seen.add(id);
    out.push({
      id,
      name,
      partner: str(o.partner, 80),
      amount: money(o.amount),
      active: o.active !== false,
      note: str(o.note, 200),
    });
  }
  return out;
}

function applyLeadPatch(lead, body, offers) {
  if ("name" in body) lead.name = str(body.name, 120) || lead.name;
  if ("contact" in body) lead.contact = str(body.contact, 120);
  if ("source" in body) lead.source = str(body.source, 120);
  if ("note" in body) lead.note = str(body.note, 2000);
  if ("stage" in body && STAGES.includes(body.stage)) lead.stage = body.stage;

  if (body.offers && typeof body.offers === "object") {
    const catalog = new Map(offers.map((o) => [o.id, o]));
    for (const [offerId, patch] of Object.entries(body.offers)) {
      if (!catalog.has(offerId) || !patch || typeof patch !== "object") continue;
      const current = lead.offers[offerId] || { status: "none", amount: catalog.get(offerId).amount };
      if (OFFER_STATUSES.includes(patch.status)) {
        if (patch.status !== current.status) current.changedAt = new Date().toISOString();
        current.status = patch.status;
      }
      if ("amount" in patch) current.amount = money(patch.amount);
      lead.offers[offerId] = current;
    }
  }
}

export function createHandler({ store, env }) {
  return async function handle(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();

    const auth = authenticate(req, env);
    if (!auth) return json({ error: "unauthorized" }, 401);
    if (!auth.role) return json({ error: "forbidden", userId: auth.user.id }, 403);

    const body = ["POST", "PATCH", "PUT"].includes(method) ? await req.json().catch(() => ({})) : {};

    if (method === "GET" && path === "/state") {
      const [offers, leads] = await Promise.all([loadOffers(store), loadLeads(store)]);
      return json({
        me: { id: auth.user.id, name: displayName(auth.user), role: auth.role },
        offers,
        leads: leads.filter((l) => canSee(auth, l)),
        stages: STAGES,
      });
    }

    if (method === "POST" && path === "/leads") {
      const name = str(body.name, 120);
      if (!name) return json({ error: "name_required" }, 400);
      const now = new Date().toISOString();
      const lead = {
        id: randomUUID(),
        name,
        contact: "",
        source: "",
        note: "",
        stage: "new",
        offers: {},
        ownerId: auth.user.id,
        ownerName: displayName(auth.user),
        createdAt: now,
        updatedAt: now,
      };
      applyLeadPatch(lead, body, await loadOffers(store));
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
        if (auth.role !== "admin") return json({ error: "forbidden" }, 403);
        await store.delete(key);
        return json({ ok: true });
      }
    }

    if (method === "PUT" && path === "/offers") {
      if (auth.role !== "admin") return json({ error: "forbidden" }, 403);
      const offers = sanitizeOffers(body.offers);
      if (!offers) return json({ error: "bad_offers" }, 400);
      await store.setJSON(OFFERS_KEY, offers);
      return json(offers);
    }

    return json({ error: "not_found" }, 404);
  };
}
