import React from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";
import { C, tint } from "../theme";
import { PEOPLE, PersonId } from "../data";
import { mix, popIn, prog } from "../anim";

/* ------------------------------------------------------------------ 사람 실루엣 */

/** 사진을 쓸지(true) 실루엣을 쓸지(false). MinimeVideo의 photos prop으로 정한다 */
export const PhotoContext = React.createContext(false);

/** 머리 + 어깨 실루엣 (사람 색) */
const Silhouette: React.FC<{ who: PersonId; size: number; dim: number }> = ({
  who,
  size,
  dim,
}) => (
  <svg
    width={size * (100 / 140)}
    height={size}
    viewBox="0 0 100 140"
    style={{ overflow: "visible", opacity: 1 - dim * 0.6 }}
  >
    <circle cx="50" cy="32" r="25" fill={PEOPLE[who].color} />
    <path
      d="M6 140 C6 92 24 70 50 70 C76 70 94 92 94 140 Z"
      fill={PEOPLE[who].color}
    />
  </svg>
);

/** 팀원: 실루엣 또는 사진(배경 없는 컷아웃). size = 높이(px) */
export const Person: React.FC<{
  who: PersonId;
  size?: number;
  label?: boolean;
  style?: React.CSSProperties;
  dim?: number;
}> = ({ who, size = 200, label = false, style, dim = 0 }) => {
  const p = PEOPLE[who];
  const photos = React.useContext(PhotoContext);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: size * 0.04,
        ...style,
      }}
    >
      {photos ? (
        <Img
          src={staticFile(`people/${who}.png`)}
          style={{
            height: size,
            width: "auto",
            opacity: 1 - dim * 0.6,
            maskImage: "linear-gradient(to bottom, #000 78%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, #000 78%, transparent 100%)",
          }}
        />
      ) : (
        <Silhouette who={who} size={size} dim={dim} />
      )}
      {label ? (
        <div
          style={{
            fontSize: Math.max(26, size * 0.16),
            fontWeight: 700,
            color: C.ink,
            opacity: 1 - dim * 0.5,
          }}
        >
          {p.name}
        </div>
      ) : null}
    </div>
  );
};

/** 동그란 아바타: 사진이면 얼굴, 아니면 사람 색 원 안에 작은 실루엣 */
export const Face: React.FC<{
  who: PersonId;
  size?: number;
  style?: React.CSSProperties;
}> = ({ who, size = 64, style }) => {
  const photos = React.useContext(PhotoContext);
  return (
    <div
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: 999,
        overflow: "hidden",
        background: tint(PEOPLE[who].color, 18),
        boxShadow: `0 0 0 ${Math.max(3, size / 22)}px ${PEOPLE[who].color}`,
        ...style,
      }}
    >
      {photos ? (
        <Img
          src={staticFile(`people/${who}-face.png`)}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "grid",
            placeItems: "end center",
            background: "#fff",
          }}
        >
          <Silhouette who={who} size={size * 0.85} dim={0} />
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ 미니미 캐릭터 */

/** 로고의 말풍선 캐릭터를 주인 색 점선으로. size = 너비(px) */
export const Minime: React.FC<{
  who: PersonId;
  size?: number;
  label?: boolean;
  blinkAt?: number[];
  mouth?: "none" | "zip";
  style?: React.CSSProperties;
}> = ({
  who,
  size = 140,
  label = false,
  blinkAt = [],
  mouth = "none",
  style,
}) => {
  const frame = useCurrentFrame();
  const p = PEOPLE[who];
  let eye = 1;
  for (const b of blinkAt) if (frame >= b && frame < b + 5) eye = 0.15;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: size * 0.06,
        ...style,
      }}
    >
      <svg
        width={size}
        height={size * (110 / 120)}
        viewBox="0 0 120 110"
        style={{ overflow: "visible" }}
      >
        {/* 반짝 선 (로고처럼) */}
        <path
          d="M96 4 L103 -6 M106 14 L117 9"
          stroke={p.color}
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="M30 8 H90 A28 28 0 0 1 118 36 V58 A28 28 0 0 1 90 86 H44 L22 104 L26 84 A28 28 0 0 1 2 58 V36 A28 28 0 0 1 30 8 Z"
          fill={tint(p.color, 20)}
          stroke={p.color}
          strokeWidth="4.5"
          strokeDasharray="9 7"
          strokeLinejoin="round"
        />
        <rect
          x="26"
          y="26"
          width="68"
          height="42"
          rx="21"
          fill="#ffffff"
          opacity="0.9"
        />
        <g
          style={{ transformOrigin: "60px 47px", transform: `scaleY(${eye})` }}
        >
          <rect x="43" y="35" width="10" height="22" rx="5" fill={C.ink} />
          <rect x="67" y="35" width="10" height="22" rx="5" fill={C.ink} />
        </g>
        {mouth === "zip" ? (
          <path
            d="M44 76 H76"
            stroke={C.ink2}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="3 5"
          />
        ) : null}
      </svg>
      {label ? (
        <div
          style={{
            fontSize: Math.max(24, size * 0.18),
            fontWeight: 700,
            color: p.color,
            whiteSpace: "nowrap",
          }}
        >
          {p.name}의 미니미
        </div>
      ) : null}
    </div>
  );
};

/* ------------------------------------------------------------------ 말풍선 */

export const Bubble: React.FC<{
  who: PersonId;
  mini?: boolean;
  at: number;
  children: React.ReactNode;
  tail?: "bottom-left" | "bottom-right" | "top-left" | "top-right";
  size?: number;
  style?: React.CSSProperties;
  out?: number;
}> = ({
  who,
  mini = false,
  at,
  children,
  tail = "bottom-left",
  size = 38,
  style,
  out,
}) => {
  const frame = useCurrentFrame();
  const t = popIn(frame, at, 16);
  const o = out !== undefined ? 1 - prog(frame, out, 10) : 1;
  const p = PEOPLE[who];
  const bottom = tail.startsWith("bottom");
  const left = tail.endsWith("left");
  return (
    <div
      style={{
        position: "absolute",
        opacity: Math.min(1, t * 1.6) * o,
        scale: `${mix(t, 0.5, 1)}`,
        transformOrigin: `${left ? "0%" : "100%"} ${bottom ? "100%" : "0%"}`,
        padding: `${size * 0.42}px ${size * 0.7}px`,
        borderRadius: size * 0.9,
        background: mini ? tint(p.color, 14) : "#fff",
        border: mini
          ? `4px dashed ${p.color}`
          : `3px solid ${tint(p.color, 60)}`,
        boxShadow: "0 14px 30px -18px rgba(40,30,80,.4)",
        fontSize: size,
        fontWeight: 700,
        color: C.ink,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
      <div
        style={{
          position: "absolute",
          [bottom ? "bottom" : "top"]: -16,
          [left ? "left" : "right"]: 40,
          width: 28,
          height: 28,
          background: mini ? tint(p.color, 14) : "#fff",
          borderRight: mini
            ? `4px dashed ${p.color}`
            : `3px solid ${tint(p.color, 60)}`,
          borderBottom: mini
            ? `4px dashed ${p.color}`
            : `3px solid ${tint(p.color, 60)}`,
          rotate: bottom ? "45deg" : "225deg",
        }}
      />
    </div>
  );
};

/* ------------------------------------------------------------------ 아이콘 */

/** 보고서 문서 아이콘 */
export const DocIcon: React.FC<{
  size?: number;
  color?: string;
  lines?: number;
  highlight?: number;
  style?: React.CSSProperties;
}> = ({ size = 120, color = C.ink2, lines = 4, highlight = -1, style }) => (
  <svg width={size} height={size * 1.25} viewBox="0 0 80 100" style={style}>
    <path
      d="M8 4 H54 L74 24 V94 A4 4 0 0 1 70 98 H8 A4 4 0 0 1 4 94 V8 A4 4 0 0 1 8 4 Z"
      fill="#fff"
      stroke={C.line2}
      strokeWidth="3"
    />
    <path
      d="M54 4 V24 H74"
      fill={C.panel2}
      stroke={C.line2}
      strokeWidth="3"
      strokeLinejoin="round"
    />
    {Array.from({ length: lines }, (_, i) => (
      <rect
        key={i}
        x="14"
        y={36 + i * 14}
        width={i % 2 ? 40 : 52}
        height="7"
        rx="3.5"
        fill={i === highlight ? color : C.line}
      />
    ))}
  </svg>
);

/** 돋보기 */
export const Magnifier: React.FC<{
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}> = ({ size = 90, color = C.ink2, style }) => (
  <svg width={size} height={size} viewBox="0 0 60 60" style={style}>
    <circle
      cx="24"
      cy="24"
      r="16"
      fill="rgba(255,255,255,.6)"
      stroke={color}
      strokeWidth="5"
    />
    <path
      d="M36 36 L54 54"
      stroke={color}
      strokeWidth="7"
      strokeLinecap="round"
    />
  </svg>
);

/** 반짝임 폭발 (변신 연출) */
export const Sparkle: React.FC<{
  at: number;
  x: number;
  y: number;
  color: string;
  size?: number;
}> = ({ at, x, y, color, size = 220 }) => {
  const frame = useCurrentFrame();
  const t = prog(frame, at, 22);
  if (frame < at || t >= 1) return null;
  return (
    <svg
      width={size * 2}
      height={size * 2}
      viewBox="-100 -100 200 200"
      style={{
        position: "absolute",
        left: x - size,
        top: y - size,
        pointerEvents: "none",
        zIndex: 30,
      }}
    >
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        const r1 = mix(t, 20, 70);
        const r2 = mix(t, 34, 92);
        return (
          <line
            key={i}
            x1={Math.cos(a) * r1}
            y1={Math.sin(a) * r1}
            x2={Math.cos(a) * r2}
            y2={Math.sin(a) * r2}
            stroke={i % 2 ? color : "#f2b552"}
            strokeWidth={6 * (1 - t) + 1}
            strokeLinecap="round"
          />
        );
      })}
      <circle
        r={mix(t, 10, 80)}
        fill="none"
        stroke={color}
        strokeWidth={4 * (1 - t)}
        opacity={1 - t}
      />
    </svg>
  );
};

/** 아주 짧은 라벨 칩 (아이콘 + 단어) */
export const Tag: React.FC<{
  tone: "ok" | "warn" | "bad" | "info" | "plain";
  children: React.ReactNode;
  size?: number;
  style?: React.CSSProperties;
}> = ({ tone, children, size = 30, style }) => {
  const map = {
    ok: [C.ok, C.okSoft],
    warn: [C.warn, C.warnSoft],
    bad: [C.bad, C.badSoft],
    info: [C.info, C.infoSoft],
    plain: [C.ink2, C.panel],
  } as const;
  const [fg, bg] = map[tone];
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: `${size * 0.3}px ${size * 0.7}px`,
        borderRadius: 999,
        background: bg,
        color: fg,
        fontSize: size,
        fontWeight: 700,
        whiteSpace: "nowrap",
        boxShadow: tone === "plain" ? `inset 0 0 0 2px ${C.line2}` : "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** 원형 아이콘 마크 (!, ✓, ✕, ?) — 이모지 없이 */
export const Mark: React.FC<{
  kind: "!" | "✓" | "✕" | "?";
  color: string;
  size?: number;
}> = ({ kind, color, size = 34 }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: 999,
      background: color,
      color: "#fff",
      display: "grid",
      placeItems: "center",
      fontSize: size * 0.62,
      fontWeight: 800,
      lineHeight: 1,
      flex: "none",
    }}
  >
    {kind}
  </div>
);
