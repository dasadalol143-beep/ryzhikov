// События ролика «14 000 ₽» в стиле эталона (сек таймлайна). Читают композиция и сведение звука.
import timeline from "../data/v14k.timeline.json";
import { makeWT } from "../v2/words";
import type { TW } from "./text";

export const FPS = 24000 / 1001;
export const T = timeline as { duration: number; clips: { t_in: number; t_out: number; seg: number }[]; words: TW[] };
export const wt = makeWT(T.words as any);
export const END = 0.9; // затемнение в чёрное после последнего слова
export const TOTAL = Math.ceil((T.duration + END) * FPS);

const g = (a: number) => +(a - 0.04).toFixed(3);
export type HL = { text: string; s: number; e: number; y: number; size?: number; thin?: boolean; sub?: string; subAt?: number };
export const heads: HL[] = [
  { text: "Я хочу", s: g(wt("Я", 0.07)), e: g(wt("объявить", 0.97)), y: 0.83 },
  { text: "Объявить тебе челлендж", s: g(wt("объявить", 0.97)), e: g(wt("Научись", 2.48)), y: 0.83 },
  { text: "Научись зарабатывать", s: g(wt("Научись", 2.48)), e: g(wt("14", 3.5)), y: 0.83 },
  { text: "14 000₽", s: g(wt("14", 3.5)), e: g(wt("каждый", 4.86)), y: 0.8, size: 124, thin: true },
  { text: "Каждый", s: g(wt("каждый", 4.86)), e: g(wt("день", 5.38)), y: 0.83 },
  { text: "День", s: g(wt("день", 5.38)), e: g(wt("вместе", 5.66)), y: 0.83 },
  { text: "Со мной", s: g(wt("вместе", 5.66)), e: g(wt("Есть", 6.81)) - 0.08, y: 0.83 },
  { text: "Арбитраж трафика на банки", s: g(wt("арбитраж", 8.78)), e: g(wt("И", 10.48)) + 0.3, y: 0.13, size: 76 },
  { text: "Хотя по сути в ней", s: g(wt("Хотя", 15.72)), e: g(wt("не", 16.84)), y: 0.13, size: 76 },
  { text: "Не зарабатывают", s: g(wt("не", 16.84)), e: g(wt("Как", 17.98)), y: 0.13, size: 84 },
  { text: "Суть ниши", s: g(wt("Суть", 36.99)) + 0.35, e: g(wt("довольно", 38.26)), y: 0.13, size: 76 },
  { text: "Довольно простая", s: g(wt("довольно", 38.26)), e: g(wt("Ты", 39.55)), y: 0.13, size: 76 },
  { text: "Ты просто берёшь ссылку", s: g(wt("Ты", 39.55)), e: g(wt("В", 45.91)), y: 0.13, size: 76, sub: "отправляешь эту ссылку клиенту", subAt: wt("отправляешь", 43.66) - wt("Ты", 39.55) },
];
export const ev = {
  card: [g(wt("определённо", 28.75)) - 0.2, g(wt("И", 30.62)) + 0.3] as [number, number],
  screen: [g(wt("1", 33.65)) - 0.1, g(wt("Суть", 36.99)) + 0.3] as [number, number],
  steps: [g(wt("Шаг", 51.93)) - 0.5, 0] as [number, number],
  step1: wt("становимся", 55.93), step2: wt("регистрируемся", 61.96), step3: wt("находим", 65.92), step4: wt("начинаем", 103.69),
  flash: g(wt("Ведь", 105.03)),
  notEarn: g(wt("не", 16.84)),
};
ev.steps[1] = T.duration;
