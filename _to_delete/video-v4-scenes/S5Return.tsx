import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CAPTIONS, LINES } from "../data";
import { At, Caption, Cursor, Stage } from "../components/ui";
import { Mark, Minime, Person, Sparkle } from "../components/characters";
import { Sfx } from "../components/Sfx";
import { mix, prog } from "../anim";
import { C } from "../theme";
import { ensureFonts } from "../fonts";

ensureFonts();

const PANEL = { x: 860, y: 270, w: 860 };
const ROW_Y = [430, 580];
const APPROVE_AT = 100;
const OBJECT_AT = 126;

const Btn: React.FC<{ x: number; y: number; kind: "ok" | "no"; doneAt: number; fadeAt?: number }> = ({
  x,
  y,
  kind,
  doneAt,
  fadeAt,
}) => {
  const frame = useCurrentFrame();
  const done = frame >= doneAt;
  const color = kind === "ok" ? C.ok : C.bad;
  const soft = kind === "ok" ? C.okSoft : C.badSoft;
  const fade = fadeAt !== undefined ? 1 - prog(frame, fadeAt, 8) * 0.65 : 1;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 150,
        height: 64,
        borderRadius: 18,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        fontSize: 30,
        fontWeight: 700,
        background: done ? color : soft,
        color: done ? "#fff" : color,
        opacity: fade,
        scale: frame >= doneAt - 2 && frame < doneAt + 4 ? "0.92" : "1",
      }}
    >
      {kind === "ok" ? "✓" : "✕"} {kind === "ok" ? LINES.approve : LINES.object}
    </div>
  );
};

export const S5Return: React.FC = () => {
  const frame = useCurrentFrame();
  const walk = prog(frame, 0, 32);
  const px = mix(walk, -160, 470);
  const bob = frame < 32 ? -Math.abs(Math.sin(frame * 0.45)) * 12 : 0;
  const merge = prog(frame, 40, 18);
  const panel = prog(frame, 62, 20);

  return (
    <AbsoluteFill>
      <Stage>
        <Caption step="05" text={CAPTIONS.back} />
        <div style={{ position: "absolute", left: 80, right: 80, top: 900, height: 3, background: C.line, borderRadius: 2 }} />

        {/* 돌아온 혜중 */}
        <div style={{ position: "absolute", left: px, top: 900 + bob, translate: "-50% -100%" }}>
          <Person who="hyejung" size={380} />
        </div>

        {/* 미니미가 주인에게 쏙 */}
        {merge < 1 ? (
          <At
            x={mix(merge, 690, 470)}
            y={mix(merge, 900, 700) - Math.sin(Math.PI * merge) * 120}
            style={{ scale: `${mix(merge, 1, 0.15)}`, opacity: 1 - prog(frame, 52, 6), zIndex: 5 }}
          >
            <Minime who="hyejung" size={170} blinkAt={[20]} />
          </At>
        ) : null}
        <Sparkle at={56} x={470} y={680} color="#c24c19" size={200} />

        {/* 내가 빠진 사이 */}
        <div
          style={{
            position: "absolute",
            left: PANEL.x,
            top: PANEL.y,
            width: PANEL.w,
            height: 600,
            borderRadius: 40,
            background: "#fff",
            boxShadow: `inset 0 0 0 3px ${C.line}, 0 30px 60px -30px rgba(40,30,80,.4)`,
            opacity: panel,
            translate: `${mix(panel, 120, 0)}px 0px`,
          }}
        >
          <div style={{ position: "absolute", left: 48, top: 40, display: "flex", alignItems: "center", gap: 18 }}>
            <Minime who="hyejung" size={72} />
            <div style={{ fontSize: 50, fontWeight: 700 }}>{LINES.digest}</div>
          </div>
          {LINES.digestRows.map((r, i) => (
            <div
              key={r}
              style={{
                position: "absolute",
                left: 40,
                right: 40,
                top: ROW_Y[i] - PANEL.y - 30,
                height: 120,
                borderRadius: 26,
                background: C.panel2,
                display: "flex",
                alignItems: "center",
                gap: 18,
                padding: "0 28px",
                fontSize: 40,
                fontWeight: 700,
              }}
            >
              <Mark kind="!" color={C.warn} size={44} />
              {r}
            </div>
          ))}
          <div style={{ position: "absolute", left: 48, top: 500, display: "flex", alignItems: "center", gap: 14, fontSize: 32, fontWeight: 600, color: C.muted }}>
            <Mark kind="?" color={C.faint} size={38} />
            {LINES.digestQ}
          </div>
        </div>

        <div style={{ opacity: panel }}>
          <Btn x={1370} y={ROW_Y[0]} kind="ok" doneAt={APPROVE_AT} />
          <Btn x={1536} y={ROW_Y[0]} kind="no" doneAt={9999} fadeAt={APPROVE_AT} />
          <Btn x={1370} y={ROW_Y[1]} kind="ok" doneAt={9999} fadeAt={OBJECT_AT} />
          <Btn x={1536} y={ROW_Y[1]} kind="no" doneAt={OBJECT_AT} />
        </div>

        <Cursor
          path={[
            { f: 80, x: 1300, y: 880 },
            { f: 96, x: 1440, y: ROW_Y[0] + 36 },
            { f: 108, x: 1440, y: ROW_Y[0] + 36 },
            { f: 122, x: 1606, y: ROW_Y[1] + 36 },
          ]}
          clickAt={[APPROVE_AT, OBJECT_AT]}
        />
      </Stage>

      <Sfx at={54} name="sparkle" volume={0.45} />
      <Sfx at={62} name="slide" volume={0.35} />
      <Sfx at={APPROVE_AT} name="click" volume={0.75} />
      <Sfx at={APPROVE_AT + 1} name="confirm" volume={0.45} />
      <Sfx at={OBJECT_AT} name="click" volume={0.75} />
    </AbsoluteFill>
  );
};
