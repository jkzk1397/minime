from __future__ import annotations
import time
import uuid
from dataclasses import dataclass, field, asdict


@dataclass
class Persona:
    user_id: str
    name: str
    role: str = ""
    tone: str = ""
    traits: str = ""
    memory: list[str] = field(default_factory=list)   # 장기 기억 (MVP: 텍스트 리스트, 이후 pgvector로 교체)


@dataclass
class Message:
    kind: str                 # human | mini | system | tool | result | digest
    text: str
    user_id: str = ""         # 발언자(사람) 또는 미니미 주인
    proxy: bool = False       # 대리 참여 여부
    meta: dict = field(default_factory=dict)
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:10])
    ts: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["type"] = "message"
        return d


@dataclass
class Room:
    room_id: str
    agenda: str = ""
    personas: dict[str, Persona] = field(default_factory=dict)
    away: dict[str, bool] = field(default_factory=dict)
    away_marker: dict[str, int] = field(default_factory=dict)   # 자리 비운 시점의 메시지 인덱스
    messages: list[Message] = field(default_factory=list)
