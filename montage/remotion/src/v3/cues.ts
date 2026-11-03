// События ролика «14 000 ₽» в стиле эталона (сек таймлайна). Читают композиция и сведение звука.
import timeline from "../data/v14k.timeline.json";
import { makeWT } from "../v2/words";
import type { TW } from "./text";

export const FPS = 24000 / 1001;
export const T = timeline as { duration: number; clips: { t_in: number; t_out: number; seg: number }[]; words: TW[] };
export const wt = makeWT(T.words as any);
export const END = 0.55; // затемнение в чёрное после последнего слова
export const TOTAL = Math.ceil((T.duration + END) * FPS);

const g = (a: number) => +(a - 0.04).toFixed(3);
export type HL = { text: string; s: number; e: number; y: number; size?: number; thin?: boolean; sub?: string; subAt?: number };
export const heads: HL[] = [
  { text: "Я хочу", s: g(wt("Я", 0.00)), e: g(wt("объявить", 0.56)), y: 0.83 },
  { text: "Объявить тебе челлендж", s: g(wt("объявить", 0.56)), e: g(wt("Научись", 2.00)), y: 0.83 },
  { text: "Научись зарабатывать", s: g(wt("Научись", 2.00)), e: g(wt("14", 3.01)), y: 0.83 },
  { text: "14 000₽", s: g(wt("14", 3.01)), e: g(wt("каждый", 4.37)), y: 0.8, size: 124, thin: true },
  { text: "Каждый", s: g(wt("каждый", 4.37)), e: g(wt("день", 4.81)), y: 0.83 },
  { text: "День", s: g(wt("день", 4.81)), e: g(wt("вместе", 5.09)), y: 0.83 },
  { text: "Со мной", s: g(wt("вместе", 5.09)), e: g(wt("Есть", 6.05)) - 0.08, y: 0.83 },
  { text: "Арбитраж трафика на банки", s: g(wt("арбитраж", 7.89)), e: g(wt("И", 9.59)) + 0.3, y: 0.13, size: 76 },
  { text: "Хотя по сути в ней", s: g(wt("Хотя", 14.39)), e: g(wt("не", 15.34)), y: 0.13, size: 76 },
  { text: "Не зарабатывают", s: g(wt("не", 15.34)), e: g(wt("Как", 16.35)), y: 0.13, size: 84 },
  { text: "Суть ниши", s: g(wt("Суть", 33.41)), e: g(wt("довольно", 34.15)), y: 0.13, size: 76 },
  { text: "Довольно простая", s: g(wt("довольно", 34.15)), e: g(wt("Ты", 35.33)), y: 0.13, size: 76 },
  { text: "Ты просто берёшь ссылку", s: g(wt("Ты", 35.33)), e: g(wt("В", 41.00)), y: 0.13, size: 76, sub: "отправляешь эту ссылку клиенту", subAt: wt("отправляешь", 39.30) - wt("Ты", 35.33) },
];
export const ev = {
  card: [g(wt("определённо", 25.76)), g(wt("И", 27.61))] as [number, number],
  screen: [g(wt("1", 30.29)), g(wt("Суть", 33.41))] as [number, number],
  steps: [g(wt("Шаг", 46.01)), 0] as [number, number],
  step1: wt("становимся", 49.84), step2: wt("регистрируемся", 55.52), step3: wt("находим", 59.29), step4: wt("начинаем", 94.48),
  flash: g(wt("Ведь", 95.73)),
  notEarn: g(wt("не", 15.34)),
};
ev.steps[1] = T.duration;
