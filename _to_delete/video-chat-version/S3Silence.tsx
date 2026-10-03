import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CAPTIONS, LINES, PEOPLE } from "../data";
import { At, Caption, Stage } from "../components/ui";
import { DocIcon, Magnifier, Mark, Minime, Tag } from "../components/characters";
import { ChatPanel, Msg, Underline } from "../components/chat";
import { Sfx } from "../components/Sfx";
import { mix, popIn, prog } from "../anim";
import { C } from "../theme";
import { ensureFonts } from "../fonts";

ensureFonts();

const HJ = PEOPLE.hyejung.color;
const DOC = { x: 1500, y: 420 };
const TRAY = { x: 1500, y: 800 };

// 사례: 보고서에 없는 '음향 업체'를 물으면, 지어내지 않고 질문으로 남긴다
export const S3Silence: React.FC = () => {
  const frame = useCurrentFrame();
  const docIn = popIn(frame, 16, 14);
  const scan = prog(frame, 22, 30);
  const fail = popIn(frame, 54, 14);
  const trayIn = popIn(frame, 86, 14);
  const fly = prog(frame, 98, 20);
  const landed = frame >= 118;
  const nx = mix(fly, 1000, TRAY.x);
  const ny = mix(fly, 930, TRAY.y - 30) - Math.sin(Math.PI * fly) * 90;

  return (
    <AbsoluteFill>
      <Stage>
        <Caption step="03" text={CAPTIONS.silence} />
        <ChatPanel>
          <Msg who="dongjun" mini at={-100} h={160} dim>
            {LINES.dongjunMini}
            <Underline color={PEOPLE.dongjun.color} progress={1}>
              {LINES.dongjunEvidence}
            </Underline>
          </Msg>
          <Msg who="jungmin" at={10} h={150}>
            {LINES.jungminAsk}
          </Msg>
          <Msg
            who="hyejung"
            mini
            at={66}
            h={210}
            below={
              <div style={{ opacity: Math.min(1, popIn(frame, 90, 12) * 1.5), scale: `${mix(popIn(frame, 90, 12), 0.6, 1)}`, transformOrigin: "left center" }}>
                <Tag tone="warn" size={26}>
                  <Mark kind="?" color={C.warn} size={30} />
                  {LINES.leftQuestion}
                </Tag>
              </div>
            }
          >
            {LINES.silent}
          </Msg>
        </ChatPanel>

        {/* 보고서를 뒤져 보지만 없음 */}
        <At x={DOC.x} y={DOC.y} anchor="center" style={{ opacity: docIn, scale: `${mix(docIn, 0.6, 1)}` }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <DocIcon size={150} />
            <div style={{ fontSize: 28, fontWeight: 700, color: C.muted }}>혜중 보고서</div>
          </div>
        </At>
        {frame >= 20 && frame < 60 ? (
          <At x={DOC.x - 30 + Math.sin(scan * Math.PI * 2) * 60} y={DOC.y - 60 + scan * 80} anchor="center" style={{ opacity: 1 - prog(frame, 52, 6) }}>
            <Magnifier size={120} color={C.ink2} />
          </At>
        ) : null}
        <At x={DOC.x} y={DOC.y - 30} anchor="center" style={{ opacity: Math.min(1, fail * 1.5), scale: `${mix(fail, 1.6, 1)}` }}>
          <Mark kind="✕" color={C.bad} size={96} />
        </At>
        <At x={DOC.x + 150} y={DOC.y - 120} anchor="center" style={{ opacity: Math.min(1, fail * 1.5) }}>
          <Tag tone="bad" size={30}>
            {LINES.noEvidence}
          </Tag>
        </At>

        {/* 물어볼 것 상자 */}
        <At x={TRAY.x} y={TRAY.y} anchor="center" style={{ opacity: trayIn, scale: `${mix(trayIn, 0.6, 1) * (landed ? 1 + 0.06 * Math.sin(Math.PI * prog(frame, 118, 8)) : 1)}` }}>
          <div
            style={{
              width: 430,
              height: 150,
              borderRadius: 30,
              background: "#fff",
              boxShadow: `inset 0 0 0 3px ${HJ}, 0 18px 34px -20px rgba(40,30,80,.4)`,
              display: "flex",
              alignItems: "center",
              gap: 18,
              padding: "0 26px",
              position: "relative",
            }}
          >
            <Minime who="hyejung" size={80} />
            <div style={{ fontSize: 30, fontWeight: 700, color: HJ, lineHeight: 1.25, whiteSpace: "nowrap" }}>{LINES.tray}</div>
            {landed ? (
              <div style={{ position: "absolute", right: -16, top: -16, scale: `${popIn(frame, 118, 12)}` }}>
                <Mark kind="?" color={C.warn} size={52} />
              </div>
            ) : null}
          </div>
        </At>
        {frame >= 98 && !landed ? (
          <At x={nx} y={ny} anchor="center" style={{ scale: `${mix(fly, 1, 0.6)}`, zIndex: 30 }}>
            <Tag tone="warn" size={30}>
              <Mark kind="?" color={C.warn} size={36} />
              {LINES.questionNote}
            </Tag>
          </At>
        ) : null}
      </Stage>

      <Sfx at={10} name="pop" volume={0.4} />
      <Sfx at={22} name="slide" volume={0.3} />
      <Sfx at={54} name="soft-out" volume={0.45} />
      <Sfx at={66} name="pop" volume={0.4} />
      <Sfx at={96} name="question" volume={0.45} />
    </AbsoluteFill>
  );
};
