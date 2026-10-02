// 이름·색·자막·대사는 여기서만 고치면 된다.

export type PersonId = "jongwon" | "hyejung" | "jungmin" | "dongjun";

export const PEOPLE: Record<PersonId, { name: string; color: string }> = {
  jongwon: { name: "종원", color: "#4f63e6" },
  hyejung: { name: "혜중", color: "#c24c19" },
  jungmin: { name: "정민", color: "#14855f" },
  dongjun: { name: "동준", color: "#d23c72" },
};

export const CAPTIONS = {
  intro1: "회의에 못 가게 됐다면?",
  intro2: "내 미니미가 대신 갈게요",
  prepare: "보고서 + 인터뷰 → 나만의 미니미",
  proxy: "빈자리엔 미니미가, 근거를 들고",
  silence: "근거가 없으면, 말하지 않아요",
  verify: "결론은 한 번 더 검증, 빠진 사람 몫은 보류",
  back: "돌아오면, 확인만 하면 끝",
};

export const LINES = {
  conflict: "수업이랑 겹쳐요",
  room: "팀 회의 · 오후 2시",
  report: "보고서",
  interviewQ: "조사 방법은?",
  interviewA: "우리 학교 설문 새로 하자",
  ok: "맞아요",
  stances: [
    { k: "예산안", v: "B안" },
    { k: "조사", v: "학교 설문" },
    { k: "역할", v: "자료조사" },
  ],
  jongwon: "A안이 현실적이야",
  hyejungMini: "B안이요!",
  hyejungEvidence: "만족도 4.2 > 3.6",
  dongjunMini: "인력 계획이 필요해요",
  dongjunEvidence: "작년 부스 3곳 중단",
  jungminAsk: "음향 업체는 알아봤어?",
  noEvidence: "근거 없음",
  questionNote: "음향 업체?",
  tray: "혜중에게 물어볼 것",
  decision: "B안으로 확정!",
  checks: [
    { tone: "warn", mark: "!", text: "근거 약함" },
    { tone: "warn", mark: "!", text: "지난 발언과 충돌" },
    { tone: "info", mark: "?", text: "놓친 점: 인력" },
  ],
  hold: "보류",
  holdSub: "혜중·동준 확인 대기",
  digest: "내가 빠진 사이",
  digestRows: ["예산안 · B안", "역할 분담"],
  digestQ: "남긴 질문 1개 · 음향 업체",
  approve: "승인",
  object: "이의",
};

// 폰트 미리 불러오기용: 영상에 쓰인 글자 전부
export const ALL_TEXT = JSON.stringify([PEOPLE, CAPTIONS, LINES, "의 미니미 ✓ ✕ ! ? 01 02 03 04 05 / 1/3 2/3 3/3 준비도"]);
