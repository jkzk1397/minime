import React from "react";
import { Audio } from "@remotion/media";
import { Sequence, staticFile } from "remotion";

export type SfxName =
  | "pop"
  | "soft-pop"
  | "click"
  | "toggle"
  | "confirm"
  | "question"
  | "stamp"
  | "slide"
  | "select"
  | "tick"
  | "sparkle"
  | "soft-out"
  | "chime";

/** at 프레임에 효과음 하나. 파일은 public/sfx (Kenney CC0 + 직접 합성) */
export const Sfx: React.FC<{ at: number; name: SfxName; volume?: number }> = ({ at, name, volume = 0.6 }) => (
  <Sequence from={Math.max(0, Math.round(at))} durationInFrames={90} layout="none" name={`SFX ${name}`}>
    <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
  </Sequence>
);

/** 타이핑 소리: start부터 every 프레임마다 count번 */
export const Typing: React.FC<{ start: number; count: number; every?: number; volume?: number }> = ({
  start,
  count,
  every = 3,
  volume = 0.25,
}) => (
  <>
    {Array.from({ length: count }, (_, i) => (
      <Sfx key={i} at={start + i * every} name="tick" volume={volume * (i % 3 === 1 ? 0.75 : 1)} />
    ))}
  </>
);
