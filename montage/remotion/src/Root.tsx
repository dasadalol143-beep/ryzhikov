import React from "react";
import { Composition } from "remotion";
import { loadFonts } from "./components/Fonts";
import { InviteFriendDemo } from "./scenes/InviteFriendDemo";
import { GlowTest } from "./scenes/GlowTest";
import { MotionDemo, DEMO_TOTAL, DEMO_FPS, CardsOnly, CARDS_LEN } from "./v4/MotionDemo";
import { V14kRef, TOTAL as R_TOTAL, FPS as R_FPS } from "./v3/V14kRef";
import { V14k, TOTAL as V14K_TOTAL, FPS as V14K_FPS } from "./v2/V14k";
import { CardsTest } from "./v5/CardsTest";
import { GlTest } from "./v5/GlTest";

loadFonts();

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="CardsTest" component={CardsTest} durationInFrames={110} fps={24000/1001} width={1920} height={1080} />
    <Composition id="GlTest" component={GlTest} durationInFrames={30} fps={30} width={640} height={360} />
    <Composition id="InviteFriendDemo" component={InviteFriendDemo} durationInFrames={450} fps={30} width={1080} height={1920} />
    <Composition id="GlowTest" component={GlowTest} durationInFrames={1073} fps={30} width={1080} height={1920} />
    <Composition id="V14k" component={V14k} durationInFrames={V14K_TOTAL} fps={V14K_FPS} width={1920} height={1080} />
    <Composition id="V14kRef" component={V14kRef} durationInFrames={R_TOTAL} fps={R_FPS} width={1920} height={1080} />
    <Composition id="MotionDemo" component={MotionDemo} durationInFrames={DEMO_TOTAL} fps={DEMO_FPS} width={1920} height={1080} />
    <Composition id="CardsOnly" component={CardsOnly} durationInFrames={CARDS_LEN} fps={DEMO_FPS} width={1920} height={1080} />
    <Composition id="MotionCards" component={MotionDemo} durationInFrames={130} fps={DEMO_FPS} width={1920} height={1080} />
  </>
);
