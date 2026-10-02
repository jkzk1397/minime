"""시연·평가 공용 시나리오: '스피치와 토론' 4조 — 캠퍼스 정책 제안 발표 준비 회의.

- 종원(팀장·사회): A안 지지. 보고서 + 확인된 입장 있음
- 혜중(자료조사): 시연 1장면에서 보고서를 올리고 인터뷰로 준비도를 채운다 (처음엔 프로필만)
- 정민(발표·PPT): 지난 회의에선 A안 쪽 발언 → 오늘 B안 결론 → 2차 검증에서 '이전 발언과 충돌'
- 동준(반론·질의응답): B안 + 양보 불가선(운영 인력 계획). 리허설 날짜는 모름 → 약속 요청 시 보류
"""
from __future__ import annotations

import time

from .models import Issue, Persona, Profile, Report, Room, Scope, Stance, new_id

ISSUES = [
    Issue("i1", "제안할 축제 예산안 정하기", [
        {"label": "A안", "keywords": ["연예인", "섭외", "공연", "가수", "아티스트", "무대", "섭외비"]},
        {"label": "B안", "keywords": ["학생 참여", "참여형", "동아리", "부스", "체험", "참여 프로그램"]},
    ]),
    Issue("i2", "근거 자료 조사 방법", [
        {"label": "설문조사", "keywords": ["설문", "설문조사", "온라인 설문"]},
        {"label": "타 대학 사례", "keywords": ["사례", "타 대학", "다른 학교", "다른 대학", "벤치마킹"]},
    ]),
    Issue("i3", "발표 역할과 리허설 일정", [], keywords=["역할", "리허설", "발표자", "사회", "질의응답", "일정", "맡"]),
]

HYEJUNG_REPORT = ("축제 예산 자료조사 보고서", [
    "작년 우리 학교 축제 예산은 총 1억 2천만 원이었고, 그중 60%인 7,200만 원이 연예인 섭외비로 쓰였다. "
    "학생 동아리 부스와 체험 프로그램에는 15%만 배정되었다.",
    "작년 축제 직후 총학생회가 실시한 만족도 조사(응답 812명)에서 연예인 공연 만족도는 3.6점, "
    "동아리·체험 부스 만족도는 4.2점이었다(5점 만점).",
    "같은 조사에서 '내년 축제에 바라는 점' 1위는 학생이 직접 참여하는 프로그램 확대(38%)였고, "
    "더 유명한 연예인 섭외는 21%로 2위였다.",
    "연예인 공연은 하루 저녁 2시간에 집중되지만, 참여형 프로그램은 축제 3일 내내 운영되어 시간당 비용이 훨씬 낮다.",
    "그래서 연예인 섭외비를 줄이고 학생 참여 프로그램 예산을 늘리는 B안을 제안해야 한다고 생각한다. "
    "다만 연예인 공연을 완전히 없애면 외부 홍보 효과가 줄 수 있으니 공연은 최소 1팀은 유지하는 것이 좋다.",
])

# 시연 1장면의 인터뷰 답 (한 줄로 대충 답한다 → AI가 풀어 쓰고 → 본인이 확인)
HYEJUNG_INTERVIEW_ANSWERS = {
    "i1": "맞아 B안. 근데 공연 1팀은 남기자",
    "i2": "타 대학 사례보단 우리 학교 설문을 새로 하자. 일주일 온라인으로",
    "i3": "나는 자료조사랑 질의응답 근거 정리 맡을게. 발표는 좀 부담돼",
}


def _stance(issue_id, claim, position="", reasons="", warrant="", red_line="", unknown="", priority=2,
            sources=None, origin="report") -> Stance:
    return Stance(new_id("s"), issue_id, claim, position, reasons, warrant, red_line, unknown, priority,
                  sources or [], "confirmed", origin)


def personas() -> list[Persona]:
    jongwon = Persona(
        "jongwon", "종원", "팀장 · 사회", 0,
        Profile(intro="4조 팀장. 회의 진행과 발표 사회를 맡음",
                expertise=["기획", "일정", "발표 흐름", "현실성", "홍보"],
                criteria=["실현 가능성", "청중 설득력", "준비 기간"],
                projects=["1학기 경영학원론 팀플에서 발표 사회와 기획 담당"],
                tone_examples=["일단 핵심부터 정하자.", "그건 현실적으로 가능할까?", "좋아, 그럼 이렇게 가자."]),
        Scope("opinion"),
    )
    jongwon.reports = [Report("r1", "발표 기획 메모", [
        "정책 제안 발표는 청중인 교수님과 다른 조가 실현 가능하다고 느끼는 것이 가장 중요하다.",
        "연예인 공연은 축제의 얼굴이다. 작년 축제 관련 SNS 게시물의 70%가 공연 영상이었고, "
        "외부 방문객도 공연이 있던 날 가장 많았다.",
        "그래서 연예인 공연 예산을 유지하는 A안이 현실적이라고 본다. 총학생회도 공연을 줄이는 것을 부담스러워한다.",
        "발표는 10분, 질의응답은 5분이다. 나는 사회와 도입·결론을 맡겠다.",
        "리허설은 발표 전에 최소 두 번 해야 한다.",
    ])]
    jongwon.stances = [
        _stance("i1", "연예인 공연 예산을 유지하는 A안이 현실적이에요.", "A안",
                "작년 축제 SNS 게시물의 70%가 공연 영상이었고 외부 방문객도 공연 날 가장 많았어요.",
                "축제는 학교 홍보 수단이기도 하다", priority=1, sources=["보고서 2문단", "보고서 3문단"]),
        _stance("i3", "저는 사회와 도입·결론을 맡고, 리허설은 최소 두 번 해야 해요.", "",
                "발표 10분, 질의응답 5분 구성이에요.", sources=["보고서 4문단", "보고서 5문단"]),
    ]

    hyejung = Persona(
        "hyejung", "혜중", "자료조사", 1,
        Profile(intro="4조 자료조사 담당. 숫자와 근거를 챙김",
                expertise=["자료조사", "설문", "통계", "예산", "만족도"],
                criteria=["학생 만족도 데이터", "비용 대비 효과", "근거의 출처"],
                projects=["교양 통계학 수업에서 설문 설계와 분석 과제 수행"],
                tone_examples=["데이터를 보면 조금 다른 것 같아요.", "근거부터 확인하고 정하면 좋겠어요."]),
        Scope("opinion"),
    )

    jungmin = Persona(
        "jungmin", "정민", "발표 · PPT", 2,
        Profile(intro="4조 발표자. 슬라이드 디자인과 본론 발표 담당",
                expertise=["발표", "슬라이드", "디자인", "스토리텔링", "청중"],
                criteria=["청중의 공감", "한눈에 보이는 자료", "발표 흐름"],
                projects=["학과 홍보 영상 제작 동아리에서 편집 담당"],
                tone_examples=["오 그거 좋을 듯!", "그래프로 보여 주면 훨씬 잘 보일 것 같아."]),
        Scope("opinion"),
    )
    jungmin.reports = [Report("r1", "발표 구성안", [
        "발표 흐름은 문제 제기, 현황 데이터, 제안, 기대 효과, 질의응답 순서가 좋다.",
        "슬라이드는 12장 이내로 만들고 숫자 데이터는 그래프로 보여 준다.",
        "청중의 공감을 얻으려면 학생들이 직접 겪은 사례나 짧은 인터뷰 영상이 효과적이다.",
        "어느 예산안이든 학생들이 실제로 원하는 것이라는 근거가 있으면 설득력이 생긴다.",
    ])]
    jungmin.stances = [
        _stance("i2", "설문 결과를 그래프로 보여 주고 싶어서 설문조사에 찬성해요.", "설문조사",
                "숫자 데이터는 그래프로 보여 주면 청중이 바로 이해해요.", sources=["보고서 2문단"]),
        _stance("i3", "저는 본론 발표와 슬라이드 제작을 맡을게요.", "", "", sources=["보고서 1문단"]),
    ]
    jungmin.past = [{"text": "솔직히 연예인 공연 없으면 축제에 사람이 안 올 것 같아. A안도 나쁘지 않은 듯.",
                    "issue_id": "i1", "when": "지난 회의 (9/25)"}]

    dongjun = Persona(
        "dongjun", "동준", "반론 · 질의응답", 3,
        Profile(intro="4조 반론 대비와 질의응답 담당",
                expertise=["반론", "질의응답", "운영", "인력", "타 대학 사례"],
                criteria=["예상 반론에 버틸 수 있는가", "운영 가능성", "사례 근거"],
                projects=["토론 동아리 2년 활동, 교내 토론대회 준결승"],
                tone_examples=["반론 나오면 이렇게 받을 수 있어요.", "그 부분은 조건이 필요해요."]),
        Scope("opinion"),
    )
    dongjun.reports = [Report("r1", "예상 반론 정리", [
        "상대 조나 교수님이 할 반론은 학생 참여 프로그램은 준비 부담이 크고 참여율이 낮을 수 있다는 것이다.",
        "실제로 작년 체험 부스 중 3곳은 운영 인원이 부족해 둘째 날 문을 닫았다.",
        "그래서 B안을 주장하려면 운영 인력 확보 계획(동아리 연합, 봉사 시간 인정)을 반드시 같이 내야 한다.",
        "타 대학 사례로, 한 대학은 2024년 축제에서 연예인 공연을 1팀으로 줄이고 참여형 프로그램을 늘렸는데 "
        "방문객이 오히려 15% 늘었다.",
    ])]
    dongjun.stances = [
        _stance("i1", "B안에 찬성하지만, 운영 인력 확보 계획이 같이 있어야 해요.", "B안",
                "작년 체험 부스 3곳이 운영 인원이 부족해 둘째 날 문을 닫았어요.",
                "예상 반론에 버틸 수 있어야 한다", red_line="운영 인력 확보 계획 없이 B안을 내는 건 안 돼요",
                priority=1, sources=["보고서 2문단", "보고서 3문단"]),
        _stance("i2", "설문과 함께 타 대학 사례도 같이 조사하면 좋겠어요.", "타 대학 사례",
                "한 대학은 공연을 1팀으로 줄이고도 방문객이 15% 늘었어요.", sources=["보고서 4문단"]),
        _stance("i3", "저는 반론 대비와 질의응답을 맡을게요.", "", "", unknown="리허설 날짜는 아직 정하지 못했어요",
                origin="manual"),
    ]
    return [jongwon, hyejung, jungmin, dongjun]


EXAMPLES = {"hyejung": {"report_title": HYEJUNG_REPORT[0], "report_text": "\n\n".join(HYEJUNG_REPORT[1]),
                        "answers": HYEJUNG_INTERVIEW_ANSWERS}}


def example_for(room: Room, uid: str) -> dict | None:
    """시연 시나리오(같은 쟁점)로 만든 방에서만 예시 보고서·인터뷰 답을 준다. 실제 방에는 보이지 않는다."""
    titles = {i.title for i in room.issues}
    for examples, issues in ((EXAMPLES, ISSUES), (LIVE_EXAMPLES, LIVE_ISSUES)):
        ex = examples.get(uid)
        if ex and all(i.title in titles for i in issues):
            return ex
    return None


def seed_room(room: Room) -> Room:
    """빈 방에 시나리오를 채운다 (메시지·결정은 비운다)."""
    room.title = "스피치와 토론 · 4조"
    room.agenda = "캠퍼스 정책 제안 발표 준비: 축제 예산"
    room.issues = [Issue(i.id, i.title, [dict(o) for o in i.options], keywords=list(i.keywords)) for i in ISSUES]
    room.personas = {p.user_id: p for p in personas()}
    room.messages = []
    room.decisions = []
    room.drift = []
    room.gate_log = []
    room.current_issue = ""
    room.mode = "intervene"
    room.minutes = {}
    room.meeting = {"status": "idle", "started_at": 0.0, "ended_at": 0.0}
    room.last_reminder = 0.0
    for p in room.personas.values():
        p.touch()
    return room


def fresh_room(room_id: str) -> Room:
    r = Room(room_id=room_id)
    seed_room(r)
    r.meeting["seeded_at"] = time.time()
    return r


# ================================================================ 실전 시연 (발표자 동준의 화면에서 진행)
# 방을 만들 때 '실전 시연용'을 고르면: 종원·혜중·정민은 보고서와 확인된 입장이 미리 들어가 있고,
# 동준(발표자)만 프로필뿐이라 공유 화면에서 [예시 보고서 넣기] → 인터뷰 → 대리 참석을 직접 보여 준다.
# docs/06-실전-시연-대본.md · tests/test_live_demo.py 와 같은 내용.
LIVE_ISSUES = [
    Issue("i1", "제안할 축제 예산안", [dict(o) for o in ISSUES[0].options]),
    Issue("i2", "발표 역할 나누기", [], keywords=["역할", "발표자", "사회", "질의응답", "본론", "맡"]),
]

DONGJUN_REPORT = ("예상 반론과 운영 계획", [
    "작년 축제 체험 부스 중 3곳은 운영 인원이 부족해 둘째 날 문을 닫았다.",
    "한 대학은 2024년 축제에서 연예인 공연을 1팀으로 줄이고 참여형 프로그램을 늘렸는데 방문객이 오히려 15% 늘었다.",
    "상대 조나 교수님은 학생 참여 프로그램은 준비 부담이 크고 참여율이 낮을 수 있다고 반론할 것이다.",
    "그래서 나는 학생 참여 프로그램을 늘리는 B안이 맞다고 생각한다. "
    "다만 운영 인력 확보 계획(동아리 연합, 봉사 시간 인정)을 반드시 같이 내야 한다.",
])
LIVE_EXAMPLES = {"dj": {"report_title": DONGJUN_REPORT[0], "report_text": "\n\n".join(DONGJUN_REPORT[1]),
                        "answers": {"i1": "맞아 B안. 근데 운영 인력 계획은 꼭 같이 내야 해",
                                    "i2": "나는 반론 대비랑 질의응답 맡을게"}}}


def live_personas() -> list[Persona]:
    base = {p.user_id: p for p in personas()}
    jw, hj, jm, dj = base["jongwon"], base["hyejung"], base["jungmin"], base["dongjun"]
    jw.user_id, hj.user_id, jm.user_id, dj.user_id = "jw", "hj", "jm", "dj"
    jw.stances = [
        _stance("i1", "연예인 공연 예산을 유지하는 A안이 현실적이에요.", "A안",
                "작년 축제 SNS 게시물의 70%가 공연 영상이었고 외부 방문객도 공연 날 가장 많았어요.",
                "축제는 학교 홍보 수단이기도 하다", priority=1, sources=["보고서 2문단", "보고서 3문단"]),
        _stance("i2", "저는 사회와 도입·결론을 맡을게요.", "", "발표 10분, 질의응답 5분 구성이에요.", sources=["보고서 4문단"]),
    ]
    hj.reports = [Report("r1", HYEJUNG_REPORT[0], list(HYEJUNG_REPORT[1]))]
    hj.stances = [
        _stance("i1", "학생 참여 프로그램 예산을 늘리는 B안을 제안해야 해요.", "B안",
                "만족도 조사에서 동아리·체험 부스가 4.2점으로 연예인 공연 3.6점보다 높았어요.",
                priority=1, sources=["보고서 2문단", "보고서 5문단"]),
        _stance("i2", "저는 자료조사와 질의응답 근거 정리를 맡을게요.", "", "", origin="interview"),
    ]
    jm.stances = [_stance("i2", "저는 본론 발표와 슬라이드 제작을 맡을게요.", "", "", sources=["보고서 1문단"])]
    jm.past = [{"text": "솔직히 연예인 공연 없으면 축제에 사람이 안 올 것 같아. A안도 나쁘지 않은 듯.",
                "issue_id": "i1", "when": "지난 회의 (9/25)"}]
    dj.reports, dj.stances, dj.past = [], [], []           # 발표자: 공유 화면에서 직접 준비한다
    return [jw, hj, jm, dj]


def seed_live_room(room: Room) -> Room:
    seed_room(room)
    room.title = "스피치와 토론 4조"
    room.agenda = "축제 예산 제안 발표 준비 (A안 공연 유지 · B안 학생 참여 확대)"
    room.issues = [Issue(i.id, i.title, [dict(o) for o in i.options], keywords=list(i.keywords)) for i in LIVE_ISSUES]
    room.personas = {p.user_id: p for p in live_personas()}
    for p in room.personas.values():
        p.touch()
    return room
