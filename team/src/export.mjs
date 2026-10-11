// Выгрузка базы: CSV для Excel/Google Таблиц (как лист CRM) + полный JSON-бэкап. Отправляет бот.
import { statusLabel, mskKey, mskTime } from "../public/lib/model.js";
import { formatReport } from "../public/lib/report.js";

const cell = (v) => {
  const s = String(v ?? "");
  return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows) => "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
const day = (iso) => (iso ? mskKey(Date.parse(iso)).split("-").reverse().join(".") : "");

// Одна строка на каждую диагностику (как в CRM-таблице) + строка для клиентов без созвонов.
export function clientsCsv(clients, users) {
  const name = (id) => users.find((u) => u.id === id)?.name || "";
  const rows = [["Дата диагностики", "Время", "Имя", "Ник в телеграм", "Телефон", "Статус", "Диагностика проведена", "Итог диагностики", "Дальнейшие шаги", "Менеджер", "Лидоруб", "Источник", "Сумма (тариф)", "Чат", "Доп. инфа", "Создан"]];
  const sorted = [...clients].sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  for (const c of sorted) {
    const calls = (c.calls || []).filter((x) => x.outcome !== "moved");
    const base = (call) => [
      call ? day(call.at) : "",
      call ? mskTime(Date.parse(call.at)) : "",
      c.name, c.telegram, c.phone, statusLabel(c.status),
      call ? (call.outcome === "held" ? "Да" : call.outcome === "ndz" ? "НДЗ" : "Назначена") : "",
      call?.report ? formatReport(call.report) : "",
      c.nextSteps || "",
      name(call?.mopId || c.mopId), name(c.lidorubId), c.source, c.wantedSum || "", c.chatUrl, c.info, day(c.createdAt),
    ];
    if (!calls.length) rows.push(base(null));
    else for (const call of calls) rows.push(base(call));
  }
  return csv(rows);
}

export function paymentsCsv(payments, users, payrollRow, rates) {
  const name = (id) => users.find((u) => u.id === id)?.name || "";
  const rows = [["Дата оплаты", "Клиент", "МОП", "Сумма тарифа", "Комиссия", "Чистая прибыль", "Налоги", "Вознаграждение МОПа", "Вознаграждение РОПа", "Вознаграждение лидоруба", "Оплата верифицирована", "Заметка"]];
  for (const p of [...payments].sort((a, b) => a.date.localeCompare(b.date))) {
    const r = p.net === null || p.net === undefined ? null : payrollRow(p, rates);
    rows.push([p.date.split("-").reverse().join("."), p.clientName, name(p.mopId) || p.mopAlias || "", p.tariff, r?.commission ?? "", p.net ?? "", r?.tax ?? "", r?.mop ?? "", r?.rop ?? "", r?.lidorub ?? "", p.verified ? "Да" : "Нет", p.note]);
  }
  return csv(rows);
}

// Отправить выгрузку в личку. Ведомость — только собственнику и РОПу.
export async function sendExport({ store, tg, to, withMoney, now = Date.now() }) {
  const { payrollRow, DEFAULT_RATES } = await import("../public/lib/model.js");
  const [clients, users, settings, legacy, payments] = await Promise.all([
    store.all("client"),
    store.all("user"),
    store.get("meta", "settings"),
    store.get("meta", "legacy"),
    withMoney ? store.all("payment") : [],
  ]);
  const stamp = mskKey(now);
  await tg.sendDocument(to, `crm-${stamp}.csv`, clientsCsv(clients, users), "text/csv", `📦 База клиентов на ${stamp}: ${clients.length} клиентов. Открывается в Excel и Google Таблицах.`);
  if (withMoney) {
    await tg.sendDocument(to, `vedomost-${stamp}.csv`, paymentsCsv(payments, users, payrollRow, { ...DEFAULT_RATES, ...(settings?.rates || {}) }), "text/csv", `💰 Зарплатная ведомость: ${payments.length} оплат`);
    const backup = JSON.stringify({ exportedAt: new Date(now).toISOString(), clients, users, settings, legacy, payments }, null, 1);
    await tg.sendDocument(to, `backup-${stamp}.json`, backup, "application/json", "🗄 Полный бэкап (можно загрузить обратно)");
  }
  return { clients: clients.length, payments: payments.length };
}
