// Стиль эталона (refs/premium_final.md): засечный шрифт, золото, контурное эхо, размытые края кадра, затемнение верха.
import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { TW } from "./text";

const C = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const out = Easing.bezier(0.22, 1, 0.36, 1);
export const GOLD = "#E9D29A";
export const GOLD_HI = "#FFF4D6";
const SERIF = "Playfair Display";

/** Мягкое размытие по краям кадра + затемнение верха (кадр «дорогой», текст сверху читается). */
export const EdgeLook: React.FC<{ top?: (t: number) => number }> = ({ top = () => 0.1 }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const tp = top(f / fps);
  return (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <AbsoluteFill style={{ backdropFilter: "blur(9px)", WebkitMaskImage: "radial-gradient(ellipse 72% 70% at 50% 52%, transparent 58%, #000 100%)",
      maskImage: "radial-gradient(ellipse 72% 70% at 50% 52%, transparent 58%, #000 100%)" }} />
    <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,${tp}) 0%, rgba(0,0,0,${tp * 0.5}) 18%, transparent 34%, transparent 82%, rgba(0,0,0,0.18) 100%)` }} />
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 50%, transparent 62%, rgba(0,0,0,0.22) 100%)" }} />
  </AbsoluteFill>
  );
};

const goldText: React.CSSProperties = {
  color: GOLD, textShadow: "0 0 18px rgba(255,200,110,0.55), 0 0 2px rgba(255,220,160,0.6), 0 2px 10px rgba(0,0,0,0.35)",
};

/** Крупная фраза капсом с контурным эхо. Эхо — увеличенная обводка позади, на входе «расходится» волной. */
export const Headline: React.FC<{ text: string; sub?: string; subAt?: number; dur: number; y?: number; size?: number; thin?: boolean }> = ({
  text, sub, subAt = 0.25, dur, y = 0.13, size = 76, thin,
}) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const D = dur * fps;
  const a = interpolate(f, [0, 0.32 * fps], [0, 1], { ...C, easing: out });
  const b = interpolate(f, [D - 0.22 * fps, D], [0, 1], { ...C, easing: Easing.in(Easing.quad) });
  const pulse = interpolate(f, [0, 0.7 * fps], [0, 1], { ...C, easing: out });
  const sp = interpolate(f - subAt * fps, [0, 0.3 * fps], [0, 1], { ...C, easing: out });
  const font: React.CSSProperties = thin
    ? { fontFamily: "Inter", fontWeight: 200, letterSpacing: "0.01em" }
    : { fontFamily: SERIF, fontWeight: 500, letterSpacing: "0.02em", textTransform: "uppercase" };
  const base: React.CSSProperties = { ...font, fontSize: size, lineHeight: 1, whiteSpace: "nowrap" };
  return (
    <AbsoluteFill style={{ opacity: 1 - b }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: `${y * 100}%`, transform: "translateY(-50%)", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ position: "relative" }}>
          {/* эхо: две обводки, первая расходится от 1.0 до 1.32, вторая стоит */}
          <div aria-hidden style={{ ...base, position: "absolute", inset: 0, color: "transparent", WebkitTextStroke: "1.2px rgba(233,210,154,0.55)",
            transform: `scale(${1 + 0.32 * pulse})`, opacity: a * (0.55 - 0.25 * pulse) }}>{text}</div>
          <div aria-hidden style={{ ...base, position: "absolute", inset: 0, color: "transparent", WebkitTextStroke: "1px rgba(233,210,154,0.35)",
            transform: "scale(1.16)", opacity: a * 0.5 }}>{text}</div>
          <div style={{ ...base, ...goldText, opacity: a, transform: `translateY(${(1 - a) * 10}px) scale(${1.04 - 0.04 * a})` }}>{text}</div>
        </div>
        {sub && (
          <div style={{ fontFamily: SERIF, fontWeight: 500, fontSize: size * 0.4, letterSpacing: "0.06em", textTransform: "uppercase", marginTop: size * 0.22,
            ...goldText, opacity: sp, transform: `translateY(${(1 - sp) * 8}px)` }}>{sub}</div>
        )}
      </div>
    </AbsoluteFill>
  );
};

export type Line = { s: number; e: number; words: TW[] };

/** Мелкие субтитры внизу: засечка, золото, активное слово светлее, фраза входит мягким подъёмом. */
export const Subtitles: React.FC<{ lines: Line[]; y?: number; size?: number }> = ({ lines, y = 0.875, size = 35 }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const t = f / fps;
  const L = lines.find((l) => t >= l.s && t < l.e + 0.12);
  if (!L) return null;
  const a = interpolate(t - L.s, [0, 0.18], [0, 1], { ...C, easing: out });
  const o = interpolate(t - L.e, [0, 0.12], [1, 0], C);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: `${y * 100}%`, transform: `translateY(calc(-50% + ${(1 - a) * 8}px))`, opacity: a * o,
      display: "flex", justifyContent: "center", gap: size * 0.28, fontFamily: SERIF, fontWeight: 400, fontSize: size, lineHeight: 1.2 }}>
      {L.words.map((w, i) => {
        const nx = L.words[i + 1]?.s ?? w.e + 0.2;
        const on = t >= w.s - 0.02 && t < Math.min(w.e + 0.04, nx - 0.02);
        return (
          <span key={i} style={{ color: on ? GOLD_HI : GOLD, textShadow: on ? "0 0 14px rgba(255,230,170,0.8), 0 2px 8px rgba(0,0,0,0.5)" : "0 0 10px rgba(255,200,110,0.35), 0 2px 8px rgba(0,0,0,0.5)" }}>{w.w}</span>
        );
      })}
    </div>
  );
};

/** Фразы для субтитров: до 6 слов / 38 знаков, разрыв на точке, запятой, паузе. */
export const buildLines = (ws: TW[], hide: (t: number) => boolean): Line[] => {
  const lines: Line[] = []; let cur: TW[] = [];
  const flush = () => { if (cur.length && !hide(cur[0].s)) lines.push({ s: cur[0].s - 0.05, e: cur[cur.length - 1].e, words: cur.map((w) => ({ ...w, w: w.w.replace(/[.!?…:;]+$/, "") })) }); cur = []; };
  ws.forEach((w, i) => {
    const p = ws[i - 1];
    const len = cur.reduce((a, c) => a + c.w.length + 1, 0) + w.w.length;
    if (cur.length && (w.s - p.e > 0.3 || /[.!?…]$/.test(p.w) || (/,$/.test(p.w) && cur.length >= 3) || cur.length >= 6 || len > 38)) flush();
    if (cur.length && hide(w.s) !== hide(cur[0].s)) flush();
    cur.push(w);
  });
  flush();
  for (let i = 0; i < lines.length - 1; i++) lines[i].e = Math.min(lines[i].e + 0.25, lines[i + 1].s - 0.02);
  return lines;
};

/** Список шагов наверху слева: курсив, золото; будущие пункты — мозаика. */
export const StepList: React.FC<{ items: { text: string; at: number }[]; placeholders?: number; dur: number }> = ({ items, placeholders = 3, dur }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const t = f / fps;
  const a = interpolate(f, [0, 0.35 * fps], [0, 1], { ...C, easing: out });
  const b = interpolate(f, [dur * fps - 0.3 * fps, dur * fps], [0, 1], C);
  const rows = Math.max(items.length, placeholders);
  const style: React.CSSProperties = { fontFamily: "Inter", fontStyle: "italic", fontWeight: 300, fontSize: 34, letterSpacing: "0.01em", textTransform: "uppercase", ...goldText };
  return (
    <div style={{ position: "absolute", left: 96, top: 66, opacity: a * (1 - b), display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: rows }).map((_, i) => {
        const it = items[i];
        const shown = it && t >= it.at;
        const p = it ? interpolate(t - it.at, [0, 0.35], [0, 1], { ...C, easing: out }) : 0;
        return (
          <div key={i} style={{ position: "relative", height: 42 }}>
            {/* мозаика-заглушка: блоки разной яркости */}
            <div style={{ position: "absolute", left: 0, top: 4, display: "grid", gridTemplateColumns: "repeat(6, 15px)", gridAutoRows: "15px", opacity: 1 - p }}>
              {Array.from({ length: 12 }).map((__, k) => (
                <div key={k} style={{ background: `rgba(233,210,154,${0.18 + 0.32 * (((i + 1) * 37 + k * 53) % 10) / 10})` }} />
              ))}
            </div>
            {shown && <div style={{ ...style, opacity: p, transform: `translateX(${(1 - p) * -12}px)` }}>{i + 1}. {it.text}</div>}
          </div>
        );
      })}
    </div>
  );
};

/** Белая вспышка (смена блока). */
export const WhiteFlash: React.FC<{ d?: number }> = ({ d = 0.45 }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const o = interpolate(f, [0, 0.06 * fps, d * fps], [0, 0.9, 0], { ...C, easing: out });
  return <AbsoluteFill style={{ background: "#FFFDF7", opacity: o }} />;
};

/** Стеклянная карточка дохода (слева). */
export const IncomeCard: React.FC<{ dur: number }> = ({ dur }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const a = interpolate(f, [0, 0.4 * fps], [0, 1], { ...C, easing: out });
  const b = interpolate(f, [dur * fps - 0.3 * fps, dur * fps], [0, 1], C);
  const arc = interpolate(f, [0.1 * fps, 1.2 * fps], [0, 1], { ...C, easing: out });
  const rows: [string, string, string][] = [
    ["#8B5CF6", "Всего", "1 251 410,00 ₽"], ["#3BB5F0", "В работе", "654 860,00 ₽"], ["#F5B82E", "На холде", "95 450,00 ₽"],
    ["#EF4444", "Отклонено", "282 500,00 ₽"], ["#22C55E", "Перечислено", "218 600,00 ₽"],
  ];
  return (
    <div style={{ position: "absolute", left: 120, top: 295, width: 632, height: 396, borderRadius: 26, overflow: "hidden",
      background: "rgba(255,255,255,0.62)", backdropFilter: "blur(22px) saturate(1.2)", border: "1px solid rgba(255,255,255,0.7)",
      boxShadow: "0 30px 60px rgba(0,0,0,0.18)", opacity: a * (1 - b), transform: `translateY(${(1 - a) * 24}px) scale(${0.97 + 0.03 * a})` }}>
      <svg width="632" height="120" style={{ position: "absolute", top: -10, left: 0 }}>
        {[0, 1, 2, 3].map((i) => <circle key={i} cx={316 + 120} cy={-20} r={100 + i * 16} fill="none" stroke="rgba(139,92,246,0.12)" strokeWidth="9" />)}
        <circle cx={436} cy={-20} r={116} fill="none" stroke="#9F7AEA" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${728 * 0.22 * arc} 999`} transform="rotate(45 436 -20)" />
      </svg>
      <div style={{ position: "absolute", left: 66, right: 66, top: 155, display: "flex", flexDirection: "column", gap: 13 }}>
        {rows.map(([c, k, v], i) => {
          const p = interpolate(f - (0.15 + i * 0.07) * fps, [0, 0.3 * fps], [0, 1], { ...C, easing: out });
          return (
            <div key={k} style={{ display: "flex", alignItems: "center", fontFamily: "Inter", fontSize: 22, color: "#222", opacity: p }}>
              <div style={{ width: 18, height: 18, borderRadius: 9, background: c, marginRight: 34 }} />
              <div style={{ flex: 1, fontWeight: 500 }}>{k}</div><div style={{ fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{v}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Тёмный экран дохода с кольцевой диаграммой (вместо кадра). */
export const IncomeScreen: React.FC<{ dur: number }> = ({ dur }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const a = interpolate(f, [0, 0.45 * fps], [0, 1], { ...C, easing: out });
  const b = interpolate(f, [dur * fps - 0.25 * fps, dur * fps], [0, 1], C);
  const q = interpolate(f, [0.1 * fps, 1.6 * fps], [0, 1], { ...C, easing: out });
  const val = Math.round(1082398 * q).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const segs: [string, number][] = [["#F04268", 0.62], ["#F5C33B", 0.2], ["#4AA8F0", 0.1], ["#9AA0A6", 0.08]];
  let acc = 0; const R = 92, Cc = 2 * Math.PI * R;
  return (
    <AbsoluteFill style={{ background: "#1E1E20", opacity: 1 - b }}>
      <div style={{ position: "absolute", left: "50%", top: "50%", transform: `translate(-50%,-50%) scale(${0.96 + 0.04 * a})`, opacity: a, filter: `blur(${(1 - a) * 6}px)` }}>
        <div style={{ fontFamily: "Inter", fontWeight: 700, fontSize: 46, color: "#F2F2F2", fontVariantNumeric: "tabular-nums" }}>{val} ₽</div>
        <div style={{ fontFamily: "Inter", fontWeight: 500, fontSize: 22, color: "#8E8E93", marginTop: 4 }}>Доходы</div>
        <svg width="320" height="260" style={{ display: "block", margin: "18px 0 0 100px" }} viewBox="0 0 320 260">
          {segs.map(([c, v], i) => {
            const len = Cc * v * q; const el = <circle key={i} cx="160" cy="130" r={R} fill="none" stroke={c} strokeWidth="34" strokeDasharray={`${len} ${Cc}`} strokeDashoffset={-acc} transform="rotate(-90 160 130)" />;
            acc += Cc * v * q; return el;
          })}
        </svg>
      </div>
    </AbsoluteFill>
  );
};
