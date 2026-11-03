// События ролика «14 000 ₽» (сек таймлайна). Без React: модуль читают и композиция, и сведение звука (tools/mix_v14k.py).
import timeline from "../data/v14k.timeline.json";
import { makeWT, TW } from "./words";
export const FPS = 24000 / 1001;
export const T = timeline as { duration: number; clips: { t_in: number; t_out: number; seg: number }[]; words: TW[] };
export const wt = makeWT(T.words);
export const END = 2.8;
export const TOTAL = Math.ceil((T.duration + END) * FPS);

// ---------- события (время таймлайна, сек) ----------
export const ev = {
  challenge: [wt("челлендж", 1.8) - 0.05, wt("Научись", 2.6) - 0.03],
  k14: [wt("14", 3.6) - 0.04, T.clips[0].t_out - 0.04], k14sub: wt("каждый", 4.97) - 0.05,
  arb: [wt("арбитраж", 8.87) - 0.05, wt("И", 10.57) - 0.02],
  years: [wt("4", 24.44) - 0.06, T.clips[2].t_out - 0.04],
  m145: [wt("1", 38.73) - 0.06, T.clips[4].t_out - 0.04], m145sub: wt("каждый", 41.03) - 0.05,
  flow: [wt("Ты", 44.64) - 0.25, wt("шаги", 55.9) + 0.35],
  steps1: [wt("Шаг", 57.19) - 0.3, wt("В", 82.4) - 0.12],
  b200: [wt("200", 90.6) - 0.05, wt("на", 92.55) + 0.1], b200sub: wt("каждый", 91.8) - 0.05,
  steps2: [wt("Четвертый", 98.7) - 0.3, wt("После", 112.4) - 0.1],
  free: [wt("абсолютно", 122.0) - 0.05, wt("бесплатно", 122.7, "e") + 0.15],
  offer: [wt("Именно", 123.5) - 0.2, wt("шагов", 137.0, "e") + 0.25],
  k16: [wt("первые", 140.4) - 0.05, T.duration], push16: wt("тысяч", 141.1),
};
export const behindWins: [number, number][] = [ev.challenge, ev.k14, ev.arb, ev.years, ev.m145, ev.b200, ev.free, ev.k16] as [number, number][];

