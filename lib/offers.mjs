// Стартовый каталог офферов (из «Системы мотивации» и карточек лидов). Редактируется в приложении.
const rko = (id, name, partner, amount, note = "") => ({ id, category: "rko", name, partner, amount, cost: 0, active: true, note });
const mfo = (id, name, partner, amount, note = "") => ({ id, category: "mfo", name, partner, amount, cost: 20, active: true, note });

export const DEFAULT_OFFERS = [
  rko("ozon", "Озон — Регбиз", "RKO Group", 11000),
  rko("alfa", "Альфа — РКО", "Бизнес Система", 10500),
  rko("sber", "Сбер — РКО", "Сбербизнес", 4000),
  rko("vtb", "ВТБ — РКО", "Бизнес Система", 7000),
  rko("uralsib", "Уралсиб — РКО", "Бизнес Система", 8100),
  rko("otp", "ОТП — РКО", "Бизнес Система", 8200),
  rko("psb", "ПСБ — РКО", "Бизнес Система", 7500, "Возможны проверки на реальность бизнеса"),
  rko("loko", "Локо — РКО", "Бизнес Система", 8500),
  rko("levob", "Левобережный — РКО", "Бизнес Система", 4000),
  rko("svoy", "Свой Банк — РКО", "Бизнес Система", 7000),
  { ...rko("gpb", "Газпромбанк — РКО", "RKO Group", 10000, "Ждём возвращения"), active: false },
  rko("tochka", "Точка — РКО", "", 10000),
  rko("kontur", "Контур — РКО", "RKO Group", 3500),
  rko("tbiz", "Т-Бизнес — РКО", "", 4000),
  rko("bspb", "БСПБ — РКО", "", 0, "Уточнить ставку"),
  rko("ingo", "Инго Банк — РКО", "RKO Group", 20000),
  rko("wb", "WB — РКО", "RKO Group", 10000, "Только для ИП, не НПД"),

  mfo("zaymer", "Займер", "Finuslugi", 3300),
  mfo("srochno", "Срочноденьги", "Finuslugi", 2300),
  mfo("webbankir", "Webbankir", "Finuslugi", 2900),
  mfo("joymoney", "JoyMoney", "FCN", 1875),
  mfo("moneyman", "MoneyMan", "FCN", 3750),
  mfo("credit7", "Credit7", "Finuslugi", 2000),
  mfo("creditplus", "CreditPlus", "Finuslugi", 2000),
  mfo("centrofin", "Центрофинанс", "FCN", 2520),
  mfo("adengi", "А-деньги", "FCN", 3000),
  mfo("umnye", "Умные наличные", "FCN", 4890),
  mfo("maxcredit", "MaxCredit", "FCN", 4543),
  mfo("fastmoney", "FastMoney", "FCN", 2440, "С 21 года"),
  mfo("payps", "Pay PS", "FCN", 2635),
  mfo("svoilyudi", "Свои люди", "FCN", 2795),
  mfo("rocketman", "RocketMan", "FCN", 2795),
  mfo("bystrodengi", "Быстроденьги", "FCN", 4194),
  mfo("migcredit", "МигКредит", "Finuslugi", 2100),
  mfo("dengi_na_dom", "Деньги на дом", "Leadgid", 6000),
  mfo("likezaim", "LikeZaim", "Leadgid", 5500),
  mfo("dengi_srazu", "Деньги Сразу", "FCN", 4935),
  mfo("boostra", "Boostra", "FCN", 7125),
  mfo("prostoy_vopros", "Простой вопрос", "FCN", 5625),
  mfo("laykmani", "ЛайкМани", "FCN", 4987),
  mfo("oneclick", "OneClickMoney", "FCN", 4655),
  mfo("dobrozaym", "Доброзайм", "FCN", 4275),
  mfo("finuslugi_podbor", "Финуслуги (подбор)", "Finuslugi", 4000),
  ...[["ekapusta", "Екапуста"], ["finters", "Finters"], ["cashtoyou", "Cash to You"], ["vebzaym", "ВебЗайм"], ["turbozaym", "Турбозайм"], ["creditter", "Creditter"]]
    .map(([id, name]) => ({ ...mfo(id, name, "", 0, "Встречался в таблице"), active: false })),

  { id: "alfa_debit", category: "debit", name: "Альфа — дебетовая карта", partner: "", amount: 0, cost: 0, active: true, note: "Уточнить ставку" },
  { id: "t_debit", category: "debit", name: "Т-Банк — дебетовая карта", partner: "", amount: 0, cost: 0, active: true, note: "Уточнить ставку" },
  { id: "t_credit", category: "credit", name: "Т-Банк — кредитная карта", partner: "", amount: 0, cost: 0, active: true, note: "Уточнить ставку" },
];

export const CATEGORIES = ["rko", "mfo", "debit", "credit"];

// Доход = засчитанные ставки; налог от дохода; доля партнёра от (доход − налог).
export const DEFAULT_SETTINGS = {
  taxRate: 7,
  partnerShare: 20,
  partnerName: "Дамир",
  monthlyGoal: 0, // план засчитанного дохода на месяц, 0 — не задан
  templates: [
    "Привет! Скинь, пожалуйста, фото паспорта (разворот + прописка) — оформим всё за 10 минут.",
    "Счёт открыт 👍 Теперь нужно выполнить целевое действие: пополнить счёт и сделать оплату. Напиши, как будешь готов — проведу по шагам.",
    "Пришла ссылка от банка — открой и подтверди, пожалуйста. Если что-то непонятно, звони.",
    "Как дела по банку? Подтвердили заявку? Давай доведём до конца, там осталось чуть-чуть.",
    "Держи следующий банк — тоже быстро и тоже с выплатой. Готов начать?",
  ],
};

export const STAGES = ["new", "in_work", "offers", "closed", "lost"];
// applied — заявка заведена, opened — счёт открыт (нужна ЦД), done — ЦД выполнено, paid — засчитано
export const OFFER_STATUSES = ["none", "applied", "opened", "done", "paid", "rejected", "exists"];
