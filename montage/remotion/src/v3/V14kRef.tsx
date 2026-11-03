// «14 000 ₽ каждый день» в стиле готового монтажа (work/ref_final): 16:9, засечный шрифт, эхо, размытые края.
import React from "react";
import { AbsoluteFill, Easing, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import face from "../data/v14k.face.json";
import { CamCfg } from "../v2/camera";
import { Grain } from "../components/Layers";
import { FootageLayer } from "../v2/Layers";
import { cleanWords } from "./text";
import { buildLines, EdgeLook, Headline, IncomeCard, IncomeScreen, StepList, Subtitles, WhiteFlash } from "./Look";
import { END, ev, FPS, heads, T, TOTAL, wt } from "./cues";
export { FPS, TOTAL };

export const cam: CamCfg = {
  clips: T.clips,
  levels: [1.0, 1.06, 1.0, 1.08, 1.03, 1.0, 1.07, 1.0, 1.05, 1.0, 1.08, 1.02, 1.0, 1.06, 1.0, 1.07, 1.02, 1.0, 1.06, 1.0],
  drift: 0,
  bySeg: true,
  keys: [{ t: ev.notEarn, z: 1.14, ease: "cut" }, { t: wt("Как", 17.15) - 0.04, z: 1.0, ease: "cut" }],
  pans: [],
  face: face as number[][],
};

const hidden = (t: number) => heads.some((h) => t >= h.s - 0.03 && t < h.e) || (t >= ev.screen[0] && t < ev.screen[1]);
// затемнение верха только под верхний текст (замер эталона: 0,6 от середины под списком, ~1,0 без текста)
const topShade = (t: number) => {
  const on = (a: number, b: number) => interpolate(t, [a - 0.12, a, b, b + 0.12], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  let k = on(ev.steps[0], ev.steps[1]);
  for (const h of heads) if (h.y < 0.5) k = Math.max(k, on(h.s, h.e));
  return 0.06 + 0.5 * k;
};
const LINES = buildLines(cleanWords(T.words), hidden);

const Fade: React.FC<{ inDur?: number; outAt: number }> = ({ inDur = 0.001, outAt }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const a = interpolate(f, [0, inDur * fps], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.quad) });
  const b = interpolate(f, [outAt * fps, (outAt + END) * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "#000", opacity: b }} />;
};

export const V14kRef: React.FC<{ footage?: string; footageFrom?: number }> = ({ footage, footageFrom }) => {
  const { fps } = useVideoConfig();
  const F = (s: number) => Math.round(s * fps);
  const W = (a: number, b: number) => ({ from: F(a), durationInFrames: Math.max(1, F(b) - F(a)) });
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {footage ? (
        // отдельный файл (например 4K-кусок), начинающийся с footageFrom секунд таймлайна; камера считается по глобальному кадру
        <Sequence from={F(footageFrom ?? 0)} durationInFrames={F(T.duration + END) - F(footageFrom ?? 0)} layout="none">
          <FootageLayer cfg={cam} src={footage} offset={F(footageFrom ?? 0)} />
        </Sequence>
      ) : (
        <Sequence durationInFrames={F(T.duration + END)}>
          <FootageLayer cfg={cam} src="media/v14k_cut.mp4" />
        </Sequence>
      )}
      <EdgeLook top={topShade} />

      <Sequence {...W(ev.card[0], ev.card[1])}><IncomeCard dur={ev.card[1] - ev.card[0]} /></Sequence>
      <Sequence {...W(ev.steps[0], ev.steps[1])}>
        <StepList dur={ev.steps[1] - ev.steps[0] + 1} items={[
          { text: "Стать самозанятым", at: ev.step1 - ev.steps[0] },
          { text: "Регистрируем партнёрку", at: ev.step2 - ev.steps[0] },
          { text: "Находим ссылку", at: ev.step3 - ev.steps[0] },
          { text: "Делаем целевое действие", at: ev.step4 - ev.steps[0] },
        ]} />
      </Sequence>

      {heads.map((h, i) => (
        <Sequence key={i} {...W(h.s, h.e)}>
          <Headline text={h.text} sub={h.sub} subAt={h.subAt} dur={h.e - h.s} y={h.y} size={h.size ?? 94} thin={h.thin} />
        </Sequence>
      ))}
      <Sequence durationInFrames={F(T.duration)}><Subtitles lines={LINES} /></Sequence>

      <Sequence {...W(ev.screen[0], ev.screen[1])}><IncomeScreen dur={ev.screen[1] - ev.screen[0]} /></Sequence>
      <Sequence {...W(ev.flash, ev.flash + 0.5)}><WhiteFlash /></Sequence>
      <Fade outAt={T.duration} />
      <Grain />
    </AbsoluteFill>
  );
};
