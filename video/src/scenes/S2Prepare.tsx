import React from "react";
import { AbsoluteFill, Interactive, useCurrentFrame } from "remotion";
import { CAPTIONS, INTERVIEW, PEOPLE, REPORT, STANCES } from "../data";
import { Avatar, BrowserFrame, Caption, Chip, Cursor, Stage } from "../components/ui";
import { ReadinessRing } from "../components/ReadinessRing";
import { lin, mix, popIn, prog, typed } from "../anim";
import { C, SHADOW_SOFT, tint } from "../theme";
import { Sfx, Typing } from "../components/Sfx";
import { ensureFonts } from "../fonts";

ensureFonts();

const HJ = PEOPLE.hyejung.color;

const StanceCard: React.FC<{ i: number; at: number }> = ({ i, at }) => {
  const frame = useCurrentFrame();
  const t = popIn(frame, at, 16);
  const s = STANCES[i];
  const fromReport = i === 0;
  return (
    <div
      style={{
        opacity: Math.min(1, t * 1.5),
        scale: `${mix(t, 0.85, 1)}`,
        translate: `${mix(t, 40, 0)}px 0px`,
        background: C.panel,
        borderRadius: 20,
        border: `1.5px solid ${C.line}`,
        boxShadow: SHADOW_SOFT,
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Chip tone="plain" size={18}>
          {s.issue}
        </Chip>
        <Chip tone="ok" size={18}>
          ✓ 확인됨
        </Chip>
        <span style={{ marginLeft: "auto", fontSize: 18, color: C.faint }}>
          {fromReport ? "출처 · " : "답변 · "}
          {s.src}
        </span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{s.claim}</div>
    </div>
  );
};

export const S2Prepare: React.FC = () => {
  const frame = useCurrentFrame();

  // 타이밍
  const reportIn = popIn(frame, 16, 18);
  const lineStart = [36, 54, 72];
  const qAt = 104;
  const aAt = 116;
  const clickAt = 158;
  const btnIn = popIn(frame, 140, 12);
  const pressed = frame >= clickAt;
  const ready = mix(lin(frame, 100, 112), 0, 1 / 3) + mix(lin(frame, 166, 184), 0, 2 / 3);

  return (
    <AbsoluteFill>
      <Stage>
        <Caption step="02" text={CAPTIONS.s2} />
        <BrowserFrame enter>
          <div style={{ position: "absolute", inset: 0, background: C.panel }}>
            {/* 헤더 */}
            <div
              style={{
                position: "absolute",
                left: 48,
                right: 48,
                top: 28,
                height: 120,
                display: "flex",
                alignItems: "center",
                gap: 20,
                borderBottom: `1px solid ${C.line}`,
              }}
            >
              <Avatar who="hyejung" size={64} />
              <div>
                <div style={{ fontSize: 20, color: C.muted }}>혜중 · 자료조사</div>
                <div style={{ fontSize: 36, fontWeight: 700 }}>내 미니미 준비</div>
              </div>
              <div style={{ marginLeft: "auto", paddingBottom: 6 }}>
                <ReadinessRing value={ready} size={100} />
              </div>
            </div>

            {/* 왼쪽: 보고서 + 인터뷰 */}
            <Interactive.Div
              name="Report card"
              style={{
                position: "absolute",
                left: 48,
                top: 176,
                width: 720,
                padding: "24px 28px",
                borderRadius: 20,
                background: C.panel2,
                border: `1.5px solid ${C.line}`,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <div
                style={{
                  opacity: reportIn,
                  translate: `0px ${mix(reportIn, -40, 0)}px`,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 52,
                    borderRadius: 8,
                    background: C.panel,
                    border: `2px solid ${C.line2}`,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 14,
                    fontWeight: 700,
                    color: C.muted,
                    letterSpacing: 0,
                  }}
                >
                  .md
                </div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{REPORT.title}</div>
              </div>
              {REPORT.lines.map((l, i) => {
                const txt = typed(l, frame, lineStart[i], 1.6);
                return (
                  <div
                    key={l}
                    style={{
                      fontSize: 23,
                      color: C.ink2,
                      minHeight: 36,
                      paddingLeft: 4,
                      borderLeft: txt ? `4px solid ${tint(HJ, 40)}` : "4px solid transparent",
                      paddingInlineStart: 16,
                    }}
                  >
                    {txt}
                  </div>
                );
              })}
            </Interactive.Div>

            {/* 인터뷰 */}
            <div style={{ position: "absolute", left: 48, top: 452, width: 720 }}>
              <div
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "flex-start",
                  opacity: prog(frame, qAt, 10),
                  translate: `0px ${mix(prog(frame, qAt, 14), 24, 0)}px`,
                }}
              >
                <Avatar who="hyejung" mini size={48} />
                <div
                  style={{
                    background: tint(HJ, 12),
                    border: `2.5px dashed ${HJ}`,
                    borderRadius: "6px 20px 20px 20px",
                    padding: "12px 20px",
                    fontSize: 24,
                  }}
                >
                  <span style={{ fontWeight: 700, color: HJ }}>인터뷰 · </span>
                  {INTERVIEW.q}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  marginTop: 16,
                  opacity: prog(frame, aAt - 4, 8),
                }}
              >
                <div
                  style={{
                    background: HJ,
                    color: "#fff",
                    borderRadius: "20px 6px 20px 20px",
                    padding: "12px 20px",
                    fontSize: 24,
                    minHeight: 60,
                    minWidth: 40,
                  }}
                >
                  {typed(INTERVIEW.a, frame, aAt, 1.3)}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 14,
                  marginTop: 18,
                  opacity: btnIn,
                  scale: `${mix(btnIn, 0.8, 1)}`,
                }}
              >
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 600,
                    color: C.ink2,
                    padding: "12px 24px",
                    borderRadius: 14,
                    boxShadow: `inset 0 0 0 1.5px ${C.line2}`,
                  }}
                >
                  고칠래요
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    padding: "12px 28px",
                    borderRadius: 14,
                    background: pressed ? C.ok : C.ink,
                    color: "#fff",
                    scale: frame >= clickAt - 2 && frame < clickAt + 4 ? "0.94" : "1",
                  }}
                >
                  {pressed ? "✓ 맞아요" : "맞아요"}
                </div>
              </div>
            </div>

            {/* 화살표 */}
            <div
              style={{
                position: "absolute",
                left: 784,
                top: 280,
                fontSize: 44,
                color: C.accent,
                opacity: prog(frame, 92, 10),
                translate: `${mix(prog(frame, 92, 14), -20, 0)}px 0px`,
              }}
            >
              →
            </div>

            {/* 오른쪽: 입장 카드 */}
            <div
              style={{
                position: "absolute",
                left: 848,
                right: 48,
                top: 176,
                display: "flex",
                flexDirection: "column",
                gap: 18,
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 700, color: C.muted, opacity: prog(frame, 90, 10) }}>
                입장 카드
              </div>
              <StanceCard i={0} at={96} />
              <StanceCard i={1} at={164} />
              <StanceCard i={2} at={172} />
            </div>

            <Cursor
              path={[
                { f: 132, x: 1200, y: 740 },
                { f: 154, x: 690, y: 700 },
              ]}
              clickAt={[clickAt]}
            />
          </div>
        </BrowserFrame>
      </Stage>
      <Sfx at={16} name="pop" volume={0.55} />
      <Typing start={36} count={18} />
      <Sfx at={92} name="slide" volume={0.35} />
      <Sfx at={96} name="pop2" volume={0.55} />
      <Sfx at={104} name="select" volume={0.5} />
      <Sfx at={104} name="pop" volume={0.45} />
      <Typing start={116} count={10} />
      <Sfx at={140} name="pop2" volume={0.35} />
      <Sfx at={158} name="click" volume={0.9} />
      <Sfx at={160} name="confirm" volume={0.5} />
      <Sfx at={164} name="pop2" volume={0.5} />
      <Sfx at={172} name="pop2" volume={0.5} />
      <Sfx at={184} name="confirm" volume={0.6} />
    </AbsoluteFill>
  );
};
