// Моушен-дизайн для отрывка 1:09–1:30 «14 000 ₽»: 3D-карточки, печать, «ПОЧЕМУ» за человеком,
// полноэкранная сцена «банки / 200 млрд / клиенты», финал «ТЫ» с контуром и связями.
import React from "react";
import { AbsoluteFill, Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";

const C = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const out = Easing.bezier(0.16, 1, 0.3, 1);
const io = Easing.bezier(0.65, 0, 0.35, 1);
const GOLD = "#E9C77B";
const useT = () => { const f = useCurrentFrame(); const { fps } = useVideoConfig(); return { f, fps, t: f / fps }; };
const sp = (f: number, fps: number, at: number, cfg = { damping: 15, stiffness: 120, mass: 0.9 }) => spring({ frame: f - Math.round(at * fps), fps, config: cfg });

// ---------------- 1. Три 3D-карточки ----------------
const CardShell: React.FC<{ w: number; h: number; bg: string; children: React.ReactNode; shine: number; border?: string }> = ({ w, h, bg, children, shine, border }) => (
  <div style={{ width: w, height: h, borderRadius: 28, background: bg, position: "relative", overflow: "hidden", border: border ?? "1px solid rgba(255,255,255,0.18)",
    boxShadow: "0 40px 80px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.25)" }}>
    {children}
    {/* блик проходит по карточке */}
    <div style={{ position: "absolute", top: -50, bottom: -50, width: 120, left: `${-30 + shine * 140}%`, transform: "rotate(18deg)",
      background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)", filter: "blur(6px)" }} />
  </div>
);

const DebitCard: React.FC<{ shine: number }> = ({ shine }) => (
  <CardShell w={430} h={270} shine={shine} bg="linear-gradient(135deg,#1b1b1f 0%,#2b2a30 45%,#121214 100%)" border="1px solid rgba(233,199,123,0.45)">
    <div style={{ position: "absolute", left: 34, top: 34, fontFamily: "Inter", fontWeight: 700, fontSize: 22, letterSpacing: "0.2em", color: GOLD }}>DEBIT</div>
    <div style={{ position: "absolute", left: 34, top: 96, width: 64, height: 48, borderRadius: 9, background: "linear-gradient(135deg,#f3d58f,#b8913f)",
      boxShadow: "inset 0 0 0 2px rgba(0,0,0,0.15)" }}>
      {[14, 24, 34].map((y) => <div key={y} style={{ position: "absolute", left: 6, right: 6, top: y, height: 1.5, background: "rgba(0,0,0,0.25)" }} />)}
    </div>
    <div style={{ position: "absolute", left: 34, bottom: 52, fontFamily: "Inter", fontWeight: 500, fontSize: 30, letterSpacing: "0.12em", color: "#EDEDED" }}>•••• •••• •••• 1450</div>
    <div style={{ position: "absolute", right: 30, bottom: 26, display: "flex" }}>
      <div style={{ width: 44, height: 44, borderRadius: 22, background: "#E9C77B", opacity: 0.9 }} />
      <div style={{ width: 44, height: 44, borderRadius: 22, background: "#fff", opacity: 0.55, marginLeft: -16 }} />
    </div>
  </CardShell>
);

const InvestCard: React.FC<{ shine: number; draw: number }> = ({ shine, draw }) => {
  const pts = [[0, 120], [50, 105], [95, 112], [140, 80], [190, 88], [240, 50], [290, 58], [340, 18]];
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0] + 40} ${p[1] + 80}`).join(" ");
  return (
    <CardShell w={430} h={270} shine={shine} bg="linear-gradient(160deg,rgba(255,255,255,0.32),rgba(255,255,255,0.12))">
      <div style={{ position: "absolute", inset: 0, backdropFilter: "blur(14px)" }} />
      <div style={{ position: "absolute", left: 34, top: 28, fontFamily: "Inter", fontWeight: 700, fontSize: 22, letterSpacing: "0.14em", color: "#fff" }}>ИНВЕСТ-СЧЁТ</div>
      <div style={{ position: "absolute", right: 30, top: 24, fontFamily: "Inter", fontWeight: 700, fontSize: 28, color: "#9CF0B4" }}>+{Math.round(18 * draw)}%</div>
      <svg width="430" height="270" style={{ position: "absolute", inset: 0 }}>
        <path d={d} fill="none" stroke="#9CF0B4" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="600" strokeDashoffset={600 * (1 - draw)}
          style={{ filter: "drop-shadow(0 0 8px rgba(156,240,180,0.8))" }} />
      </svg>
    </CardShell>
  );
};

const IpCard: React.FC<{ shine: number; stamp: number; f: number }> = ({ shine, stamp, f }) => (
  <CardShell w={430} h={270} shine={shine} bg="linear-gradient(160deg,#F7F1E3,#E9DFC9)" border="1px solid rgba(0,0,0,0.08)">
    <div style={{ position: "absolute", left: 34, top: 30, fontFamily: "Playfair Display", fontWeight: 600, fontSize: 30, color: "#2A2520" }}>Свидетельство</div>
    {[86, 116, 146, 176].map((y, i) => <div key={y} style={{ position: "absolute", left: 34, width: 240 - i * 30, top: y, height: 9, borderRadius: 5, background: "rgba(42,37,32,0.14)" }} />)}
    {/* печать: падает с высоты, удар, след */}
    <div style={{ position: "absolute", right: 34, top: 70, width: 150, height: 150, borderRadius: 75, border: "6px solid #C8342C", color: "#C8342C",
      display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", fontFamily: "Inter", fontWeight: 800,
      transform: `scale(${3 - 2 * stamp}) rotate(${-14 + 4 * stamp}deg)`, opacity: Math.min(1, stamp * 1.4) * 0.92 }}>
      <div style={{ fontSize: 34, lineHeight: 1 }}>ИП</div><div style={{ fontSize: 20, marginTop: 4 }}>на НПД</div>
    </div>
  </CardShell>
);

export const CardsBeat: React.FC<{ tDebit: number; tInvest: number; tIp: number; tOut: number }> = ({ tDebit, tInvest, tIp, tOut }) => {
  const { f, fps, t } = useT();
  const fly = (at: number) => sp(f, fps, at, { damping: 17, stiffness: 95, mass: 1 });
  const exit = interpolate(t, [tOut, tOut + 0.35], [0, 1], { ...C, easing: Easing.in(Easing.cubic) });
  const card = (at: number, x: number, y: number, rz: number, el: (s: number) => React.ReactNode) => {
    const s = fly(at);
    const bob = Math.sin((t - at) * 1.6 + x) * 6;
    const shine = interpolate(t - at, [0.25, 1.0], [0, 1], C);
    return (
      <div style={{ position: "absolute", left: x, top: y + bob, transformStyle: "preserve-3d",
        transform: `translateZ(${(1 - s) * -1400 + exit * 900}px) translateX(${exit * (x > 900 ? 900 : -900)}px) rotateY(${(1 - s) * 75 + Math.sin(t * 0.8 + x) * 6}deg) rotateX(${(1 - s) * -25}deg) rotateZ(${rz * s}deg)`,
        opacity: Math.min(1, s * 2) * (1 - exit), filter: `blur(${Math.max(0, (1 - s) * 10 - 1)}px)` }}>{el(shine)}</div>
    );
  };
  const stamp = interpolate(t - tIp - 0.28, [0, 0.12], [0, 1], { ...C, easing: Easing.in(Easing.quad) });
  const wave = interpolate(t - tIp - 0.4, [0, 0.5], [0, 1], C);
  return (
    <AbsoluteFill style={{ perspective: 1400 }}>
      {card(tDebit, 110, 400, -8, (sh) => <DebitCard shine={sh} />)}
      {card(tInvest, 1400, 200, 7, (sh) => <InvestCard shine={sh} draw={interpolate(t - tInvest, [0.3, 1.2], [0, 1], { ...C, easing: out })} />)}
      {card(tIp, 1380, 560, -5, (sh) => <IpCard shine={sh} stamp={stamp} f={f} />)}
      {/* ударная волна от печати */}
      {wave > 0 && wave < 1 && (
        <div style={{ position: "absolute", left: 1380 + 430 - 109, top: 560 + 145, width: 0, height: 0 }}>
          <div style={{ position: "absolute", left: -220 * wave, top: -220 * wave, width: 440 * wave, height: 440 * wave, borderRadius: "50%",
            border: `${6 * (1 - wave)}px solid rgba(200,52,44,${0.7 * (1 - wave)})` }} />
        </div>
      )}
    </AbsoluteFill>
  );
};

// ---------------- 2. «ПОЧЕМУ» за человеком ----------------
export const WhyBehind: React.FC<{ tWhy: number; tPay: number; dur: number }> = ({ tWhy, tPay, dur }) => {
  const { f, fps, t } = useT();
  const word = "ПОЧЕМУ";
  const o = interpolate(t, [dur - 0.12, dur], [1, 0], C);
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <div style={{ position: "absolute", top: "12%", left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6 }}>
        {word.split("").map((ch, i) => {
          const s = sp(f, fps, tWhy + i * 0.035, { damping: 13, stiffness: 170, mass: 0.7 });
          return <span key={i} style={{ fontFamily: "Playfair Display", fontWeight: 700, fontSize: 330, lineHeight: 1, color: "transparent",
            background: "linear-gradient(180deg,#FFF6DD 0%,#E9C77B 70%,#B88A3A 100%)", WebkitBackgroundClip: "text",
            transform: `translateY(${(1 - s) * 220}px) scale(${0.7 + 0.3 * s})`, opacity: Math.min(1, s * 1.5), display: "inline-block",
            filter: "drop-shadow(0 20px 40px rgba(0,0,0,0.35))" }}>{ch}</span>;
        })}
      </div>

    </AbsoluteFill>
  );
};

/** «МНОГО ПЛАТЯТ?» — поверх человека */
export const PayFront: React.FC<{ tPay: number; dur: number }> = ({ tPay, dur }) => {
  const { t } = useT();
  const o = interpolate(t, [dur - 0.12, dur], [1, 0], C);
  return (
    <AbsoluteFill style={{ opacity: o }}>
      {t >= tPay && (
        <div style={{ position: "absolute", top: "47%", left: 0, right: 0, textAlign: "center", fontFamily: "Playfair Display", fontWeight: 600, fontSize: 64,
          letterSpacing: "0.12em", color: "#FFF4D6", textShadow: "0 0 20px rgba(255,200,110,0.6)",
          opacity: interpolate(t - tPay, [0, 0.15], [0, 1], C), transform: `translateY(${interpolate(t - tPay, [0, 0.25], [20, 0], { ...C, easing: out })}px)` }}>МНОГО ПЛАТЯТ?</div>
      )}    </AbsoluteFill>
  );
};

// ---------------- 3. Полноэкранная сцена «Банки» ----------------
const Bank: React.FC<{ x: number; s: number; glow: number; w?: number; label: string }> = ({ x, s, glow, w = 250, label }) => (
  <div style={{ position: "absolute", left: x, bottom: 160, width: w, height: 330, transform: `translateY(${(1 - s) * 420}px)`, opacity: Math.min(1, s * 2) }}>
    <div style={{ position: "absolute", left: -18, right: -18, top: 0, height: 0, borderLeft: `${w / 2 + 18}px solid transparent`, borderRight: `${w / 2 + 18}px solid transparent`,
      borderBottom: `70px solid ${glow > 0.5 ? "#F0D28C" : "#3A4257"}` }} />
    <div style={{ position: "absolute", left: 0, right: 0, top: 70, height: 22, background: "#4A5470" }} />
    {[0, 1, 2, 3].map((i) => (
      <div key={i} style={{ position: "absolute", top: 100, bottom: 40, left: 16 + i * ((w - 50) / 3), width: 20, background: "linear-gradient(90deg,#5B6584,#7D88A8,#5B6584)" }} />
    ))}
    <div style={{ position: "absolute", left: -14, right: -14, bottom: 0, height: 40, background: "#4A5470" }} />
    <div style={{ position: "absolute", left: w / 2 - 34, bottom: 40, width: 68, height: 110, background: `rgba(255,214,130,${0.25 + 0.75 * glow})`, boxShadow: `0 0 ${60 * glow}px rgba(255,200,100,${glow})` }} />
    <div style={{ position: "absolute", left: 0, right: 0, top: -48, textAlign: "center", fontFamily: "Inter", fontWeight: 800, fontSize: 24, letterSpacing: "0.18em", color: "#C9D2EA" }}>{label}</div>
  </div>
);

const Bill: React.FC<{ i: number; t: number; t0: number }> = ({ i, t, t0 }) => {
  const r = (k: number) => random(`bill${i}-${k}`);
  const age = t - t0 - r(0) * 1.4;
  if (age < 0) return null;
  const x = r(1) * 1920, sway = Math.sin(age * (2 + r(2) * 2) + r(3) * 6) * 60;
  const y = -120 + age * (320 + r(4) * 260);
  const rot = age * (120 + r(5) * 200) * (r(6) > 0.5 ? 1 : -1);
  const flip = Math.cos(age * (4 + r(7) * 4));
  return (
    <div style={{ position: "absolute", left: x + sway, top: y, width: 120, height: 56, transform: `rotate(${rot}deg) scaleY(${0.3 + 0.7 * Math.abs(flip)})`,
      background: "linear-gradient(135deg,#7FBF8E,#4F8A5F)", borderRadius: 5, border: "2px solid rgba(255,255,255,0.35)", opacity: 0.92,
      boxShadow: "0 10px 20px rgba(0,0,0,0.3)" }}>
      <div style={{ position: "absolute", inset: 8, border: "1.5px solid rgba(255,255,255,0.45)", borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "Inter", fontWeight: 800, fontSize: 20, color: "rgba(255,255,255,0.85)" }}>₽</div>
    </div>
  );
};

const Person: React.FC<{ x: number; y: number; s: number; c?: string }> = ({ x, y, s, c = "#E9EDF7" }) => (
  <svg viewBox="0 0 40 60" width={34 * s} height={51 * s} style={{ position: "absolute", left: x - 17 * s, top: y - 25 * s }}>
    <circle cx="20" cy="12" r="9" fill={c} /><path d="M4 58 C5 36 12 28 20 28 C28 28 35 36 36 58 Z" fill={c} />
  </svg>
);

const fmt = (v: number) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export const BanksScene: React.FC<{ dur: number; tBanks: number; t200: number; tYear: number; tAttract: number; tClients: number; tOwn: number }> = (p) => {
  const { f, fps, t } = useT();
  const enter = interpolate(t, [0, 0.18], [0, 1], { ...C, easing: out });
  const leave = interpolate(t, [p.dur - 0.16, p.dur], [0, 1], C);
  const cam = interpolate(t, [0, p.dur], [1.0, 1.08], { easing: io });
  const banks = [["СБЕР", 200], ["ВТБ", 560], ["АЛЬФА", 920], ["ОЗОН", 1280], ["Т-БАНК", 1640]] as const;
  const q = interpolate(t, [p.t200, p.t200 + 1.4], [0, 1], { ...C, easing: (x) => 1 - Math.pow(1 - x, 4) });
  const counterIn = sp(f, fps, p.t200, { damping: 14, stiffness: 150, mass: 0.8 });
  const counterOut = interpolate(t, [p.tAttract - 0.1, p.tAttract + 0.3], [0, 1], { ...C, easing: io });
  const years = ["2024", "2025", "2026"];
  const yi = Math.min(2, Math.max(0, Math.floor((t - p.tYear) / 0.16)));
  const calIn = sp(f, fps, p.tYear, { damping: 14, stiffness: 170, mass: 0.7 });
  const calOut = interpolate(t, [p.tAttract, p.tAttract + 0.25], [0, 1], C);
  const glowAll = interpolate(t, [p.tOwn, p.tOwn + 0.3], [0, 1], C);
  const N = 46;
  return (
    <AbsoluteFill style={{ opacity: enter * (1 - leave), overflow: "hidden", background: "radial-gradient(ellipse at 50% 35%, #26304A 0%, #12172A 55%, #090B14 100%)" }}>
      <AbsoluteFill style={{ transform: `scale(${cam})` }}>
        {/* звёзды/пыль */}
        {Array.from({ length: 60 }).map((_, i) => (
          <div key={i} style={{ position: "absolute", left: random(`s${i}`) * 1920, top: random(`t${i}`) * 600, width: 3, height: 3, borderRadius: 2,
            background: "#fff", opacity: 0.15 + 0.35 * Math.abs(Math.sin(t * 1.5 + i)) }} />
        ))}
        {/* земля */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 160, background: "linear-gradient(180deg,#1C2338,#0B0E18)" }} />
        {/* «НА ДАННЫЙ МОМЕНТ»: закрывает паузу до подъёма банков, уходит вверх, когда растут банки */}
        {t < p.tBanks + 0.4 && (() => {
          const a = interpolate(t, [0.08, 0.3], [0, 1], { ...C, easing: out });
          const o = interpolate(t, [p.tBanks - 0.05, p.tBanks + 0.2], [0, 1], { ...C, easing: io });
          const ls = interpolate(t, [0.08, p.tBanks], [40, 14], { ...C, easing: out });
          return (
            <div style={{ position: "absolute", left: 0, right: 0, top: 430 - o * 120, textAlign: "center", opacity: a * (1 - o),
              filter: `blur(${(1 - a) * 10 + o * 8}px)`, fontFamily: "Playfair Display, serif", fontSize: 92, letterSpacing: ls,
              color: "#E9C77B", textShadow: "0 0 40px rgba(233,199,123,0.35)" }}>
              НА ДАННЫЙ МОМЕНТ
              <div style={{ fontFamily: "Inter, sans-serif", fontSize: 26, letterSpacing: 10, color: "#fff", opacity: 0.6, marginTop: 18 }}>2026</div>
            </div>
          );
        })()}
        {banks.map(([n, x], i) => (
          <Bank key={n} x={x - 125} label={n} s={sp(f, fps, p.tBanks + i * 0.09, { damping: 14, stiffness: 120, mass: 1 })}
            glow={Math.max(glowAll, interpolate(t, [p.tClients + 0.5 + i * 0.15, p.tClients + 0.8 + i * 0.15], [0, 1], C))} />
        ))}
        {/* люди затягиваются в двери банков */}
        {t > p.tClients - 0.2 && Array.from({ length: N }).map((_, i) => {
          const b = banks[i % 5][1]; const st = p.tClients - 0.2 + random(`p${i}`) * 1.5; const k = interpolate(t, [st, st + 1.1], [0, 1], { ...C, easing: io });
          if (t < st || k >= 1) return null;
          const x0 = random(`px${i}`) * 1920, y0 = 1000 + random(`py${i}`) * 60;
          const x = x0 + (b - x0) * k, y = y0 + (860 - y0) * k - Math.sin(k * Math.PI) * 160;
          return <Person key={i} x={x} y={y} s={1.1 - 0.5 * k} c={k > 0.85 ? GOLD : "#E9EDF7"} />;
        })}
        {/* дождь купюр */}
        {t > p.t200 && t < p.tAttract + 1.5 && Array.from({ length: 40 }).map((_, i) => <Bill key={i} i={i} t={t} t0={p.t200} />)}
      </AbsoluteFill>
      {/* счётчик */}
      <div style={{ position: "absolute", top: 160, left: 0, right: 0, textAlign: "center", opacity: counterIn * (1 - counterOut),
        transform: `scale(${0.7 + 0.3 * counterIn - 0.25 * counterOut}) translateY(${-counterOut * 80}px)` }}>
        <div style={{ fontFamily: "Inter", fontWeight: 800, fontSize: 150, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: "transparent",
          background: "linear-gradient(180deg,#FFF6DD,#E9C77B 65%,#B88A3A)", WebkitBackgroundClip: "text", filter: "drop-shadow(0 0 30px rgba(233,199,123,0.55))" }}>
          {fmt(200e9 * q)} ₽</div>
        <div style={{ fontFamily: "Playfair Display", fontWeight: 600, fontSize: 46, letterSpacing: "0.16em", color: "#E7ECF7", marginTop: 6 }}>БАНКИ ТРАТЯТ</div>
      </div>
      {/* календарь */}
      {t >= p.tYear && (
        <div style={{ position: "absolute", right: 120, top: 420, width: 210, height: 220, borderRadius: 24, background: "#F4F1EA", boxShadow: "0 30px 60px rgba(0,0,0,0.5)",
          transform: `scale(${calIn * (1 - calOut)}) rotate(${(1 - calIn) * 20}deg)`, overflow: "hidden" }}>
          <div style={{ height: 58, background: "#C8342C", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter", fontWeight: 800, fontSize: 24, color: "#fff", letterSpacing: "0.2em" }}>КАЖДЫЙ ГОД</div>
          <div style={{ fontFamily: "Inter", fontWeight: 800, fontSize: 70, textAlign: "center", marginTop: 34, color: "#1D1D1F",
            transform: `rotateX(${((t - p.tYear) % 0.16) / 0.16 * (yi < 2 ? 80 : 0)}deg)` }}>{years[yi]}</div>
        </div>
      )}
      {/* подпись о клиентах */}
      {t >= p.tAttract && (
        <div style={{ position: "absolute", top: 170, left: 0, right: 0, textAlign: "center", fontFamily: "Playfair Display", fontWeight: 600, fontSize: 82, letterSpacing: "0.06em",
          color: "#FFF4D6", textShadow: "0 0 26px rgba(255,200,110,0.55)", opacity: interpolate(t - p.tAttract, [0.15, 0.35], [0, 1], C),
          transform: `translateY(${interpolate(t - p.tAttract, [0.15, 0.5], [24, 0], { ...C, easing: out })}px)` }}>НА ПРИВЛЕЧЕНИЕ КЛИЕНТОВ</div>
      )}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />
    </AbsoluteFill>
  );
};

// ---------------- 4. «ТЫ» ----------------
export const YouBehind: React.FC<{ dur: number }> = ({ dur }) => {
  const { f, fps, t } = useT();
  const s = sp(f, fps, 0.0, { damping: 12, stiffness: 140, mass: 0.9 });
  const o = interpolate(t, [dur - 0.12, dur], [1, 0], C);
  return (
    <AbsoluteFill style={{ opacity: o }}>
      {/* фон гаснет, луч света сверху */}
      <AbsoluteFill style={{ background: "rgba(5,6,10,0.62)", opacity: Math.min(1, s * 1.5) }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 30% 60% at 50% 30%, rgba(255,226,160,0.35), transparent 70%)", opacity: s }} />
      <div style={{ position: "absolute", top: "6%", left: 0, right: 0, textAlign: "center", fontFamily: "Playfair Display", fontWeight: 800, fontSize: 620, lineHeight: 1,
        color: "transparent", background: "linear-gradient(180deg,#FFF6DD 0%,#E9C77B 60%,#9C7128 100%)", WebkitBackgroundClip: "text",
        transform: `scale(${1.25 - 0.25 * s})`, opacity: Math.min(1, s * 1.4), filter: "drop-shadow(0 0 60px rgba(233,199,123,0.35))" }}>ТЫ</div>
    </AbsoluteFill>
  );
};

/** Поверх человека: связи к клиентам и «+14 000 ₽». cx, cy — точка на груди (доли кадра). */
export const YouLinks: React.FC<{ dur: number; tAttract: number; cx: number; cy: number }> = ({ dur, tAttract, cx, cy }) => {
  const { f, fps, t } = useT();
  const o = interpolate(t, [dur - 0.12, dur], [1, 0], C);
  const nodes = [[0.14, 0.32], [0.86, 0.3], [0.1, 0.72], [0.9, 0.7], [0.27, 0.9], [0.73, 0.9]];
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
        {nodes.map(([x, y], i) => {
          const at = tAttract + i * 0.12; const k = interpolate(t, [at, at + 0.35], [0, 1], { ...C, easing: out });
          const X = x * 1920, Y = y * 1080, CX = cx * 1920, CY = cy * 1080;
          return <line key={i} x1={CX} y1={CY} x2={CX + (X - CX) * k} y2={CY + (Y - CY) * k} stroke={GOLD} strokeWidth={3} strokeDasharray="10 10"
            strokeDashoffset={-f * 2} opacity={0.85} style={{ filter: "drop-shadow(0 0 6px rgba(233,199,123,0.9))" }} />;
        })}
      </svg>
      {nodes.map(([x, y], i) => {
        const at = tAttract + i * 0.12 + 0.3; const s = sp(f, fps, at, { damping: 12, stiffness: 180, mass: 0.6 });
        const up = interpolate(t, [at + 0.1, at + 0.9], [0, 1], { ...C, easing: out });
        return (
          <React.Fragment key={i}>
            <div style={{ position: "absolute", left: x * 1920 - 44, top: y * 1080 - 44, width: 88, height: 88, borderRadius: 44, background: "rgba(255,255,255,0.92)",
              transform: `scale(${s})`, boxShadow: "0 10px 30px rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg viewBox="0 0 40 60" width="40" height="56"><circle cx="20" cy="12" r="9" fill="#1D1D1F" /><path d="M4 58 C5 36 12 28 20 28 C28 28 35 36 36 58 Z" fill="#1D1D1F" /></svg>
            </div>
            <div style={{ position: "absolute", left: x * 1920 - 120, width: 240, top: y * 1080 - 90 - 50 * up, textAlign: "center", fontFamily: "Inter", fontWeight: 800,
              fontSize: 34, color: "#9CF0B4", textShadow: "0 0 16px rgba(156,240,180,0.7), 0 4px 10px rgba(0,0,0,0.6)", opacity: s * (1 - Math.max(0, up - 0.7) / 0.3) }}>+14 000 ₽</div>
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};
