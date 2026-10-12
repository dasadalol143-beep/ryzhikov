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
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
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

test("owner's exact phrase: 'поставил лида Теме на 19:00 … @rusbuu' books and notifies Tema with the text", async () => {
  const { store, sent, say } = await setup();
  await say(1, "На завтра поставил Лида Теме на 19:00 напомни прямо сейчас @rusbuu");
  const [c] = await store.all("client");
  assert.equal(c.telegram, "@rusbuu");
  assert.equal(c.calls[0].mopId, "501");
  assert.match(c.calls[0].at, /T16:00:00/); // 19:00 МСК
  const toTema = sent.find((m) => m.chat === "501");
  assert.match(toTema.text, /Новый созвон[\s\S]*19:00[\s\S]*напомни прямо сейчас/);
  assert.match(sent.find((m) => m.chat === "1").text, /Записал нового клиента[\s\S]*Тема получил уведомление/);
  // имя собственника из Telegram, а не «Собственник»
  assert.equal((await store.get("user", "1")).name, "X");
});

test("relay: 'Теме: …' goes to Tema, his reply comes back to the author; 'всем:' broadcasts", async () => {
  const { sent, say } = await setup();
  await say(1, "Теме: перезвони Глебу до обеда");
  const toTema = sent.find((m) => m.chat === "501");
  assert.match(toTema.text, /пишет тебе[\s\S]*перезвони Глебу до обеда/);
  assert.match(sent.at(-1).text, /Передал Тема/);
  const idx = sent.indexOf(toTema) + 1; // message_id, который вернул фейковый Telegram
  await say(501, "ок, наберу в 12", { reply_to_message: { message_id: idx } });
  assert.match(sent.find((m) => m.chat === "1" && /Ответ от/.test(m.text)).text, /Ответ от Тема[\s\S]*наберу в 12/);
  await say(1, "всем: планёрка в 11");
  for (const id of ["501", "502", "503"]) assert.ok(sent.some((m) => m.chat === id && /планёрка в 11/.test(m.text)));
});

test("closer pastes the CRM report block in the bot: saved to the card, status by button; export sends files", async () => {
  const { store, sent, say, api } = await setup();
  const block = `@Germanvtg Герман
Потребность/запрос клиента: открутить себя, партнерки, как находить лидов
Род деятельности: работает в стоматологии, учится
О чем глобально мечтает (главная боль): машину хочет, свободно себя чувствовать
Провел презентацию по тарифам: Да
Основное возражение: боялся рассрочки, принцип не брать в долг
Следующий шаг, договоренности: 9 октября подписание 100к ренессанс
Предложил оплатить: Да`;
  await say(501, block);
  const [c] = await store.all("client");
  assert.equal(c.telegram, "@Germanvtg");
  const call = c.calls[0];
  assert.equal(call.outcome, "held");
  assert.equal(call.mopId, "501");
  assert.match(call.report.dream, /машину хочет/);
  assert.equal(call.report.presented, true);
  const kb = JSON.parse(sent.at(-1).markup).inline_keyboard;
  assert.equal(kb[0][0].callback_data, `rs:${c.id}:paid`);
  // нажал «Оплатил» — сумма 100к взята из текста отчёта, оплата ушла в ведомость
  const { createHandler } = await import("../src/api.mjs");
  const { webhookSecret } = await import("../src/telegram.mjs");
  void createHandler;
  const secret = await webhookSecret("123:abc");
  const handle = (await import("../src/api.mjs")).createHandler({ store, env: { BOT_TOKEN: "123:abc", OWNER_IDS: "1", APP_URL: "https://team.test/" }, fetch: async () => new Response(JSON.stringify({ ok: true, result: { message_id: 9 } })) });
  await handle(new Request("https://team.test/api/tg", { method: "POST", headers: { "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify({ callback_query: { id: "q", from: { id: 501 }, data: `rs:${c.id}:paid`, message: { message_id: 5, chat: { id: 501 }, text: "📝 Отчёт сохранён\nСледующий шаг: подписание 100к ренессанс" } } }) }));
  assert.equal((await store.get("client", c.id)).status, "paid");
  assert.equal((await store.all("payment"))[0].tariff, 100000);

  const before = sent.length;
  await say(1, "/export");
  const docs = sent.slice(before).filter((m) => m.method === "sendDocument").length;
  assert.equal(docs, 3); // база, ведомость, бэкап
  await say(501, "/export");
  assert.equal(sent.slice(before).filter((m) => m.method === "sendDocument" && m.chat === "501").length, 1); // менеджеру — без денег
  void api;
});

test("CRM sheet rows import: merge by nick, legacy calls don't inflate RnP", async () => {
  const { store, api } = await setup();
  const { crmRowsToClients, parseCsv } = await import("../public/lib/report.js");
  const { rnp } = await import("../public/lib/stats.js");
  await api(1, "POST", "/clients", { name: "Ромчик", telegram: "poopkek" });
  const csv = `Дата диагностики,Имя,Ник в телеграм,Статус,Диагностика проведена,ИТОГ ДИАГНОСТИКИ,ДАЛЬНЕЙШИЕ ШАГИ
06.10.26,Ромчик,@poopkek,Оплатил,TRUE,"Потребность/запрос клиента: разобраться в нише
Предложил оплатить: Да","снимаем самозапрет, рассрок на 100к"
07.10.26,Дима,@Tanjiro2002,Игнор,TRUE,,нет договорённостей`;
  const rows = crmRowsToClients(parseCsv(csv), { mopId: "502" });
  const r = (await api(1, "POST", "/import", { clients: rows })).body;
  assert.deepEqual([r.clients, r.merged], [1, 1]);
  const all = await store.all("client");
  assert.equal(all.length, 2);
  const rom = all.find((c) => c.telegram === "@poopkek");
  assert.equal(rom.status, "paid");
  assert.equal(rom.nextSteps, "снимаем самозапрет, рассрок на 100к");
  assert.match(rom.calls[0].report.need, /разобраться/);
  assert.equal(rnp(all, {}).total.held, 0);
  // повторный импорт не задваивает
  await api(1, "POST", "/import", { clients: rows });
  assert.equal((await store.all("client")).length, 2);
  assert.equal((await store.all("client")).find((c) => c.telegram === "@poopkek").calls.length, 1);
});

test("history links itself to a teammate added after the import", async () => {
  const { store, api } = await setup(); // Тема 501, Дима 502 уже есть
  const { crmRowsToClients, parseCsv } = await import("../public/lib/report.js");
  const { rnp } = await import("../public/lib/stats.js");
  // импорт, когда Матвея (нового менеджера) ещё нет в команде
  const rows = crmRowsToClients(parseCsv(`Дата диагностики,Имя,Ник в телеграм,Статус,Диагностика проведена,ИТОГ ДИАГНОСТИКИ,ДАЛЬНЕЙШИЕ ШАГИ
06.10.26,Ромчик,@poopkek,Оплатил,TRUE,,ОПЛАТИЛ`), { mopAlias: "Матвей" });
  await api(1, "POST", "/import", {
    clients: rows,
    legacy: { rnp: { "Матвей": { "2026-10-06": { leads: 1, scheduled: 1, held: 1, sales: 1, salesSum: 100000 } } } },
    payments: [{ id: "p1", date: "2026-10-06", tariff: 100000, net: 69000, verified: true, mopAlias: "Матвей" }],
  });
  let st = (await api(1, "GET", "/state")).body;
  assert.equal(st.clients[0].mopId, null);
  // добавили Матвея — история сама переехала на него
  await api(1, "POST", "/users", { id: "520", role: "mop", name: "Matvey" });
  st = (await api(1, "GET", "/state")).body;
  assert.equal(st.settings.aliases["Матвей"], "520");
  assert.equal(st.clients[0].mopId, "520");
  assert.equal(st.clients[0].calls[0].mopId, "520");
  assert.equal((await store.get("payment", "p1")).mopId, "520");
  const r = rnp(st.clients, st.legacy, { aliases: st.settings.aliases });
  assert.equal(r.byPerson["520"].sales, 1);
  // и у самого Матвея на экране — его клиенты и продажи
  const mine = (await api(520, "GET", "/state")).body;
  assert.equal(mine.clients.filter((c) => c.mopId === "520").length, 1);
});
