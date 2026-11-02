// Переходы премиум-уровня: вспышка, расфокус, отъезд в Ч/Б. Оборачивают сцену целиком.
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

const C = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type Fx = {
  flashIn?: number; // сек: вход из белой вспышки
  blurIn?: number; // сек: вход из расфокуса
  blurOut?: number; // сек до конца: выход в расфокус
  zoomOutBW?: number; // сек до конца: отъезд + обесцвечивание + размытие
  flashOut?: number; // сек до конца: выход во вспышку
  fadeOut?: number; // сек до конца: в чёрное
};

/** Обёртка сцены с переходами на входе и выходе. Длительность берётся из Sequence. */
export const FxScene: React.FC<Fx & { children: React.ReactNode }> = ({ children, flashIn, blurIn, blurOut, zoomOutBW, flashOut, fadeOut }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames: D } = useVideoConfig();
  const f = (s?: number) => Math.max(1, Math.round((s ?? 0) * fps));
  let blur = 0, scale = 1, gray = 0, bright = 1, white = 0, black = 0;
  if (flashIn) {
    const p = interpolate(frame, [0, f(flashIn)], [0, 1], { ...C, easing: theme.ease.out });
    white = Math.max(white, 1 - p); blur += 18 * (1 - p); scale *= 1.08 - 0.08 * p;
  }
  if (blurIn) {
    const p = interpolate(frame, [0, f(blurIn)], [0, 1], { ...C, easing: theme.ease.out });
    blur += 26 * (1 - p); scale *= 1.04 - 0.04 * p;
  }
  if (blurOut) {
    const p = interpolate(frame, [D - f(blurOut), D], [0, 1], { ...C, easing: theme.ease.in });
    blur += 26 * p; scale *= 1 + 0.04 * p;
  }
  if (zoomOutBW) {
    const p = interpolate(frame, [D - f(zoomOutBW), D], [0, 1], { ...C, easing: theme.ease.in });
    blur += 16 * p; scale *= 1 - 0.14 * p; gray = p; bright = 1 - 0.65 * p;
  }
  if (flashOut) {
    const p = interpolate(frame, [D - f(flashOut), D], [0, 1], { ...C, easing: theme.ease.in });
    white = Math.max(white, p); blur += 14 * p; scale *= 1 + 0.06 * p;
  }
  if (fadeOut) black = interpolate(frame, [D - f(fadeOut), D], [0, 1], { ...C, easing: theme.ease.in });
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, filter: `blur(${blur}px) grayscale(${gray}) brightness(${bright})` }}>{children}</AbsoluteFill>
      {white > 0 && <AbsoluteFill style={{ background: "#fff", opacity: white }} />}
      {black > 0 && <AbsoluteFill style={{ background: "#000", opacity: black }} />}
    </AbsoluteFill>
  );
};
