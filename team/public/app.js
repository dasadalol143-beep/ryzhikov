import {
  ROLES, STATUSES, SOURCES, REPORT_FIELDS, AFTER_CALL, FOLLOWUP_TOUCHES, DEFAULT_RATES,
  statusLabel, statusGroup, isClosed, canSeeMoney, currentCall, lastCall, clientTitle, needsReport, followupState,
  mskKey, mskTime, mskMidnight, addDaysKey, fmtDay, weekday, fmtWhen, monthName, payrollRow, monthSummary,
  DEFAULT_PAY_LINKS, pace, daysInMonth,
} from "./lib/model.js";
import { rnp, lidorubStats, periodRange } from "./lib/stats.js";
import { columns, cumulative, funnel as funnelChart, shareBar, sparkline, bindCharts, compact } from "./charts.js";

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
// Тема графиков следует за Telegram (свои шаги палитры для тёмного фона).
const applyTheme = () => (document.documentElement.dataset.theme = tg?.colorScheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
applyTheme();
tg?.onEvent?.("themeChanged", applyTheme);

const AUTH_ERRORS = {
  no_bot_token: "На сервере не задан токен бота (BOT_TOKEN в Cloudflare).",
  bad_signature: "Токен бота на сервере не совпадает с ботом. Проверь BOT_TOKEN в Cloudflare.",
  no_init_data: "Открой приложение кнопкой в боте Telegram.",
  expired: "Сессия устарела — закрой и открой приложение заново.",
};

const state = {
  me: null,
  users: [],
  pending: [],
  clients: [],
  settings: { rates: DEFAULT_RATES, monthPlan: 0, aliases: {} },
  legacy: {},
  payments: null,
  feed: [],
  statsPerson: "all",
  tab: "today",
  clientId: null,
  more: null, // payroll | team | settings | import | rules
  filter: "active",
  query: "",
  person: "all",
  period: "month",
  calDay: mskKey(),
  payMonth: mskKey().slice(0, 7),
  statsView: "rnp",
};

const $app = document.getElementById("app");
const $tabs = document.getElementById("tabs");

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rub = (n) => `${Math.round(n || 0).toLocaleString("ru-RU")} ₽`;
const short = (n) => (Math.abs(n) >= 1_000_000 ? `${Math.round(n / 100_000) / 10} млн` : Math.abs(n) >= 1000 ? `${Math.round(n / 100) / 10}к` : String(Math.round(n || 0)));
const pct = (x) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);
const haptic = (t = "light") => tg?.HapticFeedback?.impactOccurred(t);
const today = () => mskKey();
const isBoss = () => ["owner", "rop"].includes(state.me?.role);
const money = () => canSeeMoney(state.me?.role);
const userById = (id) => state.users.find((u) => u.id === id);
const userName = (id) => {
  if (!id) return "—";
  if (String(id).startsWith("legacy:")) return `${id.slice(7)} (таблица)`;
  return userById(id)?.name || id;
};
// Диагносты: менеджеры ОП + РОП (Андрей тоже может брать созвоны).
const closers = () => state.users.filter((u) => u.active !== false && ["mop", "rop"].includes(u.role));
const lidorubs = () => state.users.filter((u) => u.active !== false && u.role === "lidorub");
const clientById = (id) => state.clients.find((c) => c.id === id);
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
};
const statusBadge = (s) => `<span class="stt g-${statusGroup(s)}">${esc(statusLabel(s))}</span>`;
const aliasesFor = () => state.settings.aliases || {};
const paymentMop = (p) => p.mopId || aliasesFor()[p.mopAlias] || (p.mopAlias ? `legacy:${p.mopAlias}` : null);
const normPayments = () => (state.payments || []).map((p) => ({ ...p, mopId: paymentMop(p) }));

function toast(text) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}
const alertDialog = (text) => (tg?.showAlert ? tg.showAlert(text) : window.alert(text));
const confirmDialog = (text) => new Promise((resolve) => (tg?.showConfirm ? tg.showConfirm(text, resolve) : resolve(window.confirm(text))));

async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `tma ${tg?.initData || ""}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data });
  return data;
}

function openLink(url) {
  if (!url) return;
  if (/^https:\/\/t\.me\//.test(url) && tg?.openTelegramLink) tg.openTelegramLink(url);
  else if (tg?.openLink) tg.openLink(url);
  else window.open(url, "_blank");
}
const tgUrl = (nick) => `https://t.me/${String(nick).replace(/^@/, "")}`;

// ---------- шторка ----------
function openSheet(html, onMount) {
  closeSheet();
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap";
  wrap.innerHTML = `<div class="sheet-backdrop"></div><div class="sheet"><div class="sheet-grip"></div>${html}</div>`;
  wrap.querySelector(".sheet-backdrop").onclick = closeSheet;
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add("open"));
  onMount?.(wrap.querySelector(".sheet"));
}
const closeSheet = () => document.querySelector(".sheet-wrap")?.remove();

// ---------- аватар ----------
const AVATAR_COLORS = [["#ff8a65", "#e8505b"], ["#4fc3f7", "#2481cc"], ["#81c784", "#2e9e5b"], ["#ba68c8", "#7a4fd0"], ["#ffb74d", "#d97f00"], ["#4db6ac", "#00897b"], ["#f06292", "#c2185b"], ["#7986cb", "#3949ab"]];
function avatar(name, seed, size = 40) {
  const clean = String(name || "?").replace(/^@/, "");
  const parts = clean.split(/\s+/).filter(Boolean);
  const initials = (parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2)).toUpperCase();
  let hsh = 0;
  for (const ch of String(seed || clean)) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = AVATAR_COLORS[hsh % AVATAR_COLORS.length];
  return `<div class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;background:linear-gradient(135deg,${a},${b})">${esc(initials)}</div>`;
}

// ---------- данные ----------
async function load() {
  try {
    const data = await api("GET", "/state");
    Object.assign(state, {
      me: data.me,
      users: data.users,
      pending: data.pending,
      clients: data.clients,
      settings: data.settings,
      legacy: data.legacy || {},
      payments: data.payments,
      feed: data.feed || [],
    });
    $tabs.hidden = false;
    // Ссылки из бота: ?client=ID&report=1
    const q = new URLSearchParams(location.search);
    if (q.get("client") && clientById(q.get("client")) && !state.deepLinked) {
      state.deepLinked = true;
      state.tab = "clients";
      state.clientId = q.get("client");
      render();
      if (q.get("report")) openReport(clientById(state.clientId));
      if (q.get("book")) openBooking(clientById(state.clientId));
      return;
    }
    render();
  } catch (e) {
    renderAuthError(e);
  }
}

function renderAuthError(e) {
  $tabs.hidden = true;
  const d = e.data || {};
  if (d.reason === "no_access") {
    $app.innerHTML = `<div class="empty"><div style="font-size:42px">🔒</div><h1>Доступа пока нет</h1><p>Твой Telegram ID: <b>${esc(d.id)}</b></p><p class="sub">Заявка уже ушла Пете и Андрею — как выдадут роль, открой приложение заново.</p></div>`;
    return;
  }
  $app.innerHTML = `<div class="empty"><div style="font-size:42px">⚠️</div><p>${esc(AUTH_ERRORS[d.reason] || e.message)}</p></div>`;
}

const replaceClient = (c) => {
  const i = state.clients.findIndex((x) => x.id === c.id);
  if (i >= 0) state.clients[i] = c;
  else state.clients.unshift(c);
};

async function act(clientId, body, okText) {
  try {
    const res = await api("POST", `/clients/${clientId}/action`, body);
    replaceClient(res.client);
    if (res.payments) state.payments = res.payments;
    haptic("medium");
    if (okText) toast(okText);
    render();
    return res.client;
  } catch (e) {
    alertDialog(e.message);
    return null;
  }
}

// ---------- навигация ----------
$tabs.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  state.tab = b.dataset.tab;
  state.clientId = null;
  state.more = null;
  haptic();
  render();
  window.scrollTo(0, 0);
});

tg?.BackButton?.onClick(() => {
  if (document.querySelector(".sheet-wrap")) return closeSheet();
  if (state.clientId) state.clientId = null;
  else if (state.more) state.more = null;
  render();
});

function render() {
  for (const b of $tabs.querySelectorAll("button")) b.classList.toggle("active", b.dataset.tab === state.tab);
  const deep = state.clientId || state.more;
  if (tg?.BackButton) deep ? tg.BackButton.show() : tg.BackButton.hide();
  if (state.clientId && clientById(state.clientId)) return renderClient(clientById(state.clientId));
  state.clientId = null;
  ({ today: renderToday, clients: renderClients, calendar: renderCalendar, stats: renderStats, more: renderMore })[state.tab]();
}

// ---------- общие куски ----------
function clientRow(c, { sub = "", right = "", extra = "" } = {}) {
  const call = currentCall(c);
  const defSub = `${statusBadge(c.status)}${c.mopId ? `<span class="sub">· ${esc(userName(c.mopId))}</span>` : ""}`;
  const defRight = call ? `<b class="mono">${mskKey(Date.parse(call.at)) === today() ? mskTime(Date.parse(call.at)) : fmtDay(mskKey(Date.parse(call.at)))}</b>` : "";
  return `<div class="row" data-open="${c.id}">${avatar(clientTitle(c), c.id)}<div class="grow"><div class="title">${esc(clientTitle(c))}${c.name && c.telegram ? ` <span class="sub" style="display:inline;font-weight:400">${esc(c.telegram)}</span>` : ""}</div><div class="sub">${sub || defSub}</div>${extra}</div><div class="right">${right || defRight}</div></div>`;
}

function callRow(c, call) {
  const at = Date.parse(call.at);
  const now = Date.now();
  const cls = at - now < 15 * 60_000 && now - at < 60 * 60_000 ? "now" : at < now ? "past" : "";
  const passed = now >= at;
  const btns = passed && !call.outcome
    ? `<div class="quick"><button class="qbtn g-won" data-held="${c.id}" data-call="${call.id}">✅ Пришёл</button><button class="qbtn g-ndz" data-ndz="${c.id}" data-call="${call.id}">❌ НДЗ</button>${c.chatUrl ? `<button class="qbtn g-lead" data-link="${esc(c.chatUrl)}">💬 Чат</button>` : ""}</div>`
    : c.chatUrl ? `<div class="quick"><button class="qbtn g-lead" data-link="${esc(c.chatUrl)}">💬 Чат</button>${c.telegram ? `<button class="qbtn g-lead" data-link="${esc(tgUrl(c.telegram))}">✉️ Написать</button>` : ""}</div>` : "";
  const outcome = call.outcome === "held" ? (call.reportAt ? "✅ проведён" : "✅ проведён · нет отчёта") : call.outcome === "ndz" ? "❌ НДЗ" : "";
  return `<div class="tl-row ${cls}" data-open="${c.id}"><div class="tl-time">${mskTime(at)}<small>${fmtDay(mskKey(at))}</small></div><div class="tl-body"><div class="title">${esc(clientTitle(c))}</div><div class="sub">${statusBadge(c.status)}<span class="sub">· ${esc(userName(call.mopId))}${outcome ? ` · ${outcome}` : ""}</span></div>${c.info ? `<div class="sub">${esc(c.info.slice(0, 90))}</div>` : ""}${btns}</div></div>`;
}

function section(title, items, { empty = "", action = "" } = {}) {
  if (!items.length && !empty) return "";
  return `<div class="list-head"><h2 style="margin:0">${title}</h2>${action}</div>${items.length ? `<div class="list">${items.join("")}</div>` : `<div class="card empty small">${empty}</div>`}`;
}

// Все созвоны дня: [{c, call}]
function callsOn(day, filterFn = () => true) {
  const out = [];
  for (const c of state.clients) for (const call of c.calls || []) if (call.outcome !== "moved" && mskKey(Date.parse(call.at)) === day && filterFn(call, c)) out.push({ c, call });
  return out.sort((a, b) => Date.parse(a.call.at) - Date.parse(b.call.at));
}

// План: полоса факта, белая риска — где должны быть сегодня, прогноз и сколько надо в день.
function paceBlock(p, fmt, unit) {
  const lead = p.ahead >= 0 ? `опережаем на ${fmt(p.ahead)}` : `отстаём на ${fmt(-p.ahead)}`;
  return `<div class="pace"><i style="width:${Math.min(100, (p.pct || 0) * 100)}%"></i><u style="left:${Math.min(100, p.dayPct * 100)}%"></u></div>
    <div class="hero-foot"><span>${Math.round((p.pct || 0) * 100)}% плана ${fmt(p.plan)} · ${lead}</span><span>прогноз ${fmt(p.forecast)}</span></div>
    ${p.left ? `<div class="hero-foot"><span>нужно ${fmt(p.perDay)} ${unit}в день до конца месяца</span></div>` : `<div class="hero-foot"><span>🔥 план выполнен</span></div>`}`;
}

const FEED_SEEN_KEY = "feedSeen";
const feedSeen = () => {
  try {
    return localStorage.getItem(FEED_SEEN_KEY) || "";
  } catch {
    return "";
  }
};
const unreadFeed = () => state.feed.filter((f) => f.id > feedSeen() && f.by !== state.me.id).length;

// ---------- СЕГОДНЯ ----------
function renderToday() {
  const me = state.me;
  const role = me.role;
  const now = Date.now();
  const hello = `${["Доброй ночи", "Доброе утро", "Добрый день", "Добрый вечер"][Math.floor(((new Date(now).getUTCHours() + 3) % 24) / 6)]}, ${esc((me.name || "").split(" ")[0])}`;
  const dateLine = new Date(mskMidnight(today()) + 12 * 3600_000).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  const mineCall = (call) => role === "mop" ? call.mopId === me.id : true;
  const todays = callsOn(today(), (call) => (role === "lidorub" ? true : mineCall(call)));
  const tomorrow = callsOn(addDaysKey(today(), 1), (call) => (role === "lidorub" ? false : mineCall(call)));
  const reportsOwed = state.clients.filter((c) => needsReport(c) && (role !== "mop" || c.mopId === me.id));
  const unmarked = [];
  for (const c of state.clients) for (const call of c.calls || []) if (!call.outcome && Date.parse(call.at) + 15 * 60_000 < now && mskKey(Date.parse(call.at)) !== today() && (role !== "mop" || call.mopId === me.id)) unmarked.push({ c, call });
  const follow = state.clients.filter((c) => c.mopId && (role !== "mop" || c.mopId === me.id) && followupState(c, now)?.due);
  const fresh = state.clients.filter((c) => c.status === "new" && (role !== "lidorub" || !c.lidorubId || c.lidorubId === me.id));

  const unread = unreadFeed();
  let html = `<div class="hero"><div class="hero-top"><div><div class="hero-hi">${hello}</div><div class="hero-date">${esc(dateLine)} · ${esc(ROLES[role])}</div></div><div class="hero-actions"><button class="icon-btn" data-feed>🔔${unread ? `<em>${unread > 9 ? "9+" : unread}</em>` : ""}</button>${role !== "mop" ? `<button class="btn small light" data-new>＋ Лид</button>` : ""}</div></div>`;
  const mk = today().slice(0, 7);
  if (role === "lidorub") {
    const t = lidorubStats(state.clients, state.legacy, { from: today(), to: today(), people: new Set([me.id]), aliases: aliasesFor() }).total;
    const m = lidorubStats(state.clients, state.legacy, { ...periodRange("month"), people: new Set([me.id]), aliases: aliasesFor() }).total;
    const plan = state.settings.personPlans?.[me.id] || 0;
    const done = m.scheduled + m.baseScheduled;
    html += `<div class="hero-label">Записал на созвон сегодня</div><div class="hero-value">${t.scheduled + t.baseScheduled}</div>`;
    html += plan ? paceBlock(pace(done, plan, today()), (v) => String(v), "записей") : "";
    html += `<div class="hero-stats"><div><small>лидов сегодня</small><b>${t.received + t.baseResponses}</b></div><div><small>ЛМ сегодня</small><b>${t.lm + t.baseLm}</b></div><div><small>записей за месяц</small><b>${done}</b></div></div>`;
  } else {
    const people = role === "mop" ? new Set([me.id]) : null;
    const m = rnp(state.clients, state.legacy, { ...periodRange("month"), people, aliases: aliasesFor() }).total;
    const plan = role === "mop" ? state.settings.personPlans?.[me.id] || 0 : state.settings.monthPlan || 0;
    html += `<div class="hero-label">${role === "mop" ? "Мои продажи" : "Продажи"} · ${monthName(mk)}</div><div class="hero-value">${rub(m.salesSum)}</div>`;
    if (plan) html += paceBlock(pace(m.salesSum, plan, today()), rub, "");
    html += `<div class="hero-stats"><div><small>продаж</small><b>${m.sales}</b></div><div><small>доходимость</small><b>${pct(m.crHeld)}</b></div><div><small>CR в продажу</small><b>${pct(m.crSale)}</b></div></div>`;
  }
  html += `</div>`;

  // Долги — наверху, жёстко
  if (reportsOwed.length) html += `<button class="big-cta warn" data-open="${reportsOwed[0].id}" data-report="1"><span>📝</span><div>Нет отчёта после созвона: ${reportsOwed.length}<small>${esc(reportsOwed.slice(0, 3).map(clientTitle).join(", "))} — регламент: сразу после звонка</small></div></button>`;
  if (role === "lidorub") html += `<button class="big-cta" data-new><span>🪓</span><div>Новый лид<small>квалифицировать, отправить ЛМ, записать на созвон</small></div></button>`;

  if (isBoss()) html += teamToday();

  html += section(`📞 Созвоны сегодня · ${todays.length}`, todays.map(({ c, call }) => callRow(c, call)), { empty: role === "lidorub" ? "Сегодня никого не записано — время рубить лидов 🪓" : "Созвонов на сегодня нет" });
  if (unmarked.length) html += section(`⚠️ Не отмечен итог · ${unmarked.length}`, unmarked.map(({ c, call }) => callRow(c, call)));
  if (role !== "lidorub" && follow.length) {
    html += section(`🔁 Дожим — касание сегодня · ${follow.length}`, follow.map((c) => {
      const f = followupState(c, now);
      return clientRow(c, {
        extra: `<div class="quick"><button class="qbtn g-work" data-touch="${c.id}">Написал — тишина</button><button class="qbtn g-won" data-touch-ok="${c.id}">Ответил</button>${c.telegram ? `<button class="qbtn g-lead" data-link="${esc(tgUrl(c.telegram))}">✉️</button>` : ""}</div>`,
        right: `<div class="touches">${Array.from({ length: FOLLOWUP_TOUCHES }, (_, i) => `<i class="${i < f.touches ? "on" : ""}"></i>`).join("")}</div>`,
      });
    }));
  }
  if (role !== "mop" && fresh.length) {
    html += section(`🆕 Новые без созвона · ${fresh.length}`, fresh.slice(0, 30).map((c) =>
      clientRow(c, {
        sub: `${statusBadge(c.status)}<span class="sub">· ${esc(c.source)}${c.lidorubId ? ` · ${esc(userName(c.lidorubId))}` : ""}</span>`,
        extra: `<div class="quick">${(c.events || []).some((e) => e.t === "lm") ? `<span class="qmore">ЛМ ✓</span>` : `<button class="qbtn g-hot" data-lm="${c.id}">ЛМ отправлен</button>`}<button class="qbtn g-work" data-book="${c.id}">📅 На созвон</button><button class="qbtn g-lost" data-invalid="${c.id}">Невалид</button></div>`,
      }),
    ));
  }
  if (tomorrow.length) html += section(`Завтра · ${tomorrow.length}`, tomorrow.map(({ c, call }) => callRow(c, call)));
  if (money() && state.payments) {
    const pend = state.payments.filter((p) => !p.verified);
    if (pend.length) html += `<button class="big-cta" data-more="payroll" style="margin-top:14px"><span>💰</span><div>Оплаты ждут проверки: ${pend.length}<small>внеси чистую сумму после комиссии и поставь «верифицировано»</small></div></button>`;
  }
  $app.innerHTML = html;
}

// Таблица «кто как сегодня» для РОПа/собственника
function teamToday() {
  const day = today();
  const r = rnp(state.clients, state.legacy, { from: day, to: day, aliases: aliasesFor() });
  const rows = closers().map((u) => {
    const m = r.byPerson[u.id] || { scheduled: 0, held: 0, sales: 0, salesSum: 0 };
    const open = callsOn(day, (call) => call.mopId === u.id && !call.outcome).length;
    return `<div class="row" data-person="${u.id}">${avatar(u.name, u.id, 36)}<div class="grow"><div class="title">${esc(u.name)}</div><div class="sub">созвонов ${m.scheduled || 0} · проведено ${m.held || 0}${open ? ` · впереди ${open}` : ""}</div></div><div class="right"><b class="${m.salesSum ? "money-green" : ""}">${m.sales ? rub(m.salesSum) : "—"}</b></div></div>`;
  });
  const lr = lidorubStats(state.clients, state.legacy, { from: day, to: day });
  for (const u of lidorubs()) {
    const m = lr.byPerson[u.id] || { received: 0, lm: 0, scheduled: 0, baseScheduled: 0, baseResponses: 0 };
    rows.push(`<div class="row">${avatar(u.name, u.id, 36)}<div class="grow"><div class="title">${esc(u.name)} <span class="sub" style="display:inline">· лидоруб</span></div><div class="sub">лидов ${m.received + m.baseResponses} · ЛМ ${m.lm} · записал ${m.scheduled + m.baseScheduled}</div></div></div>`);
  }
  return rows.length ? section("Команда сегодня", rows) : "";
}

// ---------- КЛИЕНТЫ ----------
// Папки лидов: путь клиента от заявки до денег. Тап — фильтр списка.
const FOLDERS = [
  ["active", "В работе", (c) => !isClosed(c.status)],
  ["new", "Новые, без ЛМ", (c) => c.status === "new" && !(c.events || []).some((e) => e.t === "lm")],
  ["lm", "ЛМ отправлен, ждут записи", (c) => c.status === "new" && (c.events || []).some((e) => e.t === "lm")],
  ["calls", "Созвон назначен", (c) => !!currentCall(c)],
  ["today", "Созвон сегодня", (c) => (c.calls || []).some((x) => !x.outcome && mskKey(Date.parse(x.at)) === today())],
  ["report", "Нет отчёта", (c) => needsReport(c), true],
  ["ndz", "НДЗ", (c) => ["ndz1", "ndz2", "ndz3"].includes(c.status), true],
  ["follow", "Дожим", (c) => !!followupState(c), true],
  ["hot", "Думают / предоплата", (c) => ["thinking", "prepaid"].includes(c.status)],
  ["paid", "Оплатили", (c) => c.status === "paid"],
  ["bank", "Отказ по банкам → рекрутеру", (c) => c.status === "refuse_bank"],
  ["lost", "Отказ, игнор, невалид", (c) => ["refuse_personal", "ignore", "invalid"].includes(c.status)],
  ["all", "Все", () => true],
];
function filterClients() {
  const q = state.query.trim().toLowerCase();
  const folder = FOLDERS.find((f) => f[0] === state.filter) || FOLDERS[0];
  return byPerson(state.clients)
    .filter((c) => (!q || [c.name, c.telegram, c.phone, c.info].join(" ").toLowerCase().includes(q)) && folder[2](c))
    .sort((a, b) => {
      const ca = currentCall(a), cb = currentCall(b);
      if (ca && cb) return Date.parse(ca.at) - Date.parse(cb.at);
      if (ca || cb) return ca ? -1 : 1;
      return (b.updatedAt || "").localeCompare(a.updatedAt || "");
    });
}
const byPerson = (list) => (state.person === "all" ? list : list.filter((c) => c.mopId === state.person || c.lidorubId === state.person));

function renderClients() {
  const list = filterClients();
  const people = [...closers(), ...lidorubs()];
  const base = byPerson(state.clients);
  const folders = FOLDERS.map(([id, label, fn, alert]) => {
    const n = base.filter(fn).length;
    return `<button class="folder ${state.filter === id ? "active" : ""} ${alert && n ? "alert" : ""}" data-filter="${id}"><b>${n}</b><span>${label}</span></button>`;
  }).join("");
  $app.innerHTML = `
    <div class="toolbar"><input type="search" id="q" placeholder="Поиск: имя, ник, телефон, инфа" value="${esc(state.query)}"><button class="btn round" data-new>＋</button></div>
    ${people.length > 1 ? `<div class="chips"><button class="chip ${state.person === "all" ? "active" : ""}" data-pfilter="all">Вся команда</button>${people.map((u) => `<button class="chip ${state.person === u.id ? "active" : ""}" data-pfilter="${u.id}">${esc(u.name)}</button>`).join("")}</div>` : ""}
    <div class="folders">${folders}</div>
    <div class="sub" style="margin:0 4px 8px">${esc(FOLDERS.find((f) => f[0] === state.filter)?.[1] || "")}: ${list.length} ${plural(list.length, "клиент", "клиента", "клиентов")}</div>
    ${list.length ? `<div class="list">${list.slice(0, 300).map((c) => clientRow(c)).join("")}</div>` : `<div class="card empty">Пусто. ${state.clients.length ? "Загляни в другую папку." : "Жми ＋ и заводи первого клиента."}</div>`}`;
  const q = document.getElementById("q");
  q.oninput = () => {
    state.query = q.value;
    const pos = q.selectionStart;
    renderClients();
    const nq = document.getElementById("q");
    nq.focus();
    nq.setSelectionRange(pos, pos);
  };
}

// ---------- КАРТОЧКА ----------
function renderClient(c) {
  const call = currentCall(c);
  const now = Date.now();
  const f = followupState(c, now);
  const callsDone = (c.calls || []).filter((x) => x.outcome && x.outcome !== "moved").reverse();
  let html = `<div class="lead-card"><div class="lead-head">${avatar(clientTitle(c), c.id, 52)}<div class="grow" style="min-width:0"><h1>${esc(clientTitle(c))}</h1><div class="sub">${statusBadge(c.status)} ${c.telegram && c.name ? esc(c.telegram) : ""}</div></div></div>
    <div class="actions">
      ${c.telegram ? `<button class="action" data-link="${esc(tgUrl(c.telegram))}"><span>✉️</span>Написать</button>` : ""}
      ${c.chatUrl ? `<button class="action" data-link="${esc(c.chatUrl)}"><span>💬</span>Чат</button>` : ""}
      ${c.phone ? `<a class="action" href="tel:${esc(c.phone)}"><span>📞</span>Позвонить</a>` : ""}
      <button class="action" data-book="${c.id}"><span>📅</span>${call ? "Перенести" : "Созвон"}</button>
      <button class="action" data-paylinks="${c.id}"><span>💳</span>Ссылка</button>
    </div>${c.payLinkId ? `<div class="sub" style="margin-top:10px">💳 Отправлена ссылка: <b>${esc(linkById(c.payLinkId)?.label || c.payLinkId)}</b></div>` : ""}</div>`;

  if (needsReport(c)) html += `<button class="big-cta warn" data-report-open="${c.id}"><span>📝</span><div>Заполнить отчёт после диагностики<small>потребность, боль, возражение, договорённости</small></div></button>`;

  if (call) {
    const at = Date.parse(call.at);
    html += `<h2>Созвон</h2><div class="card"><div class="title">${fmtWhen(at)} МСК</div><div class="sub">Диагност: ${esc(userName(call.mopId))}${call.setBy ? ` · записал ${esc(userName(call.setBy))}` : ""}</div>
      ${now >= at - 30 * 60_000 ? `<div class="quick"><button class="qbtn g-won" data-held="${c.id}" data-call="${call.id}">✅ Пришёл, провёл</button><button class="qbtn g-ndz" data-ndz="${c.id}" data-call="${call.id}">❌ НДЗ</button></div>` : `<div class="sub" style="margin-top:6px">Бот напомнит диагносту за 2 часа, за час и за 15 минут.</div>`}</div>`;
  }

  if (f) {
    html += `<h2>Дожим</h2><div class="card"><div class="hbar-top"><span>Касаний без ответа</span><div class="touches">${Array.from({ length: FOLLOWUP_TOUCHES }, (_, i) => `<i class="${i < f.touches ? "on" : ""}"></i>`).join("")}</div></div><div class="sub">Регламент: 3 дня подряд, после третьего без ответа — «Игнор».${f.touchedToday ? " Сегодня уже касались." : ""}</div><div class="quick"><button class="qbtn g-work" data-touch="${c.id}">Написал — тишина</button><button class="qbtn g-won" data-touch-ok="${c.id}">Ответил</button></div></div>`;
  }

  html += `<h2>Статус</h2><div class="chips tight" style="margin-top:0">${STATUSES.map((s) => `<button class="chip ${c.status === s.id ? "active" : ""}" data-status="${s.id}">${s.label}</button>`).join("")}</div>`;

  if (c.status === "refuse_bank") html += `<div class="card" style="margin-top:8px"><div class="sub">Отказ по банкам → по регламенту передаём рекрутеру: клиент может зайти в РКО как исполнитель.</div></div>`;

  html += `<h2>Данные</h2><div class="card">
    <label class="field"><span>Имя</span><input data-f="name" value="${esc(c.name)}"></label>
    <div class="two"><label class="field"><span>Telegram</span><input data-f="telegram" value="${esc(c.telegram)}" placeholder="@nick"></label><label class="field"><span>Телефон</span><input data-f="phone" value="${esc(c.phone)}" inputmode="tel"></label></div>
    <label class="field"><span>Чат (клиент + диагност + зеркало эксперта)</span><input data-f="chatUrl" value="${esc(c.chatUrl)}" placeholder="https://t.me/+..."></label>
    <div class="two"><label class="field"><span>Источник</span><select data-f="source">${SOURCES.map((s) => `<option ${s === c.source ? "selected" : ""}>${s}</option>`).join("")}</select></label>
    <label class="field"><span>Лидоруб</span><select data-f="lidorubId"><option value="">—</option>${lidorubs().map((u) => `<option value="${u.id}" ${u.id === c.lidorubId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label></div>
    <label class="field"><span>Тариф / сумма, на которую идёт</span><input data-f="wantedSum" inputmode="numeric" value="${c.wantedSum || ""}" placeholder="100000"></label>
    <label class="field"><span>Доп. инфа (для диагноста)</span><textarea data-f="info" placeholder="откуда, что пробовал, долги, на что прогрет">${esc(c.info)}</textarea></label>
  </div>`;

  if (callsDone.length) {
    html += `<h2>Созвоны и отчёты</h2><div class="list">${callsDone
      .map((x) => {
        const rep = x.report;
        return `<div class="card" style="border-radius:0"><div class="hbar-top"><b>${fmtWhen(Date.parse(x.at))}</b><span class="sub">${x.outcome === "held" ? "✅ проведён" : "❌ НДЗ"} · ${esc(userName(x.mopId))}</span></div>${rep ? `<div class="report-view">${REPORT_FIELDS.map((rf) => (rep[rf.id] ? `<div><b>${rf.label}</b>${esc(rep[rf.id])}</div>` : "")).join("")}<div class="sub">Презентация тарифов: ${rep.presented ? "да" : "нет"} · Предложил оплатить: ${rep.offeredPay ? "да" : "нет"}</div></div>` : x.outcome === "held" ? `<button class="link" data-report-open="${c.id}">Заполнить отчёт →</button>` : ""}</div>`;
      })
      .join("")}</div>`;
  }

  html += `<h2>История</h2><div class="card"><div class="toolbar" style="margin:0"><input id="comment" placeholder="Комментарий"><button class="btn small" data-comment="${c.id}">↵</button></div></div>
    <div class="list history" style="margin-top:6px">${(c.history || []).slice(0, 30).map((h) => `<div class="row"><div class="grow">${esc(h.text)}</div><div class="right sub">${esc(userName(h.by))}<br>${fmtWhen(Date.parse(h.at))}</div></div>`).join("")}</div>`;
  if (money()) html += `<button class="btn danger" data-delete="${c.id}">Удалить клиента</button>`;
  $app.innerHTML = html;

  // автосохранение полей
  for (const el of $app.querySelectorAll("[data-f]")) {
    el.onchange = async () => {
      try {
        const res = await api("PATCH", `/clients/${c.id}`, { [el.dataset.f]: el.value });
        replaceClient(res.client);
        toast("Сохранено");
      } catch (e) {
        alertDialog(e.message);
      }
    };
  }
}

// ---------- ссылки на оплату ----------
const payLinks = () => (state.settings.payLinks?.length ? state.settings.payLinks : DEFAULT_PAY_LINKS);
const linkById = (id) => payLinks().find((l) => l.id === id);
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
function linksList(c) {
  const groups = {};
  for (const l of payLinks()) (groups[l.provider] ||= []).push(l);
  return Object.entries(groups)
    .map(([prov, ls]) => `<div class="sheet-label">${esc(prov)}</div><div class="list">${ls
      .map((l) => `<div class="link-row"><div class="grow"><div class="title">${esc(l.label)}</div><div class="sub">${l.commission !== null && l.commission !== undefined ? `комиссия ${String(l.commission).replace(".", ",")}% · чистыми ${compact(l.amount * (1 - l.commission / 100))}` : "комиссия — уточнить"}${l.note ? ` · ${esc(l.note)}` : ""}</div></div><button class="qbtn g-lead" data-copy="${l.id}" ${c ? `data-cid="${c.id}"` : ""}>Копировать</button><button class="qbtn g-won" data-share="${l.id}" ${c ? `data-cid="${c.id}"` : ""}>Отправить</button></div>`)
      .join("")}</div>`)
    .join("");
}
function openPayLinks(c) {
  openSheet(`<div class="sheet-title">Ссылка на оплату</div><div class="sub" style="margin:0 4px 6px">${c ? `${esc(clientTitle(c))} · ` : ""}отметится в карточке, а при оплате чистая сама встанет в ведомость</div>${linksList(c)}`, (sh) => {
    sh.onclick = async (e) => {
      const b = e.target.closest("[data-copy],[data-share]");
      if (!b) return;
      const l = linkById(b.dataset.copy || b.dataset.share);
      if (b.dataset.share) {
        const text = `Ссылка на оплату обучения (${l.amount.toLocaleString("ru-RU")} ₽): ${l.url}`;
        const url = `https://t.me/share/url?url=${encodeURIComponent(l.url)}&text=${encodeURIComponent(text)}`;
        tg?.openTelegramLink ? tg.openTelegramLink(url) : window.open(url, "_blank");
      } else {
        toast((await copyText(l.url)) ? "Ссылка скопирована" : l.url);
      }
      haptic();
      if (b.dataset.cid) {
        closeSheet();
        await act(b.dataset.cid, { type: "paylink", linkId: l.id });
      }
    };
  });
}

// ---------- шторки: новый лид, запись на созвон, отчёт, сумма ----------
function openNewClient() {
  const me = state.me;
  openSheet(
    `<div class="sheet-title">Новый лид</div>
    <div class="card">
      <label class="field"><span>Имя</span><input id="n-name" placeholder="Иван"></label>
      <div class="two"><label class="field"><span>Telegram</span><input id="n-tg" placeholder="@nick"></label><label class="field"><span>Телефон</span><input id="n-phone" inputmode="tel"></label></div>
      <div class="sheet-label">Источник</div><div class="chips tight" id="n-src">${SOURCES.map((s, i) => `<button class="chip ${i === 0 ? "active" : ""}" data-v="${s}">${s}</button>`).join("")}</div>
      ${me.role !== "lidorub" && lidorubs().length ? `<label class="field" style="margin-top:10px"><span>Лидоруб</span><select id="n-lr"><option value="">—</option>${lidorubs().map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select></label>` : ""}
      <label class="field" style="margin-top:10px"><span>Доп. инфа</span><textarea id="n-info" placeholder="откуда пришёл, что пробовал, на что прогрет"></textarea></label>
      <label class="field"><span>Чат с клиентом (если уже создан)</span><input id="n-chat" placeholder="https://t.me/+..."></label>
    </div>
    <button class="btn block" id="n-save">Создать</button>
    <button class="btn block ghost" id="n-save-book">Создать и записать на созвон</button>`,
    (sh) => {
      let src = SOURCES[0];
      sh.querySelector("#n-src").onclick = (e) => {
        const b = e.target.closest("[data-v]");
        if (!b) return;
        src = b.dataset.v;
        for (const x of sh.querySelectorAll("#n-src .chip")) x.classList.toggle("active", x === b);
      };
      const save = async (book) => {
        const body = {
          name: sh.querySelector("#n-name").value,
          telegram: sh.querySelector("#n-tg").value,
          phone: sh.querySelector("#n-phone").value,
          info: sh.querySelector("#n-info").value,
          chatUrl: sh.querySelector("#n-chat").value,
          source: src,
          lidorubId: sh.querySelector("#n-lr")?.value || (me.role === "lidorub" ? me.id : null),
        };
        try {
          const res = await api("POST", "/clients", body);
          replaceClient(res.client);
          haptic("medium");
          closeSheet();
          render();
          if (book) openBooking(res.client);
          else toast("Лид заведён");
        } catch (e) {
          if (e.status === 409 && e.data?.client) {
            closeSheet();
            replaceClient(e.data.client);
            toast("Такой клиент уже есть — открыл карточку");
            state.tab = "clients";
            state.clientId = e.data.client.id;
            render();
          } else alertDialog(e.message);
        }
      };
      sh.querySelector("#n-save").onclick = () => save(false);
      sh.querySelector("#n-save-book").onclick = () => save(true);
    },
  );
}

const SLOT_HOURS = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
function openBooking(c, day = null) {
  const cur = currentCall(c);
  let pickDay = day || (cur ? mskKey(Date.parse(cur.at)) : today());
  let mop = cur?.mopId || c.mopId || (state.me.role === "mop" ? state.me.id : closers()[0]?.id) || null;
  let time = null;
  const draw = (sh) => {
    const busy = new Set(callsOn(pickDay, (call) => call.mopId === mop && !call.outcome).map(({ call }) => mskTime(Date.parse(call.at))));
    const days = Array.from({ length: 10 }, (_, i) => addDaysKey(today(), i));
    sh.innerHTML = `<div class="sheet-grip"></div><div class="sheet-title">Созвон с ${esc(clientTitle(c))}</div>
      ${cur ? `<div class="sub" style="margin:0 4px 10px">Сейчас: ${fmtWhen(Date.parse(cur.at))} — будет перенесён</div>` : ""}
      <div class="sheet-label">Диагност</div>
      <div class="chips tight">${closers().map((u) => `<button class="chip ${u.id === mop ? "active" : ""}" data-mop="${u.id}">${esc(u.name)}</button>`).join("") || `<span class="sub">Добавь менеджеров в «Ещё → Команда»</span>`}</div>
      <div class="sheet-label">День</div>
      <div class="days">${days.map((d) => `<button class="day ${d === pickDay ? "active" : ""}" data-day="${d}"><small>${weekday(d)}</small><b>${d.slice(8)}</b><i>${callsOn(d, (call) => call.mopId === mop && !call.outcome).length || ""}</i></button>`).join("")}</div>
      <div class="sheet-label">Время (МСК) — зачёркнуто = у диагноста уже созвон</div>
      <div class="slots">${SLOT_HOURS.map((t) => `<button class="slot ${busy.has(t) || Date.parse(`${pickDay}T${t}:00+03:00`) < Date.now() ? "busy" : ""} ${time === t ? "active" : ""}" data-time="${t}">${t}</button>`).join("")}</div>
      <label class="field" style="margin-top:10px"><span>Другое время</span><input type="time" id="b-time" value="${time && !SLOT_HOURS.includes(time) ? time : ""}"></label>
      <button class="btn block" id="b-save" ${mop && time ? "" : "disabled"}>${time ? `Записать на ${fmtDay(pickDay)} в ${time}` : "Выбери время"}</button>`;
    sh.onclick = (e) => {
      const b = e.target.closest("[data-mop],[data-day],[data-time]");
      if (!b) return;
      if (b.dataset.mop) mop = b.dataset.mop;
      if (b.dataset.day) pickDay = b.dataset.day;
      if (b.dataset.time) time = b.dataset.time;
      haptic();
      draw(sh);
    };
    sh.querySelector("#b-time").onchange = (e) => {
      time = e.target.value || null;
      draw(sh);
    };
    sh.querySelector("#b-save").onclick = async () => {
      const at = new Date(Date.parse(`${pickDay}T${time}:00+03:00`)).toISOString();
      if (busy.has(time) && !(await confirmDialog("У диагноста уже есть созвон в это время. Всё равно записать?"))) return;
      closeSheet();
      await act(c.id, { type: "call", at, mopId: mop }, `Записан: ${fmtDay(pickDay)} в ${time} к ${userName(mop)}`);
    };
  };
  openSheet("", draw);
}

function openReport(c) {
  if (!c) return;
  const held = [...(c.calls || [])].reverse().find((x) => x.outcome === "held" && !x.reportAt) || [...(c.calls || [])].reverse().find((x) => x.outcome === "held");
  if (!held) return alertDialog("Сначала отметь, что созвон проведён");
  const rep = held.report || {};
  let status = null;
  let presented = rep.presented ?? null;
  let offered = rep.offeredPay ?? null;
  openSheet(
    `<div class="sheet-title">Отчёт после диагностики</div><div class="sub" style="margin:0 4px 10px">${esc(clientTitle(c))} · ${fmtWhen(Date.parse(held.at))}</div>
    <div class="card">${REPORT_FIELDS.map((f) => `<label class="field"><span>${f.label}</span><textarea data-r="${f.id}" style="min-height:56px">${esc(rep[f.id] || "")}</textarea></label>`).join("")}
      <div class="sheet-label">Провёл презентацию по тарифам</div><div class="yn" data-yn="presented"><button class="chip ${presented === true ? "active" : ""}" data-v="1">Да</button><button class="chip ${presented === false ? "active" : ""}" data-v="0">Нет</button></div>
      <div class="sheet-label">Предложил оплатить</div><div class="yn" data-yn="offered"><button class="chip ${offered === true ? "active" : ""}" data-v="1">Да</button><button class="chip ${offered === false ? "active" : ""}" data-v="0">Нет</button></div>
    </div>
    <div class="sheet-label">Итоговый статус</div>
    <div class="chips tight" id="r-status">${AFTER_CALL.map((s) => `<button class="chip" data-s="${s}">${statusLabel(s)}</button>`).join("")}</div>
    <div id="r-extra"></div>
    <button class="btn block" id="r-save">Сохранить отчёт</button>`,
    (sh) => {
      const extra = sh.querySelector("#r-extra");
      const drawExtra = () => {
        const needSum = ["paid", "prepaid", "thinking", "resched", "refuse_bank"].includes(status);
        const label = { paid: "Сумма оплаты (тариф)", prepaid: "Сумма предоплаты", thinking: "Сумма потенциала (тариф)", resched: "Сумма потенциала (тариф)", refuse_bank: "На какую сумму не одобрили" }[status];
        extra.innerHTML = `${needSum ? `<div class="card" style="margin-top:10px"><label class="field"><span>${label}</span><input id="r-sum" inputmode="numeric" value="${status === "prepaid" ? "" : c.wantedSum || ""}" placeholder="100000"></label>${status === "prepaid" ? `<label class="field"><span>Полный тариф</span><input id="r-wanted" inputmode="numeric" value="${c.wantedSum || ""}"></label>` : ""}</div>` : ""}${status === "resched" ? `<div class="card" style="margin-top:8px"><label class="field"><span>Новый созвон (МСК)</span><input type="datetime-local" id="r-next"></label></div>` : ""}`;
      };
      sh.querySelector("#r-status").onclick = (e) => {
        const b = e.target.closest("[data-s]");
        if (!b) return;
        status = b.dataset.s;
        for (const x of sh.querySelectorAll("#r-status .chip")) x.classList.toggle("active", x === b);
        drawExtra();
      };
      for (const g of sh.querySelectorAll("[data-yn]")) {
        g.onclick = (e) => {
          const b = e.target.closest("[data-v]");
          if (!b) return;
          for (const x of g.querySelectorAll(".chip")) x.classList.toggle("active", x === b);
          if (g.dataset.yn === "presented") presented = b.dataset.v === "1";
          else offered = b.dataset.v === "1";
        };
      }
      sh.querySelector("#r-save").onclick = async () => {
        if (!status) return alertDialog("Выбери итоговый статус — без него CRM не обновится");
        const report = { presented: !!presented, offeredPay: !!offered };
        for (const el of sh.querySelectorAll("[data-r]")) report[el.dataset.r] = el.value;
        const body = { type: "report", callId: held.id, report, status, sum: sh.querySelector("#r-sum")?.value };
        if (status === "paid") body.wantedSum = body.sum;
        if (sh.querySelector("#r-wanted")) body.wantedSum = sh.querySelector("#r-wanted").value;
        const next = sh.querySelector("#r-next")?.value;
        if (next) body.nextAt = new Date(Date.parse(`${next}:00+03:00`)).toISOString();
        closeSheet();
        const res = await act(c.id, body, "Отчёт сохранён");
        if (res && status === "paid") celebrate(Number(body.sum) || 0);
      };
    },
  );
}

// Статусы, где нужна сумма — спросить её.
function openStatus(c, status) {
  const needSum = ["paid", "prepaid", "thinking", "resched", "refuse_bank"].includes(status);
  if (!needSum) {
    return act(c.id, { type: "status", status }, `Статус: ${statusLabel(status)}`);
  }
  const label = { paid: "Сумма оплаты (тариф)", prepaid: "Сумма предоплаты", thinking: "Потенциал — на какой тариф", resched: "Потенциал — на какой тариф", refuse_bank: "На какую сумму не одобрили" }[status];
  openSheet(
    `<div class="sheet-title">${statusLabel(status)}</div><div class="card"><label class="field"><span>${label}</span><input id="s-sum" inputmode="numeric" value="${status === "prepaid" ? "" : c.wantedSum || ""}" placeholder="100000"></label></div>
    ${status === "paid" ? `<div class="sub" style="margin:8px 4px">Оплата упадёт в зарплатную ведомость — Андрей внесёт чистую и верифицирует.</div>` : ""}
    <button class="btn block" id="s-save">Сохранить</button>`,
    (sh) => {
      sh.querySelector("#s-save").onclick = async () => {
        const sum = sh.querySelector("#s-sum").value;
        closeSheet();
        const res = await act(c.id, { type: "status", status, sum }, `Статус: ${statusLabel(status)}`);
        if (res && status === "paid") celebrate(Number(sum) || 0);
      };
    },
  );
}

function celebrate(sum) {
  haptic("heavy");
  const wrap = document.createElement("div");
  wrap.className = "confetti";
  wrap.innerHTML = `${Array.from({ length: 16 }, (_, i) => `<span style="left:${5 + i * 6}%;--dx:${(i % 2 ? 1 : -1) * (10 + i * 3)}px;animation-delay:${(i % 5) * 0.06}s">${["💸", "🔥", "💰", "🚀"][i % 4]}</span>`).join("")}${sum ? `<div class="confetti-sum">+${rub(sum)}</div>` : ""}`;
  document.body.append(wrap);
  setTimeout(() => wrap.remove(), 1800);
}

// ---------- СОЗВОНЫ (окна) ----------
function renderCalendar() {
  const days = Array.from({ length: 14 }, (_, i) => addDaysKey(today(), i - 3));
  const list = callsOn(state.calDay);
  const byMop = {};
  for (const x of list) (byMop[x.call.mopId] ||= []).push(x);
  let html = `<h1>Окна для звонков</h1><div class="sub" style="margin:0 4px 10px">Время московское. Тап по клиенту — карточка.</div>
    <div class="days">${days.map((d) => `<button class="day ${d === state.calDay ? "active" : ""}" data-cal="${d}"><small>${d === today() ? "сег" : weekday(d)}</small><b>${d.slice(8)}</b><i>${callsOn(d).length || ""}</i></button>`).join("")}</div>`;
  const mopIds = [...new Set([...closers().map((u) => u.id), ...Object.keys(byMop)])];
  for (const id of mopIds) {
    const items = byMop[id] || [];
    html += section(`${esc(userName(id))} · ${items.length}`, items.map(({ c, call }) => callRow(c, call)), { empty: "Свободен весь день" });
  }
  if (!mopIds.length) html += `<div class="card empty">Добавь менеджеров ОП в «Ещё → Команда», и здесь появятся их окна.</div>`;
  $app.innerHTML = html;
}

// ---------- РнП ----------
const PERIODS = [["today", "Сегодня"], ["yesterday", "Вчера"], ["7", "7 дней"], ["half", "Пол-месяца"], ["month", "Месяц"], ["prev_month", "Прошлый месяц"], ["30", "30 дней"], ["all", "Всё время"]];

// Такой же по длине период прямо перед выбранным — для «▲ +12%».
function prevRange(r) {
  if (!r.from || !r.to) return null;
  const len = (Date.parse(r.to) - Date.parse(r.from)) / 86400_000 + 1;
  return { from: addDaysKey(r.from, -len), to: addDaysKey(r.from, -1) };
}
const delta = (cur, prev) => {
  if (!prev) return "";
  const d = Math.round(((cur - prev) / prev) * 100);
  return d ? `<span class="delta ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${Math.abs(d)}%</span>` : "";
};
function dayList(r, fallbackDays) {
  const keys = Object.keys(fallbackDays).sort();
  const from = r.from || keys[0] || today();
  const to = r.to || keys.at(-1) || today();
  const out = [];
  for (let d = from; d <= to && out.length < 400; d = addDaysKey(d, 1)) out.push(d);
  return out;
}

function renderStats() {
  const range = periodRange(state.period);
  const aliases = aliasesFor();
  const ids = new Set([...closers(), ...lidorubs()].map((u) => u.id));
  const personChips = `<div class="chips"><button class="chip ${state.statsPerson === "all" ? "active" : ""}" data-sperson="all">Вся команда</button>${(state.statsView === "lr" ? lidorubs() : closers()).map((u) => `<button class="chip ${state.statsPerson === u.id ? "active" : ""}" data-sperson="${u.id}">${esc(u.name)}</button>`).join("")}</div>`;
  const people = state.statsPerson !== "all" && ids.has(state.statsPerson) ? new Set([state.statsPerson]) : null;
  let html = `<h1>РнП</h1>
    <div class="seg"><button class="${state.statsView === "rnp" ? "active" : ""}" data-sview="rnp">Отдел продаж</button><button class="${state.statsView === "lr" ? "active" : ""}" data-sview="lr">Лидоруб</button><button class="${state.statsView === "days" ? "active" : ""}" data-sview="days">По дням</button></div>
    <div class="chips">${PERIODS.map(([id, l]) => `<button class="chip ${state.period === id ? "active" : ""}" data-period="${id}">${l}</button>`).join("")}</div>${personChips}`;

  if (state.statsView === "lr") {
    const r = lidorubStats(state.clients, state.legacy, { ...range, people, aliases });
    const pr = prevRange(range);
    const p = pr ? lidorubStats(state.clients, state.legacy, { ...pr, people, aliases }).total : null;
    const t = r.total;
    const sched = t.scheduled + t.baseScheduled;
    html += `<div class="kpis"><div class="kpi accent wide"><div class="label">Записано на диагностику</div><div class="value">${sched}${delta(sched, p && p.scheduled + p.baseScheduled)}</div><div class="hint">из ${t.received + t.baseResponses} лидов · CR ${pct((t.received + t.baseResponses) ? sched / (t.received + t.baseResponses) : null)}</div></div></div>`;
    html += funnelChart([
      { label: "Получено новых лидов", value: t.received },
      { label: "Валидных", value: Math.max(0, t.received - t.invalid) },
      { label: "Отправлен ЛМ", value: t.lm },
      { label: "Записано на созвон", value: t.scheduled },
    ], { title: "Новые заявки" });
    if (t.baseResponses) html += funnelChart([{ label: "Откликов из базы", value: t.baseResponses }, { label: "Отправлен ЛМ", value: t.baseLm }, { label: "Записано", value: t.baseScheduled }], { title: "Работа по базе" });
    const days = dayList(range, r.days);
    if (days.length > 1) html += columns(days.map((d) => ({ label: fmtDay(d), value: (r.days[d]?.scheduled || 0) + (r.days[d]?.baseScheduled || 0), tip: `${fmtDay(d)} ${weekday(d)}: записано ${(r.days[d]?.scheduled || 0) + (r.days[d]?.baseScheduled || 0)}, лидов ${(r.days[d]?.received || 0) + (r.days[d]?.baseResponses || 0)}` })), { title: "Записи на созвон по дням", fmt: (v) => String(Math.round(v)) });
    // Что стало с записанными лидоруба: дошли, купили
    const mine = state.clients.filter((c) => c.lidorubId && (!people || people.has(c.lidorubId)));
    const held = mine.filter((c) => (c.calls || []).some((x) => x.outcome === "held")).length;
    const paid = mine.filter((c) => c.status === "paid").length;
    if (mine.length) html += `<h2>Качество лидов (вся база)</h2><div class="kpis three"><div class="kpi"><div class="label">Заведено</div><div class="value">${mine.length}</div></div><div class="kpi"><div class="label">Дошли</div><div class="value">${held}</div></div><div class="kpi"><div class="label">Купили</div><div class="value">${paid}</div></div></div>`;
    $app.innerHTML = html;
    return;
  }

  const r = rnp(state.clients, state.legacy, { ...range, people, aliases });
  const t = r.total;
  const days = dayList(range, r.days);

  if (state.statsView === "days") {
    if (days.length > 1) html += columns(days.map((d) => ({ label: fmtDay(d), value: r.days[d]?.salesSum || 0, tip: `${fmtDay(d)} ${weekday(d)}: ${rub(r.days[d]?.salesSum || 0)} · продаж ${r.days[d]?.sales || 0}` })), { title: "Продажи по дням, ₽" });
    const list = days.filter((d) => r.days[d]).reverse();
    html += list.length
      ? `<div class="rnp" style="margin-top:10px"><table><tr><th>День</th><th>Лиды</th><th>Назн.</th><th>Пров.</th><th>Прод.</th><th>Сумма</th><th>Потенц.</th></tr>${list.map((d) => { const m = r.days[d]; return `<tr><td>${fmtDay(d)} ${weekday(d)}</td><td>${m.leads}</td><td>${m.scheduled}</td><td>${m.held}</td><td>${m.sales}</td><td class="${m.salesSum ? "money-green" : ""}">${m.salesSum ? compact(m.salesSum) : "—"}</td><td>${m.potentialSum ? compact(m.potentialSum) : "—"}</td></tr>`; }).join("")}</table></div>`
      : `<div class="card empty">За период пусто</div>`;
    $app.innerHTML = html;
    return;
  }

  const pr = prevRange(range);
  const p = pr ? rnp(state.clients, state.legacy, { ...pr, people, aliases }).total : null;
  const spark = days.slice(-14).map((d) => r.days[d]?.salesSum || 0);
  html += `<div class="kpis"><div class="kpi accent wide"><div class="label">Продажи${pr ? " · к прошлому такому же периоду" : ""}</div><div class="value">${rub(t.salesSum)}${delta(t.salesSum, p?.salesSum)}</div><div class="hint">${t.sales} ${plural(t.sales, "продажа", "продажи", "продаж")} · средний чек ${rub(t.avgCheck)}${t.prepaySum ? ` · предоплат ${rub(t.prepaySum)}` : ""}</div>${sparkline(spark)}</div>
    <div class="kpi"><div class="label">Доходимость</div><div class="value">${pct(t.crHeld)}</div><div class="hint">${t.held} из ${t.scheduled} назначенных</div></div>
    <div class="kpi"><div class="label">CR диагностика → оплата</div><div class="value">${pct(t.crSale)}</div><div class="hint">${t.sales} из ${t.held}</div></div>
    <div class="kpi"><div class="label">Потенциал</div><div class="value">${compact(t.potentialSum)}</div><div class="hint">${t.potential} ${plural(t.potential, "клиент", "клиента", "клиентов")} думают</div></div>
    <div class="kpi"><div class="label">Отказы по банкам</div><div class="value">${compact(t.bankSum)}</div><div class="hint">${t.bank} шт. → рекрутеру</div></div></div>`;

  html += funnelChart([
    { label: "Лидов в работе", value: t.leads },
    { label: "Назначено диагностик", value: t.scheduled },
    { label: "Проведено", value: t.held },
    { label: "Оплатили", value: t.sales, display: `${t.sales} · ${compact(t.salesSum)}` },
  ], { title: "Воронка отдела продаж" });

  // Месяц: накопительно против плана
  if (["month", "half"].includes(state.period)) {
    const mk = today().slice(0, 7);
    const full = rnp(state.clients, state.legacy, { from: `${mk}-01`, to: today(), people, aliases });
    const n = daysInMonth(mk);
    const plan = people ? [...people].reduce((sum, id) => sum + (state.settings.personPlans?.[id] || 0), 0) : state.settings.monthPlan || 0;
    html += cumulative(Array.from({ length: n }, (_, i) => {
      const d = `${mk}-${String(i + 1).padStart(2, "0")}`;
      return { label: fmtDay(d), value: full.days[d]?.salesSum || 0, future: d > today() };
    }), { plan, title: `Выручка за ${monthName(mk)}${plan ? " против плана" : ""}` });
  } else if (days.length > 1) {
    html += columns(days.map((d) => ({ label: fmtDay(d), value: r.days[d]?.salesSum || 0, tip: `${fmtDay(d)} ${weekday(d)}: ${rub(r.days[d]?.salesSum || 0)} · продаж ${r.days[d]?.sales || 0}` })), { title: "Продажи по дням, ₽" });
  }

  // Рейтинг менеджеров
  const ranking = Object.entries(rnp(state.clients, state.legacy, { ...range, aliases }).byPerson).sort((a, b) => b[1].salesSum - a[1].salesSum);
  if (ranking.length) {
    const max = Math.max(1, ...ranking.map(([, m]) => m.salesSum));
    html += `<h2>Рейтинг менеджеров</h2><div class="list leader">${ranking.map(([id, m], i) => `<div class="hbar" data-sperson="${id}"><div class="hbar-top"><span>${["🥇", "🥈", "🥉"][i] || "•"} ${esc(userName(id))}</span><b>${rub(m.salesSum)}</b></div><div class="bar-track"><i style="width:${(m.salesSum / max) * 100}%"></i></div><div class="sub">продаж ${m.sales} · проведено ${m.held}/${m.scheduled} · доходимость ${pct(m.crHeld)} · CR ${pct(m.crSale)} · чек ${m.avgCheck ? compact(m.avgCheck) : "—"}${state.settings.personPlans?.[id] && state.period === "month" ? ` · план ${Math.round((m.salesSum / state.settings.personPlans[id]) * 100)}%` : ""}</div></div>`).join("")}</div>`;
  }

  // Таблица РнП как в Google-таблице
  const cols = [["Общая", t], ...Object.entries(r.byPerson).map(([id, m]) => [userName(id), m])];
  const row = (label, f, cls = "") => `<tr class="${cls}"><td>${label}</td>${cols.map(([, m]) => `<td>${f(m)}</td>`).join("")}</tr>`;
  html += `<h2>Отчётность РнП</h2><div class="rnp"><table><tr><th></th>${cols.map(([n]) => `<th>${esc(n)}</th>`).join("")}</tr>
    ${row("Лидов в работе", (m) => m.leads)}${row("Назначено", (m) => m.scheduled)}${row("Проведено", (m) => m.held)}${row("CR назн. → пров.", (m) => pct(m.crHeld), "cr")}
    ${row("Продаж", (m) => m.sales)}${row("Сумма", (m) => compact(m.salesSum), "money")}${row("Предоплат", (m) => `${m.prepays}${m.prepaySum ? ` · ${compact(m.prepaySum)}` : ""}`)}${row("CR пров. → продажа", (m) => pct(m.crSale), "cr")}
    ${row("Средний чек", (m) => (m.avgCheck ? compact(m.avgCheck) : "—"))}${row("Отказы по банкам", (m) => `${m.bank}${m.bankSum ? ` · ${compact(m.bankSum)}` : ""}`)}${row("Потенциал", (m) => `${m.potential}${m.potentialSum ? ` · ${compact(m.potentialSum)}` : ""}`)}
  </table></div>`;

  // Доходимость по часам — когда лучше назначать
  const byHour = {};
  for (const c of state.clients) for (const call of c.calls || []) {
    if (!["held", "ndz"].includes(call.outcome)) continue;
    if (people && !people.has(call.mopId)) continue;
    const d = mskKey(Date.parse(call.at));
    if ((range.from && d < range.from) || (range.to && d > range.to)) continue;
    const hh = mskTime(Date.parse(call.at)).slice(0, 2);
    const x = (byHour[hh] ||= { held: 0, all: 0 });
    x.all++;
    if (call.outcome === "held") x.held++;
  }
  const hours = Object.keys(byHour).sort();
  if (hours.length >= 2) html += columns(hours.map((hh) => ({ label: `${hh}:00`, value: Math.round((byHour[hh].held / byHour[hh].all) * 100), tip: `${hh}:00 — дошли ${byHour[hh].held} из ${byHour[hh].all}` })), { title: "Доходимость по часам, %", fmt: (v) => `${Math.round(v)}%`, xEvery: 1 });

  // Срез базы по статусам
  const base = people ? state.clients.filter((c) => people.has(c.mopId)) : state.clients;
  const g = (grp) => base.filter((c) => statusGroup(c.status) === grp).length;
  html += shareBar([
    { label: "Новые", value: g("lead"), cls: "s-lead" },
    { label: "В работе", value: g("work"), cls: "s-work" },
    { label: "НДЗ", value: g("ndz"), cls: "s-ndz" },
    { label: "Думают", value: g("hot"), cls: "s-hot" },
    { label: "Оплатили", value: g("won"), cls: "s-won" },
    { label: "Отказы", value: g("lost"), cls: "s-lost" },
  ], { title: "База сейчас" });

  html += insights(t, r.byPerson, byHour);
  if (Object.keys(state.legacy.rnp || {}).length) html += `<div class="sub" style="margin:10px 4px">До ${fmtDay(state.legacy.importedAt || "")} цифры перенесены из таблицы «РнП», дальше считаются сами по карточкам.</div>`;
  $app.innerHTML = html;
}

// Продюсерские подсказки по цифрам: где течёт воронка.
function insights(t, byPerson, byHour = {}) {
  const out = [];
  if (t.scheduled >= 5 && t.crHeld !== null && t.crHeld < 0.7) out.push(`🚨 Доходимость ${pct(t.crHeld)} — каждый третий не доходит. Подтверждение за 2 часа и напоминание за 15 минут — без пропусков.`);
  if (t.held >= 5 && t.crSale !== null && t.crSale < 0.25) out.push(`📉 Диагностика → оплата ${pct(t.crSale)}. Слушать записи: где теряем — на боли или на презентации тарифов.`);
  if (t.bank && t.bankSum > t.salesSum * 0.3) out.push(`🏦 Отказы по банкам на ${rub(t.bankSum)} — ${Math.round((t.bankSum / Math.max(1, t.salesSum)) * 100)}% от продаж. Сначала 18,9% для 21+, не прошло — 31%, дальше Продамус.`);
  if (t.potentialSum > t.salesSum && t.potential >= 3) out.push(`🔥 В потенциале ${rub(t.potentialSum)} — больше, чем продано. Дожим: 3 касания, каждый день.`);
  const ppl = Object.entries(byPerson).filter(([, m]) => m.held >= 3);
  if (ppl.length > 1) {
    const best = ppl.reduce((a, b) => ((b[1].crSale || 0) > (a[1].crSale || 0) ? b : a));
    out.push(`🏆 Лучшая конверсия в оплату — ${esc(userName(best[0]))}, ${pct(best[1].crSale)}. Разбор этих созвонов = обучение остальным.`);
  }
  const hs = Object.entries(byHour).filter(([, x]) => x.all >= 3);
  if (hs.length >= 2) {
    const best = hs.reduce((a, b) => (b[1].held / b[1].all > a[1].held / a[1].all ? b : a));
    const worst = hs.reduce((a, b) => (b[1].held / b[1].all < a[1].held / a[1].all ? b : a));
    if (best[0] !== worst[0]) out.push(`🕐 Лучше всего доходят в ${best[0]}:00 (${Math.round((best[1].held / best[1].all) * 100)}%), хуже — в ${worst[0]}:00. Лидорубу — ставить на сильные часы.`);
  }
  return out.length ? `<h2>Где течёт</h2><div class="list">${out.map((x) => `<div class="row" style="min-height:0;cursor:default"><div class="grow" style="white-space:normal">${x}</div></div>`).join("")}</div>` : "";
}

// ---------- ЕЩЁ ----------
function renderMore() {
  if (state.more === "payroll" && money()) return renderPayroll();
  if (state.more === "team") return renderTeam();
  if (state.more === "settings" && money()) return renderSettings();
  if (state.more === "rules") return renderRules();
  if (state.more === "feed") return renderFeed();
  if (state.more === "links") return renderLinks();
  state.more = null;
  const item = (id, icon, title, sub) => `<div class="row" data-more="${id}"><div class="icon">${icon}</div><div class="grow"><div class="title">${title}</div><div class="sub">${sub}</div></div><div class="right sub">›</div></div>`;
  const pend = (state.payments || []).filter((p) => !p.verified).length;
  $app.innerHTML = `<div class="lead-card"><div class="lead-head">${avatar(state.me.name, state.me.id, 52)}<div class="grow"><h1>${esc(state.me.name)}</h1><div class="sub">${esc(ROLES[state.me.role])}</div></div></div></div>
    <div class="list">
      ${money() ? item("payroll", "💰", "Зарплатная ведомость", pend ? `ждут проверки: ${pend}` : "выручка, чистая, вознаграждения") : ""}
      ${item("feed", "🔔", "Лента событий", unreadFeed() ? `новых: ${unreadFeed()}` : "созвоны, продажи, НДЗ, комментарии")}
      ${item("links", "💳", "Ссылки на оплату", `${payLinks().length} шт · Т-Банк, Ресурс развития, Продамус`)}
      ${item("team", "🧑‍🤝‍🧑", "Команда", `${state.users.filter((u) => u.active !== false).length} в команде${state.pending.length ? ` · заявок ${state.pending.length}` : ""}`)}
      ${item("rules", "📘", "Регламент отдела продаж", "кто что делает и когда")}
      ${money() ? item("settings", "⚙️", "Настройки", "проценты, план, перенос из таблиц") : ""}
    </div>`;
}

function renderPayroll() {
  const pays = normPayments();
  const months = [...new Set([...pays.map((p) => p.date.slice(0, 7)), today().slice(0, 7)])].sort().reverse();
  if (!months.includes(state.payMonth)) state.payMonth = months[0];
  const s = monthSummary(pays, state.payMonth, state.settings.rates);
  const t = s.totals;
  const rates = state.settings.rates;
  const inMonth = pays.filter((p) => p.date.startsWith(state.payMonth)).sort((a, b) => b.date.localeCompare(a.date));
  const pending = pays.filter((p) => !p.verified).sort((a, b) => b.date.localeCompare(a.date));
  const lr = lidorubs()[0];
  const rop = state.users.find((u) => u.role === "rop" && u.active !== false);
  let html = `<div class="list-head"><h1 style="margin:0">Ведомость</h1><button class="btn small" data-pay-new>＋ Оплата</button></div>
    <div class="chips">${months.map((m) => `<button class="chip ${m === state.payMonth ? "active" : ""}" data-pmonth="${m}">${monthName(m)}</button>`).join("")}</div>
    <div class="hero"><div class="hero-label">Остаётся чистыми · ${monthName(state.payMonth)}</div><div class="hero-value">${rub(t.left)}</div><div class="hero-foot"><span>выручка ${rub(t.tariff)}</span><span>${t.count} ${plural(t.count, "оплата", "оплаты", "оплат")}</span></div></div>
    <div class="list">
      ${line("Выручка (тарифы)", t.tariff)}
      ${line(`Комиссия банков / рассрочек`, -t.commission, t.tariff ? `${Math.round((t.commission / t.tariff) * 100)}%` : "")}
      ${line("Чистая прибыль ОП", t.net, "", true)}
      ${line(`Налоги ${rates.tax}%`, -t.tax)}
      ${s.byMop.map((m) => line(`МОП ${esc(userName(m.mopId))} ${rates.mop}%`, -m.reward, `${m.count} шт · ${short(m.tariff)}`)).join("")}
      ${line(`РОП${rop ? ` ${esc(rop.name)}` : ""} ${rates.rop}%`, -t.rop)}
      ${line(`Лидоруб${lr ? ` ${esc(lr.name)}` : ""} ${rates.lidorub}%`, -t.lidorub)}
      <div class="row total"><div class="grow">Остаётся чистыми</div><div class="right">${rub(t.left)}</div></div>
    </div>
    ${s.pending.count ? `<div class="sub" style="margin:8px 4px">Не верифицировано в этом месяце: ${s.pending.count} на ${rub(s.pending.tariff)} — в итоги не входят.</div>` : ""}`;
  if (pending.length) html += section(`⚠️ Ждут проверки · ${pending.length}`, pending.map(payRow));
  html += section(`Оплаты · ${monthName(state.payMonth)}`, inMonth.map(payRow), { empty: "Оплат нет" });
  $app.innerHTML = html;
}
const line = (label, v, hint = "", bold = false) => `<div class="row" style="min-height:0;cursor:default"><div class="grow">${bold ? `<b>${label}</b>` : label}${hint ? ` <span class="sub" style="display:inline">${hint}</span>` : ""}</div><div class="right ${v < 0 ? "" : "money-green"}">${v < 0 ? "−" : ""}${rub(Math.abs(v))}</div></div>`;
function payRow(p) {
  const c = p.net !== null && p.net !== undefined ? payrollRow(p, state.settings.rates) : null;
  return `<div class="row" data-pay="${p.id}"><div class="icon">${p.verified ? "✅" : "⏳"}</div><div class="grow"><div class="title">${rub(p.tariff)}${p.clientName ? ` · ${esc(p.clientName)}` : ""}</div><div class="sub">${fmtDay(p.date)} · ${esc(userName(p.mopId))}${c ? ` · чистая ${short(c.net)} · комиссия ${c.commissionPct}%` : " · нет чистой суммы"}</div></div><div class="right">${c ? `<span class="sub">МОП</span><br><b>${rub(c.mop)}</b>` : ""}</div></div>`;
}

function openPayment(p) {
  const isNew = !p;
  p = p || { date: today(), tariff: "", net: null, mopId: closers()[0]?.id || null, clientName: "", verified: false, note: "" };
  const presets = [["Без комиссии", 0], ["Рассрочка 31%", 31], ["Рассрочка 27%", 27], ["Карта 3%", 3]];
  openSheet(
    `<div class="sheet-title">${isNew ? "Новая оплата" : "Оплата"}</div>
    <div class="card">
      <div class="two"><label class="field"><span>Дата оплаты</span><input type="date" id="p-date" value="${p.date}"></label><label class="field"><span>МОП</span><select id="p-mop">${closers().map((u) => `<option value="${u.id}" ${u.id === p.mopId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}${p.mopId && !userById(p.mopId) ? `<option value="" selected>${esc(userName(p.mopId))}</option>` : ""}</select></label></div>
      <label class="field"><span>Клиент</span><input id="p-client" value="${esc(p.clientName || "")}"></label>
      <div class="two"><label class="field"><span>Сумма тарифа</span><input id="p-tariff" inputmode="numeric" value="${p.tariff || ""}"></label><label class="field"><span>Чистая (пришло на счёт)</span><input id="p-net" inputmode="numeric" value="${p.net ?? ""}"></label></div>
      <div class="chips tight" id="p-presets">${presets.map(([l, v]) => `<button class="chip" data-c="${v}">${l}</button>`).join("")}</div>
      <div id="p-calc" class="sub" style="margin:10px 4px 0"></div>
      <label class="field" style="margin-top:10px"><span>Заметка</span><input id="p-note" value="${esc(p.note || "")}"></label>
      <div class="yn" style="margin-top:6px"><button class="chip ${p.verified ? "active" : ""}" id="p-ver">✅ Оплата верифицирована</button></div>
    </div>
    <button class="btn block" id="p-save">Сохранить</button>
    ${isNew ? "" : `<button class="btn danger" id="p-del">Удалить оплату</button>`}`,
    (sh) => {
      let verified = !!p.verified;
      const $t = sh.querySelector("#p-tariff"), $n = sh.querySelector("#p-net"), $calc = sh.querySelector("#p-calc");
      const calc = () => {
        const tariff = Number($t.value) || 0, net = $n.value === "" ? null : Number($n.value);
        if (net === null) return ($calc.textContent = "Внеси чистую — посчитаю налог и вознаграждения");
        const c = payrollRow({ tariff, net }, state.settings.rates);
        $calc.innerHTML = `Комиссия ${rub(c.commission)} (${c.commissionPct}%) · налог ${rub(c.tax)}<br>МОП ${rub(c.mop)} · РОП ${rub(c.rop)} · лидоруб ${rub(c.lidorub)}`;
      };
      $t.oninput = $n.oninput = calc;
      calc();
      sh.querySelector("#p-presets").onclick = (e) => {
        const b = e.target.closest("[data-c]");
        if (!b) return;
        $n.value = Math.round((Number($t.value) || 0) * (1 - Number(b.dataset.c) / 100));
        calc();
      };
      sh.querySelector("#p-ver").onclick = (e) => {
        verified = !verified;
        e.target.classList.toggle("active", verified);
      };
      sh.querySelector("#p-save").onclick = async () => {
        const body = { date: sh.querySelector("#p-date").value, mopId: sh.querySelector("#p-mop").value || p.mopId, clientName: sh.querySelector("#p-client").value, tariff: $t.value, net: $n.value === "" ? null : $n.value, note: sh.querySelector("#p-note").value };
        if (!body.mopId) delete body.mopId;
        if (verified && body.net === null) return alertDialog("Без чистой суммы верифицировать нельзя");
        try {
          const res = isNew ? await api("POST", "/payments", { ...body, verified }) : await api("PATCH", `/payments/${p.id}`, { ...body, verified });
          const i = state.payments.findIndex((x) => x.id === res.payment.id);
          if (i >= 0) state.payments[i] = res.payment;
          else state.payments.push(res.payment);
          closeSheet();
          toast("Сохранено");
          render();
        } catch (e) {
          alertDialog(e.message);
        }
      };
      sh.querySelector("#p-del")?.addEventListener("click", async () => {
        if (!(await confirmDialog("Удалить оплату из ведомости?"))) return;
        await api("DELETE", `/payments/${p.id}`);
        state.payments = state.payments.filter((x) => x.id !== p.id);
        closeSheet();
        render();
      });
    },
  );
}

function renderTeam() {
  const active = state.users.filter((u) => u.active !== false);
  const canManage = isBoss();
  let html = `<h1>Команда</h1><div class="sub" style="margin:0 4px 10px">Доступ ко всему, кроме зарплатной ведомости. Ведомость видят только собственник и РОП.</div>`;
  html += section("В команде", active.map((u) => `<div class="row" ${canManage ? `data-user="${u.id}"` : ""}>${avatar(u.name, u.id)}<div class="grow"><div class="title">${esc(u.name)}${u.username ? ` <span class="sub" style="display:inline">@${esc(u.username)}</span>` : ""}</div><div class="sub">${esc(ROLES[u.role])}${u.botStarted ? "" : " · ⚠️ не запустил бота — напоминания не дойдут"}</div></div></div>`));
  if (canManage) {
    html += section(`Заявки на доступ · ${state.pending.length}`, state.pending.map((p) => `<div class="row" data-user="${p.id}" data-pending="1">${avatar(p.name, p.id)}<div class="grow"><div class="title">${esc(p.name)}</div><div class="sub">${p.username ? `@${esc(p.username)} · ` : ""}ID ${esc(p.id)}</div></div><div class="right"><span class="chip">Выдать роль</span></div></div>`), { empty: "Пусть человек откроет бота — заявка появится здесь." });
    html += `<button class="btn block ghost" data-user-new>＋ Добавить по Telegram ID</button>`;
  }
  $app.innerHTML = html;
}

function openUser(id, isPending) {
  const u = (isPending ? state.pending : state.users).find((x) => x.id === id) || { id: "", name: "" };
  const allowed = state.me.role === "owner" ? Object.keys(ROLES) : ["mop", "lidorub"];
  let role = u.role && allowed.includes(u.role) ? u.role : allowed.includes("mop") ? "mop" : allowed[0];
  openSheet(
    `<div class="sheet-title">${esc(u.name || "Новый человек")}</div><div class="card">
      ${u.id ? "" : `<label class="field"><span>Telegram ID</span><input id="u-id" inputmode="numeric"></label>`}
      <label class="field"><span>Имя в приложении</span><input id="u-name" value="${esc(u.name || "")}"></label>
      <div class="sheet-label">Роль</div><div class="chips tight" id="u-role">${allowed.map((r) => `<button class="chip ${r === role ? "active" : ""}" data-r="${r}">${ROLES[r]}</button>`).join("")}</div>
    </div>
    <button class="btn block" id="u-save">Сохранить</button>
    ${u.role && state.me.role === "owner" && u.id !== state.me.id ? `<button class="btn danger" id="u-off">Закрыть доступ</button>` : ""}`,
    (sh) => {
      sh.querySelector("#u-role").onclick = (e) => {
        const b = e.target.closest("[data-r]");
        if (!b) return;
        role = b.dataset.r;
        for (const x of sh.querySelectorAll("#u-role .chip")) x.classList.toggle("active", x === b);
      };
      sh.querySelector("#u-save").onclick = async () => {
        try {
          await api("POST", "/users", { id: u.id || sh.querySelector("#u-id").value.trim(), role, name: sh.querySelector("#u-name").value });
          closeSheet();
          await load();
          toast("Готово");
        } catch (e) {
          alertDialog(e.message);
        }
      };
      sh.querySelector("#u-off")?.addEventListener("click", async () => {
        if (!(await confirmDialog(`Закрыть доступ ${u.name}?`))) return;
        await api("DELETE", `/users/${u.id}`);
        closeSheet();
        await load();
      });
    },
  );
}

const FEED_ICONS = { call: "📅", ndz: "❌", paid: "💰", prepaid: "💵", refuse_bank: "🏦", comment: "💬" };
function renderFeed() {
  const seen = feedSeen();
  const items = state.feed;
  $app.innerHTML = `<h1>Лента</h1><div class="sub" style="margin:0 4px 10px">${isBoss() ? "Всё, что происходит в команде" : "То, что касается тебя"} — то же самое приходит в бот.</div>
    ${items.length ? `<div class="list">${items.map((f) => `<div class="row feed-row ${f.id > seen && f.by !== state.me.id ? "unread" : ""}" ${f.clientId && clientById(f.clientId) ? `data-open="${f.clientId}"` : ""}><div class="icon">${FEED_ICONS[f.type] || "•"}</div><div class="grow">${esc(f.text)}</div><div class="right sub">${fmtWhen(Date.parse(f.at))}</div></div>`).join("")}</div>` : `<div class="card empty">Пока тихо. Здесь будут записи на созвоны, продажи, НДЗ и комментарии.</div>`}`;
  try {
    if (items[0]) localStorage.setItem(FEED_SEEN_KEY, items[0].id);
  } catch {}
}

function renderLinks() {
  $app.innerHTML = `<div class="list-head"><h1 style="margin:0">Ссылки на оплату</h1>${isBoss() ? `<button class="btn small" data-link-new>＋ Ссылка</button>` : ""}</div>
    <div class="sub" style="margin:0 4px 6px">«Отправить» — выбрать чат в Telegram. Из карточки клиента ссылка ещё и отметится — при оплате чистая сама встанет в ведомость.</div>
    ${linksList(null)}
    ${isBoss() ? `<div class="sub" style="margin:12px 4px">Чтобы поправить ссылку, тапни по её названию.</div>` : ""}`;
}

function openLinkEdit(l) {
  const isNew = !l;
  l = l || { provider: "Т-Банк", label: "", amount: "", commission: "", url: "", note: "" };
  openSheet(`<div class="sheet-title">${isNew ? "Новая ссылка" : "Ссылка"}</div><div class="card">
    <div class="two"><label class="field"><span>Где</span><input id="l-prov" value="${esc(l.provider)}"></label><label class="field"><span>Сумма</span><input id="l-amount" inputmode="numeric" value="${l.amount || ""}"></label></div>
    <label class="field"><span>Название</span><input id="l-label" value="${esc(l.label)}" placeholder="100к · Т-Банк · 31%"></label>
    <div class="two"><label class="field"><span>Комиссия, %</span><input id="l-com" inputmode="decimal" value="${l.commission ?? ""}" placeholder="не знаем — пусто"></label><span></span></div>
    <label class="field"><span>Ссылка</span><input id="l-url" value="${esc(l.url)}" placeholder="https://"></label>
    <label class="field"><span>Заметка</span><input id="l-note" value="${esc(l.note || "")}" placeholder="для 21+, если не одобрили — 31%"></label></div>
    <button class="btn block" id="l-save">Сохранить</button>${isNew ? "" : `<button class="btn danger" id="l-del">Удалить ссылку</button>`}`, (sh) => {
    const save = async (list) => {
      try {
        const res = await api("PUT", "/settings", { payLinks: list });
        state.settings = res.settings;
        closeSheet();
        render();
        toast("Сохранено");
      } catch (e) {
        alertDialog(e.message);
      }
    };
    sh.querySelector("#l-save").onclick = () => {
      const v = (id) => sh.querySelector(id).value;
      const item = { id: l.id, provider: v("#l-prov"), label: v("#l-label"), amount: v("#l-amount"), commission: v("#l-com") === "" ? null : v("#l-com"), url: v("#l-url").trim(), note: v("#l-note") };
      if (!/^https:\/\//.test(item.url)) return alertDialog("Ссылка должна начинаться с https://");
      save(isNew ? [...payLinks(), item] : payLinks().map((x) => (x.id === l.id ? item : x)));
    };
    sh.querySelector("#l-del")?.addEventListener("click", async () => {
      if (await confirmDialog("Удалить ссылку?")) save(payLinks().filter((x) => x.id !== l.id));
    });
  });
}

function renderSettings() {
  const s = state.settings;
  const legacyNames = [...new Set([...Object.keys(state.legacy.rnp || {}), ...Object.keys(state.legacy.lidorub || {}), ...(state.payments || []).map((p) => p.mopAlias).filter(Boolean)])];
  const people = state.users.filter((u) => u.active !== false);
  $app.innerHTML = `<h1>Настройки</h1>
    <h2>Ведомость, %</h2><div class="card"><div class="two">
      <label class="field"><span>Налог</span><input data-rate="tax" inputmode="decimal" value="${s.rates.tax}"></label>
      <label class="field"><span>МОП</span><input data-rate="mop" inputmode="decimal" value="${s.rates.mop}"></label>
      <label class="field"><span>РОП</span><input data-rate="rop" inputmode="decimal" value="${s.rates.rop}"></label>
      <label class="field"><span>Лидоруб</span><input data-rate="lidorub" inputmode="decimal" value="${s.rates.lidorub}"></label></div>
      <div class="sub">МОП/РОП/лидоруб — от (чистая − налог), как в таблице.</div></div>
    <h2>План на месяц</h2><div class="card">
      <label class="field"><span>Отдел продаж, ₽</span><input id="plan" inputmode="numeric" value="${s.monthPlan || ""}" placeholder="например 2000000"></label>
      ${closers().map((u) => `<label class="field"><span>${esc(u.name)}, ₽ продаж</span><input data-pplan="${u.id}" inputmode="numeric" value="${s.personPlans?.[u.id] || ""}"></label>`).join("")}
      ${lidorubs().map((u) => `<label class="field"><span>${esc(u.name)}, записей на созвон</span><input data-pplan="${u.id}" inputmode="numeric" value="${s.personPlans?.[u.id] || ""}"></label>`).join("")}
      <div class="sub">У каждого на «Сегодня» — полоса плана, где должен быть к этому дню, прогноз и сколько нужно в день.</div></div>
    ${legacyNames.length ? `<h2>Люди из старых таблиц</h2><div class="card">${legacyNames.map((n) => `<label class="field"><span>«${esc(n)}» в таблицах — это</span><select data-alias="${esc(n)}"><option value="">— не связан —</option>${people.map((u) => `<option value="${u.id}" ${s.aliases?.[n] === u.id ? "selected" : ""}>${esc(u.name)} · ${ROLES[u.role]}</option>`).join("")}</select></label>`).join("")}<div class="sub">Свяжи — и история из РнП и ведомости ляжет на человека.</div></div>` : ""}
    <button class="btn block" id="set-save">Сохранить</button>
    ${state.me.role === "owner" ? `<h2>Перенос из Google-таблиц</h2><div class="card"><div class="sub">РнП с 29.07, лидоруб Алексей, зарплатная ведомость август–октябрь. Файл history.json — в личке от Claude, в репозиторий не кладём: там деньги. Повторный импорт ничего не дублирует.</div><label class="btn block ghost" style="text-align:center">Выбрать файл history.json<input type="file" id="import" accept=".json,application/json" hidden></label></div>` : ""}`;
  document.getElementById("set-save").onclick = async () => {
    const rates = {};
    for (const el of $app.querySelectorAll("[data-rate]")) rates[el.dataset.rate] = Number(String(el.value).replace(",", "."));
    const aliases = {};
    for (const el of $app.querySelectorAll("[data-alias]")) if (el.value) aliases[el.dataset.alias] = el.value;
    try {
      const personPlans = {};
      for (const el of $app.querySelectorAll("[data-pplan]")) if (el.value) personPlans[el.dataset.pplan] = el.value;
      const res = await api("PUT", "/settings", { rates, monthPlan: document.getElementById("plan").value, personPlans, aliases });
      state.settings = res.settings;
      toast("Сохранено");
    } catch (e) {
      alertDialog(e.message);
    }
  };
  document.getElementById("import")?.addEventListener("change", async (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;
      const res = await api("POST", "/import", JSON.parse(await file.text()));
      toast(`Перенесено: оплат ${res.payments}, РнП ✓`);
      await load();
    } catch (e) {
      alertDialog(e.message);
    }
  });
}

function renderRules() {
  $app.innerHTML = `<h1>Регламент ОП</h1><div class="card reg">
    <h3>🪓 Лидоруб</h3><p>Первичный контакт → квалификация → подбор времени → карточка в приложении + Telegram-чат (клиент + диагност + зеркало эксперта) → запись на созвон. В приложении: «＋ Лид», «ЛМ отправлен», «На созвон».</p>
    <h3>📞 Диагност (МОП)</h3><p>Сразу приветствует клиента в чате. Подтверждает встречу за 2 часа, напоминает за 15 минут — бот пингует на каждом шаге. Нет ответа — звонит по телефону, ждёт 15 минут, затем НДЗ. Все созвоны записываются и идут строго по скрипту.</p><p>После каждого созвона — отчёт и статус в CRM. Бот спросит «пришёл или НДЗ» и напомнит про отчёт через 30 минут.</p>
    <h3>📝 Отчёт после диагностики</h3><p>Потребность · род деятельности · главная боль · презентация тарифов да/нет · основное возражение · следующий шаг · предложил оплатить да/нет · итоговый статус.</p>
    <h3>🔁 Дожим</h3><p>Не отказался, но пропал — касание 3 дня подряд. После третьего без ответа — «Игнор» (приложение ставит само). Отказ по банкам — передача рекрутеру. Окончательный отказ — остаётся в базе для будущих офферов.</p>
    <h3>💰 Деньги</h3><p>«Оплатил» → оплата сама падает в ведомость. Андрей вносит чистую сумму после комиссии и ставит «верифицировано». Налог 7%, МОП 10%, РОП 3%, лидоруб 2% — от чистой после налога.</p>
  </div>`;
}

// ---------- клики ----------
$app.addEventListener("click", async (e) => {
  const lt = e.target.closest(".link-row .title");
  if (lt && isBoss() && state.more === "links") return openLinkEdit(linkById(lt.closest(".link-row").querySelector("[data-copy]").dataset.copy));
  const t = e.target.closest("button, [data-open], [data-more], [data-pay], [data-user], [data-person], [data-sperson]");
  if (!t) return;
  const d = t.dataset;
  if (d.link) {
    e.stopPropagation();
    return openLink(d.link);
  }
  if (d.held || d.ndz) {
    e.stopPropagation();
    const id = d.held || d.ndz;
    const c = await act(id, { type: d.held ? "held" : "ndz", callId: d.call }, d.held ? "Созвон проведён" : "НДЗ");
    if (c && d.held) openReport(c);
    return;
  }
  if (d.touch || d.touchOk) {
    e.stopPropagation();
    return act(d.touch || d.touchOk, { type: "touch", answered: !!d.touchOk }, d.touchOk ? "Ответил — дожим сброшен" : "Касание записано");
  }
  if (d.lm) {
    e.stopPropagation();
    return act(d.lm, { type: "lm" }, "ЛМ отправлен");
  }
  if (d.invalid) {
    e.stopPropagation();
    return act(d.invalid, { type: "status", status: "invalid" }, "Невалид");
  }
  if (d.book) {
    e.stopPropagation();
    return openBooking(clientById(d.book));
  }
  if (d.reportOpen) return openReport(clientById(d.reportOpen));
  if (d.paylinks) return openPayLinks(clientById(d.paylinks));
  if (d.copy || d.share) {
    const l = linkById(d.copy || d.share);
    if (d.share) {
      const url = `https://t.me/share/url?url=${encodeURIComponent(l.url)}&text=${encodeURIComponent(`Ссылка на оплату обучения (${l.amount.toLocaleString("ru-RU")} ₽): ${l.url}`)}`;
      return tg?.openTelegramLink ? tg.openTelegramLink(url) : window.open(url, "_blank");
    }
    return toast((await copyText(l.url)) ? "Ссылка скопирована" : l.url);
  }
  if (d.feed !== undefined) {
    state.tab = "more";
    state.more = "feed";
    render();
    return window.scrollTo(0, 0);
  }
  if (d.linkNew !== undefined) return openLinkEdit(null);
  if (d.new !== undefined) return openNewClient();
  if (d.open) {
    state.clientId = d.open;
    if (state.tab !== "clients" && state.tab !== "today" && state.tab !== "calendar") state.tab = "clients";
    render();
    window.scrollTo(0, 0);
    if (d.report) openReport(clientById(d.open));
    return;
  }
  if (d.status) return openStatus(clientById(state.clientId), d.status);
  if (d.comment) {
    const input = document.getElementById("comment");
    if (!input.value.trim()) return;
    return act(d.comment, { type: "comment", text: input.value });
  }
  if (d.delete) {
    if (!(await confirmDialog("Удалить клиента насовсем?"))) return;
    await api("DELETE", `/clients/${d.delete}`);
    state.clients = state.clients.filter((c) => c.id !== d.delete);
    state.clientId = null;
    return render();
  }
  if (d.filter) return (state.filter = d.filter), render();
  if (d.pfilter) return (state.person = d.pfilter), render();
  if (d.person) return (state.tab = "clients"), (state.person = d.person), (state.filter = "active"), render();
  if (d.cal) return (state.calDay = d.cal), render();
  if (d.period) return (state.period = d.period), render();
  if (d.sview) return (state.statsView = d.sview), (state.statsPerson = "all"), render();
  if (d.sperson) return (state.statsPerson = d.sperson), render();
  if (d.more) {
    state.tab = "more";
    state.more = d.more;
    render();
    return window.scrollTo(0, 0);
  }
  if (d.pmonth) return (state.payMonth = d.pmonth), render();
  if (d.payNew !== undefined) return openPayment(null);
  if (d.pay) return openPayment(normPayments().find((p) => p.id === d.pay));
  if (d.userNew !== undefined) return openUser("", false);
  if (d.user) return openUser(d.user, !!d.pending);
});

bindCharts($app);

// Тихо подтягивать свежие данные, пока приложение открыто.
setInterval(() => {
  if (document.visibilityState === "visible" && !document.querySelector(".sheet-wrap") && !document.activeElement?.matches("input,textarea,select")) load();
}, 60_000);

load();
