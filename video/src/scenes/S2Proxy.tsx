import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CAPTIONS, LINES, PEOPLE } from "../data";
import { Caption, Stage } from "../components/ui";
import { Bubble, DocIcon } from "../components/characters";
import { MeetingTable } from "../components/Table";
import { Sfx } from "../components/Sfx";
import { prog } from "../anim";
import { tint } from "../theme";
import { ensureFonts } from "../fonts";

ensureFonts();

/** 근거 한 줄: 문서 아이콘 + 밑줄이 그어지는 문장 */
export const EvidenceLine: React.FC<{ color: string; progress: number; children: React.ReactNode }> = ({
  color,
  progress,
  children,
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, fontSize: 38, fontWeight: 700, color }}>
    <DocIcon size={38} color={color} lines={3} highlight={1} />
    <span
      style={{
        backgroundImage: `linear-gradient(${tint(color, 45)}, ${tint(color, 45)})`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "0 100%",
        backgroundSize: `${progress * 100}% 7px`,
        paddingBottom: 4,
      }}
    >
      {children}
    </span>
  </div>
);

// 한 가지 사례만: 민준이 A안을 꺼내자, 지연의 미니미가 보고서 근거로 답한다
export const S2Proxy: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Stage>
        <Caption step="02" text={CAPTIONS.proxy} />
        <MeetingTable
          seats={{ minjun: "person", jiyeon: "minime", harin: "person", doyun: "minime" }}
          at={{ minjun: 4, jiyeon: 8, harin: 12, doyun: 16 }}
        />
        <Bubble who="minjun" at={26} tail="bottom-right" size={44} style={{ right: 1920 - 650, top: 290 }}>
          {LINES.minjun}
        </Bubble>
        <Bubble who="jiyeon" mini at={62} tail="bottom-left" size={44} style={{ left: 1260, top: 240 }}>
          {LINES.jiyeonMini}
          <EvidenceLine color={PEOPLE.jiyeon.color} progress={prog(frame, 80, 22)}>
            {LINES.jiyeonEvidence}
          </EvidenceLine>
        </Bubble>
      </Stage>

      {[4, 8, 12, 16].map((f) => (
        <Sfx key={f} at={f} name="soft-pop" volume={0.3} />
      ))}
      <Sfx at={26} name="pop" volume={0.4} />
      <Sfx at={62} name="pop" volume={0.45} />
      <Sfx at={82} name="select" volume={0.45} />
    </AbsoluteFill>
  );
};
