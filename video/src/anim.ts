import { Easing, interpolate } from "remotion";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** start부터 dur 프레임 동안 0 → 1 (부드러운 스프링 느낌) */
export const prog = (frame: number, start: number, dur = 14) =>
  interpolate(frame, [start, start + dur], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

/** 살짝 튀는 등장 (overshoot) */
export const popIn = (frame: number, start: number, dur = 16) =>
  interpolate(frame, [start, start + dur], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.34, 1.56, 0.64, 1),
  });

export const lin = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], clamp);

export const mix = (t: number, a: number, b: number) => a + (b - a) * t;

/** 타이핑: start부터 cps(글자/프레임) 속도로 */
export const typed = (text: string, frame: number, start: number, cpf = 1.2) => {
  const n = Math.max(0, Math.floor((frame - start) * cpf));
  return text.slice(0, n);
};
