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
          <Sidebar awayAt={12} />
          <ChatStack>
            <ChatHeader title={ROOM.issues[0]} right={frame > 24 ? <ModeChip /> : null} />
            <ChatMessage who="jongwon" kind="human" at={38} h={170}>
              {CHAT.jongwonA}
            </ChatMessage>
            <ChatMessage
              who="hyejung"
              kind="mini"
              at={86}
              h={226}
              side={<GateMeter at={92} value={0.82} color={hj} />}
              below={<SourceChip at={132} color={hj}>보고서 2문단 · 만족도 조사</SourceChip>}
            >
              {CHAT.hyejungMiniLead}
              <Evidence color={hj} progress={prog(frame, 106, 26)}>
                {CHAT.hyejungMiniEvidence}
              </Evidence>
              {CHAT.hyejungMiniTail}
            </ChatMessage>
            <ChatMessage
              who="dongjun"
              kind="mini"
              at={156}
              h={226}
              threaded
              side={<GateMeter at={162} value={0.71} color={dj} />}
              below={<SourceChip at={196} color={dj}>보고서 2·3문단 · 예상 반론</SourceChip>}
            >
              {CHAT.dongjunMiniLead}
              <Evidence color={dj} progress={prog(frame, 174, 24)}>
                {CHAT.dongjunMiniEvidence}
              </Evidence>
            </ChatMessage>
          </ChatStack>
        </BrowserFrame>
      </Stage>
      <Sfx at={12} name="toggle" volume={0.6} />
      <Sfx at={20} name="toggle" volume={0.6} />
      <Sfx at={38} name="pop" volume={0.55} />
      <Sfx at={86} name="pop" volume={0.55} />
      <Sfx at={132} name="select" volume={0.5} />
      <Sfx at={156} name="pop" volume={0.55} />
      <Sfx at={196} name="select" volume={0.5} />
    </AbsoluteFill>
  );
};
