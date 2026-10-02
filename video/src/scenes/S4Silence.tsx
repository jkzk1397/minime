import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CAPTIONS, CHAT, PEOPLE, ROOM } from "../data";
import { BrowserFrame, Caption, ChatMessage, ChatStack, Chip, Evidence, Stage } from "../components/ui";
import { Sidebar } from "../components/Sidebar";
import { ChatHeader, ModeChip } from "../components/Room";
import { mix, popIn } from "../anim";
import { Sfx } from "../components/Sfx";
import { ensureFonts } from "../fonts";

ensureFonts();

export const S4Silence: React.FC = () => {
  const frame = useCurrentFrame();
  const chip = popIn(frame, 76, 16);
  const score = popIn(frame, 66, 14);
  return (
    <AbsoluteFill>
      <Stage>
        <Caption step="04" text={CAPTIONS.s4} />
        <BrowserFrame>
          <Sidebar awayAt={-100} />
          <ChatStack>
            <ChatHeader title={ROOM.issues[0]} right={<ModeChip />} />
            <ChatMessage who="dongjun" kind="mini" at={-100} h={196} threaded>
              {CHAT.dongjunMiniLead}
              <Evidence color={PEOPLE.dongjun.color} progress={1}>
                {CHAT.dongjunMiniEvidence}
              </Evidence>
            </ChatMessage>
            <ChatMessage who="jungmin" kind="human" at={12} h={128}>
              {CHAT.jungminAsk}
            </ChatMessage>
            <ChatMessage
              who="hyejung"
              kind="mini"
              at={44}
              h={196}
              below={
                <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                  <div style={{ opacity: Math.min(1, score * 1.5), scale: `${mix(score, 0.6, 1)}` }}>
                    <Chip tone="plain" size={19}>
                      근거 점수 0.12 · 기준 0.35 미만
                    </Chip>
                  </div>
                  <div style={{ opacity: Math.min(1, chip * 1.5), scale: `${mix(chip, 0.6, 1)}` }}>
                    <Chip tone="warn" size={19}>
                      ? 복귀 후 확인할 질문으로 남김
                    </Chip>
                  </div>
                </div>
              }
            >
              {CHAT.hyejungSilent}
            </ChatMessage>
          </ChatStack>
        </BrowserFrame>
      </Stage>
      <Sfx at={12} name="pop" volume={0.55} />
      <Sfx at={44} name="pop" volume={0.55} />
      <Sfx at={66} name="select" volume={0.45} />
      <Sfx at={76} name="question" volume={0.5} />
    </AbsoluteFill>
  );
};
