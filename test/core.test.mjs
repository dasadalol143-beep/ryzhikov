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
  // вебхук бота «уже подключён», чтобы тесты не ходили в настоящий Telegram
  const data = new Map([["bot_webhook", { url: "https://crm.test/api/tg", v: 3 }]]);
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
  assert.deepEqual([s.body.taxRate, s.body.partnerShare, s.body.partnerName, s.body.templates.length], [7, 25, "Дамир", 5]);

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

test("history, next step, reminder and automatic stage", async () => {
  const handle = createHandler({ store: memoryStore(), env });
  const damir = client(handle, { id: 1, first_name: "Дамир" });
  const lead = (await damir("POST", "/leads", { telegram: "@x" })).body;
  assert.equal(lead.history[0].text, "Лид создан");

  let l = (await damir("PATCH", `/leads/${lead.id}`, { offers: { vtb: { status: "applied" } } })).body;
  assert.equal(l.stage, "in_work");
  l = (await damir("PATCH", `/leads/${lead.id}`, { offers: { alfa: { status: "paid" } } })).body;
  assert.equal(l.stage, "offers");
  assert.deepEqual(l.history.slice(0, 2).map((h) => h.text), ["Этап: Докрутка", "Альфа — РКО: Засчитано"]);
  assert.equal(l.history[0].by, "Дамир");

  l = (await damir("PATCH", `/leads/${lead.id}`, { nextStep: "Дожать ЦД по ВТБ", remindAt: "2026-10-14" })).body;
  assert.equal(l.remindAt, "2026-10-14");
  assert.equal(l.history[0].text, "Напоминание на 14.10.2026: Дожать ЦД по ВТБ");
  assert.equal((await damir("PATCH", `/leads/${lead.id}`, { remindAt: "завтра" })).body.remindAt, "2026-10-14");
  assert.equal((await damir("PATCH", `/leads/${lead.id}`, { remindAt: "" })).body.remindAt, "");
});

test("backup goes to the admin's Telegram chat", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ method: url.split("/").pop(), chat: init.body.get("chat_id"), file: init.body.get("document")?.name });
    return new Response(JSON.stringify({ ok: true, result: {} }));
  };
  const handle = createHandler({ store: memoryStore(), env, fetch: fakeFetch });
  const admin = client(handle, { id: 1, first_name: "Пётр" });
  await admin("POST", "/leads", { telegram: "@x" });
  const res = await admin("POST", "/backup");
  assert.deepEqual(res.body, { ok: true, leads: 1 });
  assert.deepEqual(calls.map((c) => c.method), ["sendDocument", "sendDocument", "sendDocument"]);
  assert.equal(calls[0].chat, "1");
  assert.match(calls[0].file, /^crm-backup-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal((await client(handle, { id: 2, first_name: "M" })("POST", "/backup")).status, 403);
});

test("import keeps spreadsheet offers undated; backup re-import keeps real dates", async () => {
  const store = memoryStore();
  const handle = createHandler({ store, env });
  const admin = client(handle, { id: 1, first_name: "Пётр" });
  await admin("POST", "/import", { leads: [
    { telegram: "@old", offers: { alfa: { status: "paid", amount: 11000 } } },
    { telegram: "@backup", offers: { vtb: { status: "paid", amount: 7000, changedAt: "2026-10-01T10:00:00.000Z" } } },
  ] });
  const leads = (await admin("GET", "/state")).body.leads;
  assert.equal(leads.find((l) => l.telegram === "@old").offers.alfa.changedAt, undefined);
  assert.equal(leads.find((l) => l.telegram === "@backup").offers.vtb.changedAt, "2026-10-01T10:00:00.000Z");

  // лид из старого импорта: дата = момент создания → убирается при чтении
  const t = "2026-10-11T19:30:00.000Z";
  await store.setJSON("leads/00000000-0000-0000-0000-000000000001", { id: "00000000-0000-0000-0000-000000000001", telegram: "@legacy", stage: "offers", ownerId: 1, createdAt: t, updatedAt: t, offers: { alfa: { status: "paid", amount: 1, changedAt: "2026-10-11T19:30:00.120Z" } } });
  const legacy = (await admin("GET", "/state")).body.leads.find((l) => l.telegram === "@legacy");
  assert.equal(legacy.offers.alfa.changedAt, undefined);
});

test("quick entry: add costs and payouts in parts, offer due date, phone", async () => {
  const handle = createHandler({ store: memoryStore(), env });
  const damir = client(handle, { id: 1, first_name: "Дамир" });
  const lead = (await damir("POST", "/leads", { telegram: "@x", phone: "+7 900 000-00-00" })).body;
  assert.equal(lead.phone, "+7 900 000-00-00");

  await damir("PATCH", `/leads/${lead.id}`, { offers: { zaymer: { status: "applied" } } });
  await damir("PATCH", `/leads/${lead.id}`, { offers: { zaymer: { addCost: 50 } } });
  let l = (await damir("PATCH", `/leads/${lead.id}`, { offers: { zaymer: { addCost: "100", dueAt: "2026-10-16" } } })).body;
  assert.equal(l.offers.zaymer.cost, 20 + 50 + 100);
  assert.equal(l.offers.zaymer.dueAt, "2026-10-16");
  assert.equal(l.history[0].text, "Займер: затраты +100 ₽ (итого 170 ₽)");

  await damir("PATCH", `/leads/${lead.id}`, { addPayout: 1000 });
  l = (await damir("PATCH", `/leads/${lead.id}`, { addPayout: 500 })).body;
  assert.equal(l.payout, 1500);
  assert.equal((await damir("PATCH", `/leads/${lead.id}`, { offers: { zaymer: { dueAt: "потом" } } })).body.offers.zaymer.dueAt, "2026-10-16");
});

test("no duplicates when list() lags: import twice, bot and app use the index", async () => {
  const store = memoryStore();
  // list() «отстаёт»: не видит ничего нового, как KV в другом дата-центре
  const laggy = { ...store, list: async () => [] };
  const handle = createHandler({ store: laggy, env });
  const admin = client(handle, { id: 1, first_name: "Пётр" });
  const file = { leads: [{ telegram: "@Yannecci", offers: { alfa: { status: "paid", amount: 14000 } } }, { telegram: "@V1dar851" }] };
  assert.deepEqual((await admin("POST", "/import", file)).body, { created: 2, updated: 0 });
  assert.deepEqual((await admin("POST", "/import", file)).body, { created: 0, updated: 2 });
});

test("merge duplicates keeps the freshest offer statuses and history", async () => {
  const store = memoryStore();
  const handle = createHandler({ store, env });
  const admin = client(handle, { id: 1, first_name: "Пётр" });
  const t = "2026-10-12T10:00:00.000Z";
  const mk = (id, extra) => store.setJSON(`leads/${id}`, { id, telegram: "@Yannecci", fio: "", stage: "offers", ownerId: 1, createdAt: t, updatedAt: t, offers: {}, history: [], ...extra });
  await mk("00000000-0000-0000-0000-00000000000a", { fio: "Соловьёва", offers: { vtb: { status: "opened", amount: 7000, changedAt: "2026-10-12T11:00:00Z" } } });
  await mk("00000000-0000-0000-0000-00000000000b", { phone: "+79990000000", offers: { vtb: { status: "paid", amount: 7000, changedAt: "2026-10-12T12:00:00Z" }, ozon: { status: "done", amount: 11000 } }, history: [{ at: "2026-10-12T12:00:00Z", by: "Дамир", text: "ВТБ — РКО: Засчитано" }] });
  await mk("00000000-0000-0000-0000-00000000000c", {});
  await mk("00000000-0000-0000-0000-00000000000d", { telegram: "@other" });

  const r = (await admin("POST", "/dedupe")).body;
  assert.deepEqual(r, { groups: 1, removed: 2 });
  const leads = (await admin("GET", "/state")).body.leads;
  assert.equal(leads.length, 2);
  const y = leads.find((l) => l.telegram === "@Yannecci");
  assert.deepEqual([y.fio, y.phone, y.offers.vtb.status, y.offers.ozon.status], ["Соловьёва", "+79990000000", "paid", "done"]);
  assert.ok(y.history.some((h) => h.text === "ВТБ — РКО: Засчитано"));
  assert.match(y.history[0].text, /Объединены дубли \(3 шт\.\)/);
  assert.equal((await client(handle, { id: 2, first_name: "M" })("POST", "/dedupe")).status, 403);
});

test("custom offer from the lead card is appended to the catalog", async () => {
  const handle = createHandler({ store: memoryStore(), env });
  const damir = client(handle, { id: 2, first_name: "Слава" }); // менеджеру тоже можно
  const res = await damir("POST", "/offers", { name: "Совкомбанк — РКО", category: "rko", partner: "RKO Group", amount: 9000 });
  assert.equal(res.status, 201);
  assert.match(res.body.offer.id, /^o_/);
  assert.equal(res.body.offers.length, 53);
  const again = await damir("POST", "/offers", { name: "совкомбанк — ркО" });
  assert.equal(again.body.existed, true);
  const lead = (await damir("POST", "/leads", { telegram: "@x" })).body;
  const l = (await damir("PATCH", `/leads/${lead.id}`, { offers: { [res.body.offer.id]: { status: "applied" } } })).body;
  assert.deepEqual([l.offers[res.body.offer.id].status, l.offers[res.body.offer.id].amount], ["applied", 9000]);
});

test("lead tags and paid-out ledger", async () => {
  const handle = createHandler({ store: memoryStore(), env });
  const admin = client(handle, { id: 1, first_name: "Пётр" });
  const manager = client(handle, { id: 2, first_name: "Слава" });

  const lead = await admin("POST", "/leads", { telegram: "tagged", tags: ["mfo", "ip", "junk"] });
  assert.deepEqual(lead.body.tags, ["ip", "mfo"]);
  const upd = await admin("PATCH", `/leads/${lead.body.id}`, { tags: ["kk"] });
  assert.deepEqual(upd.body.tags, ["kk"]);
  assert.match(upd.body.history[0].text, /Теги: КК/);

  assert.equal((await admin("GET", "/state")).body.ledger.income, 0);
  assert.equal((await manager("PUT", "/ledger", { income: 1 })).status, 403);
  const l = await admin("PUT", "/ledger", { income: "464 817", partner: 50000, tax: -5 });
  assert.equal(l.body.income, 464817);
  assert.equal(l.body.partner, 50000);
  assert.equal(l.body.tax, 0);
  assert.equal(l.body.history.length, 1);
  assert.equal((await admin("GET", "/state")).body.ledger.partner, 50000);
  assert.equal((await manager("GET", "/state")).body.ledger, null);
});

test("offer template edit applies to new leads only", async () => {
  const handle = createHandler({ store: memoryStore(), env });
  const admin = client(handle, { id: 1, first_name: "Пётр" });
  const a = await admin("POST", "/leads", { telegram: "a1", offers: { vtb: { status: "applied" } } });
  const r = await admin("PATCH", "/offers/vtb", { amount: 4100, partner: "Leadgid", name: "" });
  assert.equal(r.body.offer.amount, 4100);
  assert.equal(r.body.offer.partner, "Leadgid");
  assert.ok(r.body.offer.name);
  assert.equal((await admin("PATCH", "/offers/nope", { amount: 1 })).status, 404);
  const b = await admin("POST", "/leads", { telegram: "b1", offers: { vtb: { status: "applied" } } });
  assert.equal(b.body.offers.vtb.amount, 4100);
  assert.notEqual(a.body.offers.vtb.amount, 4100);
});
