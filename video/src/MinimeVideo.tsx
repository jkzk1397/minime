import React from "react";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { S0Intro } from "./scenes/S0Intro";
import { S1Prepare } from "./scenes/S1Prepare";
import { S2Proxy } from "./scenes/S2Proxy";
import { S3Silence } from "./scenes/S3Silence";
import { S4Verify } from "./scenes/S4Verify";
import { S5Return } from "./scenes/S5Return";
import { S6Ending } from "./scenes/S6Ending";

// 장면 길이 합 1060 − 전환 12 × 6 = 988프레임(약 33초)
export const MinimeVideo: React.FC = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence name="00 인트로: 미니미 탄생" durationInFrames={150}>
      <S0Intro />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
    <TransitionSeries.Sequence name="01 미니미 준비" durationInFrames={210}>
      <S1Prepare />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
    <TransitionSeries.Sequence name="02 대리 참석" durationInFrames={200}>
      <S2Proxy />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
    <TransitionSeries.Sequence name="03 침묵" durationInFrames={130}>
      <S3Silence />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
    <TransitionSeries.Sequence name="04 검증과 보류" durationInFrames={150}>
      <S4Verify />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
    <TransitionSeries.Sequence name="05 복귀" durationInFrames={160}>
      <S5Return />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
    <TransitionSeries.Sequence name="06 엔딩" durationInFrames={60}>
      <S6Ending />
    </TransitionSeries.Sequence>
  </TransitionSeries>
);
