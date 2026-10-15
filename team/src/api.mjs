import { randomUUID } from "node:crypto";
import { checkInitData, parseIds } from "./auth.mjs";
import { telegram, webhookSecret } from "./telegram.mjs";
import { handleUpdate, BOT_COMMANDS } from "./bot.mjs";
import { dispatch } from "./notify.mjs";
import {
  ROLES, STATUS_IDS, SOURCES, REPORT_FIELDS, AFTER_CALL, DEFAULT_RATES, FOLLOWUP_TOUCHES,
  canSeeMoney, DEFAULT_PAY_LINKS, payoutsOwed, payrollRow, PAYOUT_ROLES, cleanRanges, rangesText, mskKey, addDaysKey, currentCall, ndzCount, clientTitle, statusLabel, fmtWhen,
} from "../public/lib/model.js";

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const str = (v, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
// «68 950,50», «68.950», «99.99», «100 000 ₽» → число. Последние «,» или «.» с 1–2 цифрами — копейки, остальные — разделители тысяч.
export const money = (v) => {
  let t = String(v ?? "").replace(/[\s\u00a0₽]|руб\.?|р\.?$/gi, "");
  const k = t.match(/^(\d+(?:[.,]\d+)?)к$/i);
  if (k) return Math.min(Math.round(Number(k[1].replace(",", ".")) * 1000), 100_000_000);
  const dec = t.match(/[.,](\d{1,2})$/);
  if (dec) t = `${t.slice(0, -dec[0].length).replace(/[.,]/g, "")}.${dec[1]}`;
  else t = t.replace(/[.,]/g, "");
  const n = Math.round(Number(t) * 100) / 100;
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 100_000_000) : 0;
};
const normTelegram = (v) => {
  const s = str(v, 64).replace(/^(?:https?:\/\/)?(?:www\.)?t(?:elegram)?\.me\//i, "").replace(/[/?#].*$/, "").replace(/\s/g, "");
  if (!s) return "";
  return s.startsWith("@") || /^\+?\d/.test(s) ? s : `@${s}`;
};
const isoOrNull = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const nowIso = () => new Date().toISOString();

export const DEFAULT_SETTINGS = { rates: DEFAULT_RATES, monthPlan: 0, salesPlan: 0, personPlans: {}, aliases: {}, payLinks: DEFAULT_PAY_LINKS };
export const loadSettings = async (store) => {
  const s = (await store.get("meta", "settings")) || {};
  return { ...DEFAULT_SETTINGS, ...s, rates: { ...DEFAULT_RATES, ...(s.rates || {}) }, payLinks: s.payLinks?.length ? s.payLinks : DEFAULT_PAY_LINKS };
};

// ---------- доступ ----------
// OWNER_IDS из окружения — всегда собственник. Остальных добавляют в приложении (вкладка «Команда»).
export async function userOf(store, env, tgUser) {
  const id = String(tgUser.id);
  const saved = await store.get("user", id);
  if (parseIds(env.OWNER_IDS).has(id)) {
    return { ...(saved || {}), id, role: "owner", active: true, name: saved?.name || displayName(tgUser), username: tgUser.username || saved?.username || "" };
  }
  return saved?.active ? saved : null;
}

export const displayName = (u) => [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || String(u.id);

async function authenticate(req, env, store) {
  const header = req.headers.get("authorization") || "";
  const initData = header.startsWith("tma ") ? header.slice(4) : "";
  let { user, reason } = checkInitData(initData, env.BOT_TOKEN);
  if (!user && env.DEV_MODE === "1" && !initData) user = { id: Number(env.DEV_USER || 1), first_name: "Dev" };
  if (!user) return { reason };
  const me = await userOf(store, env, user);
  if (!me) {
    // Запомнить, кто стучался: собственник выдаст роль в один тап.
    await store.put("pending", String(user.id), { id: String(user.id), name: displayName(user), username: user.username || "", at: nowIso() });
    return { tg: user, reason: "no_access" };
  }
  return { tg: user, me };
}

// ---------- клиент ----------
export function blankClient(by) {
  const at = nowIso();
  return {
    id: randomUUID(),
    name: "",
    telegram: "",
    phone: "",
    source: SOURCES[0],
    status: "new",
    statusAt: at,
    lidorubId: null,
    mopId: null,
    chatUrl: "",
    info: "",
    wantedSum: 0,
    calls: [],
    events: [],
    touches: [],
    history: [],
    createdAt: at,
    createdBy: by,
    updatedAt: at,
  };
}

export const log = (c, by, text) => {
  c.history = [{ at: nowIso(), by, text }, ...(c.history || [])].slice(0, 60);
};
// ---------- дубли ----------
// Один @ник и один телефон — один клиент. Ключи без регистра и без «@», телефон — последние 10 цифр.
export const nickKey = (t) => String(t || "").trim().replace(/^(?:https?:\/\/)?(?:www\.)?t(?:elegram)?\.me\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "").toLowerCase();
export const phoneKey = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
};
export function findDup(clients, { telegram, phone }, exceptId = null) {
  const n = nickKey(telegram);
  const ph = phoneKey(phone);
  return clients.find((x) => x.id !== exceptId && ((n && !/^\+?\d/.test(n) && nickKey(x.telegram) === n) || (ph && phoneKey(x.phone) === ph))) || null;
}

// Склеить дубль `from` в `to`: созвоны (без повторов по времени), события, история, пустые поля.
export function mergeInto(to, from, by) {
  const near = (a, b) => Math.abs(Date.parse(a.at) - Date.parse(b.at)) < 45 * 60_000;
  for (const call of from.calls || []) {
    const same = to.calls.find((x) => near(x, call) && x.mopId === call.mopId);
    if (!same) to.calls.push(call);
    else if (!same.outcome && call.outcome) Object.assign(same, { outcome: call.outcome, outcomeAt: call.outcomeAt, outcomeBy: call.outcomeBy });
    if (same && call.report && !same.report) Object.assign(same, { report: call.report, reportAt: call.reportAt });
  }
  to.calls.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  to.events = [...(to.events || []), ...(from.events || []).filter((e) => !(to.events || []).some((x) => x.t === e.t && x.at === e.at))];
  for (const f of ["name", "telegram", "phone", "chatUrl", "lidorubId", "mopId", "nextSteps", "payLinkId"]) if (!to[f] && from[f]) to[f] = from[f];
  if (from.info && !(to.info || "").includes(from.info)) to.info = [to.info, from.info].filter(Boolean).join("\n");
  if (!to.wantedSum && from.wantedSum) to.wantedSum = from.wantedSum;
  // Статус — у кого дальше по воронке (оплата важнее «нового»).
  // Статус — самый свежий из двух (оплата важнее всего).
  if (from.status === "paid" || (to.status !== "paid" && (from.statusAt || "") > (to.statusAt || ""))) Object.assign(to, { status: from.status, statusAt: from.statusAt });
  to.history = [{ at: nowIso(), by, text: `Склеен с дублем ${clientTitle(from)}` }, ...(to.history || []), ...(from.history || [])].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80);
  to.updatedAt = nowIso();
  return to;
}

// Дубли по одному @нику склеиваем сами (старые данные и гонки, когда двое завели одного клиента).
export async function autoMergeDups(store) {
  const clients = await store.all("client");
  const groups = new Map();
  for (const c of clients) {
    const k = nickKey(c.telegram);
    if (!k || /^\+?\d/.test(k)) continue;
    (groups.get(k) || groups.set(k, []).get(k)).push(c);
  }
  let merged = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    const [keep, ...rest] = list;
    for (const d of rest) {
      mergeInto(keep, d, "system");
      await moveToTrash(store, d, "system", `дубль ${keep.telegram}`);
      merged++;
    }
    await store.put("client", keep.id, keep);
    await repointPayments(store, rest.map((d) => d.id), keep.id);
  }
  return merged;
}

async function moveToTrash(store, c, by, reason = "") {
  await store.put("trash", c.id, { ...c, deletedAt: nowIso(), deletedBy: by, deleteReason: reason });
  await store.del("client", c.id);
}
async function repointPayments(store, fromIds, toId) {
  const hit = (await store.all("payment")).filter((p) => fromIds.includes(p.clientId));
  for (const p of hit) p.clientId = toId;
  if (hit.length) await store.putMany("payment", hit);
}

const event = (c, t, by, extra = {}) => {
  c.events = [...(c.events || []), { t, at: nowIso(), by, ...extra }];
};

function applyFields(c, body) {
  if ("name" in body) c.name = str(body.name, 120);
  if ("telegram" in body) c.telegram = normTelegram(body.telegram);
  if ("phone" in body) c.phone = str(body.phone, 40);
  if ("source" in body) c.source = SOURCES.includes(body.source) ? body.source : c.source;
  if ("chatUrl" in body) c.chatUrl = str(body.chatUrl, 300);
  if ("info" in body) c.info = str(body.info, 3000);
  if ("wantedSum" in body) c.wantedSum = money(body.wantedSum);
  if ("lidorubId" in body) c.lidorubId = body.lidorubId ? String(body.lidorubId) : null;
  if ("nextSteps" in body) c.nextSteps = str(body.nextSteps, 2000);
}

// Смена статуса + события для РнП. sum — сумма продажи/предоплаты/потенциала/отказа.
async function setStatus(c, status, { by, sum, store, settings, notes }) {
  if (!STATUS_IDS.includes(status) || status === c.status) return;
  const mop = c.mopId;
  const amount = money(sum) || c.wantedSum || 0;
  const wasPaid = c.status === "paid";
  c.status = status;
  c.statusAt = nowIso();
  c.touches = [];
  // Ошибочно нажали «Оплатил» и поправили — продажа уходит из РнП, неверифицированный черновик — из ведомости.
  if (wasPaid && status !== "paid") {
    const i = (c.events || []).map((e) => e.t).lastIndexOf("paid");
    if (i >= 0) c.events.splice(i, 1);
    if (store) {
      const drafts = (await store.all("payment")).filter((p) => p.clientId === c.id && !p.verified);
      for (const p of drafts) await store.del("payment", p.id);
      if (drafts.length) log(c, by, `Черновик оплаты убран из ведомости (${drafts.length})`);
    }
  }
  if (status === "paid") {
    event(c, "paid", by, { mop, sum: amount });
    // Продажа сразу падает в ведомость черновиком — РОП вносит чистую сумму и верифицирует.
    const draft = store && (await store.all("payment")).find((p) => p.clientId === c.id && !p.verified);
    if (draft) {
      Object.assign(draft, { tariff: amount, mopId: mop, lidorubId: c.lidorubId, net: draft.net ?? netFromLink(settings, c.payLinkId, amount) });
      await store.put("payment", draft.id, draft);
    } else if (store) {
      const p = {
        id: randomUUID(),
        date: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10),
        clientId: c.id,
        clientName: clientTitle(c),
        mopId: mop,
        lidorubId: c.lidorubId,
        tariff: amount,
        // Отправляли ссылку с известной комиссией — чистую подставим сразу, РОП только проверит.
        net: netFromLink(settings, c.payLinkId, amount),
        payLink: c.payLinkId || null,
        verified: false,
        note: "",
        createdBy: by,
        createdAt: nowIso(),
      };
      await store.put("payment", p.id, p);
    }
  }
  if (status === "prepaid") event(c, "prepaid", by, { mop, sum: money(sum) });
  if (["paid", "prepaid", "refuse_bank"].includes(status)) notes?.push({ t: status, sum: status === "prepaid" ? money(sum) : amount, mop });
  if (status === "thinking" || status === "resched") event(c, "potential", by, { mop, sum: amount });
  if (status === "refuse_bank") event(c, "refuse_bank", by, { mop, sum: amount });
  if (status === "invalid") event(c, "invalid", by);
  if (["paid", "refuse_personal", "refuse_bank", "ignore", "invalid", "archive"].includes(status)) {
    // Закрытому клиенту созвоны не нужны.
    // Время созвона прошло, а «пришёл» не нажали — раз есть решение, созвон был.
    for (const call of c.calls) if (!call.outcome) Object.assign(call, ["paid", "refuse_personal", "refuse_bank"].includes(status) && Date.parse(call.at) <= Date.now() ? { outcome: "held", outcomeAt: nowIso(), outcomeBy: by, reportAt: call.reportAt || null } : { outcome: "moved", movedAt: nowIso(), cancelled: true });
  }
  const shown = status === "prepaid" ? money(sum) : amount;
  log(c, by, `Статус → ${statusLabel(status)}${shown && ["paid", "prepaid", "thinking", "resched", "refuse_bank"].includes(status) ? ` · ${shown.toLocaleString("ru-RU")} ₽` : ""}`);
}

// Действия с карточкой: созвоны, итоги, отчёт, касания дожима.
export async function applyAction(c, body, ctx) {
  const { by, store, users, settings } = ctx;
  const notes = (ctx.notes ||= []);
  const type = body.type;
  if (type === "call") {
    const at = isoOrNull(body.at);
    const mopId = body.mopId ? String(body.mopId) : c.mopId;
    if (!at || !mopId) throw Object.assign(new Error("Нужны время и менеджер"), { status: 400 });
    // Тот же созвон второй раз (голосом, ботом, ИИ, двойным тапом) — не плодим копию.
    const t = Date.parse(at);
    // НДЗ не в счёт: не пришёл — переназначить можно хоть на то же время.
    const same = (c.calls || []).find((x) => (!x.outcome || x.outcome === "held") && Math.abs(Date.parse(x.at) - t) < 45 * 60_000);
    // «Созвон уже был» по клиенту, у которого в этот день уже отмечен проведённый созвон, — это он же.
    const pastSameDay = t < Date.now() && (c.calls || []).find((x) => x.outcome === "held" && mskKey(Date.parse(x.at)) === mskKey(t));
    // Открытый созвон рядом по времени и время другое — это перенос того же созвона, не новый.
    if (same && !same.outcome && Math.abs(Date.parse(same.at) - t) >= 60_000) {
      const prev = same.at;
      const prevMop = same.mopId;
      Object.assign(same, { at, mopId, notified: {}, setAt: nowIso(), setBy: by });
      if (!(c.events || []).some((e) => e.t === "handed" && e.mop === mopId)) event(c, "handed", by, { mop: mopId });
      c.mopId = mopId;
      notes.push({ t: "call", at, mop: mopId, moved: prev, prevMop });
      log(c, by, `Созвон перенесён на ${fmtWhen(t)} МСК`);
      ctx.call = same;
      return same;
    }
    const dupCall = same || pastSameDay;
    if (dupCall) {
      if (!dupCall.outcome && dupCall.mopId !== mopId) {
        notes.push({ t: "call", at: dupCall.at, mop: mopId, moved: dupCall.at, prevMop: dupCall.mopId });
        dupCall.mopId = mopId;
        c.mopId = mopId;
        log(c, by, `Созвон ${fmtWhen(Date.parse(dupCall.at))} передан ${users?.[mopId]?.name || "другому диагносту"}`);
      }
      ctx.call = dupCall;
      ctx.duplicateCall = true;
      return dupCall;
    }
    const cur = currentCall(c);
    if (cur) Object.assign(cur, { outcome: "moved", movedAt: nowIso() });
    // Первый раз отдали этому менеджеру — это «лид в работе» в РнП.
    if (!(c.events || []).some((e) => e.t === "handed" && e.mop === mopId)) event(c, "handed", by, { mop: mopId });
    const call = { id: randomUUID().slice(0, 8), at, mopId, setAt: nowIso(), setBy: by, outcome: null, notified: {} };
    c.calls.push(call);
    ctx.call = call;
    notes.push({ t: "call", at, mop: mopId, moved: cur ? cur.at : null, prevMop: cur?.mopId || null });
    c.mopId = mopId;
    if (!["paid"].includes(c.status)) {
      c.status = "in_work";
      c.statusAt = nowIso();
      c.touches = [];
    }
    log(c, by, `Созвон назначен на ${fmtWhen(Date.parse(at))} МСК`);
    return;
  }
  // Лишний созвон (дубль, ошибка) — убрать из карточки, РнП пересчитается.
  if (type === "dropcall") {
    const i = c.calls.findIndex((x) => x.id === body.callId);
    if (i < 0) throw Object.assign(new Error("Созвон не найден"), { status: 404 });
    const [call] = c.calls.splice(i, 1);
    if (call.outcome === "ndz" && /^ndz\d$/.test(c.status)) {
      const n = c.calls.filter((x) => x.outcome === "ndz").length;
      c.status = n ? `ndz${Math.min(n, 3)}` : "in_work";
      c.events = (c.events || []).filter((e, k, arr) => !(e.t === "ndz" && k === arr.map((x) => x.t).lastIndexOf("ndz")));
    }
    log(c, by, `Убран лишний созвон ${fmtWhen(Date.parse(call.at))}${call.outcome === "held" ? " (проведён)" : call.outcome === "ndz" ? " (НДЗ)" : ""}`);
    return;
  }
  if (type === "uncall") {
    const call = (body.callId && c.calls.find((x) => x.id === body.callId)) || currentCall(c);
    if (!call || call.outcome) throw Object.assign(new Error("Нет назначенного созвона"), { status: 400 });
    Object.assign(call, { outcome: "moved", movedAt: nowIso(), cancelled: true });
    if (!c.calls.some((x) => !x.outcome) && c.status === "in_work") c.status = "new";
    log(c, by, `Запись на ${fmtWhen(Date.parse(call.at))} отменена`);
    return;
  }
  if (type === "held" || type === "ndz") {
    const call = (body.callId && c.calls.find((x) => x.id === body.callId)) || currentCall(c);
    if (!call) throw Object.assign(new Error("Нет назначенного созвона"), { status: 400 });
    if (call.outcome) return; // уже отмечено (например, из бота)
    call.outcome = type;
    call.outcomeAt = nowIso();
    call.outcomeBy = by;
    if (type === "ndz") {
      const n = Math.min(ndzCount(c), 3);
      c.status = `ndz${n}`;
      c.statusAt = nowIso();
      c.touches = [];
      event(c, "ndz", by, { mop: call.mopId });
      notes.push({ t: "ndz", mop: call.mopId, n });
      log(c, by, `НДЗ-${n}`);
    } else {
      log(c, by, "Созвон проведён");
    }
    return;
  }
  if (type === "report") {
    let call = (body.callId && c.calls.find((x) => x.id === body.callId)) || [...c.calls].reverse().find((x) => x.outcome === "held" && !x.reportAt) || null;
    // Назначенный созвон уже начался, а «пришёл» не нажали — отчёт и есть отметка, что провели.
    const cur = currentCall(c);
    if (!call && cur && Date.parse(cur.at) <= Date.now() + 15 * 60_000) {
      Object.assign(cur, { outcome: "held", outcomeAt: nowIso(), outcomeBy: by });
      log(c, by, "Созвон проведён");
      call = cur;
    }
    // Исправляют уже сохранённый отчёт этого дня — тот же созвон, не новый.
    if (!call) {
      const day = mskKey(Date.parse(isoOrNull(body.date) || nowIso()));
      call = [...c.calls].reverse().find((x) => x.outcome === "held" && mskKey(Date.parse(x.at)) === day) || null;
    }
    // Созвон не назначали в приложении (как раньше в таблице) — заводим проведённый созвон на дату диагностики.
    if (!call && body.newCall) {
      const at = isoOrNull(body.date) || nowIso();
      const mopId = String(body.mopId || c.mopId || by);
      if (!(c.events || []).some((e) => e.t === "handed" && e.mop === mopId)) event(c, "handed", by, { mop: mopId });
      const cur = currentCall(c);
      if (cur) Object.assign(cur, { outcome: "moved", movedAt: nowIso() });
      call = { id: randomUUID().slice(0, 8), at, mopId, setAt: nowIso(), setBy: by, outcome: "held", outcomeAt: at, outcomeBy: by, notified: { h2: at, h1: at, m15: at, after: at } };
      c.calls.push(call);
      c.mopId = mopId;
    }
    if (!call) call = [...c.calls].reverse().find((x) => x.outcome === "held");
    if (!call) throw Object.assign(new Error("Сначала отметь, что созвон проведён"), { status: 400 });
    const report = {};
    for (const f of REPORT_FIELDS) report[f.id] = str(body.report?.[f.id], 3000);
    const yn = (v) => (v === true || v === false ? v : typeof v === "string" && v.trim() ? str(v, 200) : null);
    report.presented = yn(body.report?.presented);
    report.offeredPay = yn(body.report?.offeredPay);
    report.extra = str(body.report?.extra, 3000);
    if ("nextSteps" in body) c.nextSteps = str(body.nextSteps, 2000);
    call.report = report;
    call.reportAt = nowIso();
    if ("wantedSum" in body) c.wantedSum = money(body.wantedSum);
    // Тариф из договорённостей («подписание 100к ренессанс»), если в карточке ещё пусто. Запрос/боль не смотрим.
    if (!c.wantedSum) {
      const m = `${report.nextStep} ${report.extra}`.match(/(\d{2,3})\s?к(?![а-я])|(\d{2,3}[\s.]\d{3})\s*(?:₽|р|руб)/i);
      if (m) c.wantedSum = m[1] ? Number(m[1]) * 1000 : money(m[2]);
    }
    if (AFTER_CALL.includes(body.status)) await setStatus(c, body.status, { by, sum: body.sum, store, settings, notes });
    log(c, by, "Отчёт после диагностики");
    if (body.status === "resched" && isoOrNull(body.nextAt)) {
      await applyAction(c, { type: "call", at: body.nextAt, mopId: call.mopId }, ctx);
      c.status = "resched";
    }
    return;
  }
  if (type === "status") {
    await setStatus(c, body.status, { by, sum: body.sum, store, settings, notes });
    return;
  }
  if (type === "touch") {
    c.touches = [...(c.touches || []), { at: nowIso(), by, answered: !!body.answered, text: str(body.text, 300) }];
    log(c, by, body.answered ? "Касание: ответил" : "Касание: без ответа");
    // Регламент: 3 касания подряд без ответа → «Игнор».
    const silent = c.touches.filter((t) => !t.answered).length;
    if (!body.answered && silent >= FOLLOWUP_TOUCHES && !["paid", "invalid"].includes(c.status)) await setStatus(c, "ignore", { by, store, settings, notes });
    if (body.answered) c.touches = [];
    return;
  }
  if (type === "lm") {
    if ((c.events || []).some((e) => e.t === "lm")) return;
    event(c, "lm", by);
    c.lmAt = nowIso();
    log(c, by, "Отправлен лид-магнит");
    return;
  }
  if (type === "paylink") {
    const link = (settings?.payLinks || DEFAULT_PAY_LINKS).find((l) => l.id === body.linkId);
    if (!link) throw Object.assign(new Error("Ссылка не найдена"), { status: 400 });
    c.payLinkId = link.id;
    if (!c.wantedSum) c.wantedSum = link.amount;
    event(c, "paylink", by, { link: link.id, sum: link.amount });
    log(c, by, `💳 Отправлена ссылка: ${link.label}`);
    return;
  }
  if (type === "comment") {
    const text = str(body.text, 1000);
    if (text) {
      log(c, by, `💬 ${text}`);
      notes.push({ t: "comment", text });
    }
    return;
  }
  throw Object.assign(new Error("Неизвестное действие"), { status: 400 });
}

// ---------- ведомость ----------
function applyPayment(p, body) {
  if ("date" in body && isDay(body.date)) p.date = body.date;
  if ("tariff" in body) p.tariff = money(body.tariff);
  if ("net" in body) p.net = body.net === null || body.net === "" ? null : money(body.net);
  if ("mopId" in body) p.mopId = body.mopId ? String(body.mopId) : null;
  if ("clientName" in body) p.clientName = str(body.clientName, 120);
  if ("note" in body) p.note = str(body.note, 300);
  if ("verified" in body) p.verified = !!body.verified && p.net !== null;
}

// ---------- роутер ----------
export function createHandler({ store, env, fetch: fetchImpl = fetch }) {
  return async (req) => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, "");
    try {
      if (path === "/tg" && req.method === "POST") {
        if (!env.BOT_TOKEN || req.headers.get("x-telegram-bot-api-secret-token") !== (await webhookSecret(env.BOT_TOKEN))) return json({ error: "forbidden" }, 403);
        const update = await req.json().catch(() => ({}));
        await handleUpdate(update, { store, env, tg: telegram(env.BOT_TOKEN, fetchImpl), appUrl: env.APP_URL || `${url.origin}/` });
        return json({ ok: true });
      }

      const auth = await authenticate(req, env, store);
      if (!auth.me) return json({ error: "unauthorized", reason: auth.reason, id: auth.tg?.id || null, name: auth.tg ? displayName(auth.tg) : null }, auth.tg ? 403 : 401);
      const me = auth.me;
      const by = me.id;
      const money_ = canSeeMoney(me.role);
      const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await req.json().catch(() => ({})) : {};
      const users = Object.fromEntries((await store.all("user")).map((u) => [u.id, u]));
      users[me.id] = { ...(users[me.id] || {}), ...me };
      const settings = await loadSettings(store);
      const tg = env.BOT_TOKEN ? telegram(env.BOT_TOKEN, fetchImpl) : null;
      const appUrl = env.APP_URL || `${url.origin}/`;
      const notify = (notes, c) => dispatch(notes, c, { store, env, tg, appUrl, by, users, settings }).catch(() => {});

      if (path === "/state" && req.method === "GET") {
        // Бот подключается сам при первом входе собственника.
        if (me.role === "owner" && env.BOT_TOKEN) await ensureWebhook(store, env, fetchImpl, `${url.origin}/api/tg`).catch(() => {});
        // Состав команды поменялся (кого-то добавили до этого обновления) — один раз привязываем историю
        const sig = Object.values(users).filter((u) => u.active !== false).map((u) => `${u.id}:${u.role}`).sort().join(",");
        if ((await store.get("meta", "linked"))?.sig !== sig) {
          await linkPeople(store);
          await store.put("meta", "linked", { sig, at: nowIso() });
        }
        // Склейка дублей — не чаще раза в 10 минут (бесплатный лимит чтений D1).
        const dd = await store.get("meta", "dedupe-at");
        if (!dd || Date.now() - Date.parse(dd.at) > 10 * 60_000) {
          await store.put("meta", "dedupe-at", { id: "dedupe-at", at: nowIso() });
          await autoMergeDups(store).catch(() => 0);
        }
        const [clients, legacy, pending, feed, settingsNow, windows] = await Promise.all([store.all("client"), store.get("meta", "legacy"), store.all("pending"), store.recent("feed", 120), loadSettings(store), loadWindows(store)]);
        return json({
          me,
          users: Object.values(users),
          pending: me.role === "owner" || me.role === "rop" ? pending : [],
          clients,
          settings: settingsNow,
          legacy: legacy || {},
          payments: money_ ? await ensurePayoutFlags(store) : null,
          payouts: money_ ? (await store.recent("payout", 30)) : [],
          windows,
          // Лента: руководству — всё, остальным — адресованное им и про их клиентов (без денег ведомости).
          feed: ["owner", "rop"].includes(me.role) ? feed : feed.filter((f) => (f.to || []).includes(me.id) || f.by === me.id),
          serverNow: Date.now(),
        });
      }

      // клиенты
      if (path === "/clients" && req.method === "POST") {
        const c = blankClient(by);
        applyFields(c, body);
        if (!c.lidorubId && me.role === "lidorub") c.lidorubId = me.id;
        if (!c.name && !c.telegram && !c.phone) return json({ error: "Нужно имя, ник или телефон" }, 400);
        const dup = findDup(await store.all("client"), c);
        if (dup) return json({ error: `Такой клиент уже есть: ${clientTitle(dup)}`, duplicate: true, client: dup }, 409);
        log(c, by, "Клиент создан");
        const ctx = { by, store, users, settings, notes: [] };
        if (body.call?.at) await applyAction(c, { type: "call", ...body.call }, ctx);
        await store.put("client", c.id, c);
        await notify(ctx.notes, c);
        return json({ client: c });
      }
      const cm = path.match(/^\/clients\/([\w-]+)(\/action)?$/);
      if (cm) {
        const c = await store.get("client", cm[1]);
        if (!c) return json({ error: "not_found" }, 404);
        // Удалить может руководство и тот, кто ведёт клиента (завёл, лидоруб, диагност). Удалённое лежит в корзине.
        const mine = money_ || [c.createdBy, c.mopId, c.lidorubId].includes(by);
        if (req.method === "DELETE") {
          if (!mine) return json({ error: "Удалить может тот, кто ведёт клиента, или руководство" }, 403);
          await moveToTrash(store, c, by, "удалён вручную");
          const { addFeed } = await import("./notify.mjs");
          await addFeed(store, { type: "comment", text: `🗑 ${me.name} удалил клиента ${clientTitle(c)}`, by, to: [c.mopId, c.lidorubId].filter(Boolean), clientId: null });
          return json({ ok: true });
        }
        if (!cm[2] && req.method === "POST" && body.mergeFrom) {
          const other = await store.get("client", String(body.mergeFrom));
          if (!other || other.id === c.id) return json({ error: "Дубль не найден" }, 404);
          if (!mine && ![other.createdBy, other.mopId, other.lidorubId].includes(by)) return json({ error: "forbidden" }, 403);
          mergeInto(c, other, by);
          await store.put("client", c.id, c);
          await moveToTrash(store, other, by, `склеен с ${clientTitle(c)}`);
          await repointPayments(store, [other.id], c.id);
          return json({ client: c, removed: other.id, payments: money_ ? await store.all("payment") : null });
        }
        if (req.method === "PATCH" && ("telegram" in body || "phone" in body)) {
          const next = { telegram: "telegram" in body ? normTelegram(body.telegram) : c.telegram, phone: "phone" in body ? str(body.phone, 40) : c.phone };
          const dup = findDup(await store.all("client"), next, c.id);
          if (dup) return json({ error: `Этот ${"telegram" in body ? "ник" : "телефон"} уже у клиента ${clientTitle(dup)} — открой его или склей дубли`, duplicate: true, client: dup }, 409);
        }
        const ctx = { by, store, users, settings, notes: [] };
        // Продажу ставит руководство или диагност клиента — чтобы не было «чужих» продаж в ведомости.
        if (cm[2] && body.type === "status" && ["paid", "prepaid"].includes(body.status) && !money_ && c.mopId && c.mopId !== by) return json({ error: `Оплату отмечает диагност клиента (${users[c.mopId]?.name || "менеджер"}) или руководство` }, 403);
        // Лидоруба клиента меняет руководство (от этого зависят его 2%); свободное поле можно заполнить.
        if (req.method === "PATCH" && "lidorubId" in body && !money_ && c.lidorubId && String(body.lidorubId || "") !== c.lidorubId) return json({ error: "Лидоруба у клиента меняет Петя или Андрей" }, 403);
        if (cm[2] && req.method === "POST") {
          await applyAction(c, body, ctx);
          if (ctx.duplicateCall) return json({ error: `У клиента уже есть этот созвон: ${fmtWhen(Date.parse(ctx.call.at))}`, client: c }, 409);
        } else if (req.method === "PATCH") {
          applyFields(c, body);
          log(c, by, "Изменены данные");
        } else return json({ error: "not_found" }, 404);
        c.updatedAt = nowIso();
        await store.put("client", c.id, c);
        await notify(ctx.notes, c);
        return json({ client: c, payments: money_ ? await store.all("payment") : null });
      }

      // выплаты команде: отмечает собственник (он платит), РОП видит
      if (path === "/payouts" && req.method === "POST") {
        if (me.role !== "owner") return json({ error: "Выплаты отмечает собственник" }, 403);
        const tg = env.BOT_TOKEN ? telegram(env.BOT_TOKEN, fetchImpl) : null;
        const res = await markPayout(store, { by: me, users, settings, role: body.role, personId: body.personId, ids: body.ids, tg });
        return json({ ...res, payments: await store.all("payment"), payouts: await store.recent("payout", 30) });
      }
      const undo = path.match(/^\/payouts\/([\w-]+)\/undo$/);
      if (undo && req.method === "POST") {
        if (me.role !== "owner") return json({ error: "forbidden" }, 403);
        await undoPayout(store, undo[1]);
        return json({ payments: await store.all("payment"), payouts: await store.recent("payout", 30) });
      }

      // ведомость — только собственник и РОП
      if (path.startsWith("/payments")) {
        if (!money_) return json({ error: "forbidden" }, 403);
        const pm = path.match(/^\/payments\/([\w-]+)$/);
        if (path === "/payments" && req.method === "POST") {
          const p = { id: randomUUID(), date: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10), tariff: 0, net: null, verified: false, mopId: null, clientName: "", note: "", createdBy: by, createdAt: nowIso() };
          applyPayment(p, body);
          applyPayment(p, { verified: body.verified });
          await store.put("payment", p.id, p);
          return json({ payment: p });
        }
        if (pm) {
          const p = await store.get("payment", pm[1]);
          if (!p) return json({ error: "not_found" }, 404);
          if (req.method === "DELETE") {
            await store.del("payment", p.id);
            return json({ ok: true });
          }
          if (req.method === "PATCH") {
            applyPayment(p, body);
            if ("verified" in body) p.verifiedBy = p.verified ? by : null;
            await store.put("payment", p.id, p);
            return json({ payment: p });
          }
        }
        return json({ error: "not_found" }, 404);
      }

      // окна диагностов: ставит любой из команды (лидоруб — диагносту, диагност — себе)
      if (path === "/windows" && req.method === "PUT") {
        const res = await setWindows(store, { by: me, users, ...body });
        return json({ ...res, windows: await loadWindows(store) });
      }

      if (path === "/settings" && req.method === "PUT") {
        if (!money_) return json({ error: "forbidden" }, 403);
        const cur = settings;
        const pct = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100 ? Number(v) : d);
        const next = {
          rates: Object.fromEntries(Object.keys(DEFAULT_RATES).map((k) => [k, pct(body.rates?.[k], cur.rates[k])])),
          monthPlan: "monthPlan" in body ? money(body.monthPlan) : cur.monthPlan,
          salesPlan: "salesPlan" in body ? Math.round(money(body.salesPlan)) : cur.salesPlan || 0,
          personPlans: body.personPlans && typeof body.personPlans === "object" ? Object.fromEntries(Object.entries(body.personPlans).map(([k, v]) => [str(k, 20), money(v)]).filter(([, v]) => v)) : cur.personPlans,
          payLinks: Array.isArray(body.payLinks) ? sanitizeLinks(body.payLinks) : cur.payLinks,
          aliases: body.aliases && typeof body.aliases === "object" ? Object.fromEntries(Object.entries(body.aliases).map(([k, v]) => [str(k, 40), str(String(v), 40)]).filter(([, v]) => v)) : cur.aliases,
        };
        await store.put("meta", "settings", { ...cur, ...next });
        await linkPeople(store);
        return json({ settings: next });
      }

      // команда
      if (path === "/users" && req.method === "POST") {
        if (!["owner", "rop"].includes(me.role)) return json({ error: "forbidden" }, 403);
        const id = str(String(body.id || ""), 20);
        if (!/^\d+$/.test(id) || !ROLES[body.role]) return json({ error: "Нужны Telegram ID и роль" }, 400);
        // РОП добавляет менеджеров и лидорубов, роли выше — только собственник.
        if (me.role === "rop" && !["mop", "lidorub"].includes(body.role)) return json({ error: "forbidden" }, 403);
        const prev = (await store.get("user", id)) || (await store.get("pending", id)) || {};
        const u = { id, name: str(body.name, 60) || prev.name || id, username: prev.username || "", role: body.role, active: body.active !== false, addedBy: by, addedAt: prev.addedAt || nowIso() };
        await store.put("user", id, u);
        await store.del("pending", id);
        await linkPeople(store);
        return json({ user: u });
      }
      const um = path.match(/^\/users\/(\d+)$/);
      if (um && req.method === "DELETE") {
        if (me.role !== "owner") return json({ error: "forbidden" }, 403);
        const u = await store.get("user", um[1]);
        if (u) await store.put("user", u.id, { ...u, active: false });
        await store.del("pending", um[1]);
        return json({ ok: true });
      }

      // выгрузка базы в личку через бота
      if (path === "/export" && req.method === "POST") {
        if (!tg) return json({ error: "Бот не подключён" }, 400);
        const { sendExport } = await import("./export.mjs");
        try {
          return json(await sendExport({ store, tg, to: me.id, withMoney: money_ }));
        } catch (e) {
          return json({ error: "Не дошло: нажми Start у бота и попробуй ещё раз" }, 400);
        }
      }

      // импорт истории из Google-таблиц (seed/*.json)
      if (path === "/import" && req.method === "POST") {
        if (!money_) return json({ error: "forbidden" }, 403);
        const res = await importSeed(store, body);
        res.linked = await linkPeople(store);
        return json(res);
      }

      return json({ error: "not_found" }, 404);
    } catch (e) {
      return json({ error: e.message || "error" }, e.status || 500);
    }
  };
}

// Привязка истории к людям: в таблицах люди подписаны именами («Тема», «Дима», «Алексей»).
// Как только человек есть в команде — находим его по имени и переписываем на него клиентов,
// созвоны, оплаты и РнП. Запускается при добавлении человека, импорте и смене настроек.
export async function linkPeople(store) {
  const { findUserInText } = await import("./nlp.mjs");
  const settings = await loadSettings(store);
  const aliases = { ...(settings.aliases || {}) };
  const users = (await store.all("user")).filter((u) => u.active !== false);
  const closers = users.filter((u) => ["mop", "rop"].includes(u.role));
  const lrs = users.filter((u) => u.role === "lidorub");
  const [clients, payments, legacy] = await Promise.all([store.all("client"), store.all("payment"), store.get("meta", "legacy")]);
  const want = new Map(); // имя → кандидаты
  for (const n of Object.keys(legacy?.rnp || {})) want.set(n, closers);
  for (const n of Object.keys(legacy?.lidorub || {})) want.set(n, lrs);
  for (const p of payments) if (p.mopAlias) want.set(p.mopAlias, closers);
  for (const c of clients) {
    if (c.mopAlias) want.set(c.mopAlias, closers);
    for (const x of c.calls || []) if (x.mopAlias) want.set(x.mopAlias, closers);
  }
  let aliasChanged = false;
  for (const [name, cands] of want) {
    if (aliases[name] && users.some((u) => u.id === aliases[name])) continue;
    const u = findUserInText(name, cands);
    if (u) (aliases[name] = u.id), (aliasChanged = true);
  }
  if (aliasChanged) await store.put("meta", "settings", { ...settings, aliases });
  const changedClients = [];
  for (const c of clients) {
    let dirty = false;
    for (const x of c.calls || []) {
      const id = x.mopAlias && aliases[x.mopAlias];
      if (id && x.mopId !== id) (x.mopId = id), (dirty = true);
    }
    const own = (c.mopAlias && aliases[c.mopAlias]) || [...(c.calls || [])].reverse().find((x) => x.mopId)?.mopId || null;
    if (!c.mopId && own) (c.mopId = own), (dirty = true);
    if (dirty) changedClients.push(c);
  }
  if (changedClients.length) await store.putMany("client", changedClients);
  const changedPays = payments.filter((p) => p.mopAlias && aliases[p.mopAlias] && p.mopId !== aliases[p.mopAlias]).map((p) => ({ ...p, mopId: aliases[p.mopAlias] }));
  if (changedPays.length) await store.putMany("payment", changedPays);
  return { aliases, clients: changedClients.length, payments: changedPays.length };
}

function sanitizeLinks(list) {
  return list
    .slice(0, 60)
    .map((l, i) => ({
      id: str(l.id, 40).replace(/[^\w-]/g, "") || `l${Date.now().toString(36)}${i}`,
      provider: str(l.provider, 40) || "Другое",
      label: str(l.label, 80) || "Ссылка",
      amount: money(l.amount),
      commission: l.commission === null || l.commission === "" || l.commission === undefined ? null : Math.min(100, Number(String(l.commission).replace(",", ".")) || 0),
      url: /^https:\/\//.test(str(l.url, 300)) ? str(l.url, 300) : "",
      note: str(l.note, 200),
    }))
    .filter((l) => l.url);
}

export function netFromLink(settings, linkId, amount) {
  const link = (settings?.payLinks || DEFAULT_PAY_LINKS).find((l) => l.id === linkId);
  if (!link || link.commission === null || link.commission === undefined || !amount) return null;
  return Math.round(amount * (1 - link.commission / 100));
}

export async function importSeed(store, body) {
  const out = { payments: 0, legacy: false, clients: 0 };
  if (Array.isArray(body.payments)) {
    const items = body.payments.filter((p) => p.id && isDay(p.date)).map((p) => ({ net: null, verified: false, ...p, tariff: money(p.tariff), net: p.net === null ? null : money(p.net) }));
    // Повторный импорт не сбрасывает то, что уже проверено и выплачено в приложении.
    const have = new Map((await store.all("payment")).map((p) => [p.id, p]));
    for (const p of items) {
      const old = have.get(p.id);
      if (old) Object.assign(p, { verified: old.verified, net: old.net, paid: old.paid, verifiedBy: old.verifiedBy, mopId: old.mopId || p.mopId, clientId: old.clientId || p.clientId });
      if (!p.paid) p.paid = seedPaid(p);
    }
    await store.putMany("payment", items);
    out.payments = items.length;
  }
  if (body.legacy) {
    await store.put("meta", "legacy", body.legacy);
    out.legacy = true;
  }
  if (Array.isArray(body.clients)) {
    // Клиенты из CRM-таблицы: склеиваем с уже заведёнными по нику, созвоны из таблицы добавляем без дублей.
    const existing = await store.all("client");
    // Ключ склейки: ник, а у кого ника нет (было в таблице) — имя клиента из таблицы
    const keyOf = (c) => (c.telegram ? c.telegram.toLowerCase() : c.fromSheet && c.name ? `name:${c.name.toLowerCase()}` : null);
    const byNick = new Map(existing.filter((c) => keyOf(c)).map((c) => [keyOf(c), c]));
    const aliases = (await loadSettings(store)).aliases || {};
    // «Тема»/«Дима» из таблицы ещё не связаны в настройках — ищем человека по имени
    const { findUserInText } = await import("./nlp.mjs");
    const team = (await store.all("user")).filter((u) => u.active !== false && ["mop", "rop"].includes(u.role));
    for (const raw of body.clients) if (raw.mopAlias && !aliases[raw.mopAlias]) {
      const u = findUserInText(raw.mopAlias, team);
      if (u) aliases[raw.mopAlias] = u.id;
    }
    const changed = new Map();
    out.merged = 0;
    for (const raw of body.clients.slice(0, 5000)) {
      const mopId = raw.mopId || aliases[raw.mopAlias] || null;
      const calls = (raw.calls || []).map((x) => ({ ...x, mopId: x.mopId || mopId }));
      const key = keyOf(raw);
      const hit = (key && (changed.get(key) || byNick.get(key))) || null;
      if (hit) {
        for (const call of calls) if (!hit.calls.some((x) => x.id === call.id || (x.legacy && x.at === call.at))) hit.calls.push(call);
        hit.calls.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
        if (raw.nextSteps && (!hit.nextSteps || hit.fromSheet)) hit.nextSteps = raw.nextSteps;
        if (raw.chatUrl && !hit.chatUrl) hit.chatUrl = raw.chatUrl;
        if (raw.info && !(hit.info || "").includes(raw.info)) hit.info = [hit.info, raw.info].filter(Boolean).join("\n");
        if (!hit.name && raw.name) hit.name = raw.name;
        if (!hit.mopId && mopId) hit.mopId = mopId;
        // Статус из таблицы берём, только если в приложении клиент ещё «новый» или пришёл из таблицы
        if (raw.status && (hit.status === "new" || hit.fromSheet) && STATUS_IDS.includes(raw.status)) hit.status = raw.status;
        changed.set(key, hit);
        out.merged++;
      } else {
        const c = { ...blankClient("import"), ...raw, id: raw.id || randomUUID(), mopId, calls, status: STATUS_IDS.includes(raw.status) ? raw.status : "new", history: [{ at: nowIso(), by: "import", text: "Перенесён из CRM-таблицы" }] };
        changed.set(key || c.id, c);
        if (key) byNick.set(key, c);
        out.clients++;
      }
    }
    await store.putMany("client", [...changed.values()]);
  }
  return out;
}

async function ensureWebhook(store, env, fetchImpl, hookUrl) {
  const saved = await store.get("meta", "webhook");
  if (saved?.url === hookUrl && saved?.v === 4) return;
  const tg = telegram(env.BOT_TOKEN, fetchImpl);
  await tg.setWebhook(hookUrl, await webhookSecret(env.BOT_TOKEN));
  await tg.setMyCommands(BOT_COMMANDS).catch(() => {});
  await store.put("meta", "webhook", { url: hookUrl, v: 4, at: nowIso() });
}

// ---------- окна ----------
export async function loadWindows(store, now = Date.now()) {
  const from = addDaysKey(mskKey(now), -7);
  return (await store.all("window")).filter((w) => w.day >= from && w.ranges?.length);
}

// { mopId, days: ["2026-10-13", …], ranges: [{ from, to }] } — пустые ranges = закрыть окна на эти дни.
export async function setWindows(store, { by, users, mopId, days, ranges, silent = false }) {
  const mop = users[String(mopId)];
  if (!mop || !["mop", "rop"].includes(mop.role)) throw Object.assign(new Error("Окна ставятся диагносту (менеджеру ОП или РОПу)"), { status: 400 });
  const list = [...new Set((Array.isArray(days) ? days : [days]).filter(isDay))].slice(0, 31);
  if (!list.length) throw Object.assign(new Error("Выбери день"), { status: 400 });
  const clean = cleanRanges(ranges);
  if (Array.isArray(ranges) && ranges.length && !clean.length) throw Object.assign(new Error("Проверь время: «с» должно быть раньше «до»"), { status: 400 });
  const items = list.map((day) => ({ id: `${mop.id}:${day}`, mopId: mop.id, day, ranges: clean, by: by.id, at: nowIso() }));
  for (const w of items) clean.length ? await store.put("window", w.id, w) : await store.del("window", w.id);
  if (!silent && by.id !== mop.id) {
    const { addFeed } = await import("./notify.mjs");
    const dd = list.map((d) => `${d.slice(8)}.${d.slice(5, 7)}`).join(", ");
    await addFeed(store, { type: "comment", text: clean.length ? `🕐 ${by.name} открыл окна ${mop.name}: ${dd} · ${rangesText(clean)}` : `🕐 ${by.name} закрыл окна ${mop.name}: ${dd}`, by: by.id, to: [mop.id] });
  }
  return { mop, days: list, ranges: clean };
}

// ---------- выплаты ----------
// По зарплатной ведомости на 12.10: всё до 05.10 выплачено всем (зелёные строки),
// с 05.10 МОПу выплачено сразу после продажи, РОПу и лидорубу — ждут понедельника.
const PAID_UNTIL = "2026-10-05";
export const seedPaid = (p) => (p.date < PAID_UNTIL ? { mop: p.date, rop: p.date, lidorub: p.date } : { mop: p.date, rop: null, lidorub: null });

// Один раз: оплатам, заведённым до учёта выплат, проставляем, кому уже заплачено.
export async function ensurePayoutFlags(store) {
  const payments = await store.all("payment");
  if ((await store.get("meta", "payouts-v1"))?.done) return payments;
  const fix = payments.filter((p) => !p.paid);
  for (const p of fix) p.paid = /^seed-/.test(p.id) ? seedPaid(p) : { mop: p.date, rop: null, lidorub: null };
  if (fix.length) await store.putMany("payment", fix);
  await store.put("meta", "payouts-v1", { id: "payouts-v1", done: true, at: nowIso(), fixed: fix.length });
  return payments;
}

export const mopResolver = (settings) => (p) => p.mopId || settings?.aliases?.[p.mopAlias] || (p.mopAlias ? `legacy:${p.mopAlias}` : null);

// Отметить выплату человеку: все его невыплаченные верифицированные оплаты (или ids).
export async function markPayout(store, { by, users, settings, role, personId, ids = null, tg = null, now = Date.now() }) {
  if (!PAYOUT_ROLES[role]) throw Object.assign(new Error("Кому выплата?"), { status: 400 });
  const payments = await ensurePayoutFlags(store);
  const { groups } = payoutsOwed(payments, Object.values(users), settings.rates, { roles: [role], mopOf: mopResolver(settings) });
  const g = groups.find((x) => x.personId === String(personId));
  if (!g) throw Object.assign(new Error("Этому человеку ничего не должны"), { status: 400 });
  const pick = Array.isArray(ids) && ids.length ? g.items.filter((it) => ids.includes(it.p.id)) : g.items;
  if (!pick.length) throw Object.assign(new Error("Нет оплат к выплате"), { status: 400 });
  const day = new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
  for (const it of pick) it.p.paid = { ...(it.p.paid || {}), [role]: day };
  await store.putMany("payment", pick.map((it) => it.p));
  const amount = Math.round(pick.reduce((s, it) => s + it.amount, 0) * 100) / 100;
  const id = `${Date.now()}-${role}-${personId}`;
  const person = users[String(personId)];
  const doc = { id, at: nowIso(), by: by.id, role, personId: String(personId), name: person?.name || "", amount, items: pick.map((it) => ({ id: it.p.id, date: it.p.date, client: it.p.clientName || "", amount: it.amount })) };
  await store.put("payout", id, doc);
  const { addFeed } = await import("./notify.mjs");
  const rubs = (n) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;
  await addFeed(store, { type: "paid", text: `💸 ${by.name} выплатил ${person?.name || ""} (${PAYOUT_ROLES[role]}) ${rubs(amount)} за ${pick.length} опл.`, by: by.id, to: [String(personId)] });
  // Получателю — в бота, за что именно деньги.
  if (tg && person && person.id !== by.id) {
    const lines = pick.map((it) => `• ${it.p.date.slice(8)}.${it.p.date.slice(5, 7)} ${it.p.clientName || "оплата"} — ${rubs(it.amount)}`).join("\n");
    await tg.sendMessage(person.id, `💸 <b>${by.name} выплатил тебе ${rubs(amount)}</b>\n${PAYOUT_ROLES[role]} · ${pick.length} опл.\n${lines}`).catch(() => {});
  }
  return { payout: doc };
}

export async function undoPayout(store, id) {
  const doc = await store.get("payout", id);
  if (!doc) throw Object.assign(new Error("Выплата не найдена"), { status: 404 });
  for (const it of doc.items) {
    const p = await store.get("payment", it.id);
    if (p?.paid?.[doc.role]) {
      p.paid = { ...p.paid, [doc.role]: null };
      await store.put("payment", p.id, p);
    }
  }
  await store.del("payout", id);
}
