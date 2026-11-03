import React from "react";
import { ThreeCanvas } from "@remotion/three";
import { useCurrentFrame } from "remotion";
export const GlTest: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <ThreeCanvas width={640} height={360} camera={{ position: [0, 0, 5] }}>
      <ambientLight intensity={0.5} /><directionalLight position={[3, 3, 3]} />
      <mesh rotation={[f * 0.05, f * 0.07, 0]}><boxGeometry args={[2, 1.2, 0.1]} /><meshStandardMaterial color="#d4af37" metalness={0.8} roughness={0.3} /></mesh>
    </ThreeCanvas>
  );
};
