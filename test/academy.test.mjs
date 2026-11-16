import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createAcademyHandler, webhookSecretFor } from "../lib/academy.mjs";

const TOKEN = "999:ACADEMY_TOKEN";
const env = { ACADEMY_BOT_TOKEN: TOKEN, ACADEMY_MENTOR_IDS: "1", BOT_TOKEN: "123:MAIN" };

function sign(user, token = TOKEN) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(dcs).digest("hex"));
  return params.toString();
}

function memoryStore(init = []) {
  const data = new Map(init);
  return {
    data,
    getJSON: async (k) => (data.has(k) ? structuredClone(data.get(k)) : null),
    setJSON: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (k) => void data.delete(k),
    list: async (prefix) => [...data.keys()].filter((k) => k.startsWith(prefix)),
  };
}

const fakeFetch = async (url) => new Response(JSON.stringify({ ok: true, result: String(url).includes("getMe") ? { username: "academy_bot" } : true }));

function setup() {
  const store = memoryStore();
  const mainStore = memoryStore([["offers", [{ id: "vtb", category: "rko", name: "ВТБ — РКО", partner: "RKO Group", amount: 7777, cost: 0, active: true, note: "" }]], ["leads/x", { id: "x", telegram: "@secret" }]]);
  const handle = createAcademyHandler({ store, mainStore, env, fetch: fakeFetch });
  const as = (user, token) => async (method, path, body) => {
    const res = await handle(new Request(`https://crm.test/academy/api${path}`, { method, headers: { authorization: `tma ${sign(user, token)}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
    return { status: res.status, body: await res.json() };
  };
  return { store, mainStore, as };
}

test("academy: access only by code, workspaces isolated from each other and from our CRM", async () => {
  const { store, mainStore, as } = setup();
  const mentor = as({ id: 1, first_name: "Пётр" });
  const vasya = as({ id: 10, first_name: "Вася" });
  const kolya = as({ id: 11, first_name: "Коля" });

  assert.equal((await vasya("GET", "/state")).body.error, "not_member");
  assert.equal((await as({ id: 10 }, "123:MAIN")("GET", "/state")).status, 401, "токен нашего бота не пускает в академию");
  assert.equal((await vasya("GET", "/mentor")).status, 403);

  const cr = await mentor("POST", "/mentor/codes", { note: "Вася" });
  assert.equal(cr.status, 201, JSON.stringify(cr.body));
  const code = cr.body.code;
  assert.match(code, /^[A-Z2-9]{6}$/);
  assert.equal((await vasya("POST", "/join", { code: "nope" })).body.error, "bad_code");
  assert.equal((await vasya("POST", "/join", { code: code.toLowerCase() })).status, 200);
  assert.equal((await kolya("POST", "/join", { code })).body.error, "code_used");

  const st = await vasya("GET", "/state");
  assert.equal(st.status, 200);
  assert.equal(st.body.me.academy, true);
  assert.equal(st.body.me.mentor, false);
  assert.equal(st.body.settings.taxRate, 6);
  assert.equal(st.body.settings.partnerShare, 0);
  assert.equal(st.body.offers.find((o) => o.id === "vtb").amount, 7777, "ставки — наши живые");
  assert.equal(st.body.leads.length, 0, "наших лидов не видно");

  const lead = await vasya("POST", "/leads", { telegram: "lead1", offers: { vtb: { status: "paid" } } });
  assert.equal(lead.status, 201);
  assert.equal((await mentor("GET", "/state")).body.leads.length, 0, "у наставника свой кабинет");
  assert.ok(![...mainStore.data.keys()].some((k) => k.includes(lead.body.id)), "в нашу базу ничего не пишется");
  assert.ok(store.data.has(`u/10/leads/${lead.body.id}`));
  assert.equal((await vasya("GET", "/access")).status, 403);

  const m = await mentor("GET", "/mentor");
  assert.equal(m.body.students.length, 1);
  assert.equal(m.body.students[0].leads, 1);
  assert.equal(m.body.students[0].active, true);
  assert.equal(m.body.students[0].activeLeads, 1);
  assert.equal(m.body.students[0].income, 7777);
  assert.equal(m.body.bot, "academy_bot");
  assert.equal(m.body.codes.length, 0);

  assert.equal((await mentor("PATCH", "/mentor/students/10", { active: false })).body.active, false);
  assert.equal((await vasya("GET", "/state")).body.error, "disabled");
  await mentor("PATCH", "/mentor/students/10", { active: true });
  assert.equal((await vasya("GET", "/state")).body.leads.length, 1, "лиды вернулись");
});

test("academy bot: /start CODE from the invite link gives access", async () => {
  const sent = [];
  const store = memoryStore();
  const fetchSpy = async (url, init) => {
    if (String(url).includes("sendMessage")) sent.push(Object.fromEntries(init.body));
    return new Response(JSON.stringify({ ok: true, result: true }));
  };
  const handle = createAcademyHandler({ store, mainStore: memoryStore(), env, fetch: fetchSpy });
  const mentor = async (method, path, body) => (await handle(new Request(`https://crm.test/academy/api${path}`, { method, headers: { authorization: `tma ${sign({ id: 1 })}` }, body: JSON.stringify(body) }))).json();
  const { code } = await mentor("POST", "/mentor/codes", {});
  const update = (text) => new Request("https://crm.test/academy/api/tg", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "" }, body: JSON.stringify({ message: { from: { id: 20, first_name: "Гоша" }, chat: { id: 20, type: "private" }, text } }) });
  assert.equal((await handle(update(`/start ${code}`))).status, 403, "без секрета Telegram не принимаем");
  const ok = new Request("https://crm.test/academy/api/tg", { method: "POST", headers: { "x-telegram-bot-api-secret-token": await webhookSecretFor(TOKEN) }, body: JSON.stringify({ message: { from: { id: 20, first_name: "Гоша" }, chat: { id: 20, type: "private" }, text: `/start ${code}` } }) });
  assert.equal((await handle(ok)).status, 200);
  assert.equal((await store.getJSON("members/20")).active, true);
  assert.match(sent[0].text, /RYZHIKOV ACADEMY/);
  assert.ok(sent[0].reply_markup.includes("/academy/"));
});
