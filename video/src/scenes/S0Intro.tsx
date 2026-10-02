import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CAPTIONS, LINES } from "../data";
import { Caption, Stage } from "../components/ui";
import { Mark, Minime, Person, Sparkle, Tag } from "../components/characters";
import { MeetingTable } from "../components/Table";
import { Sfx } from "../components/Sfx";
import { lin, mix, popIn, prog } from "../anim";
import { C } from "../theme";
import { ensureFonts } from "../fonts";

ensureFonts();

// 오른쪽 '회의실' 미니어처: MeetingTable(1920×1080 좌표)을 0.5배로 줄여 놓는다
const ROOM = { L: 860, T: 300, S: 0.5 };
const roomPt = (x: number, y: number) => ({ x: ROOM.L + x * ROOM.S, y: ROOM.T + y * ROOM.S });

export const S0Intro: React.FC = () => {
  const frame = useCurrentFrame();

  // 걷기
  const walk = prog(frame, 0, 44);
  const walking = frame < 44;
  const px = mix(walk, 150, 600);
  const bob = walking ? -Math.abs(Math.sin(frame * 0.45)) * 12 : 0;

  // 줄어들기 → 미니미
  const shrink = prog(frame, 58, 20);
  const personOpacity = 1 - lin(frame, 66, 78);
  const born = popIn(frame, 70, 18);

  // 회의실로 폴짝
  const hop = prog(frame, 94, 26);
  const seat = roomPt(1160, 588);
  const mx = mix(hop, 600, seat.x);
  const my = mix(hop, 900, seat.y) - Math.sin(Math.PI * Math.min(1, hop)) * 260;
  const ms = mix(hop, 1, (170 * ROOM.S) / 180);

  const roomIn = prog(frame, 6, 20);
  const tag = popIn(frame, 44, 14) * (1 - prog(frame, 64, 8));

  return (
    <AbsoluteFill>
      <Stage>
        <Caption text={CAPTIONS.intro1} delay={2} out={80} />
        <Caption text={CAPTIONS.intro2} delay={84} />

        {/* 바닥 */}
        <div style={{ position: "absolute", left: 80, right: 80, top: 900, height: 3, background: C.line, borderRadius: 2 }} />

        {/* 회의실 카드 */}
        <div
          style={{
            position: "absolute",
            left: 1060,
            top: 300,
            width: 580,
            height: 520,
            borderRadius: 36,
            background: "rgba(255,255,255,.7)",
            boxShadow: `inset 0 0 0 3px ${C.line}`,
            opacity: roomIn,
            translate: `${mix(roomIn, 40, 0)}px 0px`,
          }}
        >
          <div style={{ position: "absolute", left: 0, right: 0, top: 26, textAlign: "center", fontSize: 32, fontWeight: 700, color: C.ink2 }}>
            {LINES.room}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: ROOM.L,
            top: ROOM.T,
            width: 1920,
            height: 1080,
            scale: `${ROOM.S}`,
            transformOrigin: "0 0",
            opacity: roomIn,
          }}
        >
          <MeetingTable
            seats={{ jongwon: "person", hyejung: "empty", jungmin: "person", dongjun: frame >= 124 ? "minime" : "empty" }}
            at={{ jongwon: 8, hyejung: 12, jungmin: 14, dongjun: 124 }}
          />
        </div>

        {/* 혜중 실루엣 */}
        <div
          style={{
            position: "absolute",
            left: px,
            top: 900 + bob,
            translate: "-50% -100%",
            scale: `${mix(shrink, 1, 0.22)}`,
            transformOrigin: "50% 100%",
            opacity: personOpacity,
          }}
        >
          <Person who="hyejung" size={380} />
        </div>

        {/* 일정 충돌 태그 */}
        <div
          style={{
            position: "absolute",
            left: 600,
            top: 470,
            translate: "-50% -100%",
            opacity: Math.min(1, tag * 1.5),
            scale: `${mix(tag, 0.6, 1)}`,
          }}
        >
          <Tag tone="warn" size={36}>
            <Mark kind="!" color={C.warn} size={40} />
            {LINES.conflict}
          </Tag>
        </div>

        <Sparkle at={64} x={600} y={820} color="#c24c19" size={240} />

        {/* 미니미 */}
        {frame >= 68 ? (
          <div
            style={{
              position: "absolute",
              left: mx,
              top: my,
              translate: "-50% -100%",
              scale: `${mix(born, 0.2, 1) * ms}`,
              transformOrigin: "50% 100%",
              opacity: Math.min(1, born * 2),
              zIndex: 10,
            }}
          >
            <Minime who="hyejung" size={180} blinkAt={[84]} />
          </div>
        ) : null}
        <Sparkle at={122} x={roomPt(1160, 860).x} y={roomPt(1160, 860).y} color="#d23c72" size={90} />
      </Stage>

      <Sfx at={44} name="soft-out" volume={0.45} />
      <Sfx at={62} name="sparkle" volume={0.5} />
      <Sfx at={72} name="soft-pop" volume={0.5} />
      <Sfx at={118} name="pop" volume={0.45} />
      <Sfx at={124} name="soft-pop" volume={0.4} />
    </AbsoluteFill>
  );
};
