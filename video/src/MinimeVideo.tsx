import React from "react";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Sfx } from "./components/Sfx";
import { S1Problem } from "./scenes/S1Problem";
import { S2Prepare } from "./scenes/S2Prepare";
import { S3Proxy } from "./scenes/S3Proxy";
import { S4Silence } from "./scenes/S4Silence";
import { S5Verify } from "./scenes/S5Verify";
import { S6Ending } from "./scenes/S6Ending";

// 장면 길이 합 1062 − 전환 12 × 5 = 1002프레임(약 33초)
// 장면 사이 전환 소리(whoosh) 위치: 각 전환이 시작되는 프레임
const TRANSITIONS_AT = [72, 260, 508, 636, 936];

export const MinimeVideo: React.FC = () => (
  <>
    <TransitionSeries>
      <TransitionSeries.Sequence name="01 문제 제기" durationInFrames={84}>
        <S1Problem />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
      <TransitionSeries.Sequence name="02 미니미 준비" durationInFrames={200}>
        <S2Prepare />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
      <TransitionSeries.Sequence name="03 대리 참석" durationInFrames={260}>
        <S3Proxy />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
      <TransitionSeries.Sequence name="04 침묵" durationInFrames={140}>
        <S4Silence />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
      <TransitionSeries.Sequence name="05 검증·보류 → 복귀" durationInFrames={312}>
        <S5Verify />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
      <TransitionSeries.Sequence name="06 엔딩" durationInFrames={66}>
        <S6Ending />
      </TransitionSeries.Sequence>
    </TransitionSeries>
    {TRANSITIONS_AT.map((f) => (
      <Sfx key={f} at={f - 2} name="whoosh" volume={0.3} />
    ))}
  </>
);
