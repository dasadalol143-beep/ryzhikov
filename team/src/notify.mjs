// Уведомления команде в бот + лента событий в приложении.
// Пишем только тем, кого событие касается, и никогда — самому автору действия.
import { escapeHtml as h } from "./telegram.mjs";
import { fmtWhen } from "../public/lib/model.js";
import { rnp, periodRange } from "../public/lib/stats.js";

const rub = (n) => `${Math.round(n || 0).toLocaleString("ru-RU")} ₽`;
const who = (c) => [c.name, c.telegram].filter(Boolean).map(h).join(" · ") || "клиент";
const strip = (html) => html.replace(/<[^>]+>/g, "");

export async function addFeed(store, item) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await store.put("feed", id, { id, at: new Date().toISOString(), ...item });
}

export async function dispatch(notes, c, { store, env, tg, appUrl, by, users, settings }) {
  if (!notes?.length) return;
  const name = (id) => users[id]?.name || "кто-то";
  const bosses = Object.values(users).filter((u) => u.active !== false && ["owner", "rop"].includes(u.role)).map((u) => u.id);
  for (const id of String(env.OWNER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean)) if (!bosses.includes(id)) bosses.push(id);
  const card = (text = "Карточка клиента") => ({ text, web_app: { url: `${appUrl}?client=${c.id}` } });
  const chatBtn = c.chatUrl && /^https:\/\/t\.me\//.test(c.chatUrl) ? [{ text: "Чат с клиентом", url: c.chatUrl }] : [];

  for (const n of notes) {
    let html = "";
    let to = [];
    let kb = { inline_keyboard: [[...chatBtn, card()]] };
    if (n.t === "call") {
      to = [n.mop];
      if (n.prevMop && n.prevMop !== n.mop) to.push(n.prevMop);
      html = n.moved
        ? `🔁 <b>Перенос созвона</b>\n👤 ${who(c)}\nБыло: ${fmtWhen(Date.parse(n.moved))}\nСтало: <b>${fmtWhen(Date.parse(n.at))} МСК</b> · ${h(name(n.mop))}\nПеренёс: ${h(name(by))}`
        : `🆕 <b>Новый созвон — ${fmtWhen(Date.parse(n.at))} МСК</b>\n👤 ${who(c)}${c.info ? `\n📝 ${h(c.info.slice(0, 250))}` : ""}\nЗаписал: ${h(name(by))}`;
    }
    if (n.t === "ndz") {
      to = [c.lidorubId, ...bosses];
      html = `❌ <b>НДЗ-${n.n}</b> · ${who(c)}\nДиагност: ${h(name(n.mop))}. Лидоруб — перезаписать, клиент ушёл в дожим.`;
    }
    if (n.t === "paid") {
      to = [...bosses, n.mop, c.lidorubId];
      const plan = settings?.monthPlan;
      let tail = "";
      if (plan) {
        const all = await store.all("client");
        const legacy = (await store.get("meta", "legacy")) || {};
        const m = rnp(all, legacy, { ...periodRange("month"), aliases: settings.aliases }).total;
        tail = `\n📈 Месяц: ${rub(m.salesSum)} из ${rub(plan)} (${Math.round((m.salesSum / plan) * 100)}%)`;
      }
      html = `💰 <b>Продажа ${rub(n.sum)}</b>\n👤 ${who(c)}\n🎯 ${h(name(n.mop))}${c.lidorubId ? ` · лид от ${h(name(c.lidorubId))}` : ""}${tail}`;
    }
    if (n.t === "prepaid") {
      to = [...bosses];
      html = `💵 <b>Предоплата ${rub(n.sum)}</b> · ${who(c)} · ${h(name(n.mop))}`;
    }
    if (n.t === "refuse_bank") {
      to = [...bosses, c.lidorubId];
      html = `🏦 <b>Отказ по банкам</b> · ${who(c)}${n.sum ? ` на ${rub(n.sum)}` : ""}\nПо регламенту — передать рекрутеру: может зайти в РКО исполнителем.`;
    }
    if (n.t === "comment") {
      to = [c.mopId, c.lidorubId, ...bosses];
      html = `💬 <b>${h(name(by))}</b> → ${who(c)}\n${h(n.text)}`;
      kb = { inline_keyboard: [[card("Открыть и ответить")]] };
    }
    if (!html) continue;
    to = [...new Set(to.filter((id) => id && id !== by))];
    await addFeed(store, { type: n.t, text: strip(html), clientId: c.id, by, to });
    if (!tg) continue;
    await Promise.allSettled(to.map((id) => tg.sendMessage(id, html, kb)));
  }
}
