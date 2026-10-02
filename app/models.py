"""데이터 모델. 해커톤은 인메모리 + JSON 파일 저장 (store.py), 배포 때 PostgreSQL + pgvector로 교체."""
from __future__ import annotations

import time
import uuid
from dataclasses import asdict, dataclass, field, fields
from typing import Any


def new_id(prefix: str = "") -> str:
    return prefix + uuid.uuid4().hex[:8]


def _load(cls, d: dict | None):
    """dict → dataclass (모르는 키는 무시, 중첩 리스트는 각 클래스의 from_dict가 처리)."""
    if d is None:
        return cls()
    names = {f.name for f in fields(cls)}
    return cls(**{k: v for k, v in d.items() if k in names})


# ---------------------------------------------------------------- 페르소나 구성 요소
@dataclass
class Profile:
    """페르소나에 넣는 정보. '안건 판단에 쓰이는 것'만 받는다 (개인 신상은 받지 않는다)."""
    intro: str = ""                                          # 한 줄 소개 (팀에서 맡은 일)
    expertise: list[str] = field(default_factory=list)       # 관심·전문 키워드 → 관련도 계산
    criteria: list[str] = field(default_factory=list)        # 판단 기준 (순서 = 우선순위) → 생각의 흐름
    projects: list[str] = field(default_factory=list)        # 관련 경험·프로젝트 (선택) → 근거 [약력 n]
    tone_examples: list[str] = field(default_factory=list)   # 평소 말투 예시 2~3문장 → 말투만 흉내


@dataclass
class Scope:
    """위임 범위. 미니미는 이 범위 밖의 약속을 하지 않는다."""
    level: str = "opinion"           # opinion: 의견 제시만 | answer: 질문 답변까지
    no_commit: list[str] = field(default_factory=lambda: ["마감일", "역할 분담", "비용"])
    note: str = ""


@dataclass
class Report:
    id: str
    title: str
    paragraphs: list[str]
    ts: float = field(default_factory=time.time)


@dataclass
class Stance:
    """입장 카드 = 논리 구조(Toulmin)로 정리한 그 사람의 생각 한 단위."""
    id: str
    issue_id: str = ""                # 어느 쟁점에 대한 입장인가
    claim: str = ""                   # 주장
    position: str = ""                # 선택지 (예: "B안"). 없으면 빈 값
    reasons: str = ""                 # 근거
    warrant: str = ""                 # 판단 기준·전제 (근거가 왜 주장을 뒷받침하나)
    red_line: str = ""                # 양보 불가선
    unknown: str = ""                 # 모르는 영역 (이건 말하지 않는다)
    priority: int = 2                 # 1(높음) ~ 3(낮음)
    sources: list[str] = field(default_factory=list)   # 근거 문단 라벨
    status: str = "candidate"         # candidate(초안) | confirmed(본인 확인) | inferred(추정) | rejected
    origin: str = "report"            # report | interview | memory | manual
    ts: float = field(default_factory=time.time)


@dataclass
class InterviewQ:
    id: str
    issue_id: str
    kind: str                         # position | reason | redline | confirm | free
    question: str
    answer: str = ""
    expanded: str = ""                # AI가 풀어 쓴 문장 (본인 확인 전까지는 후보)
    stance_id: str = ""
    status: str = "open"              # open | answered | confirmed | skipped
    ts: float = field(default_factory=time.time)


@dataclass
class ReturnQuestion:
    """미니미가 근거가 없어 답하지 않은 질문 → 복귀 후 본인이 답한다."""
    id: str
    text: str
    asked_by: str = ""
    issue_id: str = ""
    reason: str = "근거 없음"          # 근거 없음 | 약속 필요
    status: str = "open"              # open | answered
    answer: str = ""
    ts: float = field(default_factory=time.time)


@dataclass
class Persona:
    user_id: str
    name: str
    role: str = ""
    color: int = 0
    profile: Profile = field(default_factory=Profile)
    scope: Scope = field(default_factory=Scope)
    consent: dict = field(default_factory=lambda: {"store_utterances": True, "use_reports": True})
    reports: list[Report] = field(default_factory=list)
    stances: list[Stance] = field(default_factory=list)
    interview: list[InterviewQ] = field(default_factory=list)
    questions: list[ReturnQuestion] = field(default_factory=list)
    past: list[dict] = field(default_factory=list)       # 지난 회의 발언 {text, issue_id, when}
    mini_on: bool = False              # 대리 참석 ON (= 불참, 미니미가 대신 참석)
    away_marker: int = 0               # 대리 참석을 켠 시점의 메시지 인덱스
    away_since: float = 0.0
    last_spoke: float = 0.0            # 미니미가 마지막으로 말한 시각 (쿨다운)
    last_digest: dict = field(default_factory=dict)   # 마지막 '내가 빠진 사이' (다시 열기용)
    version: int = 0                   # 근거가 바뀔 때마다 증가 → 검색 인덱스 재생성

    def touch(self) -> None:
        self.version += 1

    def confirmed(self, issue_id: str | None = None) -> list[Stance]:
        return [s for s in self.stances if s.status == "confirmed" and (issue_id is None or s.issue_id == issue_id)]

    @classmethod
    def from_dict(cls, d: dict) -> "Persona":
        p = _load(cls, d)
        p.profile = _load(Profile, d.get("profile"))
        p.scope = _load(Scope, d.get("scope"))
        p.reports = [_load(Report, x) for x in d.get("reports", [])]
        p.stances = [_load(Stance, x) for x in d.get("stances", [])]
        p.interview = [_load(InterviewQ, x) for x in d.get("interview", [])]
        p.questions = [_load(ReturnQuestion, x) for x in d.get("questions", [])]
        return p


# ---------------------------------------------------------------- 회의
@dataclass
class Issue:
    id: str
    title: str
    options: list[dict] = field(default_factory=list)   # [{"label": "A안", "keywords": [...]}]
    status: str = "open"              # open | discussing | decided | pending
    keywords: list[str] = field(default_factory=list)   # 쟁점을 알아보는 추가 단서어


@dataclass
class Decision:
    id: str
    text: str
    issue_id: str = ""
    by: str = ""
    status: str = "confirmed"         # confirmed(확정) | pending(보류) | needs_check(확인 필요) | objected(이의)
    affected: list[str] = field(default_factory=list)    # 확인이 필요한 불참자
    responses: dict = field(default_factory=dict)        # uid -> {action, note, ts}
    source_msg: str = ""
    ts: float = field(default_factory=time.time)


@dataclass
class Message:
    kind: str                 # human | mini | system | tool | result | digest | verify | facilitator | decision
    text: str
    user_id: str = ""         # 발언자(사람) 또는 미니미 주인
    proxy: bool = False       # 대리 참석 중 발언인가
    meta: dict = field(default_factory=dict)
    issue_id: str = ""
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:10])
    ts: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["type"] = "message"
        return d


@dataclass
class Room:
    room_id: str
    title: str = ""                   # 팀/수업 이름
    agenda: str = ""                  # 오늘 안건
    issues: list[Issue] = field(default_factory=list)
    mode: str = "intervene"           # intervene(개입형) | interactive(상호작용형) | call(호출형)
    personas: dict[str, Persona] = field(default_factory=dict)
    messages: list[Message] = field(default_factory=list)
    decisions: list[Decision] = field(default_factory=list)
    drift: list[dict] = field(default_factory=list)      # [{msg_id, distance, issue_id, ts}]
    gate_log: list[dict] = field(default_factory=list)
    current_issue: str = ""
    meeting: dict = field(default_factory=lambda: {"status": "idle", "started_at": 0.0, "ended_at": 0.0})
    minutes: dict = field(default_factory=dict)
    last_reminder: float = 0.0

    def issue(self, issue_id: str) -> Issue | None:
        return next((i for i in self.issues if i.id == issue_id), None)

    def persona(self, uid: str) -> Persona | None:
        return self.personas.get(uid)

    def absent(self) -> list[str]:
        return [uid for uid, p in self.personas.items() if p.mini_on]

    def to_dict(self) -> dict:
        d = asdict(self)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "Room":
        r = _load(cls, d)
        r.issues = [_load(Issue, x) for x in d.get("issues", [])]
        r.personas = {uid: Persona.from_dict(p) for uid, p in d.get("personas", {}).items()}
        r.messages = [_load(Message, x) for x in d.get("messages", [])]
        r.decisions = [_load(Decision, x) for x in d.get("decisions", [])]
        return r
