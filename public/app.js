"use strict";

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const STAGE_LABELS = {
  new: "Новый",
  in_work: "В работе",
  ip: "ИП открыт",
  offers: "Докрутка",
  closed: "Цикл закрыт",
  lost: "Слился",
};
const STATUS_LABELS = {
  none: "—",
  in_progress: "В процессе",
  done: "Оформлен",
  paid: "Выплачено",
  rejected: "Отказ",
};
const ACTIVE_STAGES = new Set(["new", "in_work", "ip", "offers"]);

const state = {
  me: null,
  offers: [],
  leads: [],
  tab: "dashboard",
  leadId: null,
  filter: "all",
  query: "",
};

const $app = document.getElementById("app");
const $tabs = document.getElementById("tabs");

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rub = (n) => `${Math.round(n || 0).toLocaleString("ru-RU")} ₽`;
const haptic = (type = "light") => tg?.HapticFeedback?.impactOccurred(type);

function toast(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 1800);
}

function confirmDialog(text) {
  return new Promise((resolve) => (tg?.showConfirm ? tg.showConfirm(text, resolve) : resolve(window.confirm(text))));
}

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

// Деньги по одному лиду: сколько уже пришло, сколько ждём, сколько ещё можно докрутить.
function leadMoney(lead) {
  const r = { paid: 0, pending: 0, inProgress: 0, untouched: 0 };
  const active = ACTIVE_STAGES.has(lead.stage);
  for (const offer of state.offers) {
    const lo = lead.offers[offer.id];
    const status = lo?.status || "none";
    const amount = lo ? lo.amount : offer.amount;
    if (status === "paid") r.paid += amount;
    else if (status === "done") r.pending += amount;
    else if (status === "in_progress" && active) r.inProgress += amount;
    else if (status === "none" && active && offer.active) r.untouched += amount;
  }
  r.potential = r.inProgress + r.untouched;
  return r;
}

function totals(leads) {
  return leads.reduce(
    (t, l) => {
      const m = leadMoney(l);
      t.paid += m.paid;
      t.pending += m.pending;
      t.inProgress += m.inProgress;
      t.potential += m.potential;
      return t;
    },
    { paid: 0, pending: 0, inProgress: 0, potential: 0 },
  );
}

function contactLink(contact) {
  const c = (contact || "").trim();
  if (/^@\w{3,}$/.test(c)) return `<a href="https://t.me/${esc(c.slice(1))}">${esc(c)}</a>`;
  if (/^\+?[\d\s()-]{7,}$/.test(c)) return `<a href="tel:${esc(c.replace(/[^\d+]/g, ""))}">${esc(c)}</a>`;
  return esc(c);
}

// ---------- rendering ----------
function render() {
  tg?.BackButton[state.leadId ? "show" : "hide"]();
  $tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  if (state.leadId) return renderLead();
  if (state.tab === "dashboard") return renderDashboard();
  if (state.tab === "leads") return renderLeads();
  if (state.tab === "offers") return renderOffers();
}

function leadRow(lead, right) {
  return `<button class="row" data-open="${lead.id}">
    <div class="grow">
      <div class="title">${esc(lead.name)}</div>
      <div class="sub"><span class="badge s-${lead.stage}">${STAGE_LABELS[lead.stage]}</span>
        ${state.me.role === "admin" && lead.ownerName ? ` · ${esc(lead.ownerName)}` : ""}</div>
    </div>
    <div class="right">${right}</div>
  </button>`;
}

function renderDashboard() {
  const t = totals(state.leads);
  const active = state.leads.filter((l) => ACTIVE_STAGES.has(l.stage));
  const counts = Object.fromEntries(Object.keys(STAGE_LABELS).map((s) => [s, 0]));
  state.leads.forEach((l) => counts[l.stage]++);
  const max = Math.max(1, ...Object.values(counts));

  const toPush = active
    .map((l) => ({ l, m: leadMoney(l) }))
    .filter((x) => x.m.potential > 0)
    .sort((a, b) => b.m.potential - a.m.potential)
    .slice(0, 7);

  $app.innerHTML = `
    <h1>Привет, ${esc(state.me.name)}</h1>
    <div class="stats">
      <div class="card stat accent"><div class="label">Получено</div><div class="value">${rub(t.paid)}</div></div>
      <div class="card stat"><div class="label">Ждём выплату</div><div class="value">${rub(t.pending)}</div></div>
      <div class="card stat"><div class="label">В процессе</div><div class="value">${rub(t.inProgress)}</div></div>
      <div class="card stat"><div class="label">Недокрут (потенциал)</div><div class="value money-orange">${rub(t.potential)}</div></div>
    </div>

    <h2>Воронка · ${state.leads.length} лидов, активных ${active.length}</h2>
    <div class="card">
      ${Object.entries(counts)
        .map(
          ([s, n]) => `<div style="margin-bottom:8px">
            <div style="display:flex;justify-content:space-between"><span>${STAGE_LABELS[s]}</span><b>${n}</b></div>
            <div class="bar"><i style="width:${(n / max) * 100}%"></i></div></div>`,
        )
        .join("")}
    </div>

    <h2>Кого докрутить в первую очередь</h2>
    ${
      toPush.length
        ? `<div class="list">${toPush.map(({ l, m }) => leadRow(l, `<span class="money-orange">+${rub(m.potential)}</span>`)).join("")}</div>`
        : `<div class="card empty">Пока пусто. Добавь первого лида во вкладке «Лиды».</div>`
    }`;
}

function renderLeads() {
  const q = state.query.toLowerCase();
  const list = state.leads.filter(
    (l) =>
      (state.filter === "all" || l.stage === state.filter) &&
      (!q || `${l.name} ${l.contact} ${l.source}`.toLowerCase().includes(q)),
  );
  $app.innerHTML = `
    <div class="toolbar">
      <input id="q" type="search" placeholder="Поиск: имя, @ник, источник" value="${esc(state.query)}">
      <button class="btn" id="add">+ Лид</button>
    </div>
    <div class="chips">
      ${[["all", "Все"], ...Object.entries(STAGE_LABELS)]
        .map(([s, label]) => `<button class="chip ${state.filter === s ? "active" : ""}" data-filter="${s}">${label}</button>`)
        .join("")}
    </div>
    ${
      list.length
        ? `<div class="list">${list
            .map((l) => {
              const m = leadMoney(l);
              return leadRow(
                l,
                `<div class="money-green">${rub(m.paid + m.pending)}</div>${m.potential ? `<div class="money-orange">+${rub(m.potential)}</div>` : ""}`,
              );
            })
            .join("")}</div>`
        : `<div class="card empty">Никого не нашёл</div>`
    }`;

  const $q = document.getElementById("q");
  $q.addEventListener("input", () => {
    state.query = $q.value;
    const pos = $q.selectionStart;
    renderLeads();
    const next = document.getElementById("q");
    next.focus();
    next.setSelectionRange(pos, pos);
  });
  document.getElementById("add").onclick = addLead;
}

function renderLead() {
  const lead = state.leads.find((l) => l.id === state.leadId);
  if (!lead) {
    state.leadId = null;
    return render();
  }
  const m = leadMoney(lead);
  const offers = state.offers.filter((o) => o.active || lead.offers[o.id]);

  $app.innerHTML = `
    <h1>${esc(lead.name)}</h1>
    <div class="stats">
      <div class="card stat"><div class="label">Заработано</div><div class="value money-green">${rub(m.paid + m.pending)}</div></div>
      <div class="card stat"><div class="label">Можно докрутить</div><div class="value money-orange">${rub(m.potential)}</div></div>
    </div>

    <h2>Карточка</h2>
    <label class="field"><span>Имя</span><input data-f="name" value="${esc(lead.name)}"></label>
    <label class="field"><span>Контакт (@ник или телефон) ${lead.contact ? "· " + contactLink(lead.contact) : ""}</span>
      <input data-f="contact" value="${esc(lead.contact)}" placeholder="@username"></label>
    <label class="field"><span>Источник</span><input data-f="source" value="${esc(lead.source)}" placeholder="YouTube, Reels, партнёр…"></label>
    <label class="field"><span>Этап</span><select data-f="stage">
      ${Object.entries(STAGE_LABELS).map(([s, label]) => `<option value="${s}" ${lead.stage === s ? "selected" : ""}>${label}</option>`).join("")}
    </select></label>
    <label class="field"><span>Заметки</span><textarea data-f="note" placeholder="Что обсудили, что дальше">${esc(lead.note)}</textarea></label>

    <h2>Маршрут по офферам</h2>
    <div class="list">
      ${offers
        .map((o) => {
          const lo = lead.offers[o.id] || { status: "none", amount: o.amount };
          return `<div class="offer-row st-${lo.status}">
            <div><div class="title">${esc(o.name)}</div><div class="sub">${esc(o.partner)}${o.note ? " · " + esc(o.note) : ""}</div></div>
            <select data-offer="${o.id}" data-k="status">
              ${Object.entries(STATUS_LABELS).map(([s, label]) => `<option value="${s}" ${lo.status === s ? "selected" : ""}>${label}</option>`).join("")}
            </select>
            <input class="amount" data-offer="${o.id}" data-k="amount" type="number" inputmode="numeric" min="0" value="${lo.amount}">
          </div>`;
        })
        .join("")}
    </div>
    <div class="sub" style="margin:8px 4px;color:var(--hint);font-size:12px">
      Добавлен ${new Date(lead.createdAt).toLocaleDateString("ru-RU")}${lead.ownerName ? " · " + esc(lead.ownerName) : ""}
    </div>
    ${state.me.role === "admin" ? `<button class="btn danger" id="del">Удалить лида</button>` : ""}`;

  $app.querySelectorAll("[data-f]").forEach((el) =>
    el.addEventListener("change", () => saveLead(lead.id, { [el.dataset.f]: el.value })),
  );
  $app.querySelectorAll("[data-offer]").forEach((el) =>
    el.addEventListener("change", () =>
      saveLead(lead.id, { offers: { [el.dataset.offer]: { [el.dataset.k]: el.value } } }),
    ),
  );
  document.getElementById("del")?.addEventListener("click", () => deleteLead(lead.id));
}

function renderOffers() {
  const admin = state.me.role === "admin";
  const sum = state.offers.filter((o) => o.active).reduce((s, o) => s + o.amount, 0);
  $app.innerHTML = `
    <h1>Офферы</h1>
    <div class="card stat"><div class="label">Полный маршрут по активным офферам</div><div class="value">${rub(sum)} с одного человека</div></div>
    <h2>${admin ? "Редактирование каталога" : "Каталог"}</h2>
    <div class="list" id="offers">
      ${state.offers
        .map((o, i) =>
          admin
            ? `<div class="offer-edit" data-i="${i}">
                <input class="full" data-k="name" value="${esc(o.name)}" placeholder="Название">
                <input data-k="partner" value="${esc(o.partner)}" placeholder="Партнёрка">
                <input data-k="amount" type="number" inputmode="numeric" value="${o.amount}" placeholder="₽">
                <input class="full" data-k="note" value="${esc(o.note)}" placeholder="Заметка">
                <label class="check"><input type="checkbox" data-k="active" ${o.active ? "checked" : ""}> Активен</label>
              </div>`
            : `<div class="row"><div class="grow"><div class="title">${esc(o.name)}</div>
                <div class="sub">${esc(o.partner)}${o.note ? " · " + esc(o.note) : ""}${o.active ? "" : " · неактивен"}</div></div>
                <div class="right"><b>${rub(o.amount)}</b></div></div>`,
        )
        .join("")}
    </div>
    ${admin ? `<button class="btn ghost block" id="addOffer">+ Добавить оффер</button><button class="btn block" id="saveOffers">Сохранить каталог</button>` : ""}`;

  if (!admin) return;
  const collect = () =>
    [...$app.querySelectorAll(".offer-edit")].map((row) => {
      const o = { ...state.offers[row.dataset.i] };
      row.querySelectorAll("[data-k]").forEach((el) => {
        o[el.dataset.k] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
      });
      return o;
    });
  document.getElementById("addOffer").onclick = () => {
    state.offers = [...collect(), { id: "", name: "Новый оффер", partner: "", amount: 0, active: true, note: "" }];
    renderOffers();
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

// ---------- actions ----------
async function addLead() {
  const name = (window.prompt("Имя лида") || "").trim();
  if (!name) return;
  try {
    const lead = await api("POST", "/leads", { name });
    state.leads.unshift(lead);
    state.leadId = lead.id;
    haptic("medium");
    render();
  } catch (e) {
    toast(`Ошибка: ${e.message}`);
  }
}

async function saveLead(id, patch) {
  try {
    const updated = await api("PATCH", `/leads/${id}`, patch);
    state.leads = state.leads.map((l) => (l.id === id ? updated : l));
    haptic();
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
    state.leadId = null;
    render();
  } catch (e) {
    toast(`Ошибка: ${e.message}`);
  }
}

// ---------- wiring ----------
$app.addEventListener("click", (e) => {
  const open = e.target.closest("[data-open]");
  if (open) {
    state.leadId = open.dataset.open;
    window.scrollTo(0, 0);
    return render();
  }
  const chip = e.target.closest("[data-filter]");
  if (chip) {
    state.filter = chip.dataset.filter;
    renderLeads();
  }
});

$tabs.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tab]");
  if (!btn) return;
  state.tab = btn.dataset.tab;
  state.leadId = null;
  window.scrollTo(0, 0);
  render();
});

tg?.BackButton.onClick(() => {
  state.leadId = null;
  render();
});

(async function init() {
  try {
    const data = await api("GET", "/state");
    Object.assign(state, { me: data.me, offers: data.offers, leads: data.leads });
    $tabs.hidden = false;
    render();
  } catch (e) {
    $app.innerHTML =
      e.status === 403
        ? `<div class="card empty">Нет доступа.<br>Твой Telegram ID: <b>${esc(e.data.userId)}</b><br>Передай его владельцу CRM.</div>`
        : e.status === 401
          ? `<div class="card empty">Открой приложение через бота в Telegram.</div>`
          : `<div class="card empty">Ошибка загрузки: ${esc(e.message)}</div>`;
  }
})();
