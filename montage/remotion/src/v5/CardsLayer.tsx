// Слой 3D-карточек поверх футажа: прозрачный ThreeCanvas + размытие в движении (несколько под-кадров).
import React from "react";
import { ThreeCanvas } from "@remotion/three";
import { CameraMotionBlur } from "@remotion/motion-blur";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { CardsScene, CardsEv } from "./Cards3D";

const Inner: React.FC<{ ev: CardsEv; t0: number }> = ({ ev, t0 }) => {
  const f = useCurrentFrame(); const { fps, width, height } = useVideoConfig();
  return (
    <ThreeCanvas width={width} height={height} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }} camera={{ fov: 30, position: [0, 0, 12], near: 0.1, far: 100 }}
      style={{ position: "absolute", inset: 0 }}>
      <CardsScene t={t0 + f / fps} ev={ev} />
    </ThreeCanvas>
  );
};

export const CardsLayer: React.FC<{ ev: CardsEv; t0: number; samples?: number }> = ({ ev, t0, samples = 6 }) => (
  <AbsoluteFill>
    {samples > 1 ? <CameraMotionBlur shutterAngle={200} samples={samples}><AbsoluteFill><Inner ev={ev} t0={t0} /></AbsoluteFill></CameraMotionBlur> : <Inner ev={ev} t0={t0} />}
  </AbsoluteFill>
);
