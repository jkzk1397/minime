import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CAPTIONS, LINES } from "../data";
import { At, Caption, Stage } from "../components/ui";
import { Bubble, Mark, Tag } from "../components/characters";
import { MeetingTable } from "../components/Table";
import { Sfx } from "../components/Sfx";
import { mix, popIn } from "../anim";
import { C } from "../theme";
import { ensureFonts } from "../fonts";

ensureFonts();

// 한 가지 사례만: 보고서에 없는 걸 물으면, 지어내지 않고 본인에게 넘긴다
export const S3Silence: React.FC = () => {
  const frame = useCurrentFrame();
  const none = popIn(frame, 42, 14);
  return (
    <AbsoluteFill>
      <Stage>
        <Caption step="03" text={CAPTIONS.silence} />
        <MeetingTable
          seats={{ jongwon: "person", hyejung: "minime", jungmin: "person", dongjun: "minime" }}
          mouth={{ hyejung: frame >= 42 ? "zip" : "none" }}
        />
        <Bubble who="jungmin" at={8} tail="top-right" size={44} style={{ right: 1920 - 650, top: 760 }}>
          {LINES.jungminAsk}
        </Bubble>
        <At x={1420} y={300} anchor="center" style={{ opacity: Math.min(1, none * 1.5), scale: `${mix(none, 1.6, 1)}` }}>
          <Tag tone="bad" size={42}>
            <Mark kind="✕" color={C.bad} size={50} />
            {LINES.noEvidence}
          </Tag>
        </At>
        <Bubble who="hyejung" mini at={66} tail="bottom-left" size={44} style={{ left: 1260, top: 380 }}>
          {LINES.silent}
        </Bubble>
      </Stage>

      <Sfx at={8} name="pop" volume={0.4} />
      <Sfx at={42} name="soft-out" volume={0.5} />
      <Sfx at={66} name="question" volume={0.4} />
    </AbsoluteFill>
  );
};
