import { test } from "node:test";
import assert from "node:assert/strict";
import { leadMoney } from "../public/economics.js";
import { DEFAULT_OFFERS, DEFAULT_SETTINGS } from "../lib/offers.mjs";

const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} != ${b}`);

// Цифры с листа @Diman0004: доход 62 475, затраты 2 973 → выручка 46 944,525
test("matches the spreadsheet formula on @Diman0004", () => {
  const paid = (amount, cost = 0) => ({ status: "paid", amount, cost });
  const lead = {
    stage: "closed",
    payout: 0,
    offers: {
      alfa: paid(15500), vtb: paid(7000), sber: paid(4000), uralsib: paid(6000), ozon: paid(11000),
      levob: paid(4500, 1113), otp: { status: "opened", amount: 8200, cost: 1380 },
      zaymer: paid(3300, 20), srochno: paid(2300, 260), adengi: paid(3000, 20),
      credit7: paid(2000, 20), creditplus: paid(2000, 20), joymoney: paid(1875, 20),
      webbankir: { status: "rejected", amount: 2900, cost: 20 }, maxcredit: { status: "rejected", amount: 4543, cost: 20 },
      moneyman: { status: "rejected", amount: 3750, cost: 20 }, umnye: { status: "rejected", amount: 4890, cost: 20 },
      centrofin: { status: "applied", amount: 2520, cost: 20 }, fastmoney: { status: "rejected", amount: 2440, cost: 20 },
    },
  };
  const m = leadMoney(lead, DEFAULT_OFFERS, { ...DEFAULT_SETTINGS, taxRate: 6, partnerShare: 15 }); // ставки, по которым считалась таблица
  near(m.income, 62475);
  near(m.costs, 2973);
  near(m.tax, 3748.5);
  near(m.partner, 8808.975);
  near(m.net, 46944.525);
  assert.equal(m.potential, 0); // цикл закрыт — потенциала нет
});

test("active lead: potential = in work + untouched active offers; payout reduces net", () => {
  const offers = [
    { id: "a", amount: 10000, active: true },
    { id: "b", amount: 5000, active: true },
    { id: "c", amount: 7000, active: false },
    { id: "d", amount: 3000, active: true },
    { id: "e", amount: 4000, active: true, category: "mfo" },
  ];
  const lead = {
    stage: "offers",
    payout: 1000,
    offers: { a: { status: "paid", amount: 10000, cost: 0 }, b: { status: "opened", amount: 5000, cost: 0 }, d: { status: "exists", amount: 3000, cost: 0 } },
  };
  const m = leadMoney(lead, offers, { taxRate: 6, partnerShare: 15 });
  assert.equal(m.potential, 5000);
  near(m.net, 10000 - 600 - 1410 - 1000);
});

test("direction and source stats: costs by РКО/МФО/карты, ROI by channel", async () => {
  const { directionStats, sourceStats } = await import("../public/insights.js");
  const { leadMoney } = await import("../public/economics.js");
  const offers = [
    { id: "vtb", category: "rko", name: "ВТБ", amount: 7000, active: true },
    { id: "zaymer", category: "mfo", name: "Займер", amount: 3000, active: true },
    { id: "alfa_dk", category: "debit", name: "Альфа ДК", amount: 2000, active: true },
  ];
  const settings = { taxRate: 6, partnerShare: 0 };
  const leads = [
    { id: "a", stage: "offers", source: "YouTube", offers: { vtb: { status: "paid", amount: 7000, cost: 200, changedAt: "2026-11-10T10:00:00Z" }, zaymer: { status: "rejected", amount: 3000, cost: 50, changedAt: "2026-11-11T10:00:00Z" } } },
    { id: "b", stage: "in_work", source: "youtube ", offers: { alfa_dk: { status: "opened", amount: 2000, cost: 0 } } },
    { id: "c", stage: "new", source: "", offers: {} },
  ];
  const expenses = [{ amount: 1000, dir: "rko", source: "YouTube", date: "2026-11-05" }, { amount: 500, dir: "all", date: "2026-10-01" }];
  const d = Object.fromEntries(directionStats(leads, offers, expenses).map((x) => [x.key, x]));
  assert.equal(d.rko.income, 7000);
  assert.equal(d.rko.costs, 200);
  assert.equal(d.rko.general, 1000);
  assert.equal(d.rko.net, 5800);
  assert.equal(d.mfo.costs, 50, "затраты по отказу тоже считаются — деньги потрачены");
  assert.equal(d.mfo.tried, 1);
  assert.equal(d.debit.tried, 1);
  assert.equal(d.all.general, 500);
  const nov = Object.fromEntries(directionStats(leads, offers, expenses, { from: "2026-11-01", to: "2026-11-30" }).map((x) => [x.key, x]));
  assert.equal(nov.all.general, 0, "октябрьский расход не в ноябре");
  assert.equal(nov.debit.tried, 0, "оффер без даты — только во «всём времени»");
  const s = sourceStats(leads, offers, expenses, (l) => leadMoney(l, offers, settings));
  assert.equal(s[0].label, "YouTube");
  assert.equal(s[0].leads, 2, "«youtube » и «YouTube» — один канал");
  assert.equal(s[0].paidLeads, 1);
  assert.equal(s[0].spent, 1250);
  assert.equal(s[0].net, 5750);
  assert.equal(s[0].roi, 460);
  assert.equal(s.find((x) => x.label === "Не указано").leads, 1);
});
