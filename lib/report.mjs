import { buildXlsx } from "./xlsx.mjs";
import { leadMoney, sumMoney } from "../public/economics.js";
import { worklist, paidEvents, todayKey, addDays, netOf, networkReport } from "../public/insights.js";
import { STAGE_LABELS, CATEGORY_LABELS, TAG_LABELS, statusKey, statusLabel } from "../public/labels.js";
import { escapeHtml } from "./telegram.mjs";

const rub = (n) => `${Math.round(n || 0).toLocaleString("ru-RU")} ₽`;
const leadTitle = (l) => l.telegram || l.fio || "без имени";

// Полный бэкап — его же можно загрузить обратно через «Импорт».
export function buildBackup(leads, offers, settings, now = new Date()) {
  return JSON.stringify({ exportedAt: now.toISOString(), settings, offers, leads }, null, 1);
}

// CSV для Excel: «;» и BOM, чтобы русские буквы открылись без танцев.
const csv = (rows) => "﻿" + rows.map((r) => r.map((v) => {
  const s = String(v ?? "");
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(";")).join("\n");
const num = (n) => String(Math.round((n || 0) * 100) / 100).replace(".", ",");

// Строки отчёта с «сырыми» числами: из них и CSV, и Excel.
export function buildRows(leads, offers, settings) {
  const catalog = new Map(offers.map((o) => [o.id, o]));
  const r2 = (n) => Math.round((n || 0) * 100) / 100;
  const leadRows = [["Лид", "ФИО", "Телефон", "Этап", "Источник", "Теги", "Доход", "Затраты", `${settings.partnerName} ${settings.partnerShare}%`, `Налог ${settings.taxRate}%`, "Выплачено лиду", "Чистая выручка", "В работе", "Ждём засчёта", "Следующий шаг", "Напомнить", "Ответственный", "Обновлён"]];
  const offerRows = [["Лид", "ФИО", "Оффер", "Категория", "Партнёрская сеть", "Статус", "Ставка", "Затраты", "Комментарий", "Статус изменён", "Срок"]];
  for (const l of leads) {
    const m = leadMoney(l, offers, settings);
    leadRows.push([l.telegram, l.fio, l.phone || "", STAGE_LABELS[l.stage] || l.stage, l.source, (l.tags || []).map((t) => TAG_LABELS[t]).join(", "), r2(m.income), r2(m.costs), r2(m.partner), r2(m.tax), r2(m.payout), r2(m.net), r2(m.inWork), r2(m.waiting), l.nextStep || "", l.remindAt || "", l.ownerName || "", (l.updatedAt || "").slice(0, 10)]);
    for (const [id, lo] of Object.entries(l.offers || {})) {
      if (lo.status === "none" && !lo.cost && !lo.comment) continue;
      const o = catalog.get(id);
      offerRows.push([l.telegram, l.fio, o?.name || id, CATEGORY_LABELS[o?.category] || "", lo.network || o?.partner || "", statusLabel(statusKey(lo), o?.category), r2(lo.amount), r2(lo.cost), lo.comment || "", (lo.changedAt || "").slice(0, 10), lo.dueAt || ""]);
    }
  }
  const t = sumMoney(leads.map((l) => leadMoney(l, offers, settings)));
  const total = ["ИТОГО", "", "", "", "", "", r2(t.income), r2(t.costs), r2(t.partner), r2(t.tax), r2(t.payout), r2(t.net), r2(t.inWork), r2(t.waiting)];
  return { leadRows, offerRows, total };
}

export function buildCsvs(leads, offers, settings) {
  const { leadRows, offerRows, total } = buildRows(leads, offers, settings);
  const f = (r) => r.map((v) => (typeof v === "number" ? num(v) : v));
  return { leadsCsv: csv([leadRows[0], ...leadRows.slice(1).map(f), [], f(total)]), offersCsv: csv([offerRows[0], ...offerRows.slice(1).map(f)]) };
}

// Один .xlsx: лист «Лиды» (с итогом) и лист «Офферы».
export function buildExcel(leads, offers, settings) {
  const { leadRows, offerRows, total } = buildRows(leads, offers, settings);
  return buildXlsx([
    { name: "Лиды", rows: [...leadRows, [], total], widths: [18, 22, 15, 13, 14, 12, 11, 10, 12, 11, 15, 15, 11, 14, 28, 12, 14, 11] },
    { name: "Офферы", rows: offerRows, widths: [18, 22, 22, 14, 17, 28, 10, 10, 30, 15, 11] },
  ]);
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// json: false — только Excel (автовыгрузка ученикам).
export async function sendBackup(tg, chatId, leads, offers, settings, now = new Date(), { json = true, caption } = {}) {
  const stamp = now.toISOString().slice(0, 10);
  await tg.sendDocument(chatId, `leads-${stamp}.xlsx`, buildExcel(leads, offers, settings), XLSX_MIME,
    caption || `📊 Выгрузка CRM на ${stamp.split("-").reverse().join(".")}: ${leads.length} лидов. Лист «Лиды» — люди и деньги, лист «Офферы» — все офферы со статусами.`);
  if (json) {
    await tg.sendDocument(chatId, `crm-backup-${stamp}.json`, buildBackup(leads, offers, settings, now), "application/json",
      `🗂 Полный бэкап: этот файл можно загрузить обратно через «Ещё» → «Бэкап и выгрузка» → «Импорт».`);
  }
}

const list = (items, render, max = 5) =>
  items.slice(0, max).map((x) => `• ${render(x)}`).join("\n") + (items.length > max ? `\n<i>…и ещё ${items.length - max}</i>` : "");

export function buildDigest(leads, offers, settings, now = Date.now(), { networks = false } = {}) {
  const today = todayKey(now);
  const yesterday = addDays(today, -1);
  const weekAgo = addDays(today, -7);
  const paid = paidEvents(leads, offers);
  const sum = (arr) => arr.reduce((s, e) => s + e.amount, 0);
  const y = paid.filter((e) => e.day === yesterday);
  const week = paid.filter((e) => e.day && e.day > weekAgo && e.day <= today);
  const t = sumMoney(leads.map((l) => leadMoney(l, offers, settings)));
  const w = worklist(leads, offers, now);
  const name = (l) => escapeHtml(leadTitle(l));
  const [dd, mm] = [today.slice(8, 10), today.slice(5, 7)];

  const parts = [`☀️ <b>Сводка CRM на ${dd}.${mm}</b>`];
  parts.push(
    [
      `💰 Вчера засчитано: <b>${y.length ? `${y.length} × на ${rub(sum(y))}` : "ничего"}</b>`,
      `📈 За 7 дней: <b>${rub(sum(week))}</b> · чистыми ≈ ${rub(netOf(sum(week), settings))}`,
      `⏳ Ждём засчёта: <b>${rub(t.waiting)}</b> · в работе: <b>${rub(t.inWork)}</b>`,
    ].join("\n"),
  );
  if (w.reminders.length) parts.push(`🔔 <b>Напоминания (${w.reminders.length})</b>\n${list(w.reminders, (r) => `${name(r.lead)}${r.overdue ? " ⚠️" : ""} — ${escapeHtml(r.lead.nextStep || "без описания")}`)}`);
  if (w.dues.length) parts.push(`⏰ <b>Сроки по офферам (${w.dues.length})</b>\n${list(w.dues, (d) => `${name(d.lead)} — ${escapeHtml(d.name)}${d.overdue ? " ⚠️ просрочено" : ""}`)}`);
  if (w.needCd.length) parts.push(`🎯 <b>Нужна ЦД (${w.needCd.length})</b>\n${list(w.needCd, (x) => `${name(x.lead)} — ${escapeHtml(x.items.map((i) => i.name).join(", "))} · ${rub(x.sum)}`)}`);
  const late = w.waiting.filter((x) => x.days >= 5);
  if (late.length) parts.push(`📞 <b>Ждут засчёта 5+ дней — пинать партнёрку (${late.length})</b>\n${list(late, (x) => `${name(x.lead)} — ${rub(x.sum)}, ${x.days} дн.`)}`);
  if (w.stale.length) parts.push(`🐢 <b>Без движения 5+ дней (${w.stale.length})</b>\n${list(w.stale, (x) => `${name(x.lead)} — ${x.days} дн., в работе ${rub(x.sum)}`)}`);
  if (networks) {
    const debts = networkReport(leads, offers).filter((n) => n.debt > 0);
    if (debts.length) parts.push(`🏦 <b>Сети не доплатили: ${rub(debts.reduce((s, n) => s + n.debt, 0))}</b>\n${list(debts, (n) => `${escapeHtml(n.network)} — ${rub(n.debt)} (${n.unpaid.length} офф.)`, 4)}`);
  }
  if (parts.length === 2) parts.push("✅ Срочных задач нет. Хороший день, чтобы завести новые заявки.");
  return parts.join("\n\n");
}

// Ежедневный запуск по расписанию: сводка каждому, у кого есть доступ; по понедельникам — бэкап админам.
export async function runDaily({ tg, recipients, leads, offers, settings, appUrl, now = Date.now() }) {
  const monday = new Date(Date.parse(`${todayKey(now)}T00:00:00Z`)).getUTCDay() === 1;
  const markup = appUrl ? { inline_keyboard: [[{ text: "Открыть CRM", web_app: { url: appUrl } }]] } : undefined;
  const results = [];
  for (const r of recipients) {
    const visible = r.role === "admin" ? leads : leads.filter((l) => l.ownerId === r.id);
    try {
      await tg.sendMessage(r.id, buildDigest(visible, offers, settings, now, { networks: r.role === "admin" }), markup);
      if (monday && r.role === "admin") await sendBackup(tg, r.id, leads, offers, settings, new Date(now));
      results.push({ id: r.id, ok: true });
    } catch (e) {
      results.push({ id: r.id, ok: false, error: e.message });
    }
  }
  return results;
}
