import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../src/api.mjs";
import { memoryStore } from "../src/store.mjs";
import { webhookSecret } from "../src/telegram.mjs";

const BOT = "123:abc";
async function setup() {
  const store = memoryStore();
  const env = { BOT_TOKEN: BOT, OWNER_IDS: "1", DEV_MODE: "1", APP_URL: "https://team.test/" };
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
  const secret = await webhookSecret(BOT);
  const say = (fromId, text, extra = {}) =>
    handle(new Request("https://team.test/api/tg", { method: "POST", headers: { "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify({ message: { from: { id: Number(fromId), first_name: "X" }, chat: { id: Number(fromId), type: "private" }, text, ...extra } }) }));
  await api(1, "POST", "/users", { id: "501", role: "mop", name: "Тема" });
  await api(1, "POST", "/users", { id: "502", role: "mop", name: "Дима" });
  await api(1, "POST", "/users", { id: "503", role: "lidorub", name: "Леха" });
  return { store, sent, api, say };
}

test("lidorub books a call in plain text, closer gets notified, clashes are refused", async () => {
  const { store, sent, say, api } = await setup();
  await say(503, "созвон завтра в 15 к Тёме @ivan_x Иван");
  const [c] = await store.all("client");
  assert.equal(c.telegram, "@ivan_x");
  assert.equal(c.name, "Иван");
  assert.equal(c.lidorubId, "503");
  assert.equal(c.calls[0].mopId, "501");
  assert.match(c.calls[0].at, /T12:00:00/); // 15:00 МСК
  const toTema = sent.find((m) => m.chat === "501");
  assert.match(toTema.text, /Новый созвон/);
  assert.match(sent.find((m) => m.chat === "503").text, /Записал нового клиента/);

  await say(503, "запиши Олега на созвон завтра в 15:20 к Теме");
  assert.match(sent.at(-1).text, /уже созвон в 15:00/);
  assert.equal((await store.all("client")).length, 1);

  await say(503, "созвон завтра в 15 @petr_y");
  assert.match(sent.at(-1).text, /К кому записать/);

  await say(503, "окна завтра у Темы");
  assert.match(sent.at(-1).text, /🔴 15:00[\s\S]*свободно: 10:00/);

  // лента: Тема видит событие про свой созвон
  const feed = (await api(501, "GET", "/state")).body.feed;
  assert.match(feed[0].text, /Новый созвон/);
});

test("forwarded message becomes a lead; links command lists payment links", async () => {
  const { store, sent, say } = await setup();
  await say(503, "хочу в обучение, сколько стоит?", { forward_origin: { type: "user", sender_user: { id: 77, username: "new_guy", first_name: "Вася" } } });
  const [c] = await store.all("client");
  assert.equal(c.telegram, "@new_guy");
  assert.equal(c.info, "хочу в обучение, сколько стоит?");
  await say(501, "ссылки 100");
  assert.match(sent.at(-1).text, /18,9%[\s\S]*Для 21\+/);
  assert.doesNotMatch(sent.at(-1).text, /80к/);
});

test("sale via pay link prefills net and notifies the bosses", async () => {
  const { store, sent, api } = await setup();
  const id = (await api(503, "POST", "/clients", { name: "Глеб" })).body.client.id;
  await api(503, "POST", `/clients/${id}/action`, { type: "call", at: new Date(Date.now() - 3600_000).toISOString(), mopId: "501" });
  await api(501, "POST", `/clients/${id}/action`, { type: "held" });
  await api(501, "POST", `/clients/${id}/action`, { type: "paylink", linkId: "tb-100-31" });
  await api(501, "POST", `/clients/${id}/action`, { type: "status", status: "paid", sum: 100000 });
  const [p] = await store.all("payment");
  assert.equal(p.net, 69000);
  assert.equal(p.verified, false);
  assert.match(sent.find((m) => m.chat === "1" && /Продажа/.test(m.text)).text, /100\s000\s₽[\s\S]*Тема · лид от Леха/);
  assert.ok(!sent.some((m) => m.chat === "501" && /Продажа/.test(m.text))); // автору не пишем
  await api(501, "POST", `/clients/${id}/action`, { type: "comment", text: "клиент просит рассрочку на 12 мес" });
  assert.ok(sent.some((m) => m.chat === "503" && /рассрочку/.test(m.text)));
});
