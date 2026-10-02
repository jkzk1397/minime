"""누가 반응해야 하는가? -> 점수 -> 선택 -> 발언 -> (다시 점수) 를 반복해 AI끼리 회의한다."""
from __future__ import annotations
import asyncio
from . import config, llm, tools
from .models import Message
from .store import hub


async def handle_human(room_id: str, uid: str, text: str, delegate: bool = False) -> None:
    room = hub.room(room_id)
    p = room.personas[uid]
    if not room.agenda and len(room.messages) <= 1:
        room.agenda = text[:80]
    if delegate:
        expanded = await llm.expand(room, uid, text)
        await hub.post(room_id, Message("mini", expanded, uid, meta={"chip": "한 줄 → 풀어쓰기", "original": text}))
        p.memory.append(f"한 줄 의견: {text}")
    else:
        await hub.post(room_id, Message("human", text, uid))
        p.memory.append(f"발언: {text}")
    p.memory[:] = p.memory[-20:]
    asyncio.create_task(discuss(room_id))


async def discuss(room_id: str) -> None:
    room = hub.room(room_id)
    lock = hub.locks[room_id]
    if lock.locked():          # 이미 토론 중이면 새 메시지는 기록만 남기고 다음 라운드에서 반영된다
        return
    async with lock:
        for rnd in range(config.MAX_ROUNDS):
            res = await llm.score(room)
            last = next((m for m in reversed(room.messages) if m.kind in ("human", "mini")), None)
            adj = {}
            for uid, s in res["scores"].items():
                if uid not in room.personas:
                    continue
                s = s + config.AWAY_BOOST if room.away.get(uid) else s * config.PRESENT_FACTOR
                if last and last.kind == "human" and last.user_id == uid:
                    s = 0.0                      # 방금 직접 말한 사람의 미니미는 자기 주인에게 답하지 않는다
                if last and last.kind == "mini" and last.user_id == uid:
                    s = 0.0                      # 연속 발언 금지
                adj[uid] = round(max(0.0, min(1.0, s)), 2)
            threshold = config.SPEAK_THRESHOLD + 0.05 * rnd
            ranked = sorted(adj.items(), key=lambda kv: kv[1], reverse=True)
            pick = ranked[0][0] if ranked and ranked[0][1] >= threshold else None
            await hub.broadcast(room_id, {"type": "orchestrator", "round": rnd, "scores": adj,
                                          "threshold": round(threshold, 2), "pick": pick, "why": res.get("why", "")})
            if not pick:
                break
            await speak(room_id, pick)
            await asyncio.sleep(0.4)


async def speak(room_id: str, uid: str) -> None:
    room = hub.room(room_id)
    proxy = room.away.get(uid, False)
    await hub.broadcast(room_id, {"type": "typing", "user_id": uid})
    out = await llm.reply(room, uid, proxy)
    if out.get("text"):
        await hub.post(room_id, Message("mini", out["text"], uid, proxy=proxy))
    if out.get("search"):
        await hub.broadcast(room_id, {"type": "activity", "text": f"검색 에이전트 실행: {out['search']}"})
        try:
            r = await tools.web_search(out["search"])
            await hub.post(room_id, Message("tool", r["answer"], uid, meta={"query": r["query"], "sources": r["sources"], "mock": r["mock"]}))
        except Exception as e:      # 검색 실패해도 회의는 계속
            await hub.post(room_id, Message("system", f"검색에 실패했습니다: {e}"))


async def set_away(room_id: str, uid: str, away: bool) -> None:
    room = hub.room(room_id)
    name = room.personas[uid].name
    if away == room.away.get(uid):
        return
    room.away[uid] = away
    if away:
        room.away_marker[uid] = len(room.messages)
        await hub.post(room_id, Message("system", f"{name}이(가) 자리를 비웠습니다. {name} 미니미가 대리 참여합니다."))
    else:
        missed = room.messages[room.away_marker.get(uid, len(room.messages)):]
        await hub.post(room_id, Message("system", f"{name}이(가) 돌아왔습니다."))
        text = await llm.digest(room, uid, missed)
        d = Message("digest", text, uid, meta={"count": len(missed)})
        room.messages.append(d)
        await hub.send_to(room_id, uid, d.to_dict())     # 요약은 본인에게만
    await hub.broadcast(room_id, hub.presence(room_id))
    if away:
        asyncio.create_task(discuss(room_id))


async def end_meeting(room_id: str) -> None:
    room = hub.room(room_id)
    data = await llm.minutes(room)
    await hub.post(room_id, Message("result", data.get("conclusion", ""), meta=data))
