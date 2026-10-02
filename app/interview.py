"""입장 인터뷰 (회의 전 3분) + 발언 다듬기.

흐름: 보고서 → 입장 카드 초안 → 빈 쟁점만 질문 → 한 줄 답 → AI가 풀어 씀(후보) → 본인이 '맞아요/고칠래요' → 확인된 것만 근거.
"""
from __future__ import annotations

import re

from . import ko, llm
from .agenda import detect_position
from .models import InterviewQ, Persona, Room, Stance, new_id
from .persona import history_text

MAX_QUESTIONS = 5
_NEG = re.compile(r"^\s*(아니|아냐|아뇨|틀려|틀렸|노|no)\b", re.I)


def plan(room: Room, p: Persona) -> list[InterviewQ]:
    """확인된 입장이 없는 쟁점만 묻는다. 보고서 초안이 있으면 '맞나요?'로, 없으면 선택지·자유 질문으로."""
    keep = [q for q in p.interview if q.status != "open"]
    asked = {q.issue_id for q in keep if q.status == "answered"}
    new: list[InterviewQ] = []
    for issue in room.issues:
        if p.confirmed(issue.id) or issue.id in asked:
            continue
        cand = next((s for s in p.stances if s.issue_id == issue.id and s.status == "candidate"), None)
        if cand:
            q = InterviewQ(new_id("q"), issue.id, "confirm",
                           f"보고서를 보면 '{cand.claim}'(으)로 읽혀요. 맞나요? 덧붙일 조건이 있으면 같이 적어 주세요.",
                           stance_id=cand.id)
        elif issue.options:
            labels = " / ".join(o["label"] for o in issue.options)
            q = InterviewQ(new_id("q"), issue.id, "position",
                           f"'{issue.title}'에서 {labels} 중 어느 쪽이세요? 이유도 한 줄로 적어 주세요.")
        else:
            q = InterviewQ(new_id("q"), issue.id, "open",
                           f"'{issue.title}'에 대해 어떻게 생각하세요? 맡고 싶은 일이나 꼭 지킬 조건을 한 줄로 적어 주세요.")
        new.append(q)
    for s in p.confirmed():
        if len(new) >= MAX_QUESTIONS:
            break
        if s.priority == 1 and not s.red_line and not any(q.kind == "redline" and q.issue_id == s.issue_id for q in keep):
            issue = room.issue(s.issue_id)
            if issue:
                new.append(InterviewQ(new_id("q"), s.issue_id, "redline",
                                      f"'{issue.title}'에서 이것만은 양보할 수 없다는 조건이 있나요? 없으면 '없음'이라고 적어 주세요."))
    p.interview = keep + new[:MAX_QUESTIONS]
    return new[:MAX_QUESTIONS]


_EXPAND_SCHEMA = {"type": "object", "required": ["text"],
                  "properties": {"text": {"type": "string"}, "position": {"type": "string"},
                                 "red_line": {"type": "string"}}}


async def answer(room: Room, p: Persona, qid: str, text: str) -> tuple[InterviewQ, Stance | None, str]:
    q = next((x for x in p.interview if x.id == qid), None)
    if q is None:
        raise KeyError("질문을 찾을 수 없어요.")
    text = text.strip()
    if not text:
        raise ValueError("답을 적어 주세요.")
    issue = room.issue(q.issue_id)
    q.answer = text

    if q.kind == "redline":
        st = next((s for s in p.confirmed(q.issue_id) if s.priority == 1), None)
        q.status = "confirmed"
        if st and not re.match(r"^\s*(없음|없어|없다|없습니다|딱히)", text):
            st.red_line = ko.casual_to_polite(text)
            q.expanded = st.red_line
            p.touch()
        return q, st, llm.RULE

    cand = next((s for s in p.stances if s.id == q.stance_id), None) if q.kind == "confirm" else None
    if cand and _NEG.match(text):                 # 보고서 초안이 틀렸다고 함 → 초안 버리고 새 답으로
        cand.status = "rejected"
        cand = None

    sys_p, user_p, _ = llm.prompt("expand", name=p.name, issue=issue.title if issue else "",
                                  question=q.question, answer=text)
    data, engine = await llm.call_json("expand", "slow", sys_p, user_p, _EXPAND_SCHEMA, temperature=0.3,
                                       max_tokens=260)
    if data is not None and data.get("text", "").strip():
        expanded = data["text"].strip()
        red_line = (data.get("red_line") or "").strip()
    else:
        engine = llm.RULE
        expanded, red_line = _rule_expand(text, cand), ""

    position = detect_position(issue, text) or detect_position(issue, expanded)
    if cand:
        cand.claim = expanded
        cand.position = position or cand.position
        cand.red_line = red_line or cand.red_line
        st = cand
    else:
        st = Stance(new_id("s"), q.issue_id, expanded, position, "", "", red_line, "", 2, ["인터뷰 답"],
                    "candidate", "interview")
        p.stances.append(st)
    q.expanded = st.claim
    q.stance_id = st.id
    q.status = "answered"
    p.touch()
    return q, st, engine


def _rule_expand(answer: str, cand: Stance | None) -> str:
    if cand and ko.is_affirmative(answer):
        rest = re.sub(r"^\s*(맞아요|맞아|응|ㅇㅇ|그래|네|예|넹|웅|좋아)[,.!\s]*", "", answer)
        rest = re.sub(r"^[A-Za-z가-힣]{1,4}안[.,!\s]+", "", rest)      # '맞아 B안.' 의 선택지 반복은 뺀다
        extra = ko.casual_to_polite(rest) if rest.strip() else ""
        return (cand.claim + (" " + extra if extra else "")).strip()
    return ko.casual_to_polite(answer)


def confirm(p: Persona, stance_id: str, ok: bool, edit: str = "") -> tuple[Stance, list[Stance]]:
    """본인 확인. 같은 쟁점에 다른 선택지로 확인된 예전 카드가 있으면 새 카드로 대체한다 (입장 정합성)."""
    st = next((s for s in p.stances if s.id == stance_id), None)
    if st is None:
        raise KeyError("입장 카드를 찾을 수 없어요.")
    if edit.strip():
        st.claim = edit.strip()
        ok = True
    replaced: list[Stance] = []
    if ok:
        for other in p.confirmed(st.issue_id):
            if other.id == st.id:
                continue
            position_conflict = bool(st.position and other.position and st.position != other.position)
            re_answer = st.origin == "interview" and other.origin == "interview"
            if position_conflict or re_answer:
                other.status = "rejected"
                replaced.append(other)
        st.status = "confirmed"
    else:
        st.status = "rejected"
    for q in p.interview:
        if q.stance_id == st.id:
            q.status = "confirmed" if ok else "open"
            if not ok:
                q.answer, q.expanded, q.stance_id = "", "", ""
    p.touch()
    return st, replaced


# ---------------------------------------------------------------- 발언 다듬기
async def refine(room: Room, uid: str, text: str) -> tuple[str, str]:
    p = room.personas[uid]
    sys_p, user_p, _ = llm.prompt("refine", name=p.name, tone=" / ".join(p.profile.tone_examples) or "담백한 존댓말",
                                  history=history_text(room, 10), text=text)
    data, engine = await llm.call_json("refine", "slow", sys_p, user_p,
                                       {"type": "object", "required": ["text"],
                                        "properties": {"text": {"type": "string"}}},
                                       temperature=0.4, max_tokens=240)
    if data and data.get("text", "").strip():
        return data["text"].strip(), engine
    return ko.casual_to_polite(text), llm.RULE
