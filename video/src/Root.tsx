import React from "react";
import { Composition, Folder } from "remotion";
import { MinimeVideo } from "./MinimeVideo";
import { S1Problem } from "./scenes/S1Problem";
import { S2Prepare } from "./scenes/S2Prepare";
import { S3Proxy } from "./scenes/S3Proxy";
import { S4Silence } from "./scenes/S4Silence";
import { S5Verify } from "./scenes/S5Verify";
import { S6Ending } from "./scenes/S6Ending";

const base = { width: 1920, height: 1080, fps: 30 } as const;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="MinimeIntro" component={MinimeVideo} durationInFrames={1002} {...base} />
    <Folder name="Scenes">
      <Composition id="S1-Problem" component={S1Problem} durationInFrames={84} {...base} />
      <Composition id="S2-Prepare" component={S2Prepare} durationInFrames={200} {...base} />
      <Composition id="S3-Proxy" component={S3Proxy} durationInFrames={260} {...base} />
      <Composition id="S4-Silence" component={S4Silence} durationInFrames={140} {...base} />
      <Composition id="S5-Verify-Return" component={S5Verify} durationInFrames={312} {...base} />
      <Composition id="S6-Ending" component={S6Ending} durationInFrames={66} {...base} />
    </Folder>
  </>
);
