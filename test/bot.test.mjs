import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createHandler } from "../lib/core.mjs";
import { parseLeadMessage } from "../lib/bot.mjs";
import { webhookSecret } from "../lib/telegram.mjs";
import { networkReport } from "../public/insights.js";
import { DEFAULT_OFFERS } from "../lib/offers.mjs";

const BOT_TOKEN = "123456:TEST_TOKEN";
const env = { BOT_TOKEN, ADMIN_IDS: "1", MANAGER_IDS: "2", APP_URL: "https://crm.test/" };

test("parse: forward, hidden forward, contact, free text", () => {
  assert.deepEqual(parseLeadMessage({ text: "Привет, хочу в РКО", forward_origin: { type: "user", sender_user: { id: 55, username: "ivan_rko", first_name: "Иван", last_name: "Петров" } } }),
    { kind: "forward", telegram: "@ivan_rko", fio: "Иван Петров", tgId: 55, note: "Переслано: «Привет, хочу в РКО»" });
  assert.equal(parseLeadMessage({ forward_origin: { type: "hidden_user", sender_user_name: "Олег" } }).fio, "Олег");
  assert.deepEqual(parseLeadMessage({ contact: { phone_number: "79001234567", first_name: "Маша", user_id: 77 } }),
    { kind: "contact", telegram: "", fio: "Маша", phone: "+79001234567", tgId: 77 });
  const t = parseLeadMessage({ text: "@Diman0004 Давыдов Дмитрий 8 900 123-45-67" });
  assert.deepEqual([t.telegram, t.fio, t.phone], ["@Diman0004", "Давыдов Дмитрий", "+79001234567"]);
  assert.equal(parseLeadMessage({ text: "https://t.me/someone_here" }).telegram, "@someone_here");
  assert.equal(parseLeadMessage({ text: "что-то непонятное 123" }), null);
  assert.equal(parseLeadMessage({ text: "/start" }), null);
});

function setup() {
  const data = new Map([["bot_webhook", { url: "https://crm.test/api/tg" }]]);
  const store = {
    getJSON: async (k) => (data.has(k) ? structuredClone(data.get(k)) : null),
    setJSON: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (k) => void data.delete(k),
    list: async (p) => [...data.keys()].filter((k) => k.startsWith(p)),
  };
  const sent = [];
  const fakeFetch = async (url, init) => {
    sent.push({ method: url.split("/").pop(), chat: init.body.get("chat_id"), text: init.body.get("text"), markup: init.body.get("reply_markup") });
    return new Response(JSON.stringify({ ok: true, result: {} }));
  };
  const handle = createHandler({ store, env, fetch: fakeFetch });
  const hook = async (message, secret) =>
    handle(new Request("https://crm.test/api/tg", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": secret ?? (await webhookSecret(BOT_TOKEN)), "content-type": "application/json" },
      body: JSON.stringify({ update_id: 1, message: { chat: { id: message.from.id, type: "private" }, ...message } }),
    }));
  const sign = (user) => {
    const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
    const dcs = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
    p.set("hash", createHmac("sha256", createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest()).update(dcs).digest("hex"));
    return p.toString();
  };
  const api = async (user, method, path, body) => {
    const r = await handle(new Request(`https://crm.test/api${path}`, { method, headers: { authorization: `tma ${sign(user)}` }, body: body && JSON.stringify(body) }));
    return { status: r.status, body: await r.json() };
  };
  return { hook, sent, api, data };
}

test("bot: forwarded message creates a lead, duplicates are caught, strangers refused", async () => {
  const { hook, sent, api } = setup();
  const damir = { id: 1, first_name: "Дамир" };

  assert.equal((await hook({ from: damir, text: "hi" }, "wrong")).status, 403);

  await hook({ from: damir, text: "Хочу заработать", forward_origin: { type: "user", sender_user: { id: 55, username: "ivan_rko", first_name: "Иван" } } });
  assert.match(sent.at(-1).text, /✅ Лид создан: <b>@ivan_rko<\/b>/);
  const leadId = JSON.parse(sent.at(-1).markup).inline_keyboard[0][0].web_app.url.split("lead=")[1];

  const leads = (await api(damir, "GET", "/state")).body.leads;
  assert.equal(leads.length, 1);
  assert.deepEqual([leads[0].id, leads[0].telegram, leads[0].fio, leads[0].source, leads[0].tgId], [leadId, "@ivan_rko", "Иван", "Бот", 55]);
  assert.equal(leads[0].history[0].text, "Лид создан из бота");

  await hook({ from: damir, text: "@IVAN_RKO" });
  assert.match(sent.at(-1).text, /уже есть/);
  await hook({ from: damir, contact: { phone_number: "+79990001122", first_name: "Маша", user_id: 77 } });
  await hook({ from: damir, text: "8 999 000 11 22" });
  assert.match(sent.at(-1).text, /уже есть: <b>Маша<\/b>/);

  await hook({ from: { id: 42, first_name: "Чужой" }, text: "@someone" });
  assert.match(sent.at(-1).text, /Доступа у тебя пока нет/);
  await hook({ from: damir, text: "/start" });
  assert.match(sent.at(-1).text, /Как завести лида/);
  assert.equal((await api(damir, "GET", "/state")).body.leads.length, 2);

  // менеджер — лид записывается на него
  await hook({ from: { id: 2, first_name: "Слава" }, text: "@new_one" });
  const mine = (await api({ id: 2, first_name: "Слава" }, "GET", "/state")).body.leads;
  assert.deepEqual(mine.map((l) => l.telegram), ["@new_one"]);
});

test("payouts: mark offers received, see network debt, undo", async () => {
  const { api } = setup();
  const admin = { id: 1, first_name: "Пётр" };
  const a = (await api(admin, "POST", "/leads", { telegram: "@a" })).body;
  const b = (await api(admin, "POST", "/leads", { telegram: "@b" })).body;
  await api(admin, "PATCH", `/leads/${a.id}`, { offers: { ozon: { status: "paid" }, vtb: { status: "paid" } } });
  await api(admin, "PATCH", `/leads/${b.id}`, { offers: { ingo: { status: "paid" }, loko: { status: "done" }, zaymer: { status: "paid", network: "Leadgid" } } });

  let st = (await api(admin, "GET", "/state")).body;
  let rko = networkReport(st.leads, st.offers, st.payouts).find((n) => n.network === "RKO Group");
  assert.deepEqual([rko.paid, rko.received, rko.debt, rko.unpaid.length], [31000, 0, 31000, 2]);
  assert.equal(networkReport(st.leads, st.offers).find((n) => n.network === "Leadgid").paid, 3300);
  assert.equal(networkReport(st.leads, st.offers).find((n) => n.network === "Бизнес Система").waiting, 8500);

  const p = (await api(admin, "POST", "/payouts", { network: "RKO Group", amount: 11000, date: "2026-10-10", items: [{ leadId: a.id, offerId: "ozon" }, { leadId: a.id, offerId: "vtb" }] })).body;
  assert.deepEqual([p.items.length, p.covered], [1, 11000]); // ВТБ — другая сеть, в платёж RKO Group не попадает
  st = (await api(admin, "GET", "/state")).body;
  rko = networkReport(st.leads, st.offers, st.payouts).find((n) => n.network === "RKO Group");
  assert.deepEqual([rko.received, rko.debt, rko.payouts], [11000, 20000, 11000]);
  assert.equal(st.payouts.length, 1);

  assert.equal((await api({ id: 2, first_name: "M" }, "POST", "/payouts", { network: "x" })).status, 403);
  await api(admin, "DELETE", `/payouts/${p.id}`);
  st = (await api(admin, "GET", "/state")).body;
  assert.equal(networkReport(st.leads, st.offers, st.payouts).find((n) => n.network === "RKO Group").debt, 31000);
  assert.equal(st.payouts.length, 0);
});
