import { leadMoney, sumMoney, ACTIVE_STAGES } from "./economics.js";

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const STAGE_LABELS = {
  new: "Новый",
  in_work: "В работе",
  offers: "Докрутка",
  closed: "Цикл закрыт",
  lost: "Слился",
};
const STATUS_LABELS = {
  none: "—",
  applied: "Заявка заведена",
  opened: "Счёт открыт, нужна ЦД",
  done: "ЦД выполнено",
  paid: "Засчитано ✓",
  rejected: "Отказ",
  exists: "Уже есть / дубль",
};
const CATEGORY_LABELS = { rko: "РКО", mfo: "МФО", debit: "Дебетовые карты", credit: "Кредитные карты" };

const state = {
  me: null,
  offers: [],
  settings: { taxRate: 6, partnerShare: 15, partnerName: "Партнёр" },
  leads: [],
  tab: "dashboard",
  leadId: null,
  filter: "all",
  query: "",
  openCats: new Set(),
};

const $app = document.getElementById("app");
const $tabs = document.getElementById("tabs");

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rub = (n) => `${Math.round(n || 0).toLocaleString("ru-RU")} ₽`;
const haptic = (type = "light") => tg?.HapticFeedback?.impactOccurred(type);
const money = (lead) => leadMoney(lead, state.offers, state.settings);
const leadTitle = (l) => l.telegram || l.fio || "Без имени";

function toast(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 2000);
}

function alertDialog(text) {
  if (tg?.showAlert) tg.showAlert(text);
  else window.alert(text);
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

function contactLink(contact) {
  const c = (contact || "").trim();
  if (/^@\w{3,}$/.test(c)) return `<a href="https://t.me/${esc(c.slice(1))}">${esc(c)}</a>`;
  if (/^\+?[\d\s()-]{7,}$/.test(c)) return `<a href="tel:${esc(c.replace(/[^\d+]/g, ""))}">${esc(c)}</a>`;
  return esc(c);
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
  const sub = [lead.telegram && lead.fio ? esc(lead.fio) : "", state.me.role === "admin" ? esc(lead.ownerName) : ""].filter(Boolean).join(" · ");
  return `<button class="row" data-open="${lead.id}">
    <div class="grow">
      <div class="title">${esc(leadTitle(lead))}</div>
      <div class="sub"><span class="badge s-${lead.stage}">${STAGE_LABELS[lead.stage] || lead.stage}</span> ${sub}</div>
    </div>
    <div class="right">${right}</div>
  </button>`;
}

function renderDashboard() {
  const withMoney = state.leads.map((l) => ({ l, m: money(l) }));
  const t = sumMoney(withMoney.map((x) => x.m));
  const active = state.leads.filter((l) => ACTIVE_STAGES.has(l.stage));
  const zero = withMoney.filter((x) => x.m.income === 0 && ACTIVE_STAGES.has(x.l.stage)).length;

  const byCat = Object.fromEntries(Object.keys(CATEGORY_LABELS).map((c) => [c, 0]));
  const catOf = new Map(state.offers.map((o) => [o.id, o.category]));
  state.leads.forEach((l) =>
    Object.entries(l.offers).forEach(([id, lo]) => {
      if (lo.status === "paid") byCat[catOf.get(id) || "rko"] += lo.amount;
    }),
  );

  const counts = Object.fromEntries(Object.keys(STAGE_LABELS).map((s) => [s, 0]));
  state.leads.forEach((l) => (counts[l.stage] = (counts[l.stage] || 0) + 1));
  const max = Math.max(1, ...Object.values(counts));

  // Сначала те, у кого деньги уже в работе (заявки, открытые счета), потом по потолку.
  const toPush = withMoney
    .filter((x) => x.m.inWork > 0)
    .sort((a, b) => b.m.inWork - a.m.inWork)
    .slice(0, 10);

  $app.innerHTML = `
    <h1>Привет, ${esc(state.me.name)}</h1>
    <div class="stats">
      <div class="card stat accent"><div class="label">Чистая выручка</div><div class="value">${rub(t.net)}</div></div>
      <div class="card stat"><div class="label">ЦД выполнено, ждём засчёта</div><div class="value">${rub(t.waiting)}</div></div>
      <div class="card stat"><div class="label">Заявки и открытые счета</div><div class="value">${rub(t.inWork)}</div></div>
      <div class="card stat"><div class="label">Потолок: все РКО по активным лидам</div><div class="value money-orange">${rub(t.potential)}</div></div>
    </div>

    <h2>Отчётный лист</h2>
    ${reportRows(t)}

    <h2>Доход по категориям</h2>
    <div class="list">
      ${Object.entries(byCat).map(([c, v]) => `<div class="row"><div class="grow">${CATEGORY_LABELS[c]}</div><div class="right">${rub(v)}</div></div>`).join("")}
    </div>

    <h2>Воронка · ${state.leads.length} лидов, активных ${active.length}${zero ? `, без дохода ${zero}` : ""}</h2>
    <div class="card">
      ${Object.entries(counts)
        .map(
          ([s, n]) => `<div style="margin-bottom:8px">
            <div style="display:flex;justify-content:space-between"><span>${STAGE_LABELS[s] || s}</span><b>${n}</b></div>
            <div class="bar"><i style="width:${(n / max) * 100}%"></i></div></div>`,
        )
        .join("")}
    </div>

    <h2>Кого докрутить в первую очередь · деньги в работе</h2>
    ${
      toPush.length
        ? `<div class="list">${toPush.map(({ l, m }) => leadRow(l, `<span class="money-orange">${rub(m.inWork)}</span>`)).join("")}</div>`
        : `<div class="card empty">Нет заявок в работе. Заведи заявки по лидам во вкладке «Лиды».</div>`
    }`;
}

function renderLeads() {
  const q = state.query.toLowerCase();
  const list = state.leads.filter(
    (l) =>
      (state.filter === "all" || l.stage === state.filter) &&
      (!q || `${l.telegram} ${l.fio} ${l.source}`.toLowerCase().includes(q)),
  );
  $app.innerHTML = `
    <div class="toolbar">
      <input id="q" type="search" placeholder="Поиск: @ник, ФИО, источник" value="${esc(state.query)}">
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
              const m = money(l);
              return leadRow(
                l,
                `<div class="money-green">${rub(m.net)}</div>${m.potential ? `<div class="money-orange">+${rub(m.potential)}</div>` : ""}`,
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

function offerRow(o, lo) {
  if (lo.status === "none") {
    return `<div class="offer-row compact">
      <div class="head"><div class="title">${esc(o.name)}</div><div class="sub">${rub(lo.amount)}${o.partner ? " · " + esc(o.partner) : ""}${o.note ? " · " + esc(o.note) : ""}</div></div>
      <select data-offer="${o.id}" data-k="status">
        ${Object.entries(STATUS_LABELS).map(([s, label]) => `<option value="${s}" ${s === "none" ? "selected" : ""}>${s === "none" ? "＋ В работу" : label}</option>`).join("")}
      </select>
    </div>`;
  }
  return `<div class="offer-row st-${lo.status}">
    <div class="head"><div class="title">${esc(o.name)}</div><div class="sub">${esc(o.partner)}${o.note ? " · " + esc(o.note) : ""}</div></div>
    <select class="status" data-offer="${o.id}" data-k="status">
      ${Object.entries(STATUS_LABELS).map(([s, label]) => `<option value="${s}" ${lo.status === s ? "selected" : ""}>${label}</option>`).join("")}
    </select>
    <label class="mini"><span>Ставка</span><input data-offer="${o.id}" data-k="amount" type="number" inputmode="decimal" min="0" value="${lo.amount}"></label>
    <label class="mini"><span>Затраты</span><input data-offer="${o.id}" data-k="cost" type="number" inputmode="decimal" min="0" value="${lo.cost || 0}"></label>
    <input class="comment" data-offer="${o.id}" data-k="comment" value="${esc(lo.comment)}" placeholder="Комментарий: «Провели 2300», «ЛК ${esc(state.settings.partnerName)}»">
  </div>`;
}

function renderLead() {
  const lead = state.leads.find((l) => l.id === state.leadId);
  if (!lead) {
    state.leadId = null;
    return render();
  }
  const m = money(lead);

  const groups = Object.keys(CATEGORY_LABELS)
    .map((cat) => {
      const offers = state.offers.filter((o) => o.category === cat && (o.active || lead.offers[o.id]));
      if (!offers.length) return "";
      const touched = offers.filter((o) => lead.offers[o.id] && lead.offers[o.id].status !== "none");
      const paid = touched.filter((o) => lead.offers[o.id].status === "paid").reduce((s, o) => s + lead.offers[o.id].amount, 0);
      const open = state.openCats.has(cat);
      return `<details class="cat" data-cat="${cat}" ${open ? "open" : ""}>
        <summary><span>${CATEGORY_LABELS[cat]}</span><span class="sub">${touched.length}/${offers.length} · ${rub(paid)}</span></summary>
        <div class="list">${offers.map((o) => offerRow(o, lead.offers[o.id] || { status: "none", amount: o.amount, cost: o.cost || 0, comment: "" })).join("")}</div>
      </details>`;
    })
    .join("");

  $app.innerHTML = `
    <h1>${esc(leadTitle(lead))}</h1>
    <div class="stats">
      <div class="card stat"><div class="label">Чистая выручка</div><div class="value money-green">${rub(m.net)}</div></div>
      <div class="card stat"><div class="label">Можно докрутить</div><div class="value money-orange">${rub(m.potential)}</div></div>
    </div>

    <h2>Информация о клиенте</h2>
    <label class="field"><span>Telegram ${lead.telegram ? "· " + contactLink(lead.telegram) : ""}</span>
      <input data-f="telegram" value="${esc(lead.telegram)}" placeholder="@username"></label>
    <label class="field"><span>ФИО</span><input data-f="fio" value="${esc(lead.fio)}" placeholder="Фамилия Имя Отчество"></label>
    <label class="field"><span>Источник</span><input data-f="source" value="${esc(lead.source)}" placeholder="YouTube, Reels, партнёр…"></label>
    <div class="two">
      <label class="field"><span>Этап</span><select data-f="stage">
        ${Object.entries(STAGE_LABELS).map(([s, label]) => `<option value="${s}" ${lead.stage === s ? "selected" : ""}>${label}</option>`).join("")}
      </select></label>
      <label class="field"><span>Выплачено лиду, ₽</span><input data-f="payout" type="number" inputmode="decimal" min="0" value="${lead.payout || 0}"></label>
    </div>
    <label class="field"><span>Заметки</span><textarea data-f="note" placeholder="Что обсудили, что дальше">${esc(lead.note)}</textarea></label>

    <h2>Офферы</h2>
    ${groups}

    <h2>Расчёт по лиду</h2>
    ${reportRows(m)}
    <div class="sub" style="margin:8px 4px;color:var(--hint);font-size:12px">
      Добавлен ${new Date(lead.createdAt).toLocaleDateString("ru-RU")}${lead.ownerName ? " · " + esc(lead.ownerName) : ""}
    </div>
    ${state.me.role === "admin" ? `<button class="btn danger" id="del">Удалить лида</button>` : ""}`;

  $app.querySelectorAll("details.cat").forEach((d) =>
    d.addEventListener("toggle", () => state.openCats[d.open ? "add" : "delete"](d.dataset.cat)),
  );
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
  const s = state.settings;
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

  $app.innerHTML = `
    <h1>Офферы</h1>
    ${
      admin
        ? `<h2>Расчёт</h2>
      <div class="card offer-edit settings">
        <label class="mini full"><span>Партнёр (доля от дохода после налога)</span><input id="sName" value="${esc(s.partnerName)}"></label>
        <label class="mini"><span>Доля партнёра, %</span><input id="sShare" type="number" inputmode="decimal" value="${s.partnerShare}"></label>
        <label class="mini"><span>Налог, %</span><input id="sTax" type="number" inputmode="decimal" value="${s.taxRate}"></label>
        <button class="btn full" id="saveSettings">Сохранить расчёт</button>
      </div>`
        : ""
    }
    ${catalog}
    ${
      admin
        ? `<button class="btn ghost block" id="addOffer">+ Добавить оффер</button>
      <button class="btn block" id="saveOffers">Сохранить каталог</button>
      <h2>Импорт лидов</h2>
      <div class="card">
        <div class="sub" style="color:var(--hint);font-size:13px;margin-bottom:8px">Файл с лидами из таблиц (.json). Лиды с тем же Telegram обновятся, новые добавятся.</div>
        <label class="btn block" style="display:block;text-align:center">📄 Выбрать файл<input type="file" id="importFile" hidden></label>
        <div class="sub" style="color:var(--hint);font-size:13px;margin:14px 0 6px">Или вставь содержимое файла текстом:</div>
        <textarea id="importText" placeholder='{"leads": [...]}'></textarea>
        <button class="btn ghost block" id="importTextBtn">Импортировать текст</button>
      </div>`
        : ""
    }`;

  if (!admin) return;

  document.getElementById("saveSettings").onclick = async () => {
    try {
      state.settings = await api("PUT", "/settings", {
        partnerName: document.getElementById("sName").value,
        partnerShare: Number(document.getElementById("sShare").value),
        taxRate: Number(document.getElementById("sTax").value),
      });
      haptic("medium");
      toast("Расчёт сохранён");
      renderOffers();
    } catch (e) {
      toast(`Ошибка: ${e.message}`);
    }
  };

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
  const readFile = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("не удалось прочитать файл"));
      reader.readAsText(file);
    });
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
  document.getElementById("importFile").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    toast("Загружаю…");
    try {
      await runImport(await readFile(file));
    } catch (err) {
      alertDialog(`Импорт не удался: ${err.message}`);
    }
  };
  document.getElementById("importTextBtn").onclick = () => {
    const text = document.getElementById("importText").value.trim();
    if (text) runImport(text);
  };
}

// ---------- actions ----------
async function addLead() {
  const telegram = (window.prompt("Telegram лида (@ник) или ФИО") || "").trim();
  if (!telegram) return;
  const isNick = /^@?\w{3,}$/.test(telegram);
  try {
    const lead = await api("POST", "/leads", isNick ? { telegram } : { fio: telegram });
    state.leads.unshift(lead);
    state.leadId = lead.id;
    state.openCats = new Set(["rko"]);
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

function openLead(id) {
  const lead = state.leads.find((l) => l.id === id);
  const catOf = new Map(state.offers.map((o) => [o.id, o.category]));
  state.openCats = new Set(
    Object.entries(lead?.offers || {})
      .filter(([, lo]) => lo.status !== "none")
      .map(([oid]) => catOf.get(oid)),
  );
  if (!state.openCats.size) state.openCats.add("rko");
  state.leadId = id;
  window.scrollTo(0, 0);
  render();
}

// ---------- wiring ----------
$app.addEventListener("click", (e) => {
  const open = e.target.closest("[data-open]");
  if (open) return openLead(open.dataset.open);
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
        ? `<div class="card empty">Нет доступа.<br>Твой Telegram ID: <b>${esc(e.data.userId)}</b><br>Передай его владельцу CRM.</div>`
        : e.status === 401
          ? `<div class="card empty">Открой приложение через бота в Telegram.</div>`
          : `<div class="card empty">Ошибка загрузки: ${esc(e.message)}</div>`;
  });
