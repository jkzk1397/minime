import React from "react";
import { Interactive, useCurrentFrame } from "remotion";
import { C, FONT, SHADOW_PANEL, tint } from "../theme";
import { PEOPLE, PersonId } from "../data";
import { mix, popIn, prog } from "../anim";

/* ------------------------------------------------------------------ 배경 + 자막 */

export const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      background: `radial-gradient(1200px 700px at 85% -10%, ${C.accentSoft} 0%, ${C.bg} 55%)`,
      fontFamily: FONT,
      color: C.ink,
      letterSpacing: "-0.02em",
    }}
  >
    {children}
  </div>
);

export const Caption: React.FC<{ step: string; text: string; delay?: number }> = ({
  step,
  text,
  delay = 4,
}) => {
  const frame = useCurrentFrame();
  const t = prog(frame, delay, 18);
  return (
    <Interactive.Div
      name="Caption"
      style={{
        position: "absolute",
        left: 160,
        top: 76,
        display: "flex",
        alignItems: "center",
        gap: 24,
        opacity: t,
        translate: `${mix(t, -40, 0)}px 0px`,
      }}
    >
      <div
        style={{
          fontSize: 30,
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
      <div style={{ fontSize: 62, fontWeight: 700, letterSpacing: "-0.035em" }}>{text}</div>
    </Interactive.Div>
  );
};

/* ------------------------------------------------------------------ 브라우저 창 */

export const BrowserFrame: React.FC<{
  children: React.ReactNode;
  enter?: boolean;
  url?: string;
}> = ({ children, enter = false, url = "localhost:8000/?room=demo" }) => {
  const frame = useCurrentFrame();
  const t = enter ? prog(frame, 0, 20) : 1;
  return (
    <div
      style={{
        position: "absolute",
        left: 160,
        top: 200,
        width: 1600,
        height: 820,
        borderRadius: 22,
        background: C.panel,
        boxShadow: SHADOW_PANEL,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        opacity: t,
        translate: `0px ${mix(t, 60, 0)}px`,
      }}
    >
      <div
        style={{
          height: 58,
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 24px",
          background: C.panel2,
          borderBottom: `1px solid ${C.line}`,
        }}
      >
        {["#ff6058", "#ffbd2e", "#28c940"].map((c) => (
          <div key={c} style={{ width: 15, height: 15, borderRadius: 99, background: c }} />
        ))}
        <div
          style={{
            marginLeft: 24,
            height: 36,
            borderRadius: 10,
            background: C.panel,
            boxShadow: `inset 0 0 0 1px ${C.line}`,
            padding: "0 18px",
            display: "flex",
            alignItems: "center",
            fontSize: 19,
            color: C.muted,
            width: 560,
            letterSpacing: 0,
          }}
        >
          {url}
        </div>
      </div>
      <div style={{ flex: 1, position: "relative", display: "flex", minHeight: 0 }}>{children}</div>
    </div>
  );
};

/* ------------------------------------------------------------------ 아바타 */

export const Avatar: React.FC<{
  who: PersonId;
  mini?: boolean;
  size?: number;
  style?: React.CSSProperties;
}> = ({ who, mini = false, size = 52, style }) => {
  const p = PEOPLE[who];
  return (
    <div
      style={{
        width: size,
        height: size,
        flex: "none",
        display: "grid",
        placeItems: "center",
        borderRadius: mini ? size * 0.28 : 999,
        background: mini ? C.panel2 : p.color,
        color: mini ? p.color : "#fff",
        border: mini ? `${Math.max(2, size / 24)}px dashed ${p.color}` : "none",
        fontWeight: 700,
        fontSize: size * 0.4,
        lineHeight: 1,
        ...style,
      }}
    >
      {p.initial}
    </div>
  );
};

/* ------------------------------------------------------------------ 칩 */

export const Chip: React.FC<{
  tone: "ok" | "warn" | "bad" | "info" | "plain" | "accent";
  children: React.ReactNode;
  size?: number;
  style?: React.CSSProperties;
}> = ({ tone, children, size = 20, style }) => {
  const map = {
    ok: [C.ok, C.okSoft],
    warn: [C.warn, C.warnSoft],
    bad: [C.bad, C.badSoft],
    info: [C.info, C.infoSoft],
    plain: [C.muted, C.panel2],
    accent: [C.accent, C.accentSoft],
  } as const;
  const [fg, bg] = map[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: size,
        fontWeight: 700,
        color: fg,
        background: bg,
        borderRadius: 999,
        padding: `${size * 0.22}px ${size * 0.7}px`,
        whiteSpace: "nowrap",
        lineHeight: 1.3,
        ...style,
      }}
    >
      {children}
    </span>
  );
};

/* ------------------------------------------------------------------ 근거 밑줄 */

export const Evidence: React.FC<{ color: string; progress: number; children: React.ReactNode }> = ({
  color,
  progress,
  children,
}) => (
  <span
    style={{
      backgroundImage: `linear-gradient(${tint(color, 45)}, ${tint(color, 45)})`,
      backgroundRepeat: "no-repeat",
      backgroundPosition: "0 100%",
      backgroundSize: `${progress * 100}% 5px`,
      paddingBottom: 2,
    }}
  >
    {children}
  </span>
);

/* ------------------------------------------------------------------ 채팅 */

/** 채팅 영역: 아래 정렬. 새 메시지가 들어오면 위 메시지가 밀려 올라간다 */
export const ChatStack: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({
  children,
  style,
}) => (
  <div
    style={{
      position: "relative",
      flex: 1,
      minWidth: 0,
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-end",
      overflow: "hidden",
      padding: "0 48px 28px",
      background: C.panel,
      ...style,
    }}
  >
    {children}
  </div>
);

/**
 * 메시지 한 줄. at = 등장 프레임, h = 대략적인 높이(밀어 올리기 애니메이션용)
 */
export const ChatMessage: React.FC<{
  who: PersonId;
  kind: "human" | "mini";
  at: number;
  h: number;
  children: React.ReactNode;
  below?: React.ReactNode;
  side?: React.ReactNode;
  threaded?: boolean;
  maxW?: number;
}> = ({ who, kind, at, h, children, below, side, threaded = false, maxW = 980 }) => {
  const frame = useCurrentFrame();
  const grow = prog(frame, at, 12);
  const t = popIn(frame, at + 2, 16);
  const p = PEOPLE[who];
  const mini = kind === "mini";
  return (
    <div style={{ height: grow * h, flex: "none", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          gap: 18,
          alignItems: "flex-start",
          opacity: Math.min(1, t * 1.4),
          translate: `0px ${mix(t, 30, 0)}px`,
          scale: `${mix(Math.min(t, 1), 0.97, 1)}`,
          transformOrigin: "left bottom",
          paddingTop: 22,
        }}
      >
        {threaded ? (
          <div
            style={{
              position: "absolute",
              left: 27,
              top: -6,
              height: 34,
              borderLeft: `3px dashed ${p.color}`,
              opacity: 0.6,
            }}
          />
        ) : null}
        <Avatar who={who} mini={mini} size={56} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, maxWidth: maxW }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 21, fontWeight: 700 }}>
            {mini ? (
              <>
                <span style={{ color: p.color }}>{p.name}의 미니미</span>
                <span
                  style={{
                    fontSize: 16,
                    color: C.muted,
                    border: `1.5px solid ${C.line2}`,
                    borderRadius: 999,
                    padding: "1px 10px",
                    letterSpacing: 0,
                  }}
                >
                  AI
                </span>
              </>
            ) : (
              <span>{p.name}</span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 18 }}>
            <div
              style={{
                padding: "16px 22px",
                borderRadius: "6px 22px 22px 22px",
                background: mini ? tint(p.color, 12) : C.panel,
                border: mini ? `2.5px dashed ${p.color}` : `1.5px solid ${tint(p.color, 55)}`,
                fontSize: 27,
                lineHeight: 1.55,
                color: C.ink,
                fontWeight: 400,
              }}
            >
              {children}
            </div>
            {side}
          </div>
          {below}
        </div>
      </div>
    </div>
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
          left: -28,
          top: -28,
          width: 56,
          height: 56,
          borderRadius: 99,
          border: `3px solid ${C.accent}`,
          opacity: ringOp,
          scale: `${mix(ring, 0.4, 1.3)}`,
        }}
      />
      <svg
        width="40"
        height="40"
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

/* ------------------------------------------------------------------ 토글 스위치 */

export const Switch: React.FC<{ on: number }> = ({ on }) => (
  <div
    style={{
      width: 52,
      height: 30,
      borderRadius: 99,
      flex: "none",
      position: "relative",
      background: `color-mix(in srgb, ${C.accent} ${on * 100}%, ${C.line2})`,
    }}
  >
    <div
      style={{
        position: "absolute",
        top: 3,
        left: 3,
        width: 24,
        height: 24,
        borderRadius: 99,
        background: "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,.3)",
        translate: `${on * 22}px 0px`,
      }}
    />
  </div>
);
