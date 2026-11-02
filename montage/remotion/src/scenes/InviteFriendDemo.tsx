// Демо без лица: «Пригласи друга» → ДО 130 000 ₽ → ПИШИ «РКО». Шаблон для рилсов под голос за кадром.
import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { Scene } from "../components/Layers";
import { BigText, CTA, Entrance, Flow, MoneyCounter, Plate, Push } from "../components/Graphics";
import { Captions, Word } from "../components/Captions";
import { theme } from "../theme";

const Center: React.FC<{ children: React.ReactNode; gap?: number }> = ({ children, gap = 60 }) => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap, paddingTop: theme.safe.top - 120, paddingBottom: theme.safe.bottom - 120 }}>
    {children}
  </AbsoluteFill>
);

const Sfx: React.FC<{ at: number; name: string; volume?: number }> = ({ at, name, volume = 0.8 }) => {
  const { fps } = useVideoConfig();
  return (
    <Sequence from={Math.max(0, Math.round(at * fps) - 2)} layout="none">
      <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
    </Sequence>
  );
};

// Таймкоды слов — в реальном ролике их даёт montage/tools/transcribe.py
const demoWords: Word[] = [
  ["Банк", 0.1], ["даёт", 0.4], ["тысячу", 0.7], ["за", 1.1], ["друга.", 1.3],
  ["Но", 2.6], ["другом", 2.8], ["можешь", 3.2], ["быть", 3.5], ["ты", 3.8], ["сам.", 4.0],
  ["Мой", 5.1], ["налог,", 5.4], ["партнёрка,", 5.9], ["ИП", 6.5], ["в", 6.8], ["Альфе", 6.9], ["плюс", 7.6], ["четырнадцать", 7.9], ["тысяч.", 8.3],
  ["А", 8.7], ["дальше", 8.9], ["ВТБ,", 9.3], ["Озон,", 9.8], ["и", 10.3], ["до", 10.5], ["ста", 10.7], ["тридцати.", 10.9],
  ["Пиши", 11.8], ["РКО", 12.2], ["в", 12.6], ["комментарии.", 12.8],
].map(([w, s], i, a) => ({ w: w as string, s: s as number, e: i + 1 < a.length ? (a[i + 1][1] as number) - 0.02 : (s as number) + 0.6 }));

export const InviteFriendDemo: React.FC = () => {
  const { fps } = useVideoConfig();
  const sec = (s: number) => Math.round(s * fps);
  return (
    <AbsoluteFill style={{ background: theme.colors.bg }}>
      {/* 1. ХУК: движение с первого кадра */}
      <Sequence durationInFrames={sec(2.5)}>
        <Scene mood="cold">
          <Center>
            <Plate text="ПРИГЛАСИ ДРУГА" bg="dark" size={74} />
            <MoneyCounter steps={[0, 1000]} delay={6} perStep={12} color="text" prefix="+" size={170} glow={false} />
          </Center>
        </Scene>
      </Sequence>
      {/* 2. Разрыв шаблона */}
      <Sequence from={sec(2.5)} durationInFrames={sec(2.5)}>
        <Scene mood="neutral">
          <Center>
            <BigText text="ДРУГ = ТЫ САМ" accent="САМ" size={128} delay={2} />
          </Center>
        </Scene>
      </Sequence>
      {/* 3. Маршрут + пуш */}
      <Sequence from={sec(5)} durationInFrames={sec(3.6)}>
        <Scene mood="neutral">
          <AbsoluteFill style={{ alignItems: "center", paddingTop: theme.safe.top }}>
            <Push amount="+14 000 ₽" delay={sec(2.4)} />
          </AbsoluteFill>
          <Center gap={0}>
            <div style={{ marginTop: 120, marginBottom: 120 }}>
              <Flow items={["МОЙ НАЛОГ", "FCN", "ИП В АЛЬФЕ", "+14 000 ₽"]} delay={2} per={sec(0.6)} size={58} />
            </div>
          </Center>
        </Scene>
      </Sequence>
      {/* 4. Пейофф: счётчик рывками по банкам, тепло */}
      <Sequence from={sec(8.6)} durationInFrames={sec(3.1)}>
        <Scene mood="warm">
          <Center gap={50}>
            <Entrance delay={0}><Plate text="ВТБ · ОЗОН · ДАЛЬШЕ" bg="dark" size={60} /></Entrance>
            <MoneyCounter steps={[14000, 21000, 29000, 130000]} delay={sec(0.3)} perStep={sec(0.4)} prefix="ДО " size={124} />
          </Center>
        </Scene>
      </Sequence>
      {/* 5. CTA */}
      <Sequence from={sec(11.7)} durationInFrames={sec(3.3)}>
        <Scene mood="warm">
          <Center>
            <CTA delay={2} />
          </Center>
        </Scene>
      </Sequence>

      <Captions words={demoWords} />

      {/* Звук: SFX за 2 кадра до визуала */}
      <Sfx at={0} name="notification" />
      <Sfx at={0.2} name="tick" volume={0.5} />
      <Sfx at={2.5} name="whoosh" />
      <Sfx at={2.6} name="impact" volume={0.6} />
      {[0, 0.6, 1.2, 1.8].map((d) => <Sfx key={d} at={5.07 + d} name="click" volume={0.7} />)}
      <Sfx at={7.4} name="cash_push" />
      <Sfx at={8.6} name="whoosh" volume={0.6} />
      {[0, 0.4, 0.8].map((d) => <Sfx key={d} at={8.9 + d} name="tick" volume={0.6} />)}
      <Sfx at={10.1} name="bass_drop" />
      <Sfx at={11.7} name="slap" />
    </AbsoluteFill>
  );
};
