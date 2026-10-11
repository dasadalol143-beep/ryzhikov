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
  assert.ok(state.body.offers.find((o) => o.id === "alfa_ip"));

  const created = await manager("POST", "/leads", { name: "  Гоша  ", contact: "@gosha" });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, "Гоша");
  assert.equal(created.body.ownerId, 2);
  const id = created.body.id;

  const patched = await manager("PATCH", `/leads/${id}`, {
    stage: "offers",
    offers: { alfa_ip: { status: "paid" }, vtb: { status: "done", amount: "6500" }, fake: { status: "paid" } },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.stage, "offers");
  assert.deepEqual(
    { s: patched.body.offers.alfa_ip.status, a: patched.body.offers.alfa_ip.amount },
    { s: "paid", a: 15000 },
  );
  assert.equal(patched.body.offers.vtb.amount, 6500);
  assert.equal(patched.body.offers.fake, undefined);

  const bad = await manager("PATCH", `/leads/${id}`, { stage: "hacked" });
  assert.equal(bad.body.stage, "offers");

  // другой менеджер не видит и не может править чужого лида
  assert.equal((await other("GET", "/state")).body.leads.length, 0);
  assert.equal((await other("PATCH", `/leads/${id}`, { name: "x" })).status, 404);
  // админ видит всех
  assert.equal((await admin("GET", "/state")).body.leads.length, 1);

  // удалять может только админ
  assert.equal((await manager("DELETE", `/leads/${id}`)).status, 403);
  assert.equal((await admin("DELETE", `/leads/${id}`)).status, 200);
  assert.equal((await admin("GET", "/state")).body.leads.length, 0);
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
