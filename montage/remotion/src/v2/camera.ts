// Камера v2: одна чистая функция → одинаковое преобразование для видео и для вырезанного человека (слои совпадают кадр в кадр).
// Зум: уровень клипа (джамп-каты меняют крупность) × ключи (плавные наезды/удары). Якорь: лицо. Края кадра никогда не видны.
import { Easing, interpolate, spring } from "remotion";

export type Clip = { t_in: number; t_out: number; seg: number };
export type ZKey = { t: number; z: number; ease?: "smooth" | "cut" | "snap" };
export type Pan = { s: number; e: number; dx: number; z: number }; // окно сдвига кадра (под боковую панель)
export type Face = number[][]; // [t, cx, cy, w] в долях кадра таймлайна

const C = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const io = Easing.bezier(0.65, 0, 0.35, 1);

export type CamCfg = { clips: Clip[]; levels: number[]; keys: ZKey[]; pans: Pan[]; face: Face; drift?: number; bySeg?: boolean };

const faceAt = (face: Face, t: number): [number, number] => {
  // окно ±0,4 с, медиана по x/y — якорь не дрожит на жестах
  const win = face.filter((f) => Math.abs(f[0] - t) <= 0.4);
  if (!win.length) return [0.5, 0.42];
  const xs = win.map((f) => f[1]).sort((a, b) => a - b), ys = win.map((f) => f[2]).sort((a, b) => a - b);
  return [xs[xs.length >> 1], ys[ys.length >> 1]];
};

const keyFactor = (keys: ZKey[], f: number, fps: number) => {
  let z = 1;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i], prevZ = i ? keys[i - 1].z : 1, prevT = i ? keys[i - 1].t : 0, d = k.z - prevZ;
    if (k.ease === "cut") { if (f >= Math.round(k.t * fps)) z += d; }
    else if (k.ease === "snap") z += d * spring({ frame: f - Math.round(k.t * fps), fps, config: { damping: 18, stiffness: 200, mass: 0.7 } });
    else {
      const a0 = Math.round(prevT * fps), a1 = Math.round(k.t * fps);
      z += a1 > a0 ? d * interpolate(f, [a0, a1], [0, 1], { ...C, easing: io }) : f >= a1 ? d : 0; // совпадающие кадры — ключ сразу
    }
  }
  return z;
};

/** Преобразование кадра: translate(tx, ty) scale(z) вокруг центра. */
export const camAt = (cfg: CamCfg, frame: number, fps: number, W: number, H: number) => {
  const t = frame / fps;
  const ci = Math.max(0, cfg.clips.findIndex((c) => t >= c.t_in && t < c.t_out));
  const clip = cfg.clips[ci] ?? cfg.clips[cfg.clips.length - 1];
  const level = cfg.bySeg ? cfg.levels[clip.seg % cfg.levels.length] : cfg.levels[ci % cfg.levels.length]; // bySeg: крупность меняется только на смене мысли
  const drift = 1 + (cfg.drift ?? 0.025) * Math.min(1, (t - clip.t_in) / Math.max(1, clip.t_out - clip.t_in)); // медленный наезд внутри клипа
  let z = level * drift * keyFactor(cfg.keys, frame, fps);
  // панели: плавный сдвиг кадра и минимальный зум, чтобы не открыть край
  let dx = 0, zmin = 1;
  for (const p of cfg.pans) {
    const a = interpolate(t, [p.s, p.s + 0.55, p.e - 0.5, p.e], [0, 1, 1, 0], { ...C, easing: io });
    dx += p.dx * a; zmin = Math.max(zmin, 1 + (p.z - 1) * a);
  }
  z = Math.max(z, zmin);
  const [fx, fy] = faceAt(cfg.face, t);
  // лицо остаётся там же, где было на общем плане (+ сдвиг панели): t = g − C − (f − C)·z
  const gx = fx * W + dx * W, gy = fy * H;
  let tx = gx - W / 2 - (fx * W - W / 2) * z;
  let ty = gy - H / 2 - (fy * H - H / 2) * z;
  const mx = ((z - 1) * W) / 2, my = ((z - 1) * H) / 2; // края кадра не открываем
  tx = Math.max(-mx, Math.min(mx, tx)); ty = Math.max(-my, Math.min(my, ty));
  return { z, tx, ty, clip: ci };
};

export const camStyle = (c: { z: number; tx: number; ty: number }): React.CSSProperties => ({
  transform: `translate(${c.tx.toFixed(2)}px, ${c.ty.toFixed(2)}px) scale(${c.z.toFixed(5)})`, transformOrigin: "50% 50%",
});
