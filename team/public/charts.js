// Графики без библиотек: SVG, тонкие марки, скругление 4px на конце столбца, тап = подсказка.
// Цвета — из проверенной палитры (slot 1 синий, ordinal-рампа синего для воронки), задаются в styles.css.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const compact = (n) => {
  const a = Math.abs(n || 0);
  if (a >= 1_000_000) return `${Math.round((n / 1_000_000) * 10) / 10}м`;
  if (a >= 1000) return `${Math.round(n / 1000)}к`;
  return String(Math.round(n || 0));
};

// Столбец с закруглённым верхом и прямым основанием.
function colPath(x, y, w, h, r = 4) {
  if (h <= 0) return "";
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// Красивые деления оси: 0 / шаг / 2 шага …
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

// Столбики: items = [{ label, value, tip, accent? }]. Подписи X — только крайние и выборочные.
export function columns(items, { height = 150, title = "", fmt = compact, xEvery = null, empty = "Пока пусто" } = {}) {
  if (!items.length || items.every((i) => !i.value)) return `<div class="chart"><div class="chart-head"><b>${esc(title)}</b></div><div class="empty small">${empty}</div></div>`;
  const W = 340, H = height, padL = 30, padB = 18, padT = 8;
  const max = niceMax(Math.max(...items.map((i) => i.value)));
  const band = (W - padL) / items.length;
  const bw = Math.min(24, Math.max(2, band - 2));
  const ticks = [0, max / 2, max];
  const every = xEvery || Math.ceil(items.length / 6);
  let svg = ticks.map((t) => {
    const y = padT + (H - padT - padB) * (1 - t / max);
    return `<line class="grid" x1="${padL}" x2="${W}" y1="${y}" y2="${y}"/><text class="tick" x="${padL - 4}" y="${y + 3}" text-anchor="end">${esc(fmt(t))}</text>`;
  }).join("");
  items.forEach((it, i) => {
    const h = ((H - padT - padB) * it.value) / max;
    const x = padL + i * band + (band - bw) / 2;
    const y = H - padB - h;
    svg += `<path class="col ${it.accent ? "accent" : ""}" d="${colPath(x, y, bw, h)}"/>`;
    svg += `<rect class="hit" x="${padL + i * band}" y="${padT}" width="${band}" height="${H - padT - padB}" data-tip="${esc(it.tip ?? `${it.label}: ${fmt(it.value)}`)}"/>`;
    if (i % every === 0 || i === items.length - 1) svg += `<text class="tick" x="${padL + i * band + band / 2}" y="${H - 4}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  const best = items.reduce((a, b) => (b.value > a.value ? b : a));
  return `<div class="chart"><div class="chart-head"><b>${esc(title)}</b><span class="chart-tip">${esc(best.tip ?? "")}</span></div><svg viewBox="0 0 ${W} ${H}">${svg}</svg></div>`;
}

// Накопительно за месяц: факт (линия + заливка) против плана (прямая). Одна ось — рубли.
export function cumulative(days, { plan = 0, title = "Выручка месяца против плана", fmt = compact } = {}) {
  const W = 340, H = 170, padL = 34, padB = 18, padT = 10;
  const n = days.length;
  let acc = 0;
  const pts = days.map((d) => ({ ...d, acc: d.future ? null : (acc += d.value) }));
  const last = pts.filter((p) => p.acc !== null).at(-1);
  const max = niceMax(Math.max(plan, last?.acc || 0, 1));
  const X = (i) => padL + ((W - padL - 6) * i) / Math.max(1, n - 1);
  const Y = (v) => padT + (H - padT - padB) * (1 - v / max);
  let svg = [0, max / 2, max].map((t) => `<line class="grid" x1="${padL}" x2="${W}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${padL - 4}" y="${Y(t) + 3}" text-anchor="end">${fmt(t)}</text>`).join("");
  if (plan) svg += `<line class="plan" x1="${X(0)}" y1="${Y(plan / n)}" x2="${X(n - 1)}" y2="${Y(plan)}"/>`;
  const real = pts.filter((p) => p.acc !== null);
  if (real.length) {
    const line = real.map((p, i) => `${i ? "L" : "M"}${X(pts.indexOf(p))},${Y(p.acc)}`).join("");
    svg += `<path class="area" d="${line}L${X(pts.indexOf(real.at(-1)))},${Y(0)}L${X(0)},${Y(0)}Z"/><path class="line" d="${line}"/>`;
    svg += `<circle class="dot" cx="${X(pts.indexOf(last))}" cy="${Y(last.acc)}" r="4"/>`;
    svg += `<text class="end-label" x="${Math.min(X(pts.indexOf(last)), W - 40)}" y="${Math.max(Y(last.acc) - 9, 10)}" text-anchor="middle">${fmt(last.acc)}</text>`;
  }
  const band = (W - padL) / n;
  pts.forEach((p, i) => {
    const planToDay = plan ? Math.round((plan * (i + 1)) / n) : 0;
    const tip = `${p.label}: ${p.acc === null ? "впереди" : `${fmt(p.acc)} накопительно, за день ${fmt(p.value)}`}${plan ? ` · по плану ${fmt(planToDay)}` : ""}`;
    svg += `<rect class="hit" x="${X(i) - band / 2}" y="${padT}" width="${band}" height="${H - padT - padB}" data-tip="${esc(tip)}" data-x="${X(i)}"/>`;
  });
  svg += `<line class="cross" x1="0" x2="0" y1="${padT}" y2="${H - padB}" style="display:none"/>`;
  svg += `<text class="tick" x="${X(0)}" y="${H - 4}">${esc(days[0].label)}</text><text class="tick" x="${X(n - 1)}" y="${H - 4}" text-anchor="end">${esc(days.at(-1).label)}</text>`;
  const legend = `<div class="legend"><span><i class="k-line"></i>факт</span>${plan ? `<span><i class="k-plan"></i>план</span>` : ""}</div>`;
  return `<div class="chart"><div class="chart-head"><b>${esc(title)}</b><span class="chart-tip">${last ? `на сегодня ${fmt(last.acc)}${plan ? ` из ${fmt(plan)}` : ""}` : ""}</span></div>${legend}<svg viewBox="0 0 ${W} ${H}">${svg}</svg></div>`;
}

// Воронка: ступени с конверсией между ними. Ordinal-рампа синего — чем глубже, тем темнее.
export function funnel(steps, { title = "" } = {}) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return `<div class="chart">${title ? `<div class="chart-head"><b>${esc(title)}</b></div>` : ""}<div class="funnel2">${steps
    .map((s, i) => {
      const prev = steps[i - 1];
      const cr = prev && prev.value ? Math.round((s.value / prev.value) * 100) : null;
      return `${cr !== null ? `<div class="f-cr">↓ ${cr}%</div>` : ""}<div class="f-row" data-tip="${esc(`${s.label}: ${s.value}`)}"><div class="f-bar o${Math.min(i, 4)}" style="width:${Math.max(4, (s.value / max) * 100)}%"></div><div class="f-text"><span>${esc(s.label)}</span><b>${esc(s.display ?? s.value)}</b></div></div>`;
    })
    .join("")}</div></div>`;
}

// Полоса долей (≤6 сегментов, разрыв 2px), под ней легенда с числами.
export function shareBar(parts, { title = "" } = {}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return "";
  return `<div class="chart">${title ? `<div class="chart-head"><b>${esc(title)}</b><span class="chart-tip">${total}</span></div>` : ""}<div class="share">${parts
    .filter((p) => p.value)
    .map((p) => `<i class="${p.cls}" style="flex:${p.value}" data-tip="${esc(`${p.label}: ${p.value}`)}"></i>`)
    .join("")}</div><div class="legend wrap">${parts.filter((p) => p.value).map((p) => `<span><i class="sw ${p.cls}"></i>${esc(p.label)} <b>${p.value}</b></span>`).join("")}</div></div>`;
}

// Мини-тренд для плиток.
export function sparkline(values) {
  if (values.length < 2 || values.every((v) => !v)) return "";
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - (v / max) * 26}`).join(" ");
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"><polyline points="${pts}"/></svg>`;
}

// Тап/наведение по графику → подсказка в шапке карточки графика, перекрестие на линейном.
export function bindCharts(root) {
  const show = (e) => {
    const t = e.target.closest("[data-tip]");
    const chart = e.target.closest(".chart");
    if (!t || !chart) return;
    const tip = chart.querySelector(".chart-tip");
    if (tip) tip.textContent = t.dataset.tip;
    chart.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel"));
    const prev = t.previousElementSibling;
    if (prev?.classList.contains("col")) prev.classList.add("sel");
    t.classList.add("sel");
    const cross = chart.querySelector(".cross");
    if (cross && t.dataset.x) {
      cross.setAttribute("x1", t.dataset.x);
      cross.setAttribute("x2", t.dataset.x);
      cross.style.display = "";
    }
  };
  root.addEventListener("pointermove", show);
  root.addEventListener("click", show);
}
