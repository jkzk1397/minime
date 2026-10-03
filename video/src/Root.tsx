import React from "react";
import { Composition, Folder } from "remotion";
import { MinimeVideo } from "./MinimeVideo";
import { S0Intro } from "./scenes/S0Intro";
import { S1Prepare } from "./scenes/S1Prepare";
import { S2Proxy } from "./scenes/S2Proxy";
import { S3Silence } from "./scenes/S3Silence";
import { S4Confirm } from "./scenes/S4Confirm";
import { S6Ending } from "./scenes/S6Ending";

const base = { width: 1920, height: 1080, fps: 30 } as const;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="MinimeIntro" component={MinimeVideo} durationInFrames={760} defaultProps={{ photos: false }} {...base} />
    <Composition id="MinimeIntroPhoto" component={MinimeVideo} durationInFrames={760} defaultProps={{ photos: true }} {...base} />
    <Folder name="Scenes">
      <Composition id="S0-Intro" component={S0Intro} durationInFrames={150} {...base} />
      <Composition id="S1-Prepare" component={S1Prepare} durationInFrames={140} {...base} />
      <Composition id="S2-Proxy" component={S2Proxy} durationInFrames={140} {...base} />
      <Composition id="S3-Silence" component={S3Silence} durationInFrames={120} {...base} />
      <Composition id="S4-Confirm" component={S4Confirm} durationInFrames={190} {...base} />
      <Composition id="S5-Ending" component={S6Ending} durationInFrames={60} {...base} />
    </Folder>
  </>
);
