import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CAPTIONS, LINES, PEOPLE } from "../data";
import { At, Caption, Stage } from "../components/ui";
import { Bubble, DocIcon, Magnifier, Mark, Minime, Tag } from "../components/characters";
import { MeetingTable } from "../components/Table";
import { Sfx } from "../components/Sfx";
import { mix, popIn, prog } from "../anim";
import { C } from "../theme";
import { ensureFonts } from "../fonts";

ensureFonts();

const HJ = PEOPLE.hyejung.color;
const TRAY = { x: 1690, y: 470 };

export const S3Silence: React.FC = () => {
  const frame = useCurrentFrame();
  const docIn = popIn(frame, 28, 14);
  const scan = prog(frame, 34, 28);
  const mag = { x: 1360 + Math.sin(scan * Math.PI * 2) * 50, y: 300 + scan * 60 };
  const fail = popIn(frame, 64, 14);
  const trayIn = popIn(frame, 70, 14);
  const note = popIn(frame, 78, 12);
  const fly = prog(frame, 90, 20);
  const nx = mix(fly, 1330, TRAY.x);
  const ny = mix(fly, 560, TRAY.y - 20) - Math.sin(Math.PI * fly) * 80;
  const landed = frame >= 110;

  return (
    <AbsoluteFill>
      <Stage>
        <Caption step="03" text={CAPTIONS.silence} />
        <MeetingTable
          seats={{ jongwon: "person", hyejung: "minime", jungmin: "person", dongjun: "minime" }}
          mouth={{ hyejung: frame >= 64 ? "zip" : "none" }}
        />
        <Bubble who="jungmin" at={8} tail="top-right" style={{ right: 1920 - 650, top: 760 }}>
          {LINES.jungminAsk}
        </Bubble>

        {/* 보고서를 뒤져 보지만 없음 */}
        <At x={1390} y={340} anchor="center" style={{ opacity: docIn, scale: `${mix(docIn, 0.6, 1)}` }}>
          <DocIcon size={120} />
        </At>
        {frame >= 30 && frame < 70 ? (
          <At x={mag.x} y={mag.y} anchor="center" style={{ opacity: 1 - prog(frame, 62, 8) }}>
            <Magnifier size={100} color={C.ink2} />
          </At>
        ) : null}
        <At x={1390} y={340} anchor="center" style={{ opacity: Math.min(1, fail * 1.5), scale: `${mix(fail, 1.6, 1)}` }}>
          <Mark kind="✕" color={C.bad} size={86} />
        </At>
        <At x={1390} y={440} anchor="top" style={{ opacity: Math.min(1, fail * 1.5) }}>
          <Tag tone="bad" size={30}>
            {LINES.noEvidence}
          </Tag>
        </At>

        {/* 물어볼 것 상자 */}
        <At x={TRAY.x} y={TRAY.y} anchor="center" style={{ opacity: trayIn, scale: `${mix(trayIn, 0.6, 1) * (landed ? 1 + 0.06 * Math.sin(Math.PI * prog(frame, 110, 8)) : 1)}` }}>
          <div
            style={{
              width: 230,
              height: 200,
              borderRadius: 28,
              background: "#fff",
              boxShadow: `inset 0 0 0 3px ${HJ}, 0 18px 34px -20px rgba(40,30,80,.4)`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              position: "relative",
            }}
          >
            <Minime who="hyejung" size={80} />
            <div style={{ fontSize: 24, fontWeight: 700, color: HJ, textAlign: "center", lineHeight: 1.25 }}>{LINES.tray}</div>
            {landed ? (
              <div style={{ position: "absolute", right: -14, top: -14, scale: `${popIn(frame, 110, 12)}` }}>
                <Mark kind="?" color={C.warn} size={48} />
              </div>
            ) : null}
          </div>
        </At>

        {/* 질문 쪽지 */}
        {frame >= 78 && !landed ? (
          <At x={nx} y={ny} anchor="center" style={{ opacity: Math.min(1, note * 1.5), scale: `${mix(note, 0.5, 1) * mix(fly, 1, 0.5)}`, zIndex: 30 }}>
            <Tag tone="warn" size={32}>
              <Mark kind="?" color={C.warn} size={38} />
              {LINES.questionNote}
            </Tag>
          </At>
        ) : null}
      </Stage>

      <Sfx at={8} name="pop" volume={0.4} />
      <Sfx at={34} name="slide" volume={0.3} />
      <Sfx at={64} name="soft-out" volume={0.45} />
      <Sfx at={88} name="question" volume={0.45} />
    </AbsoluteFill>
  );
};
