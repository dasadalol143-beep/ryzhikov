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
  assert.match(sent.find((m) => m.chat === "503").text, /Внёс в CRM: 1 созвон[\s\S]*🆕[\s\S]*Уведомил: Тема/);

  await say(503, "запиши Олега на созвон завтра в 15:20 к Теме");
  assert.match(sent.at(-1).text, /Ничего не внёс[\s\S]*уже 15:00/);
  assert.equal((await store.all("client")).length, 1);

  await say(503, "созвон завтра в 15 @petr_y");
  assert.match(sent.at(-1).text, /к кому\?/);

  await say(503, "окна завтра у Темы");
  assert.match(sent.at(-1).text, /🔴 15:00[\s\S]*не занято: 10:00/);

  // лидоруб открывает Теме окна — свободные слоты считаются от них, Тема получает сообщение
  await say(503, "окна Тёме завтра с 14 до 18");
  assert.match(sent.find((m) => m.chat === "501" && /открыл тебе окна/.test(m.text)).text, /14:00–18:00/);
  assert.match(sent.filter((m) => m.chat === "503").at(-1).text, /Окна открыты[\s\S]*окно 14:00–18:00[\s\S]*🔴 15:00[\s\S]*свободно: 14:00, 16:00, 17:00/);
  const st = (await api(503, "GET", "/state")).body;
  assert.equal(st.windows.length, 1);
  await say(503, "созвон завтра в 19 к Тёме @late_one Олег");
  assert.match(sent.filter((m) => m.chat === "503").at(-1).text, /вне окна \(14:00–18:00\)/);

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
  assert.match(sent.find((m) => m.chat === "1").text, /Внёс в CRM[\s\S]*Уведомил: Тема/);
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

test("several calls in one message: each booked, each closer notified, clash skipped, cancel all", async () => {
  const { store, sent, say } = await setup();
  await say(503, "Внеси в CRM на завтра: Тема, два звонка: один с Антоном в 18:00, второй с Мишей @misha_k в 19:00. Диме на 20:00 Олег +79001234567");
  const all = await store.all("client");
  assert.equal(all.length, 3);
  const by = Object.fromEntries(all.map((c) => [c.name || c.telegram, c.calls[0]]));
  assert.equal(by["Антон"].mopId, "501");
  assert.match(by["Антон"].at, /T15:00:00/); // 18:00 МСК
  assert.equal(by["Миша"].mopId, "501");
  assert.equal(all.find((c) => c.telegram === "@misha_k").name, "Миша");
  assert.equal(by["Олег"].mopId, "502");
  assert.equal(all.find((c) => c.name === "Олег").phone, "+79001234567");
  assert.equal(sent.filter((m) => m.chat === "501" && /Новый созвон/.test(m.text)).length, 2);
  assert.equal(sent.filter((m) => m.chat === "502" && /Новый созвон/.test(m.text)).length, 1);
  const summary = sent.find((m) => m.chat === "503" && /Внёс в CRM/.test(m.text));
  assert.match(summary.text, /3 созвона/);

  // пересечение у Темы в 18:30 — пропускаем, остальное вносим
  await say(503, "завтра Теме в 18:30 с Глебом, Диме в 12:00 с Ваней");
  const s2 = sent.filter((m) => m.chat === "503").at(-1);
  assert.match(s2.text, /Внёс в CRM: 1 созвон[\s\S]*Не внёс[\s\S]*уже 18:00/);

  // отменить всё из первого сообщения
  const { webhookSecret } = await import("../src/telegram.mjs");
  const { createHandler } = await import("../src/api.mjs");
  const ub = JSON.parse(summary.markup).inline_keyboard.at(-1).at(-1).callback_data;
  const handle = createHandler({ store, env: { BOT_TOKEN: "123:abc", OWNER_IDS: "1" }, fetch: async () => new Response(JSON.stringify({ ok: true, result: {} })) });
  await handle(new Request("https://team.test/api/tg", { method: "POST", headers: { "x-telegram-bot-api-secret-token": await webhookSecret("123:abc") }, body: JSON.stringify({ callback_query: { id: "q", from: { id: 503 }, data: ub, message: { message_id: 1, chat: { id: 503 }, text: "x" } } }) }));
  const open = (await store.all("client")).flatMap((c) => c.calls).filter((x) => !x.outcome);
  assert.equal(open.length, 1); // остался только Ваня у Димы
});

test("a call that already happened today gets booked with held/no-show buttons", async () => {
  const { store, sent, say } = await setup();
  const t = new Date(Date.now() + 3 * 3600_000 - 2 * 3600_000); // 2 часа назад по МСК
  const hhmm = t.toISOString().slice(11, 16);
  if (t.toISOString().slice(0, 10) !== new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10)) return; // около полуночи — пропускаем
  await say(501, `сегодня в ${hhmm} был созвон с @past_guy`);
  const [c] = await store.all("client");
  assert.equal(c.calls[0].mopId, "501"); // написал сам менеджер — значит, его созвон
  const m = sent.filter((x) => x.chat === "501").at(-1);
  assert.match(m.text, /уже прошёл — отметь итог/);
  assert.match(JSON.parse(m.markup).inline_keyboard[0][0].callback_data, /^held:/);
});

test("status in one line by @nick: held, paid with sum, no-show", async () => {
  const { store, sent, say } = await setup();
  await say(503, "завтра Теме в 15:00 с Глебом @gleb_one");
  await say(501, "@gleb_one пришел");
  let c = (await store.all("client"))[0];
  assert.equal(c.calls[0].outcome, "held");
  await say(501, "@gleb_one оплатил 100к");
  c = (await store.all("client"))[0];
  assert.equal(c.status, "paid");
  assert.equal((await store.all("payment"))[0].tariff, 100000);
  assert.ok(sent.some((m) => m.chat === "1" && /Продажа/.test(m.text)));
  await say(501, "@nobody_here ндз");
  assert.match(sent.at(-1).text, /Не нашёл/);
});

test("AI fallback: unparsed phrase → booking, status, message, answer; questions don't get relayed", async () => {
  const { store, sent, say, api } = await setup();
  const asks = [];
  let next = [];
  const aiClient = { messages: { create: async (req) => (asks.push(req), { stop_reason: next.length ? "tool_use" : "end_turn", content: next.length ? next : [{ type: "text", text: "У Димы 0 продаж за месяц." }] }) } };
  const { createHandler } = await import("../src/api.mjs");
  // ИИ включён: подменяем клиента Anthropic через env
  const env = { BOT_TOKEN: "123:abc", OWNER_IDS: "1", APP_URL: "https://team.test/", ANTHROPIC_API_KEY: "test", __aiClient: aiClient };
  const fetchImpl = async (url, init) => {
    sent.push({ method: url.split("/").pop(), chat: init.body.get("chat_id"), text: init.body.get("text"), markup: init.body.get("reply_markup") });
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
  };
  const handle = createHandler({ store, env, fetch: fetchImpl });
  const secret = await webhookSecret("123:abc");
  const tell = (fromId, text) => handle(new Request("https://team.test/api/tg", { method: "POST", headers: { "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify({ message: { from: { id: fromId, first_name: "X" }, chat: { id: fromId, type: "private" }, text } }) }));

  // вопрос с именем менеджера — не пересылается Диме, а уходит ИИ
  await tell(1, "сколько продаж у Димы?");
  assert.equal(asks.length, 1);
  assert.equal(asks[0].model, "claude-haiku-5-5");
  assert.match(asks[0].messages[0].content, /Диагносты: .*Тема/);
  assert.ok(!sent.some((m) => m.chat === "502"));
  assert.match(sent.at(-1).text, /У Димы 0 продаж/);

  const tomorrow = new Date(Date.now() + 3 * 3600_000 + 86400_000).toISOString().slice(0, 10);
  next = [{ type: "tool_use", id: "t1", name: "book_calls", input: { items: [
    { mop: "Тема", date: tomorrow, time: "18:00", client_name: "Антон", client_nick: null, phone: null },
    { mop: "Дима", date: tomorrow, time: "19:00", client_name: "Миша", client_nick: "misha_k", phone: null },
  ] } }];
  await tell(503, "Тёмычу одного на завтра к шести Антона, а Димону Мишу @misha_k к семи");
  const clients = await store.all("client");
  assert.equal(clients.length, 2);
  assert.ok(sent.some((m) => m.chat === "501" && /Новый созвон/.test(m.text)));
  assert.ok(sent.some((m) => m.chat === "502" && /Новый созвон/.test(m.text)));
  assert.match(sent.filter((m) => m.chat === "503").at(-1).text, /Внёс в CRM: 2 созвона/);

  next = [{ type: "tool_use", id: "t2", name: "set_status", input: { client: "misha_k", status: "thinking", sum: 80000 } }];
  await tell(502, "Миша подумает до пятницы, хочет за восемьдесят");
  assert.equal((await store.all("client")).find((c) => c.telegram === "@misha_k").status, "thinking");

  next = [{ type: "tool_use", id: "t3", name: "send_message", input: { to: "Тема", text: "Антон просил перенести на час позже" } }];
  await tell(503, "передай тёмычу что антон просил перенести на час позже");
  assert.match(sent.find((m) => m.chat === "501" && /пишет тебе/.test(m.text)).text, /перенести на час позже/);

  // без ключа ИИ не зовётся, справка как раньше
  delete env.ANTHROPIC_API_KEY;
  next = [];
  await tell(1, "что там по плану?");
  assert.equal(asks.length, 4);
  assert.match(sent.at(-1).text, /Что я умею/);
});

test("AI: memory, lookups, report, cancel, retry dedupe, budget stop, /ai status", async () => {
  const { store, sent } = await setup();
  const asks = [];
  const script = [];
  const aiClient = { messages: { create: async (req) => (asks.push(structuredClone(req)), script.shift() || { stop_reason: "end_turn", content: [{ type: "text", text: "ок" }], usage: { input_tokens: 5000, output_tokens: 100 } }) } };
  const env = { BOT_TOKEN: "123:abc", OWNER_IDS: "1", APP_URL: "https://team.test/", ANTHROPIC_API_KEY: "test", __aiClient: aiClient, AI: {} };
  const fetchImpl = async (url, init) => {
    sent.push({ method: url.split("/").pop(), chat: init.body.get("chat_id"), text: init.body.get("text") });
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
  };
  const handle = createHandler({ store, env, fetch: fetchImpl });
  const secret = await webhookSecret("123:abc");
  let uid = 1000;
  const tell = (fromId, text, update_id = ++uid) => handle(new Request("https://team.test/api/tg", { method: "POST", headers: { "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify({ update_id, message: { from: { id: fromId, first_name: "X" }, chat: { id: fromId, type: "private" }, text } }) }));
  const tool = (name, input, id = "t") => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }], usage: { input_tokens: 5000, output_tokens: 80 } });

  // ИИ спрашивает карточку, получает её и отвечает; во втором сообщении помнит первый обмен
  await tell(503, "созвон завтра в 15 к Тёме @ivan_x Иван"); // правило, без ИИ
  assert.equal(asks.length, 0);
  script.push(tool("client_info", { client: "Иван" }), { stop_reason: "end_turn", content: [{ type: "text", text: "Иван записан к Теме на завтра 15:00." }], usage: { input_tokens: 6000, output_tokens: 40 } });
  await tell(503, "когда у Ивана созвон?");
  assert.equal(asks.length, 2);
  assert.match(asks[1].messages.at(-1).content[0].content, /@ivan_x Иван[\s\S]*Тема[\s\S]*назначен/);
  assert.match(sent.at(-1).text, /записан к Теме/);
  script.push(tool("cancel_call", { client: "ivan_x" }));
  await tell(503, "отмени его");
  const hist = asks[2].messages;
  assert.equal(hist[0].role, "user");
  assert.match(hist[0].content, /созвон завтра в 15/);
  assert.match(hist[1].content, /Внёс в CRM/);
  assert.match(hist[3].content, /записан к Теме/);
  const [c] = await store.all("client");
  assert.equal(c.calls[0].outcome, "moved");
  assert.ok(sent.some((m) => m.chat === "501" && /Созвон отменён/.test(m.text)));

  // отчёт своими словами
  script.push(tool("save_report", { client: "ivan_x", need: "выйти на 100к в месяц", occupation: "курьер", dream: "съехать от родителей", objection: "нет денег", nextStep: "созвон в пятницу", status: "thinking", sum: 80000 }));
  await tell(501, "провёл ивана, курьер, хочет 100к в месяц, мечтает съехать от родителей, говорит денег нет, думает до пятницы, 80к");
  const c2 = (await store.all("client"))[0];
  assert.equal(c2.status, "thinking");
  assert.equal(c2.calls.at(-1).report.occupation, "курьер");

  // повтор того же апдейта от Telegram не обрабатывается второй раз
  const n = asks.length;
  await tell(1, "что по плану?", 77);
  await tell(1, "что по плану?", 77);
  assert.equal(asks.length, n + 1);

  // бюджет месяца исчерпан → ИИ не зовём, собственнику объясняем
  env.AI_MONTHLY_BUDGET = "0.001";
  await tell(1, "сколько продаж?");
  assert.equal(asks.length, n + 1);
  assert.match(sent.at(-1).text, /месячный бюджет/);

  // /ai: проверка ключа и расход
  delete env.AI_MONTHLY_BUDGET;
  await tell(1, "/ai");
  assert.match(sent.at(-1).text, /ИИ работает[\s\S]*Голосовые: подключены[\s\S]*потрачено \$0\.0\d/);
});

test("windows API: anyone sets a closer's windows, bad input refused, AI opens windows too", async () => {
  const { store, sent, api } = await setup();
  const d1 = new Date(Date.now() + 3 * 3600_000 + 86400_000).toISOString().slice(0, 10);
  const d2 = new Date(Date.now() + 3 * 3600_000 + 2 * 86400_000).toISOString().slice(0, 10);
  const r = await api(503, "PUT", "/windows", { mopId: "501", days: [d1, d2], ranges: [{ from: "18:00", to: "21:00" }, { from: "20:00", to: "22:00" }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.ranges, [{ from: "18:00", to: "22:00" }]); // пересечения склеены
  assert.equal(r.body.windows.length, 2);
  assert.equal((await api(501, "GET", "/state")).body.feed.some((f) => /открыл окна Тема/.test(f.text)), true);
  assert.equal((await api(503, "PUT", "/windows", { mopId: "503", days: [d1], ranges: [{ from: "18:00", to: "21:00" }] })).status, 400); // лидоруб — не диагност
  assert.equal((await api(503, "PUT", "/windows", { mopId: "501", days: [d1], ranges: [{ from: "21:00", to: "18:00" }] })).status, 400);
  const cleared = await api(501, "PUT", "/windows", { mopId: "501", days: [d2], ranges: [] });
  assert.deepEqual(cleared.body.windows.map((w) => w.day), [d1]);

  // ИИ: «Дима завтра свободен с 12 до 15» → set_windows
  const { createHandler } = await import("../src/api.mjs");
  const aiClient = { messages: { create: async () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "w", name: "set_windows", input: { mop: "Дима", dates: [d1], ranges: [{ from: "12:00", to: "15:00" }] } }], usage: {} }) } };
  const env = { BOT_TOKEN: "123:abc", OWNER_IDS: "1", APP_URL: "https://team.test/", ANTHROPIC_API_KEY: "x", __aiClient: aiClient };
  const fetchImpl = async (url, init) => (sent.push({ chat: init.body.get("chat_id"), text: init.body.get("text") }), new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } })));
  const handle = createHandler({ store, env, fetch: fetchImpl });
  const secret = await webhookSecret("123:abc");
  await handle(new Request("https://team.test/api/tg", { method: "POST", headers: { "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify({ update_id: 9, message: { from: { id: 503, first_name: "X" }, chat: { id: 503, type: "private" }, text: "Димон завтра свободен с полудня до трёх" } }) }));
  assert.ok((await store.all("window")).some((w) => w.mopId === "502" && w.ranges[0].from === "12:00"));
  assert.match(sent.find((m) => m.chat === "502").text, /открыл тебе окна/);
});

test("payouts: Monday reminder to owner — РОП and лидоруб by client, «Выплатил» marks paid and notifies", async () => {
  const { store, sent, api } = await setup();
  await api(1, "POST", "/users", { id: "504", role: "rop", name: "Андрей" });
  const P = (id, date, tariff, net, mop, verified = true, clientName = "") => ({ id, date, tariff, net, verified, mopAlias: mop, clientName });
  await api(1, "POST", "/import", { payments: [
    P("seed-tema-32", "2026-10-04", 100000, 69000, "Тема", true, "Даня"),
    P("seed-dima-4", "2026-10-05", 70000, 49840, "Дима", true, "Егор @TypaGO4ER"),
    P("seed-tema-33", "2026-10-09", 100000, 69000, "Тема", true, "Герман"),
    P("seed-tema-onlyfals", "2026-10-11", 25500, null, "Тема", false, "Саня @onlyfals"),
  ] });
  const { runPayoutReminder } = await import("../src/bot.mjs");
  const { telegram } = await import("../src/telegram.mjs");
  const tg = telegram("123:abc", async (url, init) => (sent.push({ chat: init.body.get("chat_id"), text: init.body.get("text"), markup: init.body.get("reply_markup") }), new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))));
  const env = { OWNER_IDS: "1" };
  const monday = Date.parse("2026-10-12T17:40:00Z"); // 20:40 МСК
  assert.equal(await runPayoutReminder({ store, env, tg, appUrl: "https://t/", now: Date.parse("2026-10-13T09:00:00Z") }), null); // вторник — нет
  const r = await runPayoutReminder({ store, env, tg, appUrl: "https://t/", now: monday });
  assert.equal(r.sent, 1);
  const msg = sent.at(-1);
  assert.equal(msg.chat, "1");
  // 04.10 уже выплачено всем; 05.10 и 09.10 — РОПу 1 390,54 + 1 925,1 = 3 315,64; лидорубу 927,02 + 1 283,4 = 2 210,42
  assert.match(msg.text, /РОП Андрей — 3[\s ]316 ₽[\s\S]*Егор @TypaGO4ER · Дима · 70[\s ]000 ₽ → <b>1[\s ]391 ₽[\s\S]*Лидоруб Леха — 2[\s ]210 ₽/);
  assert.match(msg.text, /Не входят[\s\S]*Саня @onlyfals/);
  assert.doesNotMatch(msg.text, /Даня/);
  assert.match(msg.markup, /po:rop:504/);
  assert.equal(await runPayoutReminder({ store, env, tg, appUrl: "https://t/", now: monday + 60_000 }), null); // один раз в день

  // «Выплатил Андрею» из бота
  const { handleUpdate } = await import("../src/bot.mjs");
  await handleUpdate({ callback_query: { id: "cb", from: { id: 1 }, data: "po:rop:504", message: { chat: { id: 1 }, message_id: 5 } } }, { store, env, tg, appUrl: "https://t/" });
  assert.match(sent.find((m) => m.chat === "504").text, /выплатил тебе 3[\s ]316 ₽[\s\S]*Егор/);
  const st = (await api(1, "GET", "/state")).body;
  assert.equal(st.payouts.length, 1);
  assert.equal(st.payments.find((p) => p.id === "seed-tema-33").paid.rop, "2026-10-12".slice(0, 4) + st.payments.find((p) => p.id === "seed-tema-33").paid.rop.slice(4));
  assert.equal(st.payments.find((p) => p.id === "seed-tema-33").paid.lidorub, null);
  // лидоруб ещё ждёт; РОП не может отмечать выплаты
  assert.equal((await api(504, "POST", "/payouts", { role: "lidorub", personId: "503" })).status, 403);
  const done = await api(1, "POST", "/payouts", { role: "lidorub", personId: "503" });
  assert.equal(done.body.payout.amount, 2210); // 927 + 1 283, как в таблице
  // отмена возвращает долг
  await api(1, "POST", `/payouts/${done.body.payout.id}/undo`);
  assert.equal((await api(1, "GET", "/state")).body.payments.find((p) => p.id === "seed-dima-4").paid.lidorub, null);
});

test("no duplicates: same @nick/phone refused, old dups auto-merged, repeated call not doubled, delete/merge by owner of the lead", async () => {
  const { store, sent, say, api } = await setup();
  const a = (await api(503, "POST", "/clients", { name: "Антон", telegram: "@Anton_X" })).body.client;
  // тот же ник в другом регистре / ссылкой — 409 с найденным клиентом
  const dupNick = await api(501, "POST", "/clients", { name: "Антоха", telegram: "https://t.me/anton_x" });
  assert.equal(dupNick.status, 409);
  assert.equal(dupNick.body.client.id, a.id);
  await api(503, "PATCH", `/clients/${a.id}`, { phone: "+7 900 123-45-67" });
  assert.equal((await api(503, "POST", "/clients", { name: "Кто-то", phone: "89001234567" })).status, 409);
  const b = (await api(503, "POST", "/clients", { name: "Боря", telegram: "@borya" })).body.client;
  assert.equal((await api(503, "PATCH", `/clients/${b.id}`, { telegram: "anton_x" })).status, 409);

  // старый дубль, который уже лежит в базе (завели до защиты), склеивается сам
  const legacyDup = { ...b, id: "old-dup", telegram: "@ANTON_X", name: "", calls: [{ id: "x1", at: new Date(Date.now() + 86400_000).toISOString(), mopId: "501", outcome: null, notified: {} }], history: [], createdAt: new Date(Date.now() + 1000).toISOString() };
  await store.put("client", legacyDup.id, legacyDup);
  const st = (await api(1, "GET", "/state")).body;
  const antons = st.clients.filter((c) => /anton_x/i.test(c.telegram));
  assert.equal(antons.length, 1);
  assert.equal(antons[0].calls.length, 1);
  assert.ok(await store.get("trash", "old-dup"));

  // повторная запись на то же время — тот же созвон; сдвиг на 30 минут — перенос, а не второй созвон
  const at = new Date(Date.now() + 3 * 3600_000).toISOString();
  await api(503, "POST", `/clients/${b.id}/action`, { type: "call", at, mopId: "501" });
  // клиента взял Тема — лидоруб его больше не трогает, перенос делает сам Тема
  assert.equal((await api(503, "POST", `/clients/${b.id}/action`, { type: "call", at, mopId: "501" })).status, 403);
  let c = (await api(501, "POST", `/clients/${b.id}/action`, { type: "call", at, mopId: "501" })).body.client;
  assert.equal(c.calls.filter((x) => x.outcome !== "moved").length, 1);
  c = (await api(501, "POST", `/clients/${b.id}/action`, { type: "call", at: new Date(Date.parse(at) + 30 * 60_000).toISOString(), mopId: "501" })).body.client;
  assert.equal(c.calls.length, 1);
  assert.equal(Date.parse(c.calls[0].at), Date.parse(at) + 30 * 60_000);
  // отмена записи
  c = (await api(501, "POST", `/clients/${b.id}/action`, { type: "uncall" })).body.client;
  assert.equal(c.calls[0].outcome, "moved");

  // в боте «созвон с @borya был в …» по уже проведённому созвону не создаёт второй
  const past = new Date(Date.now() - 2 * 3600_000);
  await api(501, "POST", `/clients/${b.id}/action`, { type: "call", at: past.toISOString(), mopId: "501" });
  await api(501, "POST", `/clients/${b.id}/action`, { type: "held" });
  const hhmm = new Date(past.getTime() + 3 * 3600_000 + 60 * 60_000).toISOString().slice(11, 16);
  if (Date.parse(`${new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10)}T${hhmm}:00+03:00`) < Date.now()) {
    await say(501, `сегодня в ${hhmm} был созвон с @borya`);
    assert.match(sent.filter((m) => m.chat === "501").at(-1).text, /уже есть этот созвон|Ничего не внёс/);
    assert.equal((await store.get("client", b.id)).calls.filter((x) => x.outcome === "held").length, 1);
  }

  // склейка вручную (имя без ника) и удаление: лидоруб — своего клиента можно, чужого нельзя
  const n1 = (await api(503, "POST", "/clients", { name: "Никита" })).body.client;
  const n2 = (await api(503, "POST", "/clients", { name: "Никита", info: "Ютуб" })).body.client;
  const merged = (await api(503, "POST", `/clients/${n1.id}`, { mergeFrom: n2.id })).body;
  assert.equal(merged.removed, n2.id);
  assert.match(merged.client.info, /Ютуб/);
  const foreign = (await api(1, "POST", "/clients", { name: "Чужой" })).body.client;
  assert.equal((await api(503, "DELETE", `/clients/${foreign.id}`)).status, 403);
  assert.equal((await api(503, "DELETE", `/clients/${n1.id}`)).status, 200);
  assert.ok(await store.get("trash", n1.id));

  // пересланный боту свой отчёт — отчёт, а не новый лид
  const before = (await store.all("client")).length;
  await say(501, "Потребность/запрос клиента: выйти на доход\nРод деятельности: курьер\nПредложил оплатить: Да\n@borya", { forward_origin: { type: "user", sender_user: { id: 777, first_name: "Дима" } } });
  assert.equal((await store.all("client")).length, before);
});

test("audit fixes: kopecks, wrong «Оплатил» rollback, two different Антонов, report doesn't add a call, NDZ from bot notifies", async () => {
  const { money } = await import("../src/api.mjs");
  assert.equal(money("68 950,50"), 68950.5);
  assert.equal(money("99.99"), 99.99);
  assert.equal(money("1.200.000"), 1200000);
  assert.equal(money("100к"), 100000);

  const { store, sent, say, api } = await setup();
  // ошибочно «Оплатил» → поправили на «Думает»: ни продажи в РнП, ни черновика в ведомости
  const g = (await api(503, "POST", "/clients", { name: "Глеб", telegram: "gleb_q" })).body.client;
  await api(503, "POST", `/clients/${g.id}/action`, { type: "call", at: new Date(Date.now() - 3600_000).toISOString(), mopId: "501" });
  await api(501, "POST", `/clients/${g.id}/action`, { type: "status", status: "paid", sum: 100000 });
  assert.equal((await store.all("payment")).length, 1);
  let c = (await api(501, "POST", `/clients/${g.id}/action`, { type: "status", status: "thinking", sum: 100000 })).body.client;
  assert.equal((await store.all("payment")).length, 0);
  assert.equal(c.events.filter((e) => e.t === "paid").length, 0);
  assert.equal(c.calls[0].outcome, "held"); // время прошло, решение было — созвон отмечен проведённым
  // лидоруб не может поставить «Оплатил» чужому диагносту
  assert.equal((await api(503, "POST", `/clients/${g.id}/action`, { type: "status", status: "paid", sum: 100000 })).status, 403);

  // отчёт по начавшемуся созвону — тот же созвон, не второй
  c = (await api(501, "POST", `/clients/${g.id}/action`, { type: "report", newCall: true, report: { need: "доход" } })).body.client;
  assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0].outcome, "held");
  c = (await api(501, "POST", `/clients/${g.id}/action`, { type: "report", newCall: true, report: { need: "доход, исправил" } })).body.client;
  assert.equal(c.calls.length, 1);
  assert.match(c.calls[0].report.need, /исправил/);

  // два разных Антона к разным диагностам по одному имени — два клиента, не перенос
  const tomorrow = new Date(Date.now() + 3 * 3600_000 + 86400_000).toISOString().slice(0, 10);
  void tomorrow;
  await say(503, "завтра Диме в 15 с Антоном");
  await say(503, "завтра Теме в 18 с Антоном");
  const antons = (await store.all("client")).filter((x) => x.name === "Антон");
  assert.equal(antons.length, 2);
  assert.ok(antons.every((a) => a.calls.filter((x) => !x.outcome).length === 1));

  // НДЗ кнопкой из напоминания — уведомление уходит лидорубу
  const { handleUpdate } = await import("../src/bot.mjs");
  const { telegram } = await import("../src/telegram.mjs");
  const tg = telegram("123:abc", async (url, init) => (sent.push({ chat: init.body.get("chat_id"), text: init.body.get("text") }), new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))));
  const k = (await api(503, "POST", "/clients", { name: "Костя" })).body.client;
  const cc = (await api(503, "POST", `/clients/${k.id}/action`, { type: "call", at: new Date(Date.now() - 20 * 60_000).toISOString(), mopId: "501" })).body.client.calls[0];
  const before = sent.length;
  await handleUpdate({ callback_query: { id: "z", from: { id: 501 }, data: `ndz:${k.id}:${cc.id}`, message: { chat: { id: 501 }, message_id: 3, text: "пришёл?" } } }, { store, env: { OWNER_IDS: "1" }, tg, appUrl: "https://t/" });
  assert.ok(sent.slice(before).some((m) => m.chat === "503" && /НДЗ/.test(m.text || "")));
});

test("dropcall removes a duplicate held/NDZ call and fixes status", async () => {
  const { api, store } = await setup();
  const k = (await api(503, "POST", "/clients", { name: "Никита" })).body.client;
  const at = new Date(Date.now() - 2 * 3600_000).toISOString();
  await api(503, "POST", `/clients/${k.id}/action`, { type: "call", at, mopId: "501" });
  await api(501, "POST", `/clients/${k.id}/action`, { type: "held" });
  // испорченная карточка, как в бою до защиты: второй созвон на то же время с НДЗ
  const bad = await store.get("client", k.id);
  bad.calls.push({ id: "dup1", at, mopId: "501", outcome: "ndz" });
  bad.status = "ndz1";
  bad.events.push({ t: "ndz", at, mop: "501" });
  await store.put("client", bad.id, bad);
  const c = (await api(501, "POST", `/clients/${k.id}/action`, { type: "dropcall", callId: "dup1" })).body.client;
  assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0].outcome, "held");
  assert.equal(c.status, "in_work");
  assert.equal(c.events.filter((e) => e.t === "ndz").length, 0);
});

test("«Оплатил» from a CRM sheet import gets a payroll draft; seed payments link by nick, no duplicates", async () => {
  const { store, api } = await setup();
  // клиент пришёл из CRM-таблицы, дальше его ведут в приложении
  await api(1, "POST", "/import", { clients: [{ name: "Зовут Алексей", telegram: "@hanagassummi", status: "in_work", fromSheet: true, wantedSum: 70000 }] });
  const a = (await store.all("client")).find((c) => c.telegram === "@hanagassummi");
  await api(503, "POST", `/clients/${a.id}/action`, { type: "call", at: new Date(Date.now() - 3600_000).toISOString(), mopId: "502" });
  await api(502, "POST", `/clients/${a.id}/action`, { type: "held" });
  // исторический клиент из таблицы, оплата уже в ведомости (seed)
  const r = (await api(1, "POST", "/import", {
    payments: [{ id: "seed-dima-5", date: "2026-10-10", tariff: 95000, net: 65550, verified: true, mopAlias: "Дима", clientName: "Ромчик @poopkek" }],
    clients: [
      { name: "Ромчик", telegram: "@poopkek", status: "paid", fromSheet: true, mopAlias: "Дима", calls: [{ id: "l1", at: "2026-10-08T15:00:00.000Z", outcome: "held", legacy: true }] },
      { name: "Зовут Алексей", telegram: "@hanagassummi", status: "paid", fromSheet: true, nextSteps: "Был пересозвон (в рамках него всё оплатил)" },
    ],
  })).body;
  assert.equal(r.paidFromSheet, 1);
  const pays = await store.all("payment");
  const alexey = pays.filter((p) => p.clientId === a.id);
  assert.equal(alexey.length, 1);
  assert.equal(alexey[0].tariff, 70000);
  assert.equal(alexey[0].verified, false);
  const romchik = (await store.all("client")).find((c) => c.telegram === "@poopkek");
  assert.equal(pays.filter((p) => p.clientId === romchik.id).length, 1); // seed привязан, второй не создан
  // повторная сверка не плодит
  const { reconcilePaid } = await import("../src/api.mjs");
  assert.deepEqual(await reconcilePaid(store), { linked: 0, created: 0, removed: 0 });
});

test("re-call: one report for the client, no second report owed, one payment with the final sum on the re-call day", async () => {
  const { store, api } = await setup();
  const { needsReport } = await import("../public/lib/model.js");
  const { rnp } = await import("../public/lib/stats.js");
  const a = (await api(503, "POST", "/clients", { name: "Алексей", telegram: "alexey_rc" })).body.client;
  const d1 = new Date(Date.now() - 26 * 3600_000).toISOString();
  const d2 = new Date(Date.now() - 2 * 3600_000).toISOString();
  await api(503, "POST", `/clients/${a.id}/action`, { type: "call", at: d1, mopId: "502" });
  await api(502, "POST", `/clients/${a.id}/action`, { type: "held" });
  await api(502, "POST", `/clients/${a.id}/action`, { type: "report", report: { need: "старт", occupation: "официант", nextStep: "пересозвон, рассрочка на 70к" }, status: "thinking", sum: 70000 });
  await api(502, "POST", `/clients/${a.id}/action`, { type: "call", at: d2, mopId: "502" });
  let c = (await api(502, "POST", `/clients/${a.id}/action`, { type: "held" })).body.client;
  assert.equal(needsReport(c), false); // пересозвон — итог уже есть
  c = (await api(502, "POST", `/clients/${a.id}/action`, { type: "status", status: "paid", sum: 70000 })).body.client;
  // уточнили сумму — та же оплата, не вторая
  c = (await api(502, "POST", `/clients/${a.id}/action`, { type: "status", status: "paid", sum: 75000 })).body.client;
  const pays = (await store.all("payment")).filter((p) => p.clientId === a.id);
  assert.equal(pays.length, 1);
  assert.equal(pays[0].tariff, 75000);
  assert.equal(pays[0].date, new Date(Date.parse(d2) + 3 * 3600_000).toISOString().slice(0, 10));
  const t = rnp([c], {}).total;
  assert.deepEqual([t.sales, t.salesSum], [1, 75000]);
});

test("reconcile: manual payment «Алексей» links to «Зовут Алексей», the system draft is removed, no new drafts", async () => {
  const { store, api } = await setup();
  await api(1, "POST", "/import", { clients: [{ name: "Зовут Алексей", telegram: "@hanagassummi", status: "in_work", fromSheet: true }] });
  const a = (await store.all("client")).find((c) => c.telegram === "@hanagassummi");
  await api(503, "POST", `/clients/${a.id}/action`, { type: "call", at: new Date(Date.now() - 3600_000).toISOString(), mopId: "502" });
  await api(502, "POST", `/clients/${a.id}/action`, { type: "held" });
  // статус из таблицы → сверка создала черновик
  await api(1, "POST", "/import", { clients: [{ name: "Зовут Алексей", telegram: "@hanagassummi", status: "paid", fromSheet: true }] });
  assert.equal((await store.all("payment")).filter((p) => p.createdBy === "system").length, 1);
  // Андрей заводит оплату руками: «Алексей», без ника, верифицирует
  const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const res = (await api(1, "POST", "/payments", { date: day, tariff: 70000, net: 51000, verified: true, mopId: "502", clientName: "Алексей" })).body;
  const pays = res.payments;
  assert.equal(pays.length, 1);
  assert.equal(pays[0].clientId, a.id);
  assert.equal(pays[0].verified, true);
});

test("lead taken by a mop: only that mop, ROP and owner can change it; others only comment; fresh own booking can be undone", async () => {
  const { store, sent, say, api } = await setup();
  await api(1, "POST", "/users", { id: "504", role: "rop", name: "Андрей" });
  const c = (await api(503, "POST", "/clients", { name: "Олег", telegram: "oleg_lock" })).body.client;
  // до назначения МОПа лидоруб ведёт лида сам
  assert.equal((await api(503, "POST", `/clients/${c.id}/action`, { type: "lm" })).status, 200);
  const at = new Date(Date.now() + 5 * 3600_000).toISOString();
  const booked = (await api(503, "POST", `/clients/${c.id}/action`, { type: "call", at, mopId: "502" })).body.client;
  // ошибся — сразу отменил свою запись
  assert.equal((await api(503, "POST", `/clients/${c.id}/action`, { type: "uncall", callId: booked.calls[0].id })).status, 200);
  await api(502, "POST", `/clients/${c.id}/action`, { type: "call", at, mopId: "502" }); // взял Дима
  // чужие (лидоруб, другой МОП) — 403 на всё, кроме комментария
  for (const who of ["503", "501"]) {
    assert.equal((await api(who, "PATCH", `/clients/${c.id}`, { name: "Хакер" })).status, 403);
    assert.equal((await api(who, "POST", `/clients/${c.id}/action`, { type: "status", status: "thinking", sum: 1 })).status, 403);
    assert.equal((await api(who, "DELETE", `/clients/${c.id}`)).status, 403);
    assert.equal((await api(who, "POST", `/clients/${c.id}/action`, { type: "comment", text: "клиент просил позвонить позже" })).status, 200);
  }
  // свой МОП, РОП и собственник — можно
  assert.equal((await api(502, "PATCH", `/clients/${c.id}`, { info: "от Димы" })).status, 200);
  assert.equal((await api(504, "PATCH", `/clients/${c.id}`, { info: "от РОПа" })).status, 200);
  assert.equal((await api(1, "PATCH", `/clients/${c.id}`, { info: "от Пети" })).status, 200);
  // в боте чужой МОП не может поставить статус
  await say(501, "@oleg_lock ндз");
  assert.match(sent.filter((m) => m.chat === "501").at(-1).text, /ведёт Дима/);
  assert.equal((await store.get("client", c.id)).calls.filter((x) => x.outcome === "ndz").length, 0);
});
