"""실전 시연(동준 화면에서 방·미니미를 만들고 4명이 직접) 대본 회귀 테스트 — docs/06-실전-시연-대본.md 와 같은 입력.

빈 방 만들기 → 4명 입장 → 자유 채팅 → 혜중 보고서·인터뷰 → 종원 인터뷰 → 혜중 자리 비움
→ 대리 반론 → 근거 없는 질문엔 침묵 → B안 결정 보류 + 2차 검증 카드 4종 → 역할 결정 보류 → 회의 종료 → 복귀 승인·이의
"""
import asyncio

import httpx

from app import ko, orchestrator
from app.main import app
from app.store import hub

R = "live-test"
OLD_REPORT = """작년 우리 학교 축제 예산 1억 2천만 원 중 60%인 7,200만 원이 연예인 섭외비였고, 학생 참여 프로그램에는 15%만 쓰였다.

총학생회 만족도 조사(응답 812명)에서 연예인 공연은 3.6점, 동아리·체험 부스는 4.2점이었다.

같은 조사에서 '내년 축제에 바라는 점' 1위는 학생 참여 프로그램 확대(38%)였다.

그래서 학생 참여 프로그램 예산을 늘리는 B안을 제안해야 한다고 생각한다. 다만 홍보 효과를 위해 연예인 공연은 최소 1팀은 유지해야 한다."""


def test_red_line_from_one_line_answer():
    assert ko.red_line("맞아 B안. 근데 공연 1팀은 꼭 남기자").startswith("공연 1팀은 꼭 남기")
    assert ko.red_line("나는 자료조사 맡을게. 발표는 부담돼") == ""


async def _flow():
    """실전 시연: 동준(발표자) 화면에서 방을 만들고(실전 시연용), 동준만 미니미를 직접 준비해 자리를 비운다."""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        async def ok(coro):
            r = await coro
            assert r.status_code < 300, (r.status_code, r.text)
            return r.json()

        await ok(c.delete(f"/api/rooms/{R}"))
        await ok(c.post("/api/rooms", json={"room_id": R, "title": "", "agenda": "", "issues": [], "seed": "live"}))
        room = hub.room(R)
        assert [p.name for p in room.personas.values()] == ["종원", "혜중", "정민", "동준"]
        assert not room.personas["dj"].reports and room.personas["hj"].confirmed("i1")

        async def say(uid, t):
            msg, task = await orchestrator.handle_human(R, uid, t)
            await task
            i = [m.id for m in room.messages].index(msg.id)
            return msg, room.messages[i + 1:]

        for uid, t in LINES["free"]:                     # 자료가 있어도 모두 자리에 있으면 미니미는 말하지 않는다
            _, out = await say(uid, t)
            assert not [m for m in out if m.kind == "mini"]

        base = f"/api/rooms/{R}/members/dj"
        ex = (await ok(c.get(base)))["example"]
        await ok(c.post(base + "/reports", json={"title": ex["report_title"], "text": ex["report_text"]}))
        qs = (await ok(c.post(base + "/interview/plan")))["questions"]
        assert [q["issue_id"] for q in qs] == ["i1", "i2"]
        for q in qs:
            st = (await ok(c.post(base + f"/interview/{q['id']}/answer", json={"text": ex["answers"][q["issue_id"]]})))["stance"]
            await ok(c.post(base + f"/stances/{st['id']}/confirm", json={"ok": True}))
        rd = (await ok(c.get(base)))["readiness"]
        assert rd["covered"] == rd["total"] == 2
        assert room.personas["dj"].confirmed("i1")[0].red_line.startswith("운영 인력 계획")

        await orchestrator.set_away(R, "dj", True)
        _, out = await say("jw", LINES["a"])
        minis = [m for m in out if m.kind == "mini"]
        assert len(minis) == 1 and minis[0].user_id == "dj" and minis[0].meta["act"] == "rebuttal"
        assert minis[0].meta["citations"]

        _, out = await say("jm", LINES["ask"])
        assert out[-1].meta.get("abstain") == "no_evidence"

        target, out = await say("jm", LINES["b"])
        assert any(m.kind == "decision" and m.meta["decision"]["status"] == "pending" for m in out)
        await orchestrator.request_verify(R, "jm", target.id)
        await asyncio.sleep(0.2)
        card = [m for m in room.messages if m.kind == "verify"][-1].meta
        card = card.get("card") or card
        assert {"이전 발언과 충돌", "놓친 점", "반대 관점"} <= set(card["labels"])
        assert "동준" in card["missed"][0] and "종원" in card["devil"]["cite"]

        await say("jw", LINES["role"])
        await orchestrator.end_meeting(R)
        await orchestrator.set_away(R, "dj", False)
        for d in room.decisions:
            await orchestrator.respond_decision(R, "dj", d.id, "approve", "")
        assert len(room.decisions) == 2 and all(d.status == "confirmed" for d in room.decisions)

        # 실전 방에서는 시연 가이드(방을 시연용 시나리오로 덮어씀)가 실행되지 않는다
        assert (await c.post(f"/api/demo/{R}/run", json={"scene": 0})).status_code == 400

        # 리허설 뒤 초기화: 같은 방 코드로 다시
        assert (await ok(c.delete(f"/api/rooms/{R}")))["deleted"] is True
        assert (await c.get(f"/api/rooms/{R}")).status_code == 404


LINES = {
    "free": [("jw", "다들 들어왔지? 오늘은 축제 예산안이랑 발표 역할 정하자."),
             ("hj", "나는 자료 조사 다 올려 놨어. 만족도는 부스가 더 높게 나왔어."),
             ("jm", "솔직히 공연 없으면 사람 안 올 것 같아. 나는 아직 A안 쪽이야."),
             ("dj", "나 발표 준비 때문에 곧 빠져야 해. 내 미니미 만들어 두고 갈게.")],
    "a": "나는 공연이 축제의 얼굴이라 A안이 현실적이라고 봐.",
    "ask": "동준 미니미, 무대 음향 장비 대여 업체는 알아봤어?",
    "b": "결론적으로 B안으로 가자. 학생 참여 프로그램이 만족도가 항상 더 높으니까 확실해.",
    "role": "좋아. 발표 역할은 내가 사회, 정민이가 본론 발표, 혜중이가 자료 설명, 동준이가 질의응답 맡는 걸로 하자.",
}


def test_live_demo_from_presenter_screen():
    asyncio.run(_flow())


def test_delete_room_only_from_server_laptop():
    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=("192.168.0.7", 5000)),
                                     base_url="http://t") as c:
            r = await c.delete("/api/rooms/anything")
            assert r.status_code == 401
    asyncio.run(go())


async def _autoplay_flow():
    """동준이 대리 참석을 켜면 종원·정민의 대사 · 2차 검증 · 역할 결정 · 회의 종료가 대본 순서대로 자동 진행된다."""
    from app import autoplay
    autoplay.SPEED, autoplay.START_DELAY = 0.01, 0.01
    rid = "live-auto"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        await c.delete(f"/api/rooms/{rid}")
        assert (await c.post("/api/rooms", json={"room_id": rid, "seed": "live"})).status_code == 200
        room = hub.room(rid)
        base = f"/api/rooms/{rid}/members/dj"
        ex = (await c.get(base)).json()["example"]
        await c.post(base + "/reports", json={"title": ex["report_title"], "text": ex["report_text"]})
        for q in (await c.post(base + "/interview/plan")).json()["questions"]:
            st = (await c.post(base + f"/interview/{q['id']}/answer", json={"text": ex["answers"][q["issue_id"]]})).json()["stance"]
            await c.post(base + f"/stances/{st['id']}/confirm", json={"ok": True})

        await orchestrator.set_away(rid, "jm", True)            # 발표자가 아닌 사람은 자동 진행을 켜지 않는다
        assert autoplay.snapshot(rid)["status"] == "idle"
        await orchestrator.set_away(rid, "jm", False)

        await orchestrator.set_away(rid, "dj", True)
        await asyncio.wait_for(autoplay._tasks[rid], timeout=60)
        assert autoplay.snapshot(rid)["status"] == "done"
        kinds = [(m.kind, m.user_id, (m.meta or {}).get("act") or (m.meta or {}).get("abstain") or "") for m in room.messages
                 if m.kind in ("mini", "decision", "verify", "result")]
        assert kinds[0] == ("mini", "dj", "rebuttal") and kinds[1] == ("mini", "dj", "no_evidence")
        assert [k[0] for k in kinds[2:]] == ["decision", "verify", "decision"]
        assert room.meeting.get("status") != "ended"          # 회의 종료는 마지막에 직접 (남는 시간에 기능을 더 보여 주도록)

        await orchestrator.set_away(rid, "dj", True)             # 한 번 끝난 방에서는 다시 돌지 않는다
        assert autoplay.snapshot(rid)["status"] == "done"
        r = await c.post(f"/api/rooms/{rid}/autoplay", json={"action": "next"})
        assert r.status_code == 200
        await c.delete(f"/api/rooms/{rid}")
        assert autoplay.snapshot(rid)["status"] == "idle"


def test_autoplay_runs_script_after_presenter_leaves():
    asyncio.run(_autoplay_flow())


def test_silent_mini_explains_why():
    """미니미를 불렀는데 답이 없을 때 이유를 알려 준다: 주인이 자리에 있음 / 회의가 끝남."""
    async def go():
        rid = "live-hint"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            await c.delete(f"/api/rooms/{rid}")
            await c.post("/api/rooms", json={"room_id": rid, "seed": "live"})
        room = hub.room(rid)

        async def ask(text):
            n = len(room.messages)
            _, t = await orchestrator.handle_human(rid, "jm", text)
            await t
            return [m for m in room.messages[n:] if m.kind != "human"]

        out = await ask("혜중 미니미, 만족도 조사 결과 알려 줘")
        assert any(m.kind == "system" and "자리에 있어서" in m.text for m in out)
        assert not any(m.kind == "mini" for m in out)
        await orchestrator.set_away(rid, "hj", True)
        assert any(m.kind == "mini" for m in await ask("혜중 미니미, 만족도 조사 결과 알려 줘"))
        await orchestrator.end_meeting(rid)
        out = await ask("혜중 미니미, 만족도 조사 결과 알려 줘")
        assert any(m.kind == "system" and "새 회의 시작" in m.text for m in out)
        await orchestrator.start_meeting(rid)
        assert any(m.kind == "mini" for m in await ask("혜중 미니미, 만족도 조사 결과 알려 줘"))
    asyncio.run(go())



def test_room_admin_with_password():
    """방 관리: 목록·대화 초기화·삭제는 비밀번호(기본 0301)가 있어야 한다. 다른 기기에서도 비밀번호면 된다."""
    async def go():
        remote = httpx.ASGITransport(app=app, client=("192.168.0.9", 5000))
        async with httpx.AsyncClient(transport=remote, base_url="http://t") as c:
            await c.post("/api/rooms", json={"room_id": "adm-1", "seed": "live"})
            assert (await c.get("/api/rooms")).status_code == 401
            assert (await c.get("/api/rooms", headers={"X-Admin-Password": "1234"})).status_code == 401
            ok = {"X-Admin-Password": "0301"}
            rooms = (await c.get("/api/rooms", headers=ok)).json()
            row = next(r for r in rooms if r["room_id"] == "adm-1")
            assert row["members"] == 4 and row["names"] == ["종원", "혜중", "정민", "동준"]
            await orchestrator.handle_human("adm-1", "jw", "안녕")
            assert (await c.post("/api/rooms/adm-1/reset", json={"seed": False})).status_code == 401
            assert (await c.post("/api/rooms/adm-1/reset", json={"seed": False}, headers=ok)).json()["ok"]
            assert not hub.room("adm-1").messages and len(hub.room("adm-1").personas) == 4
            assert (await c.delete("/api/rooms/adm-1", headers=ok)).json()["deleted"] is True
            assert all(r["room_id"] != "adm-1" for r in (await c.get("/api/rooms", headers=ok)).json())
    asyncio.run(go())
