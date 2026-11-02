// Карусель банков едет вбок + счётчик под ней с вертикальным размытием цифр (как на быстрой прокрутке)
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

const C = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// Упрощённые векторные знаки банков (без растровых логотипов — чёткие на любом размере)
const Sber = () => (
  <svg viewBox="0 0 100 100" width="96" height="96"><circle cx="50" cy="50" r="38" fill="none" stroke="#21A038" strokeWidth="9" />
    <path d="M30 50 L45 64 L76 32" fill="none" stroke="#21A038" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const Ozon = () => (
  <div style={{ fontFamily: theme.fonts.ui, fontWeight: 800, color: "#1F5BFF", fontSize: 44, lineHeight: 0.92, letterSpacing: "-0.02em", textAlign: "left" }}>ozon<br />банк</div>
);
const Alfa = () => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
    <div style={{ fontFamily: theme.fonts.ui, fontWeight: 800, color: "#EF3124", fontSize: 104, lineHeight: 0.85 }}>A</div>
    <div style={{ width: 66, height: 9, background: "#EF3124", marginTop: 6 }} />
  </div>
);
const Vtb = () => (
  <svg viewBox="0 0 120 80" width="112" height="76">{[0, 1, 2].map((i) => <path key={i} d={`M${18 - i * 6} ${12 + i * 22} H110 L${104 - i * 0} ${28 + i * 22} H${12 - i * 6} Z`} fill={i === 1 ? "#3AA7FF" : "#1E8CFF"} />)}</svg>
);
const Tbank = () => (
  <svg viewBox="0 0 100 100" width="92" height="92"><path d="M14 10 H86 V58 C86 76 70 88 50 94 C30 88 14 76 14 58 Z" fill="#FFDD2D" />
    <path d="M32 30 H68 V42 H56 V72 H44 V42 H32 Z" fill="#1A1A1A" /></svg>
);
const LOGOS = [Sber, Ozon, Alfa, Vtb, Tbank];

const Tile: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  // логотипы внутри масштабируются вместе с плиткой

  <div style={{ width: 300, height: 300, borderRadius: 60, background: "linear-gradient(160deg,#1A1A1D,#0F0F11)", border: "1.5px solid rgba(255,255,255,0.07)",
    boxShadow: "0 24px 50px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
    <div style={{ transform: "scale(1.5)" }}>{children}</div>
  </div>
);

const fmtDots = (v: number) => `${Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}₽`;

export const BankCarousel: React.FC<{ from?: number; to: number; countStart: number; countEnd: number; y?: number }> = ({
  from = 0, to, countStart, countEnd, y = 0.42,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const enter = interpolate(frame, [0, 0.4 * fps], [0, 1], { ...C, easing: theme.ease.out });
  const step = 300 + 40;
  const x = -t * 420; // скорость ленты, px/сек
  const n = 14;
  // Счётчик: разгон и мягкое торможение к финальной сумме
  const pr = interpolate(t, [countStart, countEnd], [0, 1], { ...C, easing: (v) => (v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2) });
  const prPrev = interpolate(t - 1 / fps, [countStart, countEnd], [0, 1], { ...C, easing: (v) => (v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2) });
  const val = from + (to - from) * pr;
  const vel = Math.abs((pr - prPrev) * (to - from)); // ₽ за кадр
  const vblur = Math.min(14, vel / 170);
  const done = interpolate(t, [countEnd, countEnd + 0.35], [0, 1], C);
  return (
    <AbsoluteFill style={{ opacity: enter, filter: `blur(${(1 - enter) * 12}px)` }}>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id="vblur"><feGaussianBlur stdDeviation={`0 ${vblur.toFixed(2)}`} /></filter>
      </svg>
      <div style={{ position: "absolute", top: height * y - 150, left: 0, width, height: 300, overflow: "visible" }}>
        <div style={{ position: "absolute", left: ((x % step) + step) % step - step * 2, top: 0, display: "flex", gap: 40 }}>
          {Array.from({ length: n }).map((_, i) => {
            const L = LOGOS[(i + Math.floor(-x / step)) % LOGOS.length];
            return <Tile key={i}><L /></Tile>;
          })}
        </div>
      </div>
      <div style={{ position: "absolute", top: height * y + 210, width, textAlign: "center", fontFamily: theme.fonts.ui, fontWeight: 800, fontSize: 168,
        letterSpacing: "-0.01em", color: "#F2F2F2", fontVariantNumeric: "tabular-nums", filter: "url(#vblur)",
        textShadow: `0 0 ${10 + 30 * done}px rgba(255,255,255,${0.15 + 0.25 * done})`, transform: `scale(${1 + 0.06 * done - 0.06 * Math.max(0, done - 0.6)})` }}>
        {fmtDots(val)}
      </div>
    </AbsoluteFill>
  );
};
