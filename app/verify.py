"""M3 2차 검증 — 주장을 쪼개서 근거와 대조한다.

1. 원자 주장으로 나눈다 (FActScore)
2. 주장마다 Toulmin 칸을 채운다: 주장 / 근거 / 전제 / 단정 표현. 빈 칸이 곧 '근거 부족'
3. 검증 질문을 만들고 답을 '따로' 찾는다 (Chain-of-Verification):
   내 보고서·입장 / 내 이전 발언 / 팀원 보고서·입장(반대 근거)
4. 주장마다 supported(근거 있음) / weak(근거 약함) / conflict(충돌) / none(근거 없음) 판정 + 놓친 점 + 반대 관점
판정은 모델이 있으면 모델이, 없으면 규칙(입장 일치·근거 점수·단정 표현)이 한다.
"""
from __future__ import annotations

import re
import time

from . import config, ko, llm
from .agenda import detect_issue, detect_position
from .models import Message, Room
from .persona import _main_stance, get_index, stance_labels, team_index
from .retrieval import Hit, lexical_support, tokens

_PLAN_SCHEMA = {"type": "object", "required": ["claims"],
                "properties": {"claims": {"type": "array", "items": {
                    "type": "object", "required": ["claim"],
                    "properties": {"claim": {"type": "string"}, "grounds": {"type": "string"},
                                   "warrant": {"type": "string"}, "qualifier": {"type": "string"},
                                   "questions": {"type": "array", "items": {"type": "string"}}}}}}}
_JUDGE_SCHEMA = {"type": "object", "required": ["claims"],
                 "properties": {"claims": {"type": "array", "items": {
                     "type": "object", "required": ["index", "verdict"],
                     "properties": {"index": {"type": "integer"},
                                    "verdict": {"type": "string", "enum": ["supported", "conflict", "none", "weak"]},
                                    "note": {"type": "string"}}}},
                     "missed": {"type": "array", "items": {"type": "string"}},
                     "devil": {"type": "object", "properties": {"text": {"type": "string"}, "cite": {"type": "string"}}}}}

_CAUSE = re.compile(r"(으니까|니까|때문에|때문이|이므로|므로|왜냐하면|해서|라서|이라서)")


def decompose_rule(text: str) -> list[dict]:
    """규칙 분해: 문장 → (근거절 + 주장절). '…니까 확실해'처럼 근거만 있는 절은 앞 주장의 근거로 붙인다."""
    claims: list[dict] = []
    for sent in ko.sentences(text):
        s = sent.strip()
        if not s or (ko.QUESTION.search(s) and not ko.DECISION.search(s)):
            continue
        s = re.sub(r"^(결론적으로|그러니까|그래서|정리하면|아무튼|암튼)\s*,?\s*", "", s)
        m = _CAUSE.search(s)
        qual = ", ".join(sorted(set(ko.ABSOLUTE.findall(s))))
        if m:
            reason = _restore_ending(s[:m.start()].strip(" ,"), m.group(1))
            head = s[m.end():].strip(" ,.")
            if len(tokens(head)) <= 1 and claims:            # '…니까 확실해' → 앞 주장의 근거
                claims[-1]["grounds"] = reason
                claims[-1]["qualifier"] = ", ".join(x for x in (claims[-1]["qualifier"], qual) if x)
                claims.append({"claim": reason, "grounds": "", "warrant": "", "qualifier": qual})
                continue
            claims.append({"claim": head or reason, "grounds": reason if head else "", "warrant": "", "qualifier": qual})
        else:
            claims.append({"claim": s.rstrip("."), "grounds": "", "warrant": "", "qualifier": qual})
    for c in claims:
        c["questions"] = [f"'{c['claim']}'을(를) 뒷받침하는 자료가 있나요?", "발언자의 이전 발언과 앞뒤가 맞나요?"]
    return claims[:4]


def _restore_ending(stem: str, cue: str) -> str:
    """'…더 높' + '으니까' → '…더 높다', '…높기' + '때문에' → '…높다'."""
    if cue in ("으니까", "니까", "이므로", "므로"):
        return stem + "다" if not stem.endswith("다") else stem
    if cue.startswith("때문") and stem.endswith("기"):
        return stem[:-1] + "다"
    return stem


async def run(room: Room, requester: str, target: Message) -> dict:
    speaker = target.user_id
    sp = room.personas[speaker]
    t0 = time.perf_counter()
    sys_p, user_p, _ = llm.prompt("verify_plan", speaker=sp.name, text=target.text)
    plan, plan_engine = await llm.call_json("verify_plan", "slow", sys_p, user_p, _PLAN_SCHEMA, temperature=0.1,
                                            max_tokens=600)
    claims = [c for c in (plan or {}).get("claims", []) if c.get("claim", "").strip()][:4] or decompose_rule(target.text)
    for c in claims:
        c.setdefault("grounds", "")
        c.setdefault("warrant", "")
        c["qualifier"] = c.get("qualifier") or ", ".join(sorted(set(ko.ABSOLUTE.findall(c["claim"] + " " + c.get("grounds", "")))))
        c.setdefault("questions", [])

    issue_id = target.issue_id or detect_issue(room, target.text)[0]
    issue = room.issue(issue_id)
    own = await get_index(room, speaker)
    team = await team_index(room, speaker)
    past = _past_statements(room, speaker, target)

    for c in claims:
        query = " ".join([c["claim"], c.get("grounds", "")])
        pos = detect_position(issue, c["claim"]) or detect_position(issue, target.text) if issue else ""
        c["position"] = pos
        own_hits = await own.search(query, k=3)
        team_hits = await team.search(query, k=4)
        ev = []
        for h in own_hits:
            if h.strength >= config.EVIDENCE_MIN * 0.8:
                ev.append(_ev(h, "own", issue))
        for h in team_hits:
            if h.strength >= config.EVIDENCE_MIN * 0.8:
                ev.append(_ev(h, "team", issue))
        conflicts = []
        stancey = bool(ko.DECISION.search(c["claim"]) or any(
            o["label"].lower() in c["claim"].lower() for o in (issue.options if issue else [])))
        if pos and stancey:
            for pst in past:
                ppos = detect_position(issue, pst["text"])
                if ppos and ppos != pos:
                    conflicts.append({"label": pst["label"], "text": pst["text"], "source": "past", "position": ppos,
                                      "strength": 1.0})
            mine = _main_stance(sp, issue_id)
            if mine and mine.position and mine.position != pos:
                conflicts.append({"label": stance_labels(sp).get(mine.id, "입장 카드"), "text": mine.claim,
                                  "source": "own", "position": mine.position, "strength": 1.0})
        num = _numeric_mismatch(c["claim"] + " " + c.get("grounds", ""), own_hits + team_hits)
        if num:
            conflicts.append(num)
        c["evidence"] = ev[:5]
        c["conflicts"] = conflicts[:2]
        c["verdict"], c["note"] = _rule_verdict(c, pos)
        if c["verdict"] == "none" and config.TAVILY_API_KEY:
            c["evidence"] += await _web(c["claim"])      # 선택: 팀 자료에 없으면 웹에서 한 번 더 (Tavily 무료 한도)

    missed = _missed(room, speaker, target, issue_id)
    devil = await _devil(room, team, target, issue_id, claims)
    engine = plan_engine if plan is not None else llm.RULE

    # 모델이 있으면 판정을 한 번 더 (규칙 판정은 근거 목록과 함께 넘긴다)
    claims_txt = "\n".join(
        f"[{i}] {c['claim']} (근거로 든 것: {c.get('grounds') or '없음'}, 단정: {c.get('qualifier') or '없음'})\n"
        + "\n".join(f"   - {e['label']}: {e['text']}" for e in c["evidence"] + c["conflicts"]) for i, c in enumerate(claims))
    team_txt = "\n".join(f"- {p.name}: " + " / ".join(s.claim + (f" (양보 불가: {s.red_line})" if s.red_line else "")
                                                    for s in p.confirmed(issue_id))
                         for u, p in room.personas.items() if u != speaker and p.confirmed(issue_id)) or "(없음)"
    sys_p, user_p, _ = llm.prompt("verify_judge", speaker=sp.name, claims=claims_txt, team=team_txt)
    judged, judge_engine = await llm.call_json("verify_judge", "slow", sys_p, user_p, _JUDGE_SCHEMA, temperature=0.0,
                                               max_tokens=700)
    if judged is not None:
        engine = judge_engine
        for j in judged.get("claims", []):
            i = j.get("index")
            if isinstance(i, int) and 0 <= i < len(claims):
                v = j.get("verdict")
                # 규칙이 찾은 '이전 발언과 충돌'은 모델이 지우지 못한다 (근거가 명확한 판정)
                if not (claims[i]["verdict"] == "conflict" and v != "conflict"):
                    claims[i]["verdict"] = v
                    claims[i]["note"] = j.get("note") or claims[i]["note"]
        missed = (judged.get("missed") or [])[:2] or missed
        if (judged.get("devil") or {}).get("text"):
            devil = {"text": judged["devil"]["text"], "cite": judged["devil"].get("cite", "")}

    labels = []
    vs = [c["verdict"] for c in claims]
    if "supported" in vs:
        labels.append("근거 있음")
    if "weak" in vs or "none" in vs:
        labels.append("근거 약함")
    if "conflict" in vs:
        labels.append("이전 발언과 충돌")
    if missed:
        labels.append("놓친 점")
    if devil:
        labels.append("반대 관점")
    return {
        "target": target.id, "target_text": target.text, "speaker": speaker, "requester": requester,
        "issue_id": issue_id, "claims": [{k: v for k, v in c.items()} for c in claims],
        "missed": missed, "devil": devil, "labels": labels, "engine": engine,
        "ms": round((time.perf_counter() - t0) * 1000),
    }


async def _web(claim: str) -> list[dict]:
    from . import tools
    try:
        r = await tools.web_search(claim)
    except Exception:
        return []
    if not r.get("answer"):
        return []
    return [{"label": "웹 검색", "text": r["answer"][:400], "source": "web", "strength": 0.0, "position": "",
             "urls": r.get("sources", [])[:3]}]


def _ev(h: Hit, source: str, issue) -> dict:
    return {"label": h.chunk.label, "text": h.chunk.text, "source": source, "strength": round(h.strength, 2),
            "position": detect_position(issue, h.chunk.text) if issue else ""}


def _past_statements(room: Room, uid: str, target: Message) -> list[dict]:
    p = room.personas[uid]
    out = [{"label": f"{x.get('when', '지난 회의')} 발언", "text": x["text"]} for x in p.past]
    for m in room.messages:
        if m.id == target.id:
            break
        if m.kind == "human" and m.user_id == uid:
            out.append({"label": f"오늘 {time.strftime('%H:%M', time.localtime(m.ts))} 발언", "text": m.text})
    return out


def _numeric_mismatch(claim: str, hits: list[Hit]) -> dict | None:
    """수치 대조: 주장의 '무엇의 몇 단위'가 자료에 다른 값으로 적혀 있으면 충돌로 본다 (예: 응답자 2천 명 ↔ 812명)."""
    nums = ko.numbers(claim)
    if not nums:
        return None
    for h in hits:
        if h.strength < 0.1:
            continue
        ev_nums = ko.numbers(h.chunk.text)
        for v, unit, subj in nums:
            if not subj:
                continue
            # 같은 단위 + 같은 대상('응답자 2천 명' ↔ '응답 812명')의 숫자끼리만 비교한다
            same_unit = [x for x in ev_nums if x[1] == unit and x[2][:2] == subj[:2]]
            if same_unit and not any(abs(x[0] - v) <= max(0.01 * v, 1e-6) for x in same_unit):
                shown = ", ".join(f"{x[0]:g}{x[1]}" for x in same_unit[:3])
                return {"label": h.chunk.label, "text": h.chunk.text, "source": "number", "position": "",
                        "strength": 1.0, "numeric": f"주장 {v:g}{unit} ↔ 자료 {shown}"}
    return None


def _rule_verdict(c: dict, pos: str) -> tuple[str, str]:
    if c["conflicts"]:
        x = c["conflicts"][0]
        if x.get("numeric"):
            return "conflict", f"숫자가 자료와 달라요 ({x['numeric']} · {x['label']})."
        return "conflict", f"{x['label']}에서는 '{x['position']}' 쪽이었어요: \"{_short(x['text'])}\""
    support = [e for e in c["evidence"]
               if (not pos or not e["position"] or e["position"] == pos) and e["strength"] >= config.EVIDENCE_MIN]
    if support:
        best = max(support, key=lambda e: e["strength"])
        lex = lexical_support(c["claim"], best["text"])
        if c.get("qualifier"):
            return "weak", (f"{best['label']}에 관련 근거는 있지만, '{c['qualifier']}' 같은 단정 표현은 근거보다 강해요. "
                            f"범위를 좁혀 말하면 좋아요.")
        if not c.get("grounds") and lex < 0.25:
            return "weak", f"관련 자료({best['label']})는 있지만 발언 안에 근거가 제시되지 않았어요."
        return "supported", f"{best['label']}이(가) 이 주장을 뒷받침해요."
    if c.get("qualifier"):
        return "none", f"'{c['qualifier']}'처럼 단정했지만, 이를 뒷받침하는 자료를 찾지 못했어요."
    return "none", "내 보고서·팀원 자료에서 뒷받침하는 근거를 찾지 못했어요."


def _short(t: str, n: int = 48) -> str:
    return t if len(t) <= n else t[:n].rstrip() + "…"


def _missed(room: Room, speaker: str, target: Message, issue_id: str) -> list[str]:
    """놓친 점: 같은 쟁점에 팀원의 '양보 불가 조건'이 있는데 발언이 다루지 않은 경우."""
    out = []
    t = set(tokens(target.text))
    for uid, p in room.personas.items():
        if uid == speaker:
            continue
        for s in p.confirmed(issue_id):
            if s.red_line and len(set(tokens(s.red_line)) & t) < 2:
                lab = stance_labels(p).get(s.id, "입장 카드")
                out.append(f"{p.name} 님의 양보 불가 조건: {s.red_line} [{p.name} {lab}]")
    return out[:2]


async def _devil(room: Room, team, target: Message, issue_id: str, claims: list[dict]) -> dict | None:
    """반대 관점(악마의 변호인): 다른 선택지를 지지하는 팀원의 '확인된 입장'과 그 사람의 보고서 근거.
    키워드만으로는 사실 문단의 입장을 잘못 읽을 수 있어서, 입장 카드에서 출발한다."""
    issue = room.issue(issue_id)
    pos = next((c["position"] for c in claims if c.get("position")), "")
    if not issue or not pos:
        return None
    for uid, p in list(room.personas.items()):          # 안에서 await 하므로 복사본으로 돈다
        if uid == target.user_id:
            continue
        for st in p.confirmed(issue_id):
            if not st.position or st.position == pos:
                continue
            idx = await get_index(room, uid)
            hits = await idx.search(f"{st.claim} {st.reasons}", k=3, kinds={"report"})
            best = max(hits, key=lambda h: h.strength + 0.3 * bool(re.search(r"\d", h.chunk.text)), default=None)
            if best and best.strength >= config.EVIDENCE_MIN * 0.6:
                sent = ko.polite(_best(best.chunk.text, f"{st.claim} {st.reasons}"))
                return {"text": f"{st.position} 쪽에서 보면: {sent}", "cite": f"{p.name} {best.chunk.label}"}
            lab = stance_labels(p).get(st.id, "입장 카드")
            return {"text": f"{st.position} 쪽에서 보면: {st.claim}", "cite": f"{p.name} {lab}"}
    return None


def _best(passage: str, query: str) -> str:
    from .persona import best_sentence
    return best_sentence(passage, query) or passage
