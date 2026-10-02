import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Sfx } from "../components/Sfx";
import { MINUTES } from "../data";
import { Avatar, Chip, Cursor } from "../components/ui";
import { mix, popIn, prog } from "../anim";
import { C, SHADOW_SOFT } from "../theme";

const tone = (s: string) => (s === "확정" ? "ok" : s === "보류" ? "warn" : "info") as "ok" | "warn" | "info";

const Btn: React.FC<{
  x: number;
  y: number;
  w: number;
  label: string;
  doneLabel: string;
  doneAt: number;
  color: string;
  soft: string;
  fade?: number;
}> = ({ x, y, w, label, doneLabel, doneAt, color, soft, fade = 1 }) => {
  const frame = useCurrentFrame();
  const done = frame >= doneAt;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: 52,
        borderRadius: 14,
        display: "grid",
        placeItems: "center",
        fontSize: 22,
        fontWeight: 700,
        background: done ? color : soft,
        color: done ? "#fff" : color,
        opacity: fade,
        scale: frame >= doneAt - 2 && frame < doneAt + 4 ? "0.92" : "1",
        zIndex: 3,
      }}
    >
      {done ? doneLabel : label}
    </div>
  );
};

/** 회의록 + 내가 빠진 사이. 5번 장면 안에서 브라우저 내용으로 쓰인다 (프레임 0부터 시작) */
export const ReturnContent: React.FC = () => {
  const frame = useCurrentFrame();
  const minutesIn = popIn(frame, 4, 18);
  const digestIn = popIn(frame, 30, 18);
  const approveAt = 66;
  const objectAt = 96;

  const card: React.CSSProperties = {
    position: "absolute",
    top: 40,
    height: 680,
    borderRadius: 22,
    background: C.panel,
    border: `1.5px solid ${C.line}`,
    boxShadow: SHADOW_SOFT,
    padding: "28px 30px",
  };

  return (
    <AbsoluteFill style={{ opacity: prog(frame, 0, 14) }}>
          <div style={{ position: "absolute", inset: 0, background: C.panel2 }}>
            {/* 회의록 */}
            <div
              style={{
                ...card,
                left: 48,
                width: 720,
                opacity: minutesIn,
                translate: `0px ${mix(minutesIn, 50, 0)}px`,
              }}
            >
              <div style={{ fontSize: 18, color: C.muted }}>회의 종료 · 쟁점별 정리</div>
              <div style={{ fontSize: 34, fontWeight: 700, marginBottom: 18 }}>회의록</div>
              {MINUTES.map((m, i) => {
                const t = prog(frame, 12 + i * 8, 12);
                return (
                  <div
                    key={m.issue}
                    style={{
                      opacity: t,
                      translate: `0px ${mix(t, 16, 0)}px`,
                      padding: "20px 4px",
                      borderTop: `1px solid ${C.line}`,
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 24, fontWeight: 700 }}>{m.issue}</div>
                      <div style={{ fontSize: 21, color: C.muted }}>{m.result}</div>
                    </div>
                    <Chip tone={tone(m.status)} size={20}>
                      {m.status}
                    </Chip>
                  </div>
                );
              })}
              <div
                style={{
                  marginTop: 16,
                  fontSize: 19,
                  color: C.muted,
                  opacity: prog(frame, 40, 10),
                }}
              >
                ↓ minutes.md 내보내기
              </div>
            </div>

            {/* 내가 빠진 사이 */}
            <div
              style={{
                ...card,
                left: 816,
                width: 736,
                opacity: digestIn,
                translate: `${mix(digestIn, 60, 0)}px 0px`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <Avatar who="hyejung" size={56} />
                <div>
                  <div style={{ fontSize: 18, color: C.muted }}>혜중 님, 다시 오셨네요</div>
                  <div style={{ fontSize: 34, fontWeight: 700 }}>내가 빠진 사이</div>
                </div>
              </div>

              {[
                { y: 150, title: "예산안: B안 (공연 1팀 유지)", sub: "미니미가 근거 2개로 B안을 지지했어요" },
                { y: 330, title: "발표 역할 분담", sub: "혜중: 질의응답 근거 정리" },
              ].map((r) => (
                <div
                  key={r.title}
                  style={{
                    position: "absolute",
                    left: 30,
                    right: 30,
                    top: r.y,
                    height: 160,
                    borderRadius: 18,
                    background: C.panel2,
                    padding: "20px 22px",
                  }}
                >
                  <Chip tone="warn" size={17}>
                    보류 결정
                  </Chip>
                  <div style={{ fontSize: 25, fontWeight: 700, marginTop: 10 }}>{r.title}</div>
                  <div style={{ fontSize: 20, color: C.muted }}>{r.sub}</div>
                </div>
              ))}
              <div
                style={{
                  position: "absolute",
                  left: 30,
                  right: 30,
                  top: 514,
                  fontSize: 20,
                  color: C.bad,
                  fontWeight: 600,
                  opacity: prog(frame, objectAt + 2, 10),
                }}
              >
                "설문 결과 슬라이드는 제가 직접 발표하고 싶어요."
              </div>
              <div
                style={{
                  position: "absolute",
                  left: 30,
                  right: 30,
                  top: 580,
                  fontSize: 20,
                  color: C.muted,
                  opacity: prog(frame, 44, 10),
                }}
              >
                ? 미니미가 남긴 질문 1개 · 음향 장비 업체
              </div>
            </div>

            {/* 버튼 (커서 좌표와 맞추려고 절대 위치) */}
            <div style={{ opacity: digestIn }}>
              <Btn x={1244} y={252} w={130} label="승인" doneLabel="✓ 승인함" doneAt={approveAt} color={C.ok} soft={C.okSoft} />
              <Btn x={1390} y={252} w={130} label="이의" doneLabel="이의" doneAt={9999} color={C.bad} soft={C.badSoft} fade={1 - prog(frame, approveAt, 8) * 0.6} />
              <Btn x={1244} y={432} w={130} label="승인" doneLabel="승인" doneAt={9999} color={C.ok} soft={C.okSoft} fade={1 - prog(frame, objectAt, 8) * 0.6} />
              <Btn x={1390} y={432} w={130} label="이의" doneLabel="이의 남김" doneAt={objectAt} color={C.bad} soft={C.badSoft} />
            </div>

            <Cursor
              path={[
                { f: 44, x: 1100, y: 640 },
                { f: 62, x: 1312, y: 282 },
                { f: 78, x: 1312, y: 282 },
                { f: 92, x: 1458, y: 462 },
              ]}
              clickAt={[approveAt, objectAt]}
            />
          </div>
      <Sfx at={4} name="pop" volume={0.5} />
      <Sfx at={30} name="pop" volume={0.5} />
      <Sfx at={approveAt} name="click" volume={0.9} />
      <Sfx at={approveAt + 1} name="confirm" volume={0.55} />
      <Sfx at={objectAt} name="click" volume={0.9} />
      <Sfx at={objectAt + 1} name="stamp" volume={0.45} />
    </AbsoluteFill>
  );
};
