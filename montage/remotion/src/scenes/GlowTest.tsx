// Тест движка Glow на рилсе DfMoc84BwtO: 0:00–0:06 (балкон) и 0:29–0:53 (графический блок).
// Звук и таймкоды слов — оригинальные (Whisper), позиции текста сняты с раскадровки.
import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowCaptions, GSeg, words } from "../premium/Glow";
import { FxScene } from "../premium/Transitions";
import { GlassSteps, LeafBG } from "../premium/GlassSteps";
import { BankCarousel } from "../premium/BankCarousel";
import { Grain } from "../components/Layers";
import { theme } from "../theme";

const Balcony: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const s = interpolate(frame, [0, durationInFrames], [1.0, 1.07], { easing: theme.ease.inOut });
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Img src={staticFile("media/balcony.jpg")} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${s})`,
        filter: "saturate(0.92) contrast(1.04)" }} />
    </AbsoluteFill>
  );
};

// 0:00–0:06 — слова и позиции как в оригинале
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

const A = 6.0; // длительность сцены A, сек
const B0 = 28.9; // начало сцены B в оригинале, сек
const b = (t: number) => +(t - B0).toFixed(2); // время оригинала → локальное время сцены B

export const GlowTest: React.FC = () => {
  const { fps } = useVideoConfig();
  const sec = (s: number) => Math.round(s * fps);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Sequence durationInFrames={sec(A)}>
        <FxScene flashIn={0.35} zoomOutBW={0.45}>
          <Balcony />
          <GlowCaptions segs={segA} shade={0.22} />
        </FxScene>
        <Audio src={staticFile("media/voiceA.wav")} endAt={sec(A)} />
      </Sequence>

      <Sequence from={sec(A)} durationInFrames={sec(24.1)}>
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
        <Audio src={staticFile("media/voiceB.wav")} endAt={sec(24.1)} />
      </Sequence>
      <Grain />
    </AbsoluteFill>
  );
};
