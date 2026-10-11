import { leadMoney, sumMoney, ACTIVE_STAGES } from "./economics.js";
import { STAGE_LABELS, STATUS_LABELS, STATUS_SHORT, CATEGORY_LABELS } from "./labels.js";
import { worklist, paidEvents, todayKey, addDays, daysSince, netOf } from "./insights.js";

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const AUTH_ERRORS = {
  no_bot_token: "На сервере не задан токен бота (BOT_TOKEN в Cloudflare).",
  bad_signature: "Токен бота на сервере не совпадает с ботом. Проверь BOT_TOKEN в Cloudflare.",
  no_init_data: "Открой приложение кнопкой CRM в боте Telegram.",
  expired: "Сессия устарела — закрой и открой приложение заново.",
};
const ROLE_LABELS = { admin: "Админ", manager: "Менеджер" };
// Порядок офферов в карточке: сначала то, что требует действий.
const STATUS_ORDER = ["opened", "applied", "done", "paid", "rejected", "exists", "none"];
const QUICK_STATUSES = ["applied", "opened", "done", "paid", "rejected", "exists", "none"];

const state = {
  me: null,
  offers: [],
  settings: { taxRate: 7, partnerShare: 20, partnerName: "Партнёр" },
  leads: [],
  tab: "today",
  leadId: null,
  more: null, // offers | settings | team | data
  filter: "all",
  sort: "recent",
  query: "",
  period: "30",
};

const $app = document.getElementById("app");
const $tabs = document.getElementById("tabs");

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rub = (n) => `${Math.round(n || 0).toLocaleString("ru-RU")} ₽`;
const short = (n) => (Math.abs(n) >= 1000 ? `${Math.round(n / 100) / 10}к` : String(Math.round(n)));
const haptic = (type = "light") => tg?.HapticFeedback?.impactOccurred(type);
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
const alertDialog = (text) => (tg?.showAlert ? tg.showAlert(text) : window.alert(text));
const confirmDialog = (text) =>
  new Promise((resolve) => (tg?.showConfirm ? tg.showConfirm(text, resolve) : resolve(window.confirm(text))));

async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `tma ${tg?.initData || ""}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.detail || data.error || res.statusText), { status: res.status, data });
  return data;
}

function openTelegram(nick) {
  const url = `https://t.me/${nick.replace(/^@/, "")}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, "_blank");
}

// ---------- bottom sheet ----------
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
function closeSheet() {
  document.querySelector(".sheet-wrap")?.remove();
}

// ---------- shared pieces ----------
const statusPill = (status) => `<span class="pill st-${status}">${STATUS_SHORT[status]}</span>`;
const stageBadge = (stage) => `<span class="badge s-${stage}">${STAGE_LABELS[stage] || stage}</span>`;

function leadRow(lead, sub, right) {
  return `<button class="row" data-open="${lead.id}">
    <div class="grow">
      <div class="title">${esc(leadTitle(lead))}</div>
      <div class="sub">${sub}</div>
    </div>
    <div class="right">${right}</div>
  </button>`;
}

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
  tg?.BackButton[state.leadId || state.more ? "show" : "hide"]();
  $tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  if (state.leadId) return renderLead();
  if (state.tab === "today") return renderToday();
  if (state.tab === "leads") return renderLeads();
  if (state.tab === "stats") return renderStats();
  if (state.tab === "more") return renderMore();
}

function go(patch) {
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

  $app.innerHTML = `
    <div class="hello">
      <div>
        <h1>Сегодня</h1>
        <div class="sub">${esc(dateText)} · ${tasks ? `${tasks} ${plural(tasks, "задача", "задачи", "задач")}` : "срочного нет"}</div>
      </div>
      <button class="btn round" id="addLead" aria-label="Новый лид">＋</button>
    </div>

    <div class="kpis">
      <div class="kpi accent"><div class="label">Засчитано за 7 дней</div><div class="value">${rub(week)}</div>
        <div class="hint">${!week && !prevWeek ? "считается по засчётам в CRM" : delta === null ? "чистыми ≈ " + rub(netOf(week, state.settings)) : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% к прошлой неделе`}</div></div>
      <div class="kpi"><div class="label">Ждём засчёта</div><div class="value">${rub(t.waiting)}</div><div class="hint">ЦД сделали, денег нет</div></div>
      <div class="kpi"><div class="label">В работе</div><div class="value">${rub(t.inWork)}</div><div class="hint">заявки и открытые счета</div></div>
    </div>

    ${section("🔔", "Напоминания", w.reminders, (r) =>
      leadRow(r.lead, esc(r.lead.nextStep || "Без описания"), `<span class="badge ${r.overdue ? "warn" : ""}">${r.overdue ? "просрочено " + fmtDate(r.lead.remindAt) : "сегодня"}</span>`),
      { filter: "remind", max: 10 },
    )}
    ${section("🎯", "Нужна ЦД — счёт открыт", w.needCd, (x) =>
      leadRow(x.lead, esc(x.items.map((i) => i.name.replace(/ — РКО$/, "")).join(", ")), `<b>${rub(x.sum)}</b>${x.days ? `<div class="sub">${x.days} дн.</div>` : ""}`),
      { empty: "Открытых счетов без ЦД нет", filter: "cd" },
    )}
    ${section("📞", "Ждут засчёта — пинать партнёрку", w.waiting, (x) =>
      leadRow(x.lead, esc(x.items.map((i) => i.name.replace(/ — РКО$/, "")).join(", ")), `<b>${rub(x.sum)}</b>${x.days ? `<div class="sub ${x.days >= 5 ? "danger" : ""}">${x.days} дн.</div>` : ""}`),
      { filter: "waiting" },
    )}
    ${section("📝", "Заявки заведены — довести до счёта", w.applied, (x) =>
      leadRow(x.lead, esc(x.items.map((i) => i.name.replace(/ — РКО$/, "")).join(", ")), `<b>${rub(x.sum)}</b>${x.days ? `<div class="sub">${x.days} дн.</div>` : ""}`),
      { filter: "applied" },
    )}
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
  }[state.filter];
  const list = state.leads
    .filter(pass)
    .filter((l) => !q || `${l.telegram} ${l.fio} ${l.source} ${l.nextStep || ""}`.toLowerCase().includes(q))
    .map((l) => ({ l, m: money(l) }));
  const sorters = {
    recent: (a, b) => b.l.updatedAt.localeCompare(a.l.updatedAt),
    inwork: (a, b) => b.m.inWork - a.m.inWork,
    net: (a, b) => b.m.net - a.m.net,
    idle: (a, b) => a.l.updatedAt.localeCompare(b.l.updatedAt),
  };
  return list.sort(sorters[state.sort]);
}

function renderLeads() {
  const list = filterLeads();
  $app.innerHTML = `
    <div class="toolbar">
      <input id="q" type="search" placeholder="🔍 Ник, ФИО, источник" value="${esc(state.query)}" autocomplete="off">
      <button class="btn round" id="addLead" aria-label="Новый лид">＋</button>
    </div>
    <div class="chips">
      ${FILTERS.map(([f, label]) => `<button class="chip ${state.filter === f ? "active" : ""}" data-filter="${f}">${label}</button>`).join("")}
    </div>
    <div class="list-head">
      <span>${list.length} ${plural(list.length, "лид", "лида", "лидов")}</span>
      <select id="sort">${SORTS.map(([s, label]) => `<option value="${s}" ${state.sort === s ? "selected" : ""}>${label}</option>`).join("")}</select>
    </div>
    <div id="leadList">${leadListHtml(list)}</div>`;

  const $q = document.getElementById("q");
  $q.addEventListener("input", () => {
    state.query = $q.value;
    document.getElementById("leadList").innerHTML = leadListHtml(filterLeads());
  });
  document.getElementById("sort").onchange = (e) => {
    state.sort = e.target.value;
    renderLeads();
  };
  document.getElementById("addLead").onclick = addLeadSheet;
}

function leadListHtml(list) {
  if (!list.length) return `<div class="card empty">Никого не нашёл</div>`;
  return `<div class="list">${list
    .map(({ l, m }) => {
      const cd = Object.values(l.offers || {}).filter((o) => o.status === "opened").length;
      const bits = [stageBadge(l.stage)];
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
    <label class="field"><span>Откуда пришёл</span><input id="nSrc" placeholder="YouTube, Reels, партнёр…" list="srcList"></label>
    <datalist id="srcList">${sources.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
    <button class="btn block" id="nSave">Создать и открыть</button>`,
    (el) => {
      el.querySelector("#nTg").focus();
      el.querySelector("#nSave").onclick = async () => {
        const body = { telegram: el.querySelector("#nTg").value, fio: el.querySelector("#nFio").value, source: el.querySelector("#nSrc").value };
        if (!body.telegram.trim() && !body.fio.trim()) return toast("Нужен ник или ФИО");
        const dup = body.telegram && state.leads.find((l) => l.telegram.toLowerCase() === `@${body.telegram.replace(/^@/, "")}`.toLowerCase());
        if (dup && !(await confirmDialog(`${dup.telegram} уже есть в базе. Всё равно создать?`))) return;
        try {
          const lead = await api("POST", "/leads", body);
          state.leads.unshift(lead);
          haptic("medium");
          go({ leadId: lead.id });
        } catch (e) {
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
    <div class="lead-head">
      <div class="grow">
        <h1>${esc(leadTitle(lead))}</h1>
        <div class="sub">${[lead.telegram && lead.fio ? esc(lead.fio) : "", lead.source ? "из " + esc(lead.source) : "", isAdmin() && lead.ownerName ? "ведёт " + esc(lead.ownerName) : ""].filter(Boolean).join(" · ")}</div>
      </div>
      ${nick ? `<button class="btn ghost" id="write">✉️ Написать</button>` : ""}
    </div>

    <div class="chips stages">
      ${Object.entries(STAGE_LABELS).map(([s, label]) => `<button class="chip ${lead.stage === s ? "active" : ""}" data-stage="${s}">${label}</button>`).join("")}
    </div>

    <div class="kpis three">
      <div class="kpi"><div class="label">Чистая</div><div class="value money-green">${rub(m.net)}</div></div>
      <div class="kpi"><div class="label">В работе</div><div class="value money-orange">${rub(m.inWork)}</div></div>
      <div class="kpi"><div class="label">Ждём засчёта</div><div class="value">${rub(m.waiting)}</div></div>
    </div>

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
  $app.querySelectorAll("[data-stage]").forEach((b) => (b.onclick = () => b.dataset.stage !== lead.stage && saveLead(lead.id, { stage: b.dataset.stage })));
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
    <div class="sub">${[o.partner, lo.comment].filter(Boolean).map(esc).join(" · ")}</div></div>
  <div class="right">${statusPill(lo.status)}<div class="sub">${rub(lo.amount)}${lo.changedAt ? " · " + fmtDate(lo.changedAt.slice(0, 10)) : ""}</div></div>
</button>`;

const addLocal = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localKey(d);
};

function offerSheet(lead, offerId) {
  const o = offerById(offerId);
  const lo = lead.offers[offerId] || { status: "none", amount: o.amount, cost: o.cost || 0, comment: "" };
  openSheet(
    `<h2 class="sheet-title">${esc(o.name)}</h2>
    <div class="sub" style="margin:-6px 4px 12px">${[o.partner, CATEGORY_LABELS[o.category], o.note].filter(Boolean).map(esc).join(" · ")}</div>
    <div class="status-grid">
      ${QUICK_STATUSES.map((s) => `<button class="status-btn st-${s} ${lo.status === s ? "current" : ""}" data-set="${s}">${STATUS_LABELS[s]}</button>`).join("")}
    </div>
    <div class="two">
      <label class="field"><span>Ставка, ₽</span><input id="oAmount" type="number" inputmode="decimal" value="${lo.amount}"></label>
      <label class="field"><span>Затраты, ₽</span><input id="oCost" type="number" inputmode="decimal" value="${lo.cost || 0}"></label>
    </div>
    <label class="field"><span>Комментарий</span><input id="oComment" value="${esc(lo.comment || "")}" placeholder="«Провели 2300», «ЛК ${esc(state.settings.partnerName)}»"></label>
    <button class="btn block" id="oSave">Сохранить ставку и комментарий</button>`,
    (el) => {
      el.querySelectorAll("[data-set]").forEach(
        (b) =>
          (b.onclick = () => {
            closeSheet();
            if (b.dataset.set !== lo.status) saveLead(lead.id, { offers: { [offerId]: { status: b.dataset.set } } }, `${o.name.replace(/ — РКО$/, "")}: ${STATUS_SHORT[b.dataset.set]}`);
          }),
      );
      el.querySelector("#oSave").onclick = () => {
        closeSheet();
        saveLead(lead.id, { offers: { [offerId]: { amount: el.querySelector("#oAmount").value, cost: el.querySelector("#oCost").value, comment: el.querySelector("#oComment").value } } }, "Сохранено");
      };
    },
  );
}

function addOfferSheet(lead) {
  const free = (cat) => state.offers.filter((o) => o.category === cat && o.active && (!lead.offers[o.id] || lead.offers[o.id].status === "none"));
  const cats = Object.keys(CATEGORY_LABELS).filter((c) => free(c).length);
  openSheet(
    `<h2 class="sheet-title">Добавить оффер</h2>
    <div class="sub" style="margin:-6px 4px 10px">Тап — заявка заведена. Статус потом меняется в один тап.</div>
    ${cats
      .map(
        (c) => `<h2>${CATEGORY_LABELS[c]}</h2><div class="offer-grid">${free(c)
          .map((o) => `<button class="offer-chip" data-add="${o.id}"><b>${esc(o.name.replace(/ — РКО$/, ""))}</b><span>${o.amount ? rub(o.amount) : "ставка ?"}</span></button>`)
          .join("")}</div>`,
      )
      .join("") || `<div class="card empty">Все офферы уже в работе</div>`}`,
    (el) =>
      el.querySelectorAll("[data-add]").forEach(
        (b) =>
          (b.onclick = () => {
            closeSheet();
            const o = offerById(b.dataset.add);
            saveLead(lead.id, { offers: { [o.id]: { status: "applied" } } }, `${o.name.replace(/ — РКО$/, "")}: заявка заведена`);
          }),
      ),
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
  } catch (e) {
    toast(`Не сохранилось: ${e.message}`);
  }
}

async function deleteLead(id) {
  if (!(await confirmDialog("Удалить лида насовсем?"))) return;
  try {
    await api("DELETE", `/leads/${id}`);
    state.leads = state.leads.filter((l) => l.id !== id);
    go({ leadId: null });
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

function barChart(days) {
  const max = Math.max(1, ...days.map((d) => d.sum));
  const w = 320, h = 120, gap = 2;
  const bw = Math.max(2, (w - gap * (days.length - 1)) / days.length);
  const bars = days
    .map((d, i) => {
      const bh = d.sum ? Math.max(3, (d.sum / max) * (h - 4)) : 0;
      const x = i * (bw + gap), y = h - bh, r = Math.min(4, bw / 2, bh);
      const path = bh ? `M${x},${h} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${h} Z` : "";
      return `<g data-bar="${i}"><rect x="${x - gap / 2}" y="0" width="${bw + gap}" height="${h}" fill="transparent"/>${path ? `<path d="${path}" class="bar"/>` : ""}</g>`;
    })
    .join("");
  return `<div class="chart">
    <div class="chart-tip" id="tip">Тапни на столбик</div>
    <svg viewBox="0 0 ${w} ${h + 1}" preserveAspectRatio="none" role="img" aria-label="Засчитано по дням">${bars}<line x1="0" x2="${w}" y1="${h + 0.5}" y2="${h + 0.5}" class="axis"/></svg>
    <div class="chart-x"><span>${fmtDate(days[0].day)}</span><span>${fmtDate(days[days.length - 1].day)}</span></div>
  </div>`;
}

function hbars(rows, valueText) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<div class="list">${rows
    .map(
      (r) => `<div class="hbar"><div class="hbar-top"><span>${esc(r.label)}</span><b>${valueText(r)}</b></div>
        <div class="bar-track"><i style="width:${(r.value / max) * 100}%"></i></div>${r.note ? `<div class="sub">${r.note}</div>` : ""}</div>`,
    )
    .join("")}</div>`;
}

function renderStats() {
  const range = periodRange();
  const all = paidEvents(state.leads, state.offers);
  const inRange = range ? all.filter((e) => e.day && e.day >= range.from && e.day <= range.to) : all;
  const undated = range ? 0 : all.filter((e) => !e.day).length;
  const income = inRange.reduce((s, e) => s + e.amount, 0);
  const leadsWithMoney = new Set(inRange.map((e) => e.lead.id));
  const totals = sumMoney(state.leads.map(money));
  const everPaid = new Set(all.map((e) => e.lead.id)).size;

  // по дням
  let chart = "";
  if (range) {
    const days = [];
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) days.push({ day: d, sum: 0, n: 0 });
    for (const e of inRange) {
      const slot = days.find((d) => d.day === e.day);
      if (slot) {
        slot.sum += e.amount;
        slot.n++;
      }
    }
    chart = `<h2>Засчитано по дням</h2>${barChart(days)}`;
    state._days = days;
  }

  // офферы: деньги и конверсия (по всем лидам, за всё время)
  const byOffer = new Map();
  for (const l of state.leads)
    for (const [id, lo] of Object.entries(l.offers || {})) {
      if (lo.status === "none") continue;
      const r = byOffer.get(id) || { tried: 0, paid: 0 };
      if (lo.status !== "exists") r.tried++;
      byOffer.set(id, r);
    }
  const offerRows = new Map();
  for (const e of inRange) {
    const r = offerRows.get(e.offerId) || { label: e.name.replace(/ — РКО$/, ""), value: 0, n: 0, id: e.offerId };
    r.value += e.amount;
    r.n++;
    offerRows.set(e.offerId, r);
  }
  for (const l of state.leads) for (const [id, lo] of Object.entries(l.offers || {})) if (lo.status === "paid" && byOffer.get(id)) byOffer.get(id).paid++;
  const topOffers = [...offerRows.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
    .map((r) => {
      const c = byOffer.get(r.id);
      return { ...r, note: c?.tried ? `конверсия ${Math.round((c.paid / c.tried) * 100)}% · засчитано ${c.paid} из ${c.tried} попыток` : "" };
    });

  const group = (keyOf) => {
    const m = new Map();
    for (const e of inRange) {
      const k = keyOf(e) || "Не указано";
      m.set(k, (m.get(k) || 0) + e.amount);
    }
    return [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };
  const byPartner = group((e) => e.partner);
  const bySource = group((e) => e.lead.source);
  const byOwner = group((e) => e.lead.ownerName);

  const counts = Object.fromEntries(Object.keys(STAGE_LABELS).map((s) => [s, 0]));
  state.leads.forEach((l) => (counts[l.stage] = (counts[l.stage] || 0) + 1));

  $app.innerHTML = `
    <h1>Статистика</h1>
    <div class="chips">${PERIODS.map(([p, label]) => `<button class="chip ${state.period === p ? "active" : ""}" data-period="${p}">${label}</button>`).join("")}</div>

    <div class="kpis">
      <div class="kpi accent"><div class="label">Засчитано</div><div class="value">${rub(income)}</div><div class="hint">${inRange.length} ${plural(inRange.length, "оффер", "оффера", "офферов")}</div></div>
      <div class="kpi"><div class="label">Чистыми ≈</div><div class="value money-green">${rub(range ? netOf(income, state.settings) : totals.net)}</div><div class="hint">${range ? "после налога и доли, до затрат" : "после всех вычетов"}</div></div>
      <div class="kpi"><div class="label">Средний чек лида</div><div class="value">${rub(leadsWithMoney.size ? income / leadsWithMoney.size : 0)}</div><div class="hint">${leadsWithMoney.size} ${plural(leadsWithMoney.size, "лид", "лида", "лидов")} принесли деньги</div></div>
      <div class="kpi"><div class="label">Лид → деньги</div><div class="value">${state.leads.length ? Math.round((everPaid / state.leads.length) * 100) : 0}%</div><div class="hint">${everPaid} из ${state.leads.length} за всё время</div></div>
    </div>
    ${undated ? `<div class="sub note">${undated} засчётов перенесены из таблицы без даты — они видны только во «Всё время».</div>` : ""}

    ${chart}
    ${topOffers.length ? `<h2>Топ офферов</h2>${hbars(topOffers, (r) => `${rub(r.value)} · ${r.n}×`)}` : `<div class="card empty">За этот период засчётов нет</div>`}
    ${byPartner.length ? `<h2>Партнёрские сети</h2>${hbars(byPartner, (r) => rub(r.value))}` : ""}
    ${bySource.length > 1 || (bySource[0] && bySource[0].label !== "Не указано") ? `<h2>Источники лидов</h2>${hbars(bySource, (r) => rub(r.value))}` : ""}
    ${byOwner.length > 1 ? `<h2>Кто завёл лида</h2>${hbars(byOwner, (r) => rub(r.value))}` : ""}

    <h2>Воронка · ${state.leads.length} ${plural(state.leads.length, "лид", "лида", "лидов")}</h2>
    ${hbars(Object.entries(counts).map(([s, n]) => ({ label: STAGE_LABELS[s], value: n })), (r) => String(r.value))}

    <h2>Отчётный лист · всё время</h2>
    ${reportRows(totals)}`;

  $app.querySelectorAll("[data-period]").forEach((b) => (b.onclick = () => go({ period: b.dataset.period })));
  $app.querySelectorAll("[data-bar]").forEach(
    (g) =>
      (g.onclick = () => {
        const d = state._days[+g.dataset.bar];
        $app.querySelectorAll(".bar.sel").forEach((x) => x.classList.remove("sel"));
        g.querySelector(".bar")?.classList.add("sel");
        document.getElementById("tip").textContent = `${fmtDate(d.day)}: ${rub(d.sum)}${d.n ? ` · ${d.n} ${plural(d.n, "засчёт", "засчёта", "засчётов")}` : ""}`;
      }),
  );
}

// ---------- ЕЩЁ ----------
function renderMore() {
  if (state.more === "offers") return renderOffers();
  if (state.more === "settings") return renderSettings();
  if (state.more === "team") return renderTeam();
  if (state.more === "data") return renderData();
  const items = [
    ["offers", "🏦", "Офферы и ставки", isAdmin() ? "Каталог банков и МФО" : "Каталог банков и МФО (просмотр)"],
    ...(isAdmin()
      ? [
          ["data", "💾", "Бэкап и выгрузка", "Файлы со всеми лидами в Telegram, импорт"],
          ["settings", "🧮", "Расчёт", `${state.settings.partnerName} ${state.settings.partnerShare}% · налог ${state.settings.taxRate}%`],
          ["team", "👥", "Команда", "Кто имеет доступ"],
        ]
      : []),
  ];
  $app.innerHTML = `
    <h1>Ещё</h1>
    <div class="list">${items
      .map(([k, icon, title, sub]) => `<button class="row" data-more="${k}"><div class="icon">${icon}</div><div class="grow"><div class="title">${title}</div><div class="sub">${esc(sub)}</div></div><div class="right sub">›</div></button>`)
      .join("")}</div>
    <div class="sub center">Утренняя сводка приходит в бота каждый день в 9:00 по Москве.<br>По понедельникам админам — ещё и бэкап.</div>`;
  $app.querySelectorAll("[data-more]").forEach((b) => (b.onclick = () => go({ more: b.dataset.more })));
}

function renderData() {
  $app.innerHTML = `
    <h1>Бэкап и выгрузка</h1>
    <div class="card">
      <div class="title">📤 Прислать в Telegram</div>
      <div class="sub" style="margin:4px 0 10px">Бот пришлёт тебе в чат 3 файла: полный бэкап (его можно загрузить обратно), таблицу лидов с деньгами и таблицу всех офферов — открываются в Excel и Google Таблицах.</div>
      <button class="btn block" id="backup">Прислать файлы</button>
    </div>
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
      alertDialog(`Готово: файлы с ${r.leads} лидами в чате с ботом.`);
    } catch (err) {
      alertDialog(`Не отправилось: ${err.message}. Проверь, что ты нажимал /start в боте.`);
    }
    e.target.disabled = false;
    e.target.textContent = "Прислать файлы";
  };
  const runImport = async (text) => {
    try {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("это не JSON-файл импорта");
      }
      const leads = Array.isArray(parsed) ? parsed : parsed.leads;
      if (!Array.isArray(leads)) throw new Error("в файле нет списка лидов");
      const r = await api("POST", "/import", { leads });
      await reload();
      haptic("medium");
      alertDialog(`Импорт готов: новых ${r.created}, обновлено ${r.updated}`);
    } catch (err) {
      alertDialog(`Импорт не удался: ${err.message}`);
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

function renderSettings() {
  const s = state.settings;
  $app.innerHTML = `
    <h1>Расчёт</h1>
    <div class="card">
      <label class="field"><span>Партнёр (доля от дохода после налога)</span><input id="sName" value="${esc(s.partnerName)}"></label>
      <div class="two">
        <label class="field"><span>Доля партнёра, %</span><input id="sShare" type="number" inputmode="decimal" value="${s.partnerShare}"></label>
        <label class="field"><span>Налог, %</span><input id="sTax" type="number" inputmode="decimal" value="${s.taxRate}"></label>
      </div>
      <div class="sub" style="margin:4px 4px 10px">Чистая = доход − налог − доля партнёра от (доход − налог) − затраты − выплачено лиду</div>
      <button class="btn block" id="saveSettings">Сохранить</button>
    </div>`;
  document.getElementById("saveSettings").onclick = async () => {
    try {
      state.settings = await api("PUT", "/settings", {
        partnerName: document.getElementById("sName").value,
        partnerShare: Number(document.getElementById("sShare").value),
        taxRate: Number(document.getElementById("sTax").value),
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
  const open = e.target.closest("[data-open]");
  if (open) return go({ leadId: open.dataset.open });
  const jump = e.target.closest("[data-goto]");
  if (jump) return go({ tab: "leads", filter: jump.dataset.goto, query: "", sort: "inwork" });
  const chip = e.target.closest("[data-filter]");
  if (chip) {
    state.filter = chip.dataset.filter;
    renderLeads();
  }
});

$tabs.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tab]");
  if (btn) go({ tab: btn.dataset.tab, leadId: null, more: null });
});

tg?.BackButton.onClick(() => {
  if (document.querySelector(".sheet-wrap")) return closeSheet();
  if (state.leadId) return go({ leadId: null });
  go({ more: null });
});

async function reload() {
  const data = await api("GET", "/state");
  Object.assign(state, { me: data.me, offers: data.offers, settings: data.settings, leads: data.leads });
  render();
}

reload()
  .then(() => ($tabs.hidden = false))
  .catch((e) => {
    $app.innerHTML =
      e.status === 403
        ? `<div class="card empty">Запрос на доступ отправлен.<br>Попроси админа выдать доступ: «Ещё» → «Команда».<br><span style="font-size:12px">Твой Telegram ID: ${esc(e.data.userId)}</span></div>`
        : e.status === 401
          ? `<div class="card empty">${esc(AUTH_ERRORS[e.data.reason] || "Открой приложение через бота в Telegram.")}<br><span style="font-size:12px">код: ${esc(e.data.reason || "—")}</span></div>`
          : `<div class="card empty">Ошибка загрузки: ${esc(e.message)}</div>`;
  });
