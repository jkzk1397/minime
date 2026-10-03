import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CAPTIONS, LINES, PEOPLE } from "../data";
import { At, Caption, Stage } from "../components/ui";
import { DocIcon, Mark, Minime, Tag } from "../components/characters";
import { Sfx, Typing } from "../components/Sfx";
import { lin, mix, popIn, prog } from "../anim";
import { C, tint } from "../theme";
import { ensureFonts } from "../fonts";

ensureFonts();

const HJ = PEOPLE.hyejung.color;
const CENTER = { x: 1180, y: 560 };
const R = 230;

/** 자료가 미니미에게 흘러 들어가는 점들 */
const Flow: React.FC<{ from: { x: number; y: number }; at: number }> = ({ from, at }) => {
  const frame = useCurrentFrame();
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => {
        const s = at + i * 5;
        const t = prog(frame, s, 24);
        if (frame < s || t >= 1) return null;
        const x = mix(t, from.x, CENTER.x);
        const y = mix(t, from.y, CENTER.y) - Math.sin(Math.PI * t) * 60;
        const r = mix(t, 24, 10);
        return (
          <div
            key={i}
            style={{ position: "absolute", left: x - r / 2, top: y - r / 2, width: r, height: r, borderRadius: 99, background: HJ, opacity: 0.85, zIndex: 20 }}
          />
        );
      })}
    </>
  );
};

/** 인터뷰 아이콘: 말풍선 안에서 점 세 개가 타이핑 */
const InterviewIcon: React.FC<{ typingFrom: number; typingTo: number }> = ({ typingFrom, typingTo }) => {
  const frame = useCurrentFrame();
  const typing = frame >= typingFrom && frame < typingTo;
  return (
    <div
      style={{
        width: 190,
        height: 140,
        borderRadius: 44,
        background: "#fff",
        boxShadow: `inset 0 0 0 4px ${C.line2}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        position: "relative",
      }}
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 22,
            height: 22,
            borderRadius: 99,
            background: typing ? HJ : C.line2,
            translate: `0px ${typing ? -Math.max(0, Math.sin((frame - i * 4) * 0.35)) * 12 : 0}px`,
          }}
        />
      ))}
      <div style={{ position: "absolute", left: 34, bottom: -18, width: 34, height: 34, background: "#fff", borderRight: `4px solid ${C.line2}`, borderBottom: `4px solid ${C.line2}`, rotate: "45deg" }} />
    </div>
  );
};

export const S1Prepare: React.FC = () => {
  const frame = useCurrentFrame();
  const doc = popIn(frame, 6, 16);
  const itv = popIn(frame, 16, 16);
  const ready = lin(frame, 30, 92);
  const done = frame >= 92;
  const ringColor = done ? C.ok : HJ;
  const len = 2 * Math.PI * R;
  const bounce = 1 + 0.08 * Math.sin(Math.PI * lin(frame, 92, 104));
  const tag = popIn(frame, 96, 16);

  return (
    <AbsoluteFill>
      <Stage>
        <Caption step="01" text={CAPTIONS.prepare} />

        {/* 자료 두 가지 */}
        <At x={560} y={420} anchor="center" style={{ opacity: doc, scale: `${mix(doc, 0.6, 1)}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
            <DocIcon size={110} color={HJ} highlight={frame >= 30 && frame < 70 ? Math.floor((frame - 30) / 10) % 4 : -1} />
            <div style={{ fontSize: 46, fontWeight: 700, color: C.ink2 }}>{LINES.report}</div>
          </div>
        </At>
        <At x={560} y={730} anchor="center" style={{ opacity: itv, scale: `${mix(itv, 0.6, 1)}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
            <InterviewIcon typingFrom={34} typingTo={74} />
            <div style={{ fontSize: 46, fontWeight: 700, color: C.ink2 }}>{LINES.interview}</div>
          </div>
        </At>
        <Flow from={{ x: 760, y: 420 }} at={30} />
        <Flow from={{ x: 800, y: 720 }} at={52} />

        {/* 미니미 + 준비 링 */}
        <svg width={R * 2 + 40} height={R * 2 + 40} style={{ position: "absolute", left: CENTER.x - R - 20, top: CENTER.y - R - 20, rotate: "-90deg" }}>
          <circle cx={R + 20} cy={R + 20} r={R} fill={tint(done ? C.ok : HJ, 6)} stroke={C.line} strokeWidth={20} />
          <circle cx={R + 20} cy={R + 20} r={R} fill="none" stroke={ringColor} strokeWidth={20} strokeLinecap="round" strokeDasharray={`${len * ready} ${len}`} />
        </svg>
        <At x={CENTER.x} y={CENTER.y + 26} anchor="center" style={{ scale: `${bounce}` }}>
          <Minime who="hyejung" size={300} blinkAt={[60, 120]} />
        </At>
        <At x={CENTER.x} y={CENTER.y + R + 50} anchor="top" style={{ opacity: Math.min(1, tag * 1.5), scale: `${mix(tag, 0.6, 1)}` }}>
          <Tag tone="ok" size={40}>
            <Mark kind="✓" color={C.ok} size={46} />
            {LINES.ready}
          </Tag>
        </At>
      </Stage>

      <Sfx at={6} name="pop" volume={0.4} />
      <Sfx at={16} name="pop" volume={0.35} />
      <Typing start={34} count={13} />
      <Sfx at={30} name="slide" volume={0.3} />
      <Sfx at={94} name="confirm" volume={0.55} />
    </AbsoluteFill>
  );
};
