import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CAPTIONS, LINES, PEOPLE } from "../data";
import { Caption, Stage } from "../components/ui";
import { ChatPanel, Msg, SourceCard, Underline } from "../components/chat";
import { Sfx } from "../components/Sfx";
import { prog } from "../anim";
import { ensureFonts } from "../fonts";

ensureFonts();

// 사례: 종원이 A안을 꺼내자, 빠진 두 사람의 미니미가 각자 근거를 들고 답한다
export const S2Proxy: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Stage>
        <Caption step="02" text={CAPTIONS.proxy} />
        <ChatPanel>
          <Msg who="jongwon" at={14} h={150}>
            {LINES.jongwon}
          </Msg>
          <Msg who="hyejung" mini at={56} h={160}>
            {LINES.hyejungMini}
            <Underline color={PEOPLE.hyejung.color} progress={prog(frame, 72, 20)}>
              {LINES.hyejungEvidence}
            </Underline>
          </Msg>
          <Msg who="dongjun" mini at={118} h={160}>
            {LINES.dongjunMini}
            <Underline color={PEOPLE.dongjun.color} progress={prog(frame, 134, 20)}>
              {LINES.dongjunEvidence}
            </Underline>
          </Msg>
        </ChatPanel>
        <SourceCard who="hyejung" at={74} title={LINES.hyejungSource.title} quote={LINES.hyejungSource.quote} style={{ left: 1250, top: 380 }} />
        <SourceCard who="dongjun" at={136} title={LINES.dongjunSource.title} quote={LINES.dongjunSource.quote} style={{ left: 1250, top: 640 }} />
      </Stage>

      <Sfx at={14} name="pop" volume={0.4} />
      <Sfx at={56} name="pop" volume={0.45} />
      <Sfx at={74} name="select" volume={0.45} />
      <Sfx at={118} name="pop" volume={0.45} />
      <Sfx at={136} name="select" volume={0.45} />
    </AbsoluteFill>
  );
};
