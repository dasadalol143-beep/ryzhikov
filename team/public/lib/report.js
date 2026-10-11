// Отчёт после диагностики в том виде, как менеджеры пишут его в CRM-таблице:
//   Потребность/запрос клиента: …
//   Род деятельности: …
//   О чем глобально мечтает (главная боль): …
//   Провел презентацию по тарифам: Да/Нет
//   Основное возражение: …
//   Следующий шаг, договоренности: …
//   Предложил оплатить: Да/Нет
// Разбираем текст в поля и собираем обратно — привычка команды сохраняется.

const LINES = [
  ["need", /потребност\S*\s*\/?\s*запрос\S*(?:\s+клиента)?/i, "Потребность/запрос клиента"],
  ["occupation", /род\s+деятельност\S*/i, "Род деятельности"],
  ["dream", /о\s+ч[её]м\s+(?:глобально\s+)?мечта\S*(?:\s*\(главная\s+боль\))?/i, "О чем глобально мечтает (главная боль)"],
  ["presented", /провел\S*\s+презентаци\S*(?:\s+по\s+тарифам)?/i, "Провел презентацию по тарифам"],
  ["objection", /основн\S*\s+возражени\S*/i, "Основное возражение"],
  ["nextStep", /следующ\S*\s+шаг\S*(?:,?\s*договор[её]нност\S*)?/i, "Следующий шаг, договоренности"],
  ["offeredPay", /предложил\S*\s+оплатить/i, "Предложил оплатить"],
];

export const isReportText = (text) => /потребност\S*\s*\/?\s*запрос/i.test(text || "") && /род\s+деятельност|мечта|возражени/i.test(text || "");

const yes = (v) => (/^\s*да/i.test(v) ? true : /^\s*нет/i.test(v) ? false : null);

export function parseReportText(text) {
  const src = String(text || "").replace(/\r/g, "");
  const hits = [];
  for (const [id, re] of LINES) {
    const m = new RegExp(`(^|\\n|\\s)(${re.source})\\s*:?`, "i").exec(src);
    if (m) hits.push({ id, start: m.index + m[1].length, end: m.index + m[0].length });
  }
  hits.sort((a, b) => a.start - b.start);
  const out = { need: "", occupation: "", dream: "", objection: "", nextStep: "", presented: null, offeredPay: null, extra: "" };
  if (!hits.length) return { ...out, extra: src.trim() };
  out.extra = src.slice(0, hits[0].start).trim();
  hits.forEach((h, i) => {
    let val = src.slice(h.end, hits[i + 1]?.start ?? src.length).trim();
    if (h.id === "presented" || h.id === "offeredPay") {
      const first = val.split("\n")[0];
      // «не до конца», «частично» — сохраняем как есть, а не теряем
      out[h.id] = yes(first) ?? (first.trim() || null);
      if (typeof out[h.id] === "string") return void (val.slice(first.length).trim() && (out.extra = [out.extra, val.slice(first.length).trim()].filter(Boolean).join("\n")));
      const rest = val.slice(first.length).replace(/^[\s,.]*(да|нет)?/i, "").trim();
      // «Предложил оплатить: Да, но получил принципиальный отказ» и хвост после последней строки
      const tail = first.replace(/^\s*(да|нет)[\s,.]*/i, "").trim();
      const more = [tail, rest].filter(Boolean).join("\n");
      if (more) out.extra = [out.extra, more].filter(Boolean).join("\n");
      return;
    }
    out[h.id] = val.replace(/^[-–—\s]+|[-–—\s]+$/g, "");
  });
  return out;
}

export function formatReport(r = {}) {
  const yn = (v) => (v === true ? "Да" : v === false ? "Нет" : v || "Да/Нет");
  return [
    `Потребность/запрос клиента: ${r.need || ""}`,
    `Род деятельности: ${r.occupation || ""}`,
    `О чем глобально мечтает (главная боль): ${r.dream || ""}`,
    `Провел презентацию по тарифам: ${yn(r.presented)}`,
    `Основное возражение: ${r.objection || ""}`,
    `Следующий шаг, договоренности: ${r.nextStep || ""}`,
    `Предложил оплатить: ${yn(r.offeredPay)}`,
    r.extra ? `\n${r.extra}` : "",
  ].join("\n").trim();
}

// Статусы из выпадающего списка CRM-таблицы.
export function statusFromSheet(s) {
  const t = String(s || "").toLowerCase().replace(/ё/g, "е");
  if (/оплатил/.test(t)) return "paid";
  if (/предоплат/.test(t)) return "prepaid";
  if (/банк/.test(t)) return "refuse_bank";
  if (/отказ/.test(t)) return "refuse_personal";
  if (/игнор/.test(t)) return "ignore";
  if (/невалид/.test(t)) return "invalid";
  if (/ндз\s*-?\s*3/.test(t)) return "ndz3";
  if (/ндз\s*-?\s*2/.test(t)) return "ndz2";
  if (/ндз/.test(t)) return "ndz1";
  if (/перенос/.test(t)) return "resched";
  if (/думает/.test(t)) return "thinking";
  if (/в работе/.test(t)) return "in_work";
  return t ? "in_work" : "new";
}

// CSV (выгрузка листа Google-таблицы): кавычки, переносы строк внутри ячеек.
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') cell += '"', i++;
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === "," || ch === ";" || ch === "\t") row.push(cell), (cell = "");
    else if (ch === "\n") row.push(cell), rows.push(row), (row = []), (cell = "");
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}

// «07.08», «18 августа», «21.08.26» → YYYY-MM-DD (год по умолчанию 2026).
const MONTHS = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
export function sheetDate(v, year = 2026) {
  const s = String(v || "").trim().toLowerCase();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year;
    return `${y}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})\s+([а-я]+)/);
  if (m) {
    const mi = MONTHS.findIndex((x) => m[2].startsWith(x));
    if (mi >= 0) return `${year}-${String(mi + 1).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }
  return null;
}

// Строки листа CRM → клиенты. Колонки ищем по заголовкам: у Темы ник и имя стоят в другом порядке, чем у Димы.
export function crmRowsToClients(rows, { mopId, mopAlias = null, now = new Date().toISOString() } = {}) {
  const hi = rows.findIndex((r) => r.some((c) => /дата\s*диагност/i.test(c)));
  if (hi < 0) return [];
  const head = rows[hi].map((c) => c.toLowerCase());
  const col = (re) => head.findIndex((c) => re.test(c));
  const ix = { date: col(/дата/), name: col(/^имя|имя$/), nick: col(/ник|телеграм/), status: col(/статус/), held: col(/проведен/), report: col(/итог/), next: col(/дальнейш|шаги/) };
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const get = (k) => (ix[k] >= 0 ? String(r[ix[k]] ?? "").trim() : "");
    const day = sheetDate(get("date"));
    const nickRaw = get("nick").replace(/\s+/g, "");
    const name = get("name");
    if (!day || (!nickRaw && !name)) continue;
    const telegram = /^@?[A-Za-z][\w]{3,}$/.test(nickRaw) ? (nickRaw.startsWith("@") ? nickRaw : `@${nickRaw}`) : "";
    const reportText = get("report");
    const report = parseReportText(reportText);
    const filled = Object.values({ ...report, presented: null, offeredPay: null }).some((v) => v && !/^да\s*\\?\s*нет$/i.test(v));
    const heldMark = /true|да|✓|1/i.test(get("held"));
    const status = statusFromSheet(get("status"));
    const at = new Date(Date.parse(`${day}T12:00:00+03:00`)).toISOString();
    const outcome = heldMark || filled ? "held" : /^ndz/.test(status) ? "ndz" : "held";
    out.push({
      name: name || (!telegram ? nickRaw : ""),
      telegram,
      status,
      nextSteps: get("next"),
      info: telegram || !nickRaw ? "" : `Ник в таблице: ${nickRaw}`,
      source: "Новая заявка",
      mopId: mopId || null,
      mopAlias,
      calls: [{ id: `crm-${day}`, at, mopId: mopId || null, mopAlias, setAt: at, setBy: null, outcome, outcomeAt: at, legacy: true, notified: { h2: at, h1: at, m15: at, after: at, report: at }, ...(filled ? { report, reportAt: at } : {}) }],
      createdAt: at,
      updatedAt: now,
      fromSheet: true,
    });
  }
  return out;
}
