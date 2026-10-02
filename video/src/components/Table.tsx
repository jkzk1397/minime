import React from "react";
import { useCurrentFrame } from "remotion";
import { C } from "../theme";
import { PersonId } from "../data";
import { mix, popIn } from "../anim";
import { Minime, Person } from "./characters";

export type SeatKind = "person" | "minime" | "empty" | "none";

/** 자리 좌표 (1920×1080 기준). 위쪽 줄은 탁자 뒤, 아래쪽 줄은 탁자 앞 */
export const SEATS: Record<PersonId, { x: number; y: number; row: "top" | "bottom" }> = {
  jongwon: { x: 760, y: 588, row: "top" },
  hyejung: { x: 1160, y: 588, row: "top" },
  jungmin: { x: 760, y: 930, row: "bottom" },
  dongjun: { x: 1160, y: 930, row: "bottom" },
};
export const TABLE = { x: 560, y: 590, w: 800, h: 150 };

const Seat: React.FC<{ who: PersonId; kind: SeatKind; at: number; mouth?: "none" | "zip" }> = ({
  who,
  kind,
  at,
  mouth,
}) => {
  const frame = useCurrentFrame();
  const t = popIn(frame, at, 16);
  const s = SEATS[who];
  if (kind === "none") return null;
  return (
    <div
      style={{
        position: "absolute",
        left: s.x,
        top: s.y,
        translate: "-50% -100%",
        opacity: Math.min(1, t * 1.5),
        scale: `${mix(t, 0.5, 1)}`,
        transformOrigin: "50% 100%",
        zIndex: s.row === "top" ? 1 : 3,
      }}
    >
      {kind === "person" ? <Person who={who} size={190} label /> : null}
      {kind === "minime" ? <Minime who={who} size={170} label blinkAt={[at + 40, at + 120]} mouth={mouth} /> : null}
      {kind === "empty" ? (
        <div style={{ width: 150, height: 170, display: "grid", placeItems: "end center" }}>
          <div style={{ width: 120, height: 120, borderRadius: 30, border: `4px dashed ${C.line2}` }} />
        </div>
      ) : null}
    </div>
  );
};

export const MeetingTable: React.FC<{
  seats: Partial<Record<PersonId, SeatKind>>;
  at?: Partial<Record<PersonId, number>>;
  mouth?: Partial<Record<PersonId, "none" | "zip">>;
}> = ({ seats, at = {}, mouth = {} }) => (
  <>
    {(Object.keys(SEATS) as PersonId[]).map((id) => (
      <Seat key={id} who={id} kind={seats[id] ?? "none"} at={at[id] ?? -100} mouth={mouth[id]} />
    ))}
    <div
      style={{
        position: "absolute",
        left: TABLE.x,
        top: TABLE.y,
        width: TABLE.w,
        height: TABLE.h,
        borderRadius: 75,
        background: "#ffffff",
        boxShadow: `inset 0 0 0 3px ${C.line2}, 0 30px 50px -30px rgba(40,30,80,.4)`,
        zIndex: 2,
      }}
    />
  </>
);
