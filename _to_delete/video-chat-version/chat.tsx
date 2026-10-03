import React from "react";
import { useCurrentFrame } from "remotion";
import { C, tint } from "../theme";
import { LINES, PEOPLE, PersonId } from "../data";
import { mix, popIn, prog } from "../anim";
import { DocIcon, Face, Minime } from "./characters";

export const PANEL = { x: 110, y: 210, w: 1080, h: 800 };

/** 회의 채팅방 (앱 화면을 단순화한 카드) */
export const ChatPanel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      position: "absolute",
      left: PANEL.x,
      top: PANEL.y,
      width: PANEL.w,
      height: PANEL.h,
      borderRadius: 36,
      background: "#fff",
      boxShadow: `0 0 0 1px rgba(40,30,80,.05), 0 30px 60px -30px rgba(40,30,80,.35)`,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
    }}
  >
    <div
      style={{
        height: 96,
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0 40px",
        borderBottom: `1px solid ${C.line}`,
        background: C.panel2,
      }}
    >
      <span style={{ fontSize: 32, color: C.faint, fontWeight: 600 }}>#</span>
      <span style={{ fontSize: 32, fontWeight: 700 }}>{LINES.topic}</span>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        <Face who="jongwon" size={46} />
        <Face who="jungmin" size={46} />
        <Minime who="hyejung" size={52} />
        <Minime who="dongjun" size={52} />
      </div>
    </div>
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        overflow: "hidden",
        padding: "0 44px 36px",
      }}
    >
      {children}
    </div>
  </div>
);

/** 채팅 한 줄. at = 등장 프레임, h = 대략 높이(위로 밀어 올리기용) */
export const Msg: React.FC<{
  who: PersonId;
  mini?: boolean;
  at: number;
  h: number;
  children: React.ReactNode;
  below?: React.ReactNode;
  side?: React.ReactNode;
  dim?: boolean;
}> = ({ who, mini = false, at, h, children, below, side, dim = false }) => {
  const frame = useCurrentFrame();
  const grow = prog(frame, at, 12);
  const t = popIn(frame, at + 2, 16);
  const p = PEOPLE[who];
  return (
    <div style={{ height: grow * h, flex: "none", position: "relative", opacity: dim ? 0.45 : 1 }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          gap: 20,
          alignItems: "flex-start",
          opacity: Math.min(1, t * 1.4),
          translate: `0px ${mix(t, 30, 0)}px`,
        }}
      >
        {mini ? <Minime who={who} size={76} /> : <Face who={who} size={70} />}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 26, fontWeight: 700 }}>
            {mini ? (
              <>
                <span style={{ color: p.color }}>{p.name}의 미니미</span>
                <span
                  style={{
                    fontSize: 18,
                    color: C.muted,
                    border: `2px solid ${C.line2}`,
                    borderRadius: 999,
                    padding: "0 10px",
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
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div
              style={{
                padding: "16px 26px",
                borderRadius: "8px 28px 28px 28px",
                background: mini ? tint(p.color, 13) : "#fff",
                border: mini ? `3px dashed ${p.color}` : `2px solid ${tint(p.color, 55)}`,
                fontSize: 36,
                fontWeight: 600,
                lineHeight: 1.45,
                whiteSpace: "nowrap",
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

/** 근거 밑줄 */
export const Underline: React.FC<{ color: string; progress: number; children: React.ReactNode }> = ({
  color,
  progress,
  children,
}) => (
  <span
    style={{
      color,
      backgroundImage: `linear-gradient(${tint(color, 45)}, ${tint(color, 45)})`,
      backgroundRepeat: "no-repeat",
      backgroundPosition: "0 100%",
      backgroundSize: `${progress * 100}% 7px`,
      paddingBottom: 2,
    }}
  >
    {children}
  </span>
);

/** 오른쪽에 뜨는 '근거 카드': 문서 아이콘 + 인용 한 줄 */
export const SourceCard: React.FC<{ who: PersonId; at: number; title: string; quote: string; style?: React.CSSProperties }> = ({
  who,
  at,
  title,
  quote,
  style,
}) => {
  const frame = useCurrentFrame();
  const t = popIn(frame, at, 16);
  const hl = prog(frame, at + 10, 16);
  const color = PEOPLE[who].color;
  return (
    <div
      style={{
        position: "absolute",
        width: 560,
        padding: "26px 30px",
        borderRadius: 30,
        background: "#fff",
        boxShadow: `inset 0 0 0 3px ${tint(color, 45)}, 0 24px 40px -26px rgba(40,30,80,.4)`,
        display: "flex",
        gap: 24,
        alignItems: "center",
        opacity: Math.min(1, t * 1.5),
        translate: `${mix(t, 60, 0)}px 0px`,
        ...style,
      }}
    >
      <DocIcon size={86} color={color} highlight={1} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: C.muted }}>근거 · {title}</div>
        <div
          style={{
            fontSize: 32,
            fontWeight: 700,
            backgroundImage: `linear-gradient(${tint(color, 30)}, ${tint(color, 30)})`,
            backgroundRepeat: "no-repeat",
            backgroundSize: `${hl * 100}% 100%`,
            borderRadius: 6,
            padding: "2px 6px",
            whiteSpace: "nowrap",
          }}
        >
          {quote}
        </div>
      </div>
    </div>
  );
};
