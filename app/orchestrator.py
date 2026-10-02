"""사람 발언 중심 상태 기계 (v3).

사람 발언 → ① M4 안건 거리 → ② M5 결정 감지 → ③ M2 개입 게이트(규칙→점수→애매하면 모델)
→ ④ M1 검색 → 출처 강제 작성 → 출처 검사 → 송출 (근거 약하면 침묵 + 복귀 후 확인 질문)
- 새 사람 발언이 오면 진행 중인 생각 레인 작업을 취소한다 (세대 번호)
- 미니미끼리 주고받는 루프는 없다. 사람 발언 하나당 게이트 1번
- 모델이 늦거나 죽으면 규칙으로 대체되고 회의는 계속된다
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import asdict

from . import agenda, config, gate, interview, ko, llm, minutes, persona, verify
from .models import Message, Room, Stance, new_id
from .store import hub

MINI_DELAY = 0.7       # 미니미가 바로 튀어나오지 않도록 짧은 '생각' 시간 (규칙 모드에서도 자연스럽게)


# ---------------------------------------------------------------- 방송 도우미
async def members_payload(room_id: str) -> dict:
    room = hub.room(room_id)
    online = hub.online(room_id)
    out = []
    for uid, p in room.personas.items():
        r = await persona.readiness(room, uid)
        out.append({
            "user_id": uid, "name": p.name, "role": p.role, "color": p.color, "online": uid in online,
            "mini_on": p.mini_on, "away_since": p.away_since, "intro": p.profile.intro,
            "expertise": p.profile.expertise, "scope": asdict(p.scope),
            "readiness": {k: r[k] for k in ("covered", "total", "ready", "confirmed")},
            "readiness_items": r["items"], "stances": len(p.confirmed()), "reports": len(p.reports),
            "open_questions": sum(1 for q in p.questions if q.status == "open"),
        })
    return {"type": "members", "members": out, "observers": hub.observers(room_id)}


def room_payload(room: Room) -> dict:
    return {
        "type": "room", "room_id": room.room_id, "title": room.title, "agenda": room.agenda,
        "issues": [asdict(i) for i in room.issues], "mode": room.mode, "meeting": room.meeting,
        "current_issue": room.current_issue,
        "decisions": [minutes.decision_dict(room, d) for d in room.decisions],
        "has_minutes": bool(room.minutes),
    }


async def broadcast_members(room_id: str) -> None:
    await hub.broadcast(room_id, await members_payload(room_id))


async def broadcast_room(room_id: str) -> None:
    await hub.broadcast(room_id, room_payload(hub.room(room_id)))


async def system(room_id: str, text: str, **meta) -> Message:
    return await hub.post(room_id, Message("system", text, meta=meta))


# ---------------------------------------------------------------- 회의 시작·안건
async def start_meeting(room_id: str) -> None:
    room = hub.room(room_id)
    if room.meeting.get("status") == "live":
        return
    room.meeting = {"status": "live", "started_at": time.time(), "ended_at": 0.0}
    room.minutes = {}
    await system(room_id, "회의를 시작했어요. 미니미는 필요할 때만, 근거가 있을 때만 말해요.", event="start")
    await broadcast_room(room_id)


async def set_agenda(room_id: str, title: str, issues: list[dict] | None) -> None:
    from .models import Issue
    room = hub.room(room_id)
    room.agenda = title.strip()[:120]
    if issues is not None:
        old = {i.id: i for i in room.issues}
        new = []
        for n, it in enumerate(issues):
            t = (it.get("title") or "").strip()[:80]
            if not t:
                continue
            iid = it.get("id") or f"i{n + 1}"
            opts = [{"label": o.strip()[:20], "keywords": [o.strip()[:20]]} if isinstance(o, str) else o
                    for o in (it.get("options") or []) if (o.strip() if isinstance(o, str) else o.get("label"))]
            prev = old.get(iid)
            if prev and prev.title == t:
                prev.options = opts or prev.options
                new.append(prev)
            else:
                new.append(Issue(iid if iid not in {x.id for x in new} else new_id("i"), t, opts))
        room.issues = new
    for p in room.personas.values():
        p.touch()
    hub.save_soon(room_id)
    await system(room_id, f"안건이 바뀌었어요: {room.agenda}" + (f" (쟁점 {len(room.issues)}개)" if room.issues else ""),
                 event="agenda")
    await broadcast_room(room_id)
    await broadcast_members(room_id)


async def set_mode(room_id: str, mode: str, by: str) -> None:
    room = hub.room(room_id)
    if mode not in ("intervene", "interactive", "call") or room.mode == mode:
        return
    room.mode = mode
    label = {"intervene": "개입형", "interactive": "상호작용형", "call": "호출형"}[mode]
    who = room.personas[by].name if by in room.personas else "진행자"
    await system(room_id, f"{who} 님이 미니미 참여 방식을 '{label}'으로 바꿨어요.", event="mode")
    await broadcast_room(room_id)


# ---------------------------------------------------------------- 사람 발언
async def handle_human(room_id: str, uid: str, text: str, meta: dict | None = None) -> tuple[Message, asyncio.Task]:
    room = hub.room(room_id)
    p = room.personas[uid]
    if p.mini_on:                                       # 말을 하면 돌아온 것
        await set_away(room_id, uid, False)
    if room.meeting.get("status") != "live":
        await start_meeting(room_id)
    dist = agenda.distance(room, text)                  # M4 안건 거리 (LLM 없음)
    issue_id, _ = agenda.detect_issue(room, text)
    if not issue_id and (dist is None or dist < config.DRIFT_THRESHOLD):
        issue_id = room.current_issue                     # 쟁점 단서가 없으면 지금 논의 중인 쟁점으로 본다 (잡담은 제외)
    issue = room.issue(issue_id)
    position = agenda.detect_position(issue, text)
    msg = Message("human", text, uid, meta=dict(meta or {}), issue_id=issue_id)
    if position:
        msg.meta["position"] = position
    hub.set_typing(room_id, uid, False)

    point = {"msg_id": msg.id, "distance": dist, "issue_id": issue_id, "ts": msg.ts, "who": p.name}
    room.drift.append(point)
    room.drift[:] = room.drift[-120:]
    if issue and dist is not None and dist < config.DRIFT_THRESHOLD:
        if issue.status == "open":
            issue.status = "discussing"
        room.current_issue = issue_id

    # M5 결정 감지
    decision = None
    if ko.decision_sentence(text, lambda s: bool(agenda.detect_position(issue, s))):
        decision = await minutes.record(room, msg, issue_id)
    await hub.post(room_id, msg)
    await hub.broadcast(room_id, {"type": "drift", **point, "threshold": config.DRIFT_THRESHOLD})
    if decision:
        await post_decision(room_id, decision)
    await broadcast_room(room_id)

    gen = hub.next_gen(room_id)
    old = hub.tasks.get(room_id)
    if old and not old.done():
        old.cancel()                                     # 세대 번호: 예전 발언에 대한 작업은 버린다
    task = asyncio.create_task(_pipeline(room_id, msg, gen, issue_id, position))
    hub.tasks[room_id] = task
    return msg, task


async def post_decision(room_id: str, d) -> None:
    room = hub.room(room_id)
    dd = minutes.decision_dict(room, d)
    if d.status == "pending":
        text = f"보류된 결정: {d.text} — {', '.join(dd['affected_names'])} 님이 돌아와 확인하면 확정돼요."
    elif d.status == "needs_check":
        text = f"확인이 필요한 결정: {d.text} — 어느 쟁점인지 확인해 주세요."
    else:
        text = f"결정: {d.text}"
    await hub.post(room_id, Message("decision", text, d.by, meta={"decision": dd}, issue_id=d.issue_id))


async def _pipeline(room_id: str, msg: Message, gen: int, issue_id: str, position: str) -> None:
    room = hub.room(room_id)
    try:
        # 사람이 입력 중이면 잠깐 기다린다 (끼어들기 비용)
        waited = 0.0
        while waited < config.TYPING_WAIT_SEC and [u for u in hub.someone_typing(room_id) if u != msg.user_id]:
            await asyncio.sleep(0.3)
            waited += 0.3
        if gen != hub.current_gen(room_id):
            return

        rem = await agenda.check_drift(room)
        if rem is not None:
            await hub.post(room_id, Message("facilitator", agenda.reminder_text(room, rem["remaining"]),
                                            meta={"remaining": rem["remaining"], "source": rem["source"],
                                                  "distance": rem["distance"]}))
            return

        decision = await gate.evaluate(room, msg, issue_id, position, hub.someone_typing(room_id))
        hits = decision.pop("_hits")
        if gen != hub.current_gen(room_id):
            return
        room.gate_log.append(decision)
        room.gate_log[:] = room.gate_log[-30:]
        await hub.broadcast(room_id, decision)

        for act in decision["actions"]:
            if gen != hub.current_gen(room_id):
                return
            await _run_mini(room_id, act, msg, issue_id, hits.get(act["uid"], []), gen)
    except asyncio.CancelledError:
        pass
    finally:
        hub.save_soon(room_id)


async def _run_mini(room_id: str, act: dict, trigger: Message, issue_id: str, hits, gen: int) -> None:
    room = hub.room(room_id)
    uid = act["uid"]
    p = room.personas[uid]
    await hub.broadcast(room_id, {"type": "typing", "user_id": uid, "mini": True, "on": True,
                                  "label": "근거를 찾는 중" if act["type"] == "speak" else "확인 중"})
    try:
        await asyncio.sleep(MINI_DELAY)
        if act["type"] == "abstain":
            q = persona.save_question(p, trigger, act["reason"], issue_id)
            text = persona.abstain_text(p, act["reason"])
            meta = {"abstain": act["reason"], "question_id": q.id, "reply_to": trigger.id, "engine": llm.RULE}
        else:
            out = await persona.compose(room, uid, trigger, act["act"], issue_id, hits)
            if gen != hub.current_gen(room_id):
                return
            if not out["text"]:
                q = persona.save_question(p, trigger, "no_evidence", issue_id)
                text = persona.abstain_text(p, "no_evidence")
                meta = {"abstain": "no_evidence", "question_id": q.id, "reply_to": trigger.id, "engine": out["engine"],
                        "dropped": out["dropped"]}
            else:
                text = out["text"]
                meta = {"act": act["act"], "citations": out["citations"], "sentences": out["sentences"],
                        "engine": out["engine"], "dropped": out["dropped"], "reply_to": trigger.id}
        if gen != hub.current_gen(room_id):
            return
        p.last_spoke = time.time()
        await hub.post(room_id, Message("mini", text, uid, proxy=p.mini_on, meta=meta, issue_id=issue_id))
        if meta.get("abstain"):
            await broadcast_members(room_id)
    finally:
        await hub.broadcast(room_id, {"type": "typing", "user_id": uid, "mini": True, "on": False})


# ---------------------------------------------------------------- 대리 참석 ON/OFF
async def set_away(room_id: str, uid: str, on: bool) -> dict | None:
    room = hub.room(room_id)
    p = room.personas[uid]
    if p.mini_on == on:
        return None
    p.mini_on = on
    if on:
        r = await persona.readiness(room, uid)
        p.away_marker = len(room.messages)
        p.away_since = time.time()
        warn = "" if r["ready"] else f" (준비도 {r['covered']}/{r['total']}: 근거 없는 쟁점은 말하지 않고 질문으로 남겨요)"
        await system(room_id, f"{p.name} 님이 불참해요. {p.name} 님의 미니미가 대리 참석합니다{warn}.",
                     event="away", uid=uid)
        await broadcast_members(room_id)
        return None
    missed = room.messages[p.away_marker:]
    await system(room_id, f"{p.name} 님이 돌아왔어요. 미니미 대리 참석을 끕니다.", event="back", uid=uid)
    dg = await minutes.digest(room, uid, missed)
    p.last_digest = dg
    await hub.send_to(room_id, uid, {"type": "away_digest", "user_id": uid, **dg})
    await hub.broadcast(room_id, {"type": "digest_ready", "user_id": uid})
    await broadcast_members(room_id)
    hub.save_soon(room_id)
    return dg


# ---------------------------------------------------------------- 2차 검증·결정
async def request_verify(room_id: str, requester: str, message_id: str) -> Message | None:
    room = hub.room(room_id)
    target = next((m for m in room.messages if m.id == message_id and m.kind == "human"), None)
    if target is None:
        return None
    await hub.broadcast(room_id, {"type": "typing", "user_id": requester, "mini": True, "on": True,
                                  "label": "2차 검증 중"})
    try:
        card = await verify.run(room, requester, target)
    finally:
        await hub.broadcast(room_id, {"type": "typing", "user_id": requester, "mini": True, "on": False})
    rp = room.personas[requester]
    sp = room.personas[target.user_id]
    title = (f"{rp.name} 님의 미니미가 {'내' if requester == target.user_id else sp.name + ' 님의'} 발언을 검증했어요: "
             + " · ".join(card["labels"]) if card["labels"] else f"{rp.name} 님의 미니미 2차 검증")
    msg = Message("verify", title, requester, meta=card, issue_id=card["issue_id"])
    return await hub.post(room_id, msg)


async def mark_decision(room_id: str, uid: str, message_id: str) -> None:
    room = hub.room(room_id)
    m = next((x for x in room.messages if x.id == message_id and x.kind == "human"), None)
    if m is None or m.meta.get("decision_id"):
        return
    d = await minutes.record(room, m, m.issue_id or room.current_issue, manual=True)
    await post_decision(room_id, d)
    await broadcast_room(room_id)


async def respond_decision(room_id: str, uid: str, decision_id: str, action: str, note: str) -> None:
    room = hub.room(room_id)
    d = minutes.respond(room, decision_id, uid, action, note)
    name = room.personas[uid].name
    if action == "approve":
        text = f"{name} 님이 결정을 승인했어요: {d.text}" + (" → 확정" if d.status == "confirmed" else "")
    else:
        text = f"{name} 님이 결정에 이의를 달았어요: {d.text}" + (f" — \"{note.strip()}\"" if note.strip() else "")
    await system(room_id, text, event="decide", decision_id=d.id, action=action)
    await hub.broadcast(room_id, {"type": "decision", "decision": minutes.decision_dict(room, d)})
    await broadcast_room(room_id)
    hub.save_soon(room_id)


async def answer_question(room_id: str, uid: str, qid: str, text: str, share: bool = True) -> None:
    """복귀자가 미니미가 남긴 질문에 답한다 → 확인된 입장으로 저장(다음엔 미니미가 답할 수 있다)."""
    room = hub.room(room_id)
    p = room.personas[uid]
    q = next((x for x in p.questions if x.id == qid), None)
    if q is None or not text.strip():
        return
    q.answer, q.status = text.strip(), "answered"
    claim = ko.casual_to_polite(text)
    p.stances.append(Stance(new_id("s"), q.issue_id, claim, agenda.detect_position(room.issue(q.issue_id), text),
                            f"질문: {q.text}", "", "", "", 2, ["복귀 후 답변"], "confirmed", "interview"))
    p.touch()
    if share:
        asker = room.personas.get(q.asked_by)
        await hub.post(room_id, Message("human", f"(미니미가 남긴 질문에 답해요{' · ' + asker.name + ' 님' if asker else ''}) {claim}",
                                        uid, meta={"answer_to": q.id, "question": q.text}, issue_id=q.issue_id))
    await broadcast_members(room_id)
    hub.save_soon(room_id)


# ---------------------------------------------------------------- 회의 종료
async def end_meeting(room_id: str) -> Message:
    room = hub.room(room_id)
    old = hub.tasks.get(room_id)
    if old and not old.done():
        old.cancel()
    await hub.broadcast(room_id, {"type": "activity", "text": "회의록을 정리하는 중…"})
    data = await minutes.make_minutes(room)
    room.minutes = data
    room.meeting = {**room.meeting, "status": "ended", "ended_at": time.time()}
    msg = await hub.post(room_id, Message("result", data.get("summary", ""), meta=data))
    inferred = persona.infer_memory(room)
    for uid, sts in inferred.items():
        await hub.send_to(room_id, uid, {"type": "memory", "user_id": uid,
                                         "stances": [asdict(s) for s in sts]})
    await broadcast_room(room_id)
    await broadcast_members(room_id)
    hub.save_soon(room_id)
    return msg


# ---------------------------------------------------------------- 준비 (REST에서 호출)
async def after_persona_change(room_id: str) -> None:
    hub.save_soon(room_id)
    await broadcast_members(room_id)


async def refine(room_id: str, uid: str, text: str) -> dict:
    room = hub.room(room_id)
    out, engine = await interview.refine(room, uid, text)
    return {"type": "refine", "original": text, "text": out, "engine": engine}
