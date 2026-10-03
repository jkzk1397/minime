import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CAPTIONS, LINES, PEOPLE, PersonId } from "../data";
import { Caption, Stage } from "../components/ui";
import { Mark, Minime, Person, Sparkle, Tag } from "../components/characters";
import { MeetingTable, SEATS } from "../components/Table";
import { Sfx } from "../components/Sfx";
import { lin, mix, popIn, prog } from "../anim";
import { C } from "../theme";
import { ensureFonts } from "../fonts";

ensureFonts();

// 오른쪽 '회의실' 미니어처: MeetingTable(1920×1080 좌표)을 0.5배로 줄여 놓는다
const ROOM = { L: 860, T: 300, S: 0.5 };
const roomPt = (x: number, y: number) => ({ x: ROOM.L + x * ROOM.S, y: ROOM.T + y * ROOM.S });
const FLOOR = 900;
const PHOTO_H = 380;
const MINI = 170;

/** 회의에 못 가는 사람: 걸어오다 멈추고 → 작아지며 미니미로 → 회의실 자리로 폴짝 */
const Absentee: React.FC<{ who: PersonId; fromX: number; toX: number; d: number }> = ({ who, fromX, toX, d }) => {
  const frame = useCurrentFrame();
  const walk = prog(frame, d, 44);
  const walking = frame >= d && frame < d + 44;
  const px = mix(walk, fromX, toX);
  const bob = walking ? -Math.abs(Math.sin((frame - d) * 0.45)) * 12 : 0;

  const shrink = prog(frame, 58 + d, 20);
  const personOpacity = 1 - lin(frame, 66 + d, 78 + d);
  const born = popIn(frame, 70 + d, 18);

  const hop = prog(frame, 94 + d, 26);
  const s = SEATS[who];
  const seat = roomPt(s.x, s.y);
  const mx = mix(hop, toX, seat.x);
  const my = mix(hop, FLOOR, seat.y) - Math.sin(Math.PI * Math.min(1, hop)) * 260;
  const ms = mix(hop, 1, ROOM.S);

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: px,
          top: FLOOR + bob,
          translate: "-50% -100%",
          scale: `${mix(shrink, 1, 0.2)}`,
          transformOrigin: "50% 100%",
          opacity: personOpacity,
        }}
      >
        <Person who={who} size={PHOTO_H} />
      </div>
      <Sparkle at={64 + d} x={toX} y={FLOOR - 80} color={PEOPLE[who].color} size={220} />
      {frame >= 68 + d ? (
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
          <Minime who={who} size={MINI} blinkAt={[84 + d]} />
        </div>
      ) : null}
    </>
  );
};

export const S0Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const roomIn = prog(frame, 6, 20);
  const tag = popIn(frame, 48, 14) * (1 - prog(frame, 66, 8));

  return (
    <AbsoluteFill>
      <Stage>
        <Caption text={CAPTIONS.intro1} delay={2} out={80} />
        <Caption text={CAPTIONS.intro2} delay={84} />

        {/* 바닥 */}
        <div style={{ position: "absolute", left: 80, right: 80, top: FLOOR, height: 3, background: C.line, borderRadius: 2 }} />

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
          <MeetingTable seats={{ jongwon: "person", hyejung: "empty", jungmin: "person", dongjun: "empty" }} at={{ jongwon: 8, hyejung: 12, jungmin: 14, dongjun: 16 }} />
        </div>

        {/* 못 오는 두 사람 */}
        <Absentee who="hyejung" fromX={-120} toX={320} d={0} />
        <Absentee who="dongjun" fromX={-420} toX={720} d={6} />

        {/* 일정 충돌 */}
        <div
          style={{
            position: "absolute",
            left: 520,
            top: 480,
            translate: "-50% -100%",
            opacity: Math.min(1, tag * 1.5),
            scale: `${mix(tag, 0.6, 1)}`,
            zIndex: 20,
          }}
        >
          <Tag tone="warn" size={36}>
            <Mark kind="!" color={C.warn} size={40} />
            {LINES.conflict}
          </Tag>
        </div>
      </Stage>

      <Sfx at={48} name="soft-out" volume={0.45} />
      <Sfx at={62} name="sparkle" volume={0.5} />
      <Sfx at={72} name="soft-pop" volume={0.45} />
      <Sfx at={78} name="soft-pop" volume={0.4} />
      <Sfx at={118} name="pop" volume={0.4} />
      <Sfx at={124} name="pop" volume={0.4} />
    </AbsoluteFill>
  );
};
