// Тест движка на рилсе DfMoc84BwtO. Подложки — живое видео оригинала с вытертым текстом (tools/clean_plate.py).
//   A  0:00–0:06    балкон: зумы уже вшиты в оригинал (монтажёр), здесь проверяем только текст.
//   C  0:10.75–0:16.4 у бассейна: в оригинале камера стоит ровно — ЗУМЫ ДОБАВЛЯЕТ НАШ ДВИЖОК.
//   B  0:28.9–0:53  графический блок.
import React from "react";
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, staticFile, useVideoConfig } from "remotion";
import { GlowCaptions, GSeg, words } from "../premium/Glow";
import { FxScene } from "../premium/Transitions";
import { GlassSteps, LeafBG } from "../premium/GlassSteps";
import { BankCarousel } from "../premium/BankCarousel";
import { ZoomTrack, ZKey } from "../premium/ZoomTrack";
import { Grain } from "../components/Layers";
import faceC from "../data/plateC.face.json";

const Plate: React.FC<{ src: string }> = ({ src }) => (
  <AbsoluteFill>
    <OffthreadVideo src={staticFile(src)} muted style={{ width: "100%", height: "100%", objectFit: "cover", filter: "saturate(0.95) contrast(1.04)" }} />
  </AbsoluteFill>
);

const segA: GSeg[] = [
  { s: 0.0, e: 0.92, y: 0.755, lines: [words([["В", 0.0], ["18", 0.16], ["ЛЕТ", 0.48]])] },
  { s: 0.92, e: 1.44, y: 0.76, lines: [words([["Я", 0.92], ["ВЗЯЛ", 1.14]])] },
  { s: 1.44, e: 2.36, y: 0.775, lines: [words([["КРЕДИТНУЮ", 1.44]]), words([["КАРТУ", 2.02]])], dx: [-0.04, 0.17], gap: -14 },
  { s: 2.36, e: 2.5, y: 0.77, lines: [words([["НА", 2.36]])] },
  { s: 2.5, e: 3.64, y: 0.77, outline: true, lines: [words([["90 000₽", 2.5, "big"]])] },
  { s: 3.64, e: 4.24, y: 0.76, lines: [words([["И", 3.64], ["ПРОИГРАЛ", 3.82]])] },
  { s: 4.24, e: 5.75, y: 0.765, x: 0.13, align: "left", gap: -6,
    lines: [words([["ВСЕ", 4.24]]), words([["ЭТИ", 4.5]]), words([["ДЕНЬГИ", 4.72]]), words([["НА", 5.02], ["СТАВКАХ", 5.22]])] },
];

// C: слова по таймкодам оригинала (локальное время сцены)
const segC: GSeg[] = [
  { s: 0.0, e: 1.89, y: 0.77, outline: true, lines: [words([["1 000₽", 0.0, "big"]]), words([["за 1 смену", 0.51, "small"]])], gap: -4 },
  { s: 1.89, e: 2.37, y: 0.77, lines: [words([["ПО", 1.89], ["СУТИ", 2.03]])] },
  { s: 2.37, e: 3.05, y: 0.77, lines: [words([["НУЖНО", 2.37]]), words([["отработать", 2.51, "small"]])] },
  { s: 3.05, e: 4.01, y: 0.77, outline: true, lines: [words([["90", 3.05, "big"], ["СМЕН", 3.43, "big"]])] },
  { s: 4.01, e: 4.25, y: 0.77, lines: [words([["ЧТОБЫ", 4.01]])] },
  { s: 4.25, e: 4.69, y: 0.77, lines: [words([["ПРОСТО", 4.25]])] },
  { s: 4.69, e: 5.21, y: 0.77, lines: [words([["ЗАКРЫТЬ", 4.69]])] },
  { s: 5.21, e: 5.9, y: 0.77, outline: true, lines: [words([["ДОЛГ", 5.21, "big"]])] },
];
// Зумы C: медленный наезд → удар на «90» → отпускаем → сильный удар на «ДОЛГ»
const zoomC: ZKey[] = [
  { t: 0, z: 1.0 },
  { t: 2.9, z: 1.12 },
  { t: 3.05, z: 1.42, ease: "snap" },
  { t: 3.9, z: 1.42 },
  { t: 4.45, z: 1.18 },
  { t: 5.21, z: 1.72, ease: "snap" },
  { t: 5.65, z: 1.78 },
];

const A = 6.0, CC = 5.65, BB = 24.1;
const B0 = 28.9;
const b = (t: number) => +(t - B0).toFixed(2);

export const GlowTest: React.FC = () => {
  const { fps } = useVideoConfig();
  const sec = (s: number) => Math.round(s * fps);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Sequence durationInFrames={sec(A)}>
        <FxScene flashIn={0.35} blurOut={0.25}>
          <Plate src="media/plateA.mp4" />
          <GlowCaptions segs={segA} shade={0.22} />
        </FxScene>
        <Audio src={staticFile("media/voiceA.wav")} endAt={sec(A)} />
      </Sequence>

      <Sequence from={sec(A)} durationInFrames={sec(CC)}>
        <FxScene blurIn={0.3} blurOut={0.14}>
          <ZoomTrack keys={zoomC} face={faceC}>
            <Plate src="media/plateC.mp4" />
          </ZoomTrack>
          <GlowCaptions segs={segC} shade={0.35} />
        </FxScene>
        <Audio src={staticFile("media/voiceC.wav")} />
      </Sequence>

      <Sequence from={sec(A + CC)} durationInFrames={sec(BB)}>
        <FxScene blurIn={0.35} flashOut={0.35}>
          <LeafBG />
          <GlassSteps
            q={{ small: "что для этого", big: "НУЖНО?", s1: b(29.94), s2: b(30.72) }}
            steps={[
              { n: 1, label: "СТАТЬ САМОЗАНЯТЫМ", at: b(31.26) },
              { n: 2, label: "ЗАРЕГАТЬ ПАРТНЕРКУ", at: b(33.62) },
              { n: 3, label: "СКОПИРОВАТЬ ССЫЛКУ", at: b(36.22) },
              { n: 4, label: "СКИНУТЬ ЕЁ ДРУГУ", at: b(37.86) },
              { n: 5, label: "ПОЛУЧИТЬ ДЕНЬГИ", at: b(43.9) },
            ]}
            exitAt={b(48.0)}
          />
          <Sequence from={sec(b(48.1))}>
            <BankCarousel to={130000} from={0} countStart={0.15} countEnd={3.9} />
          </Sequence>
        </FxScene>
        <Audio src={staticFile("media/voiceB.wav")} endAt={sec(BB)} />
      </Sequence>
      <Grain />
    </AbsoluteFill>
  );
};
