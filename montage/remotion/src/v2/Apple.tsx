// Apple-сцены v2: светлая сцена «ссылка → клиент», боковая панель маршрута, карточка оффера, финальная плашка.
// Иконки векторные (резкие на любом размере), цвета: графит #1D1D1F, серый #86868B, акцент — тёплое золото.
import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const C = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const out = Easing.bezier(0.16, 1, 0.3, 1);
const io = Easing.bezier(0.65, 0, 0.35, 1);
export const A = { ink: "#1D1D1F", gray: "#86868B", line: "rgba(0,0,0,0.08)", gold: "#E3A72F", card: "#FFFFFF", bg1: "#F7F7F9", bg2: "#E8E8ED" };

const useP = (at: number, d = 0.45) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  return interpolate(f - at * fps, [0, d * fps], [0, 1], { ...C, easing: out });
};
const useSpring = (at: number) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  return spring({ frame: f - Math.round(at * fps), fps, config: { damping: 17, stiffness: 140, mass: 0.8 } });
};

// --- иконки ---
const IconLink = ({ c = A.ink }) => (
  <svg viewBox="0 0 100 100" width="160" height="160"><g fill="none" stroke={c} strokeWidth="8" strokeLinecap="round">
    <path d="M42 58 L58 42" /><path d="M46 30 L54 22 a17 17 0 0 1 24 24 L70 54" /><path d="M54 70 L46 78 a17 17 0 0 1 -24 -24 L30 46" /></g></svg>
);
const IconUser = ({ c = A.ink, s = 160 }) => (
  <svg viewBox="0 0 100 100" width={s} height={s}><circle cx="50" cy="34" r="16" fill={c} /><path d="M18 86 C20 64 34 56 50 56 C66 56 80 64 82 86 Z" fill={c} /></svg>
);
const IconCheck = () => (<svg viewBox="0 0 24 24" width="30" height="30"><path d="M5 12.5 L10 17 L19 7" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>);

const Tile: React.FC<{ at: number; label: string; children: React.ReactNode; accent?: boolean }> = ({ at, label, children, accent }) => {
  const s = useSpring(at);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26, opacity: s, transform: `translateY(${(1 - s) * 40}px) scale(${0.9 + 0.1 * s})` }}>
      <div style={{ width: 330, height: 330, borderRadius: 80, background: A.card, display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: `0 30px 70px rgba(0,0,0,0.12), 0 2px 0 rgba(255,255,255,0.9) inset${accent ? ", 0 0 0 3px rgba(227,167,47,0.55)" : ""}` }}>{children}</div>
      <div style={{ fontFamily: "Inter", fontWeight: 700, fontSize: 42, letterSpacing: "0.06em", color: A.ink, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
};

const Arrow: React.FC<{ at: number; w?: number }> = ({ at, w = 220 }) => {
  const p = useP(at, 0.5);
  return (
    <svg width={w} height="60" viewBox={`0 0 ${w} 60`} style={{ marginBottom: 70 }}>
      <path d={`M10 30 H${w - 20}`} stroke={A.gray} strokeWidth="6" strokeLinecap="round" strokeDasharray={w} strokeDashoffset={w * (1 - p)} />
      <path d={`M${w - 44} 12 L${w - 18} 30 L${w - 44} 48`} fill="none" stroke={A.gray} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity={p > 0.85 ? 1 : 0} />
    </svg>
  );
};

/** Вход/выход сцены без размытия: скруглённое «окно» раскрывается из центра, на выходе сжимается обратно. */
const Reveal: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const a = interpolate(f, [0, 0.5 * fps], [0, 1], { ...C, easing: out });
  const b = interpolate(f, [dur - 0.42 * fps, dur], [0, 1], { ...C, easing: io });
  const k = Math.min(a, 1 - b);
  const ins = (1 - k) * 46; // % с каждой стороны
  return (
    <AbsoluteFill style={{ clipPath: `inset(${ins * 0.9}% ${ins}% ${ins * 0.9}% ${ins}% round ${40 + 40 * (1 - k)}px)` }}>
      <AbsoluteFill style={{ transform: `scale(${1.04 - 0.04 * k})` }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

const LightBG: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at ${50 + Math.sin(f / 90) * 6}% 30%, #FFFFFF 0%, ${A.bg1} 40%, ${A.bg2} 100%)` }} />
  );
};

/** Сцена «Суть ниши»: ссылка → клиент, клиент = ты сам или друг. Время — локальное, сек. */
export const FlowScene: React.FC<{ dur: number; tTitle: number; tLink: number; tArrow: number; tClient: number; tSelf: number; tFriend: number }> = (p) => {
  const title = "СУТЬ НИШИ";
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const n = Math.round(interpolate(f - p.tTitle * fps, [0, 0.45 * fps], [0, title.length], C));
  const splitP = useP(p.tSelf, 0.5);
  return (
    <Reveal dur={p.dur * fps}>
      <LightBG />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: 40 }}>
        <div style={{ fontFamily: "Inter", fontWeight: 800, fontSize: 120, letterSpacing: "-0.02em", color: A.ink }}>
          {title.slice(0, n)}<span style={{ opacity: n < title.length && f % 16 < 8 ? 1 : 0, color: A.gold }}>|</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 40, marginTop: 110 }}>
          <Tile at={p.tLink} label="Реф. ссылка"><IconLink /></Tile>
          <Arrow at={p.tArrow} w={260} />
          <div style={{ position: "relative" }}>
            <div style={{ opacity: 1 - splitP }}><Tile at={p.tClient} label="Клиент" accent><IconUser /></Tile></div>
            <div style={{ position: "absolute", inset: 0, display: "flex", gap: 30, justifyContent: "center", left: -200, right: -200 }}>
              <Tile at={p.tSelf} label="Ты сам" accent><IconUser c={A.gold} s={150} /></Tile>
              <Tile at={p.tFriend} label="Друг"><IconUser s={150} /></Tile>
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </Reveal>
  );
};

export type StepItem = { n: number; title: string; sub: string; at: number; chips?: { t: string; at: number }[] };

/** Боковая панель маршрута справа. done — сколько шагов уже пройдено (галочки). */
export const StepsPanel: React.FC<{ dur: number; steps: StepItem[]; done?: number; title?: string }> = ({ dur, steps, done = 0, title = "Маршрут" }) => {
  const f = useCurrentFrame(); const { fps, width, height } = useVideoConfig();
  const a = spring({ frame: f, fps, config: { damping: 20, stiffness: 120, mass: 0.9 } });
  const b = interpolate(f, [dur * fps - 0.4 * fps, dur * fps], [0, 1], { ...C, easing: io });
  const x = (1 - a) * 0.55 * width + b * 0.55 * width;
  const t = f / fps;
  const active = steps.reduce((acc, s, i) => (t >= s.at ? i : acc), -1);
  return (
    <div style={{ position: "absolute", top: height * 0.1, height: height * 0.8, right: width * 0.045, width: width * 0.41, transform: `translateX(${x}px)`,
      borderRadius: 48, background: "rgba(250,250,252,0.93)", boxShadow: "0 40px 90px rgba(0,0,0,0.35), inset 0 1px 0 #fff", padding: "56px 60px", boxSizing: "border-box" }}>
      <div style={{ fontFamily: "Inter", fontWeight: 600, fontSize: 30, letterSpacing: "0.16em", color: A.gray, textTransform: "uppercase" }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 34, marginTop: 40 }}>
        {steps.map((s, i) => {
          const sp = spring({ frame: f - Math.round(s.at * fps), fps, config: { damping: 18, stiffness: 150, mass: 0.7 } });
          const isDone = i < done || (i < active);
          const isAct = i === active && i >= done;
          return (
            <div key={s.n} style={{ display: "flex", gap: 30, alignItems: "flex-start", opacity: 0.25 + 0.75 * sp, transform: `translateY(${(1 - sp) * 26}px)` }}>
              <div style={{ width: 74, height: 74, flex: "0 0 74px", borderRadius: 37, display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "Inter", fontWeight: 700, fontSize: 34, transition: "none",
                background: isDone ? A.ink : isAct ? A.gold : "transparent", color: isDone || isAct ? "#fff" : A.gray,
                border: isDone || isAct ? "none" : `3px solid ${A.line}`, boxShadow: isAct ? "0 10px 30px rgba(227,167,47,0.45)" : "none" }}>
                {isDone ? <IconCheck /> : s.n}
              </div>
              <div>
                <div style={{ fontFamily: "Inter", fontWeight: 700, fontSize: 46, color: isAct || isDone ? A.ink : A.gray, letterSpacing: "-0.01em" }}>{s.title}</div>
                <div style={{ fontFamily: "Inter", fontWeight: 500, fontSize: 30, color: A.gray, marginTop: 6 }}>{s.sub}</div>
                {s.chips && (
                  <div style={{ display: "flex", gap: 14, marginTop: 16, flexWrap: "wrap" }}>
                    {s.chips.map((c) => {
                      const cp = spring({ frame: f - Math.round(c.at * fps), fps, config: { damping: 16, stiffness: 170, mass: 0.6 } });
                      return (
                        <div key={c.t} style={{ fontFamily: "Inter", fontWeight: 600, fontSize: 26, padding: "10px 20px", borderRadius: 999, background: "#fff",
                          border: `2px solid ${A.line}`, color: A.ink, opacity: cp, transform: `scale(${0.85 + 0.15 * cp})` }}>{c.t}</div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Карточка «С чего начать»: FinCPA Network → Альфа · ИП на НПД. */
export const OfferPanel: React.FC<{ dur: number; tFcn: number; tAlfa: number; tDone: number }> = ({ dur, tFcn, tAlfa, tDone }) => {
  const f = useCurrentFrame(); const { fps, width, height } = useVideoConfig();
  const a = spring({ frame: f, fps, config: { damping: 20, stiffness: 120, mass: 0.9 } });
  const b = interpolate(f, [dur * fps - 0.4 * fps, dur * fps], [0, 1], { ...C, easing: io });
  const x = (1 - a) * 0.55 * width + b * 0.55 * width;
  const s1 = spring({ frame: f - Math.round(tFcn * fps), fps, config: { damping: 17, stiffness: 150 } });
  const s2 = spring({ frame: f - Math.round(tAlfa * fps), fps, config: { damping: 17, stiffness: 150 } });
  const ok = interpolate(f - tDone * fps, [0, 0.4 * fps], [0, 1], { ...C, easing: out });
  const card = (s: number, children: React.ReactNode) => (
    <div style={{ background: "#fff", borderRadius: 34, padding: "34px 40px", boxShadow: "0 24px 50px rgba(0,0,0,0.10)", opacity: s, transform: `translateY(${(1 - s) * 30}px)` }}>{children}</div>
  );
  return (
    <div style={{ position: "absolute", top: height * 0.14, right: width * 0.045, width: width * 0.41, transform: `translateX(${x}px)`,
      borderRadius: 48, background: "rgba(250,250,252,0.93)", boxShadow: "0 40px 90px rgba(0,0,0,0.35)", padding: "52px 56px", boxSizing: "border-box" }}>
      <div style={{ fontFamily: "Inter", fontWeight: 600, fontSize: 30, letterSpacing: "0.16em", color: A.gray, textTransform: "uppercase" }}>С чего начать</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 34 }}>
        {card(s1, <>
          <div style={{ fontFamily: "Inter", fontWeight: 800, fontSize: 52, color: A.ink, letterSpacing: "-0.02em" }}>FinCPA Network</div>
          <div style={{ fontFamily: "Inter", fontWeight: 500, fontSize: 30, color: A.gray, marginTop: 6 }}>партнёрская программа · FCN</div>
        </>)}
        <svg width="60" height="60" viewBox="0 0 60 60" style={{ alignSelf: "center", opacity: s2 }}><path d="M30 6 V50 M14 36 L30 52 L46 36" stroke={A.gray} strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {card(s2, <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div style={{ width: 96, height: 96, borderRadius: 26, background: "#EF3124", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 96px" }}>
            <div style={{ fontFamily: "Inter", fontWeight: 800, fontSize: 62, color: "#fff", lineHeight: 1 }}>А</div>
          </div>
          <div>
            <div style={{ fontFamily: "Inter", fontWeight: 800, fontSize: 44, color: A.ink }}>Альфа · ИП на НПД</div>
            <div style={{ fontFamily: "Inter", fontWeight: 500, fontSize: 28, color: A.gray, marginTop: 4 }}>оффер «Регистрация бизнеса»</div>
          </div>
        </div>)}
        <div style={{ alignSelf: "flex-start", marginTop: 10, fontFamily: "Inter", fontWeight: 700, fontSize: 30, color: "#fff", background: A.ink, padding: "14px 26px", borderRadius: 999,
          opacity: ok, transform: `scale(${0.9 + 0.1 * ok})` }}>Бесплатно · за несколько шагов</div>
      </div>
    </div>
  );
};

/** Финальная плашка поверх затемнённого кадра. */
export const EndCard: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const a = interpolate(f, [0, 0.5 * fps], [0, 1], { ...C, easing: out });
  const b = interpolate(f - 0.35 * fps, [0, 0.5 * fps], [0, 1], { ...C, easing: out });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", background: `rgba(0,0,0,${0.55 * a})` }}>
      <div style={{ fontFamily: "Inter", fontWeight: 800, fontSize: 120, letterSpacing: "-0.02em", color: "#FFF0C8", opacity: a, transform: `translateY(${(1 - a) * 20}px)`,
        textShadow: "0 0 30px rgba(255,190,80,0.6), 0 0 80px rgba(255,170,40,0.35)" }}>ПРОДОЛЖЕНИЕ СЛЕДУЕТ</div>
      <div style={{ fontFamily: "Inter", fontWeight: 600, fontSize: 40, color: "#F5F0E6", marginTop: 24, opacity: b, letterSpacing: "0.06em" }}>подпишись, чтобы не пропустить следующий шаг</div>
    </AbsoluteFill>
  );
};
