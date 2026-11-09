"""수업 과제 버전에서 더한 기능 (규칙 모드).

- 개인정보 동의: 항목별 동의 · 기본값 해제 · 동의 전 발언/대리 참석 막기 (10주차 근거 설계, 제15조·제22조)
- 문서 없이 미니미 만들기: 빠른 입장 체크 · 전달 메모 · 채팅 가져오기(내 말만) · 미니미 파일 내보내기/불러오기
- 자료 파일: pptx·hwpx·docx·pdf 추출 미리보기, 쪽 번호가 붙은 출처
- 활동 1·2 위험 항목: 3-1 조건 누락 가드 · 3-2 참석자 이견 기록 · 발언 수정률(본인 확인)
"""
import asyncio
import io
import json
import os
import time
import zipfile

import pytest
from fastapi.testclient import TestClient

from app import config, minutes, orchestrator, persona, seed, sources
from app.main import app
from app.models import Room, Stance
from app.store import add_persona, hub


def _fresh(room_id: str) -> Room:
    room = seed.fresh_room(room_id)
    hub.replace(room)
    return room


def _zip(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, text in files.items():
            z.writestr(name, text)
    return buf.getvalue()


# ---------------------------------------------------------------- 개인정보 동의
def test_consent_required_and_itemized(monkeypatch):
    monkeypatch.setattr(config, "REQUIRE_CONSENT", True)
    with TestClient(app) as c:
        c.post("/api/rooms", json={"room_id": "t-consent", "agenda": "예산",
                                   "issues": [{"title": "예산안 정하기", "options": ["A안", "B안"]}]})
        uid = c.post("/api/rooms/t-consent/members", json={"name": "가람"}).json()["user_id"]
        d = c.get(f"/api/rooms/t-consent/members/{uid}").json()
        assert d["consent_ok"] is False and d["consent"]["use_reports"] is False   # 기본값은 동의 안 함

        notice = c.get("/api/privacy").json()
        assert [i["key"] for i in notice["items"]] == ["service", "use_reports", "store_utterances"]
        for it in notice["items"]:                       # 제15조 제2항 고지사항 4가지
            assert it["purpose"] and it["fields"] and it["keep"] and it["refuse"]
        assert any("제22조" in x for x in notice["law"])

        assert c.post(f"/api/rooms/t-consent/members/{uid}/consent", json={"service": False}).status_code == 400
        with c.websocket_connect(f"/ws/t-consent/{uid}") as ws:
            for _ in range(10):
                if ws.receive_json()["type"] == "history":
                    break
            ws.send_json({"type": "message", "text": "안녕하세요"})
            for _ in range(10):
                ev = ws.receive_json()
                if ev["type"] == "error":
                    assert "동의" in ev["text"]
                    break
            else:
                raise AssertionError("동의 전 발언이 막히지 않았어요")

        d = c.post(f"/api/rooms/t-consent/members/{uid}/consent",
                   json={"service": True, "use_reports": False, "store_utterances": False}).json()
        assert d["consent_ok"] and d["consent"]["version"] == config.CONSENT_VERSION
    room = hub.room("t-consent")
    p = room.personas[uid]
    p.stances.append(Stance("s1", room.issues[0].id, "저는 B안이에요.", "B안", status="confirmed", origin="manual"))
    assert persona.speech_chunks(p) == []                # 근거 사용에 동의하지 않으면 근거가 없다
    with pytest.raises(ValueError):
        asyncio.run(orchestrator.set_away("t-consent", uid, True))
    assert not p.mini_on


# ---------------------------------------------------------------- 빠른 입장 체크
def test_quick_stance_is_confirmed_and_keeps_condition():
    with TestClient(app) as c:
        c.post("/api/rooms", json={"room_id": "t-quick", "agenda": "축제 예산",
                                   "issues": [{"title": "제안할 축제 예산안", "options": ["A안", "B안"]},
                                              {"title": "발표 역할 나누기"}]})
        uid = c.post("/api/rooms/t-quick/members", json={"name": "나래"}).json()["user_id"]
        r = c.post(f"/api/rooms/t-quick/members/{uid}/quick", json={"items": [
            {"issue_id": "i1", "choice": "B안", "reason": "학생 참여가 더 중요해", "red_line": "공연 1팀은 꼭 남기자"},
            {"issue_id": "i2", "choice": "", "reason": ""}]}).json()
        assert r["created"] == 1
        st = next(s for s in r["member"]["stances"] if s["origin"] == "quick")
        assert st["status"] == "confirmed" and st["position"] == "B안"
        assert st["claim"].startswith("저는 B안 쪽이에요.") and "공연 1팀" in st["red_line"]
        assert r["member"]["readiness"]["items"][0]["state"] == "confirmed"
        # 다시 고르면 예전 빠른 입장은 바뀐다
        r2 = c.post(f"/api/rooms/t-quick/members/{uid}/quick",
                    json={"items": [{"issue_id": "i1", "choice": "A안"}]}).json()
        conf = [s for s in r2["member"]["stances"] if s["status"] == "confirmed" and s["issue_id"] == "i1"]
        assert [s["position"] for s in conf] == ["A안"]
        assert c.post(f"/api/rooms/t-quick/members/{uid}/quick", json={"items": []}).status_code == 400


def test_red_line_guard_adds_missing_condition():
    st = Stance("s1", "i1", "저는 B안에 찬성해요.", "B안", red_line="운영 인력 계획 없이 B안을 내는 건 안 돼요",
                status="confirmed")
    sents = [{"text": "저는 B안에 찬성해요", "cites": ["입장 1"], "support": 0.9}]
    out = persona.keep_red_line(sents, st, "입장 1")
    assert len(out) == 2 and out[-1]["text"].startswith("다만 운영 인력") and out[-1]["guard"] == "red_line"
    kept = persona.keep_red_line([{"text": "B안이 좋지만 운영 인력 계획은 꼭 같이 내야 해요", "cites": ["입장 1"]}], st, "입장 1")
    assert len(kept) == 1                                # 조건을 이미 말했으면 덧붙이지 않는다


# ---------------------------------------------------------------- 전달 메모
async def _memo():
    rid = "t-memo"
    room = _fresh(rid)
    p = room.personas["harin"]
    sources.add_memo(room, p, "슬라이드는 12장 안으로 만들 테니 숫자는 그래프로 보여 주세요", "i3")
    general = sources.add_memo(room, p, "오늘은 수업이 겹쳐서 못 가요. 정리된 내용은 나중에 꼭 볼게요")
    await orchestrator.set_away(rid, "harin", True)
    _, t = await orchestrator.handle_human(rid, "minjun", "오늘은 예산안부터 정하자")
    await t
    memos = [m for m in room.messages if m.kind == "mini" and m.meta.get("memo")]
    assert len(memos) == 1 and general.claim in memos[0].text and "[메모 2]" in memos[0].text
    _, t = await orchestrator.handle_human(rid, "minjun", "발표 역할은 누가 맡을지 정하자")
    await t
    memos = [m for m in room.messages if m.kind == "mini" and m.meta.get("memo")]
    assert len(memos) == 2 and "12장" in memos[1].text
    _, t = await orchestrator.handle_human(rid, "jiyeon", "발표 역할 다시 정리해 보자")
    await t
    assert len([m for m in room.messages if m.kind == "mini" and m.meta.get("memo")]) == 2   # 회의마다 한 번만


def test_memo_is_delivered_verbatim_once():
    asyncio.run(_memo())


# ---------------------------------------------------------------- 채팅 가져오기 (내 말만)
def test_chat_import_keeps_only_my_lines_as_candidates():
    with TestClient(app) as c:
        c.post("/api/rooms", json={"room_id": "t-chat", "agenda": "축제 예산",
                                   "issues": [{"title": "제안할 축제 예산안", "options": ["A안", "B안"]}]})
        uid = c.post("/api/rooms/t-chat/members", json={"name": "다온"}).json()["user_id"]
        lines = [{"text": "나는 처음엔 A안이 낫다고 생각했어", "when": "10/1 21:02"},
                 {"text": "근데 만족도 조사 보니까 부스가 4.2점이라 B안이 맞는 것 같아", "when": "10/2 20:11"},
                 {"text": "B안으로 가도 공연 1팀은 꼭 남기자", "when": "10/2 20:12"},
                 {"text": "사진", "when": ""}]
        r = c.post(f"/api/rooms/t-chat/members/{uid}/chat", json={"lines": lines, "source": "kakao"}).json()
        assert r["lines"] == 3 and r["candidates"] == 1
        st = next(s for s in r["member"]["stances"] if s["origin"] == "chat")
        assert st["status"] == "candidate" and st["position"] == "B안"      # 나중 말이 지금 입장
        assert "공연 1팀" in st["red_line"]
        assert r["member"]["readiness"]["items"][0]["state"] == "candidate"  # 확인 전에는 근거가 아니다
        assert len(r["member"]["past"]) == 3
        assert c.post(f"/api/rooms/t-chat/members/{uid}/chat", json={"lines": ["사진"]}).status_code == 400


# ---------------------------------------------------------------- 자료 파일
def test_extract_pptx_hwpx_docx_with_pages():
    pptx = _zip({
        "ppt/slides/slide1.xml": '<p:sld><a:p><a:r><a:t>축제 예산 제안</a:t></a:r></a:p></p:sld>',
        "ppt/slides/slide2.xml": '<p:sld><a:p><a:r><a:t>부스 만족도는 4.2점으로 공연 3.6점보다 높았다.</a:t></a:r></a:p>'
                                 '<a:p><a:r><a:t>그래서 B안이 좋다고 생각한다.</a:t></a:r></a:p></p:sld>',
        "ppt/slides/slide10.xml": '<p:sld><a:p><a:r><a:t>질의응답 &amp; 마무리 정리</a:t></a:r></a:p></p:sld>',
        "ppt/media/image1.png": "x"})
    out = sources.extract_file("발표.pptx", pptx)
    assert out["source"] == "pptx" and len(out["pages"]) == 3 and "질의응답 & 마무리" in out["pages"][2]
    assert any("그림" in w for w in out["warnings"])
    hwpx = _zip({"Contents/section0.xml": '<hs:sec><hp:p><hp:run><hp:t>설문은 일주일 동안 온라인으로 한다.</hp:t></hp:run></hp:p></hs:sec>'})
    assert "온라인" in sources.extract_file("계획.hwpx", hwpx)["text"]
    docx = _zip({"word/document.xml": '<w:document><w:body><w:p><w:r><w:t>B안을 제안한다.</w:t></w:r></w:p>'
                                      '<w:tbl></w:tbl></w:body></w:document>'})
    d = sources.extract_file("보고서.docx", docx)
    assert "B안" in d["text"] and any("표" in w for w in d["warnings"])
    with pytest.raises(sources.ExtractError):
        sources.extract_file("옛날.hwp", b"x")

    with TestClient(app) as c:
        c.post("/api/rooms", json={"room_id": "t-file", "agenda": "축제 예산",
                                   "issues": [{"title": "제안할 축제 예산안", "options": ["A안", "B안"]}]})
        uid = c.post("/api/rooms/t-file/members", json={"name": "라희"}).json()["user_id"]
        pre = c.post(f"/api/rooms/t-file/members/{uid}/reports/extract",
                     files={"file": ("발표.pptx", pptx)}).json()
        assert pre["source"] == "pptx" and pre["paragraphs"] == 4
        assert not c.get(f"/api/rooms/t-file/members/{uid}").json()["reports"]   # 미리보기는 저장하지 않는다
        rep = c.post(f"/api/rooms/t-file/members/{uid}/reports",
                     json={"title": pre["title"], "text": pre["text"], "source": pre["source"], "pages": pre["pages"]}).json()
        labels = rep["member"]["reports"][0]["labels"]
        assert labels[1] == "보고서 2문단 p.2" and labels[-1].endswith("p.3")


# ---------------------------------------------------------------- 참석자 이견 (3-2)
async def _dissent():
    rid = "t-dissent"
    room = _fresh(rid)
    _, t = await orchestrator.handle_human(rid, "harin", "나는 아직 공연이 있어야 사람이 온다고 봐서 A안이 좋아")
    await t
    _, t = await orchestrator.handle_human(rid, "minjun", "학생 참여가 중요하니까 B안으로 가자")
    await t
    d = room.decisions[-1]
    assert d.status == "confirmed" and [(o["uid"], o["position"]) for o in d.dissent] == [("harin", "A안")]
    dd = minutes.decision_dict(room, d)
    assert dd["dissent_names"] == ["하린(A안)"]
    note = [m for m in room.messages if m.kind == "decision"][-1]
    assert "다른 입장: 하린(A안)" in note.text
    mm = await minutes.make_minutes(room)
    i1 = next(i for i in mm["issues"] if i["issue_id"] == "i1")
    assert any("하린(A안)" in c for c in i1["conflicts"])
    assert "다른 입장이 남은 결정" in mm["summary"]


def test_present_dissent_is_kept():
    asyncio.run(_dissent())


# ---------------------------------------------------------------- 본인 확인 (발언 수정률)
async def _review():
    rid = "t-review"
    room = _fresh(rid)
    await orchestrator.set_away(rid, "doyun", True)
    _, t = await orchestrator.handle_human(rid, "minjun", "오늘은 예산안부터 정하자. 나는 공연이 축제의 얼굴이라 A안이 현실적이라고 봐.")
    await t
    minis = [m for m in room.messages if m.kind == "mini" and m.user_id == "doyun" and not m.meta.get("abstain")]
    assert minis
    await orchestrator.set_away(rid, "doyun", False)
    with pytest.raises(KeyError):
        await orchestrator.review_message(rid, "harin", minis[0].id, "ok")       # 남의 미니미 발언은 못 고친다
    await orchestrator.review_message(rid, "doyun", minis[0].id, "fix", "B안은 운영 인력 계획이 있을 때만 찬성이에요")
    assert minis[0].meta["review"]["status"] == "fix"
    corr = [s for s in room.personas["doyun"].stances if s.origin == "correction"]
    assert corr and corr[0].status == "confirmed" and corr[0].position == "B안"
    assert any(m.meta.get("event") == "review_fix" for m in room.messages if m.kind == "system")
    stats = minutes.review_stats(room)
    assert stats["reviewed"] == 1 and stats["fix"] == 1 and stats["fix_rate"] == 1.0


def test_owner_review_counts_fix_rate():
    asyncio.run(_review())


# ---------------------------------------------------------------- 미니미 파일 내보내기·불러오기
def test_export_import_roundtrip():
    src = _fresh("t-export")
    data = sources.export_persona(src, src.personas["doyun"])
    text = json.dumps(data, ensure_ascii=False)
    assert "questions" not in data and "asked_by" not in text          # 다른 사람 정보는 넣지 않는다
    with TestClient(app) as c:
        c.post("/api/rooms", json={"room_id": "t-import", "agenda": "축제 예산",
                                   "issues": [{"title": "제안할 축제 예산안 정하기", "options": ["A안", "B안"]}]})
        uid = c.post("/api/rooms/t-import/members", json={"name": "도윤"}).json()["user_id"]
        r = c.post(f"/api/rooms/t-import/members/{uid}/import", json={"data": data}).json()
        assert r["stances"] >= 1
        st = [s for s in r["member"]["stances"] if s["origin"] == "import"]
        assert st and all(s["status"] == "candidate" for s in st)       # 새 안건에 맞는지 다시 확인
        assert any(s["issue_id"] == "i1" and s["position"] == "B안" for s in st)
        assert c.post(f"/api/rooms/t-import/members/{uid}/import", json={"data": {"kind": "x"}}).status_code == 400


# ---------------------------------------------------------------- 보유 기간
def test_retention_purges_old_rooms():
    rid = "t-old"
    room = hub.room(rid)
    hub.save(rid)
    old = time.time() - 40 * 86400
    os.utime(hub.path(rid), (old, old))
    gone = asyncio.run(hub.purge_older_than(30))
    assert rid in gone and not hub.path(rid).exists()
    assert asyncio.run(hub.purge_older_than(0)) == []
