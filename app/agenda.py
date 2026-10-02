"""M4 안건 이탈 감지 + 쟁점·입장 인식 (LLM 없이 수 ms).

- 쟁점 인식: 발언이 어느 쟁점 이야기인가 (쟁점 단서어 겹침 + 선택지 언급)
- 입장 인식: 발언이 어느 선택지를 지지하는가 ('A안보다 B안이 낫다' → B안)
- 안건 거리: 0(안건 한가운데) ~ 1(완전히 딴 이야기). 임계값 위가 K턴 이어지면 (모델 확인 후) 안건을 상기시킨다
"""
from __future__ import annotations

import re
from functools import lru_cache

from . import config, ko, llm
from .models import Issue, Room
from .retrieval import tokens

_NAME_TOKENS = {"미니미", "님"}


def _tok_set(text: str) -> frozenset[str]:
    return frozenset(tokens(text))


@lru_cache(maxsize=256)
def _issue_lex(sig: str) -> frozenset[str]:
    return _tok_set(sig)


def issue_lexicon(issue: Issue) -> frozenset[str]:
    parts = [issue.title, *issue.keywords]
    for o in issue.options:
        parts.append(o.get("label", ""))
        parts.extend(o.get("keywords", []))
    return _issue_lex(" ".join(parts))


def agenda_lexicon(room: Room) -> frozenset[str]:
    lex = set(_issue_lex(room.agenda or ""))
    for i in room.issues:
        lex |= issue_lexicon(i)
    return frozenset(lex)


def domain_lexicon(room: Room) -> frozenset[str]:
    """팀 보고서·확인된 입장에 자주 나오는 내용어 (안건 주변 어휘)."""
    from collections import Counter
    sig = tuple((uid, p.version) for uid, p in sorted(room.personas.items()))
    return _domain_cached(room.room_id, sig, _domain_text(room))


def _domain_text(room: Room) -> str:
    texts = []
    for p in room.personas.values():
        for r in p.reports:
            texts.extend(r.paragraphs)
        texts.extend(s.claim for s in p.confirmed())
    return "\n".join(texts)


@lru_cache(maxsize=64)
def _domain_cached(room_id: str, sig: tuple, text: str) -> frozenset[str]:
    from collections import Counter
    c = Counter(tokens(text))
    return frozenset(w for w, n in c.most_common(80) if n >= 1 and len(w) > 1)


# ---------------------------------------------------------------- 입장 인식
def detect_position(issue: Issue | None, text: str) -> str:
    if not issue or not issue.options:
        return ""
    t = text.lower()
    scores: dict[str, float] = {}
    for opt in issue.options:
        label = opt.get("label", "")
        kws = sorted({label, *opt.get("keywords", [])}, key=len, reverse=True)
        sc, found, used = 0.0, False, []
        for kw in kws:
            if not kw:
                continue
            for m in re.finditer(re.escape(kw.lower()), t):
                if any(a <= m.start() < b for a, b in used):      # 더 긴 단서어에 이미 포함된 위치
                    continue
                used.append((m.start(), m.end()))
                found = True
                # 선택지 라벨('B안')은 강한 신호, 단서어('무대')만 나온 건 약한 신호 (입장 표현이 붙어야 커진다)
                sc += 1.0 if kw == label else 0.25
                after = t[m.end(): m.end() + 14]
                before = t[max(0, m.start() - 6): m.start()]
                if any(c in after for c in ko.NEG_CUES) or "말고" in before:
                    sc -= 1.6
                elif any(c in after for c in ko.POS_CUES):
                    sc += 0.8
        if found:
            scores[label] = sc
    if not scores:
        return ""
    best = max(scores, key=lambda k: scores[k])
    if 0 < scores[best] < 0.5:
        return ""                                  # 단서어가 지나가듯 한 번 나온 정도로는 입장이 아니다
    if scores[best] <= 0:
        if len(issue.options) == 2 and len(scores) == 1:
            return next(o["label"] for o in issue.options if o["label"] != best)
        return ""
    rest = [v for k, v in scores.items() if k != best]
    if rest and scores[best] - max(rest) < 0.3:
        return ""
    return best


def stance_position(issue: Issue | None, text: str) -> str:
    """발언의 입장. 질문 문장('타 대학 사례는 어떤 게 있어?')은 입장이 아니므로 뺀다."""
    plain = [s for s in ko.sentences(text) if not ko.QUESTION.search(s)]
    return detect_position(issue, " ".join(plain)) if plain else ""


def detect_issue(room: Room, text: str) -> tuple[str, float]:
    toks = _tok_set(text)
    best, best_s = "", 0.0
    for issue in room.issues:
        s = 0.5 * len(toks & issue_lexicon(issue))
        if detect_position(issue, text):
            s += 0.6
        if s > best_s:
            best, best_s = issue.id, s
    return (best, best_s) if best_s >= 0.5 else ("", best_s)


def issue_query(issue: Issue) -> str:
    parts = [issue.title, *issue.keywords]
    for o in issue.options:
        parts.append(o.get("label", ""))
        parts.extend(o.get("keywords", [])[:4])
    return " ".join(parts)


# ---------------------------------------------------------------- 안건 거리
def distance(room: Room, text: str) -> float | None:
    """한 발언의 안건 거리. 내용어가 없는 짧은 맞장구는 None (거리 계산에서 뺀다).
    안건·쟁점이 하나도 없는 방은 잴 기준이 없으므로 None (모든 발언이 '이탈'로 보이지 않게)."""
    if not has_agenda(room):
        return None
    names = {p.name for p in room.personas.values()}
    toks = {t for t in _tok_set(text) if t not in _NAME_TOKENS and t not in names
            and not any(t.startswith(n) for n in names)}
    if not toks:
        return None
    lex = agenda_lexicon(room)
    dom = domain_lexicon(room) - lex
    sim = 0.5 * len(toks & lex) + 0.25 * len(toks & dom)
    return round(max(0.0, 1.0 - min(1.0, sim)), 3)


def has_agenda(room: Room) -> bool:
    return bool((room.agenda or "").strip() or room.issues)


def remaining_issues(room: Room) -> list[Issue]:
    return [i for i in room.issues if i.status not in ("decided", "pending")]


async def check_drift(room: Room) -> dict | None:
    """최근 K개 거리가 모두 임계값 위면 안건 상기 후보. 모델이 있으면 한 번 확인한다."""
    import time
    if not has_agenda(room):
        return None
    pts = [d for d in room.drift if d.get("distance") is not None]
    if len(pts) < config.DRIFT_K or time.time() - room.last_reminder < config.DRIFT_COOLDOWN_SEC:
        return None
    recent = pts[-config.DRIFT_K:]
    if not all(d["distance"] >= config.DRIFT_THRESHOLD for d in recent):
        return None
    if room.drift and room.drift[-1].get("reminded"):
        return None
    window = [m for m in room.messages if m.kind == "human"][-3:]
    source = "rule"
    sys_p, user_p, _ = llm.prompt(
        "drift", agenda=room.agenda, issues=", ".join(i.title for i in room.issues),
        window="\n".join(f"- {room.personas[m.user_id].name if m.user_id in room.personas else '?'}: {m.text}"
                         for m in window))
    data, engine = await llm.call_json("drift", "fast", sys_p, user_p,
                                       {"type": "object", "required": ["off_topic"],
                                        "properties": {"off_topic": {"type": "boolean"}, "reason": {"type": "string"}}},
                                       temperature=0.0, max_tokens=60)
    if data is not None:
        source = engine
        if not data.get("off_topic"):
            return None
    room.last_reminder = time.time()
    room.drift[-1]["reminded"] = True
    rem = remaining_issues(room)
    return {"remaining": [{"id": i.id, "title": i.title} for i in rem], "source": source,
            "distance": recent[-1]["distance"]}


def reminder_text(room: Room, remaining: list[dict]) -> str:
    if not room.issues:
        return f"잠깐, 대화가 안건({room.agenda})에서 조금 벗어난 것 같아요. 안건으로 돌아가 볼까요?"
    if not remaining:
        return "잠깐, 대화가 안건에서 조금 벗어난 것 같아요. 쟁점은 모두 정리됐으니 회의를 마무리해도 좋아요."
    nums = {i.id: n for n, i in enumerate(room.issues, 1)}
    items = " · ".join(f"{_circled(nums.get(r['id'], 0))} {r['title']}" for r in remaining)
    return f"잠깐, 대화가 안건에서 조금 벗어난 것 같아요. 남은 쟁점: {items}. 어떤 것부터 이어갈까요?"


def _circled(n: int) -> str:
    return "①②③④⑤⑥⑦⑧⑨⑩"[n - 1] if 1 <= n <= 10 else str(n)
