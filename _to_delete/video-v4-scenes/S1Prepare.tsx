import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CAPTIONS, LINES, PEOPLE } from "../data";
import { At, Caption, Cursor, Stage } from "../components/ui";
import { Bubble, DocIcon, Mark, Minime } from "../components/characters";
import { Sfx, Typing } from "../components/Sfx";
import { lin, mix, popIn, prog, typed } from "../anim";
import { C } from "../theme";
import { ensureFonts } from "../fonts";

ensureFonts();

const HJ = PEOPLE.hyejung.color;
const CENTER = { x: 960, y: 560 };

/** 자료 조각이 미니미에게 빨려 들어가는 점 */
const Flow: React.FC<{ from: { x: number; y: number }; at: number; n?: number }> = ({ from, at, n = 3 }) => {
  const frame = useCurrentFrame();
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const s = at + i * 6;
        const t = prog(frame, s, 22);
        if (frame < s || t >= 1) return null;
        const x = mix(t, from.x, CENTER.x);
        const y = mix(t, from.y, CENTER.y) - Math.sin(Math.PI * t) * 120;
        const r = mix(t, 26, 10);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x - r / 2,
              top: y - r / 2,
              width: r,
              height: r,
              borderRadius: 99,
              background: HJ,
              opacity: 0.85,
              zIndex: 20,
            }}
          />
        );
      })}
    </>
  );
};

const StanceCard: React.FC<{ i: number; at: number }> = ({ i, at }) => {
  const frame = useCurrentFrame();
  const t = popIn(frame, at, 16);
  const s = LINES.stances[i];
  return (
    <div
      style={{
        width: 330,
        padding: "20px 26px",
        borderRadius: 26,
        background: "#fff",
        boxShadow: `inset 0 0 0 2px ${C.line}, 0 16px 30px -20px rgba(40,30,80,.35)`,
        display: "flex",
        alignItems: "center",
        gap: 18,
        opacity: Math.min(1, t * 1.5),
        scale: `${mix(t, 0.6, 1)}`,
        translate: `0px ${mix(t, 30, 0)}px`,
      }}
    >
      <Mark kind="✓" color={C.ok} size={44} />
      <div>
        <div style={{ fontSize: 26, color: C.muted, fontWeight: 600 }}>{s.k}</div>
        <div style={{ fontSize: 40, fontWeight: 700 }}>{s.v}</div>
      </div>
    </div>
  );
};

export const S1Prepare: React.FC = () => {
  const frame = useCurrentFrame();
  const docIn = popIn(frame, 8, 16);
  const hl = frame >= 22 && frame < 62 ? Math.floor((frame - 22) / 10) % 4 : -1;
  const clickAt = 142;
  const btn = popIn(frame, 126, 14);
  const pressed = frame >= clickAt;
  const ready = mix(lin(frame, 60, 74), 0, 1 / 3) + mix(lin(frame, 152, 170), 0, 2 / 3);
  const done = ready > 0.999;
  const ringColor = done ? C.ok : C.accent;
  const R = 200;
  const len = 2 * Math.PI * R;
  const minimeBounce = 1 + 0.06 * Math.sin(Math.PI * lin(frame, 60, 70)) + 0.08 * Math.sin(Math.PI * lin(frame, 166, 178));

  return (
    <AbsoluteFill>
      <Stage>
        <Caption step="01" text={CAPTIONS.prepare} />

        {/* 보고서 */}
        <At x={420} y={540} anchor="center" style={{ opacity: docIn, scale: `${mix(docIn, 0.6, 1)}` }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <DocIcon size={170} color={HJ} highlight={hl} />
            <div style={{ fontSize: 40, fontWeight: 700, color: C.ink2 }}>{LINES.report}</div>
          </div>
        </At>
        <Flow from={{ x: 470, y: 500 }} at={36} />

        {/* 준비도 링 + 미니미 */}
        <svg
          width={R * 2 + 40}
          height={R * 2 + 40}
          style={{ position: "absolute", left: CENTER.x - R - 20, top: CENTER.y - R - 20, rotate: "-90deg" }}
        >
          <circle cx={R + 20} cy={R + 20} r={R} fill="none" stroke={C.line} strokeWidth={18} />
          <circle
            cx={R + 20}
            cy={R + 20}
            r={R}
            fill="none"
            stroke={ringColor}
            strokeWidth={18}
            strokeLinecap="round"
            strokeDasharray={`${len * ready} ${len}`}
          />
        </svg>
        <At x={CENTER.x} y={CENTER.y + 24} anchor="center" style={{ scale: `${minimeBounce}` }}>
          <Minime who="hyejung" size={250} blinkAt={[40, 120, 190]} />
        </At>
        <At x={CENTER.x} y={CENTER.y - R - 26} anchor="center">
          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              color: ringColor,
              background: done ? C.okSoft : C.accentSoft,
              padding: "6px 22px",
              borderRadius: 999,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            준비도 {Math.round(ready * 3)}/3
          </div>
        </At>

        {/* 인터뷰 */}
        <Bubble who="hyejung" mini at={80} tail="bottom-left" size={38} style={{ left: 1250, top: 330 }}>
          {LINES.interviewQ}
        </Bubble>
        <Bubble who="hyejung" at={96} tail="top-right" size={38} style={{ left: 1290, top: 470, minWidth: 120 }}>
          {typed(LINES.interviewA, frame, 100, 0.5) || " "}
        </Bubble>
        <At x={1560} y={640} anchor="top" style={{ opacity: Math.min(1, btn * 1.5), scale: `${mix(btn, 0.6, 1) * (frame >= clickAt - 2 && frame < clickAt + 4 ? 0.93 : 1)}` }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 36,
              fontWeight: 700,
              padding: "14px 34px",
              borderRadius: 22,
              background: pressed ? C.ok : C.ink,
              color: "#fff",
            }}
          >
            {pressed ? "✓ " : ""}
            {LINES.ok}
          </div>
        </At>
        <Flow from={{ x: 1450, y: 520 }} at={146} />
        <Cursor
          path={[
            { f: 124, x: 1760, y: 860 },
            { f: 138, x: 1580, y: 680 },
          ]}
          clickAt={[clickAt]}
        />

        {/* 입장 카드 */}
        <div style={{ position: "absolute", left: 0, right: 0, top: 830, display: "flex", justifyContent: "center", gap: 36 }}>
          <StanceCard i={0} at={70} />
          <StanceCard i={1} at={164} />
          <StanceCard i={2} at={172} />
        </div>
      </Stage>

      <Sfx at={8} name="pop" volume={0.4} />
      <Sfx at={36} name="slide" volume={0.35} />
      <Sfx at={70} name="pop" volume={0.45} />
      <Sfx at={80} name="pop" volume={0.4} />
      <Typing start={100} count={9} />
      <Sfx at={clickAt} name="click" volume={0.8} />
      <Sfx at={146} name="slide" volume={0.35} />
      <Sfx at={170} name="confirm" volume={0.55} />
    </AbsoluteFill>
  );
};
