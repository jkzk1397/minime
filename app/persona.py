"""M1 근거 페르소나 + M6 기억·준비도.

미니미는 '본인이 확인한 입장 카드'와 '보고서 문단'에 있는 말만 한다.
- 모든 문장에 출처 라벨을 달고, 생성 후 검사에서 출처가 뒷받침하지 않는 문장은 지운다 (ALCE)
- 근거 점수가 임계값 아래면 말하지 않고 '복귀 후 확인할 질문'으로 남긴다 (Self-RAG, R-Tuning)
- 모델이 없으면 입장 카드 + 근거 문장을 그대로 엮는 추출식 규칙 발언으로 대체한다 (환각 0)
"""
from __future__ import annotations

import re
import time

from . import config, ko, llm, nli
from .agenda import detect_issue, detect_position, issue_query, stance_position
from .models import Issue, Message, Persona, Report, ReturnQuestion, Room, Stance, new_id
from .retrieval import Chunk, Hit, Index, lexical_support, text_similarity, tokens

SPEECH_KINDS = {"report", "stance", "interview", "profile"}


# ---------------------------------------------------------------- 라벨·청크
def report_label(p: Persona, ri: int, pi: int) -> str:
    return f"보고서 {pi + 1}문단" if len(p.reports) <= 1 else f"보고서{ri + 1} {pi + 1}문단"


def stance_labels(p: Persona) -> dict[str, str]:
    out, n_s, n_i = {}, 0, 0
    for s in p.stances:
        if s.status != "confirmed":
            continue
        if s.origin == "interview":
            n_i += 1
            out[s.id] = f"인터뷰 {n_i}"
        else:
            n_s += 1
            out[s.id] = f"입장 {n_s}"
    return out


def stance_text(s: Stance) -> str:
    parts = [s.claim]
    if s.reasons:
        parts.append(f"근거: {s.reasons}")
    if s.red_line:
        parts.append(f"양보할 수 없는 조건: {s.red_line}")
    if s.unknown:
        parts.append(f"모르는 부분: {s.unknown}")
    return " ".join(parts)


def speech_chunks(p: Persona) -> list[Chunk]:
    chunks: list[Chunk] = []
    if p.consent.get("use_reports", True):
        for ri, r in enumerate(p.reports):
            for pi, para in enumerate(r.paragraphs):
                chunks.append(Chunk(f"{p.user_id}:{r.id}:{pi}", p.user_id, "report", report_label(p, ri, pi), para))
    labels = stance_labels(p)
    for s in p.stances:
        if s.status == "confirmed":
            kind = "interview" if s.origin == "interview" else "stance"
            chunks.append(Chunk(f"{p.user_id}:{s.id}", p.user_id, kind, labels[s.id], stance_text(s), s.issue_id, s.id))
    for n, proj in enumerate(p.profile.projects, 1):
        if proj.strip():
            chunks.append(Chunk(f"{p.user_id}:proj{n}", p.user_id, "profile", f"약력 {n}", proj))
    return chunks


_cache: dict[tuple, tuple] = {}


async def get_index(room: Room, uid: str) -> Index:
    p = room.personas[uid]
    key = (room.room_id, uid)
    ver = (p.version, llm.embed_available())
    hit = _cache.get(key)
    if hit and hit[0] == ver:
        return hit[1]
    idx = await Index.build(speech_chunks(p))
    _cache[key] = (ver, idx)
    return idx


async def team_index(room: Room, exclude: str) -> Index:
    """다른 팀원들의 보고서·입장 (2차 검증의 반대 근거, 놓친 점 찾기)."""
    key = (room.room_id, "team", exclude)
    ver = (tuple((u, p.version) for u, p in sorted(room.personas.items()) if u != exclude), llm.embed_available())
    hit = _cache.get(key)
    if hit and hit[0] == ver:
        return hit[1]
    chunks = []
    for u, p in room.personas.items():
        if u == exclude:
            continue
        for c in speech_chunks(p):
            c.label = f"{p.name} {c.label}"
            chunks.append(c)
    idx = await Index.build(chunks)
    _cache[key] = (ver, idx)
    return idx


# ---------------------------------------------------------------- 준비도 (M6)
def report_evidence(p: Persona, issue: Issue) -> list[str]:
    """보고서에 이 쟁점에 대한 '입장'이 있는 문단 라벨들.
    선택지가 있는 쟁점: 선택지를 지지·반대하는 문단 / 선택지가 없는 쟁점: 쟁점 단서어 2개 이상 + 입장 표현."""
    from .agenda import issue_lexicon
    lex = issue_lexicon(issue)
    out = []
    for ri, r in enumerate(p.reports):
        for pi, para in enumerate(r.paragraphs):
            overlap = len(set(tokens(para)) & lex)
            if issue.options:
                ok = overlap >= 2 and bool(detect_position(issue, para))
            else:
                ok = overlap >= 2 and bool(ko.STANCE_CUES.search(para))
            if ok:
                out.append(report_label(p, ri, pi))
    return out


async def readiness(room: Room, uid: str) -> dict:
    """준비도 = 안건 쟁점 중 근거를 찾을 수 있는 비율."""
    p = room.personas[uid]
    idx = await get_index(room, uid)
    items = []
    for issue in room.issues:
        conf = p.confirmed(issue.id)
        state, evidence = "none", []
        if conf:
            state = "confirmed"
            labels = stance_labels(p)
            evidence = [labels.get(s.id, "") for s in conf]
        else:
            ok = report_evidence(p, issue)
            if ok:
                state, evidence = "report", ok
            elif any(s.issue_id == issue.id and s.status == "candidate" for s in p.stances):
                state = "candidate"
        items.append({"issue_id": issue.id, "title": issue.title, "state": state, "evidence": evidence,
                      "unknown": next((s.unknown for s in conf if s.unknown), "")})
    covered = sum(1 for i in items if i["state"] in ("confirmed", "report"))
    total = len(items)
    return {"covered": covered, "total": total, "ready": total > 0 and covered == total,
            "confirmed": sum(1 for i in items if i["state"] == "confirmed"), "items": items}


# ---------------------------------------------------------------- 보고서 → 입장 카드 초안
_EXTRACT_SCHEMA = {
    "type": "object", "required": ["stances"],
    "properties": {"stances": {"type": "array", "items": {
        "type": "object", "required": ["issue_id", "claim"],
        "properties": {"issue_id": {"type": "string"}, "claim": {"type": "string"}, "position": {"type": "string"},
                       "reasons": {"type": "string"}, "warrant": {"type": "string"}, "red_line": {"type": "string"},
                       "unknown": {"type": "string"}, "priority": {"type": "integer"},
                       "sources": {"type": "array", "items": {"type": "string"}}}}}},
}


def split_report(text: str) -> list[str]:
    """붙여 넣은 글을 문단으로. 빈 줄 기준, 너무 긴 문단은 문장 단위로 다시 나눈다."""
    text = text.replace("\r\n", "\n").strip()
    paras = [re.sub(r"\s*\n\s*", " ", x).strip() for x in re.split(r"\n\s*\n", text) if x.strip()]
    if len(paras) == 1 and "\n" in text:
        paras = [x.strip() for x in text.split("\n") if x.strip()]
    out = []
    for para in paras:
        para = re.sub(r"^[-*•\d.)\s]+", "", para).strip()
        if len(para) <= 420:
            out.append(para)
            continue
        buf = ""
        for s in ko.sentences(para):
            if len(buf) + len(s) > 360 and buf:
                out.append(buf.strip())
                buf = ""
            buf += " " + s
        if buf.strip():
            out.append(buf.strip())
    return [p for p in out if len(p) >= 8][:40]


async def extract_stances(room: Room, p: Persona, report: Report) -> tuple[list[Stance], str]:
    ri = p.reports.index(report)
    labels = [report_label(p, ri, i) for i in range(len(report.paragraphs))]
    issues_txt = "\n".join(
        f"- {i.id}: {i.title}" + (f" (선택지: {', '.join(o['label'] for o in i.options)})" if i.options else "")
        for i in room.issues)
    paras_txt = "\n".join(f"[{lab}] {t}" for lab, t in zip(labels, report.paragraphs))
    sys_p, user_p, _ = llm.prompt("extract", issues=issues_txt, paragraphs=paras_txt)
    data, engine = await llm.call_json("extract", "slow", sys_p, user_p, _EXTRACT_SCHEMA, temperature=0.1,
                                       max_tokens=900)
    out: list[Stance] = []
    if data is not None:
        valid_issue = {i.id: i for i in room.issues}
        for d in data.get("stances", []):
            issue = valid_issue.get(d.get("issue_id", ""))
            claim = (d.get("claim") or "").strip()
            srcs = [s for s in d.get("sources", []) if s in labels]
            if not issue or not claim or not srcs:
                continue                        # 근거 문단이 없는 카드는 버린다 (추측 금지)
            pos = d.get("position", "")
            if pos not in {o["label"] for o in issue.options}:
                pos = detect_position(issue, claim)
            out.append(Stance(new_id("s"), issue.id, claim, pos, d.get("reasons", ""), d.get("warrant", ""),
                              d.get("red_line", ""), d.get("unknown", ""), int(d.get("priority") or 2), srcs,
                              "candidate", "report"))
        if out:
            return out, engine
    return _rule_extract(room, report, labels), llm.RULE


def _rule_extract(room: Room, report: Report, labels: list[str]) -> list[Stance]:
    from .agenda import issue_lexicon
    out = []
    for issue in room.issues:
        lex = issue_lexicon(issue)
        best = None
        for pi, para in enumerate(report.paragraphs):
            for sent in ko.sentences(para):
                pos = detect_position(issue, sent) if issue.options else ""
                overlap = len(set(tokens(sent)) & lex)
                if not ko.STANCE_CUES.search(sent) or (issue.options and not pos) or (not issue.options and overlap < 2):
                    continue
                score = overlap + (2 if pos else 0) + (1 if re.search(r"(제안|해야|생각)", sent) else 0)
                if not best or score > best[0]:
                    best = (score, pi, sent, pos)
        if not best:
            continue
        _, pi, sent, pos = best
        reason, rpi = "", None
        for pj, para in enumerate(report.paragraphs):
            if pj == pi:
                continue
            for s2 in ko.sentences(para):
                sc = len(set(tokens(s2)) & lex) + (1.5 if re.search(r"\d", s2) else 0)
                if sc >= 2.5 and (rpi is None or sc > reason[0]):
                    reason, rpi = (sc, s2), pj
        sources = [labels[pi]] + ([labels[rpi]] if rpi is not None else [])
        out.append(Stance(new_id("s"), issue.id, ko.polite(sent), pos,
                          ko.polite(reason[1]) if reason else "", "", "", "", 2, sources, "candidate", "report"))
    return out


def add_report(room: Room, p: Persona, title: str, text: str) -> Report:
    paras = split_report(text)
    if not paras:
        raise ValueError("보고서 내용이 비어 있어요.")
    rep = Report(new_id("r"), title.strip() or f"보고서 {len(p.reports) + 1}", paras)
    p.reports.append(rep)
    p.touch()
    return rep


# ---------------------------------------------------------------- 근거 발언 (M1)
_SPEAK_SCHEMA = {
    "type": "object", "required": ["sentences"],
    "properties": {"sentences": {"type": "array", "items": {
        "type": "object", "required": ["text", "cites"],          # core가 빠지면 text 전체를 검증 (더 엄격)
        "properties": {"text": {"type": "string"}, "core": {"type": "string"},
                       "cites": {"type": "array", "items": {"type": "string"}}}}}},
}
_OPENER = {"rebuttal": "저는 생각이 조금 달라요.", "agree_add": "저도 같은 방향이에요.", "opinion": "", "answer": ""}


def best_sentence(passage: str, query: str, avoid: str = "") -> str:
    q = set(tokens(query))
    best, best_s = "", -1.0
    for s in ko.sentences(passage):
        if avoid and (text_similarity(s, avoid) > 0.6 or lexical_support(s, avoid) > 0.7):
            continue                       # 이미 말한 주장과 같은 문장은 근거로 다시 쓰지 않는다
        sc = len(q & set(tokens(s))) + (0.4 if re.search(r"\d", s) else 0)
        if sc > best_s:
            best, best_s = s, sc
    return best


def _main_stance(p: Persona, issue_id: str) -> Stance | None:
    st = p.confirmed(issue_id)
    return sorted(st, key=lambda s: (s.priority, -s.ts))[0] if st else None


def history_text(room: Room, n: int = config.SHORT_TERM_N) -> str:
    out = []
    for m in room.messages[-n:]:
        if m.kind not in ("human", "mini"):
            continue
        p = room.personas.get(m.user_id)
        who = p.name if p else "?"
        out.append(f"{who} 미니미(AI): {strip_cites(m.text)}" if m.kind == "mini" else f"{who}: {m.text}")
    return "\n".join(out) or "(아직 대화 없음)"


def strip_cites(text: str) -> str:
    return re.sub(r"\s*\[[^\]]{1,24}\]", "", text)


async def compose(room: Room, uid: str, trigger: Message, act: str, issue_id: str, hits: list[Hit]) -> dict:
    """근거 발언 생성 → 출처 검사. 반환: {text, sentences, citations, engine, dropped}"""
    p = room.personas[uid]
    issue = room.issue(issue_id)
    stance = _main_stance(p, issue_id) if issue_id else None
    labels = stance_labels(p)
    pool: dict[str, Chunk] = {}
    if stance:
        c = next((h.chunk for h in hits if h.chunk.ref == stance.id), None)
        pool[labels[stance.id]] = c or Chunk(f"{uid}:{stance.id}", uid, "stance", labels[stance.id],
                                             stance_text(stance), stance.issue_id, stance.id)
    for h in hits:
        if h.strength >= config.EVIDENCE_MIN * 0.6 and len(pool) < 5:
            pool.setdefault(h.chunk.label, h.chunk)
    if stance:
        # 입장을 말할 때는 그 입장을 뒷받침하는 보고서 문단도 찾아 둔다 (방금 발언과 단어가 안 겹쳐도)
        idx = await get_index(room, uid)
        for h in await idx.search(f"{stance.claim} {stance.reasons}", k=3, kinds={"report", "profile"}):
            if h.strength >= config.EVIDENCE_MIN * 0.6 and len(pool) < 6:
                pool.setdefault(h.chunk.label, h.chunk)
                if h not in hits:
                    hits = hits + [h]

    sents: list[dict] = []
    engine = llm.RULE
    dropped = 0
    checks: list[dict] = []
    if pool:
        sys_p, user_p, _ = llm.prompt(
            "speak", name=p.name, scope=_scope_text(p), criteria=_criteria_text(p),
            tone="\n".join(f"- {t}" for t in p.profile.tone_examples) or "- (예시 없음: 담백한 존댓말)",
            agenda=room.agenda or "미정", issue=issue.title if issue else "미정", history=history_text(room, 12),
            trigger=f"{_speaker(room, trigger)}: {trigger.text}", act=act,
            evidence="\n".join(f"- {lab}: {c.text}" for lab, c in pool.items()))
        data, engine = await llm.call_json("speak", "slow", sys_p, user_p, _SPEAK_SCHEMA, temperature=0.4,
                                           max_tokens=420)
        if data is not None:
            sents, dropped, checks = await check_citations(data.get("sentences", []), pool)
        if not sents:
            engine = llm.RULE
    if not sents:
        sents = _rule_sentences(p, act, trigger.text, stance, labels, hits, pool)
    if not sents:
        return {"text": "", "sentences": [], "citations": [], "engine": engine, "dropped": dropped,
                "verify": _verify_meta(checks)}
    opener = _OPENER.get(act, "")
    prev = room.messages[-1] if room.messages else None
    if (prev and prev.kind == "mini" and prev.user_id != uid and (prev.meta or {}).get("reply_to") == trigger.id
            and prev.user_id in room.personas and act in ("rebuttal", "agree_add")):
        opener = f"{room.personas[prev.user_id].name} 님 미니미 말에 덧붙이면,"   # 같은 발언에 이어 말하면 앞 미니미를 받는다
    text = (opener + " " if opener else "") + " ".join(_with_tag(s) for s in sents)
    used = []
    for s in sents:
        for lab in s["cites"]:
            if lab in pool and lab not in [u["label"] for u in used]:
                c = pool[lab]
                used.append({"label": lab, "kind": c.kind, "text": c.text, "chunk_id": c.id})
    return {"text": text.strip(), "sentences": sents, "citations": used, "engine": engine, "dropped": dropped,
            "verify": _verify_meta(checks)}


async def check_citations(raw: list[dict], pool: dict[str, Chunk]) -> tuple[list[dict], int, list[dict]]:
    """생성 후 검사: 출처가 없거나, 코드 가드에 걸리거나, 인용 문단이 사실 부분(core)을 함의하지 않으면 지운다.

    text = 회의에서 보여 줄 말투 있는 문장, core = 그 문장에서 자료로 확인되는 사실만.
    말투("걱정되네요") 때문에 검증이 실패하지 않게 core만 NLI로 검사하고, text가 core를 넘지 못하게 가드로 막는다.
    """
    kept, dropped, checks = [], 0, []
    for s in raw:
        text = strip_cites(str(s.get("text", ""))).strip()
        core = strip_cites(str(s.get("core") or "")).strip() or text
        cites = [c.strip("[] ") for c in s.get("cites", []) if c.strip("[] ") in pool]
        if not text:
            continue
        if not cites:
            dropped += 1
            checks.append({"text": text, "ok": False, "method": "cite", "score": 0.0, "reason": "출처 없음"})
            continue
        r = await nli.check(text, core, [pool[c].text for c in cites])
        checks.append({"text": text, "core": core, **r})
        if not r["ok"]:
            dropped += 1
            continue
        kept.append({"text": text, "core": core, "cites": cites, "support": r["score"], "verifier": r["method"]})
    return kept, dropped, checks


def _verify_meta(checks: list[dict]) -> dict:
    """화면 'AI 활동 기록'·말풍선 툴팁용 요약: 어떤 검증기로 몇 문장이 통과·탈락했나."""
    methods = [c["method"] for c in checks if c["method"] in ("nli", "lexical", "off")]
    return {"method": methods[0] if methods else nli.method(),
            "passed": sum(1 for c in checks if c["ok"]), "dropped": sum(1 for c in checks if not c["ok"]),
            "checks": checks[:6]}


def _with_tag(s: dict) -> str:
    body = re.sub(r"[.!?]+$", "", s["text"].strip())
    return f"{body} " + " ".join(f"[{c}]" for c in s["cites"]) + "."


def _rule_sentences(p: Persona, act: str, trigger: str, stance: Stance | None, labels: dict,
                    hits: list[Hit], pool: dict[str, Chunk]) -> list[dict]:
    """추출식 규칙 발언: 확인된 입장 카드의 주장 + 보고서의 가장 관련 있는 근거 문장."""
    out: list[dict] = []
    evid = sorted([h for h in hits if h.chunk.kind in ("report", "profile") and h.chunk.label in pool],
                  key=lambda h: -h.strength)
    if act == "answer" or not stance:
        # 사실을 묻는 질문: 보고서 문장이 있으면 그것부터 (입장 카드는 두 번째 문장으로)
        facts = [h for h in hits if h.chunk.kind in ("report", "profile") and h.chunk.label in pool
                 and h.strength >= config.EVIDENCE_MIN * 0.8]
        top = max(facts, key=lambda h: h.strength) if facts else next((h for h in hits if h.chunk.label in pool), None)
        if top:
            if top.chunk.kind in ("stance", "interview") and top.chunk.ref:
                st = next((s for s in p.stances if s.id == top.chunk.ref), None)
                sent = st.claim if st else best_sentence(top.chunk.text, trigger)
            else:
                sent = ko.polite(best_sentence(top.chunk.text, trigger))
            out.append({"text": sent, "cites": [top.chunk.label], "support": 1.0})
            if stance and labels.get(stance.id) != top.chunk.label and text_similarity(stance.claim, sent) < 0.5:
                out.append({"text": stance.claim, "cites": [labels[stance.id]], "support": 1.0})
        return out[:2]
    lab = labels[stance.id]
    out.append({"text": stance.claim, "cites": [lab], "support": 1.0})
    for h in evid:
        sent = best_sentence(h.chunk.text, trigger + " " + stance.claim, avoid=stance.claim)
        if sent:
            out.append({"text": ko.polite(sent), "cites": [h.chunk.label], "support": 1.0})
            break
    if (act in ("agree_add", "rebuttal") and stance.red_line and len(out) < 3
            and len(set(tokens(stance.red_line)) - set(tokens(stance.claim))) >= 2):
        out.append({"text": f"다만 {stance.red_line.rstrip('.')}", "cites": [lab], "support": 1.0})
    return out


def _speaker(room: Room, m: Message) -> str:
    p = room.personas.get(m.user_id)
    return p.name if p else "?"


def _scope_text(p: Persona) -> str:
    lvl = "의견 제시만" if p.scope.level == "opinion" else "질문 답변까지"
    nc = ", ".join(p.scope.no_commit) or "없음"
    return f"{lvl}. 약속하면 안 되는 것: {nc}." + (f" {p.scope.note}" if p.scope.note else "")


def _criteria_text(p: Persona) -> str:
    return "\n".join(f"{n}. {c}" for n, c in enumerate(p.profile.criteria, 1)) or "(없음)"


# ---------------------------------------------------------------- 침묵 (기권)
def abstain_text(p: Persona, reason: str) -> str:
    if reason == "commit":
        return (f"이건 약속이 필요한 일이라 제가 대신 정할 수 없어요. {p.name} 님이 돌아오면 직접 확인하도록 "
                f"질문으로 남겨 둘게요.")
    return (f"이 부분은 {p.name} 님의 보고서와 입장 카드에 근거가 없어서 제가 대신 답하기 어려워요. "
            f"{p.name} 님께 확인이 필요해요. 돌아오면 볼 수 있게 질문으로 남겨 둘게요.")


def save_question(p: Persona, trigger: Message, reason: str, issue_id: str) -> ReturnQuestion:
    q = ReturnQuestion(new_id("q"), trigger.text, trigger.user_id, issue_id,
                       "약속 필요" if reason == "commit" else "근거 없음")
    p.questions.append(q)
    p.touch()
    return q


# ---------------------------------------------------------------- 기억 (M6)
def infer_memory(room: Room) -> dict[str, list[Stance]]:
    """회의에서 본인이 한 말 중 입장 변화 후보를 '추정'으로 저장. 본인이 확인하면 '확인됨'."""
    started = room.meeting.get("started_at") or 0
    out: dict[str, list[Stance]] = {}
    for uid, p in room.personas.items():
        if not p.consent.get("store_utterances", True):
            continue
        for issue in room.issues:
            msgs = [m for m in room.messages if m.kind == "human" and m.user_id == uid and m.ts >= started
                    and not m.meta.get("after_end")
                    and (m.issue_id == issue.id or detect_issue(room, m.text)[0] == issue.id)]
            if not msgs:
                continue
            last_pos, last_msg = "", None
            for m in msgs:
                pos = stance_position(issue, m.text)
                if pos or not issue.options:
                    last_pos, last_msg = pos, m
            if not last_msg:
                continue
            main = _main_stance(p, issue.id)
            if main and (not issue.options or main.position == last_pos):
                continue
            p.stances = [s for s in p.stances if not (s.status == "inferred" and s.issue_id == issue.id)]
            st = Stance(new_id("s"), issue.id, ko.polite(ko.sentences(last_msg.text)[0]), last_pos, "", "", "", "",
                        2, [f"회의 발언 {time.strftime('%H:%M', time.localtime(last_msg.ts))}"], "inferred", "memory")
            p.stances.append(st)
            out.setdefault(uid, []).append(st)
    return out
