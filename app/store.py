"""MVP용 인메모리 저장소. 이후 PostgreSQL(+pgvector)로 교체할 자리."""
from __future__ import annotations
import asyncio
from fastapi import WebSocket
from .models import Room, Message, Persona

DEFAULT_PERSONAS = {
    "jongwon": Persona("jongwon", "종원", "기획 · PM", "짧고 편한 말투. '~하자', '~어때?'로 끝낸다.",
                       "개발보다 기획 선호. 사용자 경험 중시. 구현 가능성도 같이 따진다."),
    "minsu": Persona("minsu", "민수", "백엔드 개발", "신중한 말투. 걱정을 먼저 말하고 '~듯'을 자주 쓴다.",
                     "구현 기간과 난이도에 민감. 범위를 줄이는 쪽을 선호."),
    "jihyun": Persona("jihyun", "지현", "UI/UX 디자인", "밝고 긍정적인 말투. '~좋을 듯!'을 쓴다.",
                      "화면 완성도와 첫인상을 중시. 데모에서 보이는 장면을 우선."),
}


class Hub:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self.sockets: dict[str, dict[str, WebSocket]] = {}   # room_id -> user_id -> ws
        self.locks: dict[str, asyncio.Lock] = {}

    def room(self, room_id: str) -> Room:
        if room_id not in self.rooms:
            r = Room(room_id=room_id)
            for uid, p in DEFAULT_PERSONAS.items():
                r.personas[uid] = Persona(**p.__dict__)
                r.away[uid] = False
            self.rooms[room_id] = r
            self.sockets[room_id] = {}
            self.locks[room_id] = asyncio.Lock()
        return self.rooms[room_id]

    async def connect(self, room_id: str, user_id: str, ws: WebSocket) -> Room:
        room = self.room(room_id)
        await ws.accept()
        if user_id not in room.personas:
            room.personas[user_id] = Persona(user_id, user_id)
            room.away[user_id] = False
        self.sockets[room_id][user_id] = ws
        return room

    def disconnect(self, room_id: str, user_id: str) -> None:
        self.sockets.get(room_id, {}).pop(user_id, None)

    async def broadcast(self, room_id: str, payload: dict) -> None:
        dead = []
        for uid, ws in list(self.sockets.get(room_id, {}).items()):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(uid)
        for uid in dead:
            self.disconnect(room_id, uid)

    async def send_to(self, room_id: str, user_id: str, payload: dict) -> None:
        ws = self.sockets.get(room_id, {}).get(user_id)
        if ws:
            try:
                await ws.send_json(payload)
            except Exception:
                self.disconnect(room_id, user_id)

    async def post(self, room_id: str, msg: Message) -> Message:
        self.room(room_id).messages.append(msg)
        await self.broadcast(room_id, msg.to_dict())
        return msg

    def presence(self, room_id: str) -> dict:
        room = self.room(room_id)
        online = set(self.sockets.get(room_id, {}))
        return {
            "type": "presence",
            "members": [
                {"user_id": uid, "name": p.name, "role": p.role,
                 "online": uid in online, "away": room.away.get(uid, False)}
                for uid, p in room.personas.items()
            ],
        }


hub = Hub()
