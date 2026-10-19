// ИИ в боте (Claude). С ним можно говорить как с человеком: он помнит последние сообщения,
// смотрит карточки и цифры, а действия (записать созвон, статус, отчёт, комментарий, сообщение команде)
// выполняет тот же код, что и обычные команды. Нет секрета ANTHROPIC_API_KEY — ИИ выключен.
import Anthropic from "@anthropic-ai/sdk";
import { ROLES, REPORT_FIELDS, isClosed, mskKey, mskTime, addDaysKey, weekday, statusLabel, pace, fmtWhen, daySlots, rangesText } from "../public/lib/model.js";
import { rnp, lidorubStats, periodRange } from "../public/lib/stats.js";

// Основная модель — Sonnet: понимает сложные просьбы и сама находит, что поменять в CRM.
// Потратили 80% месячного бюджета — до 1-го числа переключаемся на дешёвый Haiku, ИИ не выключается.
export const AI_MODEL = "claude-sonnet-5-5";
export const CHEAP_MODEL = "claude-haiku-5-5";
export const DAILY_LIMIT = 300; // запросов в день
export const MONTHLY_BUDGET = 30; // $ в месяц — дальше ИИ молчит до 1-го числа
export const pickModel = (env, use) => env.AI_MODEL || (use && use.cost >= 0.8 * (Number(env.AI_MONTHLY_BUDGET) || MONTHLY_BUDGET) ? CHEAP_MODEL : AI_MODEL);
// У каждой модели свой способ выключить долгие размышления: бот должен отвечать за секунды.
const modelOpts = (model) =>
  model.startsWith("claude-sonnet-5-5") ? { thinking: { type: "between_tools" }, output_config: { effort: "medium" } }
  : model.startsWith("claude-haiku") ? { thinking: { type: "disabled" }, output_config: { effort: "low" } }
  : { output_config: { effort: "low" } };
const HISTORY_TURNS = 8;
const HISTORY_TTL = 6 * 3600_000;
const MAX_STEPS = 4;

// $ за 1M токенов: вход / выход. Кеш: запись ×1.25, чтение ×0.1 от входа.
const PRICES = { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10], "claude-opus-5-5": [4, 20] };
export function costOf(model, u = {}) {
  const [i, o] = PRICES[model] || PRICES[AI_MODEL];
  return ((u.input_tokens || 0) * i + (u.cache_creation_input_tokens || 0) * i * 1.25 + (u.cache_read_input_tokens || 0) * i * 0.1 + (u.output_tokens || 0) * o) / 1e6;
}

export const AI_STATUSES = ["held", "ndz", "paid", "prepaid", "thinking", "resched", "refuse_bank", "refuse_personal", "ignore", "invalid"];
export const READ_TOOLS = new Set(["client_info", "list_clients", "stats"]);

const SYSTEM = `Ты — ассистент отдела продаж «Команда Рыжикова» в Telegram-боте. Ниша — обучение РКО и банковским партнёркам (ИП на НПД, офферы банков). Собственник — Петя Рыжиков.
Роли: собственник, РОП (руководитель отдела продаж), менеджеры ОП — диагносты (проводят созвоны-диагностики и продают обучение), лидоруб (находит лидов и записывает их на созвоны).
Ты свой человек в команде: общаешься живо и по-человечески, понимаешь сленг, опечатки, сокращения («тёмыч», «димон», «ндз», «лм», «рко», «100к»), голосовые, расшифрованные в текст. Помнишь последние сообщения диалога — «его», «этого клиента», «на то же время» относятся к ним.

ДЕЙСТВИЯ — через инструменты, никогда не говори «сделал», если не вызвал инструмент:
- Записать на созвон или внести прошедший созвон → book_calls (несколько — одним вызовом). Даты от «Сегодня» в контексте, время московское. Если пишет диагност и не назвал другого — к нему самому. Не ясно к кому или во сколько — спроси.
- Итог по клиенту (пришёл / НДЗ / оплатил / предоплата / думает / перенос / отказ банки / отказ по личным / игнор / невалид) → set_status. «100к» = 100000.
- Отчёт после диагностики своими словами → save_report (разложи по полям, чего нет — null; итог, если назван, — в status).
- Заметка, договорённость, «запиши что…» по клиенту → add_comment.
- Окна — когда диагност готов брать созвоны. «Окна Тёме завтра с 18 до 21», «Дима всю неделю свободен с 12 до 15» → set_windows. Записывая на созвон, предлагай свободные слоты из окон (в контексте); если просят время вне окна — запиши, но скажи об этом.
- Новый лид без созвона → create_lead. Отменить созвон → cancel_call.
- Перенести созвон → reschedule_call. «Мой лид с 21:00 на 16:00» — ищи в «Предстоящие созвоны» созвон автора на это время; клиента можно не называть, передай from_date/from_time. «Перенеси на завтра» без времени — то же время на завтра.
- Поменять имя, ник, телефон, инфо, договорённости, сумму → update_client. Удалить клиента (дубль, мусор) → delete_client, только по прямой просьбе.
- Передать что-то человеку или всем → send_message (текст от первого лица автора).
Клиента указывай @ником без @, телефоном или именем — как в контексте. Сомневаешься, кто это, — сначала client_info или list_clients.
После действия не пересказывай его — бот сам пришлёт подтверждение. Можно добавить одну короткую фразу по делу или ничего.

ВОПРОСЫ — отвечай сам по контексту; за деталями клиента — client_info, за списками — list_clients, за цифрами за другой период — stats. Только факты из данных, ничего не выдумывай. Нет данных — так и скажи.
Можно помогать по работе: написать сообщение клиенту для дожима, ответ на возражение, напоминание, разобрать созвон, подсказать по регламенту. Тон Пети: уверенный, прямой, по делу, без воды и канцелярита.
Непонятно, чего хотят, — один короткий уточняющий вопрос.

ФОРМАТ: русский, на «ты», коротко (обычно 1–5 строк), обычный текст без markdown (никаких **, #, таблиц). Суммы с пробелами: 120 000 ₽. Эмодзи — по минимуму.
Зарплаты, чистую выручку и ведомость ты не видишь и не обсуждаешь.`;

const nullable = (type, extra = {}) => ({ type: [type, "null"], ...extra });
const obj = (properties) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const clientRef = { type: "string", description: "@ник без @, телефон или имя клиента" };

export function aiTools({ closers, team }) {
  const mops = closers.map((u) => u.name);
  const tools = [
    { name: "book_calls", description: "Записать одного или нескольких клиентов на созвон к диагносту, перенести созвон на новое время или внести уже прошедший. Бот проверит занятость, заведёт клиента, если его нет, уведомит диагноста.", input_schema: obj({ items: { type: "array", items: obj({ mop: { type: "string", enum: mops.length ? mops : ["—"] }, date: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string", description: "HH:MM по Москве" }, client_name: nullable("string"), client_nick: nullable("string", { description: "без @" }), phone: nullable("string") }) } }) },
    { name: "set_status", description: "Итог по клиенту: held — пришёл на созвон, ndz — не пришёл, paid — оплатил, prepaid — предоплата, thinking — думает, resched — перенос, refuse_bank — отказ по банкам, refuse_personal — отказ по личным, ignore — игнор, invalid — невалид.", input_schema: obj({ client: clientRef, status: { type: "string", enum: AI_STATUSES }, sum: nullable("number", { description: "₽" }) }) },
    { name: "save_report", description: "Сохранить отчёт после диагностики в карточку клиента.", input_schema: obj({ client: clientRef, ...Object.fromEntries(REPORT_FIELDS.map((f) => [f.id, nullable("string", { description: f.label })])), status: nullable("string", { enum: ["paid", "prepaid", "thinking", "resched", "refuse_personal", "refuse_bank", "invalid", null] }), sum: nullable("number") }) },
    { name: "add_comment", description: "Добавить комментарий/заметку в карточку клиента. Все, кто ведёт клиента, получат уведомление.", input_schema: obj({ client: clientRef, text: { type: "string" } }) },
    { name: "create_lead", description: "Завести нового лида без записи на созвон.", input_schema: obj({ name: nullable("string"), nick: nullable("string", { description: "без @" }), phone: nullable("string"), info: nullable("string", { description: "что известно о клиенте" }) }) },
    { name: "cancel_call", description: "Отменить ближайший назначенный созвон клиента.", input_schema: obj({ client: clientRef }) },
    { name: "reschedule_call", description: "Перенести назначенный созвон на другое время/день (или другому диагносту). Созвон находим по клиенту, а если клиент не назван («мой лид с 21:00») — по дню и времени из списка созвонов в контексте. Старое время освобождается, диагност и лидоруб получают уведомление.", input_schema: obj({ client: nullable("string", { description: "@ник без @, телефон или имя; null — искать по времени" }), from_date: nullable("string", { description: "YYYY-MM-DD текущего созвона" }), from_time: nullable("string", { description: "HH:MM текущего созвона" }), mop: nullable("string", { enum: [...mops, null], description: "чей созвон (если не автора)" }), to_date: { type: "string", description: "YYYY-MM-DD новая дата" }, to_time: { type: "string", description: "HH:MM по Москве" }, to_mop: nullable("string", { enum: [...mops, null], description: "передать другому диагносту; null — тот же" }) }) },
    { name: "update_client", description: "Изменить данные карточки клиента: имя, ник, телефон, инфо, договорённости/дальнейшие шаги, сумму тарифа. null — не менять.", input_schema: obj({ client: clientRef, name: nullable("string"), nick: nullable("string", { description: "без @" }), phone: nullable("string"), info: nullable("string", { description: "дописать к инфо" }), next_steps: nullable("string"), wanted_sum: nullable("number") }) },
    { name: "delete_client", description: "Удалить клиента (уходит в корзину, руководство может восстановить). Только если прямо просят удалить — дубль, мусор, ошибочно заведён.", input_schema: obj({ client: clientRef, reason: nullable("string") }) },
    { name: "set_windows", description: "Открыть или закрыть окна диагноста (когда он готов брать созвоны) на один или несколько дней. Пустой ranges — закрыть окна на эти дни. «С 18 до 21» = from 18:00, to 21:00.", input_schema: obj({ mop: { type: "string", enum: mops.length ? mops : ["—"] }, dates: { type: "array", items: { type: "string", description: "YYYY-MM-DD" } }, ranges: { type: "array", items: obj({ from: { type: "string", description: "HH:MM" }, to: { type: "string", description: "HH:MM" } }) } }) },
    { name: "send_message", description: "Передать сообщение члену команды от имени автора или всем.", input_schema: obj({ to: { type: "string", enum: [...team.map((u) => u.name), "всем"] }, text: { type: "string" } }) },
    { name: "client_info", description: "Карточка клиента: контакты, статус, созвоны, отчёты, история, комментарии.", input_schema: obj({ client: clientRef }) },
    { name: "list_clients", description: "Список клиентов по статусу и/или диагносту (до 40).", input_schema: obj({ status: nullable("string", { enum: ["new", "in_work", "ndz", "resched", "thinking", "prepaid", "paid", "refuse_personal", "refuse_bank", "ignore", "invalid", null] }), mop: nullable("string", { enum: [...mops, null] }) }) },
    { name: "stats", description: "РнП за любой период: лиды, назначено, проведено, продажи, предоплаты, отказы, по людям; воронка лидоруба.", input_schema: obj({ from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } }) },
  ];
  // Без strict: входы всё равно проверяем в коде, а лишняя строгость схемы — риск 400 на всём ИИ.
  return tools;
}

const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const rub = (n) => `${Math.round(n || 0).toLocaleString("ru-RU")} ₽`;
const cname = (c) => [c.telegram, c.name].filter(Boolean).join(" ") || c.phone || "без имени";
const namer = (users) => (id) => users.find((u) => u.id === id)?.name || String(id || "—").replace(/^legacy:/, "");
const rnpLine = (r) => `лидов ${r.leads}, назначено ${r.scheduled}, проведено ${r.held} (${pct(r.crHeld)}), продаж ${r.sales} на ${rub(r.salesSum)} (CR ${pct(r.crSale)}), предоплат ${r.prepays} на ${rub(r.prepaySum)}, отказ банки ${r.bank}, потенциал ${r.potential} на ${rub(r.potentialSum)}`;

function statsText({ users, clients, legacy, settings, from, to }) {
  const name = namer(users);
  const r = rnp(clients, legacy, { from, to, aliases: settings.aliases });
  const out = [`РнП ${from} — ${to}: ${rnpLine(r.total)}`];
  for (const [id, v] of Object.entries(r.byPerson)) if (v.leads || v.scheduled || v.sales || v.prepays) out.push(`  ${name(id)}: ${rnpLine(v)}`);
  const lr = lidorubStats(clients, legacy, { from, to, aliases: settings.aliases });
  for (const [id, v] of Object.entries(lr.byPerson)) out.push(`  Лидоруб ${name(id)}: получено ${v.received}, ЛМ ${v.lm}, записано ${v.scheduled}, невалид ${v.invalid}`);
  return out.join("\n");
}

// Срез базы для ИИ. Денег ведомости тут нет вообще.
export function snapshot({ me, users, clients, legacy = {}, settings = {}, windows = [], now = Date.now() }) {
  const today = mskKey(now);
  const name = namer(users);
  const closers = users.filter((u) => ["mop", "rop"].includes(u.role));
  const out = [];
  out.push(`Сегодня: ${today} (${weekday(today)}), сейчас ${mskTime(now)} МСК. Завтра: ${addDaysKey(today, 1)} (${weekday(addDaysKey(today, 1))}).`);
  out.push(`Пишет: ${me.name} — ${ROLES[me.role]}.`);
  out.push(`Команда: ${users.map((u) => `${u.name} — ${ROLES[u.role]}${u.username ? ` (@${u.username})` : ""}`).join("; ")}.`);
  out.push(`Диагносты: ${closers.map((u) => u.name).join(", ") || "нет"}.`);
  const month = rnp(clients, legacy, { ...periodRange("month", today), aliases: settings.aliases });
  const plan = Number(settings.salesPlan) || 0;
  if (plan) {
    const p = pace(month.total.sales, plan, today);
    out.push(`План месяца: ${plan} продаж. Сделано ${p.done}, к сегодня должно быть ${p.expected}, прогноз ${p.forecast}, осталось ${p.left} — нужно ${p.perDay} в день, дней осталось ${p.daysLeft}.`);
  }
  for (const [p, label] of [["today", "сегодня"], ["yesterday", "вчера"], ["7", "7 дней"], ["month", "месяц"], ["prev_month", "прошлый месяц"]]) {
    const { from, to } = periodRange(p, today);
    out.push(`\n(${label}) ${statsText({ users, clients, legacy, settings, from, to })}`);
  }
  const calls = [];
  for (const c of clients) for (const call of c.calls || []) {
    const day = mskKey(Date.parse(call.at));
    if (day === today || day === addDaysKey(today, 1)) calls.push({ day, t: mskTime(Date.parse(call.at)), c, call });
  }
  calls.sort((a, b) => (a.day + a.t).localeCompare(b.day + b.t));
  const outcome = { held: "пришёл", ndz: "НДЗ", moved: "перенесён/отменён" };
  const upcoming = [];
  for (const c of clients) for (const call of c.calls || []) if (!call.outcome && Date.parse(call.at) > now - 3 * 3600_000 && Date.parse(call.at) < now + 8 * 86400_000) upcoming.push({ c, call });
  upcoming.sort((a, b) => Date.parse(a.call.at) - Date.parse(b.call.at));
  out.push(`\nПредстоящие созвоны (назначены, 7 дней): дата время — диагност — клиент — кто записал`);
  out.push(upcoming.slice(0, 80).map(({ c, call }) => `  ${mskKey(Date.parse(call.at))} ${mskTime(Date.parse(call.at))} — ${name(call.mopId)}${call.mopId === me.id ? " (автор)" : ""} — ${cname(c)} — ${name(call.setBy)}`).join("\n") || "  нет");
  out.push(`\nСозвоны сегодня и завтра:\n${calls.map((x) => `  ${x.day === today ? "сегодня" : "завтра"} ${x.t} — ${name(x.call.mopId)} — ${cname(x.c)}${x.call.outcome ? ` (${outcome[x.call.outcome] || x.call.outcome}${x.call.outcome === "held" && !x.call.reportAt ? ", нет отчёта" : ""})` : ""}`).join("\n") || "  нет"}`);
  const wl = [];
  for (let i = 0; i < 7; i++) {
    const day = addDaysKey(today, i);
    for (const m of closers) {
      const w = windows.find((x) => x.mopId === m.id && x.day === day);
      if (!w?.ranges?.length) continue;
      const busy = clients.flatMap((c) => (c.calls || []).filter((x) => x.mopId === m.id && !["moved", "ndz"].includes(x.outcome) && mskKey(Date.parse(x.at)) === day).map((x) => ({ time: mskTime(Date.parse(x.at)) })));
      const sl = daySlots(day, w.ranges, busy, now);
      wl.push(`  ${day} (${weekday(day)}) ${m.name}: окно ${rangesText(w.ranges)}; свободно ${sl.filter((x) => x.state === "free").map((x) => x.time).join(", ") || "нет"}; занято ${sl.filter((x) => x.state === "busy").map((x) => x.time).join(", ") || "—"}`);
    }
  }
  out.push(`\nОкна диагностов на 7 дней:\n${wl.join("\n") || "  не заданы"}`);
  const noReport = [];
  for (const c of clients) for (const call of c.calls || []) if (call.outcome === "held" && !call.reportAt && !call.legacy) noReport.push(`${name(call.mopId)} — ${cname(c)}`);
  if (noReport.length) out.push(`Без отчёта после созвона: ${noReport.slice(0, 20).join("; ")}`);
  const recent = clients
    .filter((c) => !isClosed(c.status) || Date.parse(c.updatedAt || 0) > now - 30 * 86400_000)
    .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0))
    .slice(0, 60);
  out.push(`\nКлиенты (последние ${recent.length} из ${clients.length}, остальные — через list_clients/client_info): @ник имя | статус | диагност | сумма`);
  for (const c of recent) out.push(`  ${cname(c)} | ${statusLabel(c.status)} | ${name(c.mopId)}${c.wantedSum ? ` | ${rub(c.wantedSum)}` : ""}`);
  return out.join("\n");
}

// Клиент по нику, телефону или имени.
export function findClient(clients, ref) {
  const q = String(ref || "").trim().replace(/^@/, "").toLowerCase().replace(/ё/g, "е");
  if (!q) return { list: [] };
  const byNick = clients.filter((c) => c.telegram?.replace(/^@/, "").toLowerCase() === q);
  if (byNick.length) return { c: byNick[0], list: byNick };
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 10) {
    const byPhone = clients.filter((c) => c.phone?.replace(/\D/g, "").endsWith(digits.slice(-10)));
    if (byPhone.length) return { c: byPhone[0], list: byPhone };
  }
  const nm = (c) => (c.name || "").toLowerCase().replace(/ё/g, "е");
  let list = clients.filter((c) => nm(c) === q);
  if (!list.length) list = clients.filter((c) => nm(c) && (nm(c).startsWith(q) || q.startsWith(nm(c).split(" ")[0])));
  const open = list.filter((c) => !isClosed(c.status));
  if (open.length) list = open;
  list.sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
  return list.length === 1 ? { c: list[0], list } : { list };
}

function readTool(name, input, { users, clients, legacy, settings }) {
  const who = namer(users);
  if (name === "client_info") {
    const { c, list } = findClient(clients, input.client);
    if (!c) return list.length ? `Несколько совпадений: ${list.slice(0, 8).map(cname).join("; ")}` : "Не найден";
    const calls = (c.calls || []).map((x) => `  ${fmtWhen(Date.parse(x.at))} — ${who(x.mopId)} — ${x.outcome || "назначен"}${x.report ? `\n    отчёт: ${REPORT_FIELDS.map((f) => x.report[f.id] && `${f.label}: ${x.report[f.id]}`).filter(Boolean).join("; ")}` : ""}`);
    return [
      `${cname(c)}${c.phone ? ` · ${c.phone}` : ""} | статус: ${statusLabel(c.status)} | диагност: ${who(c.mopId)} | лидоруб: ${who(c.lidorubId)}${c.wantedSum ? ` | сумма: ${rub(c.wantedSum)}` : ""}`,
      c.info ? `Инфо: ${String(c.info).slice(0, 600)}` : "",
      c.nextSteps ? `Следующие шаги: ${c.nextSteps}` : "",
      calls.length ? `Созвоны:\n${calls.join("\n")}` : "Созвонов нет",
      `История:\n${(c.history || []).slice(0, 10).map((x) => `  ${String(x.at).slice(0, 10)} ${who(x.by)}: ${x.text}`).join("\n")}`,
    ].filter(Boolean).join("\n").slice(0, 4000);
  }
  if (name === "list_clients") {
    const mop = input.mop && users.find((u) => u.name === input.mop);
    const list = clients
      .filter((c) => !input.status || (input.status === "ndz" ? /^ndz/.test(c.status) : c.status === input.status))
      .filter((c) => !mop || c.mopId === mop.id)
      .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
    return `Всего ${list.length}:\n${list.slice(0, 40).map((c) => `  ${cname(c)} | ${statusLabel(c.status)} | ${who(c.mopId)}${c.wantedSum ? ` | ${rub(c.wantedSum)}` : ""} | обновлён ${String(c.updatedAt || "").slice(0, 10)}`).join("\n")}`;
  }
  if (name === "stats") {
    const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
    if (!ok(input.from) || !ok(input.to)) return "Нужны даты YYYY-MM-DD";
    return statsText({ users, clients, legacy, settings, from: input.from, to: input.to });
  }
  return "Неизвестный инструмент";
}

// ---------- деньги: лимит в день, бюджет в месяц, учёт расхода ----------
export async function usage(store, now = Date.now()) {
  const u = (await store.get("meta", "ai-usage")) || {};
  const day = mskKey(now);
  const month = day.slice(0, 7);
  return { id: "ai-usage", day, month, n: u.day === day ? u.n || 0 : 0, cost: u.month === month ? u.cost || 0 : 0, calls: u.month === month ? u.calls || 0 : 0, tokens: u.month === month ? u.tokens || 0 : 0 };
}
const budgetOf = (env) => Number(env.AI_MONTHLY_BUDGET) || MONTHLY_BUDGET;

// ---------- память диалога ----------
export const plain = (html) => String(html || "").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
export async function remember(store, userId, userText, botTexts, now = Date.now()) {
  if (!userText) return;
  const prev = (await store.get("chat", userId)) || { id: userId, turns: [] };
  const b = plain(botTexts.join("\n")).trim().slice(0, 700);
  const turns = [...prev.turns.filter((t) => now - t.at < HISTORY_TTL), { u: userText.slice(0, 700), b: b || "(без ответа)", at: now }].slice(-HISTORY_TURNS);
  await store.put("chat", userId, { id: userId, turns });
}
async function recall(store, userId, now) {
  const prev = (await store.get("chat", userId)) || { turns: [] };
  return prev.turns.filter((t) => now - t.at < HISTORY_TTL).flatMap((t) => [{ role: "user", content: t.u }, { role: "assistant", content: t.b }]);
}

// Разговор с ИИ. act(name, input) выполняет действие и возвращает итог строкой.
// → { text } | { error, detail } | null (ИИ выключен)
export async function chat(text, { me, users, clients, legacy = {}, settings = {}, windows = [], store, env, now = Date.now(), client = null, act }) {
  if (!env.ANTHROPIC_API_KEY && !client) return null;
  const use = await usage(store, now);
  if (use.n >= (Number(env.AI_DAILY_LIMIT) || DAILY_LIMIT)) return { error: "limit" };
  if (use.cost >= budgetOf(env)) return { error: "budget" };
  const ai = client || new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 25_000 });
  const model = pickModel(env, use);
  const closers = users.filter((u) => ["mop", "rop"].includes(u.role));
  const tools = aiTools({ closers, team: users.filter((u) => u.id !== me.id) });
  const data = { users, clients, legacy, settings };
  const messages = [
    ...(await recall(store, me.id, now)),
    { role: "user", content: `<контекст>\n${snapshot({ me, users, clients, legacy, settings, windows, now })}\n</контекст>\n\n${me.name}: ${text.slice(0, 3000)}` },
  ];
  let cost = 0;
  let tokens = 0;
  let calls = 0;
  let answer = "";
  let acted = false;
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await ai.messages.create({
        model,
        max_tokens: 2000,
        ...modelOpts(model),
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        tools,
        tool_choice: { type: "auto" },
        messages,
      });
      calls++;
      cost += costOf(model, res.usage);
      tokens += (res.usage?.input_tokens || 0) + (res.usage?.cache_read_input_tokens || 0) + (res.usage?.cache_creation_input_tokens || 0) + (res.usage?.output_tokens || 0);
      if (res.stop_reason === "refusal") return { error: "refusal" };
      answer = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      const uses = res.content.filter((b) => b.type === "tool_use");
      if (!uses.length) break;
      // Действия выполняем и заканчиваем: подтверждение пришлёт сам бот.
      const actions = uses.filter((b) => !READ_TOOLS.has(b.name));
      if (actions.length) {
        for (const b of actions) await act(b.name, b.input || {});
        acted = true;
        break;
      }
      // Справки — отдаём ИИ и даём ответить.
      messages.push({ role: "assistant", content: res.content });
      messages.push({ role: "user", content: uses.map((b) => ({ type: "tool_result", tool_use_id: b.id, content: readTool(b.name, b.input || {}, data) })) });
      if (step === MAX_STEPS - 1) answer ||= "Запутался в данных 🙈 Спроси конкретнее.";
    }
  } catch (e) {
    const st = e?.status;
    return { error: st === 401 ? "key" : st === 429 ? "rate" : /credit|balance/i.test(e?.message || "") ? "balance" : "api", detail: String(e?.message || e).slice(0, 200) };
  } finally {
    const fresh = await usage(store, now);
    await store.put("meta", "ai-usage", { ...fresh, n: fresh.n + 1, cost: fresh.cost + cost, calls: fresh.calls + calls, tokens: fresh.tokens + tokens });
  }
  return { text: answer.slice(0, 3500), acted };
}

// Проверка ключа и статистика расхода — для /ai.
export async function aiStatus({ store, env, users = [], now = Date.now(), client = null }) {
  const use = await usage(store, now);
  const model = pickModel(env, use);
  const day = Number(mskKey(now).slice(8, 10));
  const dim = new Date(Date.UTC(+use.month.slice(0, 4), +use.month.slice(5, 7), 0)).getUTCDate();
  const lines = [];
  if (!env.ANTHROPIC_API_KEY && !client) {
    lines.push("🔴 ИИ выключен: воркер не видит секрет ANTHROPIC_API_KEY.");
    // Только имена, без значений: видно, если секрет назвали иначе.
    const near = Object.keys(env).filter((k) => /anthrop|claude|api|key|secret|token/i.test(k) && k !== "BOT_TOKEN");
    lines.push(near.length ? `Похожие переменные в воркере: ${near.join(", ")} — переименуй в ANTHROPIC_API_KEY.` : "В воркере нет ни одной похожей переменной — секрет добавлен не туда (другой воркер или «Build variables»).");
  }
  else {
    try {
      const ai = client || new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 15_000 });
      const t = Date.now();
      // С теми же инструментами и системным промптом, что в бою: ошибка схемы всплывёт здесь, а не у команды.
      const closers = users.filter((u) => ["mop", "rop"].includes(u.role));
      await ai.messages.create({ model, max_tokens: 64, ...modelOpts(model), system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }], tools: aiTools({ closers, team: users }), tool_choice: { type: "auto" }, messages: [{ role: "user", content: "Ответь одним словом: ок" }] });
      lines.push(`🟢 ИИ работает: ключ принят, модель ${model}${model === CHEAP_MODEL && !env.AI_MODEL ? " (экономный режим: потрачено 80% бюджета)" : ""}, ответ за ${((Date.now() - t) / 1000).toFixed(1)} с.`);
    } catch (e) {
      const st = e?.status;
      lines.push(`🔴 ИИ не отвечает: ${st === 401 ? "ключ не подходит — проверь секрет ANTHROPIC_API_KEY" : /credit|balance/i.test(e?.message || "") ? "на балансе Anthropic нет денег" : String(e?.message || e).slice(0, 160)}`);
    }
  }
  lines.push(`🎙 Голосовые: ${env.AI ? "подключены (Whisper, Cloudflare)" : "нет привязки AI в Cloudflare"}`);
  lines.push("");
  lines.push(`Сегодня: ${use.n} из ${Number(env.AI_DAILY_LIMIT) || DAILY_LIMIT} сообщений к ИИ`);
  lines.push(`Месяц: ${use.calls} запросов, ${Math.round(use.tokens / 1000)}K токенов, потрачено $${use.cost.toFixed(2)} из лимита $${budgetOf(env)}`);
  if (day > 0) lines.push(`Прогноз на месяц: ~$${((use.cost / day) * dim).toFixed(2)}`);
  return lines.join("\n");
}

// Голосовое → текст. Whisper в Cloudflare Workers AI (бесплатный дневной лимит), ключ не нужен.
export async function transcribe(voice, { env, tg }) {
  if (!env.AI || !voice?.file_id) return null;
  if (voice.duration > 300 || voice.file_size > 20_000_000) return null;
  const buf = await tg.downloadFile(voice.file_id);
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const r = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: btoa(bin), language: "ru" });
  return String(r?.text || "").trim() || null;
}
