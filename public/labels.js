export const STAGE_LABELS = {
  new: "Новый",
  in_work: "В работе",
  offers: "Докрутка",
  closed: "Цикл закрыт",
  lost: "Слился",
};

export const STATUS_LABELS = {
  none: "Не начат",
  applied: "Заявка заведена",
  opened: "Счёт открыт · нужна ЦД",
  done: "ЦД выполнено · ждём засчёта",
  paid: "Засчитано",
  rejected: "Отказ",
  exists: "Уже есть / дубль",
};

export const STATUS_SHORT = {
  none: "—",
  applied: "Заявка",
  opened: "Нужна ЦД",
  done: "Ждём засчёта",
  paid: "Засчитано",
  rejected: "Отказ",
  exists: "Уже есть",
};

export const CATEGORY_LABELS = { rko: "РКО", mfo: "МФО", debit: "Дебетовые карты", credit: "Кредитные карты" };

// Теги лида: на что его крутить.
export const TAG_LABELS = { ip: "ИП", mfo: "МФО", rko: "РКО", dk: "ДК", kk: "КК" };

// Свои статусы для МФО и карт. Внутри коды те же (на них завязаны деньги, сводка и сверка),
// меняются только названия, порядок кнопок и следующий шаг.
// МФО «Деньги на карте · засчитано» = засчитано + флаг onCard (деньги ещё у лида на карте).
const CARD_STATUS = { labels: { opened: "Карта оформлена", done: "ЦД выполнено" }, short: { opened: "Карта оформлена", done: "ЦД выполнено" } };
const CAT_STATUS = {
  mfo: {
    labels: { applied: "Маскировка", done: "Деньги на карте (Не засчитано)", oncard: "Деньги на карте (Засчитано)" },
    short: { applied: "Маскировка", done: "На карте · не засч.", oncard: "На карте · засч." },
    order: ["applied", "oncard", "done", "paid", "rejected", "exists", "none"],
    next: { applied: "done", opened: "done", done: "paid" },
  },
  debit: CARD_STATUS,
  credit: CARD_STATUS,
};
const DEFAULT_ORDER = ["applied", "opened", "done", "paid", "rejected", "exists", "none"];
const DEFAULT_NEXT = { applied: "opened", opened: "done", done: "paid" };

export const statusKey = (lo) => (lo?.status === "paid" && lo.onCard ? "oncard" : lo?.status || "none");
export const statusLabel = (key, category, short = false) =>
  CAT_STATUS[category]?.[short ? "short" : "labels"]?.[key] || (short ? STATUS_SHORT : STATUS_LABELS)[key] || (key === "oncard" ? "На карте · засч." : key);
export const statusOrder = (category) => CAT_STATUS[category]?.order || DEFAULT_ORDER;
export const nextStatusFor = (status, category) => (CAT_STATUS[category]?.next || DEFAULT_NEXT)[status] || null;
export const statusPatch = (key) => (key === "oncard" ? { status: "paid", onCard: true } : key === "paid" ? { status: "paid", onCard: false } : { status: key });
