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
