// «14 000 ₽ каждый день» — горизонтальный ролик 16:9 из 4K-исходника (projects/v14k).
// Слои: видео с камерой → текст за человеком → человек → субтитры/панели/сцены → зерно. Переходы не трогают текст.
import React from "react";
import { AbsoluteFill, Freeze, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import face from "../data/v14k.face.json";
import { CamCfg, camAt, camStyle } from "./camera";
import { TW } from "./words";
import { T, wt, ev, behindWins, FPS, END, TOTAL } from "./cues";
export { FPS, TOTAL };
import { BehindWindow, BigBehind, FootageLayer, SubFront } from "./Layers";
import { EndCard, FlowScene, OfferPanel, StepsPanel } from "./Apple";
import { GlowCaptions, GSeg } from "../premium/Glow";
import { Push } from "../components/Graphics";

// ---------- камера ----------
const PAN = { dx: -0.13, z: 1.28 };
export const cam: CamCfg = {
  clips: T.clips,
  levels: [1.0, 1.14, 1.0, 1.22, 1.08, 1.0, 1.14, 1.04, 1.18, 1.0, 1.12, 1.0, 1.16, 1.06, 1.2, 1.1],
  drift: 0.03,
  keys: [
    { t: 0, z: 0.94 }, { t: 0.9, z: 1.0 }, // вход: лёгкий наезд из вспышки
    { t: wt("зарабатывают", 17.15), z: 1.18, ease: "cut" }, { t: wt("Как", 18.07) - 0.05, z: 1.0, ease: "cut" }, // удар на «не зарабатывают»
    { t: wt("1", 38.73) - 0.06, z: 1.12, ease: "snap" }, { t: T.clips[4].t_out, z: 1.0, ease: "cut" },
    { t: wt("платят", 87.3) - 0.05, z: 1.1, ease: "snap" }, { t: T.clips[9].t_out, z: 1.0, ease: "cut" },
    { t: wt("Именно", 95.5) - 0.05, z: 1.16, ease: "cut" }, { t: T.clips[10].t_out, z: 1.0, ease: "cut" },
    { t: wt("бесплатно", 122.7) - 0.05, z: 1.14, ease: "cut" }, { t: T.clips[12].t_out, z: 1.0, ease: "cut" },
  ],
  pans: [
    { s: ev.steps1[0], e: ev.steps1[1] + 0.3, ...PAN },
    { s: ev.steps2[0], e: ev.steps2[1] + 0.3, ...PAN },
    { s: ev.offer[0], e: ev.offer[1] + 0.3, ...PAN },
  ],
  face: face as number[][],
};

// ---------- субтитры: фразы по 1–3 слова ----------
const KEY = /^\d|^(тысяч|миллион|миллиард|рубл|бесплатн|самозанят|челлендж|ипнанпд)/i;
const hidden = (t: number) => behindWins.some(([a, b]) => t >= a - 0.05 && t < b) || (t >= ev.flow[0] && t < ev.flow[1]);
const panA = (t: number) => cam.pans.reduce((m, p) => Math.max(m, interpolate(t, [p.s, p.s + 0.55, p.e - 0.5, p.e], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })), 0);
const buildCaptions = (): GSeg[] => {
  // склеиваем «какие -либо», «довольно -таки»
  const ws: TW[] = [];
  for (const w of T.words) {
    if (w.w.startsWith("-") && ws.length) { const p = ws[ws.length - 1]; ws[ws.length - 1] = { ...p, w: p.w + w.w, e: w.e }; }
    else if (w.w === "—") continue; else ws.push({ ...w });
  }
  // названия в кавычках — одним куском и без кавычек: «Мой налог» → МОЙ НАЛОГ
  for (let i = 0; i < ws.length; i++) {
    if (ws[i].w.startsWith("«") && !ws[i].w.includes("»")) {
      let j = i; while (j + 1 < ws.length && !ws[j].w.includes("»")) j++;
      ws.splice(i, j - i + 1, { ...ws[i], w: ws.slice(i, j + 1).map((x) => x.w).join(" "), e: ws[j].e });
    }
    ws[i].w = ws[i].w.replace(/[«»]/g, "");
  }
  const segs: GSeg[] = []; let cur: TW[] = [];
  const flush = (end: number) => {
    if (!cur.length) return;
    const s = cur[0].s - 0.04;
    if (!hidden(s)) {
      const text = cur.map((w) => w.w.replace(/[.,!?…:;]+$/, ""));
      const big = cur.some((w) => /^\d/.test(w.w));
      const x = 0.5 + (0.285 - 0.5) * panA(s);
      segs.push({ s, e: Math.max(end, s + 0.3), y: 0.865, x, outline: big, lines: [text.map((t, i) => ({ t, s: cur[i].s, lvl: /^\d/.test(t) ? "big" : "cap" }))] });
    }
    cur = [];
  };
  ws.forEach((w, i) => {
    const prev = ws[i - 1];
    const len = cur.reduce((a, c) => a + c.w.length + 1, 0) + w.w.length;
    const maxLen = panA(w.s) > 0.05 ? 15 : 24; // под панелью — короче, чтобы не упираться в её край
    if (cur.length && (w.s - prev.e > 0.28 || /[.,!?…:;]$/.test(prev.w) || cur.length >= 3 || len > maxLen || (KEY.test(w.w) && cur.length >= 2))) flush(w.s - 0.02);
    cur.push(w);
  });
  flush(T.duration);
  // каждая фраза заканчивается не позже начала следующей
  for (let i = 0; i < segs.length - 1; i++) segs[i].e = Math.min(segs[i].e, segs[i + 1].s);
  // фраза не висит, когда появляется большой текст или сцена (не дублируем)
  const starts = [...behindWins.map((w) => w[0]), ev.flow[0]];
  for (const g of segs) for (const st of starts) if (g.s < st && g.e > st - 0.05) g.e = st - 0.05;
  return segs;
};
const CAPS = buildCaptions();

const Flash: React.FC<{ d?: number }> = ({ d = 0.32 }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const o = interpolate(f, [0, d * fps], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "#fff", opacity: o * o }} />;
};

const Grain: React.FC = () => {
  const f = useCurrentFrame();
  const noise = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;
  return <AbsoluteFill style={{ pointerEvents: "none", backgroundImage: noise, backgroundSize: "240px", backgroundPosition: `${(f * 7) % 240}px ${(f * 13) % 240}px`, opacity: 0.045, mixBlendMode: "overlay" }} />;
};

export const V14k: React.FC = () => {
  const { fps } = useVideoConfig();
  const F = (s: number) => Math.round(s * fps);
  const W = (a: number, b: number) => ({ from: F(a), durationInFrames: Math.max(1, F(b) - F(a)) });
  const person = (i: number) => `media/v14k_person_${i}.mov`;
  const bw = (i: number, el: React.ReactNode, front?: React.ReactNode) => {
    const [a, b] = behindWins[i];
    const w = W(a, b);
    return <BehindWindow key={i} cfg={cam} person={person(i)} from={w.from} dur={w.durationInFrames} front={front}>{el}</BehindWindow>;
  };
  const dur = (i: number) => F(behindWins[i][1]) - F(behindWins[i][0]);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Sequence durationInFrames={F(T.duration)}>
        <FootageLayer cfg={cam} src="media/v14k_cut.mp4" />
      </Sequence>
      {/* финальная плашка: последний кадр стоит */}
      <Sequence from={F(T.duration)}>
        <Freeze frame={F(T.duration) - 1}><FootageLayer cfg={cam} src="media/v14k_cut.mp4" /></Freeze>
        <EndCard />
      </Sequence>

      {/* текст за человеком */}
      {bw(0, <BigBehind text="ЧЕЛЛЕНДЖ" dur={dur(0)} size={230} y={0.34} />)}
      {bw(1, <BigBehind count={{ from: 0, to: 14000, dur: 1.0, suffix: " ₽" }} dur={dur(1)} size={250} y={0.33} />, <SubFront text="каждый день" at={ev.k14sub - ev.k14[0]} dur={dur(1)} />)}
      {bw(2, <BigBehind text="АРБИТРАЖ" dur={dur(2)} size={230} y={0.34} />, <SubFront text="трафика на банки" at={0.45} dur={dur(2)} />)}
      {bw(3, <BigBehind text="4 ГОДА" dur={dur(3)} size={260} y={0.34} />, <SubFront text="в нише" at={0.3} dur={dur(3)} />)}
      {bw(4, <BigBehind count={{ from: 0, to: 1450000, dur: 1.5, suffix: " ₽" }} dur={dur(4)} size={210} y={0.33} />, <SubFront text="каждый месяц" at={ev.m145sub - ev.m145[0]} dur={dur(4)} />)}
      {bw(5, <BigBehind count={{ from: 0, to: 200, dur: 0.9, suffix: " МЛРД ₽" }} dur={dur(5)} size={220} y={0.33} />, <SubFront text="каждый год на клиентов" at={ev.b200sub - ev.b200[0]} dur={dur(5)} />)}
      {bw(6, <BigBehind text="БЕСПЛАТНО" dur={dur(6)} size={230} y={0.34} />)}
      {bw(7, <BigBehind count={{ from: 0, to: 16000, dur: 1.0, suffix: " ₽" }} dur={dur(7)} size={250} y={0.33} />, <SubFront text="первые деньги" at={0.7} dur={dur(7)} />)}

      {/* панели и сцены */}
      <Sequence {...W(ev.steps1[0], ev.steps1[1])}>
        <StepsPanel dur={ev.steps1[1] - ev.steps1[0]} steps={[
          { n: 1, title: "Мой налог", sub: "становишься самозанятым", at: wt("Шаг", 57.19) - ev.steps1[0] },
          { n: 2, title: "Партнёрка", sub: "FCN или Литгид", at: wt("Второй", 62.6) - ev.steps1[0] },
          { n: 3, title: "Реферальная ссылка", sub: "на нужный оффер", at: wt("Третий", 69.82) - ev.steps1[0], chips: [
            { t: "ИП на НПД", at: wt("ИП", 73.1) - ev.steps1[0] },
            { t: "Дебетовая карта", at: wt("дебетовая", 78.64) - ev.steps1[0] },
            { t: "Инвест-счёт", at: wt("инвестиционный", 79.76) - ev.steps1[0] },
          ] },
        ]} />
      </Sequence>
      <Sequence {...W(ev.steps2[0], ev.steps2[1])}>
        <StepsPanel dur={ev.steps2[1] - ev.steps2[0]} done={3} steps={[
          { n: 1, title: "Мой налог", sub: "самозанятый", at: 0 },
          { n: 2, title: "Партнёрка", sub: "FCN или Литгид", at: 0 },
          { n: 3, title: "Реферальная ссылка", sub: "ИП на НПД · карта · счёт", at: 0 },
          { n: 4, title: "Действие", sub: "открываешь себе или другу", at: 0.35 },
        ]} />
      </Sequence>
      <Sequence {...W(ev.offer[0], ev.offer[1])}>
        <OfferPanel dur={ev.offer[1] - ev.offer[0]} tFcn={wt("FinCPA", 128.2) - ev.offer[0]} tAlfa={wt("Альфа", 132.0) - ev.offer[0]} tDone={wt("просто", 135.7) - ev.offer[0]} />
      </Sequence>
      <Sequence {...W(ev.push16 - 0.1, T.duration + 0.2)}>
        <AbsoluteFill style={{ alignItems: "flex-end", padding: "60px 70px" }}><div style={{ transform: "scale(0.82)", transformOrigin: "right top" }}><Push amount="+16 000 ₽" /></div></AbsoluteFill>
      </Sequence>

      {/* субтитры: свой слой, переходы и камера его не трогают */}
      <Sequence durationInFrames={F(T.duration)}>
        <GlowCaptions segs={CAPS} shade={0.4} k={0.62} crisp />
      </Sequence>

      {/* Apple-сцена «Суть ниши» — поверх всего */}
      <Sequence {...W(ev.flow[0], ev.flow[1])}>
        <FlowScene dur={ev.flow[1] - ev.flow[0]} tTitle={0.15}
          tLink={wt("реферальную", 45.94) - ev.flow[0]} tArrow={wt("отправляешь", 48.74) - ev.flow[0]} tClient={wt("клиенту", 49.9) - ev.flow[0]}
          tSelf={wt("сами", 53.62) - ev.flow[0] - 0.2} tFriend={wt("друг", 54.74) - ev.flow[0]} />
      </Sequence>

      {/* вход: вспышка света (без размытия) и смена плана у бассейна */}
      <Sequence durationInFrames={F(0.4)}><Flash d={0.32} /></Sequence>
      <Sequence from={F(T.clips[5].t_in)} durationInFrames={F(0.3)}><Flash d={0.22} /></Sequence>
      <Grain />
    </AbsoluteFill>
  );
};

/** Для звукового микса: события в секундах. */
export const CUES = ev;
