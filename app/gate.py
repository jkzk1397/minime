"""M2 개입 게이트 — 언제·누가·무엇을. (규칙 → 효용 점수 → 애매할 때만 작은 모델 1번)

효용 U = 관련도 × (0.35 + 0.65·근거) × (0.4 + 0.6·새로움) × (0.55 + 0.45·입장 차이) − 끼어들기 비용
- U ≥ GATE_HIGH  → 말한다 (규칙)
- U ≤ GATE_LOW   → 침묵 (규칙)
- 사이 구간       → 빠른 레인 모델이 판정 (상황이 비슷한 사람 라벨 예시 3개를 골라 넣는다). 모델이 없으면 GATE_MID 기준
- 이름을 불러 물었는데 근거가 없으면 '확인 필요'로 기권, 약속을 요구하면 위임 범위 밖이라 기권
"""
from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field

from . import config, ko, llm
from .models import Message, Room
from .persona import SPEECH_KINDS, _main_stance, get_index, history_text, report_evidence, strip_cites
from .retrieval import Hit, text_similarity, tokens


@dataclass
class Candidate:
    uid: str
    name: str
    rel: float = 0.0
    ev: float = 0.0
    nov: float = 1.0
    diff: float = 0.5
    cost: float = 0.0
    utility: float = 0.0
    called: bool = False
    commit: bool = False
    excluded: str = ""          # 규칙 필터에서 빠진 이유
    act: str = "opinion"
    position: str = ""
    hits: list[Hit] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        d.pop("hits")
        for k in ("rel", "ev", "nov", "diff", "cost", "utility"):
            d[k] = round(d[k], 3)
        d["evidence"] = [h.to_dict() for h in self.hits[:3]]
        return d


def _clip(x: float) -> float:
    return max(0.0, min(1.0, x))


_examples: list[dict] | None = None


def examples() -> list[dict]:
    global _examples
    if _examples is None:
        path = config.PROMPT_DIR / "examples" / "gate_examples.jsonl"
        _examples = [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()] \
            if path.exists() else []
    return _examples


def pick_examples(text: str, k: int = 3) -> list[dict]:
    """상황별 예시 자동 선택: 지금 발언과 가장 비슷한 사람 라벨 예시 k개 (훈련 없는 개선)."""
    ex = examples()
    return sorted(ex, key=lambda e: -text_similarity(text, e["message"]))[:k]


async def evaluate(room: Room, msg: Message, issue_id: str, msg_pos: str, typing: list[str]) -> dict:
    names = {u: p.name for u, p in room.personas.items()}
    q_kind = ko.question_kind(msg.text)
    is_q = bool(q_kind)
    is_commit = bool(ko.COMMIT.search(msg.text))
    called = set(ko.addressed_mini(msg.text, names))
    if is_q or is_commit:
        called |= set(ko.mentions(msg.text, names))
    called.discard(msg.user_id)
    now = time.time()
    pos_i = next((i for i in range(len(room.messages) - 1, -1, -1) if room.messages[i].id == msg.id), len(room.messages))
    before = room.messages[:pos_i]
    recent = [m for m in before[-8:] if m.kind in ("human", "mini")]
    last4 = [m for m in before if m.kind in ("human", "mini")][-4:]
    mini_recent = sum(1 for m in last4 if m.kind == "mini")
    msg_toks = set(tokens(msg.text))
    query = ko.strip_address(msg.text, list(names.values()))

    cands: list[Candidate] = []
    for uid, p in room.personas.items():
        if not p.mini_on or uid == msg.user_id:
            continue
        c = Candidate(uid, p.name, called=uid in called, commit=uid in called and is_commit)
        if room.mode == "call" and not c.called:
            c.excluded = "호출형: 부르지 않음"
        elif not c.called and now - p.last_spoke < config.COOLDOWN_SEC:
            c.excluded = "쿨다운"
        elif not c.called and recent and recent[-1].kind == "mini" and recent[-1].user_id == uid:
            c.excluded = "연속 발언 금지"
        idx = await get_index(room, uid)
        c.hits = await idx.search(query, k=5, kinds=SPEECH_KINDS)
        ev_ret = max((h.strength for h in c.hits), default=0.0)       # 발언 자체를 덮는 근거
        stance = _main_stance(p, issue_id) if issue_id else None
        if stance:
            stake = {1: 1.0, 2: 0.85}.get(stance.priority, 0.7)
            c.position = stance.position
            issue = room.issue(issue_id)
            n_rep = len(report_evidence(p, issue)) if issue else 0
            ev_stance = _clip(0.6 + 0.08 * min(3, n_rep) + (0.06 if stance.reasons or stance.sources else 0))
        else:
            stake = 0.4 if any(h.chunk.kind == "report" and h.strength >= config.EVIDENCE_MIN for h in c.hits) else 0.0
            ev_stance = 0.0
        # 사실을 묻는 질문은 그 내용을 덮는 문단이 있어야 답한다. 의견·입장 이야기는 확인된 입장 카드가 근거다.
        c.ev = ev_ret if q_kind == "fact" else max(ev_ret, ev_stance)
        expert = 1.0 if any(k and (k in msg.text or set(tokens(k)) & msg_toks) for k in p.profile.expertise) else 0.0
        c.rel = 1.0 if c.called else _clip(0.55 * stake + 0.3 * ev_ret + 0.15 * expert + 0.1 * is_q)
        content = stance.claim if stance else (c.hits[0].chunk.text if c.hits else "")
        sim = max((text_similarity(content, strip_cites(m.text)) for m in recent), default=0.0)
        c.nov = _clip(1 - (sim - 0.15) * 1.6)
        if any(m.kind == "mini" and m.user_id == uid and m.issue_id == issue_id and issue_id
               and not m.meta.get("abstain") for m in recent):
            c.nov *= 0.5
        if msg_pos and c.position:
            c.diff = 1.0 if msg_pos != c.position else 0.2
        elif msg_pos:
            c.diff = 0.4
        else:
            c.diff = 0.5
        c.cost = (0.05 + (0.12 if now - p.last_spoke < 60 else 0) + 0.06 * mini_recent
                  + (0.15 if [u for u in typing if u != msg.user_id] else 0) - (0.05 if room.mode == "interactive" else 0))
        c.utility = c.rel * (0.35 + 0.65 * c.ev) * (0.4 + 0.6 * c.nov) * (0.55 + 0.45 * c.diff) - c.cost
        if c.called and q_kind == "fact":
            c.act = "answer"
        elif c.diff >= 1.0:
            c.act = "rebuttal"
        elif c.diff <= 0.2 and stance and stance.red_line:
            c.act = "agree_add"
        elif q_kind == "fact":
            c.act = "answer"
        cands.append(c)

    actions: list[dict] = []
    zone, source, reason = "", "rule", ""
    # 1) 이름을 불러 물은 미니미 (호출)
    for c in [c for c in cands if c.called]:
        if c.commit:
            actions.append({"uid": c.uid, "type": "abstain", "reason": "commit", "act": "answer"})
        elif c.ev < config.EVIDENCE_MIN:
            actions.append({"uid": c.uid, "type": "abstain", "reason": "no_evidence", "act": "answer"})
        else:
            actions.append({"uid": c.uid, "type": "speak", "act": c.act})
    if actions:
        zone, reason = "called", "이름을 불러 물어봄 → 호출된 미니미가 응답 (근거 없으면 기권)"
    else:
        pool = sorted([c for c in cands if not c.excluded], key=lambda c: -c.utility)
        if pool:
            top = pool[0]
            ask_model = config.GATE_MODE == "llm" or (config.GATE_MODE == "hybrid"
                                                      and config.GATE_LOW < top.utility < config.GATE_HIGH)
            if config.GATE_MODE != "llm" and top.utility >= config.GATE_HIGH:
                zone, reason = "high", f"{top.name} 미니미 효용 {top.utility:.2f} ≥ {config.GATE_HIGH} → 말한다"
                if top.ev >= config.EVIDENCE_MIN:
                    actions.append({"uid": top.uid, "type": "speak", "act": top.act})
                else:
                    reason += f" · 근거 {top.ev:.2f} < {config.EVIDENCE_MIN} → 침묵"
            elif config.GATE_MODE != "llm" and top.utility <= config.GATE_LOW:
                zone, reason = "low", f"최고 효용 {top.utility:.2f} ≤ {config.GATE_LOW} → 침묵"
            else:
                zone = "mid"
                verdict = await _ask_model(room, msg, pool[:3]) if ask_model else None
                if verdict is not None:
                    data, engine = verdict
                    source = engine
                    who = data.get("who", "")
                    pick = next((c for c in pool if c.uid == who), None)
                    reason = f"애매한 구간 → 모델 판정: {data.get('reason', '')}"
                    if data.get("speak") and pick and pick.ev >= config.EVIDENCE_MIN:
                        act = data.get("act") if data.get("act") in ("opinion", "rebuttal", "answer", "agree_add") else pick.act
                        actions.append({"uid": pick.uid, "type": "speak", "act": act})
                else:
                    ok = top.utility >= config.GATE_MID and top.ev >= config.EVIDENCE_MIN
                    reason = (f"애매한 구간 → 규칙 기준 {config.GATE_MID}: 효용 {top.utility:.2f} "
                              + ("→ 말한다" if ok else "→ 침묵"))
                    if ok:
                        actions.append({"uid": top.uid, "type": "speak", "act": top.act})
            # 상호작용형: 두 번째로 관련 있는 미니미도 확실히 높으면 말한다 (최대 2명)
            if room.mode == "interactive" and actions and len(pool) > 1:
                second = pool[1]
                if second.utility >= config.GATE_HIGH - 0.08 and second.ev >= config.EVIDENCE_MIN:
                    actions.append({"uid": second.uid, "type": "speak", "act": second.act})
        else:
            zone, reason = "none", ("대리 참석 중인 미니미가 없음" if not cands else "모든 후보가 규칙 필터에서 제외됨")

    return {
        "type": "gate", "msg_id": msg.id, "ts": time.time(), "issue_id": issue_id, "msg_position": msg_pos,
        "candidates": [c.to_dict() for c in sorted(cands, key=lambda c: -c.utility)],
        "actions": actions, "zone": zone, "source": source, "reason": reason, "mode": room.mode,
        "thresholds": {"high": config.GATE_HIGH, "low": config.GATE_LOW, "mid": config.GATE_MID,
                       "evidence_min": config.EVIDENCE_MIN},
        "_hits": {c.uid: c.hits for c in cands},
    }


_GATE_SCHEMA = {"type": "object", "required": ["speak", "who"],
                "properties": {"speak": {"type": "boolean"}, "who": {"type": "string"},
                               "act": {"type": "string"}, "reason": {"type": "string"}}}


async def _ask_model(room: Room, msg: Message, top: list[Candidate]):
    p = room.personas.get(msg.user_id)
    cand_txt = "\n".join(
        f"- {c.uid} ({c.name} 미니미, 입장 {c.position or '없음'}): relevance={c.rel:.2f} evidence={c.ev:.2f} "
        f"novelty={c.nov:.2f} diff={c.diff:.2f} cost={c.cost:.2f} U={c.utility:.2f} 추천행동={c.act}" for c in top)
    ex_txt = "\n".join(f"- 발언: {e['message']} / 상황: {e.get('context', '')} → {e['label']}"
                       for e in pick_examples(msg.text)) or "(없음)"
    sys_p, user_p, _ = llm.prompt("gate", history=history_text(room, 8), trigger=f"{p.name if p else '?'}: {msg.text}",
                                  candidates=cand_txt, examples=ex_txt)
    data, engine = await llm.call_json("gate", "fast", sys_p, user_p, _GATE_SCHEMA, temperature=0.0, max_tokens=80)
    if data is None:
        return None
    return data, engine
