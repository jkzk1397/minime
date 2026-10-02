// 대사·장면 길이는 여기서만 고치면 된다.

export type PersonId = "jongwon" | "hyejung" | "jungmin" | "dongjun";

export const PEOPLE: Record<
  PersonId,
  { name: string; role: string; color: string; initial: string }
> = {
  jongwon: { name: "종원", role: "팀장 · 사회", color: "#4f63e6", initial: "종" },
  hyejung: { name: "혜중", role: "자료조사", color: "#c24c19", initial: "혜" },
  jungmin: { name: "정민", role: "발표 · PPT", color: "#14855f", initial: "정" },
  dongjun: { name: "동준", role: "반론 · 질의응답", color: "#d23c72", initial: "동" },
};

export const ORDER: PersonId[] = ["jongwon", "hyejung", "jungmin", "dongjun"];

export const ROOM = {
  title: "스피치와 토론 4조",
  agenda: "축제 예산 정책 제안 발표 준비",
  issues: ["제안할 축제 예산안", "근거 자료 조사 방법", "발표 역할과 리허설 일정"],
};

export const CAPTIONS = {
  s1: "팀 회의 날, 2명이 못 온다면?",
  s2: "보고서 + 3분 인터뷰로 나만의 미니미 준비",
  s3: "못 온 사람 대신, 미니미가 근거를 들고 말해요",
  s4: "근거가 없으면 지어내지 않고 질문으로 남겨요",
  s5: "결론은 검증해서 보류하고, 돌아온 사람이 확인해요",
};

export const REPORT = {
  title: "축제 예산 자료조사 보고서",
  lines: [
    "작년 축제 예산 1억 2천만 원 중 60%가 연예인 섭외비",
    "만족도 조사(812명): 공연 3.6점, 체험 부스 4.2점",
    "바라는 점 1위: 학생 참여 프로그램 확대(38%)",
  ],
};

export const STANCES = [
  { issue: "예산안", claim: "B안 찬성 · 공연 1팀은 유지", src: "보고서 2·5문단" },
  { issue: "조사 방법", claim: "우리 학교 설문을 새로 하자", src: "인터뷰" },
  { issue: "역할", claim: "자료조사 + 질의응답 근거 정리", src: "인터뷰" },
];

export const INTERVIEW = {
  q: "근거 자료는 어떻게 조사하면 좋을까요?",
  a: "타 대학 사례보단 우리 학교 설문을 새로 하자",
};

export const CHAT = {
  jongwonA: "오늘은 예산안부터 정하자. 공연이 축제의 얼굴이라 A안이 현실적이라고 봐.",
  hyejungMiniLead: "데이터를 보면 조금 달라요. ",
  hyejungMiniEvidence: "작년 만족도 조사에서 체험 부스는 4.2점, 공연은 3.6점이었어요.",
  hyejungMiniTail: " 그래서 B안을 제안해요.",
  dongjunMiniLead: "B안이라면 운영 인력 계획이 같이 있어야 해요. ",
  dongjunMiniEvidence: "작년 체험 부스 3곳이 인원 부족으로 둘째 날 문을 닫았어요.",
  jungminAsk: "혜중 미니미, 무대 음향 장비 대여 업체는 알아봤어?",
  hyejungSilent: "그건 제 자료에 없어요. 혜중 님께 확인이 필요해요.",
  jungminConclude: "결론적으로 B안으로 가자. 학생 참여 프로그램이 만족도가 항상 더 높으니까 확실해.",
};

export const VERIFY = [
  { level: "warn", label: "근거 약함", text: "'항상'이라고 할 근거는 1회 조사뿐" },
  { level: "warn", label: "지난 발언과 충돌", text: "9/25 회의에선 A안 쪽이었어요" },
  { level: "info", label: "놓친 점", text: "운영 인력 확보 계획" },
  { level: "info", label: "반대 관점", text: "공연의 외부 홍보 효과" },
] as const;

export const MINUTES = [
  { issue: "제안할 축제 예산안", result: "B안 (공연 1팀 유지)", status: "보류" },
  { issue: "근거 자료 조사 방법", result: "학교 설문 + 타 대학 사례", status: "확정" },
  { issue: "발표 역할과 리허설 일정", result: "리허설 날짜 미정", status: "확인 필요" },
] as const;


// 폰트 미리 불러오기용: 영상에 쓰인 글자 전부
export const ALL_TEXT = JSON.stringify([
  PEOPLE,
  ROOM,
  CAPTIONS,
  REPORT,
  STANCES,
  INTERVIEW,
  CHAT,
  VERIFY,
  MINUTES,
  "내 미니미 준비 준비도 입장 카드 맞아요 고칠래요 대리 참석 의 미니미 · AI 출처 보고서 2문단 개입 점수 복귀 후 확인할 질문으로 남김 결정 · 보류 불참자(혜중·동준)에게 영향 → 복귀 후 확인 2차 검증 회의록 내가 빠진 사이 승인 이의 승인함 이의 남김 수업 때문에 불참 확인됨 후보 0123456789/.:%·…",
]);
