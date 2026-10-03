import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CAPTIONS, LINES, PEOPLE, PersonId } from "../data";
import { At, Caption, Stage } from "../components/ui";
import { Face, Mark, Minime, Person } from "../components/characters";
import { Sfx } from "../components/Sfx";
import { mix, popIn, prog } from "../anim";
import { C } from "../theme";
import { ensureFonts } from "../fonts";

ensureFonts();

const HOLD_AT = 36;
const BACK_AT = 84;
const OK_AT: Record<"hyejung" | "dongjun", number> = { hyejung: 108, dongjun: 124 };
const FINAL_AT = 146;

const Stamp: React.FC<{ at: number; out?: number; color: string; bg: string; children: React.ReactNode }> = ({ at, out, color, bg, children }) => {
  const frame = useCurrentFrame();
  const t = popIn(frame, at, 10);
  const o = out !== undefined ? 1 - prog(frame, out, 8) : 1;
  return (
    <div
      style={{
        position: "absolute",
        right: -120,
        top: -80,
        opacity: Math.min(1, t * 2) * o,
        scale: `${mix(t, 2.4, 1) * (out !== undefined ? mix(prog(frame, out, 8), 1, 0.7) : 1)}`,
        rotate: "-12deg",
        padding: "10px 40px",
        borderRadius: 26,
        border: `8px solid ${color}`,
        color,
        background: bg,
        fontSize: 96,
        fontWeight: 800,
        letterSpacing: "0.05em",
      }}
    >
      {children}
    </div>
  );
};

const Returner: React.FC<{ who: "hyejung" | "dongjun"; x: number }> = ({ who, x }) => {
  const frame = useCurrentFrame();
  const t = popIn(frame, BACK_AT + (who === "dongjun" ? 6 : 0), 16);
  const ok = popIn(frame, OK_AT[who], 12);
  return (
    <At x={x} y={720} anchor="top" style={{ opacity: Math.min(1, t * 1.5), scale: `${mix(t, 0.6, 1)}` }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, position: "relative" }}>
        <Face who={who as PersonId} size={150} />
        <div style={{ fontSize: 38, fontWeight: 700 }}>{PEOPLE[who].name}</div>
        <div style={{ position: "absolute", right: -16, top: -10, opacity: Math.min(1, ok * 1.5), scale: `${mix(ok, 0.3, 1)}` }}>
          <Mark kind="✓" color={C.ok} size={64} />
        </div>
      </div>
    </At>
  );
};

// 한 가지 사례만: 빠진 사람 몫의 결정은 '보류' → 돌아와서 확인하면 '확정'
export const S4Confirm: React.FC = () => {
  const frame = useCurrentFrame();
  const card = popIn(frame, 6, 16);
  const shake = (frame >= HOLD_AT && frame < HOLD_AT + 8) || (frame >= FINAL_AT && frame < FINAL_AT + 8) ? Math.sin(frame * 3) * 6 : 0;
  const waiting = popIn(frame, HOLD_AT + 14, 14) * (1 - prog(frame, BACK_AT - 8, 8));

  return (
    <AbsoluteFill>
      <Stage>
        <Caption step="04" text={CAPTIONS.confirm} />

        <At x={960} y={460} anchor="center" style={{ opacity: Math.min(1, card * 1.5), scale: `${mix(card, 0.7, 1)}`, translate: `calc(-50% + ${shake}px) -50%` }}>
          <div
            style={{
              width: 900,
              height: 230,
              borderRadius: 40,
              background: "#fff",
              boxShadow: `inset 0 0 0 3px ${C.line2}, 0 30px 50px -30px rgba(40,30,80,.4)`,
              display: "flex",
              alignItems: "center",
              gap: 36,
              padding: "0 50px",
              position: "relative",
            }}
          >
            <Person who="jungmin" size={180} style={{ marginTop: 20 }} />
            <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: "-0.04em" }}>{LINES.decision}</div>
            <Stamp at={HOLD_AT} out={FINAL_AT - 4} color={C.warn} bg="rgba(252,241,220,.94)">
              {LINES.hold}
            </Stamp>
            <Stamp at={FINAL_AT} color={C.ok} bg="rgba(226,244,236,.94)">
              {LINES.confirmed}
            </Stamp>
          </div>
        </At>

        {/* 기다리는 중 */}
        <At x={960} y={700} anchor="top" style={{ opacity: Math.min(1, waiting * 1.5) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 42, fontWeight: 700, color: C.ink2 }}>
            <Minime who="hyejung" size={80} />
            <Minime who="dongjun" size={80} />
            {LINES.holdSub}
          </div>
        </At>

        {/* 돌아와서 확인 */}
        <Returner who="hyejung" x={800} />
        <Returner who="dongjun" x={1120} />
      </Stage>

      <Sfx at={6} name="pop" volume={0.4} />
      <Sfx at={HOLD_AT} name="stamp" volume={0.55} />
      <Sfx at={BACK_AT} name="soft-pop" volume={0.4} />
      <Sfx at={BACK_AT + 6} name="soft-pop" volume={0.35} />
      <Sfx at={OK_AT.hyejung} name="click" volume={0.7} />
      <Sfx at={OK_AT.dongjun} name="click" volume={0.7} />
      <Sfx at={FINAL_AT} name="stamp" volume={0.5} />
      <Sfx at={FINAL_AT + 2} name="confirm" volume={0.5} />
    </AbsoluteFill>
  );
};
