"""REST + WebSocket: 4명 동시 접속, 관전자, 없는 팀원, 시연 장면 실행."""
import time

from fastapi.testclient import TestClient

from app.main import app


def drain(ws, until, n=60):
    out = []
    for _ in range(n):
        d = ws.receive_json()
        out.append(d)
        if until(d):
            return out
    raise AssertionError(f"기다린 이벤트가 오지 않음: {[x.get('type') for x in out]}")


def test_four_members_and_observer():
    with TestClient(app) as c:
        assert c.get("/health").json()["ok"]
        r = c.post("/api/rooms", json={"room_id": "t-api", "title": "테스트", "agenda": "축제 예산",
                                      "issues": [{"title": "예산안 정하기", "options": ["A안", "B안"]}]})
        assert r.status_code == 200
        assert c.post("/api/rooms", json={"room_id": "t-api"}).status_code == 409
        uids = [c.post("/api/rooms/t-api/members", json={"name": n}).json()["user_id"] for n in ("가람", "나래", "다온", "라희")]
        assert c.post("/api/rooms/t-api/members", json={"name": "가람"}).status_code == 409
        rep = c.post(f"/api/rooms/t-api/members/{uids[1]}/reports",
                     json={"text": "나는 B안이 좋다고 생각한다. 학생 참여가 더 높았다.\n\n작년 부스 만족도는 4.2점이었다."}).json()
        assert rep["candidates"] == 1
        cand = next(s for s in rep["member"]["stances"] if s["status"] == "candidate")
        conf = c.post(f"/api/rooms/t-api/members/{uids[1]}/stances/{cand['id']}/confirm", json={"ok": True}).json()
        assert conf["member"]["readiness"]["ready"]
        socks = [c.websocket_connect(f"/ws/t-api/{u}") for u in uids]
        ws = [s.__enter__() for s in socks]
        obs_cm = c.websocket_connect("/ws/t-api/obs1?observer=1")
        obs = obs_cm.__enter__()
        try:
            for w in ws + [obs]:
                drain(w, lambda d: d["type"] == "history")
            ws[1].send_json({"type": "away", "value": True})
            drain(ws[0], lambda d: d["type"] == "members" and any(m["mini_on"] for m in d["members"]))
            ws[0].send_json({"type": "message", "text": "나는 A안이 현실적이라고 봐"})
            got = drain(obs, lambda d: d.get("kind") == "mini")
            mini = got[-1]
            assert mini["user_id"] == uids[1] and mini["meta"]["citations"]
            gate = next(d for d in got if d["type"] == "gate")
            assert gate["actions"][0]["uid"] == uids[1]
            obs.send_json({"type": "message", "text": "관전자는 못 보냄"})          # 무시돼야 함
            ws[2].send_json({"type": "message", "text": "B안으로 가자"})
            got = drain(ws[3], lambda d: d.get("kind") == "decision")
            assert got[-1]["meta"]["decision"]["status"] == "pending"
            ws[1].send_json({"type": "away", "value": False})
            dg = drain(ws[1], lambda d: d["type"] == "away_digest")[-1]
            assert dg["decisions"] and dg["mini"]
            ws[1].send_json({"type": "decide", "decision_id": dg["decisions"][0]["id"], "action": "approve"})
            upd = drain(ws[0], lambda d: d["type"] == "decision")[-1]
            assert upd["decision"]["status"] == "confirmed"
            ws[0].send_json({"type": "end_meeting"})
            drain(ws[2], lambda d: d.get("kind") == "result")
        finally:
            obs_cm.__exit__(None, None, None)
            for s in socks:
                s.__exit__(None, None, None)
        msgs = c.get("/api/rooms/t-api").json()
        assert msgs["room"]["has_minutes"]
        assert "관전자는 못 보냄" not in c.get("/api/rooms/t-api/minutes.md").text
        with c.websocket_connect("/ws/t-api/nobody") as w:
            assert w.receive_json()["code"] == "unknown_member"


def test_demo_scenes_run():
    with TestClient(app) as c:
        for n in range(3):
            c.post("/api/demo/demo/run", json={"scene": n, "speed": 0.3})
            for _ in range(200):
                st = c.get("/api/demo/demo").json()
                if st["status"] in ("done", "error") and n in st["done"]:
                    break
                time.sleep(0.05)
            assert st["status"] == "done", st
        room = c.get("/api/rooms/demo").json()
        minsu = next(m for m in room["members"]["members"] if m["user_id"] == "minsu")
        assert minsu["readiness"]["ready"] and minsu["mini_on"]
