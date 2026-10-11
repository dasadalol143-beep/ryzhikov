// Стартовый каталог офферов (актуально на май 2026). Редактируется в приложении.
export const DEFAULT_OFFERS = [
  { id: "alfa_ip", name: "ИП на НПД — Альфа", partner: "RKO Group", amount: 15000, active: true, note: "Первый шаг после самозанятости" },
  { id: "vtb", name: "ВТБ", partner: "RKO Group", amount: 7000, active: true, note: "Через Бизнес Систему — 6 500" },
  { id: "ozon", name: "Ozon", partner: "RKO Group", amount: 8000, active: true, note: "Через Бизнес Систему ~6 000" },
  { id: "loko", name: "Локобанк", partner: "RKO Group", amount: 9500, active: true, note: "" },
  { id: "uralsib", name: "Уралсиб", partner: "Бизнес Система", amount: 6000, active: true, note: "" },
  { id: "levob", name: "Левобережный", partner: "RKO Group", amount: 4500, active: true, note: "Также Бизнес Система / FCN" },
  { id: "kontur", name: "Pro Контур", partner: "RKO Group", amount: 0, active: true, note: "Уточнить ставку" },
  { id: "psb", name: "ПСБ", partner: "Бизнес Система", amount: 0, active: true, note: "Возможны проверки на реальность бизнеса" },
  { id: "gpb", name: "Газпромбанк", partner: "RKO Group", amount: 0, active: false, note: "Ждём возвращения" },
];

export const STAGES = ["new", "in_work", "ip", "offers", "closed", "lost"];
export const OFFER_STATUSES = ["none", "in_progress", "done", "paid", "rejected"];
