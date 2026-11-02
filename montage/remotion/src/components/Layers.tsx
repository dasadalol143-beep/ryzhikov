// Пятислойный стек: фон-меш → ассеты → графика → грейд → зерно + виньетка
import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { theme, Mood } from "../theme";

const moodColor = (m: Mood) => (m === "cold" ? theme.colors.cold : m === "warm" ? theme.colors.warm : theme.colors.gold);

export const BgMesh: React.FC<{ mood?: Mood }> = ({ mood = "neutral" }) => {
  const frame = useCurrentFrame();
  const c = moodColor(mood);
  const d1 = Math.sin(frame / 55) * 50;
  const d2 = Math.cos(frame / 70) * 40;
  return (
    <AbsoluteFill style={{ background: theme.colors.bg, overflow: "hidden" }}>
      <div style={{ position: "absolute", width: 1400, height: 1400, borderRadius: "50%", top: -500, left: -400 + d1,
        filter: "blur(60px)", background: `radial-gradient(circle, ${c}40, transparent 62%)` }} />
      <div style={{ position: "absolute", width: 1100, height: 1100, borderRadius: "50%", bottom: -450, right: -350 - d2,
        filter: "blur(80px)", background: `radial-gradient(circle, ${c}26, transparent 65%)` }} />
    </AbsoluteFill>
  );
};

export const Grade: React.FC<{ mood?: Mood }> = ({ mood = "neutral" }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <AbsoluteFill style={{ backgroundColor: moodColor(mood), mixBlendMode: "soft-light", opacity: mood === "neutral" ? 0.1 : 0.22 }} />
    <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.25), transparent 25%, transparent 70%, rgba(0,0,0,0.35))" }} />
  </AbsoluteFill>
);

export const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  const noise = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", backgroundImage: noise, backgroundSize: "220px",
      backgroundPosition: `${(frame * 7) % 220}px ${(frame * 13) % 220}px`, opacity: 0.07, mixBlendMode: "overlay" }} />
  );
};

export const Vignette: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none", background: "radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,0.45) 100%)" }} />
);

/** Медленный зум на каждом фото. dir=1 приближение, -1 отдаление — чередуй между кадрами. */
export const KenBurns: React.FC<{ src: string; dir?: 1 | -1; card?: boolean }> = ({ src, dir = 1, card = false }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const p = interpolate(frame, [0, durationInFrames], [0, 1], { easing: theme.ease.inOut, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale = dir === 1 ? 1 + 0.1 * p : 1.1 - 0.1 * p;
  const pan = interpolate(p, [0, 1], [0, -25]);
  const img = (
    <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale}) translateX(${pan}px)` }} />
  );
  if (!card) return <AbsoluteFill>{img}</AbsoluteFill>;
  return (
    <AbsoluteFill style={{ padding: "260px 70px 420px" }}>
      <div style={{ width: "100%", height: "100%", borderRadius: 36, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 40px 80px -20px rgba(0,0,0,0.7)" }}>{img}</div>
    </AbsoluteFill>
  );
};

/** Обёртка сцены: стек слоёв + быстрый выход. */
export const Scene: React.FC<{ mood?: Mood; bg?: React.ReactNode; children: React.ReactNode }> = ({ mood = "neutral", bg, children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const exit = interpolate(frame, [durationInFrames - 8, durationInFrames], [0, 1], { easing: theme.ease.in, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <BgMesh mood={mood} />
      {bg}
      <AbsoluteFill style={{ opacity: 1 - exit, transform: `translateY(${-40 * exit}px) scale(${1 - 0.03 * exit})` }}>{children}</AbsoluteFill>
      <Grade mood={mood} />
      <Grain />
      <Vignette />
    </AbsoluteFill>
  );
};
