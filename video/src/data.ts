// 이름·색·자막·대사는 여기서만 고치면 된다.

export type PersonId = "jongwon" | "hyejung" | "jungmin" | "dongjun";

export const PEOPLE: Record<PersonId, { name: string; color: string }> = {
  jongwon: { name: "종원", color: "#4f63e6" },
  hyejung: { name: "혜중", color: "#c24c19" },
  jungmin: { name: "정민", color: "#14855f" },
  dongjun: { name: "동준", color: "#d23c72" },
};

export const CAPTIONS = {
  intro1: "팀 회의 날, 둘이 못 간다면?",
  intro2: "우리 미니미가 대신 갈게요",
  prepare: "내 자료로 미니미를 준비하고",
  proxy: "회의에선 근거를 들고 대신 말하고",
  silence: "근거가 없으면 지어내지 않고",
  confirm: "중요한 결정은 돌아와서 확인해요",
};

export const LINES = {
  conflict: "둘 다 수업이랑 겹쳐요",
  room: "팀 회의 · 오후 2시",
  report: "보고서",
  interview: "3분 인터뷰",
  ready: "준비 완료",
  jongwon: "A안이 낫지 않아?",
  hyejungMini: "B안이요!",
  hyejungEvidence: "만족도 4.2 > 3.6",
  jungminAsk: "음향 업체는 알아봤어?",
  noEvidence: "근거 없음",
  silent: "혜중에게 물어볼게요",
  decision: "B안으로 확정!",
  hold: "보류",
  holdSub: "혜중·동준 확인 필요",
  confirmed: "확정",
};

// 폰트 미리 불러오기용: 영상에 쓰인 글자 전부
export const ALL_TEXT = JSON.stringify([PEOPLE, CAPTIONS, LINES, "의 미니미 ✓ ✕ ! ? … 01 02 03 04"]);
