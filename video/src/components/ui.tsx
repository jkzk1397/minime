import React from "react";
import { Interactive, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";
import { mix, prog } from "../anim";

/* ------------------------------------------------------------------ 배경 */

export const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      background: `radial-gradient(1200px 700px at 85% -10%, ${C.accentSoft} 0%, ${C.bg} 55%)`,
      fontFamily: FONT,
      color: C.ink,
      letterSpacing: "-0.02em",
      overflow: "hidden",
    }}
  >
    {children}
  </div>
);

/* ------------------------------------------------------------------ 자막 */

export const Caption: React.FC<{ step?: string; text: string; delay?: number; out?: number }> = ({
  step,
  text,
  delay = 10,
  out,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  // 장면 전환(12프레임) 동안 앞뒤 자막이 겹치지 않도록 끝나기 전에 미리 사라진다
  const end = out ?? durationInFrames - 16;
  const t = prog(frame, delay, 18) * (1 - prog(frame, end, 8));
  return (
    <Interactive.Div
      name="Caption"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 80,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 24,
        opacity: t,
        translate: `0px ${mix(t, -24, 0)}px`,
        zIndex: 40,
      }}
    >
      {step ? (
        <div
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: C.accent,
            background: C.accentSoft,
            borderRadius: 999,
            padding: "6px 20px",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: 0,
          }}
        >
          {step}
        </div>
      ) : null}
      <div style={{ fontSize: 68, fontWeight: 700, letterSpacing: "-0.035em" }}>{text}</div>
    </Interactive.Div>
  );
};

/* ------------------------------------------------------------------ 커서 */

export const Cursor: React.FC<{
  path: { f: number; x: number; y: number }[];
  clickAt?: number[];
}> = ({ path, clickAt = [] }) => {
  const frame = useCurrentFrame();
  let x = path[0].x;
  let y = path[0].y;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (frame >= a.f) {
      const t = prog(frame, a.f, b.f - a.f);
      x = mix(t, a.x, b.x);
      y = mix(t, a.y, b.y);
    }
  }
  const opacity = prog(frame, path[0].f - 8, 8);
  let press = 1;
  let ring = 0;
  let ringOp = 0;
  for (const c of clickAt) {
    if (frame >= c - 3 && frame < c + 4) press = 0.82;
    if (frame >= c && frame < c + 14) {
      ring = prog(frame, c, 14);
      ringOp = 1 - ring;
    }
  }
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity, zIndex: 50, pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: -32,
          top: -32,
          width: 64,
          height: 64,
          borderRadius: 99,
          border: `3px solid ${C.accent}`,
          opacity: ringOp,
          scale: `${mix(ring, 0.4, 1.3)}`,
        }}
      />
      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        style={{ scale: `${press}`, transformOrigin: "0 0", filter: "drop-shadow(0 3px 4px rgba(0,0,0,.25))" }}
      >
        <path
          d="M4 2 L4 19 L8.5 15 L11.5 22 L14.5 20.7 L11.5 14 L18 14 Z"
          fill={C.ink}
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};

/** 중심(x)과 바닥/가운데/위(y) 기준으로 놓기 */
export const At: React.FC<{
  x: number;
  y: number;
  anchor?: "bottom" | "center" | "top";
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ x, y, anchor = "bottom", children, style }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      translate: anchor === "bottom" ? "-50% -100%" : anchor === "center" ? "-50% -50%" : "-50% 0%",
      ...style,
    }}
  >
    {children}
  </div>
);
