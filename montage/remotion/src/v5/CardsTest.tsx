import React from "react";
import { AbsoluteFill } from "remotion";
import { CardsLayer } from "./CardsLayer";
export const CARDS_EV = { debit: 70.069, invest: 71.189, ip: 72.81, hit: 73.45, out: 74.001 };
export const CardsTest: React.FC = () => (
  <AbsoluteFill style={{ background: "#556" }}><CardsLayer t0={70.0} ev={CARDS_EV} samples={1} /></AbsoluteFill>
);
