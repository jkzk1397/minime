import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CAPTIONS, LINES } from "../data";
import { At, Caption, Stage } from "../components/ui";
import { Magnifier, Mark, Minime, Person, Tag } from "../components/characters";
import { Sfx } from "../components/Sfx";
import { mix, popIn, prog } from "../anim";
import { C } from "../theme";
import { ensureFonts } from "../fonts";

ensureFonts();

const CHECK_AT = [58, 72, 86];

export const S4Verify: React.FC = () => {
  const frame = useCurrentFrame();
  const card = popIn(frame, 6, 16);
  const mini = popIn(frame, 24, 16);
  const scan = prog(frame, 32, 24);
  const stamp = popIn(frame, 102, 10);
  const shake = frame >= 102 && frame < 110 ? Math.sin(frame * 3) * 6 : 0;
  const sub = popIn(frame, 116, 14);

  return (
    <AbsoluteFill>
      <Stage>
        <Caption step="04" text={CAPTIONS.verify} />

        {/* 결론 카드 */}
        <At x={900} y={470} anchor="center" style={{ opacity: Math.min(1, card * 1.5), scale: `${mix(card, 0.7, 1)}`, translate: `calc(-50% + ${shake}px) -50%` }}>
          <div
            style={{
              width: 860,
              height: 230,
              borderRadius: 40,
              background: "#fff",
              boxShadow: `inset 0 0 0 3px ${C.line2}, 0 30px 50px -30px rgba(40,30,80,.4)`,
              display: "flex",
              alignItems: "center",
              gap: 36,
              padding: "0 50px",
              position: "relative",
              overflow: "visible",
            }}
          >
            <Person who="jungmin" size={180} style={{ marginTop: 20 }} />
            <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: "-0.04em" }}>{LINES.decision}</div>

            {/* 보류 도장 */}
            <div
              style={{
                position: "absolute",
                right: -130,
                top: -80,
                opacity: Math.min(1, stamp * 2),
                scale: `${mix(stamp, 2.4, 1)}`,
                rotate: "-12deg",
                padding: "10px 40px",
                borderRadius: 26,
                border: `8px solid ${C.warn}`,
                color: C.warn,
                background: "rgba(252,241,220,.92)",
                fontSize: 96,
                fontWeight: 800,
                letterSpacing: "0.05em",
              }}
            >
              {LINES.hold}
            </div>
          </div>
        </At>

        {/* 정민의 미니미가 돋보기로 확인 */}
        <At x={1560} y={720} style={{ opacity: Math.min(1, mini * 1.5), scale: `${mix(mini, 0.5, 1)}` }}>
          <Minime who="jungmin" size={170} label blinkAt={[60]} />
        </At>
        {frame >= 30 && frame < 62 ? (
          <At x={mix(scan, 560, 1180)} y={470 + Math.sin(scan * Math.PI * 3) * 30} anchor="center" style={{ opacity: 1 - prog(frame, 56, 6), zIndex: 20 }}>
            <Magnifier size={130} color={C.ink2} />
          </At>
        ) : null}

        {/* 검증 결과 */}
        <div style={{ position: "absolute", left: 0, right: 420, top: 660, display: "flex", justifyContent: "center", gap: 24 }}>
          {LINES.checks.map((c, i) => {
            const t = popIn(frame, CHECK_AT[i], 14);
            const color = c.tone === "warn" ? C.warn : C.info;
            return (
              <div key={c.text} style={{ opacity: Math.min(1, t * 1.5), scale: `${mix(t, 0.5, 1)}` }}>
                <Tag tone={c.tone as "warn" | "info"} size={34}>
                  <Mark kind={c.mark as "!" | "?"} color={color} size={40} />
                  {c.text}
                </Tag>
              </div>
            );
          })}
        </div>

        <At x={750} y={800} anchor="top" style={{ opacity: Math.min(1, sub * 1.5), translate: `-50% ${mix(sub, 20, 0)}px` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 34, fontWeight: 700, color: C.ink2 }}>
            <Minime who="hyejung" size={64} />
            <Minime who="dongjun" size={64} />
            {LINES.holdSub}
          </div>
        </At>
      </Stage>

      <Sfx at={6} name="pop" volume={0.4} />
      <Sfx at={30} name="slide" volume={0.3} />
      {CHECK_AT.map((f) => (
        <Sfx key={f} at={f} name="select" volume={0.4} />
      ))}
      <Sfx at={102} name="stamp" volume={0.6} />
    </AbsoluteFill>
  );
};
