// Сцена «банки тратят 200 млрд в год на привлечение клиентов» в настоящем 3D:
// монолиты-банки из чёрного стекла с золотыми гранями вырастают из зеркального пола, камера наезжает,
// золотые монеты падают дождём, потоки света (клиенты) затягиваются в башни, окна загораются.
// Типографика (счётчик, подписи) — HTML поверх канваса, чтобы была идеально резкой.
import React, { useLayoutEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ThreeCanvas } from "@remotion/three";
import { CameraMotionBlur } from "@remotion/motion-blur";
import { AbsoluteFill, continueRender, delayRender, random, useCurrentFrame, useVideoConfig } from "remotion";

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 4);
const easeIO = (x: number) => { const k = clamp(x); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
const spring = (u: number, k = 9, z = 0.5) => (u <= 0 ? 0 : 1 - Math.exp(-z * k * u) * Math.cos(k * Math.sqrt(1 - z * z) * u));

export type BanksEv = { t0: number; dur: number; banks: number; b200: number; year: number; attract: number; clients: number; own: number };

const BANKS = [
  { n: "СБЕР", x: -5.6, z: -3.2, h: 3.9 },
  { n: "ВТБ", x: -2.8, z: -4.6, h: 4.6 },
  { n: "АЛЬФА", x: 0, z: -5.4, h: 5.1 },
  { n: "ОЗОН", x: 2.8, z: -4.6, h: 4.4 },
  { n: "Т-БАНК", x: 5.6, z: -3.2, h: 4.0 },
];
const TW = 1.5, TD = 1.5;

const cv = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")!] as const; };
function windowsTex() {
  const [c, g] = cv(256, 1024); g.fillStyle = "#000"; g.fillRect(0, 0, 256, 1024);
  for (let r = 0; r < 34; r++) for (let k = 0; k < 4; k++) {
    if (random(`w${r}_${k}`) < 0.18) continue;
    g.fillStyle = `rgba(255,${190 + random(`wc${r}${k}`) * 50},${110 + random(`wb${r}${k}`) * 60},${0.55 + random(`wa${r}${k}`) * 0.45})`;
    g.fillRect(26 + k * 56, 40 + r * 28, 36, 14);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function labelTex(name: string) {
  const [c, g] = cv(512, 160); g.clearRect(0, 0, 512, 160);
  const gr = g.createLinearGradient(0, 20, 0, 140); gr.addColorStop(0, "#FFF4D6"); gr.addColorStop(0.6, "#E9C77B"); gr.addColorStop(1, "#A77A2E");
  g.fillStyle = gr; g.font = "600 92px 'Playfair Display'"; g.textAlign = "center"; g.textBaseline = "middle"; (g as any).letterSpacing = "8px";
  g.fillText(name, 256, 84);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function dotTex() {
  const [c, g] = cv(128, 128); const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,220,150,0.8)"); r.addColorStop(1, "rgba(255,170,60,0)"); g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function coinTex() {
  const [c, g] = cv(256, 256); const r = g.createRadialGradient(110, 100, 10, 128, 128, 128);
  r.addColorStop(0, "#fff1c2"); r.addColorStop(0.55, "#d9a948"); r.addColorStop(1, "#8a5f1c"); g.fillStyle = r; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(90,60,15,0.6)"; g.lineWidth = 8; g.beginPath(); g.arc(128, 128, 104, 0, Math.PI * 2); g.stroke();
  g.fillStyle = "rgba(110,70,15,0.75)"; g.font = "800 120px Inter"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("₽", 128, 136);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const Env: React.FC = () => {
  const { gl, scene } = useThree();
  useLayoutEffect(() => {
    const pm = new THREE.PMREMGenerator(gl); const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env; (scene as any).environmentIntensity = 0.55; scene.fog = new THREE.Fog("#05060c", 16, 38);
    return () => { env.dispose(); pm.dispose(); };
  }, [gl, scene]);
  return null;
};

// камера: медленный наезд + лёгкий облёт; на «клиентах» — подъём, на «свои» — толчок вперёд
const Cam: React.FC<{ u: number; ev: BanksEv }> = ({ u, ev }) => {
  const { camera } = useThree();
  const k = u / ev.dur; const own = easeIO((u - (ev.own - ev.t0)) / 0.9);
  const up = easeIO((u - (ev.attract - ev.t0)) / 1.4);
  camera.position.set(Math.sin(k * 1.2 - 0.4) * 2.0, lerp(1.6, 2.8, up) + Math.sin(u * 0.7) * 0.06, lerp(14.5, 11.2, easeIO(k)) - 0.8 * own);
  camera.lookAt(0, 3.5, -4.5);
  (camera as THREE.PerspectiveCamera).fov = 34; (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  return null;
};

type Tex = { win: THREE.Texture; labels: THREE.Texture[]; dot: THREE.Texture; coin: THREE.Texture };

const Tower: React.FC<{ b: typeof BANKS[number]; i: number; u: number; ev: BanksEv; T: Tex; mirror?: boolean }> = ({ b, i, u, ev, T, mirror }) => {
  const s = spring(u - (ev.banks - ev.t0) - i * 0.1, 7.5, 0.55);
  const h = b.h * Math.max(0.001, s);
  const glow = clamp((u - (ev.clients - ev.t0) - 0.5 - i * 0.18) / 0.5) + 0.6 * clamp((u - (ev.own - ev.t0)) / 0.4);
  const sy = mirror ? -1 : 1;
  return (
    <group position={[b.x, 0, b.z]} scale={[1, sy, 1]}>
      <mesh position={[0, h / 2, 0]} scale={[1, h / b.h, 1]}>
        <boxGeometry args={[TW, b.h, TD]} />
        <meshPhysicalMaterial color="#0b0e16" metalness={0.7} roughness={0.16} clearcoat={1} clearcoatRoughness={0.08}
          emissiveMap={T.win} emissive="#ffd08a" emissiveIntensity={0.08 + 1.6 * clamp(glow, 0, 1.4)} transparent={mirror} opacity={mirror ? 0.35 : 1} />
      </mesh>
      {/* золотые рёбра */}
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, c], j) => (
        <mesh key={j} position={[(a * TW) / 2, h / 2, (c * TD) / 2]} scale={[1, h / b.h, 1]}>
          <boxGeometry args={[0.045, b.h, 0.045]} />
          <meshPhysicalMaterial color="#d7ab5a" metalness={1} roughness={0.2} emissive="#7a5418" emissiveIntensity={0.25 + glow * 0.8} transparent={mirror} opacity={mirror ? 0.3 : 1} />
        </mesh>
      ))}
      {/* крыша-шпиль */}
      <mesh position={[0, h + 0.02, 0]}><boxGeometry args={[TW + 0.12, 0.05, TD + 0.12]} /><meshPhysicalMaterial color="#d7ab5a" metalness={1} roughness={0.18} transparent={mirror} opacity={mirror ? 0.3 : 1} /></mesh>
      {/* имя банка на фасаде под крышей */}
      {!mirror && s > 0.02 && (
        <mesh position={[0, h - 0.42, TD / 2 + 0.006]}>
          <planeGeometry args={[TW * 0.92, TW * 0.92 * (160 / 512)]} />
          <meshBasicMaterial map={T.labels[i]} transparent toneMapped={false} />
        </mesh>
      )}
      {/* свет двери у основания */}
      {!mirror && (
        <mesh position={[0, 0.45, TD / 2 + 0.01]}>
          <planeGeometry args={[0.42, 0.9]} />
          <meshBasicMaterial color="#ffd38f" transparent opacity={0.15 + 0.85 * clamp(glow)} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
};

// пыль от подъёма башен у основания
const Dust: React.FC<{ u: number; ev: BanksEv; T: Tex }> = ({ u, ev, T }) => {
  const geo = useMemo(() => new THREE.BufferGeometry(), []);
  const N = 5 * 40; const pos = new Float32Array(N * 3); const col = new Float32Array(N * 3);
  BANKS.forEach((b, i) => {
    const at = ev.banks - ev.t0 + i * 0.1;
    for (let j = 0; j < 40; j++) {
      const q = i * 40 + j; const v = u - at; const life = 1.2;
      const a = random(`da${q}`) * Math.PI * 2, sp = 0.6 + random(`ds${q}`) * 1.6;
      const d = v > 0 ? sp * (1 - Math.exp(-v * 2.5)) : 0;
      pos[q * 3] = b.x + Math.cos(a) * (TW * 0.6 + d); pos[q * 3 + 1] = 0.05 + v * 0.25 * random(`dy${q}`); pos[q * 3 + 2] = b.z + Math.sin(a) * (TD * 0.6 + d);
      const al = v > 0 && v < life ? (1 - v / life) * 0.5 : 0; col[q * 3] = al; col[q * 3 + 1] = al * 0.85; col[q * 3 + 2] = al * 0.65;
    }
  });
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return <points geometry={geo}><pointsMaterial map={T.dot} size={0.35} vertexColors transparent blending={THREE.AdditiveBlending} depthWrite={false} /></points>;
};

// золотые монеты: дождь с вращением, начинается на «200», затухает к «привлечению»
const Coins: React.FC<{ u: number; ev: BanksEv; T: Tex }> = ({ u, ev, T }) => {
  const t0 = ev.b200 - ev.t0; if (u < t0 - 0.1) return null;
  const items = [];
  for (let i = 0; i < 95; i++) {
    const at = t0 + random(`ct${i}`) * 2.6; const v = u - at; if (v < 0) continue;
    const y = 10 - 0.5 * 9.8 * v * v * 0.6; if (y < -0.3) continue;
    const z = 4 - random(`cz${i}`) * 10, x = (random(`cx${i}`) - 0.5) * (12 + (4 - z) * 0.6);
    items.push(
      <mesh key={i} position={[x, y, z]} rotation={[v * (4 + random(`cr${i}`) * 6), v * 3 + i, v * (2 + random(`cq${i}`) * 3)]}>
        <cylinderGeometry args={[0.34, 0.34, 0.055, 40]} />
        <meshPhysicalMaterial attach="material-0" color="#b8862f" metalness={1} roughness={0.25} />
        <meshPhysicalMaterial attach="material-1" map={T.coin} metalness={0.95} roughness={0.22} clearcoat={0.6} />
        <meshPhysicalMaterial attach="material-2" map={T.coin} metalness={0.95} roughness={0.22} clearcoat={0.6} />
      </mesh>,
    );
  }
  return <>{items}</>;
};

// клиенты: тысячи огоньков текут по дугам из-за камеры в двери башен
const Clients: React.FC<{ u: number; ev: BanksEv; T: Tex }> = ({ u, ev, T }) => {
  const geo = useMemo(() => new THREE.BufferGeometry(), []);
  const t0 = ev.clients - ev.t0 - 0.4; const N = 1400;
  const pos = new Float32Array(N * 3); const col = new Float32Array(N * 3);
  for (let q = 0; q < N; q++) {
    const b = BANKS[q % 5]; const at = t0 + random(`pt${q}`) * 2.4; const dur = 1.1 + random(`pd${q}`) * 0.6;
    const k = (u - at) / dur;
    if (k <= 0 || k >= 1) { pos[q * 3 + 1] = -99; continue; }
    const e = easeIO(k);
    const sx = (random(`px${q}`) - 0.5) * 22, sz = 6 + random(`pz${q}`) * 6, sy = 0.2 + random(`py${q}`) * 2.5;
    const tx = b.x + (random(`pw${q}`) - 0.5) * 0.3, ty = 0.4 + random(`ph${q}`) * 0.4, tz = b.z + TD / 2 + 0.05;
    const arc = Math.sin(e * Math.PI) * (1.2 + random(`pa${q}`) * 1.5);
    pos[q * 3] = lerp(sx, tx, e); pos[q * 3 + 1] = lerp(sy, ty, e) + arc; pos[q * 3 + 2] = lerp(sz, tz, e);
    const al = Math.min(1, k * 4) * (k > 0.92 ? (1 - k) / 0.08 : 1);
    col[q * 3] = al; col[q * 3 + 1] = al * 0.86; col[q * 3 + 2] = al * 0.62;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return <points geometry={geo}><pointsMaterial map={T.dot} size={0.34} vertexColors transparent blending={THREE.AdditiveBlending} depthWrite={false} /></points>;
};

const Scene: React.FC<{ u: number; ev: BanksEv; T: Tex }> = ({ u, ev, T }) => (
  <>
    <Env />
    <Cam u={u} ev={ev} />
    <ambientLight intensity={0.15} />
    <directionalLight position={[-6, 9, 8]} intensity={1.6} color="#ffe2b8" />
    <directionalLight position={[8, 4, -10]} intensity={1.2} color="#7fa6ff" />
    <pointLight position={[0, 7, 2]} intensity={30 * clamp((u - (ev.b200 - ev.t0)) / 0.5)} distance={20} color="#ffcf80" />
    {/* пол: тёмное зеркало (отражение = перевёрнутые башни под полупрозрачным полом) */}
    {BANKS.map((b, i) => <Tower key={`m${i}`} b={b} i={i} u={u} ev={ev} T={T} mirror />)}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -6]}>
      <planeGeometry args={[80, 60]} />
      <meshStandardMaterial color="#000000" metalness={0} roughness={0.75} transparent opacity={0.8} envMapIntensity={0.05} />
    </mesh>
    {BANKS.map((b, i) => <Tower key={i} b={b} i={i} u={u} ev={ev} T={T} />)}
    <Dust u={u} ev={ev} T={T} />
    <Coins u={u} ev={ev} T={T} />
    <Clients u={u} ev={ev} T={T} />
  </>
);

const Canvas3D: React.FC<{ ev: BanksEv }> = ({ ev }) => {
  const f = useCurrentFrame(); const { fps, width, height } = useVideoConfig();
  return (
    <ThreeCanvas width={width} height={height} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }} camera={{ fov: 34, position: [0, 1.4, 13.5], near: 0.1, far: 80 }} style={{ position: "absolute", inset: 0 }}>
      <Inner u={f / fps} ev={ev} />
    </ThreeCanvas>
  );
};
const Inner: React.FC<{ u: number; ev: BanksEv }> = ({ u, ev }) => {
  const [T, setT] = useState<Tex | null>(null);
  const [h] = useState(() => delayRender("banks3d textures"));
  const { advance } = useThree(); const done = React.useRef(false);
  useLayoutEffect(() => { document.fonts.ready.then(() => setT({ win: windowsTex(), labels: BANKS.map((b) => labelTex(b.n)), dot: dotTex(), coin: coinTex() })); }, []);
  useLayoutEffect(() => { if (T) { advance(performance.now()); requestAnimationFrame(() => { advance(performance.now()); if (!done.current) { done.current = true; continueRender(h); } }); } }, [T, u]);
  if (!T) return null;
  return <Scene u={u} ev={ev} T={T} />;
};

// ---------- типографика поверх ----------
const fmt = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const Type: React.FC<{ ev: BanksEv }> = ({ ev }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig(); const u = f / fps;
  const tb = ev.banks - ev.t0, t2 = ev.b200 - ev.t0, ty = ev.year - ev.t0, ta = ev.attract - ev.t0;
  // «НА ДАННЫЙ МОМЕНТ»
  const a0 = easeOut((u - 0.04) / 0.22), o0 = easeOut((u - tb + 0.05) / 0.22);
  // счётчик
  const cIn = easeOut((u - t2 + 0.05) / 0.25), q = 1 - Math.pow(1 - clamp((u - t2) / 1.5), 4);
  const cOut = easeOut((u - ta + 0.08) / 0.25);
  const yr = ["2024", "2025", "2026"][Math.min(2, Math.max(0, Math.floor((u - ty) / 0.17)))];
  const yIn = easeOut((u - ty + 0.03) / 0.2);
  const aIn = easeOut((u - ta) / 0.3);
  const gold: React.CSSProperties = { color: "transparent", background: "linear-gradient(180deg,#FFF6DD 0%,#EBC676 55%,#A97B2F 100%)", WebkitBackgroundClip: "text", backgroundClip: "text" };
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {u < tb + 0.3 && (
        <div style={{ position: "absolute", top: 300 - o0 * 90, width: "100%", textAlign: "center", opacity: a0 * (1 - o0), filter: `blur(${(1 - a0) * 12 + o0 * 10}px)`,
          fontFamily: "Playfair Display", fontSize: 96, letterSpacing: lerp(40, 16, a0), ...gold, textShadow: "none" }}>НА ДАННЫЙ МОМЕНТ</div>
      )}
      {u > t2 - 0.1 && cOut < 1 && (
        <div style={{ position: "absolute", top: 70 - cOut * 60, width: "100%", textAlign: "center", opacity: cIn * (1 - cOut), filter: `blur(${(1 - cIn) * 14 + cOut * 12}px)`, transform: `scale(${0.92 + 0.08 * cIn})` }}>
          <div style={{ fontFamily: "Playfair Display", fontWeight: 600, fontSize: 168, lineHeight: 1, ...gold, filter: "drop-shadow(0 0 30px rgba(233,199,123,0.35))", fontVariantNumeric: "tabular-nums" }}>{fmt(2e11 * q)} ₽</div>
          <div style={{ marginTop: 22, fontFamily: "Inter", fontWeight: 500, fontSize: 30, letterSpacing: 14, color: "rgba(255,255,255,0.72)" }}>
            БАНКИ ТРАТЯТ{u > ty - 0.03 && <span style={{ opacity: yIn, marginLeft: 26, color: "#EBC676" }}>· КАЖДЫЙ ГОД · {yr}</span>}
          </div>
        </div>
      )}
      {u > ta - 0.05 && (
        <div style={{ position: "absolute", top: 110 + (1 - aIn) * 40, width: "100%", textAlign: "center", opacity: aIn, filter: `blur(${(1 - aIn) * 12}px)`,
          fontFamily: "Playfair Display", fontSize: 92, letterSpacing: 10, ...gold }}>НА ПРИВЛЕЧЕНИЕ КЛИЕНТОВ</div>
      )}
    </AbsoluteFill>
  );
};

export const Banks3D: React.FC<{ ev: BanksEv; samples?: number }> = ({ ev, samples = 5 }) => (
  <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 30%, #1d2540 0%, #0c1020 55%, #05060c 100%)", overflow: "hidden" }}>
    {/* световые лучи сверху */}
    <AbsoluteFill style={{ background: "conic-gradient(from 180deg at 50% -10%, transparent 0deg, rgba(255,214,150,0.06) 8deg, transparent 16deg, rgba(255,214,150,0.05) 26deg, transparent 34deg, rgba(255,214,150,0.07) 344deg, transparent 352deg)" }} />
    {samples > 1 ? <CameraMotionBlur shutterAngle={180} samples={samples}><AbsoluteFill><Canvas3D ev={ev} /></AbsoluteFill></CameraMotionBlur> : <Canvas3D ev={ev} />}
    <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(4,5,10,0.75) 0%, rgba(4,5,10,0.35) 26%, transparent 40%)" }} />
    <Type ev={ev} />
    {/* виньетка */}
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />
  </AbsoluteFill>
);
