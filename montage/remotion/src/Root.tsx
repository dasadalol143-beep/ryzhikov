import React from "react";
import { Composition } from "remotion";
import { loadFonts } from "./components/Fonts";
import { InviteFriendDemo } from "./scenes/InviteFriendDemo";
import { GlowTest } from "./scenes/GlowTest";
import { V14k, TOTAL as V14K_TOTAL, FPS as V14K_FPS } from "./v2/V14k";

loadFonts();

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="InviteFriendDemo" component={InviteFriendDemo} durationInFrames={450} fps={30} width={1080} height={1920} />
    <Composition id="GlowTest" component={GlowTest} durationInFrames={1073} fps={30} width={1080} height={1920} />
    <Composition id="V14k" component={V14k} durationInFrames={V14K_TOTAL} fps={V14K_FPS} width={1920} height={1080} />
  </>
);
