"""M5 회의록과 보류 결정 (+ 복귀자용 '내가 빠진 사이').

- 사람 발언에서 결정 표현('B안으로 가자', '~하는 걸로')을 찾으면 결정으로 기록한다
- 불참자(미니미 대리 참석 중) 입장에 영향을 주는 결정은 자동 '보류' → 복귀자가 승인·이의
- 회의 종료 시 쟁점별로 누가·무슨 의견·충돌·결정 상태를 정리한다 (QMSum 방식)
"""
from __future__ import annotations

import re
import time
from dataclasses import asdict

from . import config, ko, llm
from .agenda import detect_position, stance_position
from .models import Decision, Message, Room, new_id
from .persona import get_index, history_text, strip_cites

STATUS_KO = {"confirmed": "확정", "pending": "보류", "needs_check": "확인 필요", "objected": "이의 제기", "open": "논의 중"}


# ---------------------------------------------------------------- 결정
async def affected_members(room: Room, issue_id: str, exclude: str = "") -> list[str]:
    """불참자 중 이 쟁점에 입장·근거가 있는 사람. 쟁점을 모르면 불참자 전원."""
    out = []
    issue = room.issue(issue_id)
    for uid in room.absent():
        if uid == exclude:
            continue
        p = room.personas[uid]
        if not issue or p.confirmed(issue_id):
            out.append(uid)
            continue
        idx = await get_index(room, uid)
        from .agenda import issue_query
        hits = await idx.search(issue_query(issue), k=2)
        if any(h.strength >= config.EVIDENCE_MIN for h in hits):
            out.append(uid)
    return out


def decision_text(text: str, issue=None) -> str:
    sents = ko.sentences(text)
    pick = ko.decision_sentence(text, lambda s: bool(detect_position(issue, s))) or (sents[0] if sents else text)
    pick = re.sub(r"^(결론적으로|그럼|그러면|좋아|오케이|ㅇㅋ|자|그래서|정리하면)[,\s]+", "", pick.strip())
    return pick.rstrip(".!")


async def record(room: Room, msg: Message, issue_id: str, manual: bool = False) -> Decision:
    affected = await affected_members(room, issue_id, exclude=msg.user_id)
    status = "pending" if affected else ("confirmed" if issue_id else "needs_check")
    d = Decision(new_id("d"), decision_text(msg.text, room.issue(issue_id)), issue_id, msg.user_id, status, affected, {}, msg.id)
    room.decisions.append(d)
    issue = room.issue(issue_id)
    if issue:
        issue.status = "pending" if status == "pending" else "decided"
    msg.meta["decision_id"] = d.id
    if manual:
        msg.meta["manual_decision"] = True
    return d


def respond(room: Room, decision_id: str, uid: str, action: str, note: str = "") -> Decision:
    d = next((x for x in room.decisions if x.id == decision_id), None)
    if d is None:
        raise KeyError("결정을 찾을 수 없어요.")
    if action not in ("approve", "object"):
        raise ValueError("action은 approve 또는 object")
    if uid not in room.personas:
        raise ValueError("방에 없는 팀원이에요.")
    # '확인 필요'(쟁점·확인할 사람을 모름)는 팀원 누구나, 그 밖에는 확인 대상(불참자)만 답할 수 있다
    if d.status != "needs_check" and uid not in d.affected:
        raise ValueError("이 결정을 확인할 대상이 아니에요.")
    d.responses[uid] = {"action": action, "note": note.strip(), "ts": time.time()}
    if action == "object":
        d.status = "objected"
    elif d.affected and all(d.responses.get(u, {}).get("action") == "approve" for u in d.affected):
        d.status = "confirmed"
    elif not d.affected and d.status in ("needs_check", "pending"):
        d.status = "confirmed"
    issue = room.issue(d.issue_id)
    if issue:
        issue.status = {"confirmed": "decided", "objected": "discussing"}.get(d.status, issue.status)
    return d


def decision_dict(room: Room, d: Decision) -> dict:
    x = asdict(d)
    issue = room.issue(d.issue_id)
    x["issue_title"] = issue.title if issue else ""
    x["status_ko"] = STATUS_KO.get(d.status, d.status)
    x["by_name"] = room.personas[d.by].name if d.by in room.personas else ""
    x["affected_names"] = [room.personas[u].name for u in d.affected if u in room.personas]
    return x


def refresh_decisions(room: Room, data: dict) -> bool:
    """회의록(또는 결과 카드 meta)의 결정 상태를 지금 결정으로 다시 맞춘다. 바뀐 게 있으면 True.
    회의가 끝난 뒤 복귀자가 승인·이의를 달면 상태가 바뀌기 때문이다."""
    if not data:
        return False
    live = {d.id: d for d in room.decisions}
    changed = False
    for it in data.get("issues", []):
        d = live.get((it.get("decision") or {}).get("id"))
        if d is None:
            continue
        dd = decision_dict(room, d)
        if it.get("decision") != dd or it.get("status") != d.status:
            it["decision"], it["status"] = dd, d.status
            changed = True
    loose = data.get("loose_decisions") or []
    for n, x in enumerate(loose):
        d = live.get(x.get("id"))
        if d is not None and (dd := decision_dict(room, d)) != x:
            loose[n] = dd
            changed = True
    return changed


# ---------------------------------------------------------------- 내가 빠진 사이
async def digest(room: Room, uid: str, missed: list[Message]) -> dict:
    p = room.personas[uid]
    talk = [m for m in missed if m.kind in ("human", "mini")]
    mine = [m for m in missed if m.kind == "mini" and m.user_id == uid]
    decisions = [decision_dict(room, d) for d in room.decisions
                 if uid in d.affected and uid not in d.responses]
    questions = [asdict(q) for q in p.questions if q.status == "open"]
    discussed = []
    for m in talk:
        i = room.issue(m.issue_id)
        if i and i.title not in discussed:
            discussed.append(i.title)
    engine = llm.RULE
    summary = ""
    if talk:
        sys_p, user_p, _ = llm.prompt(
            "digest", name=p.name,
            history="\n".join(f"{_who(room, m)}: {strip_cites(m.text)}" for m in talk[-40:]),
            decisions=" / ".join(f"{d['text']}({d['status_ko']})" for d in decisions) or "없음",
            questions=" / ".join(q["text"] for q in questions) or "없음")
        data, engine = await llm.call_json("digest", "slow", sys_p, user_p,
                                           {"type": "object", "required": ["text"],
                                            "properties": {"text": {"type": "string"}}}, temperature=0.2,
                                           max_tokens=400)
        summary = (data or {}).get("text", "").strip()
    if not summary:
        engine = llm.RULE
        parts = [f"자리를 비운 동안 대화 {len(talk)}개가 오갔어요."]
        if discussed:
            parts.append(f"논의된 쟁점: {', '.join(discussed)}.")
        if mine:
            parts.append(f"{p.name} 님의 미니미가 {len(mine)}번 대신 말했어요.")
        todo = ([f"보류 결정 {len(decisions)}개"] if decisions else []) + ([f"질문 {len(questions)}개"] if questions else [])
        if todo:
            parts.append(f"확인이 필요한 {' · '.join(todo)}가 있어요.")
        summary = " ".join(parts)
    return {
        "summary": summary, "count": len(talk), "engine": engine, "since": p.away_since,
        "mini": [{"id": m.id, "text": m.text, "ts": m.ts, "citations": m.meta.get("citations", []),
                  "abstain": m.meta.get("abstain")} for m in mine],
        "decisions": decisions, "questions": questions, "discussed": discussed,
    }


def _who(room: Room, m: Message) -> str:
    p = room.personas.get(m.user_id)
    name = p.name if p else "?"
    return f"{name} 미니미" if m.kind == "mini" else name


# ---------------------------------------------------------------- 회의록
_MIN_SCHEMA = {"type": "object", "required": ["summary", "issues"],
               "properties": {"summary": {"type": "string"},
                              "issues": {"type": "array", "items": {"type": "object", "required": ["issue_id"],
                                                                    "properties": {"issue_id": {"type": "string"}}}},
                              "next_steps": {"type": "array", "items": {"type": "string"}}}}


async def make_minutes(room: Room) -> dict:
    started = room.meeting.get("started_at") or 0
    msgs = [m for m in room.messages if m.ts >= started and m.kind in ("human", "mini") and not m.meta.get("after_end")]
    issues_out = []
    for issue in room.issues:
        ops: dict[str, dict] = {}
        for m in msgs:
            if m.issue_id != issue.id or m.meta.get("abstain"):
                continue
            key = f"{m.user_id}:{m.kind}"
            pos = stance_position(issue, m.text) if m.kind == "human" else detect_position(issue, m.text)
            if key in ops and ops[key]["position"] and not pos:
                continue                     # 입장이 드러난 발언을 대표 의견으로 남긴다
            ops[key] = {"who": _who(room, m), "uid": m.user_id, "kind": m.kind, "text": strip_cites(m.text),
                        "position": pos, "citations": [c["label"] for c in m.meta.get("citations", [])]}
        opinions = list(ops.values())
        positions = {}
        for o in opinions:
            if o["position"]:
                positions.setdefault(o["position"], []).append(o["who"])
        conflicts = []
        if len(positions) > 1:
            conflicts.append(" vs ".join(f"{k}: {', '.join(v)}" for k, v in positions.items()))
        ds = [d for d in room.decisions if d.issue_id == issue.id]
        last = ds[-1] if ds else None
        issues_out.append({
            "issue_id": issue.id, "title": issue.title, "opinions": opinions, "conflicts": conflicts,
            "decision": decision_dict(room, last) if last else None,
            "status": last.status if last else ("open" if opinions else "untouched"),
        })
    questions = [{"who": p.name, "uid": uid, "text": q.text, "reason": q.reason}
                 for uid, p in room.personas.items() for q in p.questions if q.status == "open"]
    loose = [decision_dict(room, d) for d in room.decisions if not d.issue_id]
    summary, next_steps, engine = "", [], llm.RULE
    if msgs:
        sys_p, user_p, _ = llm.prompt(
            "minutes", agenda=room.agenda, issues=", ".join(f"{i.id}:{i.title}" for i in room.issues),
            decisions=" / ".join(f"{d.issue_id}:{d.text}({d.status})" for d in room.decisions) or "없음",
            history=history_text(room, 80))
        data, engine = await llm.call_json("minutes", "slow", sys_p, user_p, _MIN_SCHEMA, temperature=0.2,
                                           max_tokens=1200)
        if data is not None:
            summary = data.get("summary", "")
            next_steps = [x for x in data.get("next_steps", []) if isinstance(x, str)][:5]
            by_id = {x.get("issue_id"): x for x in data.get("issues", [])}
            for it in issues_out:
                llm_it = by_id.get(it["issue_id"])
                if llm_it and llm_it.get("conflicts"):
                    it["conflicts"] = [c for c in llm_it["conflicts"] if isinstance(c, str)][:3] or it["conflicts"]
        else:
            engine = llm.RULE
    if not summary:
        done = [i for i in issues_out if i["status"] == "confirmed"]
        pend = [i for i in issues_out if i["status"] in ("pending", "objected", "needs_check")]
        opened = [i for i in issues_out if i["status"] in ("open", "untouched")]
        bits = [f"쟁점 {len(room.issues)}개 중 확정 {len(done)}개, 보류·확인 필요 {len(pend)}개, 미결 {len(opened)}개예요."]
        if pend:
            bits.append("보류된 결정은 불참자가 돌아와 승인하면 확정돼요.")
        summary = " ".join(bits)
        next_steps = [f"{i['title']} 이어서 논의" for i in opened][:3] + \
                     [f"{q['who']} 님 확인: {q['text']}" for q in questions][:3]
    dur = (time.time() - started) if started else 0
    return {
        "agenda": room.agenda, "summary": summary, "issues": issues_out, "questions": questions,
        "loose_decisions": loose, "next_steps": next_steps, "engine": engine,
        "stats": {"messages": len(msgs), "mini": sum(1 for m in msgs if m.kind == "mini"),
                  "minutes": round(dur / 60, 1), "decisions": len(room.decisions)},
        "ts": time.time(),
    }
