import React from "react";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { S0Intro } from "./scenes/S0Intro";
import { S1Prepare } from "./scenes/S1Prepare";
import { S2Proxy } from "./scenes/S2Proxy";
import { S3Silence } from "./scenes/S3Silence";
import { S4Confirm } from "./scenes/S4Confirm";
import { S6Ending } from "./scenes/S6Ending";
import { PhotoContext } from "./components/characters";

// 장면 길이 합 820 − 전환 12 × 5 = 760프레임(약 25초)
// photos=false → 실루엣, true → 팀원 사진
export const MinimeVideo: React.FC<{ photos?: boolean }> = ({
  photos = false,
}) => (
  <PhotoContext.Provider value={photos}>
    <TransitionSeries>
      <TransitionSeries.Sequence
        name="00 인트로: 미니미 탄생"
        durationInFrames={150}
      >
        <S0Intro />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 12 })}
      />
      <TransitionSeries.Sequence name="01 준비" durationInFrames={140}>
        <S1Prepare />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 12 })}
      />
      <TransitionSeries.Sequence
        name="02 근거로 대신 말하기"
        durationInFrames={140}
      >
        <S2Proxy />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 12 })}
      />
      <TransitionSeries.Sequence
        name="03 근거 없으면 침묵"
        durationInFrames={120}
      >
        <S3Silence />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 12 })}
      />
      <TransitionSeries.Sequence name="04 보류 → 확인" durationInFrames={190}>
        <S4Confirm />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 12 })}
      />
      <TransitionSeries.Sequence name="05 엔딩" durationInFrames={60}>
        <S6Ending />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </PhotoContext.Provider>
);
