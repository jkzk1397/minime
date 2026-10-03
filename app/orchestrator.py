"""사람 발언 중심 상태 기계 (v3).

사람 발언 → ① M4 안건 거리 → ② M5 결정 감지 → ③ M2 개입 게이트(규칙→점수→애매하면 모델)
→ ④ M1 검색 → 출처 강제 작성 → 출처 검사 → 송출 (근거 약하면 침묵 + 복귀 후 확인 질문)
- 새 사람 발언이 오면 진행 중인 생각 레인 작업을 취소한다 (세대 번호). 단, 이름을 불러 물은 호출 응답은 끝까지 간다
- 방별 잠금(hub.lock)으로 사람 발언·안건 변경·회의 종료의 순서를 지킨다. 느린 LLM 호출은 잠금 밖에서
- 미니미끼리 주고받는 루프는 없다. 사람 발언 하나당 게이트 1번
- 모델이 늦거나 죽으면 규칙으로 대체되고 회의는 계속된다
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import asdict

from . import agenda, config, gate, interview, ko, llm, minutes, persona, verify
from .models import Message, Room, Stance, new_id
from .store import hub

MINI_DELAY = 0.7       # 미니미가 바로 튀어나오지 않도록 짧은 '생각' 시간 (규칙 모드에서도 자연스럽게)
log = logging.getLogger("minime")
_ending: set[str] = set()   # 회의록을 만드는 중인 방 (종료는 한 번만)


# ---------------------------------------------------------------- 방송 도우미
async def members_payload(room_id: str) -> dict:
    room = hub.room(room_id)
    online = hub.online(room_id)
    out = []
    for uid, p in list(room.personas.items()):          # 안에서 await 하므로 복사본으로 돈다 (그 사이 입장 가능)
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


async def message_update(room_id: str, msg: Message) -> None:
    """이미 보낸 메시지가 바뀌었을 때 (결정 카드 상태, '결정으로 기록', 회의록의 결정 상태). 같은 id를 바꿔 그린다."""
    await hub.broadcast(room_id, {"type": "message_update", "message": msg.to_dict()})


def meeting_closed(room_id: str) -> bool:
    return hub.room(room_id).meeting.get("status") == "ended" or room_id in _ending


# ---------------------------------------------------------------- 회의 시작·안건
async def start_meeting(room_id: str) -> None:
    room = hub.room(room_id)
    if room.meeting.get("status") == "live" or room_id in _ending:
        return
    room.meeting = {"status": "live", "started_at": time.time(), "ended_at": 0.0}   # 지난 회의록은 새로 끝낼 때까지 둔다
    await system(room_id, "회의를 시작했어요. 미니미는 필요할 때만, 근거가 있을 때만 말해요.", event="start")
    await broadcast_room(room_id)


def _taken_issue_ids(room: Room) -> set[str]:
    """방 어디에서든 쓰였던 쟁점 id (지운 쟁점의 입장 카드·결정이 새 쟁점에 붙지 않게 다시 쓰지 않는다)."""
    ids = {i.id for i in room.issues} | {d.issue_id for d in room.decisions} | {m.issue_id for m in room.messages}
    for p in room.personas.values():
        ids |= {s.issue_id for s in p.stances} | {q.issue_id for q in p.interview} | {q.issue_id for q in p.questions}
    ids.discard("")
    return ids


def merge_issues(room: Room, issues: list[dict]) -> list:
    """안건 편집 결과 → 쟁점 목록. 같은 제목의 기존 쟁점은 id·상태를 그대로 두고, 새 제목은 겹치지 않는 새 id를 받는다.
    (클라이언트가 보낸 id는 제목이 같을 때만 믿는다: 줄을 끼워 넣거나 바꿔 쓴 줄이 예전 id를 물려받지 않게)"""
    from .models import Issue
    old = {i.id: i for i in room.issues}
    taken = _taken_issue_ids(room)
    used: set[str] = set()
    out = []

    def fresh() -> str:
        n = 1
        while f"i{n}" in taken or f"i{n}" in used:
            n += 1
        return f"i{n}"

    for it in issues:
        if not isinstance(it, dict):
            continue
        t = str(it.get("title") or "").strip()[:80]
        if not t:
            continue
        raw = it.get("options")
        opts = [{"label": o.strip()[:20], "keywords": [o.strip()[:20]]} if isinstance(o, str) else o
                for o in (raw if isinstance(raw, list) else [])
                if (o.strip() if isinstance(o, str) else isinstance(o, dict) and o.get("label"))]
        prev = old.get(str(it.get("id") or ""))
        if not prev or prev.title != t or prev.id in used:
            prev = next((i for i in room.issues if i.title == t and i.id not in used), None)
        if prev:
            if isinstance(raw, list):                       # 빈 목록이면 선택지를 지운다
                prev.options = opts
            out.append(prev)
        else:
            out.append(Issue(fresh(), t, opts))
        used.add(out[-1].id)
    return out


async def set_agenda(room_id: str, title: str, issues: list[dict] | None) -> None:
    room = hub.room(room_id)
    async with hub.lock(room_id):                        # 처리 중인 발언과 섞이지 않게
        room.agenda = title.strip()[:120]
        if issues is not None:
            room.issues = merge_issues(room, issues)
            if not room.issue(room.current_issue):
                room.current_issue = ""
        for p in room.personas.values():
            p.touch()
        hub.save_soon(room_id)
        label = room.agenda or "(제목 없음)"
        await system(room_id, f"안건이 바뀌었어요: {label}" + (f" (쟁점 {len(room.issues)}개)" if room.issues else ""),
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
async def _noop() -> None:
    return None


async def handle_human(room_id: str, uid: str, text: str, meta: dict | None = None) -> tuple[Message, asyncio.Task]:
    room = hub.room(room_id)
    p = room.personas[uid]
    # 세대 번호와 취소는 await 전에: 늦게 온 발언이 앞 발언의 세대를 갖거나 새 작업을 지우지 않게
    gen = hub.next_gen(room_id)
    old = hub.tasks.pop(room_id, None)
    if old and not old.done():
        old.cancel()                                     # 세대 번호: 예전 발언에 대한 (호출 아닌) 작업은 버린다
    called = gate.calls_mini(room, text, uid)            # 미니미를 불러 물었으면 새 발언이 와도 답한다
    hub.set_typing(room_id, uid, False)

    async with hub.lock(room_id):                        # 같은 방의 발언은 도착 순서대로 처리한다
        if p.mini_on:                                    # 말을 하면 돌아온 것 (복귀 요약은 뒤에서 만든다)
            await set_away(room_id, uid, False, wait_digest=False)
        if meeting_closed(room_id):                      # 회의가 끝난 뒤 잡담: 회의를 다시 열거나 회의록을 지우지 않는다
            msg = Message("human", text, uid, meta={**(meta or {}), "after_end": True})
            await hub.post(room_id, msg)
            if (called or room.absent()) and not room.meeting.get("closed_hint"):
                room.meeting["closed_hint"] = True            # 끝난 회의에서 미니미가 왜 조용한지 한 번 알려 준다
                await system(room_id, "회의가 끝나서 미니미는 대신 말하지 않아요. 위 ⋯ → '새 회의 시작'을 누르면 다시 참여해요.",
                             event="closed_hint")
            return msg, asyncio.create_task(_noop())
        if room.meeting.get("status") != "live":
            await start_meeting(room_id)
        dist = agenda.distance(room, text)              # M4 안건 거리 (LLM 없음)
        issue_id, _ = agenda.detect_issue(room, text)
        if not issue_id and (dist is None or dist < config.DRIFT_THRESHOLD):
            issue_id = room.current_issue                 # 쟁점 단서가 없으면 지금 논의 중인 쟁점으로 본다 (잡담은 제외)
        issue = room.issue(issue_id)
        position = agenda.stance_position(issue, text)
        msg = Message("human", text, uid, meta=dict(meta or {}), issue_id=issue_id)
        if position:
            msg.meta["position"] = position

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
        await _present_owner_hint(room, room_id, text, uid)
        await hub.broadcast(room_id, {"type": "drift", **point, "threshold": config.DRIFT_THRESHOLD})
        if decision:
            await post_decision(room_id, decision)
        await broadcast_room(room_id)

    if called:                                           # 호출 응답: 세대 번호로 취소되지 않는 작업
        task = hub.spawn(room_id, _pipeline(room_id, msg, gen, issue_id, position, called=True))
    else:
        task = asyncio.create_task(_pipeline(room_id, msg, gen, issue_id, position))
        if gen == hub.current_gen(room_id):              # 그 사이 새 발언이 왔으면 등록하지 않는다 (작업은 바로 끝난다)
            hub.tasks[room_id] = task
    return msg, task


_owner_hint_at: dict[tuple[str, str], float] = {}


async def _present_owner_hint(room: Room, room_id: str, text: str, uid: str) -> None:
    """'동준 미니미, …'처럼 미니미를 불렀는데 주인이 자리에 있으면, 왜 미니미가 답하지 않는지 알려 준다 (1분에 한 번)."""
    names = {u: p.name for u, p in room.personas.items()}
    for u in ko.addressed_mini(text, names):
        p = room.personas.get(u)
        if u == uid or not p or p.mini_on or time.time() - _owner_hint_at.get((room_id, u), 0) < 60:
            continue
        _owner_hint_at[(room_id, u)] = time.time()
        await system(room_id, f"{p.name} 님이 지금 자리에 있어서 미니미는 대신 답하지 않아요. "
                              f"{p.name} 님이 '자리 비움'을 켜면 미니미가 대신 답해요.", event="owner_present", uid=u)


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


async def _pipeline(room_id: str, msg: Message, gen: int, issue_id: str, position: str, called: bool = False) -> None:
    """생각 레인. called=True(이름을 불러 물음)면 새 발언이 와도 호출된 미니미의 응답은 끝까지 간다."""
    room = hub.room(room_id)

    def stale() -> bool:
        return gen != hub.current_gen(room_id)

    try:
        if stale() and not called:
            return
        # 사람이 입력 중이면 잠깐 기다린다 (끼어들기 비용)
        waited = 0.0
        while waited < config.TYPING_WAIT_SEC and [u for u in hub.someone_typing(room_id) if u != msg.user_id]:
            await asyncio.sleep(0.3)
            waited += 0.3
        if stale() and not called:
            return

        reminded = False
        if not stale():                                  # 안건 상기는 가장 최근 발언 기준으로만
            rem = await agenda.check_drift(room)
            if rem is not None:
                await hub.post(room_id, Message("facilitator", agenda.reminder_text(room, rem["remaining"]),
                                                meta={"remaining": rem["remaining"], "source": rem["source"],
                                                      "distance": rem["distance"]}))
                reminded = True

        decision = await gate.evaluate(room, msg, issue_id, position, hub.someone_typing(room_id))
        hits = decision.pop("_hits")
        if stale() and not called:
            return
        if reminded and any(not a.get("called") for a in decision["actions"]):
            decision["actions"] = [a for a in decision["actions"] if a.get("called")]   # 상기 직후엔 호출 응답만
            decision["reason"] += " · 방금 안건을 상기했으므로 끼어들지 않음"
        room.gate_log.append(decision)
        room.gate_log[:] = room.gate_log[-30:]
        await hub.broadcast(room_id, decision)

        for act in decision["actions"]:
            if stale() and not act.get("called"):
                return
            try:
                await _run_mini(room_id, act, msg, issue_id, hits.get(act["uid"], []), gen)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("mini reply failed room=%s uid=%s msg=%s", room_id, act.get("uid"), msg.id)
                await _soft_error(room_id, [act["uid"]] if act.get("called") else [])
    except asyncio.CancelledError:
        pass
    except Exception:
        log.exception("pipeline failed room=%s msg=%s", room_id, msg.id)
        await _soft_error(room_id, sorted(gate.called_uids(room, msg.text, msg.user_id)) if called else [])
    finally:
        hub.save_soon(room_id)


async def _soft_error(room_id: str, called: list[str]) -> None:
    """생각 레인이 죽어도 조용히 사라지지 않게: 호출받은 미니미가 있으면 채팅에, 아니면 짧은 알림으로."""
    room = hub.room(room_id)
    try:
        names = [room.personas[u].name for u in called if u in room.personas]
        if names:
            await system(room_id, f"{', '.join(names)} 님의 미니미가 답을 준비하다 문제가 생겼어요. 잠시 뒤 다시 불러 주세요.",
                         event="mini_error")
        else:
            await hub.broadcast(room_id, {"type": "activity", "text": "미니미가 생각을 정리하다 문제가 생겼어요. 회의는 그대로 이어가 주세요."})
    except Exception:
        log.exception("soft error notice failed room=%s", room_id)


async def _run_mini(room_id: str, act: dict, trigger: Message, issue_id: str, hits, gen: int) -> None:
    room = hub.room(room_id)
    uid = act["uid"]
    p = room.personas[uid]

    def stale() -> bool:                                 # 호출 응답은 새 발언이 와도 버리지 않는다
        return not act.get("called") and gen != hub.current_gen(room_id)

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
            if stale():
                return
            if not out["text"]:
                q = persona.save_question(p, trigger, "no_evidence", issue_id)
                text = persona.abstain_text(p, "no_evidence")
                meta = {"abstain": "no_evidence", "question_id": q.id, "reply_to": trigger.id, "engine": out["engine"],
                        "dropped": out["dropped"], "verify": out.get("verify")}
            else:
                text = out["text"]
                meta = {"act": act["act"], "citations": out["citations"], "sentences": out["sentences"],
                        "engine": out["engine"], "dropped": out["dropped"], "verify": out.get("verify"),
                        "reply_to": trigger.id}
        if stale():
            return
        if act.get("called"):
            meta["called"] = True
        p.last_spoke = time.time()
        await hub.post(room_id, Message("mini", text, uid, proxy=p.mini_on, meta=meta, issue_id=issue_id))
        if meta.get("abstain"):
            await broadcast_members(room_id)
    finally:
        await hub.broadcast(room_id, {"type": "typing", "user_id": uid, "mini": True, "on": False})


# ---------------------------------------------------------------- 대리 참석 ON/OFF
async def set_away(room_id: str, uid: str, on: bool, wait_digest: bool = True) -> dict | None:
    """대리 참석 ON/OFF. 상태는 await 전에 바꾼다. wait_digest=False면 복귀 요약(느린 LLM)은 뒤에서 만들어 보낸다."""
    room = hub.room(room_id)
    p = room.personas[uid]
    if p.mini_on == on:
        return None
    p.mini_on = on
    if on:
        p.away_marker = len(room.messages)
        p.away_since = time.time()
        r = await persona.readiness(room, uid)
        warn = "" if r["ready"] else f" (준비도 {r['covered']}/{r['total']}: 근거 없는 쟁점은 말하지 않고 질문으로 남겨요)"
        await system(room_id, f"{p.name} 님이 불참해요. {p.name} 님의 미니미가 대리 참석합니다{warn}.",
                     event="away", uid=uid)
        await broadcast_members(room_id)
        from . import autoplay                              # 실전 시연 방: 발표자가 빠지면 대본 자동 진행
        if uid == autoplay.PRESENTER:
            autoplay.maybe_start(room_id)
        return None
    missed = room.messages[p.away_marker:]
    from . import autoplay
    if uid == autoplay.PRESENTER:
        await autoplay.presenter_back(room_id)
    await system(room_id, f"{p.name} 님이 돌아왔어요. 미니미 대리 참석을 끕니다.", event="back", uid=uid)
    if not wait_digest:
        hub.spawn(room_id, _send_digest(room_id, uid, missed))
        return None
    return await _send_digest(room_id, uid, missed)


async def _send_digest(room_id: str, uid: str, missed: list[Message]) -> dict | None:
    room = hub.room(room_id)
    p = room.personas[uid]
    try:
        dg = await minutes.digest(room, uid, missed)
    except Exception:
        log.exception("digest failed room=%s uid=%s", room_id, uid)
        await hub.send_to(room_id, uid, {"type": "error", "text": "'내가 빠진 사이' 요약을 만들지 못했어요."})
        await broadcast_members(room_id)
        return None
    p.last_digest = dg
    await hub.send_to(room_id, uid, {"type": "away_digest", "user_id": uid, **dg})
    await hub.broadcast(room_id, {"type": "digest_ready", "user_id": uid})
    await broadcast_members(room_id)
    hub.save_soon(room_id)
    return dg


def fresh_digest(room: Room, uid: str) -> dict:
    """다시 연 '내가 빠진 사이': 이미 답한 질문은 빼고, 결정은 지금 상태로 (두 번 답하지 않게)."""
    p = room.personas[uid]
    if not p.last_digest:
        return {}
    dg = dict(p.last_digest)
    live_q = {q.id: q for q in p.questions}
    dg["questions"] = [asdict(live_q[q["id"]]) for q in dg.get("questions", [])
                       if q.get("id") in live_q and live_q[q["id"]].status == "open"]
    live_d = {d.id: d for d in room.decisions}
    dg["decisions"] = [minutes.decision_dict(room, live_d[x["id"]]) if x.get("id") in live_d else x
                       for x in dg.get("decisions", [])]
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
    async with hub.lock(room_id):                        # 두 번 눌러도 결정은 하나
        m = next((x for x in room.messages if x.id == message_id and x.kind == "human"), None)
        if m is None:
            raise KeyError("결정으로 기록할 발언을 찾을 수 없어요.")
        if m.meta.get("decision_id"):
            raise ValueError("이미 결정으로 기록된 발언이에요.")
        d = await minutes.record(room, m, m.issue_id or room.current_issue, manual=True)
    await message_update(room_id, m)                     # '결정으로 기록' 버튼이 사라지게
    await post_decision(room_id, d)
    await broadcast_room(room_id)
    hub.save_soon(room_id)


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
    await refresh_decision_messages(room_id, d.id)
    await broadcast_room(room_id)
    hub.save_soon(room_id)


async def refresh_decision_messages(room_id: str, decision_id: str) -> None:
    """결정 상태가 바뀌면 지난 결정 카드와 회의록(결과 카드·내보내기)도 지금 상태로 바꾸고 message_update로 알린다."""
    room = hub.room(room_id)
    d = next((x for x in room.decisions if x.id == decision_id), None)
    if d is None:
        return
    dd = minutes.decision_dict(room, d)
    changed = []
    for m in list(room.messages):
        if m.kind == "decision" and (m.meta.get("decision") or {}).get("id") == d.id and m.meta["decision"] != dd:
            m.meta["decision"] = dd
            changed.append(m)
        elif m.kind == "result" and minutes.refresh_decisions(room, m.meta):
            changed.append(m)
    minutes.refresh_decisions(room, room.minutes)
    for m in changed:
        await message_update(room_id, m)


async def answer_question(room_id: str, uid: str, qid: str, text: str, share: bool = True) -> None:
    """복귀자가 미니미가 남긴 질문에 답한다 → 확인된 입장으로 저장(다음엔 미니미가 답할 수 있다)."""
    room = hub.room(room_id)
    p = room.personas[uid]
    q = next((x for x in p.questions if x.id == qid), None)
    if q is None:
        raise KeyError("질문을 찾을 수 없어요.")
    if q.status != "open":
        raise ValueError("이미 답한 질문이에요.")
    if not text.strip():
        raise ValueError("답을 적어 주세요.")
    q.answer, q.status = text.strip(), "answered"        # await 전에 닫는다 (두 번 답하지 않게)
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
async def end_meeting(room_id: str) -> Message | None:
    """회의 종료는 한 번만. 이미 끝났거나 회의록을 만드는 중이면 None."""
    room = hub.room(room_id)
    async with hub.lock(room_id):                        # 먼저 온 발언 처리가 끝난 뒤에 닫는다
        if meeting_closed(room_id):
            return None
        _ending.add(room_id)                             # 여기부터 온 발언은 회의 뒤 잡담 (회의록에 넣지 않는다)
    try:
        hub.next_gen(room_id)
        old = hub.tasks.pop(room_id, None)
        if old and not old.done():
            old.cancel()
        await hub.broadcast(room_id, {"type": "activity", "text": "회의록을 정리하는 중…"})
        data = await minutes.make_minutes(room)
        room.minutes = data
        room.meeting = {**room.meeting, "status": "ended", "ended_at": time.time()}
        msg = await hub.post(room_id, Message("result", data.get("summary", ""), meta=data))
    finally:
        _ending.discard(room_id)
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
