import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createHandler } from "../lib/core.mjs";
import { verifyInitData } from "../lib/auth.mjs";

const BOT_TOKEN = "123456:TEST_TOKEN";
const env = { BOT_TOKEN, ADMIN_IDS: "1", MANAGER_IDS: "2, 3" };

function sign(user, authDate = Math.floor(Date.now() / 1000), token = BOT_TOKEN) {
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: "q1", user: JSON.stringify(user) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(dcs).digest("hex"));
  return params.toString();
}

function memoryStore() {
  const data = new Map();
  return {
    getJSON: async (k) => (data.has(k) ? structuredClone(data.get(k)) : null),
    setJSON: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (k) => void data.delete(k),
    list: async (prefix) => [...data.keys()].filter((k) => k.startsWith(prefix)),
  };
}

function client(handle, user) {
  const initData = user ? sign(user) : "";
  return async (method, path, body) => {
    const res = await handle(
      new Request(`https://crm.test/api${path}`, {
        method,
        headers: { authorization: `tma ${initData}`, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return { status: res.status, body: await res.json() };
  };
}

test("verifyInitData accepts valid, rejects tampered, foreign and stale", () => {
  const user = { id: 1, first_name: "Пётр" };
  assert.equal(verifyInitData(sign(user), BOT_TOKEN).id, 1);
  assert.equal(verifyInitData(sign(user).replace("q1", "q2"), BOT_TOKEN), null);
  assert.equal(verifyInitData(sign(user, undefined, "999:OTHER"), BOT_TOKEN), null);
  assert.equal(verifyInitData(sign(user, Math.floor(Date.now() / 1000) - 2 * 86400), BOT_TOKEN), null);
});

test("auth: no initData → 401, unknown user → 403 with id", async () => {
  const handle = createHandler({ store: memoryStore(), env });
  assert.equal((await client(handle, null)("GET", "/state")).status, 401);
  const res = await client(handle, { id: 42, first_name: "X" })("GET", "/state");
  assert.equal(res.status, 403);
  assert.equal(res.body.userId, 42);
});

test("lead lifecycle, offer statuses and manager isolation", async () => {
  const handle = createHandler({ store: memoryStore(), env });
  const admin = client(handle, { id: 1, first_name: "Пётр" });
  const manager = client(handle, { id: 2, first_name: "Слава" });
  const other = client(handle, { id: 3, first_name: "Кирилл" });

  const state = await admin("GET", "/state");
  assert.equal(state.status, 200);
  assert.equal(state.body.me.role, "admin");
  assert.equal(state.body.settings.partnerShare, 20);
  assert.ok(state.body.offers.find((o) => o.id === "zaymer" && o.category === "mfo" && o.cost === 20));

  assert.equal((await manager("POST", "/leads", { source: "x" })).status, 400);
  const created = await manager("POST", "/leads", { telegram: "Diman0004", fio: " Давыдов Дмитрий " });
  assert.equal(created.status, 201);
  assert.equal(created.body.telegram, "@Diman0004");
  assert.equal(created.body.fio, "Давыдов Дмитрий");
  assert.equal(created.body.ownerId, 2);
  const id = created.body.id;

  const patched = await manager("PATCH", `/leads/${id}`, {
    stage: "offers",
    payout: "1000",
    offers: {
      alfa: { status: "paid", amount: 15500, comment: "Провели 2300" },
      otp: { status: "opened", cost: "1380,5" },
      zaymer: { status: "rejected" },
      fake: { status: "paid" },
    },
  });
  assert.equal(patched.status, 200);
  const o = patched.body.offers;
  assert.equal(patched.body.stage, "offers");
  assert.equal(patched.body.payout, 1000);
  assert.deepEqual([o.alfa.status, o.alfa.amount, o.alfa.comment], ["paid", 15500, "Провели 2300"]);
  assert.equal(o.otp.cost, 1380.5);
  assert.equal(o.zaymer.cost, 20);
  assert.equal(o.fake, undefined);

  assert.equal((await manager("PATCH", `/leads/${id}`, { stage: "hacked" })).body.stage, "offers");

  // другой менеджер не видит и не может править чужого лида
  assert.equal((await other("GET", "/state")).body.leads.length, 0);
  assert.equal((await other("PATCH", `/leads/${id}`, { fio: "x" })).status, 404);
  assert.equal((await admin("GET", "/state")).body.leads.length, 1);

  assert.equal((await manager("DELETE", `/leads/${id}`)).status, 403);
  assert.equal((await admin("DELETE", `/leads/${id}`)).status, 200);
  assert.equal((await admin("GET", "/state")).body.leads.length, 0);
});

test("settings and import (upsert by telegram)", async () => {
  const handle = createHandler({ store: memoryStore(), env });
  const admin = client(handle, { id: 1, first_name: "Пётр" });
  const manager = client(handle, { id: 2, first_name: "Слава" });

  assert.equal((await manager("PUT", "/settings", { partnerShare: 20 })).status, 403);
  const s = await admin("PUT", "/settings", { partnerShare: 25, taxRate: 500 });
  assert.deepEqual(s.body, { taxRate: 7, partnerShare: 25, partnerName: "Дамир" });

  assert.equal((await manager("POST", "/import", { leads: [] })).status, 403);
  const first = await admin("POST", "/import", {
    leads: [
      { telegram: "@GreeenTeea", fio: "Ильязов Марат", offers: { uralsib: { status: "paid", amount: 6000 } } },
      { telegram: "@borbazez", payout: 500 },
      { source: "без имени" },
    ],
  });
  assert.deepEqual(first.body, { created: 2, updated: 0 });
  const second = await admin("POST", "/import", {
    leads: [{ telegram: "greeenteea", offers: { ozon: { status: "paid", amount: 3750 } } }],
  });
  assert.deepEqual(second.body, { created: 0, updated: 1 });
  const leads = (await admin("GET", "/state")).body.leads;
  assert.equal(leads.length, 2);
  const marat = leads.find((l) => l.telegram === "@GreeenTeea");
  assert.equal(marat.fio, "Ильязов Марат");
  assert.deepEqual(Object.keys(marat.offers).sort(), ["ozon", "uralsib"]);
});

test("offers catalog: admin only, sanitized", async () => {
  const handle = createHandler({ store: memoryStore(), env });
  const admin = client(handle, { id: 1, first_name: "Пётр" });
  const manager = client(handle, { id: 2, first_name: "Слава" });

  assert.equal((await manager("PUT", "/offers", { offers: [] })).status, 403);
  const res = await admin("PUT", "/offers", {
    offers: [
      { id: "vtb", name: "ВТБ", amount: "7000" },
      { id: "", name: "Новый банк", amount: -5 },
      { name: "" },
    ],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  assert.equal(res.body[0].amount, 7000);
  assert.equal(res.body[1].amount, 0);
  assert.match(res.body[1].id, /^o_/);
  assert.equal((await manager("GET", "/state")).body.offers.length, 2);
});

test("DEV_MODE gives admin access only without initData", async () => {
  const handle = createHandler({ store: memoryStore(), env: { ...env, DEV_MODE: "1" } });
  const res = await client(handle, null)("GET", "/state");
  assert.equal(res.status, 200);
  assert.equal(res.body.me.role, "admin");
});

test("401 explains why: missing token vs bad signature", async () => {
  const noToken = createHandler({ store: memoryStore(), env: { ADMIN_IDS: "1" } });
  assert.equal((await client(noToken, { id: 1, first_name: "П" })("GET", "/state")).body.reason, "no_bot_token");
  const other = createHandler({ store: memoryStore(), env: { ...env, BOT_TOKEN: "999:OTHER" } });
  const res = await client(other, { id: 1, first_name: "П" })("GET", "/state");
  assert.equal(res.status, 401);
  assert.equal(res.body.reason, "bad_signature");
});

test("access from the app: stranger lands in pending, admin grants a role", async () => {
  const handle = createHandler({ store: memoryStore(), env });
  const admin = client(handle, { id: 1, first_name: "Пётр" });
  const damir = client(handle, { id: 777, first_name: "Дамир", username: "damir" });
  const manager = client(handle, { id: 2, first_name: "Слава" });

  assert.equal((await damir("GET", "/state")).status, 403);
  let access = (await admin("GET", "/access")).body;
  assert.deepEqual(access.pending.map((p) => [p.id, p.name, p.username]), [[777, "Дамир", "damir"]]);
  assert.ok(access.fixed.find((f) => f.id === 1 && f.role === "admin"));

  assert.equal((await manager("GET", "/access")).status, 403);
  assert.equal((await admin("PUT", "/access", { id: 1, role: "manager" })).body.error, "fixed_in_config");

  access = (await admin("PUT", "/access", { id: 777, role: "admin" })).body;
  assert.equal(access.pending.length, 0);
  assert.deepEqual(access.users.map((u) => [u.id, u.role, u.name]), [[777, "admin", "Дамир"]]);

  const st = await damir("GET", "/state");
  assert.equal(st.status, 200);
  assert.equal(st.body.me.role, "admin");
  assert.equal((await damir("POST", "/leads", { telegram: "@newlead" })).status, 201);

  await admin("PUT", "/access", { id: 777, role: null });
  assert.equal((await damir("GET", "/state")).status, 403);
});
