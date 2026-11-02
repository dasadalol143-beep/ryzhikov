// theme.ts — единый источник стиля Рыжикова. Цвета, изинги, пружины, шрифты — только отсюда.
import { Easing } from "remotion";

export const theme = {
  colors: {
    bg: "#0B0B0E",
    bgAlt: "#15151B",
    gold: "#E6B83C", // доход, hero-цвет: максимум один элемент на кадр
    goldGlow: "rgba(230, 184, 60, 0.45)",
    loss: "#E83434", // потери, долги
    text: "#F5F3EE",
    textDim: "#A8A6A0",
    highlight: "#FFE100", // активное слово в субтитрах
    plateDark: "#0E0E10",
    // «цвет ведёт историю»: прошлое холодное → Пхукет тёплый
    cold: "#3A5A8C",
    warm: "#E8963D",
  },
  fonts: {
    display: "Unbounded", // хуки, цифры, плашки
    body: "Montserrat", // субтитры
    ui: "Inter", // пуши, интерфейсы
  },
  ease: {
    out: Easing.bezier(0.16, 1, 0.3, 1),
    inOut: Easing.bezier(0.83, 0, 0.17, 1),
    in: Easing.bezier(0.7, 0, 0.84, 0),
  },
  spring: {
    snappy: { damping: 14, stiffness: 160, mass: 0.6 },
    smooth: { damping: 20, stiffness: 90, mass: 1 },
    bouncy: { damping: 11, stiffness: 170, mass: 0.7 },
    counter: { damping: 30, stiffness: 60, mass: 1 },
  },
  safe: { top: 230, bottom: 380 }, // 9:16: интерфейс Reels перекрывает верх и низ
} as const;

export type Mood = "cold" | "neutral" | "warm";
