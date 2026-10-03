import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CAPTIONS, LINES } from "../data";
import { At, Caption, Stage } from "../components/ui";
import { Magnifier, Mark, Minime, Tag } from "../components/characters";
import { ChatPanel, Msg } from "../components/chat";
import { Sfx } from "../components/Sfx";
import { mix, popIn, prog } from "../anim";
import { C } from "../theme";
import { ensureFonts } from "../fonts";

ensureFonts();

const CHECK_AT = [56, 68, 80];
const STAMP_AT = 100;

// 사례: 정민이 'B안 확정'을 외치면, 정민의 미니미가 검증하고 불참자 몫이라 보류된다
export const S4Verify: React.FC = () => {
  const frame = useCurrentFrame();
  const mini = popIn(frame, 18, 16);
  const scan = prog(frame, 28, 24);
  const stamp = popIn(frame, STAMP_AT, 10);
  const sub = popIn(frame, STAMP_AT + 12, 12);

  return (
    <AbsoluteFill>
      <Stage>
        <Caption step="04" text={CAPTIONS.verify} />
        <ChatPanel>
          <Msg who="hyejung" mini at={-100} h={150} dim>
            {LINES.silent}
          </Msg>
          <Msg
            who="jungmin"
            at={8}
            h={230}
            side={
              <div
                style={{
                  opacity: Math.min(1, stamp * 2),
                  scale: `${mix(stamp, 2.4, 1)}`,
                  rotate: "-10deg",
                  padding: "6px 30px",
                  borderRadius: 22,
                  border: `7px solid ${C.warn}`,
                  color: C.warn,
                  background: "rgba(252,241,220,.95)",
                  fontSize: 64,
                  fontWeight: 800,
                  letterSpacing: "0.05em",
                  marginLeft: -24,
                }}
              >
                {LINES.hold}
              </div>
            }
            below={
              <div style={{ opacity: Math.min(1, sub * 1.5), display: "flex", alignItems: "center", gap: 12, fontSize: 28, fontWeight: 700, color: C.ink2 }}>
                <Minime who="hyejung" size={48} />
                <Minime who="dongjun" size={48} />
                {LINES.holdSub}
              </div>
            }
          >
            {LINES.decision}
          </Msg>
        </ChatPanel>

        {/* 정민의 미니미가 돋보기로 확인 */}
        <At x={1500} y={480} style={{ opacity: Math.min(1, mini * 1.5), scale: `${mix(mini, 0.5, 1)}` }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <Minime who="jungmin" size={160} blinkAt={[60]} />
            <div style={{ fontSize: 28, fontWeight: 700, color: C.ink2 }}>{LINES.checker}</div>
          </div>
        </At>
        {frame >= 26 && frame < 56 ? (
          <At x={mix(scan, 1400, 520)} y={mix(scan, 380, 830) + Math.sin(scan * Math.PI * 3) * 20} anchor="center" style={{ opacity: 1 - prog(frame, 50, 6), zIndex: 20 }}>
            <Magnifier size={120} color={C.ink2} />
          </At>
        ) : null}
        <div style={{ position: "absolute", left: 1260, top: 540, display: "flex", flexDirection: "column", gap: 18, alignItems: "flex-start" }}>
          {LINES.checks.map((c, i) => {
            const t = popIn(frame, CHECK_AT[i], 14);
            const color = c.tone === "warn" ? C.warn : C.info;
            return (
              <div key={c.text} style={{ opacity: Math.min(1, t * 1.5), translate: `${mix(t, 40, 0)}px 0px` }}>
                <Tag tone={c.tone as "warn" | "info"} size={34}>
                  <Mark kind={c.mark as "!" | "?"} color={color} size={40} />
                  {c.text}
                </Tag>
              </div>
            );
          })}
        </div>
      </Stage>

      <Sfx at={8} name="pop" volume={0.4} />
      <Sfx at={26} name="slide" volume={0.3} />
      {CHECK_AT.map((f) => (
        <Sfx key={f} at={f} name="select" volume={0.4} />
      ))}
      <Sfx at={STAMP_AT} name="stamp" volume={0.6} />
    </AbsoluteFill>
  );
};
