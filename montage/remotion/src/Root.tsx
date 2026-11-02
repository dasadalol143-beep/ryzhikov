import React from "react";
import { Composition } from "remotion";
import { loadFonts } from "./components/Fonts";
import { InviteFriendDemo } from "./scenes/InviteFriendDemo";
import { GlowTest } from "./scenes/GlowTest";

loadFonts();

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="InviteFriendDemo" component={InviteFriendDemo} durationInFrames={450} fps={30} width={1080} height={1920} />
    <Composition id="GlowTest" component={GlowTest} durationInFrames={903} fps={30} width={1080} height={1920} />
  </>
);
