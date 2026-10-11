import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../src/api.mjs";
import { memoryStore } from "../src/store.mjs";
import { runReminders, runMorning } from "../src/bot.mjs";
import { telegram } from "../src/telegram.mjs";
import { payrollRow, monthSummary } from "../public/lib/model.js";
import { rnp, lidorubStats } from "../public/lib/stats.js";

// Ведомость: строка «06.08 · 89 999 · чистая 62 099» из листа «Тема».
test("payroll row matches the spreadsheet", () => {
  const r = payrollRow({ tariff: 89999, net: 62099 });
  assert.equal(r.commission, 27900);
  assert.equal(Math.round(r.tax), 4347);
  assert.equal(Math.round(r.mop), 5775);
  assert.equal(Math.round(r.rop), 1733);
  assert.equal(Math.round(r.lidorub), 1155);
});

// Лист «Сентябрь (закрыт)»: чистая ОП 993 309 → остаётся 785 210 (после налога, РОПа, лидоруба и МОПов).
test("month summary matches the closed September sheet", () => {
  const nets = [48300, 48300, 69000, 62100, 62100, 34500, 67000, 48000, 69000, 58400, 48300, 57000, 67339, 69000, 67970, 48000, 69000];
  const payments = nets.map((net, i) => ({ id: String(i), date: "2026-09-10", tariff: net, net, verified: true, mopId: i < 15 ? "tema" : "dima" }));
  const s = monthSummary(payments, "2026-09");
  assert.equal(s.totals.net, 993309);
  assert.equal(Math.round(s.totals.tax * 10) / 10, 69531.6);
  assert.equal(Math.round(s.totals.rop * 10) / 10, 27713.3);
  assert.ok(Math.abs(s.totals.lidorub - 18475.5) < 0.2);
  assert.equal(Math.round(s.totals.left), 785211);
});

const BOT = "123:abc";
function setup() {
  const store = memoryStore();
  const env = { BOT_TOKEN: BOT, OWNER_IDS: "1", DEV_MODE: "1" };
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ method: url.split("/").pop(), chat: init.body.get("chat_id"), text: init.body.get("text"), markup: init.body.get("reply_markup") });
    return new Response(JSON.stringify({ ok: true, result: {} }));
  };
  const handle = createHandler({ store, env, fetch: fetchImpl });
  const api = async (userId, method, path, body) => {
    env.DEV_USER = String(userId);
    const res = await handle(new Request(`https://team.test/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
    return { status: res.status, body: await res.json() };
  };
  return { store, env, sent, api, tg: telegram(BOT, fetchImpl) };
}

test("roles: payroll hidden from managers, team managed by owner", async () => {
  const { api } = setup();
  assert.equal((await api(1, "GET", "/state")).body.me.role, "owner");
  const stranger = await api(50, "GET", "/state");
  assert.equal(stranger.status, 403);
  assert.equal((await api(1, "GET", "/state")).body.pending[0].id, "50");
  await api(1, "POST", "/users", { id: "50", role: "mop", name: "Тема" });
  await api(1, "POST", "/users", { id: "60", role: "rop", name: "Андрей" });
  const mop = await api(50, "GET", "/state");
  assert.equal(mop.body.me.role, "mop");
  assert.equal(mop.body.payments, null);
  assert.equal((await api(50, "POST", "/payments", { tariff: 1 })).status, 403);
  assert.deepEqual((await api(60, "GET", "/state")).body.payments, []);
  // РОП не может назначить РОПа
  assert.equal((await api(60, "POST", "/users", { id: "70", role: "rop" })).status, 403);
});

test("full funnel: lidorub books a call, mop holds it, sale lands in payroll and RnP", async () => {
  const { api, store } = setup();
  await api(1, "POST", "/users", { id: "50", role: "mop", name: "Тема" });
  await api(1, "POST", "/users", { id: "70", role: "lidorub", name: "Леха" });
  const at = new Date(Date.now() + 3 * 3600_000).toISOString();
  const created = await api(70, "POST", "/clients", { name: "Иван", telegram: "ivan_x", source: "Новая заявка" });
  assert.equal(created.body.client.lidorubId, "70");
  assert.equal((await api(70, "POST", "/clients", { telegram: "@IVAN_X" })).status, 409);
  const id = created.body.client.id;
  await api(70, "POST", `/clients/${id}/action`, { type: "lm" });
  let c = (await api(70, "POST", `/clients/${id}/action`, { type: "call", at, mopId: "50" })).body.client;
  assert.equal(c.status, "in_work");
  assert.equal(c.calls.length, 1);

  c = (await api(50, "POST", `/clients/${id}/action`, { type: "held" })).body.client;
  assert.equal(c.calls[0].outcome, "held");
  const r = await api(50, "POST", `/clients/${id}/action`, {
    type: "report",
    status: "paid",
    sum: 100000,
    report: { need: "стабильный доход", occupation: "грузчик", dream: "машина", objection: "дорого", nextStep: "старт в пн", presented: true, offeredPay: true },
  });
  assert.equal(r.body.client.status, "paid");
  assert.equal(r.body.payments, null); // МОП ведомость не видит
  const pays = await store.all("payment");
  assert.equal(pays.length, 1);
  assert.equal(pays[0].tariff, 100000);
  assert.equal(pays[0].verified, false);

  const st = (await api(1, "GET", "/state")).body;
  const s = rnp(st.clients, st.legacy).total;
  assert.deepEqual([s.leads, s.scheduled, s.held, s.sales, s.salesSum], [1, 1, 1, 1, 100000]);
  const lr = lidorubStats(st.clients, st.legacy).total;
  assert.deepEqual([lr.received, lr.lm, lr.scheduled], [1, 1, 1]);

  // РОП вносит чистую и верифицирует
  const pid = pays[0].id;
  assert.equal((await api(1, "PATCH", `/payments/${pid}`, { verified: true })).body.payment.verified, false); // без чистой нельзя
  const p = (await api(1, "PATCH", `/payments/${pid}`, { net: 69000, verified: true })).body.payment;
  assert.equal(p.verified, true);
});

test("no-shows count toward NDZ, three silent touches turn into Ignore", async () => {
  const { api } = setup();
  await api(1, "POST", "/users", { id: "50", role: "mop", name: "Дима" });
  const id = (await api(1, "POST", "/clients", { name: "Пётр" })).body.client.id;
  const at = new Date(Date.now() - 30 * 60_000).toISOString();
  await api(1, "POST", `/clients/${id}/action`, { type: "call", at, mopId: "50" });
  let c = (await api(50, "POST", `/clients/${id}/action`, { type: "ndz" })).body.client;
  assert.equal(c.status, "ndz1");
  await api(1, "POST", `/clients/${id}/action`, { type: "call", at, mopId: "50" });
  c = (await api(50, "POST", `/clients/${id}/action`, { type: "ndz" })).body.client;
  assert.equal(c.status, "ndz2");
  for (let i = 0; i < 3; i++) c = (await api(50, "POST", `/clients/${id}/action`, { type: "touch" })).body.client;
  assert.equal(c.status, "ignore");
  const s = rnp([c], {}).total;
  assert.deepEqual([s.leads, s.scheduled, s.held], [1, 2, 0]);
});

test("reminders: one per stage, held/ndz buttons after the call", async () => {
  const { api, store, sent, tg, env } = setup();
  await api(1, "POST", "/users", { id: "50", role: "mop", name: "Тема" });
  const at = Date.now() + 2 * 3600_000;
  const id = (await api(1, "POST", "/clients", { name: "Глеб", telegram: "gleb", chatUrl: "https://t.me/+abc", call: { at: new Date(at).toISOString(), mopId: "50" } })).body.client.id;
  const run = (now) => runReminders({ store, env, tg, appUrl: "https://team.test/", now });
  assert.deepEqual(await run(at - 3 * 3600_000), []);
  assert.deepEqual(await run(at - 119 * 60_000), [`h2:${id}`]);
  assert.deepEqual(await run(at - 118 * 60_000), []);
  assert.deepEqual(await run(at - 59 * 60_000), [`h1:${id}`]);
  assert.match(sent.at(-1).text, /Через час созвон/);
  assert.equal(sent.at(-1).chat, "50");
  assert.deepEqual(await run(at - 14 * 60_000), [`m15:${id}`]);
  assert.deepEqual(await run(at + 16 * 60_000), [`after:${id}`]);
  const kb = JSON.parse(sent.at(-1).markup).inline_keyboard;
  assert.equal(kb[0][0].callback_data, `held:${id}:${(await store.get("client", id)).calls[0].id}`);
  assert.deepEqual(await run(at + 17 * 60_000), []);
});

test("late booking skips stale stages", async () => {
  const { api, store, tg, env } = setup();
  await api(1, "POST", "/users", { id: "50", role: "mop", name: "Тема" });
  const at = Date.now() + 20 * 60_000;
  const id = (await api(1, "POST", "/clients", { name: "Срочный", call: { at: new Date(at).toISOString(), mopId: "50" } })).body.client.id;
  assert.deepEqual(await runReminders({ store, env, tg, appUrl: "/", now: Date.now() }), [`h1:${id}`]);
  assert.deepEqual(await runReminders({ store, env, tg, appUrl: "/", now: Date.now() }), []);
});

test("morning digest goes to everyone with a role", async () => {
  const { api, store, tg, env, sent } = setup();
  await api(1, "POST", "/users", { id: "50", role: "mop", name: "Тема" });
  const res = await runMorning({ store, env, tg, appUrl: "/" });
  assert.deepEqual(res.map((r) => r.id).sort(), ["1", "50"]);
  assert.match(sent.find((s) => s.chat === "1").text, /Вчера/);
});
