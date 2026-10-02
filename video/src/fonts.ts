// IBM Plex Sans KR (앱과 같은 폰트). npm 패키지로 번들에 넣어 오프라인에서도 렌더된다.
import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "@fontsource/ibm-plex-sans-kr/700.css";
import { continueRender, delayRender } from "remotion";
import { ALL_TEXT } from "./data";

let started = false;

/** 쓰는 글자의 unicode-range 조각만 골라 미리 불러온 뒤 렌더를 시작한다 */
export const ensureFonts = () => {
  if (started || typeof document === "undefined") return;
  started = true;
  const handle = delayRender("IBM Plex Sans KR 불러오는 중");
  Promise.all(
    ["400", "600", "700"].map((w) =>
      document.fonts.load(`${w} 32px "IBM Plex Sans KR"`, ALL_TEXT),
    ),
  )
    .catch(() => undefined)
    .finally(() => continueRender(handle));
};
