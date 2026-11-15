"""11주차 과제: 정상·오류·확인 불가 세 상황 시험에서 나온 문제의 회귀 테스트 (규칙 모드).

시험용 방: 민수(불참, 미니미 대리 참석) · 지연 · 도윤. 민수의 제안서(시험용)는 p.2에 '1차 출시 3개 기능', '음성 브리핑 2차'가 있다.
- 정상: 불러서 물으면 입장 카드와 제안서로 답하고, 관련 결정은 민수 확인 전까지 보류
- 오류: '5개 기능'이라는 틀린 수치를 2차 검증이 제안서의 '3개 기능'과 대조해 충돌로 판정
- 확인 불가: 자료에 없는 일정 변경을 물으면 지금 쟁점의 입장으로 대신 답하지 않고 질문으로 남김, 결정은 보류
"""
import asyncio

from fastapi.testclient import TestClient

from app import orchestrator, persona
from app.main import app
from app.store import hub

PAGES = [
    "MINIME 1차 출시 계획 제안서 (시험용 자료). 팀 프로젝트 회의에 빠진 팀원의 의견을 근거와 함께 전달하는 서비스의 1차 출시 범위를 제안한다.",
    "1차 출시는 자료 업로드, 근거 기반 발언, 회의 요약 3개 기능으로 진행해야 한다고 생각한다. 기능을 더 늘리면 중간발표 전까지 검증할 시간이 부족하다.\n\n"
    "음성 브리핑은 2차 출시로 미루는 것이 좋다고 생각한다. 1차 출시에서는 글로 된 회의 요약만 제공한다.",
    "예산안에는 찬성한다. 다만 예산은 20만 원 이하일 때에만 찬성한다.",
]


def _room(rid: str) -> dict:
    with TestClient(app) as c:
        c.delete(f"/api/rooms/{rid}")
        c.post("/api/rooms", json={"room_id": rid, "agenda": "MINIME 1차 출시 계획 정하기", "issues": [
            {"title": "1차 출시 기능 범위", "options": ["3개 기능", "5개 기능"]},
            {"title": "음성 브리핑 출시 시기"}, {"title": "예산안"}]})
        ids = {n: c.post(f"/api/rooms/{rid}/members", json={"name": n}).json()["user_id"] for n in ("민수", "지연", "도윤")}
        base = f"/api/rooms/{rid}/members/{ids['민수']}"
        c.post(base + "/reports", json={"title": "제안서(시험용)", "text": "\n\n".join(PAGES), "source": "pdf", "pages": PAGES})
        for st in c.get(base).json()["stances"]:
            c.post(base + f"/stances/{st['id']}/confirm", json={"ok": True})
    return ids


def test_leading_number_is_not_stripped():
    assert persona.split_report("1차 출시는 3개 기능으로 한다고 생각한다.\n\n1. 목록 번호는 지운다고 본다")[:2] == [
        "1차 출시는 3개 기능으로 한다고 생각한다.", "목록 번호는 지운다고 본다"]


async def _flow():
    rid = "t-week11"
    ids = _room(rid)
    room = hub.room(rid)
    ms = ids["민수"]
    claim = next(s for s in room.personas[ms].stances if s.issue_id == "i1").claim
    assert claim.startswith("1차 출시는")                               # 수정 전: '차 출시는…'
    await orchestrator.set_away(rid, ms, True)

    # 정상: 근거 있는 발언 + 결정 보류
    _, t = await orchestrator.handle_human(rid, ids["지연"], "오늘은 1차 출시 기능 범위부터 정하자. 민수 미니미, 1차 출시는 어떻게 하자는 의견이야?")
    await t
    said = [m for m in room.messages if m.kind == "mini" and not m.meta.get("abstain")]
    assert said and "3개 기능" in said[-1].text and said[-1].meta["citations"]
    _, t = await orchestrator.handle_human(rid, ids["지연"], "그럼 1차 출시는 3개 기능으로 가자.")
    await t
    assert room.decisions[-1].status == "pending" and room.decisions[-1].affected == [ms]

    # 오류: 틀린 수치 → 자료와 대조해 충돌
    wrong, t = await orchestrator.handle_human(rid, ids["도윤"], "민수 제안서에는 1차 출시를 5개 기능으로 한다고 적혀 있었어.")
    await t
    card = (await orchestrator.request_verify(rid, ids["지연"], wrong.id)).meta
    c0 = card["claims"][0]
    assert c0["verdict"] == "conflict" and "3개 기능" in c0["note"] and "p.2" in c0["note"]
    assert "자료와 숫자가 다름" in card["labels"]

    # 확인 불가: 자료에 없는 일정 변경 → 대신 답하지 않고 질문으로, 결정은 보류
    n = len(said)
    _, t = await orchestrator.handle_human(rid, ids["도윤"], "민수 미니미, 중간발표를 금요일로 바꿔도 괜찮아?")
    await t
    last = [m for m in room.messages if m.kind == "mini"][-1]
    assert last.meta.get("abstain") == "no_evidence"                   # 수정 전: 1차 출시 입장으로 엉뚱하게 답함
    assert len([m for m in room.messages if m.kind == "mini" and not m.meta.get("abstain")]) == n
    assert any("금요일" in q.text and q.status == "open" for q in room.personas[ms].questions)
    k = len(room.decisions)
    _, t = await orchestrator.handle_human(rid, ids["지연"], "그럼 중간발표는 금요일로 바꾸자.")
    await t
    assert len(room.decisions) == k + 1 and room.decisions[-1].status == "pending"   # 수정 전: 결정으로 기록되지 않음


def test_three_situations():
    asyncio.run(_flow())


async def _seeded_flow():
    """주소 /?room=week11 로 들어가면 생기는 시험용 방에서도 같은 세 상황이 그대로 나온다."""
    rid = "week11"
    with TestClient(app) as c:
        c.delete(f"/api/rooms/{rid}")
        d = c.get(f"/api/rooms/{rid}").json()
        assert [m["name"] for m in d["members"]["members"]] == ["민수", "지연", "도윤"]
    room = hub.room(rid)
    assert room.personas["ms"].mini_on and len(room.personas["ms"].confirmed()) >= 2

    _, t = await orchestrator.handle_human(rid, "jy", "오늘은 1차 출시 기능 범위부터 정하자. 민수 미니미, 1차 출시는 어떻게 하자는 의견이야?")
    await t
    said = [m for m in room.messages if m.kind == "mini" and not m.meta.get("abstain")]
    assert said and "3개 기능" in said[-1].text and said[-1].meta["citations"]
    _, t = await orchestrator.handle_human(rid, "jy", "그럼 1차 출시는 3개 기능으로 가자.")
    await t
    assert room.decisions[-1].status == "pending" and room.decisions[-1].affected == ["ms"]

    wrong, t = await orchestrator.handle_human(rid, "dy", "민수 제안서에는 1차 출시를 5개 기능으로 한다고 적혀 있었어.")
    await t
    c0 = (await orchestrator.request_verify(rid, "jy", wrong.id)).meta["claims"][0]
    assert c0["verdict"] == "conflict" and "3개 기능" in c0["note"] and "p.2" in c0["note"]

    _, t = await orchestrator.handle_human(rid, "dy", "민수 미니미, 중간발표를 금요일로 바꿔도 괜찮아?")
    await t
    assert [m for m in room.messages if m.kind == "mini"][-1].meta.get("abstain") == "no_evidence"
    assert any("금요일" in q.text for q in room.personas["ms"].questions)
    _, t = await orchestrator.handle_human(rid, "jy", "그럼 중간발표는 금요일로 바꾸자.")
    await t
    assert room.decisions[-1].status == "pending"
    with TestClient(app) as c:
        c.delete(f"/api/rooms/{rid}")


def test_seeded_week11_room():
    asyncio.run(_seeded_flow())
