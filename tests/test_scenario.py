"""시연 시나리오 전체 흐름 (규칙 모드): 준비 → 대리 발언 → 침묵 → 이탈 → 결정·검증 → 회의록 → 복귀."""
import asyncio

import pytest

from app import interview, minutes, orchestrator, persona, seed, verify
from app.store import hub


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


async def _flow():
    room = seed.fresh_room("t-scn")
    hub.replace(room)
    hub.rooms["t-scn"] = room
    p = room.personas["hyejung"]
    assert (await persona.readiness(room, "hyejung"))["covered"] == 0
    rep = persona.add_report(room, p, seed.HYEJUNG_REPORT[0], "\n\n".join(seed.HYEJUNG_REPORT[1]))
    sts, _ = await persona.extract_stances(room, p, rep)
    p.stances += sts
    assert (await persona.readiness(room, "hyejung"))["covered"] == 1          # 보고서만으로 1/3
    for q in interview.plan(room, p):
        _, st, _ = await interview.answer(room, p, q.id, seed.HYEJUNG_INTERVIEW_ANSWERS[q.issue_id])
        interview.confirm(p, st.id, True)
    assert (await persona.readiness(room, "hyejung"))["ready"]                  # 인터뷰 후 3/3

    await orchestrator.set_away("t-scn", "hyejung", True)
    await orchestrator.set_away("t-scn", "dongjun", True)

    async def say(uid, text):
        msg, task = await orchestrator.handle_human("t-scn", uid, text)
        await task
        i = [m.id for m in room.messages].index(msg.id)
        return msg, room.messages[i + 1:]

    _, out = await say("jongwon", "오늘은 예산안부터 정하자. 나는 공연이 축제의 얼굴이라 A안이 현실적이라고 봐.")
    minis = [m for m in out if m.kind == "mini"]
    assert len(minis) == 1 and minis[0].user_id == "hyejung"                    # 가장 관련 있는 1명만
    assert minis[0].meta["act"] == "rebuttal" and minis[0].meta["citations"]
    assert all(m.kind != "decision" for m in out)                             # '정하자'는 결정이 아님

    _, out = await say("jungmin", "혜중 미니미, 무대 음향 장비 대여 업체는 알아봤어?")
    assert out[-1].meta.get("abstain") == "no_evidence"
    _, out = await say("jongwon", "동준아 리허설 날짜는 네가 정해 줄 수 있지? 목요일 어때?")
    assert out[-1].meta.get("abstain") == "commit"
    assert len(room.personas["hyejung"].questions) == 1 and len(room.personas["dongjun"].questions) == 1

    await say("jongwon", "근데 어제 축구 봤어? 손흥민 골 미쳤던데")
    _, out = await say("jungmin", "ㅋㅋ 봤지. 오늘 점심 학식 뭐 나와?")
    assert any(m.kind == "facilitator" for m in out)

    target, out = await say("jungmin", "결론적으로 B안으로 가자. 학생 참여 프로그램이 만족도가 항상 더 높으니까 확실해.")
    dec = [m for m in out if m.kind == "decision"]
    assert dec and dec[0].meta["decision"]["status"] == "pending"
    assert set(dec[0].meta["decision"]["affected"]) == {"hyejung", "dongjun"}
    card = await verify.run(room, "jungmin", target)
    assert "이전 발언과 충돌" in card["labels"] and "놓친 점" in card["labels"] and card["devil"]
    assert "종원" in card["devil"]["cite"]

    _, out = await say("jongwon", "동준 미니미, 타 대학 사례는 어떤 게 있어?")
    ans = [m for m in out if m.kind == "mini"][-1]
    assert "15%" in ans.text and "[보고서 4문단]" in ans.text

    res = await orchestrator.end_meeting("t-scn")
    i1 = next(i for i in res.meta["issues"] if i["issue_id"] == "i1")
    assert i1["status"] == "pending" and i1["conflicts"]

    dg = await orchestrator.set_away("t-scn", "hyejung", False)
    assert dg["decisions"] and dg["questions"] and dg["mini"]
    d = next(x for x in room.decisions if "B안" in x.text)
    minutes.respond(room, d.id, "hyejung", "approve")
    assert d.status == "pending"                                              # 동준 확인 전
    minutes.respond(room, d.id, "dongjun", "approve")
    assert d.status == "confirmed"


def test_full_scenario():
    asyncio.run(_flow())
