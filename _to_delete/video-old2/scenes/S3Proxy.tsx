import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CAPTIONS, CHAT, PEOPLE, ROOM } from "../data";
import { BrowserFrame, Caption, ChatMessage, ChatStack, Evidence, Stage } from "../components/ui";
import { Sidebar } from "../components/Sidebar";
import { ChatHeader, GateMeter, ModeChip, SourceChip } from "../components/Room";
import { prog } from "../anim";
import { Sfx } from "../components/Sfx";
import { ensureFonts } from "../fonts";

ensureFonts();

export const S3Proxy: React.FC = () => {
  const frame = useCurrentFrame();
  const hj = PEOPLE.hyejung.color;
  const dj = PEOPLE.dongjun.color;
  return (
    <AbsoluteFill>
      <Stage>
        <Caption step="03" text={CAPTIONS.s3} />
        <BrowserFrame>
          <Sidebar awayAt={10} />
          <ChatStack>
            <ChatHeader title={ROOM.issues[0]} right={frame > 20 ? <ModeChip /> : null} />
            <ChatMessage who="jongwon" kind="human" at={28} h={170}>
              {CHAT.jongwonA}
            </ChatMessage>
            <ChatMessage
              who="hyejung"
              kind="mini"
              at={64}
              h={226}
              side={<GateMeter at={70} value={0.82} color={hj} />}
              below={<SourceChip at={104} color={hj}>보고서 2문단 · 만족도 조사</SourceChip>}
            >
              {CHAT.hyejungMiniLead}
              <Evidence color={hj} progress={prog(frame, 82, 22)}>
                {CHAT.hyejungMiniEvidence}
              </Evidence>
              {CHAT.hyejungMiniTail}
            </ChatMessage>
            <ChatMessage
              who="dongjun"
              kind="mini"
              at={128}
              h={226}
              threaded
              side={<GateMeter at={134} value={0.71} color={dj} />}
              below={<SourceChip at={166} color={dj}>보고서 2·3문단 · 예상 반론</SourceChip>}
            >
              {CHAT.dongjunMiniLead}
              <Evidence color={dj} progress={prog(frame, 144, 22)}>
                {CHAT.dongjunMiniEvidence}
              </Evidence>
            </ChatMessage>
          </ChatStack>
        </BrowserFrame>
      </Stage>
      <Sfx at={10} name="toggle" volume={0.45} />
      <Sfx at={64} name="pop" volume={0.45} />
      <Sfx at={128} name="pop" volume={0.45} />
    </AbsoluteFill>
  );
};
