import React from "react";
import { useCurrentFrame } from "remotion";
import { C } from "../theme";
import { ORDER, PEOPLE, ROOM } from "../data";
import { Avatar, Switch } from "./ui";
import { popIn, prog } from "../anim";

/** 회의방 왼쪽 패널. awayAt: 혜중·동준 대리 참석 스위치가 켜지는 프레임(음수면 이미 켜짐) */
export const Sidebar: React.FC<{ awayAt?: number; current?: number; back?: number }> = ({
  awayAt = -100,
  current = 0,
  back,
}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        width: 380,
        flex: "none",
        background: C.panel2,
        borderRight: `1px solid ${C.line}`,
        padding: "26px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 8 }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 16,
            background: C.accent,
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: 24,
          }}
        >
          4
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 23 }}>{ROOM.title}</div>
          <div style={{ fontSize: 17, color: C.muted }}>{ROOM.agenda}</div>
        </div>
      </div>

      <div style={{ fontSize: 17, fontWeight: 700, color: C.muted, padding: "10px 6px 0" }}>쟁점</div>
      {ROOM.issues.map((t, i) => (
        <div
          key={t}
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            padding: "9px 10px",
            borderRadius: 14,
            background: i === current ? C.panel : "transparent",
            boxShadow: i === current ? `inset 0 0 0 1px ${C.line}` : "none",
            fontSize: 20,
            fontWeight: i === current ? 700 : 500,
            color: i === current ? C.ink : C.ink2,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 99,
              display: "grid",
              placeItems: "center",
              fontSize: 15,
              fontWeight: 700,
              background: i === current ? C.accent : C.sunken,
              color: i === current ? "#fff" : C.muted,
            }}
          >
            {i + 1}
          </div>
          {t}
        </div>
      ))}

      <div style={{ fontSize: 17, fontWeight: 700, color: C.muted, padding: "16px 6px 0" }}>팀원</div>
      {ORDER.map((id) => {
        const p = PEOPLE[id];
        const isAway = id === "hyejung" || id === "dongjun";
        const at = awayAt + (id === "dongjun" ? 8 : 0);
        let on = isAway ? prog(frame, at, 10) : 0;
        if (back !== undefined && id === "hyejung") on = on * (1 - prog(frame, back, 10));
        const mini = popIn(frame, at + 6, 14);
        return (
          <div
            key={id}
            style={{ display: "flex", gap: 24, alignItems: "center", padding: "7px 8px" }}
          >
            <div style={{ position: "relative" }}>
              <Avatar who={id} size={44} style={{ opacity: isAway ? 1 - on * 0.55 : 1 }} />
              {isAway ? (
                <Avatar
                  who={id}
                  mini
                  size={28}
                  style={{
                    position: "absolute",
                    right: -10,
                    bottom: -6,
                    fontSize: 13,
                    background: C.panel,
                    opacity: on,
                    scale: `${mini * on}`,
                  }}
                />
              ) : null}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 20 }}>{p.name}</div>
              <div style={{ fontSize: 15.5, color: isAway && on > 0.5 ? p.color : C.muted, fontWeight: isAway && on > 0.5 ? 700 : 400 }}>
                {isAway && on > 0.5 ? "미니미가 대리 참석 중" : p.role}
              </div>
            </div>
            {isAway ? <Switch on={on} /> : null}
          </div>
        );
      })}
    </div>
  );
};
