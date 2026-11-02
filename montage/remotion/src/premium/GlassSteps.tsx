// Ч/Б сцена с листьями: вопрос → стеклянные плашки шагов, новая вспыхивает, камера едет за списком.
import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

const C = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Фон: чёрно-белые листья, медленно дышат и плывут. */
export const LeafBG: React.FC<{ src?: string }> = ({ src = "media/fern_bw.jpg" }) => {
  const frame = useCurrentFrame();
  const s = 1.06 + Math.sin(frame / 60) * 0.015;
  return (
    <AbsoluteFill style={{ background: "#050505", overflow: "hidden" }}>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover",
        transform: `scale(${s}) translate(${Math.sin(frame / 80) * 8}px, ${Math.cos(frame / 95) * 10}px) rotate(${Math.sin(frame / 120) * 0.4}deg)`,
        filter: "grayscale(1) brightness(0.82)" }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(255,255,255,0.05), transparent 60%)" }} />
    </AbsoluteFill>
  );
};

export type Step = { n: number; label: string; at: number };
type Q = { small: string; big: string; s1: number; s2: number };

const Chip: React.FC<{ st: Step; y: number; x: number }> = ({ st, y, x }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - Math.round(st.at * fps);
  if (local < 0) return null;
  const p = interpolate(local, [0, 0.35 * fps], [0, 1], { ...C, easing: theme.ease.out });
  const hot = interpolate(local, [0, 0.25 * fps, 1.1 * fps], [0, 1, 0], C); // вспышка новой плашки
  const badgeP = interpolate(local, [0.15 * fps, 0.45 * fps], [0, 1], { ...C, easing: theme.ease.out });
  return (
    <div style={{ position: "absolute", left: x, top: y, transformOrigin: "left center", transform: `translateY(-50%) translateY(${(1 - p) * 30}px) scale(${0.92 + 0.08 * p})`,
      opacity: p, filter: `blur(${(1 - p) * 8}px)` }}>
      <div style={{ position: "relative", padding: "34px 58px", borderRadius: 28,
        background: `rgba(255,255,255,${0.055 + 0.12 * hot})`, border: "1.5px solid rgba(255,255,255,0.12)",
        backdropFilter: "blur(14px)", boxShadow: `0 18px 40px rgba(0,0,0,0.55), 0 0 ${60 * hot}px rgba(255,255,255,${0.35 * hot}), inset 0 1px 0 rgba(255,255,255,0.08)`,
        fontFamily: theme.fonts.ui, fontWeight: 700, fontSize: 54, letterSpacing: "0.01em", color: "#F4F4F4", whiteSpace: "nowrap",
        textShadow: `0 0 ${18 * hot}px rgba(255,255,255,${0.9 * hot})` }}>
        {st.label}
        {/* номерок как в оригинале: ~76 px, тёмная плашка со светлой рамкой, цифра ~46 px */}
        <div style={{ position: "absolute", left: -30, top: -38, width: 76, height: 76, borderRadius: 20, background: "rgba(28,28,30,0.98)",
          border: "2px solid rgba(255,255,255,0.22)", boxShadow: "0 8px 18px rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 46, fontWeight: 700, textShadow: "none", color: "#EDEDED", opacity: badgeP, transform: `scale(${0.6 + 0.4 * badgeP})` }}>{st.n}</div>
      </div>
    </div>
  );
};

export const GlassSteps: React.FC<{ q: Q; steps: Step[]; gap?: number; exitAt?: number; x?: number }> = ({ q, steps, gap = 200, exitAt, x = 0.17 }) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();
  const sec = (s: number) => Math.round(s * fps);
  // Камера: список стоит на ~трети высоты (как в оригинале), лёгкий дрейф вместо прыжков
  const firstAt = steps[0].at;
  const camY = height * 0.335 + Math.sin(frame / 70) * 10 - interpolate(frame, [sec(firstAt), sec(firstAt) + 30 * fps], [0, 40], C);
  // Вопрос «ЧТО ДЛЯ ЭТОГО НУЖНО?»
  const qa = interpolate(frame - sec(q.s1), [0, 0.35 * fps], [0, 1], { ...C, easing: theme.ease.out });
  const qb = interpolate(frame - sec(q.s2), [0, 0.3 * fps], [0, 1], { ...C, easing: theme.ease.out });
  const qDim = interpolate(frame - sec(firstAt), [0, 0.4 * fps], [0, 1], C); // при первой плашке вопрос тускнеет
  const qOutAt = firstAt + 0.55; // в оригинале вопрос уходит через ~0,5 сек после первой плашки
  const qOut = interpolate(frame - sec(qOutAt), [0, 0.45 * fps], [0, 1], { ...C, easing: theme.ease.in });
  // Выход всего списка двоящимся размытием
  const out = exitAt ? interpolate(frame - sec(exitAt), [0, 0.35 * fps], [0, 1], { ...C, easing: theme.ease.in }) : 0;
  const list = steps.map((st, i) => <Chip key={st.n} st={st} x={x * width} y={camY + i * gap} />);
  return (
    <AbsoluteFill>
      {qOut < 1 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10,
          opacity: (1 - qOut) * (1 - 0.55 * qDim), filter: `blur(${qOut * 10 + qDim * 1.5}px)`, transform: `translateY(${qOut * 60}px)` }}>
          <div style={{ fontFamily: theme.fonts.ui, fontWeight: 500, fontSize: 92, color: "#E6E6E6", textTransform: "uppercase", opacity: qa,
            filter: `blur(${(1 - qa) * 8}px)`, transform: `scale(${1.15 - 0.15 * qa})` }}>{q.small}</div>
          <div style={{ fontFamily: theme.fonts.ui, fontWeight: 800, fontSize: 176, color: "#EFEFEF", letterSpacing: "-0.01em", opacity: qb,
            filter: `blur(${(1 - qb) * 10}px)`, transform: `scale(${1.25 - 0.25 * qb})`, textShadow: "0 0 30px rgba(255,255,255,0.25)" }}>{q.big}</div>
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{ opacity: 1 - out, filter: `blur(${out * 6}px)`, transform: `translateX(${-out * 60}px)` }}>{list}</AbsoluteFill>
      {out > 0 && (
        <AbsoluteFill style={{ opacity: 0.5 * (1 - out), transform: `translateX(${out * 40}px) translateY(${out * 14}px)`, filter: "blur(2px)" }}>{list}</AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
