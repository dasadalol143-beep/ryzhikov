import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createAcademyHandler, webhookSecretFor, d1Store, runAcademyExports, resetOffersCache } from "../lib/academy.mjs";

const TOKEN = "999:ACADEMY_TOKEN";
const env = { ACADEMY_BOT_TOKEN: TOKEN, ACADEMY_MENTOR_IDS: "1", BOT_TOKEN: "123:MAIN" };

function sign(user, token = TOKEN) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(dcs).digest("hex"));
  return params.toString();
}

// Настоящий SQLite с интерфейсом D1 + счётчик запросов (на бесплатном тарифе лимит 50 на вызов).
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const d1 = {
    queries: 0,
    prepare(sql) {
      const make = (args) => ({
        bind: (...a) => make(a),
        first: async () => (d1.queries++, db.prepare(sql).get(...args) ?? null),
        all: async () => (d1.queries++, { results: db.prepare(sql).all(...args) }),
        run: async () => (d1.queries++, { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
      });
      return make([]);
    },
  };
  return d1;
}

function memoryKV(init = []) {
  const data = new Map(init);
  return {
    data,
    getJSON: async (k) => (data.has(k) ? structuredClone(data.get(k)) : null),
    setJSON: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (k) => void data.delete(k),
    list: async (prefix) => [...data.keys()].filter((k) => k.startsWith(prefix)),
  };
}

const sent = [];
const fakeFetch = async (url, init) => {
  const method = String(url).split("/").pop();
  if (method === "sendMessage" || method === "sendDocument") sent.push({ method, chat: init.body.get("chat_id"), text: init.body.get("text"), file: init.body.get("document")?.name });
  return new Response(JSON.stringify({ ok: true, result: method === "getMe" ? { username: "academy_bot" } : true }));
};

const MAIN_OFFERS = [{ id: "vtb", category: "rko", name: "ВТБ — РКО", partner: "RKO Group", amount: 7777, cost: 0, active: true, note: "" }];

function setup() {
  const d1 = fakeD1();
  const store = d1Store(d1);
  const mainStore = memoryKV([["offers", MAIN_OFFERS], ["leads/x", { id: "x", telegram: "@secret" }]]);
  const handle = createAcademyHandler({ store, mainStore, env, fetch: fakeFetch });
  const as = (user, token) => async (method, path, body) => {
    d1.queries = 0;
    const res = await handle(new Request(`https://crm.test/academy/api${path}`, { method, headers: { authorization: `tma ${sign(user, token)}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
    return { status: res.status, body: await res.json(), queries: d1.queries };
  };
  const bot = async (from, text) => {
    const req = new Request("https://crm.test/academy/api/tg", { method: "POST", headers: { "x-telegram-bot-api-secret-token": await webhookSecretFor(TOKEN) }, body: JSON.stringify({ message: { from, chat: { id: from.id, type: "private" }, text } }) });
    return handle(req);
  };
  return { d1, store, mainStore, as, bot };
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
  const code = cr.body.code;
  assert.match(code, /^[A-Z2-9]{6}$/);
  assert.equal((await vasya("POST", "/join", { code: "nope" })).body.error, "bad_code");
  assert.equal((await vasya("POST", "/join", { code: code.toLowerCase() })).status, 200);
  assert.equal((await vasya("POST", "/join", { code })).status, 200, "повторный вход тем же кодом — не ошибка");
  assert.equal((await kolya("POST", "/join", { code })).body.error, "code_used");

  const st = await vasya("GET", "/state");
  assert.equal(st.status, 200);
  assert.equal(st.body.me.academy, true);
  assert.equal(st.body.me.mentor, false);
  assert.equal(st.body.member.name, "Вася");
  assert.equal(st.body.member.exportEvery, 3);
  assert.equal(st.body.settings.taxRate, 6);
  assert.equal(st.body.settings.partnerShare, 0);
  assert.equal(st.body.offers.find((o) => o.id === "vtb").amount, 7777, "ставки — наши живые");
  assert.equal(st.body.leads.length, 0, "наших лидов не видно");

  const lead = await vasya("POST", "/leads", { telegram: "lead1", offers: { vtb: { status: "paid" } } });
  assert.equal(lead.status, 201);
  const again = await vasya("POST", "/leads", { telegram: "@LEAD1" });
  assert.equal(again.status, 200, "двойной тап не создаёт копию");
  assert.equal(again.body.id, lead.body.id);
  assert.equal((await vasya("GET", "/state")).body.leads.length, 1);
  assert.equal((await mentor("GET", "/state")).body.leads.length, 0, "у наставника свой кабинет");
  assert.ok(![...mainStore.data.keys()].some((k) => k.includes(lead.body.id)), "в нашу базу ничего не пишется");
  assert.ok(await store.getJSON(`u/10/leads/${lead.body.id}`));
  assert.equal((await vasya("GET", "/access")).status, 403);

  const m = await mentor("GET", "/mentor");
  assert.equal(m.body.students.length, 1);
  assert.equal(m.body.students[0].leads, 1);
  assert.equal(m.body.students[0].active, true);
  assert.equal(m.body.students[0].activeLeads, 1);
  assert.equal(m.body.students[0].income, 7777);
  assert.equal(m.body.students[0].paidMonth, 7777);
  assert.equal(m.body.bot, "academy_bot");
  assert.equal(m.body.codes.length, 0);

  assert.equal((await mentor("PATCH", "/mentor/students/10", { active: false })).body.active, false);
  assert.equal((await vasya("GET", "/state")).body.error, "disabled");
  assert.equal((await vasya("POST", "/join", { code })).body.error, "disabled");
  await mentor("PATCH", "/mentor/students/10", { active: true });
  assert.equal((await vasya("GET", "/state")).body.leads.length, 1, "лиды вернулись");
});

test("group link: up to max people, atomic, revocable; names editable", async () => {
  const { as, bot } = setup();
  const mentor = as({ id: 1, first_name: "Пётр" });
  const g = (await mentor("POST", "/mentor/codes", { group: true, max: 3, note: "Поток ноябрь" })).body;
  assert.equal(g.group, true);
  assert.equal(g.max, 3);
  // трое заходят одновременно — все внутри
  const joins = await Promise.all([20, 21, 22].map((id) => as({ id, first_name: `U${id}`, username: `u${id}` })("POST", "/join", { code: g.code, name: id === 20 ? "  Гоша  <b>" : "" })));
  assert.deepEqual(joins.map((j) => j.status), [200, 200, 200]);
  assert.equal((await as({ id: 23, first_name: "Late" })("POST", "/join", { code: g.code })).body.error, "code_full");
  // повторный вход того же человека места не съедает
  assert.equal((await as({ id: 21, first_name: "U21" })("POST", "/join", { code: g.code })).status, 200);
  let m = (await mentor("GET", "/mentor")).body;
  assert.equal(m.students.length, 3);
  assert.equal(m.codes.length, 0, "заполненная ссылка уходит из списка");
  assert.equal(m.students.find((s) => s.id === 20).name, "Гоша b", "имя чистится от тегов и пробелов");

  // через бота: /start КОД из ссылки
  const g2 = (await mentor("POST", "/mentor/codes", { group: true })).body;
  assert.equal(g2.max, 50);
  sent.length = 0;
  await bot({ id: 30, first_name: "Слава" }, `/start ${g2.code}`);
  assert.match(sent.at(-1).text, /RYZHIKOV ACADEMY/);
  m = (await mentor("GET", "/mentor")).body;
  assert.equal(m.codes.find((c) => c.code === g2.code).uses, 1);
  await mentor("DELETE", `/mentor/codes/${g2.code}`);
  assert.equal((await as({ id: 31, first_name: "X" })("POST", "/join", { code: g2.code })).body.error, "bad_code", "отозванная ссылка не пускает");
  assert.equal((await as({ id: 30, first_name: "Слава" })("GET", "/state")).status, 200, "кто уже вошёл — остаётся");

  // имя: своё имя важнее телеграмного, пустое — вернуть телеграмное
  const slava = as({ id: 30, first_name: "Слава", username: "slava" });
  assert.equal((await slava("PATCH", "/me", { name: "Вячеслав Ишимбай" })).body.name, "Вячеслав Ишимбай");
  assert.equal((await slava("GET", "/state")).body.member.name, "Вячеслав Ишимбай");
  assert.equal((await slava("PATCH", "/me", { name: "" })).body.name, "Слава");
  assert.equal((await slava("PATCH", "/me", { exportEvery: 1 })).body.exportEvery, 1);
  assert.equal((await slava("PATCH", "/me", { exportEvery: 5 })).body.exportEvery, 1, "мусор не принимаем");
});

test("query budget: big imports, big payouts and 70 students stay under the D1 limit of 50", async () => {
  const { as } = setup();
  const mentor = as({ id: 1, first_name: "Пётр" });
  const g = (await mentor("POST", "/mentor/codes", { group: true, max: 100 })).body;
  for (let i = 0; i < 70; i++) await as({ id: 100 + i, first_name: `S${i}` })("POST", "/join", { code: g.code });
  const st = as({ id: 100, first_name: "S0" });
  const leads = Array.from({ length: 300 }, (_, i) => ({ telegram: `@lead${i}`, fio: `Лид ${i}`, offers: { vtb: { status: "paid" } } }));
  const imp = await st("POST", "/import", { leads });
  assert.equal(imp.status, 200);
  assert.equal(imp.body.created, 300);
  assert.ok(imp.queries < 50, `import: ${imp.queries} запросов`);
  const state = await st("GET", "/state");
  assert.equal(state.body.leads.length, 300);
  assert.ok(state.queries < 50, `state: ${state.queries} запросов`);
  const items = state.body.leads.slice(0, 120).map((l) => ({ leadId: l.id, offerId: "vtb" }));
  const pay = await st("POST", "/payouts", { network: "RKO Group", amount: 1, items });
  assert.equal(pay.body.items.length, 120);
  assert.ok(pay.queries < 50, `payout: ${pay.queries} запросов`);
  const del = await st("DELETE", `/payouts/${pay.body.id}`);
  assert.ok(del.queries < 50, `payout delete: ${del.queries} запросов`);
  const ment = await mentor("GET", "/mentor");
  assert.equal(ment.body.students.length, 70);
  assert.ok(ment.queries < 50, `mentor: ${ment.queries} запросов`);
  console.log(`D1 запросов: import ${imp.queries}, state ${state.queries}, payout ${pay.queries}, mentor ${ment.queries}`);
  assert.equal(ment.body.students[0].leads, 300);
});

test("trash: deleted lead can be restored", async () => {
  const { as, mainStore } = setup();
  const mentor = as({ id: 1, first_name: "Пётр" });
  const lead = (await mentor("POST", "/leads", { telegram: "@gone" })).body;
  await mentor("DELETE", `/leads/${lead.id}`);
  assert.equal((await mentor("GET", "/state")).body.leads.length, 0);
  const trash = (await mentor("GET", "/trash")).body;
  assert.equal(trash.length, 1);
  assert.ok(trash[0].deletedAt);
  const back = await mentor("POST", `/trash/${lead.id}/restore`);
  assert.equal(back.body.telegram, "@gone");
  assert.equal((await mentor("GET", "/state")).body.leads.length, 1);
  assert.equal((await mentor("GET", "/trash")).body.length, 0);
  assert.equal(mainStore.data.size, 2, "наша база не тронута");
});

test("student catalog = own edits + new offers from ours", async () => {
  const { as, mainStore } = setup();
  const mentor = as({ id: 1, first_name: "Пётр" });
  await mentor("PATCH", "/offers/vtb", { amount: 5000 });
  mainStore.data.set("offers", [...MAIN_OFFERS, { id: "ozon", category: "rko", name: "Озон", partner: "", amount: 8000, cost: 0, active: true, note: "" }]);
  resetOffersCache(); // в проде каталог подтянется сам в течение минуты
  const offers = (await mentor("GET", "/state")).body.offers;
  assert.equal(offers.find((o) => o.id === "vtb").amount, 5000, "своя правка остаётся");
  assert.equal(offers.find((o) => o.id === "ozon").amount, 8000, "новый оффер академии появился");
});

test("auto-export: Excel in the morning, only when due and only if something changed", async () => {
  const { store, mainStore, as } = setup();
  const mentor = as({ id: 1, first_name: "Пётр" });
  const g = (await mentor("POST", "/mentor/codes", { group: true, max: 10 })).body;
  for (const id of [40, 41, 42, 43]) await as({ id, first_name: `E${id}` })("POST", "/join", { code: g.code });
  for (const id of [40, 41, 42]) await as({ id, first_name: `E${id}` })("POST", "/leads", { telegram: `@l${id}` });
  await as({ id: 42, first_name: "E42" })("PATCH", "/me", { exportEvery: 0 });
  const day = Date.parse("2026-11-17T06:00:00Z"); // 09:00 МСК
  sent.length = 0;
  assert.deepEqual(await runAcademyExports({ store, mainStore, env, now: Date.parse("2026-11-17T12:00:00Z"), fetchImpl: fakeFetch }), [], "днём не шлём");
  const r1 = await runAcademyExports({ store, mainStore, env, now: day, fetchImpl: fakeFetch, batch: 1 });
  const r2 = await runAcademyExports({ store, mainStore, env, now: day + 60000, fetchImpl: fakeFetch, batch: 5 });
  const got = [...r1, ...r2].map((r) => r.id).sort();
  assert.deepEqual(got, [40, 41], "42 отключил выгрузку, у 43 нет лидов");
  assert.ok(sent.every((s) => s.method === "sendDocument" && /\.xlsx$/.test(s.file)));
  assert.deepEqual(await runAcademyExports({ store, mainStore, env, now: day + 120000, fetchImpl: fakeFetch }), [], "сегодня уже отправили");
  // через 3 дня без изменений — не шлём одно и то же
  assert.deepEqual(await runAcademyExports({ store, mainStore, env, now: day + 3 * 86400000, fetchImpl: fakeFetch }), []);
  // у 40-го появились изменения после выгрузки — через 3 дня придёт свежий файл
  const st40 = await store.getJSON("stats/40");
  await store.setJSON("stats/40", { ...st40, lastActivity: new Date(day + 86400000).toISOString() });
  // список перечитывается не чаще раза в 30 минут — через полчаса файл уйдёт
  assert.deepEqual(await runAcademyExports({ store, mainStore, env, now: day + 3 * 86400000 + 60000, fetchImpl: fakeFetch }), []);
  assert.deepEqual((await runAcademyExports({ store, mainStore, env, now: day + 3 * 86400000 + 31 * 60000, fetchImpl: fakeFetch })).map((r) => r.id), [40]);
});

test("academy bot: /excel sends the file, strangers get a polite refusal, Telegram secret required", async () => {
  const { as, bot } = setup();
  const mentor = as({ id: 1, first_name: "Пётр" });
  const { code } = (await mentor("POST", "/mentor/codes", {})).body;
  const noSecret = await (createAcademyHandler({ store: d1Store(fakeD1()), env, fetch: fakeFetch }))(new Request("https://crm.test/academy/api/tg", { method: "POST", body: "{}" }));
  assert.equal(noSecret.status, 403);
  sent.length = 0;
  await bot({ id: 50, first_name: "Чужой" }, "привет");
  assert.match(sent.at(-1).text, /приватный бонус/);
  await bot({ id: 50, first_name: "Чужой" }, `/start ${code}`);
  assert.match(sent.at(-1).text, /RYZHIKOV ACADEMY/);
  await bot({ id: 50, first_name: "Чужой" }, "/excel");
  assert.match(sent.at(-1).text, /Лидов пока нет/);
  await as({ id: 50, first_name: "Чужой" })("POST", "/leads", { telegram: "@a" });
  await bot({ id: 50, first_name: "Чужой" }, "/excel");
  assert.match(sent.at(-1).file, /\.xlsx$/);
  assert.ok(sent.at(-1).chat === "50");
});

test("scale: 300 students via one group link, mentor list and exports stay under limits", async () => {
  const { as, store, mainStore, d1 } = setup();
  const mentor = as({ id: 1, first_name: "Пётр" });
  const g = (await mentor("POST", "/mentor/codes", { group: true, max: 300 })).body;
  const t0 = Date.now();
  for (let i = 0; i < 300; i += 30) await Promise.all(Array.from({ length: 30 }, (_, k) => as({ id: 1000 + i + k, first_name: `S${i + k}` })("POST", "/join", { code: g.code })));
  assert.equal((await as({ id: 5000, first_name: "Extra" })("POST", "/join", { code: g.code })).body.error, "code_full", "301-й не входит");
  for (let i = 0; i < 300; i += 3) await as({ id: 1000 + i, first_name: `S${i}` })("POST", "/leads", { telegram: `@x${i}`, source: "YouTube" });
  const m = await mentor("GET", "/mentor");
  assert.equal(m.body.students.length, 300);
  assert.ok(m.queries < 15, `mentor: ${m.queries}`);
  assert.equal(m.body.students.filter((s) => s.leads === 1).length, 100);
  // утреннее окно: 3 часа × 3 ученика в минуту = 540 > 100 нуждающихся
  let sentTotal = 0;
  let maxQ = 0;
  for (let min = 0; min < 60 && sentTotal < 100; min++) {
    d1.queries = 0;
    sentTotal += (await runAcademyExports({ store, mainStore, env, now: Date.parse("2026-11-17T05:00:00Z") + min * 60000, fetchImpl: fakeFetch })).length;
    maxQ = Math.max(maxQ, d1.queries);
  }
  assert.equal(sentTotal, 100, "всем, у кого есть лиды, выгрузка ушла за первый же час");
  assert.ok(maxQ < 50, `cron: ${maxQ} запросов за минуту`);
  console.log(`300 учеников: вход+лиды ${Date.now() - t0} мс, кабинет наставника ${m.queries} запросов, cron до ${maxQ} запросов/мин`);
});

test("expenses: add, edit, delete, no double-tap duplicates, survive backup import", async () => {
  const { as } = setup();
  const me = as({ id: 1, first_name: "Пётр" });
  const e = await me("POST", "/expenses", { amount: "1 500", kind: "traffic", dir: "mfo", source: "Reels", note: "закуп", date: "2026-11-10" });
  assert.equal(e.status, 201);
  assert.equal(e.body.amount, 1500);
  assert.equal((await me("POST", "/expenses", { amount: 1500, kind: "traffic", dir: "mfo", note: "закуп", date: "2026-11-10" })).body.id, e.body.id, "двойной тап");
  assert.equal((await me("POST", "/expenses", { amount: 0 })).status, 400);
  const bad = await me("POST", "/expenses", { amount: 10, kind: "hack", dir: "xxx", date: "nope" });
  assert.equal(bad.body.kind, "other");
  assert.equal(bad.body.dir, "all");
  const upd = await me("PATCH", `/expenses/${e.body.id}`, { amount: 2000 });
  assert.equal(upd.body.amount, 2000);
  assert.equal(upd.body.source, "Reels", "остальные поля сохранились");
  await me("DELETE", `/expenses/${bad.body.id}`);
  const st = (await me("GET", "/state")).body;
  assert.deepEqual(st.expenses.map((x) => x.amount), [2000]);
  // восстановление из бэкапа на «чистом» аккаунте
  const other = as({ id: 1, first_name: "Пётр" });
  await me("DELETE", `/expenses/${e.body.id}`);
  const imp = await other("POST", "/import", { leads: [], expenses: [upd.body, { amount: 300, kind: "services" }] });
  assert.equal(imp.status, 200);
  assert.equal((await me("GET", "/state")).body.expenses.length, 2);
});
