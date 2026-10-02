"""통합 리뷰에서 나온 버그 회귀 테스트 (규칙 모드).

호출 응답 유지 · 회의 종료 뒤 발언 · 쟁점 id · 빈 방 · 동시 입장 · 오류 알림 · 느린 처리 분리 ·
회의록 결정 상태 · 질문 중복 답변 · needs_check · 종료 가드 · 세대 번호 · 결정 갱신 방송 · 초기화
"""
import asyncio
import logging
import time

import pytest
from fastapi.testclient import TestClient

from app import gate, minutes, orchestrator, persona, seed, verify
from app.main import app
from app.models import Decision, Room, Stance
from app.store import add_persona, hub


def _fresh(room_id: str) -> Room:
    room = seed.fresh_room(room_id)
    hub.replace(room)
    return room


# ---------------------------------------------------------------- 호출 응답은 새 발언에 취소되지 않는다 (#1)
async def _called_survives():
    rid = "t-called"
    room = _fresh(rid)
    await orchestrator.set_away(rid, "dongjun", True)
    await orchestrator.set_away(rid, "hyejung", True)
    m1, t1 = await orchestrator.handle_human(rid, "jongwon", "동준 미니미, 타 대학 사례는 어떤 게 있어?")
    m2, t2 = await orchestrator.handle_human(rid, "jungmin", "혜중 미니미, 무대 음향 장비 대여 업체는 알아봤어?")
    m3, t3 = await orchestrator.handle_human(rid, "jongwon", "좋아 그건 나중에 다시 보자")
    await asyncio.gather(t1, t2, t3)
    r1 = [m for m in room.messages if m.kind == "mini" and m.meta.get("reply_to") == m1.id]
    r2 = [m for m in room.messages if m.kind == "mini" and m.meta.get("reply_to") == m2.id]
    assert r1 and r1[0].user_id == "dongjun" and r1[0].meta.get("called") and not r1[0].meta.get("abstain")
    assert r2 and r2[0].meta.get("abstain") == "no_evidence"
    assert [q.text for q in room.personas["hyejung"].questions] == [m2.text]       # 복귀 후 질문도 남는다


def test_called_mini_reply_survives_newer_message():
    asyncio.run(_called_survives())


# ---------------------------------------------------------------- 세대 번호는 await 전에 (#13)
async def _gen_order():
    rid = "t-gen"
    room = _fresh(rid)
    (ma, ta), (mb, tb) = await asyncio.gather(
        orchestrator.handle_human(rid, "jongwon", "예산은 공연 중심이 현실적이라고 봐"),
        orchestrator.handle_human(rid, "jungmin", "참여 프로그램 쪽 자료도 같이 보자"))
    await asyncio.wait({ta, tb})
    assert [m.id for m in room.messages if m.kind == "human"] == [ma.id, mb.id]   # 도착 순서대로
    assert hub.tasks[rid] is tb and not tb.cancelled()
    assert [g["msg_id"] for g in room.gate_log] == [mb.id]                          # 예전 발언은 게이트를 건너뛴다


def test_generation_taken_before_awaits():
    asyncio.run(_gen_order())


# ---------------------------------------------------------------- 회의 종료 뒤 발언·종료 가드 (#2, #12)
async def _after_end():
    rid = "t-end"
    room = _fresh(rid)
    _, t = await orchestrator.handle_human(rid, "jongwon", "예산은 A안이 현실적이라고 봐")
    await t
    r1, r2 = await asyncio.gather(orchestrator.end_meeting(rid), orchestrator.end_meeting(rid))
    assert (r1 is None) != (r2 is None)                                             # 두 번 눌러도 한 번만
    assert sum(1 for m in room.messages if m.kind == "result") == 1
    kept = room.minutes
    assert kept and room.meeting["status"] == "ended"
    msg, t = await orchestrator.handle_human(rid, "jungmin", "다들 수고했어")
    await t
    assert msg.meta.get("after_end") and msg in room.messages
    assert room.meeting["status"] == "ended" and room.minutes is kept               # 회의록이 지워지지 않는다
    assert await orchestrator.end_meeting(rid) is None
    assert sum(1 for m in room.messages if m.kind == "result") == 1


def test_message_after_end_keeps_minutes_and_end_is_guarded():
    asyncio.run(_after_end())


# ---------------------------------------------------------------- 쟁점 id 중복 (#3, #15 선택지 지우기)
async def _agenda_ids():
    rid = "t-agenda"
    room = Room(room_id=rid)
    hub.replace(room)
    await orchestrator.set_agenda(rid, "안건", [{"title": "A"}])
    assert [(i.id, i.title) for i in room.issues] == [("i1", "A")]
    # 새 줄을 앞에 끼워 넣음: 새 줄은 id 없이, A는 제 id로 → C가 i1을 물려받으면 안 된다
    await orchestrator.set_agenda(rid, "안건", [{"title": "C"}, {"id": "i1", "title": "A"}])
    ids = [i.id for i in room.issues]
    assert len(set(ids)) == 2 and dict((i.title, i.id) for i in room.issues)["A"] == "i1"
    c_id = dict((i.title, i.id) for i in room.issues)["C"]
    assert c_id != "i1"
    # 예전 클라이언트처럼 자리 순서로 id를 붙여 보내도 겹치지 않는다
    await orchestrator.set_agenda(rid, "안건", [{"id": "i1", "title": "A", "options": ["가", "나"]},
                                              {"id": "i2", "title": "NEW"}, {"id": "i2", "title": "C"}])
    by = {i.title: i for i in room.issues}
    assert len({i.id for i in room.issues}) == 3
    assert by["A"].id == "i1" and by["C"].id == c_id and by["NEW"].id not in ("i1", c_id)
    assert [o["label"] for o in by["A"].options] == ["가", "나"]
    # 제목을 바꿔 쓴 줄은 예전 쟁점(입장 카드가 붙은 id)을 물려받지 않는다
    add_persona(room, "u1", "가람")
    room.personas["u1"].stances.append(Stance("s1", by["NEW"].id, "새 쟁점 입장", status="confirmed"))
    old_new = by["NEW"].id
    await orchestrator.set_agenda(rid, "안건", [{"id": "i1", "title": "A", "options": []}, {"id": old_new, "title": "D"}])
    by = {i.title: i for i in room.issues}
    assert by["D"].id not in ("i1", c_id, old_new)                                 # 지운 쟁점 id도 다시 쓰지 않는다
    assert by["A"].options == []                                                     # 선택지를 비울 수 있다


def test_agenda_edit_gives_unique_ids():
    asyncio.run(_agenda_ids())


# ---------------------------------------------------------------- 빈 방: 이탈 경고 없음, 게이트는 돈다 (#5)
async def _empty_room():
    rid = "t-empty"
    room = Room(room_id=rid)
    hub.replace(room)
    for uid, name in (("u1", "가람"), ("u2", "나래"), ("u3", "다온")):
        add_persona(room, uid, name)
    await orchestrator.set_away(rid, "u3", True)
    for uid, text in (("u1", "근데 어제 축구 봤어? 손흥민 골 미쳤던데"), ("u2", "ㅋㅋ 봤지. 오늘 점심 학식 뭐 나와?"),
                      ("u1", "다온 미니미, 주말 일정은 어때?")):
        _, t = await orchestrator.handle_human(rid, uid, text)
        await t
    assert not any(m.kind == "facilitator" for m in room.messages)
    assert len(room.gate_log) == 3
    assert any(m.kind == "mini" and m.user_id == "u3" for m in room.messages)       # 부르면 (기권이라도) 답한다


def test_empty_room_no_drift_and_gate_runs():
    asyncio.run(_empty_room())


# ---------------------------------------------------------------- 동시 입장 (#6)
async def _join_during_payload(monkeypatch):
    rid = "t-join"
    room = _fresh(rid)
    orig = persona.readiness
    added = []

    async def slow_readiness(r, uid):
        if not added:
            added.append(add_persona(room, "late1", "늦은이"))
        await asyncio.sleep(0)
        return await orig(r, uid)

    monkeypatch.setattr(persona, "readiness", slow_readiness)
    out = await orchestrator.members_payload(rid)
    assert out["type"] == "members" and added


def test_members_payload_survives_join(monkeypatch):
    asyncio.run(_join_during_payload(monkeypatch))


# ---------------------------------------------------------------- 오류는 로그 + 알림 (#7)
async def _pipeline_error(monkeypatch):
    rid = "t-err"
    room = _fresh(rid)
    await orchestrator.set_away(rid, "dongjun", True)

    async def boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr(gate, "evaluate", boom)
    _, t = await orchestrator.handle_human(rid, "jongwon", "동준 미니미, 타 대학 사례는 어떤 게 있어?")
    await t
    notes = [m for m in room.messages if m.kind == "system" and m.meta.get("event") == "mini_error"]
    assert notes and "동준" in notes[0].text


def test_pipeline_error_is_logged_and_noticed(monkeypatch, caplog):
    with caplog.at_level(logging.ERROR, logger="minime"):
        asyncio.run(_pipeline_error(monkeypatch))
    assert any("pipeline failed" in r.getMessage() for r in caplog.records)


# ---------------------------------------------------------------- 질문은 한 번만 답한다 (#10)
async def _answer_twice():
    rid = "t-answer"
    room = _fresh(rid)
    await orchestrator.set_away(rid, "hyejung", True)
    _, t = await orchestrator.handle_human(rid, "jungmin", "혜중 미니미, 무대 음향 장비 대여 업체는 알아봤어?")
    await t
    p = room.personas["hyejung"]
    q = p.questions[0]
    await orchestrator.set_away(rid, "hyejung", False)
    assert [x["id"] for x in orchestrator.fresh_digest(room, "hyejung")["questions"]] == [q.id]
    await orchestrator.answer_question(rid, "hyejung", q.id, "아직 안 알아봤어")
    n_st, n_msg = len(p.stances), len(room.messages)
    with pytest.raises(ValueError):
        await orchestrator.answer_question(rid, "hyejung", q.id, "다시 답할게")
    assert len(p.stances) == n_st and len(room.messages) == n_msg
    assert orchestrator.fresh_digest(room, "hyejung")["questions"] == []              # 다시 열어도 답한 질문은 없다
    with pytest.raises(KeyError):
        await orchestrator.answer_question(rid, "hyejung", "nope", "답")


def test_question_cannot_be_answered_twice():
    asyncio.run(_answer_twice())


# ---------------------------------------------------------------- 결정 응답 권한 (#11, #14)
def test_decision_respond_permissions():
    room = seed.fresh_room("t-resp")
    d = Decision("d1", "B안으로", "i1", "jungmin", "pending", ["hyejung"])
    room.decisions.append(d)
    with pytest.raises(ValueError):
        minutes.respond(room, "d1", "jongwon", "object")                            # 확인 대상이 아님
    assert d.status == "pending" and not d.responses
    minutes.respond(room, "d1", "hyejung", "approve")
    assert d.status == "confirmed"
    nc = Decision("d2", "회의는 매주 하기로", "", "jungmin", "needs_check", [])
    room.decisions.append(nc)
    minutes.respond(room, "d2", "jongwon", "approve")                               # '확인 필요'는 팀원 누구나
    assert nc.status == "confirmed"


def test_decision_naming_absent_member_needs_their_ok():
    """준비가 안 된 불참자라도 결정 문장에서 이름이 불리면(역할을 맡기는 등) 확인 대상이 된다."""
    async def go():
        rid = "t-named"
        room = _fresh(rid)                                         # 혜중은 보고서·입장 카드가 없는 상태
        await orchestrator.set_away(rid, "hyejung", True)
        await orchestrator.set_away(rid, "dongjun", True)
        m, t = await orchestrator.handle_human(rid, "jongwon", "좋아. 발표 역할은 내가 사회랑 도입, 정민이가 본론, 혜중이가 질의응답 근거 정리하는 걸로 하자.")
        await t
        d = next(x for x in room.decisions if x.source_msg == m.id)
        assert "hyejung" in d.affected and d.status == "pending"
    asyncio.run(go())


def test_example_only_in_scenario_rooms():
    room = seed.fresh_room("t-ex")
    ex = seed.example_for(room, "hyejung")
    assert ex and ex["report_text"] and ex["answers"]["i1"]
    assert seed.example_for(room, "jongwon") is None
    room.issues = room.issues[:1]                                  # 쟁점을 바꾼 방(실제 방)에는 예시가 없다
    assert seed.example_for(room, "hyejung") is None


def test_minutes_refresh_reads_live_decisions():
    room = seed.fresh_room("t-refresh")
    d = Decision("d1", "B안으로", "i1", "jungmin", "pending", ["hyejung"])
    room.decisions.append(d)
    data = {"issues": [{"issue_id": "i1", "status": "pending", "decision": minutes.decision_dict(room, d)}],
            "loose_decisions": []}
    assert not minutes.refresh_decisions(room, data)
    minutes.respond(room, "d1", "hyejung", "object")
    assert minutes.refresh_decisions(room, data)
    assert data["issues"][0]["status"] == "objected" and data["issues"][0]["decision"]["status"] == "objected"


# ---------------------------------------------------------------- WebSocket 흐름 (#4, #9, #12, #14, #15)
def drain(ws, until, n=300):
    out = []
    for _ in range(n):
        d = ws.receive_json()
        out.append(d)
        if until(d):
            return out
    raise AssertionError(f"기다린 이벤트가 오지 않음: {[x.get('type') for x in out]}")


def test_ws_decisions_minutes_and_guards():
    with TestClient(app) as c:
        r = c.post("/api/rooms", json={"room_id": "t-fixws", "title": "테스트", "agenda": "",
                                      "issues": [{"title": "예산안 정하기", "options": ["A안", "B안"]},
                                                 {"title": "발표 역할"}]})
        assert r.status_code == 200
        issues = r.json()["issues"]
        assert [i["title"] for i in issues] == ["예산안 정하기", "발표 역할"]           # 안건 제목 없이도 쟁점 유지 (#4)
        assert len({i["id"] for i in issues}) == 2
        i1 = issues[0]["id"]
        a, b, cc = [c.post("/api/rooms/t-fixws/members", json={"name": n}).json()["user_id"] for n in ("가람", "나래", "다온")]
        assert c.post(f"/api/rooms/t-fixws/members/{b}/stances",
                      json={"issue_id": i1, "claim": "B안이 좋아요", "position": "B안"}).status_code == 200
        cms = [c.websocket_connect(f"/ws/t-fixws/{u}") for u in (a, b, cc)]
        wa, wb, wc = [cm.__enter__() for cm in cms]
        obs_cm = c.websocket_connect("/ws/t-fixws/obs1?observer=1")
        obs = obs_cm.__enter__()
        try:
            for w in (wa, wb, wc, obs):
                drain(w, lambda d: d["type"] == "history")
            wb.send_json({"type": "away", "value": True})
            drain(wa, lambda d: d["type"] == "members" and any(m["mini_on"] for m in d["members"]))
            wa.send_json({"type": "message", "text": "B안으로 가자"})
            dec = drain(wc, lambda d: d.get("kind") == "decision")[-1]["meta"]["decision"]
            assert dec["status"] == "pending" and dec["affected"] == [b]

            # 확인 대상이 아닌 사람의 응답은 거절 (#14)
            wc.send_json({"type": "decide", "decision_id": dec["id"], "action": "object"})
            err = drain(wc, lambda d: d["type"] == "error")[-1]
            assert "대상" in err["text"]

            # '결정으로 기록' → 원래 발언이 message_update로 바뀌고, 두 번째는 오류 (#14)
            wa.send_json({"type": "message", "text": "예산표는 내가 정리해 볼게"})
            human = drain(wa, lambda d: d.get("kind") == "human" and d["text"] == "예산표는 내가 정리해 볼게")[-1]
            wa.send_json({"type": "mark_decision", "message_id": human["id"]})
            upd = drain(wa, lambda d: d["type"] == "message_update" and d["message"]["id"] == human["id"])[-1]
            assert upd["message"]["meta"].get("decision_id")
            wa.send_json({"type": "mark_decision", "message_id": human["id"]})
            assert "이미" in drain(wa, lambda d: d["type"] == "error")[-1]["text"]

            # 관전자는 회의를 끝낼 수 없다 (#12)
            obs.send_json({"type": "end_meeting"})
            obs.send_json({"type": "ping"})
            drain(obs, lambda d: d["type"] == "pong")
            assert c.get("/api/rooms/t-fixws").json()["room"]["meeting"]["status"] == "live"

            wa.send_json({"type": "end_meeting"})
            result = drain(wc, lambda d: d.get("kind") == "result")[-1]
            wa.send_json({"type": "end_meeting"})
            assert "이미" in drain(wa, lambda d: d["type"] == "error")[-1]["text"]

            # 회의 뒤 잡담은 회의를 다시 열지 않고 회의록도 그대로 (#2)
            wc.send_json({"type": "message", "text": "다들 수고했어"})
            bye = drain(wa, lambda d: d.get("kind") == "human" and d["text"] == "다들 수고했어")[-1]
            assert bye["meta"].get("after_end")
            st = c.get("/api/rooms/t-fixws").json()["room"]
            assert st["meeting"]["status"] == "ended" and st["has_minutes"]

            # 복귀자가 승인 → 결정 카드·회의록이 message_update로 지금 상태가 된다 (#9, #14)
            wb.send_json({"type": "away", "value": False})
            drain(wb, lambda d: d["type"] == "away_digest")
            wb.send_json({"type": "decide", "decision_id": dec["id"], "action": "approve"})
            card = drain(wc, lambda d: d["type"] == "message_update" and d["message"]["kind"] == "decision"
                         and d["message"]["meta"]["decision"]["id"] == dec["id"])[-1]
            assert card["message"]["meta"]["decision"]["status"] == "confirmed"
            # 회의록의 예산 쟁점 결정(마지막 결정 = '결정으로 기록'한 것)을 승인하면 결과 카드가 바뀐다
            rd = next(x for x in result["meta"]["issues"] if x["issue_id"] == i1)["decision"]
            assert rd["status"] == "pending"
            assert rd["id"] != dec["id"]
            wb.send_json({"type": "decide", "decision_id": rd["id"], "action": "approve"})
            res = drain(wc, lambda d: d["type"] == "message_update" and d["message"]["kind"] == "result")[-1]["message"]
            assert res["id"] == result["id"]
            it = next(x for x in res["meta"]["issues"] if x["issue_id"] == i1)
            assert it["status"] == "confirmed" and it["decision"]["status"] == "confirmed"
            md = c.get("/api/rooms/t-fixws/minutes.md").text
            assert "[확정]" in md
        finally:
            obs_cm.__exit__(None, None, None)
            for cm in cms:
                cm.__exit__(None, None, None)

        # 초기화(seed=false)는 쟁점 상태도 처음으로 (#15)
        assert c.post("/api/rooms/t-fixws/reset", json={"seed": False}).json()["ok"]
        room = c.get("/api/rooms/t-fixws").json()["room"]
        assert all(i["status"] == "open" for i in room["issues"]) and not room["decisions"]


# ---------------------------------------------------------------- 느린 처리가 받기 루프를 막지 않는다 (#8)
def test_ws_slow_handler_does_not_block(monkeypatch):
    orig = verify.run

    async def slow_run(room, requester, target):
        await asyncio.sleep(1.5)
        return await orig(room, requester, target)

    monkeypatch.setattr(verify, "run", slow_run)
    with TestClient(app) as c:
        assert c.post("/api/rooms", json={"room_id": "t-slow", "agenda": "축제 예산",
                                          "issues": [{"title": "예산안 정하기", "options": ["A안", "B안"]}]}).status_code == 200
        uid = c.post("/api/rooms/t-slow/members", json={"name": "가람"}).json()["user_id"]
        with c.websocket_connect(f"/ws/t-slow/{uid}") as w:
            drain(w, lambda d: d["type"] == "history")
            w.send_json({"type": "message", "text": "예산은 A안이 현실적이야"})
            target = drain(w, lambda d: d.get("kind") == "human")[-1]
            t0 = time.time()
            w.send_json({"type": "verify", "message_id": target["id"]})
            w.send_json({"type": "message", "text": "그 사이에 한마디"})
            got = drain(w, lambda d: d.get("kind") == "human" and d["text"] == "그 사이에 한마디")
            assert time.time() - t0 < 1.2 and not any(d.get("kind") == "verify" for d in got)
            drain(w, lambda d: d.get("kind") == "verify")
