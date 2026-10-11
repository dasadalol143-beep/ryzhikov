import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReminder, formatMsk } from "../lib/nlp.mjs";

const NOW = Date.parse("2026-10-11T18:00:00Z"); // воскресенье, 21:00 МСК
const at = (s) => formatMsk(parseReminder(s, NOW).dueAt);
const task = (s) => parseReminder(s, NOW).task;

test("the exact phrase from the request", () => {
  const r = parseReminder("Привет, напомни о том, что завтра нужно сделать целевое действие с лидом @Diman0004 в 12 по МСК", NOW);
  assert.equal(formatMsk(r.dueAt), "12.10 (пн) в 12:00 МСК");
  assert.equal(r.nick, "Diman0004");
  assert.equal(r.task, "Нужно сделать целевое действие");
});

test("days: today, tomorrow, day after, weekday, dates", () => {
  assert.equal(at("напомни завтра в 9:30 позвонить"), "12.10 (пн) в 09:30 МСК");
  assert.equal(at("напомни послезавтра в 15 позвонить"), "13.10 (вт) в 15:00 МСК");
  assert.equal(at("напомни в пятницу в 10 проверить отчёт ОТП"), "16.10 (пт) в 10:00 МСК");
  assert.equal(at("напомни в воскресенье в 10 подбить итоги"), "18.10 (вс) в 10:00 МСК"); // сегодня вс, 10 утра прошло → через неделю
  assert.equal(at("напомни 15.10 в 14:00 встреча по Озону"), "15.10 (чт) в 14:00 МСК");
  assert.equal(at("напомни 20 октября дожать ВТБ"), "20.10 (вт) в 10:00 МСК"); // без времени — 10:00
  assert.equal(at("напомни завтра дожать ВТБ"), "12.10 (пн) в 10:00 МСК");
});

test("times: words, pm, relative", () => {
  assert.equal(at("напомни завтра в 3 дня написать @abcd"), "12.10 (пн) в 15:00 МСК");
  assert.equal(at("напомни завтра в 7 вечера"), "12.10 (пн) в 19:00 МСК");
  assert.equal(at("напомни завтра утром"), "12.10 (пн) в 10:00 МСК");
  assert.equal(at("напомни в 9 позвонить"), "12.10 (пн) в 09:00 МСК"); // 9 сегодня прошло → завтра
  assert.equal(at("напомни в 23:15 проверить"), "11.10 (вс) в 23:15 МСК");
  assert.equal(at("напомни через 2 часа позвонить @abcd"), "11.10 (вс) в 23:00 МСК");
  assert.equal(at("напомни через полчаса"), "11.10 (вс) в 21:30 МСК");
  assert.equal(at("напомни через 15 минут"), "11.10 (вс) в 21:15 МСК");
  assert.equal(at("напомни через 3 дня в 12 по мск"), "14.10 (ср) в 12:00 МСК");
  assert.equal(at("напомни через неделю"), "18.10 (вс) в 10:00 МСК");
  assert.equal(at("напомни через час набрать"), "11.10 (вс) в 22:00 МСК");
  assert.equal(at("напомни через два часа"), "11.10 (вс) в 23:00 МСК");
  assert.equal(at("напомни завтра 12 по мск отправить ссылку"), "12.10 (пн) в 12:00 МСК");
});

test("task text gets cleaned", () => {
  assert.equal(task("напомни мне пожалуйста завтра в 12 про то что надо скинуть ссылку на Альфу @nick_x"), "Надо скинуть ссылку на Альфу");
  assert.equal(task("напомни завтра в 12 @nick_x"), "Вернуться к лиду");
  assert.equal(task("напомни через час позвонить лиду @nick_x"), "Позвонить");
});

test("no time, past time, not a reminder", () => {
  assert.deepEqual(parseReminder("напомни дожать @nick_x", NOW), { needTime: true, nick: "nick_x", task: "Дожать" });
  assert.equal(parseReminder("напомни сегодня в 10 позвонить", NOW).past, true);
  assert.equal(parseReminder("@nick_x Иванов Иван", NOW), null);
});
