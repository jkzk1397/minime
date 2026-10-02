import React from "react";
import { AbsoluteFill, Img, Interactive, staticFile, useCurrentFrame } from "remotion";
import { CAPTIONS } from "../data";
import { Stage } from "../components/ui";
import { mix, popIn, prog } from "../anim";
import { C } from "../theme";
import { ensureFonts } from "../fonts";

ensureFonts();

export const S7Ending: React.FC = () => {
  const frame = useCurrentFrame();
  const logo = popIn(frame, 2, 20);
  const line = prog(frame, 14, 16);
  return (
    <AbsoluteFill>
      <Stage>
        <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 56 }}>
          <Img
            name="Logo"
            src={staticFile("logo.png")}
            style={{ width: 880, opacity: Math.min(1, logo * 1.4), scale: `${mix(logo, 0.8, 1)}` }}
          />
          <Interactive.Div
            name="Tagline"
            style={{
              fontSize: 56,
              fontWeight: 700,
              color: C.ink2,
              opacity: line,
              translate: `0px ${mix(line, 24, 0)}px`,
            }}
          >
            {CAPTIONS.s7}
          </Interactive.Div>
        </AbsoluteFill>
      </Stage>
    </AbsoluteFill>
  );
};
