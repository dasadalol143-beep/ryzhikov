// Субтитры по словам (из montage/tools/transcribe.py → words.json), активное слово жёлтым, мат со звёздочками
import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

export type Word = { w: string; s: number; e: number };

const CENSOR: [RegExp, string][] = [
  [/^пиздец/i, "п*здец"], [/^ебашу/i, "еб*шу"], [/^заебись/i, "зае*ись"], [/^пизд/i, "п*зд"],
  [/^хуй/i, "х*й"], [/^бля/i, "бл*"], [/^сука/i, "с*ка"], [/^еба/i, "е*а"],
];
export const censor = (w: string) => {
  for (const [re, rep] of CENSOR)
    if (re.test(w)) {
      const r = rep + w.slice(rep.length);
      return w[0] !== w[0].toLowerCase() ? r[0].toUpperCase() + r.slice(1) : r; // сохраняем заглавную
    }
  return w;
};

export const Captions: React.FC<{ words: Word[]; per?: number; offset?: number }> = ({ words, per = 3, offset = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps + offset;
  // страницы по 2–4 слова, но никогда не через конец фразы
  const pages: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= per || /[.!?…]$/.test(w.w)) { pages.push(cur); cur = []; }
  }
  if (cur.length) pages.push(cur);
  const page = pages.find((p, i) => t >= p[0].s && t < (pages[i + 1]?.[0].s ?? p[p.length - 1].e + 0.3));
  if (!page) return null;
  const pf = Math.round((page[0].s - offset) * fps);
  const p = spring({ frame: frame - pf, fps, config: theme.spring.snappy });
  return (
    <div style={{ position: "absolute", left: 60, right: 60, bottom: theme.safe.bottom, display: "flex", justifyContent: "center", flexWrap: "wrap",
      columnGap: 20, rowGap: 4, fontFamily: theme.fonts.body, fontWeight: 800, fontSize: 64, lineHeight: 1.15,
      opacity: p, transform: `translateY(${interpolate(p, [0, 1], [24, 0])}px)` }}>
      {page.map((w, i) => {
        const active = t >= w.s && t < w.e + 0.05;
        return (
          <span key={i} style={{ color: active ? theme.colors.highlight : theme.colors.text,
            transform: `translateY(${active ? -4 : 0}px)`, display: "inline-block",
            textShadow: "0 4px 0 rgba(0,0,0,0.8), 0 0 18px rgba(0,0,0,0.7)" }}>{censor(w.w)}</span>
        );
      })}
    </div>
  );
};
