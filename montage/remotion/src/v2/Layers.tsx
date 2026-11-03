// Слои v2: видео (камера) → текст «за тобой» → вырезанный человек (та же камера) → верхние слои.
import React from "react";
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { camAt, camStyle, CamCfg } from "./camera";

const C = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const out = Easing.bezier(0.16, 1, 0.3, 1);

export const FootageLayer: React.FC<{ cfg: CamCfg; src: string; offset?: number }> = ({ cfg, src, offset = 0 }) => {
  const frame = useCurrentFrame() + offset;
  const { fps, width, height } = useVideoConfig();
  const c = camAt(cfg, frame, fps, width, height);
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#000" }}>
      <AbsoluteFill style={camStyle(c)}>
        <OffthreadVideo src={staticFile(src)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Окно «текст за человеком»: внутри — текст, сверху — вырезанный человек с той же камерой. */
export const BehindWindow: React.FC<{ cfg: CamCfg; from: number; dur: number; person: string; children: React.ReactNode; front?: React.ReactNode }> = ({ cfg, from, dur, person, children, front }) => (
  <Sequence from={from} durationInFrames={dur} layout="none">
    <AbsoluteFill>{children}</AbsoluteFill>
    <PersonLayer cfg={cfg} from={from} src={person} />
    {front && <AbsoluteFill>{front}</AbsoluteFill>}
  </Sequence>
);

const PersonLayer: React.FC<{ cfg: CamCfg; from: number; src: string }> = ({ cfg, from, src }) => {
  const frame = useCurrentFrame() + from; // глобальный кадр — камера та же, что у видео
  const { fps, width, height } = useVideoConfig();
  const c = camAt(cfg, frame, fps, width, height);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={camStyle(c)}>
        <OffthreadVideo src={staticFile(src)} muted transparent style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const fmt = (v: number) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** Огромный текст за человеком: тёплый градиент, мягкое свечение, вход трекингом (без размытия). */
export const BigBehind: React.FC<{
  text?: string; count?: { from: number; to: number; dur: number; suffix?: string }; sub?: string; subAt?: number;
  y?: number; size?: number; dur: number;
}> = ({ text, count, sub, subAt = 0.6, y = 0.36, size = 250, dur }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const p = interpolate(frame, [0, 0.38 * fps], [0, 1], { ...C, easing: out });
  const o = interpolate(frame, [dur - 0.22 * fps, dur], [1, 0], C);
  const sp = interpolate(frame - subAt * fps, [0, 0.3 * fps], [0, 1], { ...C, easing: out });
  let label = text ?? "";
  if (count) {
    const q = spring({ frame, fps, config: { damping: 28, stiffness: 55, mass: 1 }, durationInFrames: Math.round(count.dur * fps) });
    label = fmt(q > 0.995 ? count.to : count.from + (count.to - count.from) * q) + (count.suffix ?? "");
  }
  const big: React.CSSProperties = {
    fontFamily: "Inter", fontWeight: 800, fontSize: size, lineHeight: 0.92, letterSpacing: `${(0.1 * (1 - p) - 0.03).toFixed(3)}em`,
    textTransform: "uppercase", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
    background: "linear-gradient(180deg, #FFFFFF 0%, #FFF2CC 45%, #F2C25A 100%)", WebkitBackgroundClip: "text", color: "transparent",
    filter: "drop-shadow(0 0 24px rgba(255,190,80,0.45)) drop-shadow(0 10px 30px rgba(0,0,0,0.35))",
  };
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <div style={{ position: "absolute", left: 0, width, top: y * height, transform: "translateY(-50%)", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ ...big, opacity: p, transform: `scale(${1.06 - 0.06 * p})` }}>{label}</div>
        {sub && (
          <div style={{ fontFamily: "Inter", fontWeight: 700, fontSize: size * 0.24, letterSpacing: "0.18em", color: "#FFF3D6", textTransform: "uppercase",
            marginTop: size * 0.06, opacity: sp, transform: `translateY(${(1 - sp) * 16}px)`, textShadow: "0 0 18px rgba(255,190,80,0.6), 0 4px 16px rgba(0,0,0,0.4)" }}>{sub}</div>
        )}
      </div>
    </AbsoluteFill>
  );
};

/** Подпись под большим словом — ПОВЕРХ человека (иначе голова её закрывает). Плашка-капсула с размытым фоном. */
export const SubFront: React.FC<{ text: string; at: number; dur: number; y?: number }> = ({ text, at, dur, y = 0.545 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = interpolate(frame - at * fps, [0, 0.3 * fps], [0, 1], { ...C, easing: out });
  const o = interpolate(frame, [dur - 0.2 * fps, dur], [1, 0], C);
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div style={{ position: "absolute", top: `${y * 100}%`, transform: `translateY(${(1 - p) * 18}px)`, opacity: p * o,
        fontFamily: "Inter", fontWeight: 700, fontSize: 46, letterSpacing: "0.16em", textTransform: "uppercase", color: "#FFF4DA",
        padding: "16px 34px", borderRadius: 999, background: "rgba(20,16,10,0.42)", backdropFilter: "blur(14px)",
        border: "1.5px solid rgba(255,220,150,0.35)", textShadow: "0 0 16px rgba(255,190,80,0.55)" }}>{text}</div>
    </AbsoluteFill>
  );
};
