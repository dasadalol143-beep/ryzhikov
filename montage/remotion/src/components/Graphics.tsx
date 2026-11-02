// Брендовая графика: счётчик, плашки, пуш, крупный текст, CTA
import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const fmt = (v: number) => `${v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString("ru-RU").replace(/ |,/g, " ")}`;

/** Вход: прозрачность + подъём + масштаб, всегда пружиной. */
export const Entrance: React.FC<{ delay?: number; children: React.ReactNode; from?: number }> = ({ delay = 0, children, from = 40 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: theme.spring.smooth });
  return (
    <div style={{ opacity: p, transform: `translateY(${interpolate(p, [0, 1], [from, 0])}px) scale(${interpolate(p, [0, 1], [0.94, 1])})` }}>
      {children}
    </div>
  );
};

/** Счётчик денег. steps — ступеньки по банкам (растёт рывками). Доход gold, потери loss. */
export const MoneyCounter: React.FC<{
  steps: number[]; delay?: number; perStep?: number; color?: "gold" | "loss" | "text"; prefix?: string; size?: number; glow?: boolean;
}> = ({ steps, delay = 0, perStep = 14, color = "gold", prefix = "", size = 150, glow = true }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  let value = steps[0];
  let kick = 0;
  for (let i = 0; i < steps.length - 1; i++) {
    const start = delay + i * perStep;
    const p = spring({ frame: frame - start, fps, config: theme.spring.counter });
    // пружина асимптотична: на последних 1,5% встаём ровно на цифру, иначе висит «129 985»
    if (frame >= start) value = p > 0.985 ? steps[i + 1] : steps[i] + (steps[i + 1] - steps[i]) * p;
    const k = spring({ frame: frame - start, fps, config: theme.spring.snappy });
    kick = Math.max(kick, frame >= start ? (1 - k) * 0.08 : 0);
  }
  const enter = spring({ frame: frame - delay + 4, fps, config: theme.spring.bouncy });
  const breathe = 1 + Math.sin(frame / 22) * 0.012;
  const c = theme.colors[color];
  return (
    <div style={{
      fontFamily: theme.fonts.display, fontWeight: 800, fontSize: size, color: c, letterSpacing: "-0.03em", lineHeight: 1,
      fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", textAlign: "center", opacity: enter,
      transform: `scale(${(0.8 + 0.2 * enter + kick) * breathe})`,
      WebkitTextStroke: "3px rgba(0,0,0,0.6)",
      textShadow: glow ? `0 0 60px ${c}66, 0 0 120px ${c}33, 0 8px 0 rgba(0,0,0,0.5)` : "0 8px 0 rgba(0,0,0,0.5)",
    }}>
      {prefix}{fmt(value)} ₽
    </div>
  );
};

/** Крупное слово по центру (ДРУГ = ТЫ САМ). Слова влетают по очереди. */
export const BigText: React.FC<{ text: string; delay?: number; color?: string; size?: number; accent?: string }> = ({
  text, delay = 0, color = theme.colors.text, size = 118, accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: size * 0.28, rowGap: 8, padding: "0 60px",
      fontFamily: theme.fonts.display, fontWeight: 800, fontSize: size, lineHeight: 1.05, letterSpacing: "-0.03em", textTransform: "uppercase",
      textAlign: "center" }}>
      {text.split(" ").map((w, i) => {
        const p = spring({ frame: frame - delay - i * 3, fps, config: theme.spring.snappy });
        const isAccent = accent && w.toUpperCase().includes(accent.toUpperCase());
        return (
          <span key={i} style={{ display: "inline-block", opacity: p, color: isAccent ? theme.colors.gold : color,
            transform: `translateY(${interpolate(p, [0, 1], [50, 0])}px) scale(${interpolate(p, [0, 1], [1.2, 1])})`,
            textShadow: "0 6px 0 rgba(0,0,0,0.55), 0 0 30px rgba(0,0,0,0.5)" }}>{w}</span>
        );
      })}
    </div>
  );
};

/** Плашка: ШАГ 1, ПИШИ «РКО», БЕСПЛАТНО. */
export const Plate: React.FC<{ text: string; delay?: number; bg?: "gold" | "dark" | "loss"; size?: number }> = ({ text, delay = 0, bg = "gold", size = 84 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: theme.spring.bouncy });
  const back = bg === "gold" ? theme.colors.gold : bg === "loss" ? theme.colors.loss : theme.colors.plateDark;
  const fg = bg === "gold" ? "#111" : theme.colors.text;
  return (
    <div style={{ display: "inline-block", padding: `${size * 0.32}px ${size * 0.6}px`, borderRadius: 28, background: back, color: fg,
      fontFamily: theme.fonts.display, fontWeight: 800, fontSize: size, letterSpacing: "-0.02em", lineHeight: 1,
      boxShadow: bg === "gold" ? `0 0 60px ${theme.colors.goldGlow}, 0 18px 40px rgba(0,0,0,0.5)` : "0 18px 40px rgba(0,0,0,0.5)",
      border: bg === "dark" ? "2px solid rgba(255,255,255,0.12)" : "none",
      opacity: p, transform: `scale(${interpolate(p, [0, 1], [0.6, 1])}) rotate(${interpolate(p, [0, 1], [-4, 0])}deg)` }}>
      {text}
    </div>
  );
};

/** Пуш-уведомление «Начисление +14 000 ₽» — выезжает сверху. */
export const Push: React.FC<{ amount: string; delay?: number; title?: string }> = ({ amount, delay = 0, title = "Партнёрка · сейчас" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: theme.spring.snappy });
  return (
    <div style={{ width: 940, display: "flex", alignItems: "center", gap: 30, padding: "34px 38px", borderRadius: 46,
      background: "rgba(245,245,247,0.95)", boxShadow: "0 30px 60px rgba(0,0,0,0.45)", fontFamily: theme.fonts.ui,
      transform: `translateY(${interpolate(p, [0, 1], [-320, 0])}px) scale(${interpolate(p, [0, 1], [0.92, 1])})`, opacity: p }}>
      <div style={{ width: 118, height: 118, borderRadius: 28, background: "#21B05A", color: "white", fontSize: 66, fontWeight: 700,
        display: "flex", alignItems: "center", justifyContent: "center" }}>₽</div>
      <div>
        <div style={{ fontSize: 36, color: "#6E6E73", fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 58, color: "#111", fontWeight: 700, letterSpacing: "-0.01em" }}>Начисление {amount}</div>
      </div>
    </div>
  );
};

/** CTA: ПИШИ «РКО» + стрелка вниз к комментариям, держится и дышит. */
export const CTA: React.FC<{ word?: string; delay?: number; sub?: string }> = ({ word = "РКО", delay = 0, sub = "бесплатный урок в комментариях" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay - 10, fps, config: theme.spring.smooth });
  const bob = Math.sin((frame - delay) / 6) * 14;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 40 }}>
      <Plate text={`ПИШИ «${word}»`} delay={delay} size={96} />
      <div style={{ opacity: p, fontFamily: theme.fonts.body, fontWeight: 700, fontSize: 48, color: theme.colors.text, textAlign: "center" }}>{sub}</div>
      <svg width="90" height="110" viewBox="0 0 90 110" style={{ opacity: p, transform: `translateY(${bob}px)` }}>
        <path d="M45 6 V92 M12 62 L45 98 L78 62" stroke={theme.colors.gold} strokeWidth="12" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

/** Схема «ССЫЛКА → ИП → +14 000 ₽»: пункты появляются по очереди, стрелки рисуются. */
export const Flow: React.FC<{ items: string[]; delay?: number; per?: number; size?: number }> = ({ items, delay = 0, per = 10, size = 64 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      {items.map((it, i) => {
        const p = spring({ frame: frame - delay - i * per, fps, config: theme.spring.snappy });
        const last = i === items.length - 1;
        const arrow = interpolate(frame - delay - i * per, [4, 12], [0, 1], { ...clamp, easing: theme.ease.out });
        return (
          <React.Fragment key={i}>
            <div style={{ opacity: p, transform: `translateX(${interpolate(p, [0, 1], [i % 2 ? 80 : -80, 0])}px) scale(${interpolate(p, [0, 1], [0.9, 1])})`,
              padding: `${size * 0.34}px ${size * 0.7}px`, borderRadius: 26, fontFamily: theme.fonts.display, fontWeight: 800, fontSize: size,
              background: last ? theme.colors.gold : "rgba(255,255,255,0.08)", color: last ? "#111" : theme.colors.text,
              border: last ? "none" : "2px solid rgba(255,255,255,0.14)", boxShadow: last ? `0 0 60px ${theme.colors.goldGlow}` : "none" }}>
              {it}
            </div>
            {!last && (
              <svg width="40" height="56" viewBox="0 0 40 70"><path d="M20 4 V58 M6 44 L20 62 L34 44" stroke={theme.colors.textDim} strokeWidth="7"
                fill="none" strokeLinecap="round" strokeDasharray="90" strokeDashoffset={90 * (1 - arrow)} /></svg>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
