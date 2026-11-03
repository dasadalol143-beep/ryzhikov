// Отрывок 1:09,4–1:30 «14 000 ₽» с моушен-дизайном. Внутри — время таймлайна полного ролика (Sequence сдвинут).
import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { V14kRef, cam } from "../v3/V14kRef";
import { BehindWindow } from "../v2/Layers";
import { BanksScene, PayFront, WhyBehind, YouBehind, YouLinks } from "./Motion";
import { wt } from "../v3/cues";
import { CardsLayer } from "../v5/CardsLayer";
import { stampShake } from "../v5/Cards3D";
import { useCurrentFrame } from "remotion";

export const S0 = 69.4, S1 = 90.0;
export const DEMO_FPS = 24000 / 1001;
export const DEMO_TOTAL = Math.round((S1 - S0) * DEMO_FPS);
export const DEMO_EV = {
  debit: wt("дебетовая", 70.17) - 0.1, invest: wt("инвестиционный", 71.29) - 0.1, ip: wt("ИП", 72.93) - 0.12, cardsOut: wt("заключается", 74.8) - 0.05, hit: wt("НПД.", 73.47) - 0.02,
  why: wt("почему", 77.74) - 0.05, pay: wt("много", 78.54) - 0.05, whyWin: [77.30, 79.33],
  scene: [79.33, 87.13], banks: wt("банки", 80.63) - 0.12, b200: wt("200", 81.97) - 0.06, year: wt("каждый", 83.15) - 0.05,
  attract: wt("привлечение", 84.33) - 0.05, clients: wt("клиентов", 85.45) - 0.5, own: wt("свои", 86.27) - 0.05,
  youWin: [87.00, 90.0], you: wt("ты", 87.6) - 0.05, attract2: wt("привлекать", 88.42) - 0.05,
};

export const CARD_SAMPLES = 6;
export const MotionDemo: React.FC = () => {
  const { fps } = useVideoConfig();
  const fr = useCurrentFrame(); const sh = stampShake(S0 + fr / fps, DEMO_EV.hit);
  const F = (s: number) => Math.round(s * fps);
  const E = DEMO_EV;
  const W = (a: number, b: number) => ({ from: F(a), durationInFrames: F(b) - F(a) });
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `translate(${sh.x}px,${sh.y}px) scale(${sh.s})` }}>
      <Sequence from={-F(S0)}>
        <V14kRef />
        <Sequence {...W(E.debit - 0.05, E.cardsOut + 0.4)}>
          <CardsLayer t0={E.debit - 0.05} ev={{ debit: E.debit, invest: E.invest, ip: E.ip, hit: E.hit, out: E.cardsOut }} samples={CARD_SAMPLES} />
        </Sequence>
        <BehindWindow cfg={cam} person="media/demo_person_q.mov" from={F(E.whyWin[0])} dur={F(E.whyWin[1]) - F(E.whyWin[0])}
          front={<Sequence from={-F(E.whyWin[0])} layout="none"><PayFront tPay={E.pay} dur={E.whyWin[1]} /></Sequence>}>
          <Sequence from={-F(E.whyWin[0])} layout="none"><WhyBehind tWhy={E.why} tPay={E.pay} dur={E.whyWin[1]} /></Sequence>
        </BehindWindow>
        <Sequence {...W(E.scene[0], E.scene[1])}>
          <BanksScene dur={E.scene[1] - E.scene[0]} tBanks={E.banks - E.scene[0]} t200={E.b200 - E.scene[0]} tYear={E.year - E.scene[0]}
            tAttract={E.attract - E.scene[0]} tClients={E.clients - E.scene[0]} tOwn={E.own - E.scene[0]} />
        </Sequence>
        <BehindWindow cfg={cam} person="media/demo_person_ty.mov" from={F(E.youWin[0])} dur={F(E.youWin[1]) - F(E.youWin[0])}
          front={<Sequence from={F(E.you) - F(E.youWin[0])} layout="none"><YouLinks dur={E.youWin[1] - E.you} tAttract={E.attract2 - E.you} cx={0.5} cy={0.6} /></Sequence>}>
          <Sequence from={F(E.you) - F(E.youWin[0])} layout="none"><YouBehind dur={E.youWin[1] - E.you} /></Sequence>
        </BehindWindow>
      </Sequence>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
