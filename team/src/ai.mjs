// ИИ в боте (Claude): подключается, только когда правила не поняли сообщение.
// Сам ничего не пишет в базу — выбирает действие (записать созвон, статус, написать человеку),
// а выполняет его тот же код, что и для обычных команд. Нет ключа ANTHROPIC_API_KEY — ИИ выключен.
import Anthropic from "@anthropic-ai/sdk";
import { ROLES, STATUSES, isClosed, mskKey, mskTime, addDaysKey, weekday, statusLabel, pace } from "../public/lib/model.js";
import { rnp, lidorubStats, periodRange } from "../public/lib/stats.js";

export const AI_MODEL = "claude-haiku-5-5";
const DAILY_LIMIT = 300;

export const AI_STATUSES = ["held", "ndz", "paid", "prepaid", "thinking", "resched", "refuse_bank", "refuse_personal", "ignore", "invalid"];

const SYSTEM = `Ты — бот отдела продаж «Команда Рыжикова» в Telegram. Ниша — обучение РКО и банковским партнёркам.
Роли: собственник (Петя), РОП, менеджеры ОП (диагносты — проводят созвоны с клиентами), лидоруб (находит лидов и записывает их на созвоны).
Тебе пишет член команды. Обычные команды бот уже разбирает сам — к тебе попадают фразы, которые он не понял.

Что делать:
- Просят записать клиента(ов) на созвон или сообщают, что созвон был, а в CRM его нет → вызови book_calls. Несколько созвонов — все в одном вызове. Даты считай от «Сегодня» в контексте, время — московское. Диагноста бери только из списка диагностов; не понял к кому — спроси, ничего не вызывая. Если пишет диагност и не назвал другого — созвон к нему самому.
- Сообщают итог по клиенту (пришёл, не пришёл/НДЗ, оплатил, предоплата, думает, перенос, отказ по банкам, отказ по личным, игнор, невалид) → set_status. Клиента указывай @ником (без @) или именем, как в списке клиентов. Суммы: «100к» = 100000.
- Просят передать что-то члену команды или всем → send_message. Текст передавай от первого лица автора, без «он просил передать».
- Вопрос по цифрам, созвонам, клиентам, плану → ответь сам по контексту ниже. Только факты из контекста, ничего не придумывай. Нет данных — так и скажи и подскажи, где посмотреть в приложении (РнП, Клиенты, Созвоны).
- Непонятно, что нужно, — задай один короткий уточняющий вопрос.

Стиль ответа: по-русски, коротко, по делу, на «ты», без канцелярита, без markdown (никаких **, #, таблиц). Числа с пробелами: 120 000 ₽. Можно 1–2 эмодзи.
Зарплаты, чистую выручку и ведомость не обсуждаешь — их нет в контексте.`;

const nullable = (type) => ({ type: [type, "null"] });

export function aiTools({ closers, team }) {
  return [
    {
      name: "book_calls",
      description: "Записать одного или нескольких клиентов на созвон к диагносту (или внести уже прошедший созвон). Бот сам проверит занятость, заведёт клиента, если его нет, и уведомит диагноста.",
      strict: true,
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                mop: { type: "string", enum: closers.map((u) => u.name), description: "Диагност" },
                date: { type: "string", description: "Дата YYYY-MM-DD" },
                time: { type: "string", description: "Время по Москве HH:MM" },
                client_name: { ...nullable("string"), description: "Имя клиента" },
                client_nick: { ...nullable("string"), description: "Telegram-ник клиента без @" },
                phone: { ...nullable("string"), description: "Телефон клиента" },
              },
              required: ["mop", "date", "time", "client_name", "client_nick", "phone"],
            },
          },
        },
        required: ["items"],
      },
    },
    {
      name: "set_status",
      description: "Отметить итог по клиенту: held — пришёл на созвон, ndz — не пришёл, paid — оплатил, prepaid — предоплата, thinking — думает, resched — перенос, refuse_bank — отказ по банкам, refuse_personal — отказ по личным, ignore — игнор, invalid — невалид.",
      strict: true,
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          client: { type: "string", description: "@ник без @ или имя клиента" },
          status: { type: "string", enum: AI_STATUSES },
          sum: { ...nullable("number"), description: "Сумма в рублях, если названа" },
        },
        required: ["client", "status", "sum"],
      },
    },
    {
      name: "send_message",
      description: "Передать сообщение члену команды от имени автора (или всем).",
      strict: true,
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          to: { type: "string", enum: [...team.map((u) => u.name), "всем"] },
          text: { type: "string" },
        },
        required: ["to", "text"],
      },
    },
  ];
}

const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const rub = (n) => `${Math.round(n || 0).toLocaleString("ru-RU")} ₽`;
const cname = (c) => [c.telegram, c.name].filter(Boolean).join(" ") || c.phone || "без имени";

// Срез базы для ИИ: только то, что видно роли автора. Денег ведомости тут нет вообще.
export function snapshot({ me, users, clients, legacy = {}, settings = {}, now = Date.now() }) {
  const today = mskKey(now);
  const name = (id) => users.find((u) => u.id === id)?.name || "—";
  const closers = users.filter((u) => ["mop", "rop"].includes(u.role));
  const opt = (p) => ({ ...periodRange(p, today), aliases: settings.aliases });
  const line = (r) => `лидов ${r.leads}, назначено ${r.scheduled}, проведено ${r.held} (${pct(r.crHeld)}), продаж ${r.sales} на ${rub(r.salesSum)} (CR ${pct(r.crSale)}), предоплат ${r.prepays} на ${rub(r.prepaySum)}, отказ банки ${r.bank}, потенциал ${r.potential} на ${rub(r.potentialSum)}`;
  const out = [];
  out.push(`Сегодня: ${today} (${weekday(today)}), сейчас ${mskTime(now)} МСК. Завтра: ${addDaysKey(today, 1)} (${weekday(addDaysKey(today, 1))}).`);
  out.push(`Пишет: ${me.name} — ${ROLES[me.role]}.`);
  out.push(`Команда: ${users.map((u) => `${u.name} — ${ROLES[u.role]}${u.username ? ` (@${u.username})` : ""}`).join("; ")}.`);
  out.push(`Диагносты: ${closers.map((u) => u.name).join(", ") || "нет"}.`);

  const month = rnp(clients, legacy, opt("month"));
  const plan = Number(settings.salesPlan) || 0;
  if (plan) {
    const p = pace(month.total.sales, plan, today);
    out.push(`План месяца: ${plan} продаж. Сделано ${p.done}, к сегодня должно быть ${p.expected}, прогноз ${p.forecast}, осталось ${p.left} — нужно ${p.perDay} в день, дней осталось ${p.daysLeft}.`);
  }
  for (const [p, label] of [["today", "Сегодня"], ["yesterday", "Вчера"], ["7", "7 дней"], ["month", "Месяц"], ["prev_month", "Прошлый месяц"]]) {
    const r = p === "month" ? month : rnp(clients, legacy, opt(p));
    out.push(`\nРнП ${label}: ${line(r.total)}`);
    for (const [id, v] of Object.entries(r.byPerson)) if (v.leads || v.scheduled || v.sales || v.prepays) out.push(`  ${name(id)}: ${line(v)}`);
  }
  const lr = lidorubStats(clients, legacy, opt("month"));
  for (const [id, v] of Object.entries(lr.byPerson)) out.push(`Лидоруб ${name(id)} за месяц: получено ${v.received}, ЛМ ${v.lm}, записано ${v.scheduled}, невалид ${v.invalid}`);

  const calls = [];
  for (const c of clients) for (const call of c.calls || []) {
    const day = mskKey(Date.parse(call.at));
    if (day === today || day === addDaysKey(today, 1)) calls.push({ day, t: mskTime(Date.parse(call.at)), c, call });
  }
  calls.sort((a, b) => (a.day + a.t).localeCompare(b.day + b.t));
  const outcome = { held: "пришёл", ndz: "НДЗ", moved: "перенесён" };
  out.push(`\nСозвоны сегодня и завтра:\n${calls.map((x) => `  ${x.day === today ? "сегодня" : "завтра"} ${x.t} — ${name(x.call.mopId)} — ${cname(x.c)}${x.call.outcome ? ` (${outcome[x.call.outcome] || x.call.outcome}${x.call.outcome === "held" && !x.call.reportAt ? ", нет отчёта" : ""})` : ""}`).join("\n") || "  нет"}`);

  const noReport = [];
  for (const c of clients) for (const call of c.calls || []) if (call.outcome === "held" && !call.reportAt && !call.legacy) noReport.push(`${name(call.mopId)} — ${cname(c)}`);
  if (noReport.length) out.push(`Без отчёта после созвона: ${noReport.slice(0, 20).join("; ")}`);

  const recent = clients
    .filter((c) => !isClosed(c.status) || Date.parse(c.updatedAt || 0) > now - 30 * 86400_000)
    .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0))
    .slice(0, 80);
  out.push(`\nКлиенты (последние ${recent.length} из ${clients.length}): @ник имя | статус | диагност | сумма`);
  for (const c of recent) out.push(`  ${cname(c)} | ${statusLabel(c.status)} | ${name(c.mopId)}${c.wantedSum ? ` | ${rub(c.wantedSum)}` : ""}`);
  return out.join("\n");
}

// Лимит запросов в день — страховка от счёта, если что-то зациклится.
async function underLimit(store, env, now) {
  const day = mskKey(now);
  const u = (await store.get("meta", "ai-usage")) || {};
  const n = u.day === day ? u.n || 0 : 0;
  if (n >= (Number(env.AI_DAILY_LIMIT) || DAILY_LIMIT)) return false;
  await store.put("meta", "ai-usage", { id: "ai-usage", day, n: n + 1 });
  return true;
}

// → { text, calls: [{ name, input }] } или { error }
export async function askAI(text, { me, users, clients, legacy, settings, store, env, now = Date.now(), client = null }) {
  if (!env.ANTHROPIC_API_KEY && !client) return null;
  if (!(await underLimit(store, env, now))) return { error: "limit" };
  const ai = client || new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const closers = users.filter((u) => ["mop", "rop"].includes(u.role));
  const team = users.filter((u) => u.id !== me.id);
  try {
    const res = await ai.messages.create({
      model: env.AI_MODEL || AI_MODEL,
      max_tokens: 2000,
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: aiTools({ closers, team }),
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: `<контекст>\n${snapshot({ me, users, clients, legacy, settings, now })}\n</контекст>\n\nСообщение от ${me.name}:\n${text.slice(0, 3000)}` }],
    });
    if (res.stop_reason === "refusal") return { error: "refusal" };
    return {
      text: res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim(),
      calls: res.content.filter((b) => b.type === "tool_use").map((b) => ({ name: b.name, input: b.input })),
    };
  } catch (e) {
    return { error: e?.status === 401 ? "key" : e?.status === 400 && /credit|balance/i.test(e.message) ? "balance" : "api", detail: String(e?.message || e).slice(0, 200) };
  }
}

// Голосовое → текст. Whisper в Cloudflare Workers AI (бесплатный дневной лимит), ключ не нужен.
export async function transcribe(voice, { env, tg }) {
  if (!env.AI || !voice?.file_id) return null;
  if (voice.duration > 300) return null;
  const buf = await tg.downloadFile(voice.file_id);
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const r = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: btoa(bin), language: "ru" });
  return String(r?.text || "").trim() || null;
}

// Клиент из ответа ИИ: по нику, телефону или имени.
export function findClient(clients, ref) {
  const q = String(ref || "").trim().replace(/^@/, "").toLowerCase();
  if (!q) return { list: [] };
  const byNick = clients.filter((c) => c.telegram?.replace(/^@/, "").toLowerCase() === q);
  if (byNick.length) return { c: byNick[0], list: byNick };
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 10) {
    const byPhone = clients.filter((c) => c.phone?.replace(/\D/g, "").endsWith(digits.slice(-10)));
    if (byPhone.length) return { c: byPhone[0], list: byPhone };
  }
  const byName = clients.filter((c) => c.name?.toLowerCase().replace(/ё/g, "е") === q.replace(/ё/g, "е"));
  const open = byName.filter((c) => !isClosed(c.status));
  const list = open.length ? open : byName;
  return list.length === 1 ? { c: list[0], list } : { list };
}

export { STATUSES };
