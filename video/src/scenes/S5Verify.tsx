import React from "react";
import { AbsoluteFill, Interactive, Sequence, useCurrentFrame } from "remotion";
import { Sfx } from "../components/Sfx";
import { ReturnContent } from "./ReturnContent";
import { CAPTIONS, CHAT, ROOM, VERIFY } from "../data";
import { Avatar, BrowserFrame, Caption, ChatMessage, ChatStack, Stage } from "../components/ui";
import { Sidebar } from "../components/Sidebar";
import { ChatHeader, ModeChip } from "../components/Room";
import { mix, popIn, prog } from "../anim";
import { C } from "../theme";
import { ensureFonts } from "../fonts";

ensureFonts();

const DecisionBadge: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const t = popIn(frame, at, 14);
  return (
    <div
      style={{
        marginTop: 6,
        opacity: Math.min(1, t * 2),
        scale: `${mix(t, 1.5, 1)}`,
        transformOrigin: "left center",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "12px 18px",
        borderRadius: 16,
        background: C.warnSoft,
        border: `2px solid ${C.warn}`,
        color: C.warn,
      }}
    >
      <div style={{ fontSize: 21, fontWeight: 700 }}>결정 · 보류</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>불참자(혜중·동준)에게 영향 → 복귀 후 확인</div>
    </div>
  );
};

const VerifyRow: React.FC<{ i: number; at: number }> = ({ i, at }) => {
  const frame = useCurrentFrame();
  const t = popIn(frame, at, 14);
  const v = VERIFY[i];
  const warn = v.level === "warn";
  return (
    <div
      style={{
        opacity: Math.min(1, t * 1.5),
        translate: `${mix(t, 40, 0)}px 0px`,
        display: "flex",
        gap: 16,
        alignItems: "flex-start",
        padding: "16px 18px",
        borderRadius: 16,
        background: warn ? C.warnSoft : C.infoSoft,
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          flex: "none",
          borderRadius: 99,
          display: "grid",
          placeItems: "center",
          background: warn ? C.warn : C.info,
          color: "#fff",
          fontSize: 20,
          fontWeight: 700,
        }}
      >
        {warn ? "!" : "+"}
      </div>
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color: warn ? C.warn : C.info }}>{v.label}</div>
        <div style={{ fontSize: 22, color: C.ink2 }}>{v.text}</div>
      </div>
    </div>
  );
};

/** 회의록·복귀 화면이 시작되는 프레임 */
const RETURN_AT = 168;

export const S5Verify: React.FC = () => {
  const frame = useCurrentFrame();
  const drawer = prog(frame, 60, 20);
  return (
    <AbsoluteFill>
      <Stage>
        <Caption step="05" text={CAPTIONS.s5} />
        <BrowserFrame>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              opacity: 1 - prog(frame, RETURN_AT - 4, 14),
              translate: `0px ${mix(prog(frame, RETURN_AT - 4, 18), 0, -40)}px`,
            }}
          >
          <Sidebar awayAt={-100} />
          <ChatStack>
            <ChatHeader title={ROOM.issues[0]} right={<ModeChip />} />
            <ChatMessage who="hyejung" kind="mini" at={-100} h={150} maxW={540}>
              {CHAT.hyejungSilent}
            </ChatMessage>
            <ChatMessage who="jungmin" kind="human" at={10} h={330} maxW={540} below={<DecisionBadge at={38} />}>
              {CHAT.jungminConclude}
            </ChatMessage>
          </ChatStack>

          {/* 2차 검증 서랍 */}
          <Interactive.Div
            name="Verify drawer"
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              width: 480,
              background: C.panel,
              borderLeft: `1px solid ${C.line}`,
              boxShadow: "-24px 0 50px -30px rgba(40,30,80,.35)",
              padding: "30px 30px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              zIndex: 10,
              translate: `${mix(drawer, 500, 0)}px 0px`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
              <Avatar who="jungmin" mini size={48} />
              <div>
                <div style={{ fontSize: 18, color: C.muted }}>정민의 미니미가 확인했어요</div>
                <div style={{ fontSize: 30, fontWeight: 700 }}>2차 검증</div>
              </div>
            </div>
            <div
              style={{
                fontSize: 19,
                color: C.ink2,
                background: C.panel2,
                borderRadius: 14,
                padding: "12px 16px",
                borderLeft: `4px solid ${C.line2}`,
              }}
            >
              "B안으로 가자 … 만족도가 항상 더 높으니까 확실해."
            </div>
            <VerifyRow i={0} at={80} />
            <VerifyRow i={1} at={94} />
            <VerifyRow i={2} at={108} />
            <VerifyRow i={3} at={122} />
          </Interactive.Div>
          </div>

          {/* 이어서: 회의 종료 → 회의록, 돌아온 혜중의 '내가 빠진 사이' */}
          <Sequence from={RETURN_AT} name="회의록과 복귀">
            <ReturnContent />
          </Sequence>
        </BrowserFrame>
      </Stage>
      <Sfx at={10} name="pop" volume={0.55} />
      <Sfx at={38} name="stamp" volume={0.6} />
      <Sfx at={60} name="slide" volume={0.5} />
      {[80, 94, 108, 122].map((f) => (
        <Sfx key={f} at={f} name="select" volume={0.45} />
      ))}
      <Sfx at={RETURN_AT - 4} name="whoosh" volume={0.4} />
    </AbsoluteFill>
  );
};
