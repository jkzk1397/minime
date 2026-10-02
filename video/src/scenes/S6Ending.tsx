import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { Sfx } from "../components/Sfx";
import { Stage } from "../components/ui";
import { mix, popIn } from "../anim";
import { ensureFonts } from "../fonts";

ensureFonts();

export const S6Ending: React.FC = () => {
  const frame = useCurrentFrame();
  const logo = popIn(frame, 2, 20);
  return (
    <AbsoluteFill>
      <Stage>
        <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <Img
            name="Logo"
            src={staticFile("logo.png")}
            style={{ width: 1000, opacity: Math.min(1, logo * 1.4), scale: `${mix(logo, 0.8, 1)}` }}
          />
        </AbsoluteFill>
      </Stage>
      <Sfx at={2} name="chime" volume={0.5} />
    </AbsoluteFill>
  );
};
