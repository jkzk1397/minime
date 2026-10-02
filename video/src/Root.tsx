import React from "react";
import { Composition, Folder } from "remotion";
import { MinimeVideo } from "./MinimeVideo";
import { S0Intro } from "./scenes/S0Intro";
import { S1Prepare } from "./scenes/S1Prepare";
import { S2Proxy } from "./scenes/S2Proxy";
import { S3Silence } from "./scenes/S3Silence";
import { S4Verify } from "./scenes/S4Verify";
import { S5Return } from "./scenes/S5Return";
import { S6Ending } from "./scenes/S6Ending";

const base = { width: 1920, height: 1080, fps: 30 } as const;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="MinimeIntro" component={MinimeVideo} durationInFrames={988} {...base} />
    <Folder name="Scenes">
      <Composition id="S0-Intro" component={S0Intro} durationInFrames={150} {...base} />
      <Composition id="S1-Prepare" component={S1Prepare} durationInFrames={210} {...base} />
      <Composition id="S2-Proxy" component={S2Proxy} durationInFrames={200} {...base} />
      <Composition id="S3-Silence" component={S3Silence} durationInFrames={130} {...base} />
      <Composition id="S4-Verify" component={S4Verify} durationInFrames={150} {...base} />
      <Composition id="S5-Return" component={S5Return} durationInFrames={160} {...base} />
      <Composition id="S6-Ending" component={S6Ending} durationInFrames={60} {...base} />
    </Folder>
  </>
);
