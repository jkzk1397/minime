"""MyMini 평가: 지표 6개 + 비교 실험을 한 번에.

    python eval/eval.py                # 지금 설정(.env)의 엔진으로
    LLM_ORDER=rule python eval/eval.py # 규칙만 (기준선 A)
    python eval/eval.py --sweep        # 침묵 임계값(EVIDENCE_MIN) 스윕 포함

결과: eval/results/latest.md, latest.json
데이터: eval/data/questions.jsonl(보고서 안·밖 질문), gate_labels.jsonl(개입 라벨), claims.jsonl(심은 주장)
※ 시드 평가 세트다. 기획서 목표 규모(질문 60·라벨 150·주장 80)는 팀이 사람 라벨로 늘려야 한다.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="mymini-eval-"))
os.environ.setdefault("COOLDOWN_SEC", "0")

from app import agenda, config, gate, interview, ko, llm, persona, seed, verify  # noqa: E402
from app.models import Message, Room  # noqa: E402
from app.retrieval import lexical_support  # noqa: E402

DATA = Path(__file__).parent / "data"


def load(name: str) -> list[dict]:
    return [json.loads(x) for x in (DATA / name).read_text(encoding="utf-8").splitlines() if x.strip()]


def pct(x: float) -> str:
    return f"{100 * x:.1f}%"


def p(xs: list[float], q: float) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    return s[min(len(s) - 1, int(q * (len(s) - 1) + 0.5))]


async def prepared_room() -> Room:
    """시연 1장면까지 끝난 상태: 민수가 보고서를 올리고 인터뷰로 준비도를 채움."""
    room = seed.fresh_room("eval")
    m = room.personas["minsu"]
    rep = persona.add_report(room, m, seed.MINSU_REPORT[0], "\n\n".join(seed.MINSU_REPORT[1]))
    sts, _ = await persona.extract_stances(room, m, rep)
    m.stances += sts
    for q in interview.plan(room, m):
        _, st, _ = await interview.answer(room, m, q.id, seed.MINSU_INTERVIEW_ANSWERS[q.issue_id])
        if st:
            interview.confirm(m, st.id, True)
    for pp in room.personas.values():
        pp.touch()
    return room


def clone(room: Room) -> Room:
    r = Room.from_dict(json.loads(json.dumps(room.to_dict())))
    r.room_id = room.room_id
    return r


def asker_for(uid: str) -> str:
    return "jihyun" if uid != "jihyun" else "jongwon"


async def ask(room: Room, target: str, text: str, called: bool = True) -> tuple[dict, Message, float]:
    """target 미니미만 대리 참석 ON인 상태에서 질문 하나를 게이트에 넣는다."""
    for uid, pp in room.personas.items():
        pp.mini_on = uid == target
        pp.last_spoke = 0
    name = room.personas[target].name
    msg_text = f"{name} 미니미, {text}" if called else text
    issue_id, _ = agenda.detect_issue(room, msg_text)
    issue_id = issue_id or room.current_issue
    msg = Message("human", msg_text, asker_for(target), issue_id=issue_id)
    room.messages.append(msg)
    t0 = time.perf_counter()
    d = await gate.evaluate(room, msg, issue_id, agenda.stance_position(room.issue(issue_id), msg_text), [])
    ms = (time.perf_counter() - t0) * 1000
    room.messages.remove(msg)
    return d, msg, ms


# ---------------------------------------------------------------- 1. 검색 Recall@5
async def eval_retrieval(room: Room, qs: list[dict]) -> dict:
    names = [pp.name for pp in room.personas.values()]
    out = {}
    for method in ("bm25", "vector", "hybrid"):
        hit5 = hit1 = n = 0
        for q in qs:
            if not q["answerable"]:
                continue
            idx = await persona.get_index(room, q["uid"])
            res = await idx.search(ko.strip_address(q["q"], names), k=5, method=method, kinds=persona.SPEECH_KINDS)
            n += 1
            hit5 += any(h.chunk.label in q["gold"] for h in res)
            hit1 += bool(res) and res[0].chunk.label in q["gold"]
        out[method] = {"r5": hit5 / max(1, n), "r1": hit1 / max(1, n)}
    return out


# ---------------------------------------------------------------- 2·3. 올바른 침묵 + 근거 일치율
async def eval_silence(room: Room, qs: list[dict], thresholds: list[float]) -> dict:
    rows = []
    base = config.EVIDENCE_MIN
    for th in thresholds:
        config.EVIDENCE_MIN = th
        tp = fp = n_out = n_in = 0
        for q in qs:
            d, _, _ = await ask(room, q["uid"], q["q"])
            act = next((a for a in d["actions"] if a["uid"] == q["uid"]), None)
            abstain = act is None or act["type"] == "abstain"
            if q["answerable"]:
                n_in += 1
                fp += abstain
            else:
                n_out += 1
                tp += abstain
        rows.append({"threshold": th, "correct_silence": tp / max(1, n_out), "false_abstain": fp / max(1, n_in),
                     "balanced": (tp / max(1, n_out) + 1 - fp / max(1, n_in)) / 2})
    config.EVIDENCE_MIN = base
    return {"rows": rows, "best": max(rows, key=lambda r: r["balanced"])}


async def eval_grounding(room: Room, qs: list[dict]) -> dict:
    total = supported = speak = 0
    gold_hit = 0
    lat = []
    for q in qs:
        if not q["answerable"]:
            continue
        d, msg, _ = await ask(room, q["uid"], q["q"])
        act = next((a for a in d["actions"] if a["uid"] == q["uid"] and a["type"] == "speak"), None)
        if not act:
            continue
        speak += 1
        room.messages.append(msg)
        t0 = time.perf_counter()
        out = await persona.compose(room, q["uid"], msg, act["act"], msg.issue_id, d["_hits"][q["uid"]])
        lat.append((time.perf_counter() - t0) * 1000)
        room.messages.remove(msg)
        cites = {c["label"]: c["text"] for c in out["citations"]}
        for s in out["sentences"]:
            total += 1
            ok = s["cites"] and all(c in cites for c in s["cites"]) and \
                max(lexical_support(s["text"], cites[c]) for c in s["cites"]) >= config.SUPPORT_MIN
            supported += bool(ok)
        gold_hit += any(c in q["gold"] for c in cites)
    return {"citation_support": supported / max(1, total), "sentences": total, "answered": speak,
            "gold_cited": gold_hit / max(1, speak), "compose_ms": lat}


# ---------------------------------------------------------------- 4. 개입 F1
async def eval_gate(room: Room, labels: list[dict], mode: str) -> dict:
    old = config.GATE_MODE
    config.GATE_MODE = mode
    tp = fp = fn = tn = who_ok = 0
    lat = []
    for item in labels:
        r = clone(room)
        for uid, pp in r.personas.items():
            pp.mini_on = uid in ("minsu", "haeun")
            pp.last_spoke = 0
        uid, text = item["msg"]
        issue_id, _ = agenda.detect_issue(r, text)
        dist = agenda.distance(r, text)
        if not issue_id and (dist is None or dist < config.DRIFT_THRESHOLD):
            issue_id = r.current_issue
        msg = Message("human", text, uid, issue_id=issue_id)
        r.messages.append(msg)
        t0 = time.perf_counter()
        d = await gate.evaluate(r, msg, issue_id, agenda.stance_position(r.issue(issue_id), text), [])
        lat.append((time.perf_counter() - t0) * 1000)
        pred = bool(d["actions"])
        if pred and item["speak"]:
            tp += 1
            who_ok += any(a["uid"] in item.get("who", []) for a in d["actions"])
        elif pred:
            fp += 1
        elif item["speak"]:
            fn += 1
        else:
            tn += 1
    config.GATE_MODE = old
    prec = tp / max(1, tp + fp)
    rec = tp / max(1, tp + fn)
    return {"mode": mode, "precision": prec, "recall": rec, "f1": 2 * prec * rec / max(1e-9, prec + rec),
            "accuracy": (tp + tn) / max(1, len(labels)), "who_acc": who_ok / max(1, tp), "gate_ms": lat,
            "counts": {"tp": tp, "fp": fp, "fn": fn, "tn": tn}}


# ---------------------------------------------------------------- 5. 검증 탐지율
async def eval_verify(room: Room, claims: list[dict]) -> dict:
    det = n_planted = fpos = n_normal = conflict_ok = n_conflict = 0
    lat = []
    detail = []
    for c in claims:
        r = clone(room)
        issue_id, _ = agenda.detect_issue(r, c["text"])
        msg = Message("human", c["text"], c["uid"], issue_id=issue_id)
        r.messages.append(msg)
        t0 = time.perf_counter()
        card = await verify.run(r, c["uid"], msg)
        lat.append((time.perf_counter() - t0) * 1000)
        verdicts = [x["verdict"] for x in card["claims"]]
        flagged = any(v in ("none", "weak", "conflict") for v in verdicts)
        if c["planted"]:
            n_planted += 1
            det += flagged
            if c["planted"] == "conflict":
                n_conflict += 1
                conflict_ok += "conflict" in verdicts
        else:
            n_normal += 1
            fpos += flagged
        detail.append({"text": c["text"], "planted": c["planted"], "verdicts": verdicts, "flagged": flagged})
    return {"detection": det / max(1, n_planted), "false_positive": fpos / max(1, n_normal),
            "conflict_type_acc": conflict_ok / max(1, n_conflict), "verify_ms": lat, "detail": detail}


# ---------------------------------------------------------------- 6. 페르소나 충실도 (입장 일치, 대리 지표)
async def eval_fidelity(room: Room) -> dict:
    """확인된 입장 카드를 정답으로 두고, 쟁점 의견을 물었을 때 미니미 발언의 선택지가 같은지.
    (Park 2024처럼 본인 재응답을 받으면 그걸 정답으로 바꾸면 된다)"""
    ok = n = 0
    for uid, pp in room.personas.items():
        for issue in room.issues:
            if not issue.options:
                continue
            st = persona._main_stance(pp, issue.id)
            if not st or not st.position:
                continue
            d, msg, _ = await ask(room, uid, f"{issue.title}에 대해 어떻게 생각해?")
            act = next((a for a in d["actions"] if a["uid"] == uid and a["type"] == "speak"), None)
            n += 1
            if not act:
                continue
            room.messages.append(msg)
            out = await persona.compose(room, uid, msg, act["act"], issue.id, d["_hits"][uid])
            room.messages.remove(msg)
            ok += agenda.detect_position(issue, persona.strip_cites(out["text"])) == st.position
    return {"stance_match": ok / max(1, n), "n": n}


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sweep", action="store_true", help="침묵 임계값 스윕")
    ap.add_argument("--out", default=str(Path(__file__).parent / "results"))
    args = ap.parse_args()
    await llm.probe()
    engine = {"fast": llm.active_label("fast"), "slow": llm.active_label("slow"),
              "embed": config.EMBED_MODEL if llm.embed_available() else "n-gram(내장)"}
    print(f"엔진: {engine}")
    room = await prepared_room()
    qs, labels, claims = load("questions.jsonl"), load("gate_labels.jsonl"), load("claims.jsonl")

    t_start = time.time()
    retrieval = await eval_retrieval(room, qs)
    ths = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45] if args.sweep else [config.EVIDENCE_MIN]
    silence = await eval_silence(room, qs, ths)
    cur = next(r for r in silence["rows"] if abs(r["threshold"] - config.EVIDENCE_MIN) < 1e-9) \
        if any(abs(r["threshold"] - config.EVIDENCE_MIN) < 1e-9 for r in silence["rows"]) else silence["rows"][0]
    grounding = await eval_grounding(room, qs)
    gates = [await eval_gate(room, labels, "rule")]
    if not llm.force_rule() and llm.active_label("fast") != llm.RULE:
        gates.append(await eval_gate(room, labels, "hybrid"))
        gates.append(await eval_gate(room, labels, "llm"))
    ver = await eval_verify(room, claims)
    fid = await eval_fidelity(room)

    gate_ms = gates[0]["gate_ms"]
    res = {
        "engine": engine, "evidence_min": config.EVIDENCE_MIN, "sizes": {"questions": len(qs), "gate": len(labels), "claims": len(claims)},
        "retrieval_recall5": retrieval, "silence": silence, "silence_current": cur, "grounding": {k: v for k, v in grounding.items() if k != "compose_ms"},
        "gate": [{k: v for k, v in g.items() if k != "gate_ms"} for g in gates],
        "verify": {k: v for k, v in ver.items() if k != "verify_ms"}, "fidelity": fid,
        "latency_ms": {"gate_p50": p(gate_ms, .5), "gate_p95": p(gate_ms, .95),
                       "compose_p50": p(grounding["compose_ms"], .5), "compose_p95": p(grounding["compose_ms"], .95),
                       "verify_p50": p(ver["verify_ms"], .5), "verify_p95": p(ver["verify_ms"], .95)},
        "elapsed_s": round(time.time() - t_start, 1),
    }
    md = [f"# MyMini 평가 결과", "", f"- 엔진: 빠른 레인 `{engine['fast']}` · 생각 레인 `{engine['slow']}` · 임베딩 `{engine['embed']}`",
          f"- 데이터: 질문 {len(qs)}(보고서 안 {sum(q['answerable'] for q in qs)} / 밖 {sum(not q['answerable'] for q in qs)}) · 개입 라벨 {len(labels)} · 심은 주장 {len(claims)}",
          f"- 침묵 임계값 EVIDENCE_MIN = {config.EVIDENCE_MIN}", "",
          "| 지표 | 값 | 목표(기획서) |", "| --- | --- | --- |",
          f"| 근거 일치율 (문장별 출처 검사) | {pct(grounding['citation_support'])} ({grounding['sentences']}문장) | 90% 이상 |",
          f"| 정답 문단 인용률 | {pct(grounding['gold_cited'])} | - |",
          f"| 올바른 침묵률 / 잘못된 침묵 | {pct(cur['correct_silence'])} / {pct(cur['false_abstain'])} | 90% 이상 / 10% 이하 |",
          f"| 개입 F1 (규칙, 후보 A) | {gates[0]['f1']:.2f} (P {gates[0]['precision']:.2f} · R {gates[0]['recall']:.2f} · 누가 {pct(gates[0]['who_acc'])}) | 사람 간 일치율 근접 |",
          f"| 검증 탐지율 / 오탐 | {pct(ver['detection'])} / {pct(ver['false_positive'])} (충돌 유형 {pct(ver['conflict_type_acc'])}) | 80% 이상 / 15% 이하 |",
          f"| 페르소나 충실도 (입장 일치, 대리 지표) | {pct(fid['stance_match'])} ({fid['n']}문항) | 80% 이상 |",
          f"| 지연 p50/p95 (게이트) | {res['latency_ms']['gate_p50']:.0f} / {res['latency_ms']['gate_p95']:.0f} ms | p95 1초 안 |",
          f"| 지연 p50/p95 (발언 작성) | {res['latency_ms']['compose_p50']:.0f} / {res['latency_ms']['compose_p95']:.0f} ms | 첫 글자 2초 안 |",
          f"| 지연 p50/p95 (2차 검증) | {res['latency_ms']['verify_p50']:.0f} / {res['latency_ms']['verify_p95']:.0f} ms | - |",
          "", "## 검색 비교 (보고서 안 질문)", "", "| 방법 | Recall@1 | Recall@5 |", "| --- | --- | --- |",
          *[f"| {nm} | {pct(retrieval[k]['r1'])} | {pct(retrieval[k]['r5'])} |" for k, nm in
            (("bm25", "BM25 (Kiwi 형태소)"), ("vector", f"벡터 ({engine['embed']})"), ("hybrid", "하이브리드 (RRF)"))],
          "", "_팀원 1명당 문단이 5~9개뿐이라 Recall@5는 쉽게 100%가 된다. 차이는 Recall@1에서 본다._", "",
          "## 개입 게이트 후보 비교", "", "| 후보 | F1 | 정밀도 | 재현율 | 정확도 | 누가 맞춤 | p95 |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for g in gates:
        nm = {"rule": "A. 규칙만", "hybrid": "C. 규칙 + 작은 모델(상황별 예시)", "llm": "D. 매번 모델"}[g["mode"]]
        md.append(f"| {nm} | {g['f1']:.2f} | {g['precision']:.2f} | {g['recall']:.2f} | {g['accuracy']:.2f} | {pct(g['who_acc'])} | {p(g['gate_ms'], .95):.0f} ms |")
    if len(gates) == 1:
        md.append("| C·D | 모델이 연결되지 않아 측정 안 함 | | | | | |")
    if args.sweep:
        md += ["", "## 침묵 임계값 스윕", "", "| EVIDENCE_MIN | 올바른 침묵 | 잘못된 침묵 | 균형 정확도 |", "| --- | --- | --- | --- |"]
        md += [f"| {r['threshold']} | {pct(r['correct_silence'])} | {pct(r['false_abstain'])} | {r['balanced']:.2f} |" for r in silence["rows"]]
        md.append(f"\n가장 균형이 좋은 임계값: **{silence['best']['threshold']}**")
    md += ["", "## 검증 상세", "", "| 주장 | 심은 유형 | 판정 | 잡았나 |", "| --- | --- | --- | --- |"]
    md += [f"| {x['text']} | {x['planted'] or '정상'} | {', '.join(x['verdicts'])} | {'O' if x['flagged'] == bool(x['planted']) else 'X'} |"
           for x in ver["detail"]]
    md += ["", f"_실행 {res['elapsed_s']}초. 시드 평가 세트라 규모가 작다 — 경향만 보고, 사람 라벨을 늘려 다시 잰다._"]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "latest.md").write_text("\n".join(md), encoding="utf-8")
    (out / "latest.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n".join(md))


if __name__ == "__main__":
    asyncio.run(main())
