// Движок зумов: плавный наезд / пробивка-удар с пружиной и смазом / отъезд. Центр зума держится на лице.
// Кривые сняты с оригинала (face_track.py): наезд ×1.45 за 0,7 с, медленный ×1.2 за 3 с, пробивка ×1.6 на ключевом слове.
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

const C = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export type ZKey = { t: number; z: number; ease?: "snap" | "smooth" };
/** face: [[t, cx, cy, w], ...] — из montage/tools/face_track.py (доли кадра) */
export type FaceData = number[][];

const faceAt = (face: FaceData | undefined, t: number): [number, number] => {
  if (!face || !face.length) return [0.5, 0.4];
  // сглаживание ±0,25 с, чтобы якорь не дрожал
  const win = face.filter((f) => Math.abs(f[0] - t) <= 0.25);
  const src = win.length ? win : [face.reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a))];
  return [src.reduce((s, f) => s + f[1], 0) / src.length, src.reduce((s, f) => s + f[2], 0) / src.length];
};

export const zoomAt = (keys: ZKey[], frame: number, fps: number): number => {
  let z = keys[0].z;
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    const prev = keys[i - 1];
    const d = k.z - prev.z;
    if (k.ease === "snap") {
      // удар: 4–6 кадров с лёгким перелётом
      z += d * spring({ frame: frame - Math.round(k.t * fps), fps, config: { damping: 15, stiffness: 260, mass: 0.6 } });
    } else {
      z += d * interpolate(frame, [Math.round(prev.t * fps), Math.round(k.t * fps)], [0, 1], { ...C, easing: theme.ease.inOut });
    }
  }
  return z;
};

export const ZoomTrack: React.FC<{ keys: ZKey[]; face?: FaceData; children: React.ReactNode }> = ({ keys, face, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const z = zoomAt(keys, frame, fps);
  const dz = Math.abs(z - zoomAt(keys, frame - 1, fps));
  const [cx, cy] = faceAt(face, frame / fps);
  const blur = dz > 0.02 ? Math.min(4, (dz - 0.02) * 120) : 0; // смаз только в момент удара, плавные зумы чистые
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${z})`, transformOrigin: `${cx * 100}% ${cy * 100}%`, filter: blur > 0.3 ? `blur(${blur}px)` : undefined }}>
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
