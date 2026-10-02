import React from "react";
import { AbsoluteFill, Interactive, useCurrentFrame } from "remotion";
import { CAPTIONS, ORDER, PEOPLE } from "../data";
import { Avatar, Caption, Chip, Stage } from "../components/ui";
import { mix, popIn, prog } from "../anim";
import { C } from "../theme";
import { Sfx } from "../components/Sfx";
import { ensureFonts } from "../fonts";

ensureFonts();

export const S1Problem: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Stage>
        <Caption step="01" text={CAPTIONS.s1} />
        <Interactive.Div
          name="Team row"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 330,
            display: "flex",
            justifyContent: "center",
            gap: 120,
          }}
        >
          {ORDER.map((id, i) => {
            const t = popIn(frame, 10 + i * 6, 18);
            const absent = id === "hyejung" || id === "dongjun";
            const dim = absent ? prog(frame, 44, 14) : 0;
            const tag = absent ? popIn(frame, 50, 14) : 0;
            return (
              <div
                key={id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 22,
                  opacity: Math.min(1, t * 1.5),
                  scale: `${mix(t, 0.4, 1)}`,
                  width: 240,
                }}
              >
                <Avatar
                  who={id}
                  size={200}
                  style={{
                    opacity: 1 - dim * 0.65,
                    filter: `grayscale(${dim * 0.8})`,
                    boxShadow: "0 20px 40px -20px rgba(40,30,80,.45)",
                  }}
                />
                <div style={{ fontSize: 48, fontWeight: 700, opacity: 1 - dim * 0.5 }}>{PEOPLE[id].name}</div>
                <div style={{ fontSize: 28, color: C.muted, opacity: 1 - dim * 0.5 }}>{PEOPLE[id].role}</div>
                <div style={{ height: 50, opacity: tag, scale: `${mix(tag, 0.6, 1)}` }}>
                  {absent ? (
                    <Chip tone="warn" size={26}>
                      수업 때문에 불참
                    </Chip>
                  ) : null}
                </div>
              </div>
            );
          })}
        </Interactive.Div>
      </Stage>
      {[10, 16, 22, 28].map((f) => (
        <Sfx key={f} at={f} name="pop2" volume={0.5} />
      ))}
      <Sfx at={46} name="question" volume={0.45} />
    </AbsoluteFill>
  );
};
