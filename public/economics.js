// Экономика лида — та же формула, что в «Отчётном листе»:
// доход = засчитанные ставки, налог = доход × налог%, партнёр = (доход − налог) × доля%,
// чистая = доход − партнёр − налог − затраты − выплачено лиду.
export const ACTIVE_STAGES = new Set(["new", "in_work", "offers"]);

export function leadMoney(lead, offers, settings) {
  const r = { income: 0, waiting: 0, inWork: 0, untouched: 0, costs: 0 };
  const active = ACTIVE_STAGES.has(lead.stage);

  for (const lo of Object.values(lead.offers || {})) {
    r.costs += lo.cost || 0;
    if (lo.status === "paid") r.income += lo.amount;
    else if (lo.status === "done") r.waiting += lo.amount;
    else if (active && (lo.status === "applied" || lo.status === "opened")) r.inWork += lo.amount;
  }
  if (active) {
    for (const o of offers) {
      const lo = lead.offers?.[o.id];
      if (o.active && (!lo || lo.status === "none")) r.untouched += lo ? lo.amount : o.amount;
    }
  }

  r.tax = (r.income * settings.taxRate) / 100;
  r.partner = ((r.income - r.tax) * settings.partnerShare) / 100;
  r.payout = lead.payout || 0;
  r.net = r.income - r.partner - r.tax - r.costs - r.payout;
  r.potential = r.inWork + r.untouched;
  return r;
}

export function sumMoney(list) {
  const keys = ["income", "waiting", "inWork", "untouched", "costs", "tax", "partner", "payout", "net", "potential"];
  return list.reduce((t, m) => {
    keys.forEach((k) => (t[k] += m[k]));
    return t;
  }, Object.fromEntries(keys.map((k) => [k, 0])));
}
