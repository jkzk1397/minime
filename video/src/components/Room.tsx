import React from "react";
import { useCurrentFrame } from "remotion";
import { C } from "../theme";
import { Chip } from "./ui";
import { mix, popIn, prog } from "../anim";

/** 채팅 영역 위쪽 제목줄 */
export const ChatHeader: React.FC<{ title: string; right?: React.ReactNode }> = ({ title, right }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      top: 0,
      height: 84,
      zIndex: 5,
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "0 48px",
      background: "linear-gradient(#fff 70%, rgba(255,255,255,0))",
    }}
  >
    <span style={{ fontSize: 26, color: C.faint, fontWeight: 600 }}>#</span>
    <span style={{ fontSize: 26, fontWeight: 700 }}>{title}</span>
    <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>{right}</div>
  </div>
);

/** 출처 칩 (근거 문단) */
export const SourceChip: React.FC<{ at: number; color: string; children: React.ReactNode }> = ({
  at,
  color,
  children,
}) => {
  const frame = useCurrentFrame();
  const t = popIn(frame, at, 14);
  return (
    <div style={{ display: "flex", gap: 10, opacity: Math.min(1, t * 1.5), scale: `${mix(t, 0.6, 1)}`, transformOrigin: "left center" }}>
      <span
        style={{
          fontSize: 18,
          fontWeight: 700,
          color,
          border: `1.5px solid ${color}`,
          borderRadius: 999,
          padding: "3px 14px",
          background: "#fff",
        }}
      >
        출처 · {children}
      </span>
    </div>
  );
};

/** 개입 점수 막대 */
export const GateMeter: React.FC<{ at: number; value: number; color: string }> = ({ at, value, color }) => {
  const frame = useCurrentFrame();
  const t = prog(frame, at, 26);
  const show = prog(frame, at - 6, 8);
  return (
    <div
      style={{
        opacity: show,
        width: 170,
        flex: "none",
        padding: "12px 16px",
        borderRadius: 16,
        background: C.panel2,
        boxShadow: `inset 0 0 0 1px ${C.line}`,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, color: C.muted, fontWeight: 600 }}>
        <span>개입 점수</span>
        <span style={{ fontVariantNumeric: "tabular-nums", color: C.ink, fontWeight: 700, letterSpacing: 0 }}>
          {(value * t).toFixed(2)}
        </span>
      </div>
      <div style={{ height: 12, borderRadius: 99, background: C.sunken, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${value * t * 100}%`, background: color, borderRadius: 99 }} />
        <div style={{ position: "absolute", left: "35%", top: -2, bottom: -2, borderLeft: `2px dashed ${C.faint}` }} />
      </div>
    </div>
  );
};

export const ModeChip = () => (
  <Chip tone="accent" size={18}>
    미니미 2명 대리 참석 중
  </Chip>
);
