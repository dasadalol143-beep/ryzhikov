import { leadMoney, sumMoney, ACTIVE_STAGES } from "./economics.js";
import { STAGE_LABELS, STATUS_LABELS, STATUS_SHORT, CATEGORY_LABELS, TAG_LABELS, DIR_LABELS, EXPENSE_KIND_LABELS, statusKey, statusLabel, statusOrder, nextStatusFor, statusPatch } from "./labels.js";
import { worklist, paidEvents, todayKey, addDays, daysSince, netOf, networkReport, networkOf, directionStats, sourceStats } from "./insights.js";

const tg = window.Telegram?.WebApp;
try {
  tg?.ready();
  tg?.expand();
} catch {}

const AUTH_ERRORS = {
  no_bot_token: "На сервере не задан токен бота (BOT_TOKEN в Cloudflare).",
  bad_signature: "Токен бота на сервере не совпадает с ботом. Проверь BOT_TOKEN в Cloudflare.",
  no_init_data: "Telegram не передал данные входа. Открой CRM кнопкой «CRM» внизу чата с ботом. Если открываешь с компьютера — обнови Telegram Desktop до последней версии.",
  expired: "Сессия устарела — закрой и открой приложение заново.",
};
const ROLE_LABELS = { admin: "Админ", manager: "Менеджер" };
// Порядок офферов в карточке: сначала то, что требует действий.
const STATUS_ORDER = ["opened", "applied", "done", "paid", "rejected", "exists", "none"];

const state = {
  me: null,
  offers: [],
  settings: { taxRate: 7, partnerShare: 20, partnerName: "Партнёр" },
  leads: [],
  payouts: [],
  network: null, // открытая сеть на экране выплат
  picked: new Set(), // выбранные неоплаченные офферы «leadId|offerId»
  tab: "today",
  leadId: null,
  more: null, // offers | settings | team | data
  filter: "all", // можно несколько через запятую: "in_work,lost"
  tags: [], // фильтр по тегам ИП/МФО/РКО/ДК/КК
  ledger: null, // сколько фактически выплачено по строкам отчёта
  sort: "recent",
  query: "",
  offerFilter: null, // { id, cond: none|work|paid|dead }
  period: "30",
};

const $app = document.getElementById("app");
const $tabs = document.getElementById("tabs");

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rub = (n) => `${Math.round(n || 0).toLocaleString("ru-RU")} ₽`;
const short = (n) => (Math.abs(n) >= 1000 ? `${Math.round(n / 100) / 10}к` : String(Math.round(n)));
// Любой вызов Telegram API может бросить исключение на старых/десктопных клиентах — глушим.
const safe = (fn) => {
  try {
    fn();
  } catch {}
};
const haptic = (type = "light") => safe(() => tg?.HapticFeedback?.impactOccurred(type));
const money = (lead) => leadMoney(lead, state.offers, state.settings);
const leadTitle = (l) => l.telegram || l.fio || "Без имени";
const isAdmin = () => state.me?.role === "admin";
const offerById = (id) => state.offers.find((o) => o.id === id);
const fmtDate = (key) => (key ? `${key.slice(8, 10)}.${key.slice(5, 7)}` : "");
const localKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
};

function toast(text) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 2000);
}
// Свои окна вместо alert/confirm/prompt: системные окна во встроенном браузере Telegram
// на части устройств не открываются и намертво подвешивают страницу.
function dialog({ text, input = null, ok = "OK", cancel = null }) {
  return new Promise((resolve) => {
    document.querySelector(".dialog-wrap")?.remove();
    const wrap = document.createElement("div");
    wrap.className = "dialog-wrap";
    wrap.innerHTML = `<div class="dialog">
      <div class="dialog-text">${esc(text)}</div>
      ${input ? `<input class="dialog-input" type="${input.type || "text"}" inputmode="${input.type === "number" ? "decimal" : "text"}" placeholder="${esc(input.placeholder || "")}" value="${esc(input.value || "")}">` : ""}
      <div class="dialog-btns">${cancel ? `<button class="btn ghost" data-r="0">${esc(cancel)}</button>` : ""}<button class="btn" data-r="1">${esc(ok)}</button></div>
    </div>`;
    document.body.append(wrap);
    const field = wrap.querySelector(".dialog-input");
    field?.focus();
    const done = (yes) => {
      wrap.remove();
      resolve(input ? (yes ? field.value : null) : yes);
    };
    wrap.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => done(b.dataset.r === "1")));
    field?.addEventListener("keydown", (e) => e.key === "Enter" && done(true));
  });
}
const alertDialog = (text) => dialog({ text });
const confirmDialog = (text) => dialog({ text, ok: "Да", cancel: "Отмена" });
const askAmount = async (text) => {
  const v = await dialog({ text, input: { type: "number", placeholder: "Сумма, ₽" }, ok: "Готово", cancel: "Отмена" });
  const n = Number(String(v ?? "").replace(",", ".").replace(/\s/g, ""));
  return n > 0 ? n : 0;
};

// Подпись Telegram: из SDK, а если он не загрузился — прямо из адреса, который передаёт Telegram.
function initData() {
  if (tg?.initData) return tg.initData;
  try {
    const fromHash = new URLSearchParams(location.hash.slice(1)).get("tgWebAppData");
    if (fromHash) {
      sessionStorage.setItem("tgWebAppData", fromHash);
      return fromHash;
    }
    return sessionStorage.getItem("tgWebAppData") || "";
  } catch {
    return "";
  }
}

// Запрос к серверу с таймаутом: без него при плохой связи кнопка «висит» вечно.
// CRM учеников живёт на /academy/ — своя база и свой бот, тот же интерфейс.
const ACADEMY = location.pathname.startsWith("/academy");
const API_BASE = ACADEMY ? "/academy/api" : "/api";
if (ACADEMY) document.title = "Ryzhikov Academy CRM";

async function api(method, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `tma ${initData()}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw Object.assign(new Error(e.name === "AbortError" ? "сервер не ответил за 20 секунд — проверь интернет" : "нет связи с сервером"), { status: 0, data: {} });
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.me) {
    // Сессия Telegram живёт сутки: если CRM висела открытой дольше — просим переоткрыть.
    alertDialog("Сессия устарела. Закрой CRM и открой заново кнопкой в боте — изменения сохранятся после этого.");
  }
  if (!res.ok) throw Object.assign(new Error(data.detail || data.error || res.statusText), { status: res.status, data });
  return data;
}

function openTelegram(nick) {
  const url = `https://t.me/${nick.replace(/^@/, "")}`;
  try {
    if (tg?.openTelegramLink) return tg.openTelegramLink(url);
  } catch {}
  window.open(url, "_blank");
}

// ---------- bottom sheet ----------
function openSheet(html, onMount, { instant = false } = {}) {
  const prevScroll = instant ? document.querySelector(".sheet")?.scrollTop || 0 : 0;
  closeSheet();
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap" + (instant ? " open instant" : "");
  wrap.innerHTML = `<div class="sheet-backdrop"></div><div class="sheet"><div class="sheet-grip"></div><button class="sheet-close" aria-label="Закрыть">✕</button>${html}</div>`;
  wrap.querySelector(".sheet-backdrop").onclick = closeSheet;
  wrap.querySelector(".sheet-close").onclick = closeSheet;
  document.body.append(wrap);
  if (!instant) requestAnimationFrame(() => wrap.classList.add("open"));
  const sheet = wrap.querySelector(".sheet");
  sheet.scrollTop = prevScroll;
  onMount?.(sheet);
}
// Перед закрытием снимаем фокус: iOS иначе теряет недописанное поле (change не успевает сработать).
function blurInput() {
  if (document.activeElement?.matches?.("input, textarea, select")) document.activeElement.blur();
}
function closeSheet() {
  blurInput();
  document.querySelector(".sheet-wrap")?.remove();
}

// ---------- shared pieces ----------
const statusPill = (key, category) => `<span class="pill st-${key}">${statusLabel(key, category, true)}</span>`;
const stageBadge = (stage) => `<span class="badge s-${stage}">${STAGE_LABELS[stage] || stage}</span>`;

// Аватар: инициалы на градиенте, цвет стабилен для лида.
const AVATAR_COLORS = [["#ff8a65", "#e8505b"], ["#4fc3f7", "#2481cc"], ["#81c784", "#2e9e5b"], ["#ba68c8", "#7a4fd0"], ["#ffb74d", "#d97f00"], ["#4db6ac", "#00897b"], ["#f06292", "#c2185b"], ["#7986cb", "#3949ab"]];
function avatar(lead, size = 40) {
  const name = (lead.fio || lead.telegram || "?").replace(/^@/, "");
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
  let h = 0;
  for (const ch of lead.id || name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = AVATAR_COLORS[h % AVATAR_COLORS.length];
  return `<div class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;background:linear-gradient(135deg,${a},${b})">${esc(initials)}</div>`;
}

function leadRow(lead, sub, right, actions = "") {
  return `<div class="row" data-open="${lead.id}" role="button" tabindex="0">
    ${avatar(lead)}
    <div class="grow">
      <div class="title">${esc(leadTitle(lead))}</div>
      <div class="sub">${sub}</div>
      ${actions ? `<div class="quick">${actions}</div>` : ""}
    </div>
    <div class="right">${right}</div>
  </div>`;
}

// Быстрые кнопки «следующий шаг» прямо в списке: ЦД сделали, засчитали, счёт открыли.
const shortName = (n) => n.replace(/ — РКО$/, "").replace(/ — Регбиз$/, "").replace(/ Банк$/, "");
const quickButtons = (lead, items, status, max = 3) =>
  items
    .slice(0, max)
    .map((i) => {
      const cat = offerById(i.id)?.category;
      const next = nextStatusFor(status, cat);
      return `<button class="qbtn st-${next}" data-quick="${lead.id}|${i.id}|${next}">${esc(shortName(i.name))} · ${statusLabel(next, cat, true)} ✓</button>`;
    })
    .join("") + (items.length > max ? `<span class="qmore">+ ещё ${items.length - max}</span>` : "");

function reportRows(m) {
  const s = state.settings;
  const rows = [
    ["Доход (засчитано)", m.income],
    ["Затраты", -m.costs],
    [`${s.partnerName} ${s.partnerShare}%`, -m.partner],
    [`Налог ${s.taxRate}%`, -m.tax],
    ["Выплачено лидам", -m.payout],
  ];
  return `<div class="list">
    ${rows.map(([k, v]) => `<div class="row"><div class="grow">${esc(k)}</div><div class="right">${v < 0 ? "−" : ""}${rub(Math.abs(v))}</div></div>`).join("")}
    <div class="row total"><div class="grow">Чистая выручка</div><div class="right">${rub(m.net)}</div></div>
  </div>`;
}

// Факт: сколько реально получено от сетей и выплачено Дамиру, в налог, лидам, на затраты.
function ledgerRows(m) {
  const s = state.settings;
  return [
    ["income", "Доход", m.income, "получено от сетей", "сети ещё должны"],
    ["costs", "Затраты", m.costs, "оплачено", "осталось оплатить"],
    ["partner", `${s.partnerName} ${s.partnerShare}%`, m.partner, "выплачено", "осталось выплатить"],
    ["tax", `Налог ${s.taxRate}%`, m.tax, "уплачено", "осталось уплатить"],
    ["payout", "Лидам", m.payout, "выплачено", "осталось выплатить"],
  ];
}

function ledgerBlock(m) {
  const L = state.ledger;
  const onHands = L.income - L.costs - L.partner - L.tax - L.payout;
  return `<div class="list-head"><h2 style="margin:0">Факт · что уже выплачено</h2><button class="link" id="ledgerEdit">✏️ Заполнить</button></div>
    <div class="list">
      ${ledgerRows(m)
        .map(([k, label, calc, done, left]) => {
          const rest = Math.round(calc - L[k]);
          return `<div class="row"><div class="grow"><div class="title">${esc(label)}</div><div class="sub">по отчёту ${rub(calc)} · ${done} ${rub(L[k])}</div></div><div class="right ${rest > 0 ? "money-orange" : rest < 0 ? "danger" : "money-green"}">${rest > 0 ? `${left}<br><b>${rub(rest)}</b>` : rest < 0 ? `переплата<br><b>${rub(-rest)}</b>` : "✓ закрыто"}</div></div>`;
        })
        .join("")}
      <div class="row total"><div class="grow">Реально на руках<div class="sub">получено − всё выплаченное</div></div><div class="right">${rub(onHands)}</div></div>
    </div>
    <div class="sub note">${L.updatedAt ? `Обновил ${esc(L.by)} ${fmtDate(L.updatedAt.slice(0, 10))}` : "Пока не заполнено — жми «Заполнить» и впиши, сколько уже реально прошло денег."}</div>`;
}

function ledgerSheet(m) {
  const L = state.ledger;
  const received = networkReport(state.leads, state.offers, state.payouts).reduce((t, n) => t + n.received, 0);
  openSheet(
    `<h2 class="sheet-title">Сколько уже выплачено</h2>
    <div class="explain">Впиши суммы нарастающим итогом за всё время — сколько денег реально прошло. Приложение покажет, сколько ещё осталось по каждой строке отчёта.</div>
    ${ledgerRows(m)
      .map(([k, label, calc, done]) => `<label class="field"><span>${esc(label)} — ${done} (по отчёту ${rub(calc)})</span><input data-l="${k}" type="number" inputmode="decimal" min="0" value="${L[k] || ""}" placeholder="0"></label>
        ${k === "income" && received ? `<button class="chip" id="useReceived" style="margin:-4px 0 10px">Подставить из сверки с сетями: ${rub(received)}</button>` : ""}`)
      .join("")}
    <button class="btn block" id="lSave">Сохранить</button>
    ${L.history?.length ? `<h2>История правок</h2><div class="list history">${L.history.slice(0, 10).map((x) => `<div class="row"><div class="grow"><div class="sub">${esc(x.text)}</div></div><div class="right sub">${esc(x.by)}<br>${fmtDate(x.at.slice(0, 10))}</div></div>`).join("")}</div>` : ""}`,
    (el) => {
      el.querySelector("#useReceived")?.addEventListener("click", () => (el.querySelector('[data-l="income"]').value = received));
      el.querySelector("#lSave").onclick = async () => {
        const body = Object.fromEntries([...el.querySelectorAll("[data-l]")].map((i) => [i.dataset.l, i.value || 0]));
        try {
          state.ledger = await api("PUT", "/ledger", body);
          haptic("medium");
          closeSheet();
          toast("Сохранено");
          render();
        } catch (e) {
          toast(`Ошибка: ${e.message}`);
        }
      };
    },
  );
}

// Блок экрана «Сегодня»: 5 самых важных + переход ко всему списку.
const section = (icon, title, items, renderItem, { empty, filter, max = 5 } = {}) =>
  items.length
    ? `<div class="list-head"><h2 style="margin:0">${icon} ${title} · ${items.length}</h2>${items.length > max && filter ? `<button class="link" data-goto="${filter}">Все →</button>` : ""}</div>
       <div class="list">${items.slice(0, max).map(renderItem).join("")}</div>`
    : empty
      ? `<h2>${icon} ${title}</h2><div class="card empty small">${empty}</div>`
      : "";

// ---------- routing ----------
function render() {
  safe(() => tg?.BackButton[state.leadId || state.more ? "show" : "hide"]());
  $tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  if (state.leadId) return renderLead();
  if (state.tab === "today") return renderToday();
  if (state.tab === "leads") return renderLeads();
  if (state.tab === "stats") return renderStats();
  if (state.tab === "more") return renderMore();
}

function go(patch) {
  blurInput();
  Object.assign(state, patch);
  closeSheet();
  window.scrollTo(0, 0);
  render();
}

// ---------- СЕГОДНЯ: рабочий список Дамира ----------
function renderToday() {
  const w = worklist(state.leads, state.offers);
  const paid = paidEvents(state.leads, state.offers);
  const today = todayKey();
  const sumRange = (from, to) => paid.filter((e) => e.day && e.day > from && e.day <= to).reduce((s, e) => s + e.amount, 0);
  const week = sumRange(addDays(today, -7), today);
  const prevWeek = sumRange(addDays(today, -14), addDays(today, -7));
  const t = sumMoney(state.leads.map(money));
  const delta = prevWeek ? Math.round(((week - prevWeek) / prevWeek) * 100) : null;
  const dateText = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  const tasks = w.reminders.length + w.needCd.length + w.waiting.filter((x) => x.days >= 5).length;

  const hour = new Date().getHours();
  const hi = hour < 5 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
  const monthFrom = `${today.slice(0, 8)}01`;
  const monthIncome = paid.filter((e) => e.day && e.day >= monthFrom && e.day <= today).reduce((s, e) => s + e.amount, 0);
  const goal = state.settings.monthlyGoal || 0;
  const pct = goal ? Math.min(100, Math.round((monthIncome / goal) * 100)) : 0;
  const daysInMonth = new Date(+today.slice(0, 4), +today.slice(5, 7), 0).getDate();
  const daysLeft = daysInMonth - +today.slice(8, 10) + 1;
  const perDay = goal > monthIncome ? (goal - monthIncome) / daysLeft : 0;

  $app.innerHTML = `
    ${brandBar()}
    <div class="hero">
      <div class="hero-top">
        <div>
          <div class="hero-hi">${hi}, ${esc(((state.member?.name || state.me.name || "").replace(/^@/, "")).split(" ")[0])} 👋</div>
          <div class="hero-date">${esc(dateText)} · ${tasks ? `${tasks} ${plural(tasks, "задача", "задачи", "задач")}` : "срочного нет"}</div>
        </div>
        <div style="display:flex;gap:8px"><button class="btn round light" data-help="start" aria-label="Как пользоваться">?</button><button class="btn round light" id="addLead" aria-label="Новый лид">＋</button></div>
      </div>
      <div class="hero-label tap" data-explain="month">Засчитано в этом месяце ›</div>
      <div class="hero-value">${rub(monthIncome)}</div>
      ${
        goal
          ? `<div class="hero-bar"><i style="width:${pct}%"></i></div>
             <div class="hero-foot"><span>${pct}% от плана ${rub(goal)}</span><span>${perDay ? `нужно ${rub(perDay)}/день` : "план выполнен 🔥"}</span></div>`
          : `<div class="hero-foot"><span>${isAdmin() ? "Задай план на месяц: «Ещё» → «Налог, партнёр и план»" : ""}</span></div>`
      }
    </div>

    <div class="kpis">
      <div class="kpi tap" data-explain="week"><div class="label">За 7 дней ›</div><div class="value">${rub(week)}</div>
        <div class="hint">${!week && !prevWeek ? "считается по засчётам в CRM" : delta === null ? "чистыми ≈ " + rub(netOf(week, state.settings)) : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% к прошлой неделе`}</div></div>
      <div class="kpi tap" data-explain="waiting"><div class="label">Ждём засчёта ›</div><div class="value">${rub(t.waiting)}</div><div class="hint">ЦД сделали, денег нет</div></div>
      ${isAdmin() ? (() => {
        const debt = networkReport(state.leads, state.offers, state.payouts).reduce((t, n) => t + n.debt, 0);
        return debt ? `<div class="kpi debt wide" data-gomore="payouts" role="button"><div class="label">Сети не доплатили</div><div class="value">${rub(debt)}</div><div class="hint">засчитано, но денег не видели → сверить</div></div>` : "";
      })() : ""}
      <div class="kpi wide tap" data-explain="inwork"><div class="label">В работе ›</div><div class="value">${rub(t.inWork)}</div><div class="hint">заявки и открытые счета — столько можно дожать</div></div>
    </div>

    ${section("⏰", "Сроки по офферам", w.dues, (d) =>
      leadRow(d.lead, `${esc(d.name.replace(/ — РКО$/, ""))} · ${statusPill(statusKey(d.lead.offers[d.id]), offerById(d.id)?.category)}`, `<span class="badge ${d.overdue ? "warn" : ""}">${d.overdue ? "просрочено " : ""}${fmtDate(d.dueAt)}</span>`),
      { max: 10 },
    )}

    ${section("🔔", "Напоминания", w.reminders, (r) =>
      leadRow(r.lead, esc(r.lead.nextStep || "Без описания"), `<span class="badge ${r.overdue ? "warn" : ""}">${r.overdue ? "просрочено " + fmtDate(r.lead.remindAt) : "сегодня"}</span>`),
      { filter: "remind", max: 10 },
    )}
    ${section("🎯", "Нужна ЦД — счёт открыт", w.needCd, (x) =>
      leadRow(x.lead, "", `<b>${rub(x.sum)}</b>${x.days ? `<div class="sub">${x.days} дн.</div>` : ""}`, quickButtons(x.lead, x.items, "opened")),
      { empty: "Открытых счетов без ЦД нет", filter: "cd" },
    )}
    ${section("📞", "Ждут засчёта — пинать партнёрку", w.waiting, (x) =>
      leadRow(x.lead, "", `<b>${rub(x.sum)}</b>${x.days ? `<div class="sub ${x.days >= 5 ? "danger" : ""}">${x.days} дн.</div>` : ""}`, quickButtons(x.lead, x.items, "done")),
      { filter: "waiting" },
    )}
    ${section("📝", "Заявки заведены — довести до счёта", w.applied, (x) =>
      leadRow(x.lead, "", `<b>${rub(x.sum)}</b>${x.days ? `<div class="sub">${x.days} дн.</div>` : ""}`, quickButtons(x.lead, x.items, "applied")),
      { filter: "applied" },
    )}
    ${section("💳", "МФО: деньги ещё на карте у лида", w.onCard, (x) => leadRow(x.lead, `${esc(x.name)} · засчитано, деньги не забрали`, `<b>${rub(x.amount)}</b>${x.days ? `<div class="sub ${x.days >= 5 ? "danger" : ""}">${x.days} дн.</div>` : ""}`), { max: 10 })}
    ${section("🐢", "Без движения 5+ дней", w.stale, (x) => leadRow(x.lead, `${stageBadge(x.lead.stage)} в работе ${rub(x.sum)}`, `<span class="danger">${x.days} дн.</span>`), { filter: "stale" })}
    ${!tasks && !w.applied.length && !w.stale.length ? `<div class="card empty">🔥 Всё разобрано. Время заводить новых лидов.</div>` : ""}
  `;
  document.getElementById("addLead").onclick = addLeadSheet;
}

// ---------- ЛИДЫ ----------
const FILTERS = [
  ["all", "Все"],
  ["cd", "Нужна ЦД"],
  ["waiting", "Ждут засчёта"],
  ["applied", "Заявки"],
  ["remind", "Напоминания"],
  ["stale", "Без движения"],
  ["new", "Новые"],
  ["in_work", "В работе"],
  ["offers", "Докрутка"],
  ["closed", "Цикл закрыт"],
  ["lost", "Слились"],
];
const SORTS = [
  ["recent", "Недавно изменённые"],
  ["inwork", "Больше денег в работе"],
  ["net", "Больше заработали"],
  ["idle", "Давно не трогали"],
];

function filterLeads() {
  const q = state.query.trim().toLowerCase();
  const today = todayKey();
  const has = (l, st) => Object.values(l.offers || {}).some((o) => o.status === st);
  const pass = {
    all: () => true,
    cd: (l) => ACTIVE_STAGES.has(l.stage) && has(l, "opened"),
    waiting: (l) => has(l, "done"),
    applied: (l) => ACTIVE_STAGES.has(l.stage) && has(l, "applied"),
    remind: (l) => l.remindAt && l.remindAt <= today,
    stale: (l) => ACTIVE_STAGES.has(l.stage) && daysSince(l.updatedAt) >= 5,
    new: (l) => l.stage === "new",
    closed: (l) => l.stage === "closed",
    lost: (l) => l.stage === "lost",
  };
  // Несколько выбранных фильтров складываются: «В работе» + «Слились» = и те, и другие.
  const sel = selectedFilters();
  const list = state.leads
    .filter((l) => !sel.length || sel.some((f) => (pass[f] || ((x) => x.stage === f))(l)))
    .filter((l) => !state.tags.length || state.tags.some((t) => l.tags?.includes(t)))
    .filter((l) => !q || `${l.telegram} ${l.fio} ${l.phone || ""} ${l.source} ${l.nextStep || ""}`.toLowerCase().includes(q))
    .filter((l) => {
      const f = state.offerFilter;
      if (!f) return true;
      const st = l.offers?.[f.id]?.status || "none";
      return f.cond === "none" ? st === "none" && ACTIVE_STAGES.has(l.stage) : f.cond === "work" ? ["applied", "opened", "done"].includes(st) : f.cond === "paid" ? st === "paid" : ["rejected", "exists"].includes(st);
    })
    .map((l) => ({ l, m: money(l) }));
  const sorters = {
    recent: (a, b) => b.l.updatedAt.localeCompare(a.l.updatedAt),
    inwork: (a, b) => b.m.inWork - a.m.inWork,
    net: (a, b) => b.m.net - a.m.net,
    idle: (a, b) => a.l.updatedAt.localeCompare(b.l.updatedAt),
  };
  return list.sort(sorters[state.sort]);
}

const selectedFilters = () => state.filter.split(",").filter((f) => f && f !== "all");
const tagPills = (tags) => (tags || []).map((t) => `<span class="pill tag">${TAG_LABELS[t]}</span>`).join(" ");
const tagChips = (active, attr = "data-tag") =>
  Object.entries(TAG_LABELS).map(([t, label]) => `<button class="chip tag ${active.includes(t) ? "active" : ""}" ${attr}="${t}">${label}</button>`).join("");

const dupCount = () => {
  const seen = new Map();
  for (const l of state.leads) {
    const k = (l.telegram || "").toLowerCase();
    if (k) seen.set(k, (seen.get(k) || 0) + 1);
  }
  return [...seen.values()].filter((n) => n > 1).reduce((t, n) => t + n - 1, 0);
};

async function mergeDuplicates(btn) {
  if (!(await confirmDialog("Объединить дубли? По каждому нику останется одна карточка: статусы офферов берутся самые свежие, история склеивается, копии удаляются."))) return;
  if (btn) btn.disabled = true;
  try {
    const r = await api("POST", "/dedupe");
    await reload();
    alertDialog(`Готово: объединено ${r.groups}, удалено копий: ${r.removed}`);
  } catch (e) {
    if (btn) btn.disabled = false;
    toast(`Ошибка: ${e.message}`);
  }
}

function renderLeads() {
  const list = filterLeads();
  const dups = isAdmin() ? dupCount() : 0;
  $app.innerHTML = `
    ${dups ? `<div class="card dup-banner"><div><b>Найдены дубли: ${dups}</b><div class="sub">Одни и те же ники заведены несколько раз</div></div><button class="btn small" id="mergeDups">Объединить</button></div>` : ""}
    <div class="toolbar">
      <input id="q" type="search" placeholder="🔍 Ник, ФИО, телефон, источник" value="${esc(state.query)}" autocomplete="off">
      <button class="btn round" id="addLead" aria-label="Новый лид">＋</button>
    </div>
    <div class="chips">
      ${FILTERS.map(([f, label]) => `<button class="chip ${(f === "all" ? !selectedFilters().length : selectedFilters().includes(f)) ? "active" : ""}" data-filter="${f}">${label}</button>`).join("")}
    </div>
    <div class="chips tight tags-row"><span class="sub">Теги:</span>${tagChips(state.tags, "data-tagfilter")}</div>
    ${selectedFilters().length > 1 ? `<div class="sub" style="margin:0 4px 6px">Показаны сразу: ${selectedFilters().map((f) => FILTERS.find((x) => x[0] === f)?.[1] || STAGE_LABELS[f] || f).join(" + ")} · «Все» — сбросить</div>` : ""}
    ${state.offerFilter ? `<div class="chips tight" style="margin:0 0 8px"><button class="chip active" id="offerFilterClear">${esc(offerById(state.offerFilter.id)?.name.replace(/ — РКО$/, "") || "")}: ${OFFER_CONDS[state.offerFilter.cond]} ✕</button></div>` : ""}
    <div class="list-head">
      <span>${splitSide(list).main.length} ${plural(splitSide(list).main.length, "лид", "лида", "лидов")} · <button class="link" id="offerFilter">🏦 Фильтр по офферу</button></span>
      <select id="sort">${SORTS.map(([s, label]) => `<option value="${s}" ${state.sort === s ? "selected" : ""}>${label}</option>`).join("")}</select>
    </div>
    <div id="leadList">${leadsBlock(list)}</div>`;

  const $q = document.getElementById("q");
  $q.addEventListener("input", () => {
    state.query = $q.value;
    document.getElementById("leadList").innerHTML = leadsBlock(filterLeads());
  });
  document.getElementById("mergeDups")?.addEventListener("click", (e) => mergeDuplicates(e.target));
  document.getElementById("offerFilter").onclick = offerFilterSheet;
  document.getElementById("offerFilterClear")?.addEventListener("click", () => go({ offerFilter: null }));
  document.getElementById("sort").onchange = (e) => {
    state.sort = e.target.value;
    renderLeads();
  };
  document.getElementById("addLead").onclick = addLeadSheet;
  $app.querySelectorAll("[data-tagfilter]").forEach((b) => (b.onclick = () => {
    const t = b.dataset.tagfilter;
    state.tags = state.tags.includes(t) ? state.tags.filter((x) => x !== t) : [...state.tags, t];
    renderLeads();
  }));
}

const OFFER_CONDS = { none: "ещё не делали", work: "в работе", paid: "засчитан", dead: "отказ / уже есть" };

function offerFilterSheet() {
  let cond = state.offerFilter?.cond || "none";
  openSheet(
    `<h2 class="sheet-title">Фильтр по офферу</h2>
    <div class="explain">Например: «Озон — ещё не делали» покажет активных лидов, кому можно предложить Озон. «ВТБ — в работе» — у кого ВТБ сейчас в процессе.</div>
    <div class="chips tight" id="conds">${Object.entries(OFFER_CONDS).map(([k, l]) => `<button class="chip ${k === cond ? "active" : ""}" data-cond="${k}">${l}</button>`).join("")}</div>
    ${Object.keys(CATEGORY_LABELS)
      .map((c) => {
        const list = state.offers.filter((o) => o.category === c && o.active);
        return list.length ? `<h2>${CATEGORY_LABELS[c]}</h2><div class="offer-grid">${list.map((o) => `<button class="offer-chip" data-fo="${o.id}"><b>${esc(o.name.replace(/ — РКО$/, ""))}</b><span>${o.amount ? rub(o.amount) : ""}</span></button>`).join("")}</div>` : "";
      })
      .join("")}`,
    (el) => {
      el.querySelectorAll("[data-cond]").forEach((b) => (b.onclick = () => {
        cond = b.dataset.cond;
        el.querySelectorAll("[data-cond]").forEach((x) => x.classList.toggle("active", x === b));
      }));
      el.querySelectorAll("[data-fo]").forEach((b) => (b.onclick = () => go({ offerFilter: { id: b.dataset.fo, cond }, filter: "all" })));
    },
  );
}

// «Цикл закрыт» и «Слились» не мешают в основном списке — уходят в свёрнутые блоки внизу.
// Если явно выбран фильтр этого этапа — показываем их как обычно.
const SIDE_STAGES = [["closed", "✅ Цикл закрыт"], ["lost", "😶 Слились"]];
const splitSide = (list) => {
  const sel = selectedFilters();
  const side = SIDE_STAGES.filter(([st]) => !sel.includes(st)).map(([st, title]) => ({ st, title, items: list.filter(({ l }) => l.stage === st) }));
  const hidden = new Set(side.map((x) => x.st));
  return { main: list.filter(({ l }) => !hidden.has(l.stage)), side: side.filter((x) => x.items.length) };
};

state.sideOpen = {};
function leadsBlock(list) {
  const { main, side } = splitSide(list);
  return `${main.length || !side.length ? leadListHtml(main) : ""}
    ${side.map((x) => `<details class="cat side-block" data-side="${x.st}" ${state.sideOpen[x.st] ? "open" : ""}><summary><span>${x.title}</span><span class="sub">${x.items.length}</span></summary>${leadListHtml(x.items)}</details>`).join("")}`;
}
// toggle не всплывает — ловим на захвате, чтобы блок не схлопывался при перерисовке
document.addEventListener("toggle", (e) => e.target.dataset?.side && (state.sideOpen[e.target.dataset.side] = e.target.open), true);

function leadListHtml(list) {
  if (!list.length) return `<div class="card empty">Никого не нашёл</div>`;
  return `<div class="list">${list
    .map(({ l, m }) => {
      const cd = Object.values(l.offers || {}).filter((o) => o.status === "opened").length;
      const bits = [stageBadge(l.stage)];
      if (l.tags?.length) bits.push(tagPills(l.tags));
      if (cd) bits.push(`<span class="pill st-opened">ЦД ×${cd}</span>`);
      if (m.waiting) bits.push(`<span class="pill st-done">ждём ${short(m.waiting)}</span>`);
      if (l.remindAt) bits.push(`<span class="badge">🔔 ${fmtDate(l.remindAt)}</span>`);
      const fio = l.telegram && l.fio ? `<span class="fio">${esc(l.fio)}</span>` : "";
      return leadRow(
        l,
        `${fio}${bits.join(" ")}`,
        `<div class="money-green">${rub(m.net)}</div>${m.inWork ? `<div class="money-orange">+${rub(m.inWork)}</div>` : ""}`,
      );
    })
    .join("")}</div>`;
}

function addLeadSheet() {
  const sources = [...new Set(state.leads.map((l) => l.source).filter(Boolean))].slice(0, 8);
  openSheet(
    `<h2 class="sheet-title">Новый лид</h2>
    <label class="field"><span>Telegram</span><input id="nTg" placeholder="@username" autocomplete="off" autocapitalize="off"></label>
    <label class="field"><span>ФИО</span><input id="nFio" placeholder="Можно потом"></label>
    <label class="field"><span>Телефон</span><input id="nPhone" type="tel" placeholder="Можно потом"></label>
    <label class="field"><span>Откуда пришёл</span><input id="nSrc" placeholder="YouTube, Reels, партнёр…"></label>
    <div class="field"><span>На что крутить</span></div>
    <div class="chips tight" id="nTags" style="margin-bottom:10px">${tagChips([])}</div>
    <div class="chips tight" style="margin-bottom:6px">${[...new Set([...sources, "YouTube", "Reels", "Telegram", "Сарафан", "Партнёр"])].slice(0, 8).map((x) => `<button class="chip" data-src="${esc(x)}">${esc(x)}</button>`).join("")}</div>
    <button class="btn block" id="nSave">Создать и открыть</button>`,
    (el) => {
      el.querySelector("#nTg").focus();
      el.querySelectorAll("[data-tag]").forEach((b) => (b.onclick = () => b.classList.toggle("active")));
      el.querySelectorAll("[data-src]").forEach((b) => (b.onclick = () => (el.querySelector("#nSrc").value = b.dataset.src)));
      el.querySelector("#nSave").onclick = async () => {
        const body = { telegram: el.querySelector("#nTg").value, fio: el.querySelector("#nFio").value, phone: el.querySelector("#nPhone").value, source: el.querySelector("#nSrc").value, tags: [...el.querySelectorAll("[data-tag].active")].map((b) => b.dataset.tag) };
        if (!body.telegram.trim() && !body.fio.trim()) return toast("Нужен ник или ФИО");
        const dup = body.telegram && state.leads.find((l) => l.telegram.toLowerCase() === `@${body.telegram.replace(/^@/, "")}`.toLowerCase());
        if (dup && !(await confirmDialog(`${dup.telegram} уже есть в базе. Всё равно создать?`))) return;
        const btn = el.querySelector("#nSave");
        if (btn.disabled) return;
        btn.disabled = true;
        btn.textContent = "Создаю…";
        try {
          const lead = await api("POST", "/leads", body);
          state.leads = state.leads.filter((l) => l.id !== lead.id);
          state.leads.unshift(lead);
          haptic("medium");
          go({ leadId: lead.id });
        } catch (e) {
          btn.disabled = false;
          btn.textContent = "Создать и открыть";
          toast(`Ошибка: ${e.message}`);
        }
      };
    },
  );
}

// ---------- КАРТОЧКА ЛИДА ----------
function renderLead() {
  const lead = state.leads.find((l) => l.id === state.leadId);
  if (!lead) return go({ leadId: null });
  const m = money(lead);
  const touched = Object.entries(lead.offers || {})
    .filter(([, lo]) => lo.status !== "none")
    .map(([id, lo]) => ({ id, lo, o: offerById(id) }))
    .filter((x) => x.o)
    .sort((a, b) => STATUS_ORDER.indexOf(a.lo.status) - STATUS_ORDER.indexOf(b.lo.status));
  const nick = lead.telegram && lead.telegram.startsWith("@");
  const isDead = (x) => x.lo.status === "rejected" || x.lo.status === "exists";
  const live = touched.filter((x) => !isDead(x));
  const dead = touched.filter(isDead);

  $app.innerHTML = `
    <div class="lead-card">
      <div class="lead-head">
        ${avatar(lead, 56)}
        <div class="grow">
          <h1>${esc(leadTitle(lead))}</h1>
          <div class="sub">${[lead.telegram && lead.fio ? esc(lead.fio) : "", lead.source ? "из " + esc(lead.source) : "", isAdmin() && lead.ownerName ? "ведёт " + esc(lead.ownerName) : ""].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <div class="actions">
        ${nick ? `<button class="action" id="write"><span>✉️</span>Написать</button>` : ""}
        <button class="action" id="tpl"><span>💬</span>Шаблоны</button>
        ${lead.phone ? `<a class="action" href="tel:${esc(lead.phone.replace(/[^\d+]/g, ""))}"><span>📞</span>Позвонить</a>` : ""}
        <button class="action" id="pay"><span>💵</span>Выплата</button>
      </div>
    </div>

    <div class="chips stages">
      ${Object.entries(STAGE_LABELS).map(([s, label]) => `<button class="chip ${lead.stage === s ? "active" : ""}" data-stage="${s}">${label}</button>`).join("")}
    </div>
    <div class="chips tight tags-row"><span class="sub">На что крутить:</span>${tagChips(lead.tags || [])}</div>

    <div class="kpis three">
      <div class="kpi"><div class="label">Чистая</div><div class="value money-green">${rub(m.net)}</div></div>
      <div class="kpi"><div class="label">В работе</div><div class="value money-orange">${rub(m.inWork)}</div></div>
      <div class="kpi"><div class="label">Ждём засчёта</div><div class="value">${rub(m.waiting)}</div></div>
    </div>
    ${lead.payout ? `<div class="sub" style="margin:8px 4px 0">💵 Выплачено лиду: <b>${rub(lead.payout)}</b></div>` : ""}

    <h2>Следующий шаг</h2>
    <div class="card next">
      <input id="nextStep" value="${esc(lead.nextStep || "")}" placeholder="Что сделать: «дожать ЦД по ВТБ», «отправить ссылку на Озон»">
      <div class="chips tight">
        ${[["0", "Сегодня"], ["1", "Завтра"], ["3", "Через 3 дня"], ["7", "Через неделю"]]
          .map(([d, label]) => `<button class="chip ${lead.remindAt && lead.remindAt === addLocal(+d) ? "active" : ""}" data-remind="${d}">${label}</button>`)
          .join("")}
        ${lead.remindAt ? `<button class="chip danger-chip" data-remind="">✕ ${fmtDate(lead.remindAt)}</button>` : ""}
      </div>
    </div>

    <div class="list-head"><h2 style="margin:0">Офферы · ${live.length}</h2><button class="btn small" id="addOffer">＋ Оффер</button></div>
    ${
      live.length
        ? `<div class="list">${live.map(offerRowHtml).join("")}</div>`
        : `<div class="card empty small">${dead.length ? "Живых офферов нет" : "Офферов пока нет"} — жми «＋ Оффер»</div>`
    }
    ${dead.length ? `<details class="cat"><summary><span>Отказы и дубли</span><span class="sub">${dead.length}</span></summary><div class="list">${dead.map(offerRowHtml).join("")}</div></details>` : ""}

    <details class="cat" ${lead.note ? "open" : ""}>
      <summary><span>Данные и заметки</span><span class="sub">${lead.payout ? "выплачено " + rub(lead.payout) : ""}</span></summary>
      <div class="card flat">
        <label class="field"><span>Telegram</span><input data-f="telegram" value="${esc(lead.telegram)}" placeholder="@username"></label>
        <label class="field"><span>ФИО</span><input data-f="fio" value="${esc(lead.fio)}"></label>
        <label class="field"><span>Телефон</span><input data-f="phone" type="tel" value="${esc(lead.phone || "")}" placeholder="+7…"></label>
        <label class="field"><span>Источник</span><input data-f="source" value="${esc(lead.source)}" placeholder="YouTube, Reels, партнёр…"></label>
        <label class="field"><span>Выплачено лиду, ₽</span><input data-f="payout" type="number" inputmode="decimal" min="0" value="${lead.payout || 0}"></label>
        <label class="field"><span>Заметки</span><textarea data-f="note" placeholder="Что обсудили, нюансы">${esc(lead.note)}</textarea></label>
      </div>
    </details>

    <details class="cat">
      <summary><span>Расчёт по лиду</span><span class="sub">${rub(m.net)}</span></summary>
      ${reportRows(m)}
    </details>

    ${
      lead.history?.length
        ? `<h2>История</h2><div class="list history">${lead.history
            .slice(0, 12)
            .map((h) => `<div class="row"><div class="grow">${esc(h.text)}</div><div class="right sub">${esc(h.by)}<br>${new Date(h.at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div></div>`)
            .join("")}</div>`
        : ""
    }
    <div class="sub center">Добавлен ${new Date(lead.createdAt).toLocaleDateString("ru-RU")}</div>
    ${isAdmin() ? `<button class="btn danger" id="del">Удалить лида</button>` : ""}`;

  document.getElementById("write")?.addEventListener("click", () => openTelegram(lead.telegram));
  document.getElementById("tpl").onclick = () => templatesSheet(lead);
  document.getElementById("pay").onclick = async () => {
    const v = await askAmount(`Сколько выплатили лиду?${lead.payout ? ` Уже выплачено ${rub(lead.payout)}.` : ""}`);
    if (v) saveLead(lead.id, { addPayout: v }, `💵 Выплата +${rub(v)}`);
  };
  $app.querySelectorAll("[data-stage]").forEach((b) => (b.onclick = () => b.dataset.stage !== lead.stage && saveLead(lead.id, { stage: b.dataset.stage })));
  $app.querySelectorAll("[data-tag]").forEach((b) => (b.onclick = () => {
    const t = b.dataset.tag;
    const cur = lead.tags || [];
    saveLead(lead.id, { tags: cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t] });
  }));
  const $next = document.getElementById("nextStep");
  $next.addEventListener("change", () => saveLead(lead.id, { nextStep: $next.value }));
  $app.querySelectorAll("[data-remind]").forEach(
    (b) => (b.onclick = () => saveLead(lead.id, { nextStep: $next.value, remindAt: b.dataset.remind === "" ? "" : addLocal(+b.dataset.remind) }, b.dataset.remind === "" ? "Напоминание снято" : `🔔 Напомню ${fmtDate(addLocal(+b.dataset.remind))}`)),
  );
  $app.querySelectorAll("[data-f]").forEach((el) => el.addEventListener("change", () => saveLead(lead.id, { [el.dataset.f]: el.value })));
  $app.querySelectorAll("[data-offer]").forEach((b) => (b.onclick = () => offerSheet(lead, b.dataset.offer)));
  document.getElementById("addOffer").onclick = () => addOfferSheet(lead);
  document.getElementById("del")?.addEventListener("click", () => deleteLead(lead.id));
}

const offerRowHtml = ({ id, lo, o }) => `<button class="row" data-offer="${id}">
  <div class="grow"><div class="title">${esc(o.name)}</div>
    <div class="sub">${[networkOf(lo, o), lo.comment].filter(Boolean).map(esc).join(" · ")}</div></div>
  <div class="right">${statusPill(statusKey(lo), o.category)}<div class="sub">${lo.dueAt ? `<span class="${lo.dueAt <= todayKey() ? "danger" : ""}">⏰ ${fmtDate(lo.dueAt)}</span> · ` : ""}${rub(lo.amount)}${lo.cost ? ` · −${short(lo.cost)}` : ""}</div></div>
</button>`;

const addLocal = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localKey(d);
};

const COMMENT_PRESETS = () => [...(ACADEMY ? [] : [`ЛК ${state.settings.partnerName}`, "ЛК Пети"]), "Провели ", "Маскировка", "Отчёт в конце месяца", "Дорег"];
const COST_STEPS = [20, 50, 100, 500, 1000];

function offerSheet(lead, offerId, opts) {
  const o = offerById(offerId);
  const lo = lead.offers[offerId] || { status: "none", amount: o.amount, cost: o.cost || 0, comment: "", dueAt: "" };
  const save = async (patch, okText) => {
    const updated = await saveLead(lead.id, { offers: { [offerId]: patch } }, okText);
    // перерисовываем окно, только если оно ещё открыто (могли закрыть, пока сохранялось)
    if (updated && document.getElementById("oAmount")) offerSheet(updated, offerId, { instant: true });
  };
  openSheet(
    `<div class="sheet-head">
      <div><h2 class="sheet-title">${esc(o.name)}</h2>
      <div class="sub">${[networkOf(lo, o), CATEGORY_LABELS[o.category], o.note].filter(Boolean).map(esc).join(" · ")}</div></div>
      <button class="btn small" id="oDone">Готово</button>
    </div>

    <div class="sheet-label">Статус</div>
    <div class="status-grid">
      ${(statusOrder(o.category).includes(statusKey(lo)) ? statusOrder(o.category) : [statusKey(lo), ...statusOrder(o.category)]).map((st) => `<button class="status-btn st-${st} ${statusKey(lo) === st ? "current" : ""}" data-set="${st}">${statusKey(lo) === st ? "● " : ""}${statusLabel(st, o.category)}</button>`).join("")}
    </div>

    <div class="sheet-label">Деньги</div>
    <div class="card">
      <div class="two">
        <label class="field"><span>Ставка, ₽</span><input id="oAmount" type="number" inputmode="decimal" value="${lo.amount}"></label>
        <label class="field"><span>Затраты всего, ₽</span><input id="oCost" type="number" inputmode="decimal" value="${lo.cost || 0}"></label>
      </div>
      <div class="sub" style="margin:2px 4px 6px">Добавить затрату (комиссия, тариф, маскировка):</div>
      <div class="chips tight">
        ${COST_STEPS.map((c) => `<button class="chip" data-addcost="${c}">+${c}</button>`).join("")}
      </div>
      <div class="inline-add"><input id="oCostAdd" type="number" inputmode="decimal" placeholder="Своя сумма, ₽"><button class="btn small" id="oCostAddBtn">＋ Добавить</button></div>
    </div>

    <div class="sheet-label">Партнёрская сеть</div>
    <div class="card">
      <input id="oNet" value="${esc(networkOf(lo, o))}" list="netList" placeholder="RKO Group, Бизнес Система, FCN…">
      <datalist id="netList">${[...new Set(state.offers.map((x) => x.partner).filter(Boolean))].map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
      ${lo.amount !== o.amount || (lo.network && lo.network !== o.partner) ? `<button class="chip" id="oTpl" style="margin-top:8px">📌 Сделать шаблоном: ${rub(lo.amount)}${lo.network ? " · " + esc(lo.network) : ""} — для новых лидов</button>` : ""}
      ${lo.status === "paid" && isAdmin() ? `<button class="chip ${lo.received ? "active" : ""}" id="oRecv" style="margin-top:8px">${lo.received ? "💰 Деньги от сети получены" : "Отметить: деньги от сети пришли"}</button>` : ""}
    </div>

    <div class="sheet-label">Комментарий</div>
    <div class="card">
      <input id="oComment" value="${esc(lo.comment || "")}" placeholder="Провели 2300, ЛК партнёра…">
      <div class="chips tight">${COMMENT_PRESETS().map((c) => `<button class="chip" data-preset="${esc(c)}">${esc(c.trim())}</button>`).join("")}</div>
    </div>

    <div class="sheet-label">Срок ${lo.dueAt ? `· <b>${fmtDate(lo.dueAt)}</b>` : ""}</div>
    <div class="card">
      <div class="sub" style="margin:0 4px 6px">Когда вернуться к офферу: конец маскировки, отчёт банка, встреча. Всплывёт в «Сегодня» и в утренней сводке.</div>
      <div class="chips tight">
        ${[["1", "Завтра"], ["3", "3 дня"], ["5", "5 дней · маскировка"], ["7", "Неделя"]].map(([d, label]) => `<button class="chip ${lo.dueAt === addLocal(+d) ? "active" : ""}" data-due="${d}">${label}</button>`).join("")}
        <label class="chip date-chip">📅 Дата<input type="date" id="oDue" value="${lo.dueAt || ""}"></label>
        ${lo.dueAt ? `<button class="chip danger-chip" data-due="">✕ Убрать</button>` : ""}
      </div>
    </div>`,
    (el) => {
      el.querySelector("#oDone").onclick = closeSheet;
      el.querySelectorAll("[data-set]").forEach(
        (b) =>
          (b.onclick = () => {
            if (b.dataset.set === statusKey(lo)) return;
            const label = `${o.name.replace(/ — РКО$/, "")}: ${statusLabel(b.dataset.set, o.category, true)}`;
            if ((b.dataset.set === "paid" || b.dataset.set === "oncard") && lo.status !== "paid") celebrate(lo.amount);
            save(statusPatch(b.dataset.set), label);
          }),
      );
      el.querySelector("#oAmount").onchange = (e) => save({ amount: e.target.value }, "Ставка сохранена");
      el.querySelector("#oCost").onchange = (e) => save({ cost: e.target.value }, "Затраты сохранены");
      el.querySelectorAll("[data-addcost]").forEach((b) => (b.onclick = () => save({ addCost: +b.dataset.addcost }, `Затраты +${b.dataset.addcost} ₽`)));
      el.querySelector("#oCostAddBtn").onclick = () => {
        const v = Number(el.querySelector("#oCostAdd").value.replace(",", "."));
        if (v > 0) save({ addCost: v }, `Затраты +${v} ₽`);
      };
      el.querySelector("#oNet").onchange = (e) => save({ network: e.target.value === (o.partner || "") ? "" : e.target.value }, "Сеть сохранена");
      el.querySelector("#oTpl")?.addEventListener("click", async () => {
        try {
          const r = await api("PATCH", `/offers/${offerId}`, { amount: lo.amount, ...(lo.network ? { partner: lo.network } : {}) });
          state.offers = r.offers;
          toast("📌 Шаблон оффера обновлён");
          offerSheet(lead, offerId, { instant: true });
        } catch (e) {
          toast(`Ошибка: ${e.message}`);
        }
      });
      el.querySelector("#oRecv")?.addEventListener("click", () => save({ received: !lo.received }, lo.received ? "Отметка снята" : "💰 Отмечено: деньги пришли"));
      const $c = el.querySelector("#oComment");
      $c.onchange = () => save({ comment: $c.value }, "Комментарий сохранён");
      el.querySelectorAll("[data-preset]").forEach(
        (b) =>
          (b.onclick = () => {
            const p = b.dataset.preset;
            if (p.endsWith(" ")) {
              $c.value = ($c.value ? $c.value + ", " : "") + p;
              $c.focus();
              return;
            }
            save({ comment: $c.value ? `${$c.value}, ${p}` : p }, "Комментарий сохранён");
          }),
      );
      el.querySelectorAll("[data-due]").forEach((b) => (b.onclick = () => save({ dueAt: b.dataset.due === "" ? "" : addLocal(+b.dataset.due) }, b.dataset.due === "" ? "Срок убран" : `⏰ Срок ${fmtDate(addLocal(+b.dataset.due))}`)));
      el.querySelector("#oDue").onchange = (e) => e.target.value && save({ dueAt: e.target.value }, `⏰ Срок ${fmtDate(e.target.value)}`);
    },
    opts,
  );
}

// Шаблон оффера из каталога: то, что подставляется новым лидам.
function offerTemplateSheet(offerId, back) {
  const o = offerById(offerId);
  openSheet(
    `<h2 class="sheet-title">Шаблон: ${esc(o.name)}</h2>
    <div class="explain">Эти данные подставляются, когда оффер добавляют лиду. У лидов, где оффер уже есть, ничего не меняется.</div>
    <label class="field"><span>Название</span><input id="tName" value="${esc(o.name)}"></label>
    <div class="two">
      <label class="field"><span>Ставка, ₽</span><input id="tAmount" type="number" inputmode="decimal" value="${o.amount || ""}"></label>
      <label class="field"><span>Затраты, ₽</span><input id="tCost" type="number" inputmode="decimal" value="${o.cost || ""}"></label>
    </div>
    <label class="field"><span>Партнёрская сеть</span><input id="tNet" list="tNets" value="${esc(o.partner)}"></label>
    <datalist id="tNets">${[...new Set(state.offers.map((x) => x.partner).filter(Boolean))].map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
    <label class="field"><span>Заметка</span><input id="tNote" value="${esc(o.note || "")}" placeholder="Условия, нюансы"></label>
    <button class="btn block" id="tSave">Сохранить шаблон</button>
    <button class="btn ghost block" id="tHide" style="margin-top:8px">${o.active ? "Скрыть из списка (оффер не работает)" : "Вернуть в список"}</button>`,
    (el) => {
      const send = async (patch, text) => {
        try {
          const r = await api("PATCH", `/offers/${offerId}`, patch);
          state.offers = r.offers;
          toast(text);
          back();
        } catch (e) {
          toast(`Ошибка: ${e.message}`);
        }
      };
      el.querySelector("#tSave").onclick = () =>
        send({ name: el.querySelector("#tName").value, amount: el.querySelector("#tAmount").value, cost: el.querySelector("#tCost").value, partner: el.querySelector("#tNet").value, note: el.querySelector("#tNote").value }, "Шаблон сохранён");
      el.querySelector("#tHide").onclick = () => send({ active: !o.active }, o.active ? "Оффер скрыт" : "Оффер возвращён");
    },
  );
}

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

function templatesSheet(lead) {
  const list = state.settings.templates || [];
  openSheet(
    `<h2 class="sheet-title">Шаблоны сообщений</h2>
    <div class="sub" style="margin:-6px 4px 10px">Тап — текст скопируется${lead.telegram?.startsWith("@") ? " и откроется чат с " + esc(lead.telegram) : ""}. Останется вставить.</div>
    <div class="list">${list.map((t, i) => `<button class="row tpl" data-tpl="${i}"><div class="grow">${esc(t)}</div></button>`).join("") || `<div class="empty small">Шаблонов нет — добавь в «Ещё» → «Шаблоны»</div>`}</div>`,
    (el) =>
      el.querySelectorAll("[data-tpl]").forEach(
        (b) =>
          (b.onclick = async () => {
            const ok = await copyText(list[+b.dataset.tpl]);
            closeSheet();
            toast(ok ? "Скопировано — вставь в чат" : "Не удалось скопировать");
            if (ok && lead.telegram?.startsWith("@")) setTimeout(() => openTelegram(lead.telegram), 400);
          }),
      ),
  );
}

// Салют на засчёт: деньги должны радовать.
function celebrate(amount) {
  haptic("heavy");
  safe(() => tg?.HapticFeedback?.notificationOccurred?.("success"));
  const box = document.createElement("div");
  box.className = "confetti";
  for (let i = 0; i < 18; i++) {
    const p = document.createElement("span");
    p.textContent = ["💸", "💰", "🔥", "✨"][i % 4];
    p.style.left = `${10 + Math.random() * 80}%`;
    p.style.animationDelay = `${Math.random() * 0.25}s`;
    p.style.setProperty("--dx", `${(Math.random() - 0.5) * 160}px`);
    box.append(p);
  }
  const big = document.createElement("div");
  big.className = "confetti-sum";
  big.textContent = `+${rub(amount)}`;
  box.append(big);
  document.body.append(box);
  setTimeout(() => box.remove(), 1800);
}

function addOfferSheet(lead) {
  const free = (cat) => state.offers.filter((o) => o.category === cat && o.active && (!lead.offers[o.id] || lead.offers[o.id].status === "none"));
  const cats = Object.keys(CATEGORY_LABELS).filter((c) => free(c).length);
  openSheet(
    `<h2 class="sheet-title">Добавить оффер</h2>
    <div class="sub" style="margin:-6px 4px 10px">Тап — заявка заведена. Статус потом меняется в один тап.</div>
    <div class="chips tight"><button class="chip" id="editMode">✏️ Править шаблоны (ставка, сеть)</button></div>
    <button class="btn ghost block" id="newOfferToggle">＋ Новый оффер — которого нет в списке</button>
    <div class="card new-offer" id="newOffer" hidden>
      <label class="field"><span>Название</span><input id="noName" placeholder="Например: Совкомбанк — РКО"></label>
      <div class="chips tight" id="noCat">${Object.entries(CATEGORY_LABELS).map(([c, l], i) => `<button class="chip ${i === 0 ? "active" : ""}" data-cat="${c}">${l}</button>`).join("")}</div>
      <div class="two" style="margin-top:8px">
        <label class="field"><span>Ставка, ₽</span><input id="noAmount" type="number" inputmode="decimal" placeholder="0"></label>
        <label class="field"><span>Сеть</span><input id="noNet" list="noNets" placeholder="RKO Group…"></label>
      </div>
      <datalist id="noNets">${[...new Set(state.offers.map((x) => x.partner).filter(Boolean))].map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
      <button class="btn block" id="noSave">Создать и добавить лиду</button>
      <div class="sub" style="margin-top:6px">Оффер попадёт в общий каталог — потом его можно выбрать и другим лидам.</div>
    </div>
    ${cats
      .map(
        (c) => `<h2>${CATEGORY_LABELS[c]}</h2><div class="offer-grid">${free(c)
          .map((o) => `<button class="offer-chip" data-add="${o.id}"><b>${esc(o.name.replace(/ — РКО$/, ""))}</b><span>${o.amount ? rub(o.amount) : "ставка ?"}</span></button>`)
          .join("")}</div>`,
      )
      .join("") || `<div class="card empty">Все офферы уже в работе</div>`}`,
    (el) => {
      el.querySelector("#newOfferToggle").onclick = (e) => {
        el.querySelector("#newOffer").hidden = false;
        e.target.hidden = true;
        el.querySelector("#noName").focus();
      };
      let editing = false;
      el.querySelector("#editMode").onclick = (e) => {
        editing = !editing;
        e.target.classList.toggle("active", editing);
        e.target.textContent = editing ? "✏️ Режим правки: тапни оффер · выключить" : "✏️ Править шаблоны (ставка, сеть)";
      };
      let cat = "rko";
      el.querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => {
        cat = b.dataset.cat;
        el.querySelectorAll("[data-cat]").forEach((x) => x.classList.toggle("active", x === b));
      }));
      el.querySelector("#noSave").onclick = async (e) => {
        const name = el.querySelector("#noName").value.trim();
        if (!name) return toast("Напиши название оффера");
        e.target.disabled = true;
        try {
          const r = await api("POST", "/offers", { name, category: cat, amount: el.querySelector("#noAmount").value, partner: el.querySelector("#noNet").value });
          state.offers = r.offers;
          closeSheet();
          saveLead(lead.id, { offers: { [r.offer.id]: { status: "applied" } } }, `${r.offer.name}: заявка заведена${r.existed ? " (оффер уже был в каталоге)" : ""}`);
        } catch (err) {
          e.target.disabled = false;
          toast(`Ошибка: ${err.message}`);
        }
      };
      el.querySelectorAll("[data-add]").forEach(
        (b) =>
          (b.onclick = () => {
            if (editing) return offerTemplateSheet(b.dataset.add, () => addOfferSheet(lead));
            closeSheet();
            const o = offerById(b.dataset.add);
            saveLead(lead.id, { offers: { [o.id]: { status: "applied" } } }, `${o.name.replace(/ — РКО$/, "")}: заявка заведена`);
          }),
      );
    },
  );
}

async function saveLead(id, patch, okText) {
  try {
    const updated = await api("PATCH", `/leads/${id}`, patch);
    state.leads = state.leads.map((l) => (l.id === id ? updated : l));
    haptic();
    if (okText) toast(okText);
    const scroll = window.scrollY;
    render();
    window.scrollTo(0, scroll);
    return updated;
  } catch (e) {
    toast(`Не сохранилось: ${e.message}`);
    return null;
  }
}

async function deleteLead(id) {
  if (!(await confirmDialog("Удалить лида? Он уйдёт в корзину — вернуть можно в «Ещё» → «Корзина»."))) return;
  try {
    await api("DELETE", `/leads/${id}`);
    state.leads = state.leads.filter((l) => l.id !== id);
    go({ leadId: null });
    toast("Лид в корзине · «Ещё» → «Корзина»");
  } catch (e) {
    toast(`Ошибка: ${e.message}`);
  }
}

// ---------- СТАТИСТИКА: для РОПа ----------
const PERIODS = [
  ["7", "7 дней"],
  ["30", "30 дней"],
  ["month", "Этот месяц"],
  ["all", "Всё время"],
];

function periodRange() {
  const today = todayKey();
  if (state.period === "all") return null;
  if (state.period === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  return { from: addDays(today, -(+state.period - 1)), to: today };
}

// Столбиковая диаграмма: одна серия, тап по столбику — подпись и «Подробнее».
function barChart(id, items, { title, empty = "Пока пусто" } = {}) {
  const max = Math.max(1, ...items.map((d) => d.sum));
  const w = 320, h = 120, gap = items.length > 20 ? 2 : 6;
  const bw = Math.max(2, (w - gap * (items.length - 1)) / items.length);
  const bars = items
    .map((d, i) => {
      const bh = d.sum ? Math.max(3, (d.sum / max) * (h - 4)) : 0;
      const x = i * (bw + gap), y = h - bh, r = Math.min(4, bw / 2, bh);
      const path = bh ? `M${x},${h} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${h} Z` : "";
      return `<g data-chart="${id}" data-i="${i}"><rect x="${x - gap / 2}" y="0" width="${bw + gap}" height="${h}" fill="transparent"/>${path ? `<path d="${path}" class="bar${d.muted ? " muted" : ""}"/>` : ""}</g>`;
    })
    .join("");
  const labels = items.length <= 8
    ? `<div class="chart-x even">${items.map((d) => `<span>${esc(d.label)}</span>`).join("")}</div>`
    : `<div class="chart-x"><span>${esc(items[0].label)}</span><span>${esc(items[items.length - 1].label)}</span></div>`;
  return `<div class="chart">
    ${title ? `<div class="chart-title">${title}</div>` : ""}
    <div class="chart-tip" id="tip-${id}">${items.some((d) => d.sum) ? "Нажми на столбик — покажу сумму и что внутри" : empty}</div>
    <svg viewBox="0 0 ${w} ${h + 1}" preserveAspectRatio="none" role="img" aria-label="${esc(title || "диаграмма")}">${bars}<line x1="0" x2="${w}" y1="${h + 0.5}" y2="${h + 0.5}" class="axis"/></svg>
    ${labels}
  </div>`;
}

// Горизонтальные полосы; строка может открывать окно (act — data-атрибуты).
function hbars(rows, valueText) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<div class="list">${rows
    .map(
      (r) => `<div class="hbar${r.act ? " tap" : ""}" ${r.act || ""}><div class="hbar-top"><span>${esc(r.label)}</span><b>${valueText(r)}${r.act ? " ›" : ""}</b></div>
        <div class="bar-track"><i style="width:${(r.value / max) * 100}%"></i></div>${r.note ? `<div class="sub">${r.note}</div>` : ""}</div>`,
    )
    .join("")}</div>`;
}

const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_FULL = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const monthLabel = (ym) => `${MONTHS_RU[+ym.slice(5, 7) - 1]}${ym.slice(2, 4) !== todayKey().slice(2, 4) ? " " + ym.slice(2, 4) : ""}`;
const prevMonthKey = (ym) => {
  const d = new Date(`${ym}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

// Окно со списком засчётов (месяц, день, оффер) — по тапу в любой диаграмме.
function paidSheet(title, events, about = "") {
  const sum = events.reduce((t, e) => t + e.amount, 0);
  const leadsN = new Set(events.map((e) => e.lead.id)).size;
  openSheet(
    `<h2 class="sheet-title">${esc(title)}</h2>
    <div class="kpis three" style="margin-bottom:10px">
      <div class="kpi"><div class="label">Засчитано</div><div class="value">${rub(sum)}</div></div>
      <div class="kpi"><div class="label">Чистыми ≈</div><div class="value money-green">${rub(netOf(sum, state.settings))}</div></div>
      <div class="kpi"><div class="label">Офферов / лидов</div><div class="value">${events.length} / ${leadsN}</div></div>
    </div>
    ${about ? `<div class="sub" style="margin:0 4px 10px">${about}</div>` : ""}
    ${events.length ? `<div class="list">${events
      .sort((a, b) => (b.day || "").localeCompare(a.day || "") || b.amount - a.amount)
      .map((e) => leadRow(e.lead, `${esc(e.name.replace(/ — РКО$/, ""))}${e.day ? " · " + fmtDate(e.day) : " · из таблицы"}`, `<b class="money-green">${rub(e.amount)}</b>`))
      .join("")}</div>` : `<div class="card empty small">Засчётов нет</div>`}`,
  );
}

// Окно со списком лидов + объяснение, что это за цифра.
function leadsSheet(title, about, rows) {
  openSheet(
    `<h2 class="sheet-title">${esc(title)}</h2>
    <div class="explain">${about}</div>
    ${rows.length ? `<div class="list">${rows.map((r) => leadRow(r.lead, r.sub || "", r.right || "")).join("")}</div>` : `<div class="card empty small">Сейчас здесь пусто</div>`}`,
  );
}

// Что значит каждая плитка с цифрой — и какие лиды за ней стоят.
function explain(key) {
  const w = worklist(state.leads, state.offers);
  const m = (l) => money(l);
  const today = todayKey();
  const paid = paidEvents(state.leads, state.offers);
  const items = {
    week: () => paidSheet("Засчитано за 7 дней", paid.filter((e) => e.day && e.day > addDays(today, -7)), "Офферы, которые получили статус «Засчитано» за последние 7 дней. Засчёты из старой таблицы без даты сюда не попадают."),
    month: () => paidSheet(`${MONTHS_FULL[+today.slice(5, 7) - 1]}: засчитано`, paid.filter((e) => e.day?.startsWith(today.slice(0, 7))), "Всё, что засчитали в этом месяце. План месяца задаётся в «Ещё» → «Налог, партнёр и план»."),
    waiting: () =>
      leadsSheet("Ждём засчёта", "Целевое действие (ЦД) сделали, но партнёрка ещё не засчитала. Если висит больше 5 дней — пиши менеджеру сети. Как засчитают — открой лида и поставь «Засчитано».",
        w.waiting.map((x) => ({ lead: x.lead, sub: esc(x.items.map((i) => i.name.replace(/ — РКО$/, "")).join(", ")), right: `<b>${rub(x.sum)}</b>${x.days ? `<div class="sub ${x.days >= 5 ? "danger" : ""}">${x.days} дн.</div>` : ""}` }))),
    inwork: () =>
      leadsSheet("В работе", "Деньги, которые ещё можно дожать: заявки заведены или счёт открыт, но ЦД пока не сделали. Чем выше сумма — тем важнее лид.",
        state.leads.map((l) => ({ l, v: m(l).inWork })).filter((x) => x.v).sort((a, b) => b.v - a.v).map((x) => ({ lead: x.l, sub: stageBadge(x.l.stage), right: `<b class="money-orange">${rub(x.v)}</b>` }))),
    net: () =>
      leadsSheet("Чистая выручка по лидам", `Чистая = засчитано − налог ${state.settings.taxRate}% − доля ${esc(state.settings.partnerName)} ${state.settings.partnerShare}% − затраты − выплачено лиду. Сверху самые прибыльные.`,
        state.leads.map((l) => ({ l, v: m(l).net })).filter((x) => x.v).sort((a, b) => b.v - a.v).map((x) => ({ lead: x.l, sub: stageBadge(x.l.stage), right: `<b class="money-green">${rub(x.v)}</b>` }))),
    conv: () => {
      const ever = new Set(paid.map((e) => e.lead.id));
      leadsSheet("Лиды без денег", `Из ${state.leads.length} лидов деньги принесли ${ever.size}. Ниже — те, кто ещё не принёс ни одного засчёта: их стоит докрутить или закрыть как «Слился».`,
        state.leads.filter((l) => !ever.has(l.id) && l.stage !== "lost").map((l) => ({ lead: l, sub: stageBadge(l.stage), right: m(l).inWork ? `<span class="money-orange">${rub(m(l).inWork)}</span>` : "" })));
    },
  };
  items[key]?.();
}

function renderStats() {
  const range = periodRange();
  const all = paidEvents(state.leads, state.offers);
  const inRange = range ? all.filter((e) => e.day && e.day >= range.from && e.day <= range.to) : all;
  const undated = all.filter((e) => !e.day);
  const income = inRange.reduce((s, e) => s + e.amount, 0);
  const leadsWithMoney = new Set(inRange.map((e) => e.lead.id));
  const totals = sumMoney(state.leads.map(money));
  const everPaid = new Set(all.map((e) => e.lead.id)).size;
  const today = todayKey();

  // По месяцам — за всё время. «До CRM» — засчёты из таблицы без даты.
  const byMonth = new Map();
  for (const e of all) if (e.day) byMonth.set(e.day.slice(0, 7), (byMonth.get(e.day.slice(0, 7)) || 0) + e.amount);
  const months = [];
  const firstMonth = [...byMonth.keys()].sort()[0] || today.slice(0, 7);
  for (let mth = today.slice(0, 7), guard = 0; mth >= firstMonth && guard < 24; mth = prevMonthKey(mth), guard++) months.unshift(mth);
  while (months.length < 3) months.unshift(prevMonthKey(months[0]));
  const monthItems = months.map((mth) => ({ label: monthLabel(mth), sum: byMonth.get(mth) || 0, key: mth }));
  state._charts = { months: monthItems };

  // По дням — для выбранного периода.
  let dayChart = "";
  if (range) {
    const days = [];
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) days.push({ label: fmtDate(d), sum: 0, key: d });
    for (const e of inRange) {
      const slot = days.find((d) => d.key === e.day);
      if (slot) slot.sum += e.amount;
    }
    state._charts.days = days;
    dayChart = barChart("days", days, { title: "По дням", empty: "За период засчётов нет" });
  }

  // Сравнение месяцев: последние 6.
  const lastMonths = months.slice(-6).reverse();
  const monthRows = lastMonths.map((mth, i) => {
    const v = byMonth.get(mth) || 0;
    const prev = byMonth.get(prevMonthKey(mth)) || 0;
    const delta = prev ? Math.round(((v - prev) / prev) * 100) : null;
    return `<div class="row" data-month="${mth}" role="button"><div class="grow"><div class="title">${MONTHS_FULL[+mth.slice(5, 7) - 1]} ${mth.slice(0, 4)}${i === 0 ? " · сейчас" : ""}</div>
      <div class="sub">${all.filter((e) => e.day?.startsWith(mth)).length} засчётов · чистыми ≈ ${rub(netOf(v, state.settings))}</div></div>
      <div class="right"><b>${rub(v)}</b>${delta !== null ? `<div class="sub ${delta >= 0 ? "up" : "danger"}">${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}%</div>` : ""}</div></div>`;
  });

  // Воронка офферов: сколько дошло до каждого шага (за всё время).
  const RANK = { applied: 1, opened: 2, done: 3, paid: 4 };
  const reached = [0, 0, 0, 0, 0];
  for (const l of state.leads) for (const lo of Object.values(l.offers || {})) for (let r = 1; r <= (RANK[lo.status] || 0); r++) reached[r]++;
  const funnel = [
    { label: "Заявка заведена", value: reached[1] },
    { label: "Счёт открыт", value: reached[2] },
    { label: "ЦД выполнено", value: reached[3] },
    { label: "Засчитано", value: reached[4] },
  ].map((f, i, arr) => ({ ...f, note: i && arr[i - 1].value ? `${Math.round((f.value / arr[i - 1].value) * 100)}% от предыдущего шага` : "" }));

  // Топ офферов с конверсией.
  const byOffer = new Map();
  for (const l of state.leads)
    for (const [id, lo] of Object.entries(l.offers || {})) {
      if (lo.status === "none" || lo.status === "exists") continue;
      const r = byOffer.get(id) || { tried: 0, paid: 0 };
      r.tried++;
      if (lo.status === "paid") r.paid++;
      byOffer.set(id, r);
    }
  const offerAgg = new Map();
  for (const e of inRange) {
    const r = offerAgg.get(e.offerId) || { label: e.name.replace(/ — РКО$/, ""), value: 0, n: 0, id: e.offerId };
    r.value += e.amount;
    r.n++;
    offerAgg.set(e.offerId, r);
  }
  const topOffers = [...offerAgg.values()].sort((a, b) => b.value - a.value).slice(0, 8).map((r) => {
    const c = byOffer.get(r.id);
    return { ...r, act: `data-offerstat="${r.id}"`, note: c?.tried ? `конверсия ${Math.round((c.paid / c.tried) * 100)}%: засчитано ${c.paid} из ${c.tried} попыток` : "" };
  });

  const group = (keyOf) => {
    const mp = new Map();
    for (const e of inRange) {
      const k = keyOf(e) || "Не указано";
      mp.set(k, (mp.get(k) || 0) + e.amount);
    }
    return [...mp].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };
  const byPartner = group((e) => e.partner).map((r) => ({ ...r, act: isAdmin() ? `data-netgo="${esc(r.label)}"` : "" }));
  const bySource = group((e) => e.lead.source);
  const counts = Object.fromEntries(Object.keys(STAGE_LABELS).map((st) => [st, 0]));
  state.leads.forEach((l) => (counts[l.stage] = (counts[l.stage] || 0) + 1));

  $app.innerHTML = `
    <div class="title-row"><h1>Статистика</h1><button class="link" data-help="stats">Что тут? ›</button></div>
    <div class="chips">${PERIODS.map(([p, label]) => `<button class="chip ${state.period === p ? "active" : ""}" data-period="${p}">${label}</button>`).join("")}</div>

    <div class="kpis">
      <div class="kpi accent tap" data-paidrange="1"><div class="label">Засчитано ›</div><div class="value">${rub(income)}</div><div class="hint">${inRange.length} ${plural(inRange.length, "оффер", "оффера", "офферов")}</div></div>
      <div class="kpi tap" data-explain="net"><div class="label">Чистыми ≈ ›</div><div class="value money-green">${rub(range ? netOf(income, state.settings) : totals.net)}</div><div class="hint">${range ? "после налога и доли, до затрат" : "после всех вычетов"}</div></div>
      <div class="kpi"><div class="label">Средний чек лида</div><div class="value">${rub(leadsWithMoney.size ? income / leadsWithMoney.size : 0)}</div><div class="hint">${leadsWithMoney.size} ${plural(leadsWithMoney.size, "лид принёс", "лида принесли", "лидов принесли")} деньги</div></div>
      <div class="kpi tap" data-explain="conv"><div class="label">Лид → деньги ›</div><div class="value">${state.leads.length ? Math.round((everPaid / state.leads.length) * 100) : 0}%</div><div class="hint">${everPaid} из ${state.leads.length} за всё время</div></div>
    </div>

    ${(() => {
      const dirs = directionStats(state.leads, state.offers, state.expenses || [], range).filter((d) => d.tried || d.costs || d.general);
      if (!dirs.length) return "";
      return `<h2>По направлениям</h2>
        <div class="list">${dirs
          .map((d) => `<div class="row" data-dirgo="${d.key}" role="button"><div class="grow"><div class="title">${esc(d.label)}</div>
            <div class="sub">засчитано ${d.paid} из ${d.tried} · конверсия ${d.tried ? Math.round((d.paid / d.tried) * 100) : 0}%${d.costs || d.general ? ` · расходы ${rub(d.costs + d.general)}` : ""}</div></div>
            <div class="right"><b>${rub(d.income)}</b>${d.costs || d.general ? `<div class="sub">после расходов ${short(d.net)}</div>` : ""}</div></div>`)
          .join("")}</div>`;
    })()}
    ${isAdmin() ? `<div class="list" style="margin-top:8px">
      <button class="row" data-gomore="expenses"><div class="icon">💸</div><div class="grow"><div class="title">Расходы</div><div class="sub">затраты на ЦД по направлениям, трафик, сервисы</div></div><div class="right sub">›</div></button>
      <button class="row" data-gomore="sources"><div class="icon">📣</div><div class="grow"><div class="title">Источники</div><div class="sub">какой канал приводит лидов, которые платят</div></div><div class="right sub">›</div></button>
    </div>` : ""}

    <h2>История по месяцам</h2>
    ${barChart("months", monthItems, { title: "Засчитано по месяцам — за всё время" })}
    <div class="list" style="margin-top:8px">${monthRows.join("")}</div>
    ${undated.length ? `<div class="list" style="margin-top:8px"><div class="row" id="undated" role="button"><div class="grow"><div class="title">До CRM · из таблицы</div><div class="sub">${undated.length} засчётов без даты — в месяцы не попадают</div></div><div class="right"><b>${rub(undated.reduce((t, e) => t + e.amount, 0))}</b> ›</div></div></div>` : ""}

    ${dayChart}

    <h2>Воронка офферов · за всё время</h2>
    <div class="sub note" style="margin-top:-4px">Сколько офферов дошло до каждого шага. Где процент маленький — там теряются деньги.</div>
    ${hbars(funnel, (r) => String(r.value))}

    ${topOffers.length ? `<h2>Топ офферов</h2>${hbars(topOffers, (r) => `${rub(r.value)} · ${r.n}×`)}` : `<h2>Топ офферов</h2><div class="card empty small">За этот период засчётов нет — выбери «Всё время»</div>`}
    ${byPartner.length ? `<h2>Партнёрские сети</h2>${hbars(byPartner, (r) => rub(r.value))}` : ""}
    ${bySource.length > 1 || (bySource[0] && bySource[0].label !== "Не указано") ? `<h2>Источники лидов</h2>${hbars(bySource, (r) => rub(r.value))}` : ""}

    <h2>Этапы лидов · ${state.leads.length}</h2>
    ${hbars(Object.entries(counts).map(([st, n]) => ({ label: STAGE_LABELS[st], value: n, act: `data-stagego="${st}"` })), (r) => String(r.value))}

    <h2>Отчётный лист · всё время</h2>
    ${reportRows(totals)}
    ${(state.expenses || []).length ? (() => {
      const gen = state.expenses.reduce((t, e) => t + e.amount, 0);
      return `<div class="list" style="margin-top:8px"><div class="row" data-gomore="expenses" role="button"><div class="grow">Общие расходы (трафик, сервисы…)</div><div class="right">−${rub(gen)}</div></div>
        <div class="row total"><div class="grow">Чистая после общих расходов</div><div class="right">${rub(totals.net - gen)}</div></div></div>`;
    })() : ""}
    ${isAdmin() && state.ledger ? ledgerBlock(totals) : ""}`;

  $app.querySelectorAll("[data-period]").forEach((b) => (b.onclick = () => go({ period: b.dataset.period })));
  $app.querySelector("[data-paidrange]").onclick = () => paidSheet(`Засчитано · ${PERIODS.find((p) => p[0] === state.period)[1]}`, inRange);
  document.getElementById("undated")?.addEventListener("click", () => paidSheet("До CRM (из таблицы)", undated, "Засчёты, перенесённые из Google-таблицы. Даты засчёта у них нет, поэтому в помесячной истории их не видно."));
  $app.querySelectorAll("[data-month]").forEach((r) => (r.onclick = () => paidSheet(`${MONTHS_FULL[+r.dataset.month.slice(5, 7) - 1]} ${r.dataset.month.slice(0, 4)}`, all.filter((e) => e.day?.startsWith(r.dataset.month)))));
  $app.querySelectorAll("[data-offerstat]").forEach((r) => (r.onclick = () => paidSheet(`${offerById(r.dataset.offerstat)?.name || ""}`, inRange.filter((e) => e.offerId === r.dataset.offerstat))));
  $app.querySelectorAll("[data-netgo]").forEach((r) => (r.onclick = () => go({ tab: "more", more: "payouts", network: r.dataset.netgo })));
  $app.querySelectorAll("[data-stagego]").forEach((r) => (r.onclick = () => go({ tab: "leads", filter: r.dataset.stagego, query: "" })));
  $app.querySelectorAll("[data-dirgo]").forEach((r) => (r.onclick = () => {
    const key = r.dataset.dirgo;
    const ev = inRange.filter((e) => (key === "all" ? !["rko", "mfo", "debit", "credit"].includes(e.category) : e.category === key));
    paidSheet(`${DIR_LABELS[key]} · засчитано`, ev, "Засчитанные офферы этого направления за выбранный период.");
  }));
  bindCharts(all);
  document.getElementById("ledgerEdit")?.addEventListener("click", () => ledgerSheet(totals));
}

// Тап по столбику: подпись + «Подробнее».
function bindCharts(all) {
  $app.querySelectorAll("[data-chart]").forEach(
    (g) =>
      (g.onclick = () => {
        const id = g.dataset.chart;
        const d = state._charts[id][+g.dataset.i];
        $app.querySelectorAll(`[data-chart="${id}"] .bar.sel`).forEach((x) => x.classList.remove("sel"));
        g.querySelector(".bar")?.classList.add("sel");
        const events = d.key === "undated" ? all.filter((e) => !e.day) : all.filter((e) => e.day?.startsWith(d.key));
        const tip = document.getElementById(`tip-${id}`);
        tip.innerHTML = `<b>${esc(d.label)}: ${rub(d.sum)}</b> · ${events.length} засч. <button class="link" id="tipMore-${id}">Подробнее ›</button>`;
        document.getElementById(`tipMore-${id}`).onclick = () => paidSheet(d.key === "undated" ? "До CRM (из таблицы)" : d.key.length === 7 ? `${MONTHS_FULL[+d.key.slice(5, 7) - 1]} ${d.key.slice(0, 4)}` : fmtDate(d.key), events);
      }),
  );
}

// ---------- КАК ПОЛЬЗОВАТЬСЯ ----------
const HELP_TEXT = {
  start: `<h3>С чего начать</h3>
    <p><b>1. Завести лида.</b> Кнопка <b>＋</b> на экране «Сегодня» или «Лиды». Ещё проще — переслать сообщение человека боту: лид создастся сам.</p>
    <p><b>2. Добавить офферы.</b> В карточке лида — «＋ Оффер», выбери банк или МФО. Нет нужного — «Новый оффер».</p>
    <p><b>3. Двигать статусы.</b> Нажми на оффер → выбери шаг. Деньги, этапы и статистика посчитаются сами.</p>
    <p><b>4. Каждое утро</b> открывай «Сегодня»: там список, кому что сделать. В 9:00 то же самое приходит в бот.</p>
    <h3>Шаги оффера</h3>
    <p><span class="pill st-applied">Заявка</span> — человек подал заявку в банк/МФО.</p>
    <p><span class="pill st-opened">Нужна ЦД</span> — счёт открыт, но целевое действие (пополнение, оплата) ещё не сделано.</p>
    <p><span class="pill st-done">Ждём засчёта</span> — ЦД сделали, ждём, когда партнёрка засчитает.</p>
    <p><span class="pill st-paid">Засчитано</span> — деньги наши. Идут в доход и статистику.</p>
    <p><span class="pill st-rejected">Отказ</span> / <span class="pill st-exists">Уже есть</span> — денег не будет, оффер уходит в «Отказы и дубли».</p>
    <h3>Как считаются деньги</h3>
    <p>Чистая = засчитано − налог ${state.settings?.taxRate ?? 7}% − доля ${esc(state.settings?.partnerName || "партнёра")} ${state.settings?.partnerShare ?? 20}% − затраты − выплачено лиду.</p>
    <h3>Подсказка</h3>
    <p>Почти всё нажимается: плитки с цифрами, столбики графиков, строки статистики — откроется список лидов и пояснение.</p>`,
  stats: `<h3>Статистика</h3>
    <p><b>Период</b> сверху меняет плитки, «По дням» и топ офферов. «История по месяцам» — всегда за всё время.</p>
    <p><b>до CRM</b> — засчёты из старой таблицы: даты у них нет, поэтому они отдельным серым столбиком.</p>
    <p><b>Воронка офферов</b> — сколько офферов дошло до каждого шага. Маленький процент на шаге — там теряются деньги: например, счета открывают, а ЦД не делают.</p>
    <p><b>Конверсия оффера</b> — из скольких попыток засчитали. Помогает понять, какие банки давать первыми.</p>
    <p>Нажми на месяц, столбик, оффер, сеть или этап — откроется список.</p>`,
  bot: `<h3>Бот</h3>
    <p>Внизу чата с ботом — меню кнопок: Сводка, Цифры, Напоминания, Найти лида, Завести лида.</p>
    <p><b>Перешли</b> боту сообщение человека — создастся лид. <b>Напиши имя или ник</b> — пришлю карточку с кнопками: открыть, написать, напомнить, отметить ЦД/засчёт.</p>
    <p><b>Напоминание:</b> «напомни завтра в 12 сделать ЦД с @nick» — время московское.</p>`,
};

function helpSheet(key = "start") {
  if (ACADEMY) return guideOverlay(0);
  openSheet(`<h2 class="sheet-title">Как пользоваться</h2>
    <div class="chips tight" style="margin-bottom:8px">${[["start", "Основное"], ["stats", "Статистика"], ["bot", "Бот"]].map(([k, l]) => `<button class="chip ${k === key ? "active" : ""}" data-helptab="${k}">${l}</button>`).join("")}</div>
    <div class="card help">${HELP_TEXT[key]}</div>`, (el) => el.querySelectorAll("[data-helptab]").forEach((b) => (b.onclick = () => helpSheet(b.dataset.helptab))), { instant: !!document.querySelector(".sheet-wrap") });
}

// ---------- ЕЩЁ ----------
function renderMore() {
  if (state.more === "offers") return renderOffers();
  if (state.more === "settings") return renderSettings();
  if (state.more === "team") return renderTeam();
  if (state.more === "data") return renderData();
  if (state.more === "templates") return renderTemplates();
  if (state.more === "payouts") return state.network ? renderNetwork() : renderPayouts();
  if (state.more === "bot") return renderBot();
  if (state.more === "students") return renderStudents();
  if (state.more === "theme") return renderTheme();
  if (state.more === "profile") return renderProfile();
  if (state.more === "trash") return renderTrash();
  if (state.more === "expenses") return renderExpenses();
  if (state.more === "sources") return renderSources();
  const admin = isAdmin();
  const s = state.settings;
  const debt = admin ? networkReport(state.leads, state.offers, state.payouts).reduce((t, n) => t + n.debt, 0) : 0;
  const costs = sumMoney(state.leads.map(money)).costs + (state.expenses || []).reduce((t, e) => t + e.amount, 0);
  const sources = new Set(state.leads.map((l) => (l.source || "").trim()).filter(Boolean)).size;
  const groups = [
    state.me?.mentor && ["Наставник", [["students", "🎓", "Ученики", "Рейтинг, цифры каждого, ссылки-приглашения"]]],
    admin && [
      "Деньги",
      [
        ["expenses", "💸", "Расходы", costs ? `Всего ${rub(costs)} · затраты на ЦД и общие расходы` : "Затраты на ЦД по РКО, МФО, картам + трафик и сервисы"],
        ["sources", "📣", "Источники", sources ? `${sources} ${plural(sources, "источник", "источника", "источников")} · какой приносит деньги` : "Откуда приходят лиды и какой канал окупается"],
        ["payouts", "🏦", "Выплаты от сетей", debt ? `Не доплатили: ${rub(debt)}` : "Сверка засчитанного с пришедшими деньгами"],
        ["settings", "🧮", "Налог, партнёр и план", `${s.partnerShare ? `${s.partnerName} ${s.partnerShare}% · ` : ""}налог ${s.taxRate}%${s.monthlyGoal ? ` · план ${rub(s.monthlyGoal)}` : " · план не задан"}`],
      ],
    ],
    [
      "Работа",
      [
        ["offers", "🏦", "Офферы и ставки", admin ? "Каталог банков, МФО и карт" : "Каталог банков и МФО (просмотр)"],
        admin && ["templates", "💬", "Шаблоны сообщений", `${(s.templates || []).length} шт. — копируются в один тап из карточки лида`],
        admin && !ACADEMY && ["bot", "🤖", "Лиды через бота", "Пересылай боту сообщение или контакт — лид создастся сам"],
      ],
    ],
    admin && [
      "Данные",
      [
        ["data", "📊", "Excel и бэкап", ACADEMY && state.member ? `Excel в Telegram · автовыгрузка: ${{ 0: "выключена", 1: "каждый день", 3: "раз в 3 дня", 7: "раз в неделю" }[state.member.exportEvery] || "раз в 3 дня"}` : "Excel со всеми лидами в Telegram, импорт"],
        ["trash", "🗑", "Корзина", "Удалённые лиды — можно вернуть"],
      ],
    ],
    [
      ACADEMY ? "Аккаунт" : "Прочее",
      [
        ACADEMY && state.member && ["profile", "👤", "Профиль", state.member.name],
        ACADEMY && ["theme", "🎨", "Оформление", THEMES[currentTheme()]?.name || ""],
        ACADEMY ? ["help", "📘", "Инструкция", "Как работать в CRM — пошагово, с нуля"] : ["help", "📘", "Как пользоваться", "Шаги офферов, деньги, бот — простыми словами"],
        admin && !ACADEMY && ["team", "👥", "Команда", "Кто имеет доступ"],
      ],
    ],
  ].filter(Boolean);
  $app.innerHTML = `
    <h1>Ещё</h1>
    ${groups
      .map(([title, items]) => `<h2>${title}</h2><div class="list">${items
        .filter(Boolean)
        .map(([k, icon, t, sub]) => `<button class="row" data-more="${k}"><div class="icon">${icon}</div><div class="grow"><div class="title">${t}</div><div class="sub">${esc(sub)}</div></div><div class="right sub">›</div></button>`)
        .join("")}</div>`)
      .join("")}
    ${ACADEMY ? brandFoot() : `<div class="sub center">Утренняя сводка приходит в бота каждый день в 9:00 по Москве.<br>По понедельникам админам — ещё и бэкап.</div>`}`;
  $app.querySelectorAll("[data-more]").forEach((b) => (b.onclick = () => (b.dataset.more === "help" ? helpSheet() : go({ more: b.dataset.more }))));
}

// ---------- RYZHIKOV ACADEMY: темы, бренд, инструкция ----------
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const THEMES = {
  red: { name: "Чёрно-красная", bg: "#0a0a0d", sw: "linear-gradient(135deg,#7a0a10,#e3262e)" },
  blue: { name: "Чёрно-синяя", bg: "#0a0a0d", sw: "linear-gradient(135deg,#0c2273,#2f6bff)" },
  gold: { name: "Чёрно-золотая", bg: "#0a0a0d", sw: "linear-gradient(135deg,#5c4304,#d9a520)" },
  light: { name: "Светлая (как Telegram)", bg: null, sw: "linear-gradient(135deg,#e9eef7,#2481cc)" },
};
function applyTheme(t) {
  if (!THEMES[t]) t = "red";
  const root = document.documentElement;
  root.classList.toggle("dark", t !== "light");
  if (t === "light") delete root.dataset.theme;
  else root.dataset.theme = t;
  safe(() => {
    const c = THEMES[t].bg || tg?.themeParams?.secondary_bg_color || "#f2f2f7";
    tg?.setHeaderColor?.(c);
    tg?.setBackgroundColor?.(c);
    tg?.setBottomBarColor?.(c);
  });
}
const currentTheme = () => store.get("theme") || "red";
if (ACADEMY) applyTheme(currentTheme());

const brandBar = () =>
  ACADEMY ? `<div class="brand"><div class="brand-mark">RYZHIKOV <b>ACADEMY</b></div><div class="brand-tag">🔒 Приватный доступ</div></div>` : "";
const brandFoot = () =>
  `<div class="brand-foot"><b>RYZHIKOV ACADEMY</b><br>CRM — бонус для учеников академии.<br>Вход только по личному коду, доступ приватный.</div>`;

function renderTheme() {
  $app.innerHTML = `
    <h1>Оформление</h1>
    <div class="sub" style="margin:0 4px 12px">Выбери цвет CRM. Сохраняется на этом устройстве.</div>
    <div class="themes">${Object.entries(THEMES)
      .map(([k, t]) => `<button class="theme-tile ${currentTheme() === k ? "active" : ""}" data-theme-pick="${k}"><div class="sw" style="background:${t.sw}"></div><div class="nm">${currentTheme() === k ? "● " : ""}${t.name}</div></button>`)
      .join("")}</div>
    ${brandFoot()}`;
  $app.querySelectorAll("[data-theme-pick]").forEach((b) => (b.onclick = () => {
    store.set("theme", b.dataset.themePick);
    applyTheme(b.dataset.themePick);
    haptic("light");
    renderTheme();
  }));
}

// Большая инструкция: показывается при первом входе, потом — из «Ещё → Инструкция» и кнопки «?».
const GUIDE = () => {
  const s = state.settings || {};
  return [
    {
      icon: "🎓",
      title: "Добро пожаловать в CRM Ryzhikov Academy",
      html: `<p>Это твоя рабочая система по РКО, МФО и картам. Не табличка, не заметки в телефоне, а <b>пульт управления деньгами</b>: каждый лид, каждый оффер, каждый рубль — на виду.</p>
        <p>Те, кто делает 200–500к в месяц, отличаются от остальных не «секретной связкой». Они просто <b>не теряют людей</b>: знают, кому сегодня написать, у кого висит ЦД, с кого сеть ещё не заплатила. Эта CRM делает ровно это.</p>
        <div class="tip">🔒 <b>Доступ приватный.</b> CRM — бонус для учеников Ryzhikov Academy, вход только по личному коду. Твоих лидов не видит никто: ни другие ученики, ни мы.</div>
        <p>Дальше — 2 минуты, как тут всё устроено. Пролистай до конца, потом сможешь открыть эту инструкцию в любой момент: <b>«Ещё» → «Инструкция»</b> или кнопка <b>?</b> на главном экране.</p>`,
    },
    {
      icon: "🧭",
      title: "4 вкладки — вся система",
      html: `<ul>
          <li><b>☀️ Сегодня</b> — твой план на день. Что горит, кому написать, кого дожать. Открываешь каждое утро.</li>
          <li><b>👥 Лиды</b> — все твои люди: поиск, фильтры, теги. Нажал на человека — открылась его карточка.</li>
          <li><b>📊 Статистика</b> — твой дашборд: сколько засчитали, по месяцам, по направлениям (РКО, МФО, дебетовые, кредитные), какие офферы дают деньги, где теряешь людей.</li>
          <li><b>⋯ Ещё</b> — разделы по полочкам:
            <br>· <b>Деньги</b>: 💸 Расходы, 📣 Источники, 🏦 Выплаты от сетей, 🧮 Налог, партнёр и план
            <br>· <b>Работа</b>: 🏦 Офферы и ставки, 💬 Шаблоны сообщений
            <br>· <b>Данные</b>: 📊 Excel и бэкап, 🗑 Корзина
            <br>· <b>Аккаунт</b>: 👤 Профиль, 🎨 Оформление, 📘 Эта инструкция</li>
        </ul>
        <div class="tip">💡 Почти всё нажимается: плитки с цифрами, столбики графиков, строки статистики. Нажми — увидишь, из каких лидов сложилась цифра.</div>`,
    },
    {
      icon: "➕",
      title: "Шаг 1. Заведи лида",
      html: `<p>Кнопка <b>＋</b> на «Сегодня» или в «Лидах».</p>
        <ul>
          <li><b>Telegram-ник</b> — главное поле. По нему потом в один тап пишешь человеку.</li>
          <li><b>ФИО и телефон</b> — по желанию. Не хочешь хранить чужие телефоны — не храни, работать можно и по нику.</li>
          <li><b>Откуда пришёл</b> — YouTube, Reels, сарафан, партнёр. Потом в статистике увидишь, какой источник даёт деньги, а какой — пустых людей.</li>
          <li><b>На что крутить</b> — теги <b>ИП, МФО, РКО, ДК, КК</b>. Сразу помечаешь, что этому человеку предлагать. Теги видны в списке, по ним есть фильтр.</li>
        </ul>
        <div class="tip">⚡ Правило: <b>человек написал — сразу в CRM.</b> Не «потом занесу». Потом ты его забудешь, а это минус 15–60к.</div>`,
    },
    {
      icon: "🏦",
      title: "Шаг 2. Добавь офферы",
      html: `<p>В карточке лида — <b>«＋ Оффер»</b>. Нажал на банк или МФО — заявка заведена.</p>
        <ul>
          <li>Ставки в каталоге — <b>актуальные ставки академии</b>, они обновляются сами.</li>
          <li>У тебя другая ставка или сеть? Открой оффер у лида, поменяй — и нажми <b>«📌 Сделать шаблоном»</b>, чтобы новым лидам подставлялось уже твоё.</li>
          <li>Поправить шаблон заранее: «＋ Оффер» → <b>«✏️ Править шаблоны»</b> → тап по офферу.</li>
          <li>Нужного банка нет — <b>«＋ Новый оффер»</b>, он попадёт в твой каталог.</li>
        </ul>
        <p>В окне оффера заполняй: <b>ставку</b>, <b>затраты</b> (комиссия, тариф, маскировка — кнопки +20, +50, +100…), <b>партнёрскую сеть</b>, <b>комментарий</b> и <b>срок</b>, когда к офферу вернуться.</p>
        <div class="tip">💰 Один человек — это не один банк. Смысл в том, чтобы провести его по цепочке: ИП → РКО → карты → МФО. С одного лида можно сделать не 15к, а 60–130к.</div>`,
    },
    {
      icon: "🔄",
      title: "Шаг 3. Двигай статусы",
      html: `<p>Нажал на оффер → выбрал, что произошло. Всё остальное CRM посчитает сама.</p>
        <p class="step-k">РКО</p>
        <ul>
          <li><b>Заявка заведена</b> → <b>Счёт открыт · нужна ЦД</b> → <b>ЦД выполнено · ждём засчёта</b> → <b>Засчитано</b></li>
        </ul>
        <p class="step-k">Дебетовые и кредитные карты</p>
        <ul>
          <li><b>Заявка заведена</b> → <b>Карта оформлена</b> → <b>ЦД выполнено</b> → <b>Засчитано</b></li>
        </ul>
        <p class="step-k">МФО</p>
        <ul>
          <li><b>Маскировка</b> — процесс идёт, деньги ещё не на карте.</li>
          <li><b>Деньги на карте (Не засчитано)</b> — займ выдан, ждём засчёта от сети.</li>
          <li><b>Деньги на карте (Засчитано)</b> — сеть засчитала, но деньги ещё у лида. Такие лиды висят на «Сегодня» отдельным блоком, пока не закроешь.</li>
          <li><b>Засчитано</b> — всё, деньги твои.</li>
        </ul>
        <p><b>Отказ</b> и <b>Уже есть / дубль</b> — денег не будет, оффер уходит вниз карточки, чтобы не мешал.</p>
        <div class="tip">✅ Отмечай статус <b>в момент, когда это случилось.</b> Тогда цифры честные, а «Сегодня» показывает реальные задачи.</div>`,
    },
    {
      icon: "👤",
      title: "Карточка лида",
      html: `<ul>
          <li><b>✉️ Написать</b> — сразу открывает чат с человеком в Telegram.</li>
          <li><b>💬 Шаблоны</b> — готовые сообщения: тап — текст скопирован, чат открыт. Свои шаблоны настраиваешь в «Ещё».</li>
          <li><b>💵 Выплата</b> — если отдаёшь лиду часть денег, отмечай здесь: вычтется из твоей чистой прибыли.</li>
          <li><b>Этап</b>: Новый → В работе → Докрутка → Цикл закрыт / Слился. Частично двигается сам: взял первый оффер — «В работе», первый засчёт — «Докрутка».</li>
          <li><b>Следующий шаг + напоминание</b> — пишешь, что сделать («скинуть ссылку на ВТБ»), выбираешь день. В этот день лид всплывёт на «Сегодня».</li>
          <li><b>История</b> внизу — кто, что и когда менял. Никаких «а я вроде отмечал».</li>
        </ul>`,
    },
    {
      icon: "☀️",
      title: "«Сегодня» — открывай каждое утро",
      html: `<p>Сверху — сколько засчитано в этом месяце и прогресс к плану. План ставится в «Ещё» → «Налог, партнёр и план», и CRM считает, сколько нужно делать в день, чтобы успеть.</p>
        <p>Ниже — блоки задач, самые важные сверху:</p>
        <ul>
          <li><b>⏰ Сроки по офферам</b> — конец маскировки, отчёт банка, встреча.</li>
          <li><b>🔔 Напоминания</b> — твои «следующие шаги» на сегодня и просроченные.</li>
          <li><b>Нужна ЦД</b> — счёт или карта есть, целевого действия нет. Здесь лежат деньги, которые проще всего забрать.</li>
          <li><b>Ждут засчёта</b> — ЦД сделали, сеть молчит. Долго висит — пиши в сеть.</li>
          <li><b>💳 МФО: деньги ещё на карте</b> — засчитано, но деньги у лида.</li>
          <li><b>🐢 Без движения 5+ дней</b> — лиды, которые остывают. Пни их сегодня, завтра будет поздно.</li>
        </ul>
        <div class="tip">⚡ Кнопки прямо в списке — <b>«ЦД ✓»</b>, <b>«Засчитано ✓»</b> — переводят оффер на следующий шаг в один тап, без открытия карточки.</div>`,
    },
    {
      icon: "👥",
      title: "«Лиды» — найти любого за секунду",
      html: `<ul>
          <li><b>Поиск</b> — по нику, имени, телефону, источнику.</li>
          <li><b>Фильтры</b> — «Нужна ЦД», «Ждут засчёта», «Новые», «В работе»… Можно выбрать <b>несколько сразу</b>: нажал «В работе» и «Докрутка» — видишь и тех, и других. «Все» — сбросить.</li>
          <li><b>Теги</b> — показать только МФО-лидов, только КК и т.д.</li>
          <li><b>🏦 Фильтр по офферу</b> — например, «Озон — ещё не делали»: список активных лидов, кому можно предложить Озон прямо сейчас. Это готовый план докрутки.</li>
          <li><b>Сортировка</b> — больше денег в работе, давно не трогали, больше заработали.</li>
        </ul>
        <p>Лиды в <b>«Цикл закрыт»</b> и <b>«Слился»</b> уходят вниз в свёрнутые блоки, чтобы не мешали работать с живыми.</p>`,
    },
    {
      icon: "💰",
      title: "Как считаются твои деньги",
      html: `<p><b>Чистая прибыль</b> = засчитано − налог ${s.taxRate ?? 6}% − доля партнёра ${s.partnerShare ?? 0}% − затраты − выплаты лидам.</p>
        <ul>
          <li><b>Налог</b> — по умолчанию 6% (самозанятый, доход от юрлиц). Другая ставка — поменяй в «Ещё» → «Налог, партнёр и план».</li>
          <li><b>Партнёр</b> — работаешь в паре и делишь доход? Укажи его имя и процент, CRM сама посчитает его долю.</li>
          <li><b>Затраты</b> — комиссии, тарифы, маскировка. Вносишь в окне оффера.</li>
          <li><b>В работе</b> — сколько денег можно получить с открытых заявок и счетов. Это твой потенциал: его надо дожимать.</li>
          <li><b>Ждём засчёта</b> — ЦД сделано, деньги на подходе.</li>
        </ul>
        <div class="tip">📈 Цифра «В работе» важнее, чем кажется. Если она большая, а засчитано мало — ты заводишь людей, но не доводишь до ЦД. Лечится блоком «Нужна ЦД» каждое утро.</div>`,
    },
    {
      icon: "💸",
      title: "Расходы и источники",
      html: `<p>Заработать — полдела. Надо понимать, <b>сколько ушло</b> и <b>какой канал окупается</b>.</p>
        <p class="step-k">💸 Расходы («Ещё» → «Расходы»)</p>
        <ul>
          <li><b>Затраты на ЦД</b> — комиссии, тарифы, маскировка, пополнения. Вносишь прямо в оффере у лида (поле «Затраты», кнопки +20 / +50 / +100). Сюда они попадают сами — разложенные <b>по направлениям: РКО, МФО, дебетовые, кредитные</b>.</li>
          <li><b>Общие расходы</b> — то, что не привязано к одному лиду: трафик и реклама, сервисы и связь, команда и рефералы. Кнопка «＋ Расход»: сумма, дата, на что, направление, источник. Ошибся — нажми на расход и поправь или удали.</li>
          <li>Сверху — сколько потрачено всего, какой процент от засчитанного съели расходы и сколько осталось.</li>
        </ul>
        <p class="step-k">📣 Источники («Ещё» → «Источники»)</p>
        <ul>
          <li>По каждому каналу (YouTube, Reels, сарафан, партнёр…): сколько лидов пришло, сколько из них принесли деньги, сколько потрачено и <b>ROI</b>.</li>
          <li>Источник берётся из поля «Откуда пришёл» у лида. Не заполняешь — не узнаешь, куда вкладывать время и деньги.</li>
          <li>Указал источник у общего расхода (например, закуп рекламы в канале) — он вычтется именно из этого канала.</li>
        </ul>
        <div class="tip">📌 Правило: раз в неделю открой «Источники». Канал с отрицательным ROI — режь. Канал, где лид приносит больше всего, — масштабируй.</div>`,
    },
    {
      icon: "📊",
      title: "Статистика и сверка денег",
      html: `<ul>
          <li><b>Период</b> сверху: 7 дней, 30 дней, месяц, всё время.</li>
          <li><b>По направлениям</b> — РКО, МФО, дебетовые и кредитные карты: сколько засчитано, конверсия из попыток в засчёт и сколько осталось после расходов. Сразу видно, какое направление кормит, а какое только жрёт время.</li>
          <li><b>История по месяцам</b> — график засчитанного. Нажми на месяц — увидишь, из чего он сложился.</li>
          <li><b>Воронка офферов</b> — сколько дошло до каждого шага. Где процент проседает — там теряешь деньги.</li>
          <li><b>Топ офферов, сети, источники</b> — что реально приносит, а что только отнимает время.</li>
          <li><b>Отчётный лист и «Факт · что уже выплачено»</b> — впиши, сколько реально пришло от сетей и сколько ушло на налог, партнёра, лидам. Увидишь, сколько <b>реально на руках</b> и сколько ещё должны тебе.</li>
        </ul>
        <p><b>«Ещё» → «Выплаты от сетей»</b> — сверка: засчитано vs реально пришло. Пришёл платёж — отмечаешь, какие офферы он закрыл, и сразу видно, кто тебе не доплатил.</p>`,
    },
    {
      icon: "🔒",
      title: "Приватность и безопасность",
      html: `<ul>
          <li><b>Твоих лидов видишь только ты.</b> Ни другие ученики, ни наставник не видят ники, имена и офферы твоих людей.</li>
          <li>Наставник видит только <b>твои общие цифры</b>: сколько у тебя лидов и сколько засчитано за месяц. Это нужно, чтобы видеть твой прогресс и помогать, когда ты встал.</li>
          <li>Телефоны и ФИО — <b>по желанию</b>. Для работы хватает ника.</li>
          <li><b>Excel со всеми лидами</b> — бот сам присылает его раз в 3 дня утром (если что-то менялось). Частота — в «Ещё» → «Бэкап и выгрузка», а прямо сейчас — команда <b>/excel</b> в боте.</li>
          <li><b>Удалил лида по ошибке?</b> Он не пропал: «Ещё» → «🗑 Корзина» → «Вернуть». Со всеми офферами и историей.</li>
          <li><b>Ошибся статусом?</b> Просто нажми правильный — всё пересчитается. Ставку, затраты, сеть, этап, теги — всё можно поменять в любой момент.</li>
          <li>Вход — через Telegram, без паролей. Твой личный код больше ни у кого не сработает.</li>
        </ul>`,
    },
    {
      icon: "🔥",
      title: "Правила, по которым CRM приносит деньги",
      html: `<ul>
          <li><b>1. Каждый лид — сразу в CRM.</b> Без исключений.</li>
          <li><b>2. Статус — в момент события.</b> Открыл счёт — отметил. Сделал ЦД — отметил.</li>
          <li><b>3. Утро начинается с «Сегодня».</b> 10 минут — и ты знаешь, где сегодня деньги.</li>
          <li><b>4. У каждого живого лида есть следующий шаг.</b> Нет шага — лид умирает.</li>
          <li><b>5. Раз в неделю — фильтр по офферу.</b> Кому ещё не предлагал Озон, ВТБ, карты. Это бесплатные деньги из твоей же базы.</li>
          <li><b>6. Раз в месяц — сверка с сетями.</b> Не дай им «забыть» тебе заплатить.</li>
        </ul>
        <div class="tip">Деньги не в том, сколько людей ты привёл. Деньги в том, скольких ты <b>довёл</b>. Погнали. 🚀</div>
        ${brandFoot()}`,
    },
  ];
};

function guideOverlay(i = 0) {
  document.querySelector(".guide")?.remove();
  const steps = GUIDE();
  i = Math.max(0, Math.min(i, steps.length - 1));
  const s = steps[i];
  const last = i === steps.length - 1;
  const el = document.createElement("div");
  el.className = "guide";
  el.innerHTML = `
    <div class="guide-top">
      <div class="brand" style="margin:0"><div class="brand-mark">RYZHIKOV <b>ACADEMY</b></div><button class="link" data-gclose>${last ? "" : "Пропустить"}</button></div>
      <div class="guide-bar">${steps.map((_, k) => `<i class="${k <= i ? "on" : ""}"></i>`).join("")}</div>
    </div>
    <div class="guide-body">
      <div class="guide-icon">${s.icon}</div>
      <div class="sub">${i + 1} из ${steps.length}</div>
      <h1>${s.title}</h1>
      ${s.html}
    </div>
    <div class="guide-nav">
      ${i ? `<button class="btn ghost2" data-gprev>← Назад</button>` : ""}
      <button class="btn" data-gnext>${last ? "Начать работу 🚀" : "Дальше →"}</button>
    </div>`;
  document.body.append(el);
  const done = () => {
    store.set(`guide_done_${state.me?.id}`, "1");
    el.remove();
  };
  el.querySelector("[data-gclose]").onclick = done;
  el.querySelector("[data-gprev]")?.addEventListener("click", () => guideOverlay(i - 1));
  el.querySelector("[data-gnext]").onclick = () => (last ? done() : (haptic("light"), guideOverlay(i + 1)));
}

// ---------- КАБИНЕТ НАСТАВНИКА (CRM учеников) ----------
async function renderStudents() {
  $app.innerHTML = `<h1>Ученики</h1><div class="loader">Загрузка…</div>`;
  let d;
  try {
    d = await api("GET", "/mentor");
  } catch (e) {
    $app.innerHTML = `<h1>Ученики</h1><div class="card empty">Ошибка: ${esc(e.message)}</div>`;
    return;
  }
  if (state.more !== "students") return;
  const link = (code) => (d.bot ? `https://t.me/${d.bot}?start=${code}` : code);
  const ago = (iso) => (iso ? (daysSince(iso) === 0 ? "сегодня" : `${daysSince(iso)} дн. назад`) : "ещё не начал");
  const active = d.students.filter((x) => x.active);
  const sum = (k) => active.reduce((t, x) => t + x[k], 0);
  const q = (state.studentQuery || "").toLowerCase();
  const shown = d.students.filter((x) => !q || `${x.name} ${x.note} ${x.username}`.toLowerCase().includes(q));
  const groups = d.codes.filter((c) => c.group);
  const singles = d.codes.filter((c) => !c.group);
  $app.innerHTML = `
    <h1>Ученики · ${active.length}</h1>
    <div class="kpis">
      <div class="kpi"><div class="label">Засчитано за месяц</div><div class="value money-green">${rub(sum("paidMonth"))}</div><div class="hint">все ученики вместе</div></div>
      <div class="kpi"><div class="label">За всё время</div><div class="value">${rub(sum("income"))}</div><div class="hint">${sum("leads")} ${plural(sum("leads"), "лид", "лида", "лидов")} у учеников</div></div>
    </div>

    <h2>Пригласить учеников</h2>
    <div class="card">
      <div class="title">👥 Ссылка для группы</div>
      <div class="sub" style="margin:4px 0 8px">Одна ссылка на весь поток: кидаешь в чат учеников — каждый жмёт, бот его пускает, и он сам появляется в списке ниже со своим именем из Telegram. Чужие по ней не зайдут, если ты её отзовёшь.</div>
      <div class="inline-add"><input id="gMax" type="number" inputmode="numeric" min="1" max="500" value="50" style="max-width:90px"><input id="gNote" placeholder="Название, напр. «Поток ноябрь»"></div>
      <button class="btn block" id="newGroup" style="margin-top:8px">＋ Создать ссылку для группы</button>
    </div>
    ${groups.length ? `<div class="list" style="margin-top:8px">${groups
      .map((c) => `<div class="row"><div class="grow"><div class="title">${esc(c.note || "Ссылка для группы")}</div><div class="sub">вошло ${c.uses || 0} из ${c.max} · <code>${c.code}</code></div></div>
        <div class="right"><button class="btn small" data-copy="${esc(link(c.code))}">Скопировать</button><button class="link danger" data-delcode="${c.code}" data-group="1">отозвать</button></div></div>`)
      .join("")}</div>` : ""}
    <div class="card" style="margin-top:10px">
      <div class="title">🔑 Личный код</div>
      <div class="sub" style="margin:4px 0 8px">Для одного человека: сработает только один раз.</div>
      <div class="inline-add"><input id="codeNote" placeholder="Имя ученика (для тебя)"><button class="btn small" id="newCode">＋ Создать</button></div>
    </div>
    ${singles.length ? `<div class="list" style="margin-top:8px">${singles
      .map((c) => `<div class="row"><div class="grow"><div class="title"><code>${c.code}</code>${c.note ? ` · ${esc(c.note)}` : ""}</div><div class="sub">ещё не активирован · ${fmtDate(c.createdAt.slice(0, 10))}</div></div>
        <div class="right"><button class="btn small" data-copy="${esc(link(c.code))}">Скопировать</button><button class="link danger" data-delcode="${c.code}">удалить</button></div></div>`)
      .join("")}</div>` : ""}

    <div class="list-head"><h2 style="margin:0">Рейтинг за месяц</h2></div>
    ${d.students.length > 8 ? `<input id="sq" type="search" placeholder="🔍 Найти ученика" value="${esc(state.studentQuery || "")}" style="margin-bottom:8px">` : ""}
    ${shown.length ? `<div class="list">${shown
      .map((x, i) => `<div class="row ${x.active ? "" : "muted"}">
        <div class="avatar" style="width:40px;height:40px;font-size:15px;background:linear-gradient(135deg,var(--accent2,#3b2fb8),var(--btn))">${x.active ? i + 1 : "–"}</div>
        <div class="grow"><div class="title">${esc(x.note || x.name)}${x.username ? ` <span class="sub">@${esc(x.username)}</span>` : ""}</div>
          <div class="sub">${x.note && x.note !== x.name ? `${esc(x.name)} · ` : ""}${x.leads} ${plural(x.leads, "лид", "лида", "лидов")} · активных ${x.activeLeads} · в работе ${rub(x.inWork)}</div>
          <div class="sub"><span class="${!x.lastActivity || daysSince(x.lastActivity) >= 5 ? "danger" : ""}">действие: ${ago(x.lastActivity)}</span>${x.active ? "" : " · доступ закрыт"}</div></div>
        <div class="right"><b class="money-green">${rub(x.paidMonth)}</b><div class="sub">всего ${short(x.income)}</div>
          <button class="link hint-link" data-rename="${x.id}" data-cur="${esc(x.note || "")}">подпись</button>
          <button class="link ${x.active ? "danger" : ""}" data-toggle="${x.id}" data-on="${x.active ? "0" : "1"}">${x.active ? "закрыть" : "открыть"}</button></div>
      </div>`)
      .join("")}</div>` : `<div class="card empty small">${d.students.length ? "Никого не нашёл" : "Учеников пока нет — создай ссылку и кинь её в чат"}</div>`}
    <div class="sub note">Ты видишь только цифры учеников, сами лиды — нет. Лиды каждого ученика видит только он сам.</div>`;

  const create = async (btn, body) => {
    btn.disabled = true;
    try {
      const c = await api("POST", "/mentor/codes", body);
      (await copyText(link(c.code))) ? toast("Ссылка создана и скопирована — вставь её в чат") : alertDialog(`Ссылка: ${link(c.code)}`);
      renderStudents();
    } catch (err) {
      btn.disabled = false;
      toast(`Ошибка: ${err.message}`);
    }
  };
  document.getElementById("newGroup").onclick = (e) => create(e.target, { group: true, max: +document.getElementById("gMax").value || 50, note: document.getElementById("gNote").value });
  document.getElementById("newCode").onclick = (e) => create(e.target, { note: document.getElementById("codeNote").value });
  document.getElementById("sq")?.addEventListener("input", (e) => {
    state.studentQuery = e.target.value;
    clearTimeout(state.sqTimer);
    state.sqTimer = setTimeout(() => renderStudents().then(() => document.getElementById("sq")?.focus()), 400);
  });
  $app.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => ((await copyText(b.dataset.copy)) ? toast("Ссылка скопирована") : alertDialog(b.dataset.copy))));
  $app.querySelectorAll("[data-delcode]").forEach((b) => (b.onclick = async () => {
    const group = !!b.dataset.group;
    if (!(await confirmDialog(group ? "Отозвать ссылку? Новые люди по ней не зайдут, а кто уже вошёл — останутся." : `Удалить код ${b.dataset.delcode}? По нему больше нельзя будет войти.`))) return;
    await api("DELETE", `/mentor/codes/${b.dataset.delcode}`).catch((e) => toast(e.message));
    renderStudents();
  }));
  $app.querySelectorAll("[data-toggle]").forEach((b) => (b.onclick = async () => {
    const on = b.dataset.on === "1";
    if (!on && !(await confirmDialog("Закрыть ученику доступ к CRM? Его лиды сохранятся — откроешь доступ, и всё вернётся."))) return;
    await api("PATCH", `/mentor/students/${b.dataset.toggle}`, { active: on }).catch((e) => toast(e.message));
    renderStudents();
  }));
  $app.querySelectorAll("[data-rename]").forEach((b) => (b.onclick = async () => {
    const v = await dialog({ text: "Подпись ученика — видна только тебе. Например: «Гоша, поток ноябрь». Пусто — показывать имя из Telegram.", input: { value: b.dataset.cur, placeholder: "Подпись" }, ok: "Сохранить", cancel: "Отмена" });
    if (v === null || v === undefined) return;
    await api("PATCH", `/mentor/students/${b.dataset.rename}`, { note: v }).catch((e) => toast(e.message));
    renderStudents();
  }));
}

function joinScreen() {
  const tgUser = (() => {
    try {
      return tg?.initDataUnsafe?.user || JSON.parse(new URLSearchParams(initData()).get("user") || "null");
    } catch {
      return null;
    }
  })();
  const tgName = [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(" ");
  $app.innerHTML = `${brandBar()}<div class="card join">
    <h1>🎓 CRM для учеников</h1>
    <div class="sub" style="margin:6px 0 14px">Твоя система для работы с лидами: офферы, статусы, деньги, статистика. Бонус для учеников Ryzhikov Academy — вход по ссылке-приглашению или коду от наставника.</div>
    <label class="field"><span>Код доступа</span><input id="joinCode" placeholder="Например: K7M2QX" autocomplete="off" autocapitalize="characters"></label>
    <label class="field"><span>Как тебя зовут</span><input id="joinName" value="${esc(tgName)}" placeholder="Имя и фамилия" maxlength="60"></label>
    <button class="btn block" id="joinBtn">Войти</button>
    <div class="sub" style="margin-top:10px">Пришла ссылка от наставника? Просто нажми на неё — код вводить не нужно.</div>
  </div>`;
  document.getElementById("joinBtn").onclick = async (e) => {
    const code = document.getElementById("joinCode").value.trim();
    if (!code) return toast("Введи код");
    e.target.disabled = true;
    try {
      const name = document.getElementById("joinName").value.trim();
      await api("POST", "/join", { code, name: name === tgName ? "" : name });
      await reload();
      $tabs.hidden = false;
      guideOverlay(0);
    } catch (err) {
      e.target.disabled = false;
      toast({ bad_code: "Код не подошёл — проверь буквы", code_used: "Этот код уже использован", code_full: "По этой ссылке уже зашло максимум людей — попроси новую", code_expired: "Срок ссылки закончился — попроси новую", disabled: "Доступ закрыт — напиши наставнику" }[err.data?.error] || `Ошибка: ${err.message}`);
    }
  };
}

// ---------- РАСХОДЫ ----------
// Два вида: затраты на ЦД внутри офферов (вносятся в окне оффера) и общие расходы (трафик, сервисы…).
const periodChips = () => `<div class="chips">${PERIODS.map(([p, label]) => `<button class="chip ${state.period === p ? "active" : ""}" data-period="${p}">${label}</button>`).join("")}</div>`;
const bindPeriod = (render) => $app.querySelectorAll("[data-period]").forEach((b) => (b.onclick = () => {
  state.period = b.dataset.period;
  render();
}));

function renderExpenses() {
  const range = periodRange();
  const dirs = directionStats(state.leads, state.offers, state.expenses || [], range);
  const inRange = (state.expenses || []).filter((e) => !range || (e.date >= range.from && e.date <= range.to));
  const cdCosts = dirs.reduce((t, d) => t + d.costs, 0);
  const general = inRange.reduce((t, e) => t + e.amount, 0);
  const income = dirs.reduce((t, d) => t + d.income, 0);
  const byKind = Object.entries(EXPENSE_KIND_LABELS).map(([k, label]) => ({ label, value: inRange.filter((e) => e.kind === k).reduce((t, e) => t + e.amount, 0) })).filter((r) => r.value);
  const offerCosts = new Map();
  for (const d of dirs) for (const c of d.costItems) {
    const r = offerCosts.get(c.offerId) || { label: c.name.replace(/ — РКО$/, ""), value: 0, n: 0, id: c.offerId };
    r.value += c.cost;
    r.n++;
    offerCosts.set(c.offerId, r);
  }
  const topCosts = [...offerCosts.values()].sort((a, b) => b.value - a.value).slice(0, 8).map((r) => ({ ...r, act: `data-costoffer="${r.id}"` }));
  $app.innerHTML = `
    <div class="title-row"><h1>Расходы</h1><button class="btn small" id="addExp">＋ Расход</button></div>
    ${periodChips()}
    <div class="kpis">
      <div class="kpi accent"><div class="label">Всего потрачено</div><div class="value">${rub(cdCosts + general)}</div><div class="hint">${income ? `${Math.round(((cdCosts + general) / income) * 100)}% от засчитанного` : "засчётов за период нет"}</div></div>
      <div class="kpi"><div class="label">Засчитано − расходы</div><div class="value money-green">${rub(income - cdCosts - general)}</div><div class="hint">до налога и доли партнёра</div></div>
      <div class="kpi"><div class="label">Затраты на ЦД</div><div class="value">${rub(cdCosts)}</div><div class="hint">из офферов: комиссии, тарифы, маскировка</div></div>
      <div class="kpi"><div class="label">Общие расходы</div><div class="value">${rub(general)}</div><div class="hint">трафик, реклама, сервисы</div></div>
    </div>

    <h2>По направлениям</h2>
    <div class="list">${dirs
      .filter((d) => d.key !== "all" || d.costs || d.general)
      .map((d) => `<div class="row" data-dircost="${d.key}" role="button"><div class="grow"><div class="title">${esc(d.label)}</div>
        <div class="sub">затраты на ЦД ${rub(d.costs)}${d.general ? ` · общие ${rub(d.general)}` : ""} · засчитано ${rub(d.income)}</div></div>
        <div class="right"><b>${rub(d.costs + d.general)}</b>${d.income ? `<div class="sub">${Math.round(((d.costs + d.general) / d.income) * 100)}% от дохода</div>` : ""}</div></div>`)
      .join("")}</div>

    ${topCosts.length ? `<h2>Затраты на ЦД по офферам</h2>${hbars(topCosts, (r) => `${rub(r.value)} · ${r.n}×`)}` : ""}
    ${byKind.length ? `<h2>Общие расходы по статьям</h2>${hbars(byKind, (r) => rub(r.value))}` : ""}

    <div class="list-head"><h2 style="margin:0">Общие расходы · ${inRange.length}</h2></div>
    ${inRange.length ? `<div class="list">${inRange
      .slice(0, 100)
      .map((e) => `<div class="row" data-exp="${e.id}" role="button"><div class="grow"><div class="title">${esc(EXPENSE_KIND_LABELS[e.kind] || "Расход")}${e.note ? ` · ${esc(e.note)}` : ""}</div>
        <div class="sub">${fmtDate(e.date)}.${e.date.slice(2, 4)} · ${esc(DIR_LABELS[e.dir] || "Общее")}${e.source ? ` · ${esc(e.source)}` : ""}</div></div><div class="right"><b>−${rub(e.amount)}</b></div></div>`)
      .join("")}</div>` : `<div class="card empty small">За этот период общих расходов нет. Трафик, реклама, сервисы — жми «＋ Расход».</div>`}
    <div class="explain" style="margin-top:12px"><b>Откуда цифры.</b> Затраты на ЦД вносятся в самом оффере у лида (поле «Затраты», кнопки +20/+50/+100) — они попадают сюда сами по направлению оффера. Общие расходы, не привязанные к лиду (трафик, реклама, сервисы, пополнения), добавляй кнопкой «＋ Расход». Укажи источник — и в «Источниках» будет видно, окупается ли канал.</div>`;
  bindPeriod(renderExpenses);
  document.getElementById("addExp").onclick = () => expenseSheet();
  $app.querySelectorAll("[data-exp]").forEach((r) => (r.onclick = () => expenseSheet((state.expenses || []).find((e) => e.id === r.dataset.exp))));
  $app.querySelectorAll("[data-dircost]").forEach((r) => (r.onclick = () => {
    const d = dirs.find((x) => x.key === r.dataset.dircost);
    leadsSheet(`Затраты на ЦД · ${d.label}`, "Офферы с внесёнными затратами. Нажми на лида — откроется карточка, затраты правятся в окне оффера.",
      d.costItems.sort((a, b) => b.cost - a.cost).map((c) => ({ lead: c.lead, sub: `${esc(c.name.replace(/ — РКО$/, ""))} · ${statusLabel(c.status, offerById(c.offerId)?.category, true)}`, right: `<b>−${rub(c.cost)}</b>` })));
  }));
  $app.querySelectorAll("[data-costoffer]").forEach((r) => (r.onclick = () => {
    const items = dirs.flatMap((d) => d.costItems).filter((c) => c.offerId === r.dataset.costoffer);
    leadsSheet(`Затраты · ${offerById(r.dataset.costoffer)?.name || ""}`, "По каким лидам были затраты на этот оффер.", items.map((c) => ({ lead: c.lead, sub: statusLabel(c.status, offerById(c.offerId)?.category, true), right: `<b>−${rub(c.cost)}</b>` })));
  }));
}

function expenseSheet(e = null) {
  const sources = [...new Set([...state.leads.map((l) => (l.source || "").trim()), ...(state.expenses || []).map((x) => x.source)].filter(Boolean))].slice(0, 12);
  let kind = e?.kind || "traffic";
  let dir = e?.dir || "all";
  openSheet(
    `<h2 class="sheet-title">${e ? "Расход" : "Новый расход"}</h2>
    <div class="two">
      <label class="field"><span>Сумма, ₽</span><input id="eAmount" type="number" inputmode="decimal" value="${e?.amount || ""}" placeholder="0"></label>
      <label class="field"><span>Дата</span><input id="eDate" type="date" value="${e?.date || localKey()}"></label>
    </div>
    <div class="sheet-label">На что</div>
    <div class="chips tight" id="eKind">${Object.entries(EXPENSE_KIND_LABELS).map(([k, l]) => `<button class="chip ${k === kind ? "active" : ""}" data-k="${k}">${l}</button>`).join("")}</div>
    <div class="sheet-label">Направление</div>
    <div class="chips tight" id="eDir">${Object.entries(DIR_LABELS).map(([k, l]) => `<button class="chip ${k === dir ? "active" : ""}" data-d="${k}">${l}</button>`).join("")}</div>
    <label class="field" style="margin-top:8px"><span>Источник лидов (если трафик)</span><input id="eSource" list="eSources" value="${esc(e?.source || "")}" placeholder="YouTube, Reels, таргет…"></label>
    <datalist id="eSources">${sources.map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
    <label class="field"><span>Комментарий</span><input id="eNote" value="${esc(e?.note || "")}" placeholder="Например: закуп рекламы у @channel"></label>
    <button class="btn block" id="eSave">${e ? "Сохранить" : "Добавить расход"}</button>
    ${e ? `<button class="btn ghost block" id="eDel" style="margin-top:8px">Удалить расход</button>` : ""}`,
    (el) => {
      el.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => {
        kind = b.dataset.k;
        el.querySelectorAll("[data-k]").forEach((x) => x.classList.toggle("active", x === b));
      }));
      el.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => {
        dir = b.dataset.d;
        el.querySelectorAll("[data-d]").forEach((x) => x.classList.toggle("active", x === b));
      }));
      el.querySelector("#eSave").onclick = async (ev) => {
        const amount = Number(el.querySelector("#eAmount").value.replace(",", "."));
        if (!(amount > 0)) return toast("Впиши сумму");
        ev.target.disabled = true;
        const body = { amount, date: el.querySelector("#eDate").value, kind, dir, source: el.querySelector("#eSource").value, note: el.querySelector("#eNote").value };
        try {
          const saved = e ? await api("PATCH", `/expenses/${e.id}`, body) : await api("POST", "/expenses", body);
          state.expenses = [saved, ...(state.expenses || []).filter((x) => x.id !== saved.id)].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));
          haptic("medium");
          closeSheet();
          toast(e ? "Сохранено" : `Расход −${rub(amount)} добавлен`);
          render();
        } catch (err) {
          ev.target.disabled = false;
          toast(`Ошибка: ${err.message}`);
        }
      };
      el.querySelector("#eDel")?.addEventListener("click", async () => {
        if (!(await confirmDialog(`Удалить расход ${rub(e.amount)}?`))) return;
        try {
          await api("DELETE", `/expenses/${e.id}`);
          state.expenses = state.expenses.filter((x) => x.id !== e.id);
          closeSheet();
          toast("Расход удалён");
          render();
        } catch (err) {
          toast(`Ошибка: ${err.message}`);
        }
      });
    },
  );
}

// ---------- ИСТОЧНИКИ ----------
function renderSources() {
  const rows = sourceStats(state.leads, state.offers, state.expenses || [], money);
  const best = rows.filter((r) => r.leads >= 3).sort((a, b) => b.income / b.leads - a.income / a.leads)[0];
  $app.innerHTML = `
    <h1>Источники</h1>
    <div class="sub" style="margin:0 4px 10px">Откуда приходят лиды и какой канал реально приносит деньги. Источник указывается при создании лида («Откуда пришёл») и в карточке лида.</div>
    ${best ? `<div class="card" style="margin-bottom:10px"><div class="sub">🏆 Лучший канал по деньгам с одного лида</div><div class="title" style="font-size:17px;margin-top:2px">${esc(best.label)} — ${rub(best.income / best.leads)} с лида</div></div>` : ""}
    ${rows.length ? `<div class="list">${rows
      .map((r) => `<div class="row" data-src="${esc(r.label)}" role="button"><div class="grow"><div class="title">${esc(r.label)}</div>
        <div class="sub">${r.leads} ${plural(r.leads, "лид", "лида", "лидов")} · активных ${r.active} · принесли деньги ${r.paidLeads} (${r.conv}%)</div>
        <div class="sub">засчитано ${rub(r.income)}${r.spent ? ` · потрачено ${rub(r.spent)}` : ""}${r.inWork ? ` · можно дожать ${rub(r.inWork)}` : ""}</div></div>
        <div class="right"><b class="${r.net >= 0 ? "money-green" : "danger"}">${rub(r.net)}</b>${r.roi !== null ? `<div class="sub ${r.roi >= 0 ? "up" : "danger"}">ROI ${r.roi}%</div>` : ""}</div></div>`)
      .join("")}</div>` : `<div class="card empty small">Лидов пока нет</div>`}
    <div class="explain" style="margin-top:12px"><b>Как читать.</b> «Принесли деньги» — сколько лидов из канала принесли хотя бы один засчёт. «Потрачено» — затраты на ЦД по этим лидам, выплаты им и общие расходы с этим источником (трафик, реклама — добавляются в «Расходы»). ROI — сколько процентов прибыли принёс каждый вложенный рубль. Нажми на источник — откроются его лиды.</div>`;
  $app.querySelectorAll("[data-src]").forEach((r) => (r.onclick = () => go({ tab: "leads", query: r.dataset.src === "Не указано" ? "" : r.dataset.src, filter: "all", more: null })));
}

function renderProfile() {
  const m = state.member;
  $app.innerHTML = `
    <h1>Профиль</h1>
    <div class="card">
      <label class="field"><span>Как тебя зовут</span><input id="pName" value="${esc(m.customName ? m.name : "")}" placeholder="${esc(m.name)}" maxlength="60"></label>
      <div class="sub" style="margin:-2px 4px 10px">Это имя видит наставник. Пусто — возьмём имя из Telegram.</div>
      <button class="btn block" id="pSave">Сохранить</button>
    </div>
    <div class="list" style="margin-top:10px">
      ${m.username ? `<div class="row"><div class="grow">Telegram</div><div class="right sub">@${esc(m.username)}</div></div>` : ""}
      <div class="row"><div class="grow">В CRM с</div><div class="right sub">${m.joinedAt ? new Date(m.joinedAt).toLocaleDateString("ru-RU") : "—"}</div></div>
      <div class="row"><div class="grow">Лидов</div><div class="right sub">${state.leads.length}</div></div>
    </div>
    ${brandFoot()}`;
  document.getElementById("pSave").onclick = async (e) => {
    e.target.disabled = true;
    try {
      state.member = await api("PATCH", "/me", { name: document.getElementById("pName").value });
      toast("Сохранено");
      renderProfile();
    } catch (err) {
      e.target.disabled = false;
      toast(`Ошибка: ${err.message}`);
    }
  };
}

async function renderTrash() {
  $app.innerHTML = `<h1>Корзина</h1><div class="loader">Загрузка…</div>`;
  let items;
  try {
    items = await api("GET", "/trash");
  } catch (e) {
    $app.innerHTML = `<h1>Корзина</h1><div class="card empty">Ошибка: ${esc(e.message)}</div>`;
    return;
  }
  if (state.more !== "trash") return;
  $app.innerHTML = `
    <h1>Корзина</h1>
    <div class="sub" style="margin:0 4px 10px">Удалённые лиды не пропадают — их можно вернуть со всеми офферами и историей.</div>
    ${items.length ? `<div class="list">${items
      .map((l) => `<div class="row"><div class="grow"><div class="title">${esc(leadTitle(l))}</div><div class="sub">${[l.telegram && l.fio ? esc(l.fio) : "", `удалён ${fmtDate(l.deletedAt.slice(0, 10))}`].filter(Boolean).join(" · ")}</div></div>
        <div class="right"><button class="btn small" data-restore="${l.id}">Вернуть</button></div></div>`)
      .join("")}</div>` : `<div class="card empty small">Корзина пуста</div>`}`;
  $app.querySelectorAll("[data-restore]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try {
      const lead = await api("POST", `/trash/${b.dataset.restore}/restore`);
      state.leads = [lead, ...state.leads.filter((l) => l.id !== lead.id)];
      toast(`${leadTitle(lead)} — возвращён`);
      renderTrash();
    } catch (e) {
      b.disabled = false;
      toast(`Ошибка: ${e.message}`);
    }
  }));
}

function renderData() {
  $app.innerHTML = `
    <h1>Бэкап и выгрузка</h1>
    <div class="card">
      <div class="title">📊 Excel со всеми лидами</div>
      <div class="sub" style="margin:4px 0 10px">Бот пришлёт тебе в чат файл Excel: лист «Лиды» (люди и деньги по каждому) и лист «Офферы» (все офферы со статусами). Открывается в Excel, Google Таблицах и на iPhone. Плюс полный бэкап — его можно загрузить обратно через импорт ниже.</div>
      <button class="btn block" id="backup">Прислать в Telegram</button>
    </div>
    ${ACADEMY && state.member ? `<h2>Автовыгрузка</h2>
    <div class="card">
      <div class="sub" style="margin-bottom:8px">Бот сам пришлёт Excel утром (8–11 по МСК), если с прошлой выгрузки что-то менялось. Так у тебя всегда есть свежая копия всех лидов.</div>
      <div class="chips tight">${[[0, "Выключить"], [1, "Каждый день"], [3, "Раз в 3 дня"], [7, "Раз в неделю"]].map(([v, l]) => `<button class="chip ${state.member.exportEvery === v ? "active" : ""}" data-every="${v}">${l}</button>`).join("")}</div>
      ${state.member.lastExportDay ? `<div class="sub" style="margin-top:6px">Последняя автовыгрузка: ${fmtDate(state.member.lastExportDay)}</div>` : ""}
      <div class="sub" style="margin-top:6px">В любой момент: команда <b>/excel</b> в боте.</div>
    </div>` : ""}
    <h2>Дубли</h2>
    <div class="card"><div class="sub" style="margin-bottom:8px">${dupCount() ? `Сейчас дублей: <b>${dupCount()}</b>.` : "Дублей нет."} Объединение склеит карточки с одинаковым ником.</div>
      <button class="btn ghost block" id="dedupe" ${dupCount() ? "" : "disabled"}>Объединить дубли</button></div>
    <h2>Импорт лидов</h2>
    <div class="card">
      <div class="sub" style="margin-bottom:8px">Файл бэкапа или импорта (.json). Лиды с тем же Telegram обновятся, новые добавятся.</div>
      <label class="btn block ghost" style="display:block;text-align:center">📄 Выбрать файл<input type="file" id="importFile" hidden></label>
      <div class="sub" style="margin:14px 0 6px">Или вставь содержимое файла текстом:</div>
      <textarea id="importText" placeholder='{"leads": [...]}'></textarea>
      <button class="btn ghost block" id="importTextBtn">Импортировать текст</button>
    </div>`;

  document.getElementById("backup").onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Отправляю…";
    try {
      const r = await api("POST", "/backup");
      haptic("medium");
      alertDialog(`Готово: Excel с ${r.leads} ${plural(r.leads, "лидом", "лидами", "лидами")} — в чате с ботом.`);
    } catch (err) {
      alertDialog(`Не отправилось: ${err.message}. Открой чат с ботом, нажми «Старт» (/start) и попробуй ещё раз.`);
    }
    e.target.disabled = false;
    e.target.textContent = "Прислать в Telegram";
  };
  document.getElementById("dedupe").onclick = (e) => mergeDuplicates(e.target);
  $app.querySelectorAll("[data-every]").forEach((b) => (b.onclick = async () => {
    try {
      state.member = await api("PATCH", "/me", { exportEvery: +b.dataset.every });
      toast(+b.dataset.every ? "Автовыгрузка включена" : "Автовыгрузка выключена");
      renderData();
    } catch (err) {
      toast(`Ошибка: ${err.message}`);
    }
  }));
  let importing = false;
  const runImport = async (text) => {
    if (importing) return toast("Импорт уже идёт, подожди");
    importing = true;
    try {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("это не JSON-файл импорта");
      }
      const leads = Array.isArray(parsed) ? parsed : parsed.leads;
      if (!Array.isArray(leads)) throw new Error("в файле нет списка лидов");
      const r = await api("POST", "/import", { leads, expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [] });
      await reload();
      haptic("medium");
      alertDialog(`Импорт готов: новых ${r.created}, обновлено ${r.updated}`);
    } catch (err) {
      alertDialog(`Импорт не удался: ${err.message}`);
    } finally {
      importing = false;
    }
  };
  document.getElementById("importFile").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    toast("Загружаю…");
    const reader = new FileReader();
    reader.onload = () => runImport(reader.result);
    reader.onerror = () => alertDialog("Не удалось прочитать файл");
    reader.readAsText(file);
  };
  document.getElementById("importTextBtn").onclick = () => {
    const text = document.getElementById("importText").value.trim();
    if (text) runImport(text);
  };
}

// ---------- ВЫПЛАТЫ ОТ СЕТЕЙ ----------
function renderPayouts() {
  const report = networkReport(state.leads, state.offers, state.payouts);
  const debt = report.reduce((t, n) => t + n.debt, 0);
  const paid = report.reduce((t, n) => t + n.paid, 0);
  const received = report.reduce((t, n) => t + n.received, 0);
  $app.innerHTML = `
    <h1>Выплаты от сетей</h1>
    <div class="sub" style="margin:0 4px 10px">Засчитано — сколько сети должны по засчитанным офферам. Пришёл платёж — открой сеть, отметь офферы, которые он закрыл, и внеси сумму.</div>
    <div class="kpis">
      <div class="kpi ${debt ? "debt" : ""}"><div class="label">Не доплатили</div><div class="value">${rub(debt)}</div><div class="hint">засчитано, но денег не видели</div></div>
      <div class="kpi"><div class="label">Получено</div><div class="value money-green">${rub(received)}</div><div class="hint">из ${rub(paid)} засчитанного</div></div>
    </div>
    ${(() => {
      const legacy = report.flatMap((n) => n.unpaid.filter((u) => !u.day).map((u) => ({ ...u, network: n.network })));
      return legacy.length
        ? `<div class="card baseline"><div class="title">📋 Начальная сверка</div>
            <div class="sub" style="margin:4px 0 10px">${legacy.length} засчётов из таблицы на ${rub(legacy.reduce((t, u) => t + u.amount, 0))} — CRM не знает, оплатили ли их сети. Если деньги по ним уже пришли, отметь одной кнопкой. Если не все — открой сеть и отметь вручную.</div>
            <button class="btn block" id="baselineAll">Всё из таблицы уже оплачено</button></div>`
        : "";
    })()}
    <h2>Сети</h2>
    <div class="list">${report
      .map(
        (n) => `<div class="row" data-net="${esc(n.network)}" role="button">
          <div class="net-ic">${esc(n.network.slice(0, 2).toUpperCase())}</div>
          <div class="grow"><div class="title">${esc(n.network)}</div>
            <div class="sub">засчитано ${rub(n.paid)}${n.waiting ? ` · ждём засчёта ${rub(n.waiting)}` : ""}</div>
            <div class="bar-track"><i style="width:${n.paid ? (n.received / n.paid) * 100 : 0}%;background:var(--green)"></i></div></div>
          <div class="right">${n.debt ? `<b class="danger">${rub(n.debt)}</b><div class="sub">${n.unpaid.length} офф.</div>` : n.paid ? `<span class="pill st-paid">всё пришло</span>` : `<span class="sub">засчётов нет</span>`}</div>
        </div>`,
      )
      .join("") || `<div class="empty small">Засчитанных офферов пока нет</div>`}</div>
    ${state.payouts.length ? `<h2>Последние платежи</h2>${payoutList(state.payouts.slice(0, 15))}` : ""}`;
  $app.querySelectorAll("[data-net]").forEach((r) => (r.onclick = () => go({ network: r.dataset.net, picked: new Set() })));
  bindPayoutDelete();
  document.getElementById("baselineAll")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Отметить все засчёты из таблицы как оплаченные сетями? Платёж «Начальная сверка» можно будет удалить."))) return;
    await baseline(report);
  });
}

// Начальная сверка: засчёты без даты (из таблицы) отмечаются как оплаченные отдельным платежом по каждой сети.
async function baseline(nets) {
  try {
    for (const n of nets) {
      const legacy = n.unpaid.filter((u) => !u.day);
      if (!legacy.length) continue;
      await api("POST", "/payouts", {
        network: n.network,
        amount: legacy.reduce((t, u) => t + u.amount, 0),
        note: "Начальная сверка (из таблицы)",
        items: legacy.map((u) => ({ leadId: u.lead.id, offerId: u.offerId })),
      });
    }
    await reload();
    haptic("medium");
    toast("Начальная сверка сохранена");
  } catch (e) {
    toast(`Ошибка: ${e.message}`);
  }
}

const payoutList = (list) =>
  `<div class="list">${list
    .map(
      (p) => `<div class="row"><div class="grow"><div class="title">${rub(p.amount)} · ${esc(p.network)}</div>
        <div class="sub">${fmtDate(p.date)}.${p.date.slice(2, 4)} · закрыто ${p.items.length} офф. на ${rub(p.covered)}${p.amount !== p.covered ? ` · <span class="danger">расхождение ${rub(p.amount - p.covered)}</span>` : ""}${p.note ? " · " + esc(p.note) : ""}</div></div>
        <button class="chip danger-chip" data-delpay="${p.id}">✕</button></div>`,
    )
    .join("")}</div>`;

function bindPayoutDelete() {
  $app.querySelectorAll("[data-delpay]").forEach(
    (b) =>
      (b.onclick = async (e) => {
        e.stopPropagation();
        if (!(await confirmDialog("Удалить платёж? Отметки «получено» с его офферов снимутся."))) return;
        try {
          await api("DELETE", `/payouts/${b.dataset.delpay}`);
          await reload();
          toast("Платёж удалён");
        } catch (err) {
          toast(`Ошибка: ${err.message}`);
        }
      }),
  );
}

function renderNetwork() {
  const n = networkReport(state.leads, state.offers, state.payouts).find((x) => x.network === state.network);
  if (!n) return go({ network: null });
  const pickedSum = n.unpaid.filter((u) => state.picked.has(`${u.lead.id}|${u.offerId}`)).reduce((t, u) => t + u.amount, 0);
  const pays = state.payouts.filter((p) => p.network === n.network);
  $app.innerHTML = `
    <h1>${esc(n.network)}</h1>
    <div class="kpis three">
      <div class="kpi"><div class="label">Засчитано</div><div class="value">${rub(n.paid)}</div></div>
      <div class="kpi"><div class="label">Получено</div><div class="value money-green">${rub(n.received)}</div></div>
      <div class="kpi ${n.debt ? "debt" : ""}"><div class="label">Должны</div><div class="value">${rub(n.debt)}</div></div>
    </div>
    ${
      n.unpaid.length
        ? `<div class="list-head"><h2 style="margin:0">Засчитано, денег нет · ${n.unpaid.length}</h2><button class="link" id="pickAll">${state.picked.size === n.unpaid.length ? "Снять все" : "Выбрать все"}</button></div>
           <div class="list">${n.unpaid
             .map((u) => {
               const k = `${u.lead.id}|${u.offerId}`;
               return `<label class="row pick"><input type="checkbox" data-pick="${k}" ${state.picked.has(k) ? "checked" : ""}>
                 <div class="grow"><div class="title">${esc(leadTitle(u.lead))}</div><div class="sub">${esc(u.name)}${u.day ? " · засчитан " + fmtDate(u.day) : " · из таблицы"}</div></div>
                 <div class="right"><b>${rub(u.amount)}</b></div></label>`;
             })
             .join("")}</div>
           <div class="pay-bar"><div><div class="sub">Выбрано ${state.picked.size}</div><b>${rub(pickedSum)}</b></div><button class="btn" id="addPay">Внести платёж</button></div>`
        : `<div class="card empty">🎉 Все засчитанные офферы этой сети оплачены</div>`
    }
    ${n.unpaid.some((u) => !u.day) ? `<button class="btn ghost block" id="baselineNet">📋 Все из таблицы по ${esc(n.network)} уже оплачены</button>` : ""}
    ${pays.length ? `<h2>Платежи ${esc(n.network)}</h2>${payoutList(pays)}` : ""}`;

  document.getElementById("baselineNet")?.addEventListener("click", async () => {
    if (await confirmDialog(`Отметить засчёты из таблицы по ${n.network} как оплаченные?`)) baseline([n]);
  });
  $app.querySelectorAll("[data-pick]").forEach(
    (c) =>
      (c.onchange = () => {
        c.checked ? state.picked.add(c.dataset.pick) : state.picked.delete(c.dataset.pick);
        const y = window.scrollY;
        renderNetwork();
        window.scrollTo(0, y);
      }),
  );
  document.getElementById("pickAll")?.addEventListener("click", () => {
    state.picked = state.picked.size === n.unpaid.length ? new Set() : new Set(n.unpaid.map((u) => `${u.lead.id}|${u.offerId}`));
    renderNetwork();
  });
  document.getElementById("addPay")?.addEventListener("click", () => payoutSheet(n, pickedSum));
  bindPayoutDelete();
}

function payoutSheet(n, pickedSum) {
  openSheet(
    `<h2 class="sheet-title">Платёж от ${esc(n.network)}</h2>
    <div class="sub" style="margin:-6px 4px 10px">Отмечено офферов: ${state.picked.size} на ${rub(pickedSum)}. Если сумма платежа другая — CRM покажет расхождение.</div>
    <div class="card">
      <label class="field"><span>Сколько пришло, ₽</span><input id="pAmount" type="number" inputmode="decimal" value="${pickedSum || ""}"></label>
      <label class="field"><span>Дата</span><input id="pDate" type="date" value="${localKey()}"></label>
      <label class="field"><span>Комментарий</span><input id="pNote" placeholder="Например: выплата за сентябрь"></label>
      <div id="pDiff" class="sub" style="margin:0 4px"></div>
    </div>
    <button class="btn block" id="pSave">Сохранить платёж</button>`,
    (el) => {
      const diff = () => {
        const v = Number(el.querySelector("#pAmount").value || 0);
        el.querySelector("#pDiff").innerHTML = v && v !== pickedSum ? `<span class="danger">Расхождение ${rub(v - pickedSum)}: ${v > pickedSum ? "пришло больше, чем отмечено" : "недоплатили"}</span>` : v ? "✅ Сумма совпадает с отмеченными офферами" : "";
      };
      el.querySelector("#pAmount").oninput = diff;
      diff();
      el.querySelector("#pSave").onclick = async () => {
        const items = [...state.picked].map((k) => ({ leadId: k.split("|")[0], offerId: k.split("|")[1] }));
        try {
          await api("POST", "/payouts", { network: n.network, amount: el.querySelector("#pAmount").value, date: el.querySelector("#pDate").value, note: el.querySelector("#pNote").value, items });
          closeSheet();
          state.picked = new Set();
          await reload();
          haptic("medium");
          celebrate(Number(el.querySelector("#pAmount").value || 0));
        } catch (e) {
          toast(`Ошибка: ${e.message}`);
        }
      };
    },
  );
}

function renderBot() {
  $app.innerHTML = `
    <h1>Лиды через бота</h1>
    <div class="card bot-howto">
      <div class="step"><span>1</span><div><b>Перешли сообщение</b> человека боту — лид создастся с его ником и именем. Его текст сохранится в заметке.</div></div>
      <div class="step"><span>2</span><div><b>Отправь контакт</b> (скрепка → Контакт) — заведу с телефоном.</div></div>
      <div class="step"><span>3</span><div><b>Напиши текстом</b>: <code>@nick Иванов Иван +79001234567</code> — в любом порядке, лишнее можно опустить.</div></div>
      <div class="sub" style="margin-top:8px">Бот ответит «✅ Лид создан» с кнопкой «Открыть лида». Дубли по нику, Telegram-аккаунту и телефону не создаёт. Если ник скрыт настройками приватности — создаст по имени и попросит дописать ник.</div>
    </div>
    <button class="btn ghost block" id="botSetup">Переподключить бота</button>
    <div class="sub center">Подключение происходит само при первом входе админа. Кнопка нужна, только если бот перестал отвечать (например, после смены токена).</div>`;
  document.getElementById("botSetup").onclick = async () => {
    try {
      await api("POST", "/bot/setup");
      alertDialog("Бот подключён ✅ Перешли ему сообщение — проверим.");
    } catch (e) {
      alertDialog(`Не получилось: ${e.message}`);
    }
  };
}

function renderTemplates() {
  const list = [...(state.settings.templates || [])];
  $app.innerHTML = `
    <h1>Шаблоны сообщений</h1>
    <div class="sub" style="margin:0 4px 10px">Тексты, которые чаще всего пишешь лидам. В карточке лида «💬 Шаблоны» → тап → скопировано и открыт чат.</div>
    <div id="tplList">${list.map((t, i) => `<div class="card tpl-edit"><textarea data-i="${i}">${esc(t)}</textarea><button class="chip danger-chip" data-del="${i}">Удалить</button></div>`).join("")}</div>
    <button class="btn ghost block" id="tplAdd">＋ Добавить шаблон</button>
    <button class="btn block" id="tplSave">Сохранить</button>`;
  const collect = () => [...$app.querySelectorAll("textarea[data-i]")].map((t) => t.value);
  $app.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => {
    state.settings.templates = collect().filter((_, i) => i !== +b.dataset.del);
    renderTemplates();
  }));
  document.getElementById("tplAdd").onclick = () => {
    state.settings.templates = [...collect(), ""];
    renderTemplates();
    $app.querySelector("textarea[data-i]:last-of-type")?.focus();
  };
  document.getElementById("tplSave").onclick = async () => {
    try {
      state.settings = await api("PUT", "/settings", { templates: collect() });
      haptic("medium");
      toast("Шаблоны сохранены");
      renderTemplates();
    } catch (e) {
      toast(`Ошибка: ${e.message}`);
    }
  };
}

function renderSettings() {
  const s = state.settings;
  $app.innerHTML = `
    <h1>Налог, партнёр и план</h1>
    <div class="card">
      <label class="field"><span>Партнёр (доля от дохода после налога)</span><input id="sName" value="${esc(s.partnerName)}"></label>
      <div class="two">
        <label class="field"><span>Доля партнёра, %</span><input id="sShare" type="number" inputmode="decimal" value="${s.partnerShare}"></label>
        <label class="field"><span>Налог, %</span><input id="sTax" type="number" inputmode="decimal" value="${s.taxRate}"></label>
      </div>
      <label class="field"><span>План засчитанного дохода на месяц, ₽</span><input id="sGoal" type="number" inputmode="decimal" value="${s.monthlyGoal || ""}" placeholder="Например, 500000"></label>
      <div class="sub" style="margin:4px 4px 10px">Чистая = доход − налог − доля партнёра от (доход − налог) − затраты − выплачено лиду. План показывается прогресс-баром на «Сегодня».</div>
      <button class="btn block" id="saveSettings">Сохранить</button>
    </div>`;
  document.getElementById("saveSettings").onclick = async () => {
    try {
      state.settings = await api("PUT", "/settings", {
        partnerName: document.getElementById("sName").value,
        partnerShare: Number(document.getElementById("sShare").value),
        taxRate: Number(document.getElementById("sTax").value),
        monthlyGoal: Number(document.getElementById("sGoal").value || 0),
      });
      haptic("medium");
      toast("Расчёт сохранён");
    } catch (e) {
      toast(`Ошибка: ${e.message}`);
    }
  };
}

function renderOffers() {
  const admin = isAdmin();
  const routeSum = (cat) => state.offers.filter((o) => o.active && o.category === cat).reduce((t, o) => t + o.amount, 0);
  const catalog = Object.keys(CATEGORY_LABELS)
    .map((cat) => {
      const items = state.offers.map((o, i) => ({ o, i })).filter(({ o }) => o.category === cat);
      if (!items.length) return "";
      return `<h2>${CATEGORY_LABELS[cat]} · полный маршрут ${rub(routeSum(cat))}</h2>
        <div class="list">${items
          .map(({ o, i }) =>
            admin
              ? `<div class="offer-edit" data-i="${i}">
                  <input class="full" data-k="name" value="${esc(o.name)}" placeholder="Название">
                  <input data-k="partner" value="${esc(o.partner)}" placeholder="Партнёрская сеть">
                  <select data-k="category">${Object.entries(CATEGORY_LABELS).map(([c, l]) => `<option value="${c}" ${o.category === c ? "selected" : ""}>${l}</option>`).join("")}</select>
                  <label class="mini"><span>Ставка</span><input data-k="amount" type="number" inputmode="decimal" value="${o.amount}"></label>
                  <label class="mini"><span>Затраты по умолч.</span><input data-k="cost" type="number" inputmode="decimal" value="${o.cost || 0}"></label>
                  <input class="full" data-k="note" value="${esc(o.note)}" placeholder="Заметка">
                  <label class="check"><input type="checkbox" data-k="active" ${o.active ? "checked" : ""}> Активен</label>
                </div>`
              : `<div class="row"><div class="grow"><div class="title">${esc(o.name)}</div>
                  <div class="sub">${esc(o.partner)}${o.note ? " · " + esc(o.note) : ""}${o.active ? "" : " · неактивен"}</div></div>
                  <div class="right"><b>${rub(o.amount)}</b></div></div>`,
          )
          .join("")}</div>`;
    })
    .join("");

  $app.innerHTML = `<h1>Офферы и ставки</h1>${catalog}
    ${admin ? `<button class="btn ghost block" id="addOffer">＋ Добавить оффер</button><button class="btn block sticky-save" id="saveOffers">Сохранить каталог</button>` : ""}`;
  if (!admin) return;

  const collect = () =>
    [...$app.querySelectorAll(".offer-edit[data-i]")].map((row) => {
      const o = { ...state.offers[row.dataset.i] };
      row.querySelectorAll("[data-k]").forEach((el) => {
        o[el.dataset.k] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
      });
      return o;
    });
  document.getElementById("addOffer").onclick = () => {
    state.offers = [...collect(), { id: "", category: "rko", name: "Новый оффер", partner: "", amount: 0, cost: 0, active: true, note: "" }];
    renderOffers();
    window.scrollTo(0, document.body.scrollHeight);
  };
  document.getElementById("saveOffers").onclick = async () => {
    try {
      state.offers = await api("PUT", "/offers", { offers: collect() });
      haptic("medium");
      toast("Каталог сохранён");
      renderOffers();
    } catch (e) {
      toast(`Ошибка: ${e.message}`);
    }
  };
}

async function renderTeam() {
  $app.innerHTML = `<div class="loader">Загрузка…</div>`;
  let access;
  try {
    access = await api("GET", "/access");
  } catch (e) {
    $app.innerHTML = `<div class="card empty">Ошибка: ${esc(e.message)}</div>`;
    return;
  }
  if (state.more !== "team" || state.leadId) return;
  const who = (u) =>
    `<div class="grow"><div class="title">${esc(u.name || "Без имени")}</div>
      <div class="sub">${u.username ? "@" + esc(u.username) + " · " : ""}ID ${u.id}</div></div>`;
  const buttons = (u, current) =>
    `<div class="right" style="display:flex;gap:6px">
      ${Object.entries(ROLE_LABELS)
        .filter(([r]) => r !== current)
        .map(([r, label]) => `<button class="chip" data-grant="${u.id}" data-role="${r}">${label}</button>`)
        .join("")}
      <button class="chip" data-grant="${u.id}" data-role="" style="color:var(--danger)">✕</button>
    </div>`;

  $app.innerHTML = `
    <h1>Команда</h1>
    <div class="sub" style="margin:0 4px 8px">Новый человек открывает бота и жмёт CRM — он появится в «Ждут доступа». Админ видит всех лидов и всё настраивает, менеджер — только своих лидов.</div>
    <h2>Ждут доступа</h2>
    ${access.pending.length ? `<div class="list">${access.pending.map((u) => `<div class="row">${who(u)}${buttons(u)}</div>`).join("")}</div>` : `<div class="card empty small">Никто не ждёт</div>`}
    <h2>Выдан доступ</h2>
    ${access.users.length ? `<div class="list">${access.users.map((u) => `<div class="row">${who(u)}<span class="badge">${ROLE_LABELS[u.role]}</span>${buttons(u, u.role)}</div>`).join("")}</div>` : `<div class="card empty small">Пока никого</div>`}
    ${access.fixed.length ? `<h2>Владельцы (из настроек сервера)</h2>` : ""}
    <div class="list">${access.fixed.map((u) => `<div class="row"><div class="grow">ID ${u.id}${u.id === state.me.id ? " — это ты" : ""}</div><span class="badge">${ROLE_LABELS[u.role]}</span></div>`).join("")}</div>`;

  $app.querySelectorAll("[data-grant]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const role = btn.dataset.role || null;
      if (!role && !(await confirmDialog("Убрать доступ?"))) return;
      try {
        await api("PUT", "/access", { id: Number(btn.dataset.grant), role });
        haptic("medium");
        toast(role ? `Выдан доступ: ${ROLE_LABELS[role]}` : "Доступ убран");
        renderTeam();
      } catch (e) {
        toast(`Ошибка: ${e.message}`);
      }
    }),
  );
}

// ---------- wiring ----------
$app.addEventListener("click", (e) => {
  const quick = e.target.closest("[data-quick]");
  if (quick) {
    const [leadId, offerId, status] = quick.dataset.quick.split("|");
    const lead = state.leads.find((l) => l.id === leadId);
    const o = offerById(offerId);
    if (status === "paid") celebrate(lead?.offers[offerId]?.amount || 0);
    quick.disabled = true;
    return saveLead(leadId, { offers: { [offerId]: { status } } }, `${leadTitle(lead)} · ${o.name.replace(/ — РКО$/, "")}: ${statusLabel(status, o.category, true)}`);
  }
  const open = e.target.closest("[data-open]");
  if (open) return go({ leadId: open.dataset.open });
  const ex = e.target.closest("[data-explain]");
  if (ex) return explain(ex.dataset.explain);
  const hp = e.target.closest("[data-help]");
  if (hp) return helpSheet(hp.dataset.help);
  const gm = e.target.closest("[data-gomore]");
  if (gm) return go({ tab: "more", more: gm.dataset.gomore, network: null });
  const jump = e.target.closest("[data-goto]");
  if (jump) return go({ tab: "leads", filter: jump.dataset.goto, query: "", sort: "inwork" });
  const chip = e.target.closest("[data-filter]");
  if (chip) {
    const f = chip.dataset.filter;
    const sel = selectedFilters();
    state.filter = f === "all" ? "all" : (sel.includes(f) ? sel.filter((x) => x !== f) : [...sel, f]).join(",") || "all";
    renderLeads();
  }
});

$tabs.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tab]");
  if (btn) go({ tab: btn.dataset.tab, leadId: null, more: null, network: null });
});

safe(() => tg?.BackButton.onClick(() => {
  const dlg = document.querySelector(".dialog-wrap");
  if (dlg) return (dlg.querySelector('[data-r="0"]') || dlg.querySelector('[data-r="1"]'))?.click();
  const guide = document.querySelector(".guide");
  if (guide) return (guide.querySelector("[data-gprev]") || guide.querySelector("[data-gclose]"))?.click();
  if (document.querySelector(".sheet-wrap")) return closeSheet();
  if (state.leadId) return go({ leadId: null });
  if (state.network) return go({ network: null });
  go({ more: null });
}));

let lastLoad = 0;
// Вернулся в CRM через минуту+ — подтягиваем свежие данные (партнёр мог что-то поменять).
document.addEventListener("visibilitychange", () => {
  // У ученика CRM открыта на одном телефоне — обновляем реже, чтобы не тратить лимит запросов.
  if (document.visibilityState !== "visible" || !state.me || Date.now() - lastLoad < (ACADEMY ? 180000 : 60000)) return;
  if (document.querySelector(".sheet-wrap, .dialog-wrap") || document.activeElement?.matches("input, textarea")) return;
  const y = window.scrollY;
  reload().then(() => window.scrollTo(0, y)).catch(() => {});
});

async function reload() {
  const data = await api("GET", "/state");
  lastLoad = Date.now();
  Object.assign(state, { me: data.me, offers: data.offers, settings: data.settings, leads: data.leads, payouts: data.payouts || [], ledger: data.ledger || null, member: data.member || null, expenses: data.expenses || [] });
  render();
}

// Кнопка «Открыть лида» из бота приходит с ?lead=<id>.
const params = new URLSearchParams(location.search);
const deepLead = params.get("lead");
const deepTab = params.get("tab");

reload()
  .then(() => {
    $tabs.hidden = false;
    if (ACADEMY && !store.get(`guide_done_${state.me.id}`)) guideOverlay(0);
    if (deepLead && state.leads.some((l) => l.id === deepLead)) go({ leadId: deepLead });
    else if (["today", "leads", "stats", "more"].includes(deepTab)) go({ tab: deepTab });
  })
  .catch((e) => {
    if (e.status === 403 && e.data.error === "not_member") return joinScreen();
    $app.innerHTML =
      e.status === 403 && e.data.error === "disabled"
        ? `<div class="card empty">Доступ к CRM закрыт.<br>Напиши наставнику.</div>`
        : e.status === 403
        ? `<div class="card empty">Запрос на доступ отправлен.<br>Попроси админа выдать доступ: «Ещё» → «Команда».<br><span style="font-size:12px">Твой Telegram ID: ${esc(e.data.userId)}</span></div>`
        : e.status === 401
          ? `<div class="card empty">${esc(AUTH_ERRORS[e.data.reason] || "Открой приложение через бота в Telegram.")}<br><span style="font-size:12px">код: ${esc(e.data.reason || "—")}</span></div>`
          : `<div class="card empty">Ошибка загрузки: ${esc(e.message)}</div>`;
  });
