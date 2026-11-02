// Glow: светящийся кинетический текст с эхо-шлейфом (референс premium_glow.md, приёмы 1–4)
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

const C = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const glow = {
  fill: "#FFE7A0",
  shadow: "0 0 8px rgba(255,210,100,1), 0 0 22px rgba(255,186,60,0.85), 0 0 56px rgba(255,165,30,0.55)",
  stroke: "rgba(255,205,110,0.85)",
};

export type Lvl = "cap" | "small" | "big";
export type GWord = { t: string; s: number; lvl?: Lvl };
export type GSeg = {
  s: number; // начало сегмента, сек
  e: number; // конец (начало растворения), сек
  lines: GWord[][];
  x?: number; // центр/левый край, доля ширины
  y?: number; // центр по вертикали, доля высоты
  align?: "center" | "left";
  outline?: boolean; // контурное эхо (цифры, CTA)
  dx?: number[]; // сдвиг каждой строки, доля ширины (КРЕДИТНУЮ ← / КАРТУ →)
  gap?: number; // расстояние между строками, px (может быть отрицательным)
  /** phrase — вся фраза сразу (по умолчанию для 1 строки), line — по строкам (лесенка), word — по словам */
  reveal?: "phrase" | "line" | "word";
};

const SIZE: Record<Lvl, number> = { small: 64, cap: 106, big: 160 };
const WEIGHT: Record<Lvl, number> = { small: 500, cap: 500, big: 500 };

const textStyle = (lvl: Lvl): React.CSSProperties => ({
  fontFamily: theme.fonts.ui,
  fontWeight: WEIGHT[lvl],
  fontSize: SIZE[lvl],
  lineHeight: 1,
  letterSpacing: lvl === "small" ? "0" : "-0.01em",
  textTransform: lvl === "small" ? "none" : "uppercase",
  whiteSpace: "nowrap",
  color: glow.fill,
  textShadow: glow.shadow,
});

/** Одно слово: проявляется из размытия с увеличением, за ним гаснет увеличенная копия-эхо. */
const Word: React.FC<{ w: GWord; outline?: boolean; at: number }> = ({ w, outline, at }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lvl = w.lvl ?? "cap";
  const local = frame - Math.round(at * fps);
  if (local < 0) return <span style={{ ...textStyle(lvl), opacity: 0 }}>{w.t}</span>; // держит место в строке
  const p = interpolate(local, [0, 0.3 * fps], [0, 1], { ...C, easing: theme.ease.out });
  const q = interpolate(local, [0, 0.6 * fps], [0, 1], { ...C, easing: theme.ease.out });
  const base = textStyle(lvl);
  const breathe = 1 + Math.sin((frame + w.s * 37) / 18) * 0.006;
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      {/* эхо-шлейф при появлении */}
      <span aria-hidden style={{ ...base, position: "absolute", left: 0, top: 0, opacity: 0.5 * (1 - q),
        transform: `scale(${1.12 + 0.3 * q})`, filter: `blur(${2 + 8 * q}px)` }}>{w.t}</span>
      {/* постоянное широкое эхо: бледная увеличенная копия всё время висит за словом */}
      <span aria-hidden style={{ ...base, position: "absolute", left: 0, top: 0, opacity: 0.22 * p, transform: `scale(${1.17 + Math.sin(frame / 16) * 0.01})`, filter: "blur(3px)" }}>{w.t}</span>
      {outline &&
        [1.07, 1.15].map((k, i) => (
          <span key={k} aria-hidden style={{ ...base, position: "absolute", left: 0, top: 0, color: "transparent", textShadow: "none",
            WebkitTextStroke: `2px ${glow.stroke}`, opacity: p * (0.42 - i * 0.18) * (0.85 + 0.15 * Math.sin(frame / 9 + i)),
            transform: `scale(${k + Math.sin(frame / 14 + i) * 0.01})`, filter: "blur(0.6px)" }}>{w.t}</span>
        ))}
      <span style={{ ...base, display: "inline-block", opacity: p, transform: `scale(${(1.35 - 0.35 * p) * breathe})`,
        filter: `blur(${(1 - p) * 10}px)` }}>{w.t}</span>
    </span>
  );
};

/** Сегмент: 1–4 строки слов (лесенка), позиция в кадре, общий выход с растворением и эхо. */
export const GlowSeg: React.FC<{ seg: GSeg }> = ({ seg }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const sf = Math.round(seg.s * fps);
  const ef = Math.round(seg.e * fps);
  // выход быстрый (0,16 с) и с ease-out: старая фраза почти сразу освобождает место новой, остаётся только шлейф
  const exitDur = Math.round(0.16 * fps);
  if (frame < sf || frame > ef + exitDur) return null;
  const x = interpolate(frame, [ef, ef + exitDur], [0, 1], { ...C, easing: theme.ease.out });
  const align = seg.align ?? "center";
  // замер оригинала: короткая фраза появляется целиком в начале; лесенка — по строкам, +0,08 с к первому слову строки
  const reveal = seg.reveal ?? (seg.lines.length > 1 ? "line" : "phrase");
  const startOf = (li: number, w: GWord) =>
    reveal === "word" ? w.s : reveal === "phrase" ? seg.s : li === 0 ? seg.s : Math.max(seg.s, seg.lines[li][0].s + 0.08);
  const left = (seg.x ?? 0.5) * width;
  const top = (seg.y ?? 0.72) * height;
  const body = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: align === "left" ? "flex-start" : "center", gap: seg.gap ?? 4 }}>
      {seg.lines.map((line, i) => (
        <div key={i} style={{ display: "flex", gap: 40, alignItems: "baseline", transform: `translateX(${(seg.dx?.[i] ?? 0) * width}px)` }}>
          {line.map((w, j) => <Word key={j} w={w} outline={seg.outline} at={startOf(i, w)} />)}
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ position: "absolute", left, top, transform: `translate(${align === "left" ? "0" : "-50%"}, -50%)` }}>
      {/* растворение: копия разлетается шире и гаснет — даёт тот самый шлейф между словами */}
      {x > 0 && (
        <div aria-hidden style={{ position: "absolute", inset: 0, opacity: 0.3 * (1 - x), transform: `scale(${1.1 + 0.35 * x})`, filter: `blur(${4 + 10 * x}px)` }}>
          {body}
        </div>
      )}
      <div style={{ opacity: Math.pow(1 - x, 2), transform: `scale(${1 + 0.12 * x})`, filter: `blur(${9 * x}px)` }}>{body}</div>
    </div>
  );
};

export const GlowCaptions: React.FC<{ segs: GSeg[]; shade?: number | ((t: number) => number) }> = ({ segs, shade = 0.5 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sh = typeof shade === "function" ? shade(frame / fps) : shade;
  return (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    {sh > 0 && (
      <AbsoluteFill style={{ background: `linear-gradient(180deg, transparent 52%, rgba(0,0,0,${sh * 0.55}) 72%, rgba(0,0,0,${sh}) 100%)` }} />
    )}
    {segs.map((s, i) => <GlowSeg key={i} seg={s} />)}
  </AbsoluteFill>
  );
};

/** Быстрый конструктор: "В 18 ЛЕТ" + таймкоды слов → GWord[] */
export const words = (pairs: [string, number, Lvl?][]): GWord[] => pairs.map(([t, s, lvl]) => ({ t, s, lvl }));
