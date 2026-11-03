// Бит «дебетовая карта / инвест-счёт / ИП на НПД» в настоящем 3D (Three.js):
// металл с отражениями окружения, стекло со светящимся графиком, бумага + резиновая печать с ударом,
// искры, анаморфные блики, пролёт света по поверхности, вылет с размытием в движении.
// Время — секунды таймлайна полного ролика (t приходит снаружи).
import React, { useLayoutEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { continueRender, delayRender, random } from "remotion";

const W = 3.0, H = 1.89, R = 0.16, D = 0.035;
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 4);
const easeIn = (x: number) => Math.pow(clamp(x), 3);
// пружина с перелётом (аналитическая, детерминированная по времени)
const spring = (u: number, k = 9, z = 0.42) => (u <= 0 ? 0 : 1 - Math.exp(-z * k * u) * Math.cos(k * Math.sqrt(1 - z * z) * u));

// ---------- текстуры (canvas) ----------
const cv = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")!] as const; };
const TW = 1024, TH = Math.round((1024 * H) / W);
const rr = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
};
const tex = (c: HTMLCanvasElement, srgb = true) => {
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1 / W, 1 / H); t.offset.set(0.5, 0.5); t.anisotropy = 8; return t;
};

function debitTextures() {
  const [c, g] = cv(TW, TH);
  const gr = g.createLinearGradient(0, 0, TW, TH); gr.addColorStop(0, "#26262b"); gr.addColorStop(0.5, "#121215"); gr.addColorStop(1, "#1d1d22");
  g.fillStyle = gr; g.fillRect(0, 0, TW, TH);
  for (let i = 0; i < 2600; i++) { // шлифовка металла
    const y = random(`by${i}`) * TH; g.strokeStyle = `rgba(255,255,255,${0.012 + random(`ba${i}`) * 0.03})`; g.lineWidth = 0.6 + random(`bw${i}`);
    g.beginPath(); const x0 = random(`bx${i}`) * TW; g.moveTo(x0, y); g.lineTo(x0 + 80 + random(`bl${i}`) * 500, y); g.stroke();
  }
  // тонкий гильош
  g.strokeStyle = "rgba(233,199,123,0.06)"; g.lineWidth = 1.2;
  for (let i = 0; i < 26; i++) { g.beginPath(); g.ellipse(TW * 0.82, TH * 0.2, 120 + i * 22, 70 + i * 14, -0.4, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = "#E9C77B"; g.font = "700 40px Inter"; (g as any).letterSpacing = "10px"; g.fillText("DEBIT", 62, 92);
  (g as any).letterSpacing = "0px";
  // бесконтакт
  g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = 5; g.lineCap = "round";
  for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(300, 278, 22 + i * 16, -0.7, 0.7); g.stroke(); }
  // номер с тиснением
  g.font = "500 54px Inter"; (g as any).letterSpacing = "8px";
  g.fillStyle = "rgba(0,0,0,0.6)"; g.fillText("5536  ••••  ••••  1450", 64, TH - 150);
  const ng = g.createLinearGradient(0, TH - 200, 0, TH - 140); ng.addColorStop(0, "#ffffff"); ng.addColorStop(1, "#9a9aa2");
  g.fillStyle = ng; g.fillText("5536  ••••  ••••  1450", 62, TH - 153);
  g.font = "600 30px Inter"; (g as any).letterSpacing = "6px"; g.fillStyle = "rgba(255,255,255,0.75)"; g.fillText("RYZHIKOV", 62, TH - 70);
  (g as any).letterSpacing = "0px";
  g.globalAlpha = 0.95; g.fillStyle = "#E9C77B"; g.beginPath(); g.arc(TW - 150, TH - 92, 46, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 0.6; g.fillStyle = "#f4f4f4"; g.beginPath(); g.arc(TW - 92, TH - 92, 46, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  // шероховатость: шлифовка = полосы
  const [rc, rg] = cv(TW, TH); rg.fillStyle = "#5a5a5a"; rg.fillRect(0, 0, TW, TH);
  for (let i = 0; i < 1800; i++) { const y = random(`ry${i}`) * TH; rg.fillStyle = `rgba(${random(`rv${i}`) > 0.5 ? "255,255,255" : "0,0,0"},0.12)`; rg.fillRect(0, y, TW, 1 + random(`rh${i}`) * 2); }
  return { map: tex(c), rough: tex(rc, false) };
}

function investBase() {
  const [c, g] = cv(TW, TH);
  const gr = g.createLinearGradient(0, 0, TW * 0.6, TH); gr.addColorStop(0, "rgba(40,70,62,1)"); gr.addColorStop(1, "rgba(8,20,18,1)");
  g.fillStyle = gr; g.fillRect(0, 0, TW, TH);
  g.strokeStyle = "rgba(255,255,255,0.08)"; g.lineWidth = 1.5;
  for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(60, 170 + i * 80); g.lineTo(TW - 60, 170 + i * 80); g.stroke(); }
  g.fillStyle = "rgba(255,255,255,0.92)"; g.font = "700 38px Inter"; (g as any).letterSpacing = "7px"; g.fillText("ИНВЕСТ-СЧЁТ", 62, 96); (g as any).letterSpacing = "0px";
  g.fillStyle = "rgba(255,255,255,0.5)"; g.font = "500 28px Inter"; g.fillText("Портфель", 62, 140);
  return tex(c);
}
const CHART = [[0, 0.72], [0.12, 0.62], [0.22, 0.68], [0.34, 0.5], [0.46, 0.55], [0.58, 0.36], [0.7, 0.42], [0.82, 0.22], [1, 0.1]];
function drawInvestGlow(g: CanvasRenderingContext2D, k: number) {
  g.clearRect(0, 0, TW, TH); g.fillStyle = "#000"; g.fillRect(0, 0, TW, TH);
  const x0 = 70, x1 = TW - 70, y0 = 190, y1 = TH - 70;
  const P = CHART.map(([x, y]) => [lerp(x0, x1, x), lerp(y0, y1, y)]);
  const total = P.length - 1, upto = k * total;
  g.lineCap = "round"; g.lineJoin = "round";
  const path = () => { g.beginPath(); g.moveTo(P[0][0], P[0][1]); for (let i = 1; i <= Math.ceil(upto) && i < P.length; i++) { const f = Math.min(1, upto - (i - 1)); g.lineTo(lerp(P[i - 1][0], P[i][0], f), lerp(P[i - 1][1], P[i][1], f)); } };
  // заливка под графиком
  path(); const last = Math.min(P.length - 1, Math.ceil(upto)); const lf = Math.min(1, upto - (last - 1));
  const lx = last ? lerp(P[last - 1][0], P[last][0], lf) : P[0][0], ly = last ? lerp(P[last - 1][1], P[last][1], lf) : P[0][1];
  g.lineTo(lx, y1 + 30); g.lineTo(P[0][0], y1 + 30); g.closePath();
  const fg = g.createLinearGradient(0, y0, 0, y1); fg.addColorStop(0, "rgba(110,240,160,0.35)"); fg.addColorStop(1, "rgba(110,240,160,0)"); g.fillStyle = fg; g.fill();
  for (const [w, a] of [[26, 0.18], [14, 0.35], [6, 1]] as const) { path(); g.strokeStyle = `rgba(140,255,180,${a})`; g.lineWidth = w; g.stroke(); }
  if (k > 0.02) { g.fillStyle = "#fff"; g.beginPath(); g.arc(lx, ly, 10, 0, Math.PI * 2); g.fill(); g.fillStyle = "rgba(140,255,180,0.35)"; g.beginPath(); g.arc(lx, ly, 26, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "#9CF0B4"; g.font = "800 64px Inter"; g.textAlign = "right"; g.fillText(`+${(18.4 * k).toFixed(1)}%`, TW - 62, 104); g.textAlign = "left";
}

function ipTextures() {
  const [c, g] = cv(TW, TH);
  const gr = g.createLinearGradient(0, 0, TW, TH); gr.addColorStop(0, "#FBF6EA"); gr.addColorStop(1, "#E6DCC5"); g.fillStyle = gr; g.fillRect(0, 0, TW, TH);
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(90,70,40,${random(`pa${i}`) * 0.05})`; g.fillRect(random(`px${i}`) * TW, random(`pyy${i}`) * TH, 2, 2); }
  g.strokeStyle = "rgba(150,115,50,0.55)"; g.lineWidth = 3; rr(g, 26, 26, TW - 52, TH - 52, 22); g.stroke();
  g.lineWidth = 1; rr(g, 38, 38, TW - 76, TH - 76, 16); g.stroke();
  g.fillStyle = "#2A2520"; g.font = "600 64px 'Playfair Display'"; g.fillText("Свидетельство", 70, 130);
  g.font = "italic 400 30px 'Playfair Display'"; g.fillStyle = "rgba(42,37,32,0.75)"; g.fillText("о регистрации индивидуального предпринимателя", 72, 180);
  g.font = "500 26px Inter"; g.fillStyle = "rgba(42,37,32,0.55)";
  ["Режим налогообложения: НПД", "ОГРНИП  3 2 4 7 7 0 0 0 • • • • •", "Дата: 2026"].forEach((s, i) => g.fillText(s, 72, 260 + i * 52));
  for (let i = 0; i < 3; i++) { g.fillStyle = "rgba(42,37,32,0.12)"; g.fillRect(72, 440 + i * 34, 420 - i * 90, 12); }
  // золотой герб-печать фольгой
  const fg = g.createRadialGradient(TW - 170, 150, 10, TW - 170, 150, 80); fg.addColorStop(0, "#fff1c4"); fg.addColorStop(0.6, "#d2a750"); fg.addColorStop(1, "#8c6420");
  g.fillStyle = fg; g.beginPath();
  for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2, r = i % 2 ? 66 : 78; g.lineTo(TW - 170 + Math.cos(a) * r, 150 + Math.sin(a) * r); }
  g.closePath(); g.fill();
  return tex(c);
}
function stampImprint() {
  const S = 512; const [c, g] = cv(S, S);
  g.translate(S / 2, S / 2); g.rotate(-0.18);
  g.strokeStyle = "#ffffff"; g.fillStyle = "#ffffff";
  g.lineWidth = 16; g.beginPath(); g.arc(0, 0, 220, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 186, 0, Math.PI * 2); g.stroke();
  g.textAlign = "center"; g.font = "900 150px Inter"; g.fillText("ИП", 0, 30);
  g.font = "800 58px Inter"; g.fillText("на НПД", 0, 110);
  g.font = "700 30px Inter"; (g as any).letterSpacing = "6px"; g.fillText("ЗАРЕГИСТРИРОВАН", 0, -110);
  // грязь резины: дыры в краске
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 1400; i++) { g.globalAlpha = random(`sa${i}`) * 0.8; g.beginPath(); g.arc(random(`sx${i}`) * S, random(`sy${i}`) * S, random(`sr${i}`) * 4, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function glowSprite(kind: "dot" | "streak") {
  const [c, g] = cv(256, kind === "dot" ? 256 : 64);
  if (kind === "dot") { const r = g.createRadialGradient(128, 128, 0, 128, 128, 128); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.2, "rgba(255,225,160,0.8)"); r.addColorStop(1, "rgba(255,180,80,0)"); g.fillStyle = r; g.fillRect(0, 0, 256, 256); }
  else { const r = g.createLinearGradient(0, 0, 256, 0); r.addColorStop(0, "rgba(255,200,120,0)"); r.addColorStop(0.5, "rgba(255,240,210,1)"); r.addColorStop(1, "rgba(255,200,120,0)"); g.fillStyle = r; g.fillRect(0, 0, 256, 64);
    g.globalCompositeOperation = "destination-in"; const v = g.createLinearGradient(0, 0, 0, 64); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(0.5, "rgba(0,0,0,1)"); v.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = v; g.fillRect(0, 0, 256, 64); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

type Tex = ReturnType<typeof makeAll>;
function makeAll() {
  const d = debitTextures();
  const [gc, gg] = cv(TW, TH); const glow = tex(gc);
  return { debit: d, investBase: investBase(), investGlowCanvas: gc, investGlowCtx: gg, investGlow: glow, ip: ipTextures(), imprint: stampImprint(), dot: glowSprite("dot"), streak: glowSprite("streak") };
}

// ---------- геометрия ----------
const cardGeo = (() => {
  let g: THREE.ExtrudeGeometry | null = null;
  return () => {
    if (g) return g;
    const s = new THREE.Shape(); const x = -W / 2, y = -H / 2;
    s.moveTo(x + R, y); s.lineTo(x + W - R, y); s.quadraticCurveTo(x + W, y, x + W, y + R); s.lineTo(x + W, y + H - R); s.quadraticCurveTo(x + W, y + H, x + W - R, y + H);
    s.lineTo(x + R, y + H); s.quadraticCurveTo(x, y + H, x, y + H - R); s.lineTo(x, y + R); s.quadraticCurveTo(x, y, x + R, y);
    g = new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 4, curveSegments: 18 });
    g.translate(0, 0, -D / 2); return g;
  };
})();

// ---------- окружение для отражений ----------
const Env: React.FC = () => {
  const { gl, scene } = useThree();
  useLayoutEffect(() => {
    const pm = new THREE.PMREMGenerator(gl); const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env; scene.environmentIntensity = 1.15 as any; return () => { env.dispose(); pm.dispose(); };
  }, [gl, scene]);
  return null;
};

// ---------- карточка: вход / покой / выход ----------
type Pose = { p: [number, number, number]; r: [number, number, number] };
const cardPose = (t: number, at: number, out: number, rest: Pose, from: Pose, side: number, spin: number) => {
  const u = t - at; const s = spring(u, 8.5, 0.5); const e = easeIn((t - out) / 0.32);
  const sp = clamp(u / 0.55); // вращение доходит раньше позиции
  const idle = Math.max(0, u);
  const p: [number, number, number] = [
    lerp(from.p[0], rest.p[0], s) + side * 9 * e,
    lerp(from.p[1], rest.p[1], s) + Math.sin(idle * 1.3 + at) * 0.05 + 0.6 * e,
    lerp(from.p[2], rest.p[2], s) + 1.5 * e,
  ];
  const r: [number, number, number] = [
    lerp(from.r[0], rest.r[0], s) + Math.sin(idle * 0.9 + at) * 0.04,
    lerp(from.r[1] + spin, rest.r[1], easeOut(sp)) * 1 + Math.sin(idle * 0.7 + at * 2) * 0.1 + side * 1.4 * e,
    lerp(from.r[2], rest.r[2], s) - side * 0.5 * e,
  ];
  return { p, r, vis: u > -0.02 && e < 1, s, u };
};

const Sparks: React.FC<{ t: number; at: number; pos: [number, number, number]; tex: THREE.Texture; n?: number; color?: string; seed: string }> = ({ t, at, pos, tex: tx, n = 46, color = "#ffd88a", seed }) => {
  const u = t - at; if (u < 0 || u > 1.3) return null;
  return (
    <group position={pos}>
      {Array.from({ length: n }).map((_, i) => {
        const a = random(`${seed}a${i}`) * Math.PI * 2, sp = 1.5 + random(`${seed}s${i}`) * 3.5, life = 0.5 + random(`${seed}l${i}`) * 0.7;
        const k = u / life; if (k > 1) return null;
        const d = sp * (1 - Math.exp(-u * 3.2)) / 3.2 * 2.2;
        const x = Math.cos(a) * d * 1.5, y = Math.sin(a) * d - 1.2 * u * u, z = (random(`${seed}z${i}`) - 0.3) * d;
        const sz = (0.05 + random(`${seed}q${i}`) * 0.09) * (1 - k);
        return (
          <sprite key={i} position={[x, y, z]} scale={[sz, sz, sz]}>
            <spriteMaterial map={tx} color={color} transparent opacity={1 - k} blending={THREE.AdditiveBlending} depthWrite={false} />
          </sprite>
        );
      })}
    </group>
  );
};

const Flare: React.FC<{ t: number; at: number; pos: [number, number, number]; T: Tex; scale?: number }> = ({ t, at, pos, T, scale = 1 }) => {
  const u = t - at; if (u < 0 || u > 0.6) return null;
  const a = Math.sin(clamp(u / 0.6) * Math.PI) ** 1.5;
  return (
    <group position={pos}>
      <sprite scale={[9 * scale * (0.6 + u), 0.35 * scale, 1]}><spriteMaterial map={T.streak} color="#ffd9a0" transparent opacity={a * 0.9} blending={THREE.AdditiveBlending} depthWrite={false} /></sprite>
      <sprite scale={[1.6 * scale, 1.6 * scale, 1]}><spriteMaterial map={T.dot} color="#fff3d6" transparent opacity={a * 0.8} blending={THREE.AdditiveBlending} depthWrite={false} /></sprite>
    </group>
  );
};

export type CardsEv = { debit: number; invest: number; ip: number; hit: number; out: number };

const Scene: React.FC<{ t: number; ev: CardsEv; T: Tex }> = ({ t, ev, T }) => {
  const geo = cardGeo();
  // ДЕБЕТ: прилетает из-за камеры слева сверху, переворачивается, садится слева от Пети
  const dRest: Pose = { p: [-3.55, -0.25, 0], r: [0.12, 0.42, -0.1] };
  const d = cardPose(t, ev.debit, ev.out, dRest, { p: [-1.2, 3.2, 8.5], r: [-1.1, 0.4, 0.9] }, -1, -Math.PI * 2);
  // ИНВЕСТ: справа сверху, из глубины
  const iRest: Pose = { p: [3.75, 1.25, -0.3], r: [0.1, -0.45, 0.07] };
  const iv = cardPose(t, ev.invest, ev.out, iRest, { p: [7.5, 4.5, -6], r: [0.9, -2.2, -0.6] }, 1, Math.PI * 2);
  // ИП: справа снизу, лежит под наклоном (печать бьёт по нормали)
  const pRest: Pose = { p: [3.6, -1.25, 0.2], r: [-1.08, -0.28, 0.05] };
  const ip = cardPose(t, ev.ip, ev.out, pRest, { p: [6.5, -5, 4], r: [-2.4, -1.2, 0.4] }, 1, Math.PI * 2);
  // после удара карточка поднимается к камере и показывает оттиск
  const rise = easeOut((t - ev.hit - 0.3) / 0.45);
  ip.r[0] += 0.78 * rise; ip.p[1] += 0.15 * rise;

  // график рисуется по времени
  const draw = easeOut((t - ev.invest - 0.35) / 1.1);
  useLayoutEffect(() => { drawInvestGlow(T.investGlowCtx, draw); T.investGlow.needsUpdate = true; }, [draw, T]);

  // печать: зависает над карточкой, падает (easeIn), отскок, уходит
  const hit = ev.hit;
  const fall = t < hit ? lerp(1.7, 0.06, easeIn((t - (hit - 0.32)) / 0.32)) : t < hit + 0.22 ? 0.06 : lerp(0.06, 4, easeIn((t - hit - 0.22) / 0.35));
  const stampVis = t > hit - 0.32 && t < hit + 0.6;
  const stampIn = clamp((t - (hit - 0.32)) / 0.08);
  const squash = t >= hit && t < hit + 0.12 ? 1 - 0.18 * Math.sin(((t - hit) / 0.12) * Math.PI) : 1;
  const imprint = t >= hit ? 1 : 0;
  const ring = clamp((t - hit) / 0.45);

  // пролёт света по металлу: точечный свет проходит слева направо после посадки
  const sweep = (at: number, x0: number) => { const k = clamp((t - at - 0.35) / 0.9); return [x0 - 2 + 4 * easeOut(k), 0.6, 1.6] as [number, number, number]; };
  const sweepI = (at: number) => { const k = (t - at - 0.35) / 0.9; return k < 0 || k > 1 ? 0 : Math.sin(k * Math.PI); };

  return (
    <>
      <Env />
      <ambientLight intensity={0.25} />
      <directionalLight position={[-4, 5, 6]} intensity={2.2} color="#ffe4bf" />
      <directionalLight position={[6, -2, -3]} intensity={1.4} color="#9fc4ff" />
      <pointLight position={sweep(ev.debit, -3.55)} intensity={14 * sweepI(ev.debit)} distance={7} color="#fff1d8" />
      <pointLight position={sweep(ev.ip, 3.6)} intensity={8 * sweepI(ev.ip)} distance={6} color="#fff1d8" />

      {d.vis && (
        <group position={d.p} rotation={d.r}>
          <mesh geometry={geo}>
            <meshPhysicalMaterial attach="material-0" map={T.debit.map} roughnessMap={T.debit.rough} metalness={0.9} roughness={0.3} clearcoat={0.6} clearcoatRoughness={0.25} />
            <meshPhysicalMaterial attach="material-1" color="#c9a35a" metalness={1} roughness={0.22} />
          </mesh>
          {/* чип */}
          <mesh position={[-W / 2 + 0.52, 0.12, D / 2 + 0.008]}>
            <boxGeometry args={[0.42, 0.32, 0.02]} />
            <meshPhysicalMaterial color="#e8c172" metalness={1} roughness={0.18} clearcoat={1} />
          </mesh>
          {[-0.06, 0.04, 0.14, 0.24].map((y) => <mesh key={y} position={[-W / 2 + 0.52, y, D / 2 + 0.019]}><boxGeometry args={[0.38, 0.006, 0.002]} /><meshStandardMaterial color="#7a5a22" metalness={1} roughness={0.4} /></mesh>)}
        </group>
      )}

      {iv.vis && (
        <group position={iv.p} rotation={iv.r}>
          <mesh geometry={geo}>
            <meshPhysicalMaterial attach="material-0" map={T.investBase} emissiveMap={T.investGlow} emissive="#ffffff" emissiveIntensity={1.6}
              metalness={0.1} roughness={0.08} clearcoat={1} clearcoatRoughness={0.03} transparent opacity={0.93} />
            <meshPhysicalMaterial attach="material-1" color="#bff5d6" metalness={0.2} roughness={0.05} transparent opacity={0.6} />
          </mesh>
        </group>
      )}

      {ip.vis && (
        <group position={ip.p} rotation={ip.r}>
          <mesh geometry={geo} scale={[1, 1, squash]}>
            <meshPhysicalMaterial attach="material-0" map={T.ip} color="#c4bcab" roughness={0.88} metalness={0} envMapIntensity={0.35} />
            <meshStandardMaterial attach="material-1" color="#d9cdb2" roughness={0.9} />
          </mesh>
          <mesh position={[0.62, -0.08, D / 2 + 0.014]} visible={imprint > 0}>
            <planeGeometry args={[1.2, 1.2]} />
            <meshBasicMaterial map={T.imprint} color="#b8231b" transparent toneMapped={false} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
          </mesh>
          {/* ударная волна по плоскости карточки */}
          {ring > 0 && ring < 1 && (
            <mesh position={[0.62, -0.08, D / 2 + 0.03]} scale={[0.4 + ring * 3.2, 0.4 + ring * 3.2, 1]}>
              <ringGeometry args={[0.46, 0.5, 96]} />
              <meshBasicMaterial color="#ffb27a" transparent opacity={(1 - ring) * 0.9} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
          )}
          {stampVis && (
            <group position={[0.62, -0.08, D / 2 + fall]} scale={stampIn}>
              <group rotation={[Math.PI / 2, 0, 0]}>
                <mesh position={[0, 0.05, 0]}><cylinderGeometry args={[0.55, 0.55, 0.1, 64]} /><meshPhysicalMaterial color="#8e1a15" roughness={0.75} /></mesh>
                <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.58, 0.58, 0.2, 64]} /><meshPhysicalMaterial color="#141414" metalness={0.3} roughness={0.25} clearcoat={1} /></mesh>
                <mesh position={[0, 0.32, 0]}><cylinderGeometry args={[0.44, 0.58, 0.06, 64]} /><meshPhysicalMaterial color="#c9a35a" metalness={1} roughness={0.2} /></mesh>
                <mesh position={[0, 0.62, 0]}><cylinderGeometry args={[0.13, 0.17, 0.55, 32]} /><meshPhysicalMaterial color="#6b4326" roughness={0.45} clearcoat={0.8} /></mesh>
                <mesh position={[0, 1.0, 0]} scale={[1, 0.85, 1]}><sphereGeometry args={[0.3, 48, 32]} /><meshPhysicalMaterial color="#6b4326" roughness={0.4} clearcoat={0.9} /></mesh>
              </group>
            </group>
          )}
          <Sparks t={t} at={hit} pos={[0.62, -0.08, 0.1]} tex={T.dot} n={36} color="#ffcf9a" seed="ip" />
        </group>
      )}

      <Flare t={t} at={ev.debit + 0.28} pos={[dRest.p[0] + 0.8, dRest.p[1] + 0.5, 0.6]} T={T} />
      <Sparks t={t} at={ev.debit + 0.25} pos={[dRest.p[0], dRest.p[1], 0.2]} tex={T.dot} seed="d" />
      <Flare t={t} at={ev.invest + 0.3} pos={[iRest.p[0] - 0.6, iRest.p[1] + 0.4, 0.4]} T={T} scale={0.8} />
      <Sparks t={t} at={ev.invest + 0.28} pos={[iRest.p[0], iRest.p[1], 0]} tex={T.dot} n={30} color="#b6ffd2" seed="i" />
      <Flare t={t} at={hit} pos={[pRest.p[0] + 0.5, pRest.p[1], 0.8]} T={T} scale={1.3} />
    </>
  );
};

// Канвас целиком прозрачный; сам ThreeCanvas подключается снаружи (с размытием в движении).
export const CardsScene: React.FC<{ t: number; ev: CardsEv }> = ({ t, ev }) => {
  const [T, setT] = useState<Tex | null>(null);
  const [h] = useState(() => delayRender("cards3d textures"));
  const { advance } = useThree();
  const done = React.useRef(false);
  useLayoutEffect(() => { document.fonts.ready.then(() => setT(makeAll())); }, []);
  // ThreeCanvas рисует только на смене кадра: после загрузки текстур дорисовываем вручную и только потом отпускаем рендер
  useLayoutEffect(() => { if (T) { advance(performance.now()); requestAnimationFrame(() => { advance(performance.now()); if (!done.current) { done.current = true; continueRender(h); } }); } }, [T, t]);
  if (!T) return null;
  return <Scene t={t} ev={ev} T={T} />;
};

// тряска кадра от удара печати
export const stampShake = (t: number, hit: number) => {
  const u = t - hit; if (u < 0 || u > 0.35) return { x: 0, y: 0, s: 1 };
  const a = Math.exp(-u * 12); return { x: Math.sin(u * 95) * 14 * a, y: Math.cos(u * 120) * 10 * a, s: 1 + 0.025 * a };
};

