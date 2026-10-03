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
  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, fontSize: 30, fontWeight: 600, color }}>
    <DocIcon size={30} color={color} lines={3} highlight={1} />
    <span
      style={{
        backgroundImage: `linear-gradient(${tint(color, 45)}, ${tint(color, 45)})`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "0 100%",
        backgroundSize: `${progress * 100}% 6px`,
        paddingBottom: 4,
      }}
    >
      {children}
    </span>
  </div>
);

export const S2Proxy: React.FC = () => {
  const frame = useCurrentFrame();
  const hj = PEOPLE.hyejung.color;
  const dj = PEOPLE.dongjun.color;
  return (
    <AbsoluteFill>
      <Stage>
        <Caption step="02" text={CAPTIONS.proxy} />
        <MeetingTable
          seats={{ jongwon: "person", hyejung: "minime", jungmin: "person", dongjun: "minime" }}
          at={{ jongwon: 6, hyejung: 14, jungmin: 22, dongjun: 30 }}
        />
        <Bubble who="jongwon" at={44} tail="bottom-right" style={{ right: 1920 - 650, top: 300 }}>
          {LINES.jongwon}
        </Bubble>
        <Bubble who="hyejung" mini at={80} tail="bottom-left" style={{ left: 1260, top: 250 }}>
          {LINES.hyejungMini}
          <EvidenceLine color={hj} progress={prog(frame, 94, 20)}>
            {LINES.hyejungEvidence}
          </EvidenceLine>
        </Bubble>
        <Bubble who="dongjun" mini at={130} tail="top-left" style={{ left: 1270, top: 760 }}>
          {LINES.dongjunMini}
          <EvidenceLine color={dj} progress={prog(frame, 144, 20)}>
            {LINES.dongjunEvidence}
          </EvidenceLine>
        </Bubble>
      </Stage>

      {[6, 14, 22, 30].map((f) => (
        <Sfx key={f} at={f} name="soft-pop" volume={0.35} />
      ))}
      <Sfx at={44} name="pop" volume={0.4} />
      <Sfx at={80} name="pop" volume={0.45} />
      <Sfx at={100} name="select" volume={0.4} />
      <Sfx at={130} name="pop" volume={0.45} />
      <Sfx at={150} name="select" volume={0.4} />
    </AbsoluteFill>
  );
};
