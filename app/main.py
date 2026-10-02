from __future__ import annotations
from dataclasses import asdict
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import config, orchestrator
from .store import hub

app = FastAPI(title="MyMini")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
STATIC = Path(__file__).parent / "static"


class PersonaIn(BaseModel):
    name: str
    role: str = ""
    tone: str = ""
    traits: str = ""


@app.get("/")
def index():
    return FileResponse(STATIC / "client.html")


@app.get("/health")
def health():
    return {"ok": True, "mode": "mock" if config.MOCK else "openai", "model": config.OPENAI_MODEL}


@app.get("/rooms/{room_id}/messages")
def messages(room_id: str):
    return [m.to_dict() for m in hub.room(room_id).messages]


@app.get("/rooms/{room_id}/personas")
def personas(room_id: str):
    return {uid: asdict(p) for uid, p in hub.room(room_id).personas.items()}


@app.put("/rooms/{room_id}/personas/{user_id}")
def upsert_persona(room_id: str, user_id: str, body: PersonaIn):
    room = hub.room(room_id)
    p = room.personas.get(user_id)
    if p is None:
        from .models import Persona
        p = room.personas[user_id] = Persona(user_id, body.name)
        room.away[user_id] = False
    p.name, p.role, p.tone, p.traits = body.name, body.role, body.tone, body.traits
    return asdict(p)


@app.websocket("/ws/{room_id}/{user_id}")
async def ws_room(ws: WebSocket, room_id: str, user_id: str):
    room = await hub.connect(room_id, user_id, ws)
    await ws.send_json({"type": "history", "messages": [m.to_dict() for m in room.messages[-100:]], "agenda": room.agenda})
    await hub.broadcast(room_id, hub.presence(room_id))
    try:
        while True:
            ev = await ws.receive_json()
            t = ev.get("type")
            if t == "message":
                text = (ev.get("text") or "").strip()
                if text:
                    await orchestrator.handle_human(room_id, user_id, text, delegate=ev.get("mode") == "delegate")
            elif t == "away":
                await orchestrator.set_away(room_id, user_id, bool(ev.get("value")))
            elif t == "agenda":
                room.agenda = (ev.get("text") or "")[:120]
                await hub.broadcast(room_id, {"type": "agenda", "text": room.agenda})
            elif t == "end_meeting":
                await orchestrator.end_meeting(room_id)
            elif t == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(room_id, user_id)
        await hub.broadcast(room_id, hub.presence(room_id))
