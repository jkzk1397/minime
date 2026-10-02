import React from "react";
import { C } from "../theme";
import { mix } from "../anim";

/** 준비도 원형 게이지. value 0~1, total 쟁점 수 */
export const ReadinessRing: React.FC<{ value: number; total?: number; size?: number }> = ({
  value,
  total = 3,
  size = 120,
}) => {
  const r = size / 2 - 9;
  const len = 2 * Math.PI * r;
  const done = value >= 0.999;
  const color = done ? C.ok : C.accent;
  const count = Math.round(value * total);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ rotate: "-90deg" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.sunken} strokeWidth={12} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={12}
            strokeLinecap="round"
            strokeDasharray={`${len * value} ${len}`}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            fontSize: size * 0.27,
            fontWeight: 700,
            color,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: 0,
          }}
        >
          {count}/{total}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 20, color: C.muted, fontWeight: 600 }}>준비도</div>
        <div style={{ fontSize: 26, fontWeight: 700, color, opacity: mix(value, 0.7, 1) }}>
          {done ? "대리 참석 가능" : "준비 중"}
        </div>
      </div>
    </div>
  );
};
