"""방·접속·메시지 저장소. 해커톤은 인메모리 + JSON 파일 (data/rooms/*.json). 배포 때 PostgreSQL로 교체."""
from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass, field

from fastapi import WebSocket

from . import config
from .models import Message, Persona, Room

ROOM_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
UID_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


@dataclass
class Conn:
    ws: WebSocket
    uid: str
    observer: bool = False
    since: float = field(default_factory=time.time)


class Hub:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self.conns: dict[str, list[Conn]] = {}
        self.typing: dict[str, dict[str, float]] = {}
        self.tasks: dict[str, asyncio.Task] = {}        # 방별 진행 중인 생각 레인 작업 (세대 번호 취소)
        self.gen: dict[str, int] = {}                   # 방별 세대 번호
        self.locks: dict[str, asyncio.Lock] = {}
        self._save_handles: dict[str, asyncio.TimerHandle] = {}
        (config.DATA_DIR / "rooms").mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------ 방
    def path(self, room_id: str):
        return config.DATA_DIR / "rooms" / f"{room_id}.json"

    def exists(self, room_id: str) -> bool:
        return room_id in self.rooms or self.path(room_id).exists()

    def room(self, room_id: str) -> Room:
        if room_id not in self.rooms:
            room = None
            p = self.path(room_id)
            if p.exists():
                try:
                    room = Room.from_dict(json.loads(p.read_text(encoding="utf-8")))
                except Exception:
                    room = None
            if room is None:
                room = Room(room_id=room_id)
                if room_id == "demo":
                    from .seed import seed_room
                    seed_room(room)
            for persona in room.personas.values():
                persona.touch()
            self.rooms[room_id] = room
            self.conns.setdefault(room_id, [])
            self.typing.setdefault(room_id, {})
            self.locks.setdefault(room_id, asyncio.Lock())
            self.gen.setdefault(room_id, 0)
        return self.rooms[room_id]

    def replace(self, room: Room) -> None:
        """시연 초기화 등으로 방 전체를 바꿀 때 (접속은 유지)."""
        task = self.tasks.pop(room.room_id, None)
        if task and not task.done():
            task.cancel()
        self.rooms[room.room_id] = room
        self.gen[room.room_id] = self.gen.get(room.room_id, 0) + 1
        self.save_soon(room.room_id, 0.1)

    def save_soon(self, room_id: str, delay: float = 1.0) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            self.save(room_id)
            return
        h = self._save_handles.pop(room_id, None)
        if h:
            h.cancel()
        self._save_handles[room_id] = loop.call_later(delay, self.save, room_id)

    def save(self, room_id: str) -> None:
        room = self.rooms.get(room_id)
        if not room:
            return
        p = self.path(room_id)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(room.to_dict(), ensure_ascii=False), encoding="utf-8")
        tmp.replace(p)

    def save_all(self) -> None:
        for rid in list(self.rooms):
            self.save(rid)

    def list_rooms(self) -> list[dict]:
        ids = {p.stem for p in (config.DATA_DIR / "rooms").glob("*.json")} | set(self.rooms)
        out = []
        for rid in sorted(ids):
            r = self.room(rid)
            out.append({"room_id": rid, "title": r.title, "agenda": r.agenda, "members": len(r.personas),
                        "online": len(self.online(rid)), "status": r.meeting.get("status", "idle")})
        return out

    # ------------------------------------------------------------ 접속
    async def connect(self, room_id: str, uid: str, ws: WebSocket, observer: bool) -> Conn:
        self.room(room_id)
        await ws.accept()
        c = Conn(ws, uid, observer)
        self.conns[room_id].append(c)
        return c

    def disconnect(self, room_id: str, conn: Conn) -> None:
        lst = self.conns.get(room_id, [])
        if conn in lst:
            lst.remove(conn)

    async def kick_unknown(self, room_id: str) -> None:
        """방을 다시 채운 뒤, 더 이상 없는 팀원으로 접속한 화면은 로비로 돌려보낸다."""
        room = self.room(room_id)
        for c in list(self.conns.get(room_id, [])):
            if not c.observer and c.uid not in room.personas:
                try:
                    await c.ws.send_json({"type": "error", "code": "unknown_member", "text": "방이 초기화돼 자리가 없어졌어요."})
                    await c.ws.close(code=4404)
                except Exception:
                    pass
                self.disconnect(room_id, c)

    def online(self, room_id: str) -> set[str]:
        return {c.uid for c in self.conns.get(room_id, []) if not c.observer}

    def observers(self, room_id: str) -> int:
        return sum(1 for c in self.conns.get(room_id, []) if c.observer)

    async def _send(self, room_id: str, conn: Conn, payload: dict) -> bool:
        try:
            await conn.ws.send_json(payload)
            return True
        except Exception:
            self.disconnect(room_id, conn)
            return False

    async def broadcast(self, room_id: str, payload: dict) -> None:
        conns = list(self.conns.get(room_id, []))
        if conns:
            await asyncio.gather(*(self._send(room_id, c, payload) for c in conns))

    async def send_to(self, room_id: str, uid: str, payload: dict) -> None:
        conns = [c for c in self.conns.get(room_id, []) if c.uid == uid]
        if conns:
            await asyncio.gather(*(self._send(room_id, c, payload) for c in conns))

    async def post(self, room_id: str, msg: Message) -> Message:
        room = self.room(room_id)
        room.messages.append(msg)
        if len(room.messages) > 1500:                   # 메모리 보호
            del room.messages[:300]
            for p in room.personas.values():
                p.away_marker = max(0, p.away_marker - 300)
        await self.broadcast(room_id, msg.to_dict())
        self.save_soon(room_id)
        return msg

    # ------------------------------------------------------------ 입력 중 표시
    def set_typing(self, room_id: str, uid: str, on: bool) -> None:
        t = self.typing.setdefault(room_id, {})
        if on:
            t[uid] = time.time()
        else:
            t.pop(uid, None)

    def someone_typing(self, room_id: str, within: float = 3.0) -> list[str]:
        now = time.time()
        return [u for u, ts in self.typing.get(room_id, {}).items() if now - ts < within]

    # ------------------------------------------------------------ 생각 레인 작업 (세대 번호)
    def next_gen(self, room_id: str) -> int:
        self.gen[room_id] = self.gen.get(room_id, 0) + 1
        return self.gen[room_id]

    def current_gen(self, room_id: str) -> int:
        return self.gen.get(room_id, 0)


hub = Hub()


def add_persona(room: Room, uid: str, name: str, role: str = "") -> Persona:
    used = {p.color for p in room.personas.values()}
    color = next((i for i in range(8) if i not in used), len(room.personas) % 8)
    p = Persona(uid, name, role, color)
    room.personas[uid] = p
    return p
