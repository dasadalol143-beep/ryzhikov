import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest, buildCsvs, runDaily, sendBackup } from "../lib/report.mjs";
import { worklist, todayKey } from "../public/insights.js";
import { DEFAULT_OFFERS, DEFAULT_SETTINGS } from "../lib/offers.mjs";

const NOW = Date.parse("2026-10-12T06:00:00Z"); // понедельник, 09:00 МСК
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

const leads = [
  {
    id: "1", telegram: "@V1dar851", fio: "Стариков", stage: "offers", ownerId: 2, updatedAt: daysAgo(0), remindAt: "2026-10-12", nextStep: "Напомнить про ВТБ",
    offers: {
      alfa: { status: "paid", amount: 11000, cost: 0, changedAt: daysAgo(1) },
      vtb: { status: "opened", amount: 7000, cost: 0, changedAt: daysAgo(2) },
      loko: { status: "done", amount: 5000, cost: 0, changedAt: daysAgo(8) },
    },
  },
  {
    id: "2", telegram: "@sleepy", fio: "", stage: "in_work", ownerId: 1, updatedAt: daysAgo(9),
    offers: { psb: { status: "applied", amount: 7500, cost: 0, changedAt: daysAgo(9) } },
  },
  { id: "3", telegram: "@a<b>", stage: "lost", ownerId: 1, updatedAt: daysAgo(30), offers: {} },
];

test("worklist sorts the day: reminders, CD, waiting, stale", () => {
  const w = worklist(leads, DEFAULT_OFFERS, NOW);
  assert.equal(todayKey(NOW), "2026-10-12");
  assert.deepEqual(w.reminders.map((r) => r.lead.id), ["1"]);
  assert.deepEqual(w.needCd.map((x) => [x.lead.id, x.sum]), [["1", 7000]]);
  assert.deepEqual(w.waiting.map((x) => [x.lead.id, x.days]), [["1", 8]]);
  assert.deepEqual(w.stale.map((x) => [x.lead.id, x.days]), [["2", 9]]);
});

test("digest has yesterday's money and today's tasks, HTML-escaped", () => {
  const text = buildDigest(leads, DEFAULT_OFFERS, DEFAULT_SETTINGS, NOW);
  assert.match(text, /Сводка CRM на 12\.10/);
  assert.match(text, /Вчера засчитано: <b>1 × на 11\s000 ₽<\/b>/);
  assert.match(text, /Напоминания \(1\)[\s\S]*@V1dar851 — Напомнить про ВТБ/);
  assert.match(text, /Нужна ЦД \(1\)[\s\S]*ВТБ — РКО/);
  assert.match(text, /Ждут засчёта 5\+ дней[\s\S]*8 дн\./);
  assert.match(text, /Без движения 5\+ дней \(1\)[\s\S]*@sleepy/);
  assert.doesNotMatch(text, /<b>@a<b>/);
});

test("CSV opens in Excel: BOM, semicolons, totals row", () => {
  const { leadsCsv, offersCsv } = buildCsvs(leads, DEFAULT_OFFERS, DEFAULT_SETTINGS);
  assert.ok(leadsCsv.startsWith("\uFEFFЛид;ФИО;Телефон;Этап"));
  assert.match(leadsCsv, /\n@V1dar851;Стариков;;Докрутка;;11000;0;/);
  assert.match(leadsCsv, /\nИТОГО;;;;;11000;/);
  assert.match(offersCsv, /@V1dar851;Стариков;ВТБ — РКО;РКО;Бизнес Система;Счёт открыт · нужна ЦД;7000/);
});

function fakeTelegram() {
  const sent = [];
  return {
    sent,
    sendMessage: async (chatId, text) => void sent.push({ chatId, type: "msg", text }),
    sendDocument: async (chatId, filename) => {
      if (chatId === 999) throw new Error("Forbidden: bot was blocked by the user");
      sent.push({ chatId, type: "doc", filename });
    },
  };
}

test("daily run: admins get everything + Monday backup, managers only their leads", async () => {
  const tg = fakeTelegram();
  const results = await runDaily({
    tg, leads, offers: DEFAULT_OFFERS, settings: DEFAULT_SETTINGS, now: NOW,
    recipients: [{ id: 1, role: "admin" }, { id: 2, role: "manager" }, { id: 999, role: "admin" }],
  });
  const to = (id) => tg.sent.filter((s) => s.chatId === id);
  assert.deepEqual(to(1).map((s) => s.type), ["msg", "doc", "doc", "doc"]);
  assert.match(to(1)[1].filename, /^crm-backup-2026-10-12\.json$/);
  assert.deepEqual(to(2).map((s) => s.type), ["msg"]);
  assert.doesNotMatch(to(2)[0].text, /@sleepy/);
  assert.deepEqual(results.map((r) => r.ok), [true, true, false]);
});

test("backup is three files", async () => {
  const tg = fakeTelegram();
  await sendBackup(tg, 1, leads, DEFAULT_OFFERS, DEFAULT_SETTINGS, new Date(NOW));
  assert.deepEqual(tg.sent.map((s) => s.filename), ["crm-backup-2026-10-12.json", "leads-2026-10-12.csv", "offers-2026-10-12.csv"]);
});

test("offer due dates show up in the worklist and the digest", () => {
  const withDue = [{ ...leads[1], offers: { psb: { status: "applied", amount: 7500, dueAt: "2026-10-11" } } }];
  const w = worklist(withDue, DEFAULT_OFFERS, NOW);
  assert.deepEqual(w.dues.map((d) => [d.name, d.overdue]), [["ПСБ — РКО", true]]);
  assert.match(buildDigest(withDue, DEFAULT_OFFERS, DEFAULT_SETTINGS, NOW), /Сроки по офферам \(1\)[\s\S]*ПСБ — РКО ⚠️ просрочено/);
});
