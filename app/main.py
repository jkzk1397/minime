"""FastAPI 앱: REST(회의 전 준비·관리) + WebSocket(실시간 회의방)."""
from __future__ import annotations

import asyncio
import io
import logging
import os
import re
import socket
import time
import zipfile
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config, demo, interview, llm, minutes, nli, orchestrator, persona, retrieval, seed
from .models import Stance, new_id
from .store import ROOM_RE, UID_RE, add_persona, hub

STATIC = Path(__file__).parent / "static"
MAX_TEXT = 2000
log = logging.getLogger("minime")


# ---------------------------------------------------------------- 수명 주기
_status_pending = False


def _nli_warmup(loop: asyncio.AbstractEventLoop) -> None:
    nli.warmup()
    try:
        loop.call_soon_threadsafe(_status_changed)   # 준비되면 엔진 탭의 검증기 표시를 갱신
    except RuntimeError:
        pass


def _status_changed() -> None:
    """엔진 상태가 바뀌면 모든 방에 알린다 (짧게 모아서)."""
    global _status_pending
    if _status_pending:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    _status_pending = True

    async def flush():
        global _status_pending
        await asyncio.sleep(0.4)
        _status_pending = False
        payload = llm.status()
        for rid in list(hub.rooms):
            await hub.broadcast(rid, payload)

    loop.create_task(flush())


async def _probe_loop() -> None:
    while True:
        try:
            await llm.probe()
        except Exception:
            pass
        await asyncio.sleep(15)


@asynccontextmanager
async def lifespan(app: FastAPI):
    llm._listeners.append(_status_changed)
    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, retrieval.warmup)       # 형태소 분석기 첫 호출 지연을 미리
    loop.run_in_executor(None, _nli_warmup, loop)           # 근거 검증 NLI 모델 (없으면 핵심어 검사로 대신)
    probe = asyncio.create_task(_probe_loop())
    if {"minsu", "jihyun", "haeun"} & set(hub.room("demo").personas):     # 예전 이름으로 저장된 시연 방
        hub.replace(seed.fresh_room("demo"))
    base = config.PUBLIC_URL or f"http://{_lan_ip()}:{os.getenv('PORT', '8000')}"
    log.warning("팀원 접속 주소: %s/?room=demo  (같은 와이파이에서 휴대폰·노트북으로 접속)", base)
    yield
    probe.cancel()
    hub.save_all()


app = FastAPI(title="MINIME", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.ALLOW_ORIGINS, allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory=STATIC), name="static")


def _room(room_id: str):
    if not ROOM_RE.match(room_id):
        raise HTTPException(400, "방 이름은 영문·숫자·-·_ 32자 이내예요.")
    if room_id != "demo" and not hub.exists(room_id):
        raise HTTPException(404, "없는 방이에요. '새 회의방 만들기'로 먼저 만들어 주세요.")
    return hub.room(room_id)


def _member(room_id: str, uid: str):
    room = _room(room_id)
    p = room.personas.get(uid)
    if p is None:
        raise HTTPException(404, "팀원을 찾을 수 없어요.")
    return room, p


# ---------------------------------------------------------------- 페이지·상태
@app.get("/")
def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/health")
def health():
    st = llm.status()
    return {"ok": True, "fast": st["fast"], "slow": st["slow"], "embed": st["embed"], "order": st["order"],
            "force_rule": st["force_rule"], "verifier": st["verifier"]["method"], "rooms": len(hub.rooms)}


@app.get("/api/status")
def status():
    return llm.status()


class EngineIn(BaseModel):
    force_rule: bool


@app.post("/api/engine")
async def engine(body: EngineIn):
    llm.set_force_rule(body.force_rule)
    return llm.status()


# ---------------------------------------------------------------- 방
class IssueIn(BaseModel):
    id: str = ""
    title: str
    options: list = Field(default_factory=list)


class RoomIn(BaseModel):
    room_id: str
    title: str = ""
    agenda: str = ""
    issues: list[IssueIn] = Field(default_factory=list)
    seed: bool = False


@app.get("/api/rooms")
def rooms():
    return hub.list_rooms()


@app.post("/api/rooms")
async def create_room(body: RoomIn):
    if not ROOM_RE.match(body.room_id):
        raise HTTPException(400, "방 코드는 영문·숫자·-·_ 32자 이내예요.")
    if hub.exists(body.room_id):
        raise HTTPException(409, "이미 있는 방 코드예요.")
    room = hub.room(body.room_id)
    if body.seed:
        seed.seed_room(room)
    room.title = body.title.strip()[:60] or room.title
    if body.agenda.strip() or body.issues:               # 안건 제목이 비어도 쟁점은 남긴다
        await orchestrator.set_agenda(body.room_id, body.agenda, [i.model_dump() for i in body.issues] or None)
    hub.save_soon(body.room_id, 0.1)
    return orchestrator.room_payload(room)


@app.get("/api/rooms/{room_id}")
async def get_room(room_id: str):
    room = _room(room_id)
    return {"room": orchestrator.room_payload(room), "members": await orchestrator.members_payload(room_id),
            "demo": demo.snapshot(room_id)}


class ResetIn(BaseModel):
    seed: bool = True


@app.post("/api/rooms/{room_id}/reset")
async def reset_room(room_id: str, body: ResetIn):
    old = _room(room_id)
    demo.stop(room_id)
    if body.seed:
        fresh = seed.fresh_room(room_id)
    else:
        from .models import Room
        fresh = Room(room_id=room_id, title=old.title, agenda=old.agenda, issues=old.issues,
                     personas=old.personas)
        for i in fresh.issues:                           # 결정을 지웠으니 쟁점 상태도 처음으로
            i.status = "open"
        for p in fresh.personas.values():
            p.mini_on, p.questions, p.last_digest = False, [], {}
            p.away_marker, p.away_since, p.last_spoke = 0, 0.0, 0.0
            p.touch()
    hub.replace(fresh)
    await hub.broadcast(room_id, {"type": "reset"})
    await hub.kick_unknown(room_id)
    await orchestrator.broadcast_room(room_id)
    await orchestrator.broadcast_members(room_id)
    return {"ok": True}


def _lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


@app.get("/api/rooms/{room_id}/invite")
def invite(room_id: str, request: Request):
    _room(room_id)
    if config.PUBLIC_URL:
        base = config.PUBLIC_URL
    else:
        host = request.url.hostname or "localhost"
        port = request.url.port
        if host in ("localhost", "127.0.0.1", "0.0.0.0"):
            host = _lan_ip()
        base = f"{request.url.scheme}://{host}" + (f":{port}" if port and port not in (80, 443) else "")
    url = f"{base}/?room={room_id}"
    svg = ""
    try:
        import qrcode
        import qrcode.image.svg
        img = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
        buf = io.BytesIO()
        img.save(buf)
        svg = buf.getvalue().decode("utf-8")
        svg = re.sub(r"<\?xml[^>]*>", "", svg)
    except Exception:
        svg = ""
    return {"url": url, "qr_svg": svg}


# ---------------------------------------------------------------- 팀원 (페르소나)
class MemberIn(BaseModel):
    name: str
    role: str = ""


@app.post("/api/rooms/{room_id}/members")
async def create_member(room_id: str, body: MemberIn):
    room = _room(room_id)
    name = body.name.strip()[:12]
    if not name:
        raise HTTPException(400, "이름을 적어 주세요.")
    if len(room.personas) >= config.MAX_MEMBERS:
        raise HTTPException(400, f"한 방에는 최대 {config.MAX_MEMBERS}명까지 들어올 수 있어요.")
    if any(p.name == name for p in room.personas.values()):
        raise HTTPException(409, "같은 이름의 팀원이 있어요. 목록에서 골라 주세요.")
    uid = "m" + new_id()
    add_persona(room, uid, name, body.role.strip()[:20])
    await orchestrator.after_persona_change(room_id)
    await hub.broadcast(room_id, await orchestrator.members_payload(room_id))
    return await member_detail(room_id, uid)


@app.get("/api/rooms/{room_id}/members/{uid}")
async def member_detail(room_id: str, uid: str):
    room, p = _member(room_id, uid)
    labels = persona.stance_labels(p)
    d = asdict(p)
    for s in d["stances"]:
        s["label"] = labels.get(s["id"], "")
        issue = room.issue(s["issue_id"])
        s["issue_title"] = issue.title if issue else ""
    for r in d["reports"]:
        ri = [x.id for x in p.reports].index(r["id"])
        r["labels"] = [persona.report_label(p, ri, i) for i in range(len(r["paragraphs"]))]
    d["readiness"] = await persona.readiness(room, uid)
    d["last_digest"] = orchestrator.fresh_digest(room, uid)   # 이미 답한 질문·결정은 지금 상태로
    d["example"] = seed.example_for(room, uid)
    return d


class ProfileIn(BaseModel):
    name: str | None = None
    role: str | None = None
    intro: str = ""
    expertise: list[str] = Field(default_factory=list)
    criteria: list[str] = Field(default_factory=list)
    projects: list[str] = Field(default_factory=list)
    tone_examples: list[str] = Field(default_factory=list)
    scope_level: str = "opinion"
    no_commit: list[str] = Field(default_factory=list)
    scope_note: str = ""
    store_utterances: bool = True
    use_reports: bool = True


def _clean(xs: list[str], n: int, ln: int = 120) -> list[str]:
    return [x.strip()[:ln] for x in xs if x and x.strip()][:n]


@app.put("/api/rooms/{room_id}/members/{uid}/profile")
async def update_profile(room_id: str, uid: str, body: ProfileIn):
    room, p = _member(room_id, uid)
    if body.name and body.name.strip():
        p.name = body.name.strip()[:12]
    if body.role is not None:
        p.role = body.role.strip()[:20]
    p.profile.intro = body.intro.strip()[:120]
    p.profile.expertise = _clean(body.expertise, 8, 20)
    p.profile.criteria = _clean(body.criteria, 3, 40)
    p.profile.projects = _clean(body.projects, 3, 160)
    p.profile.tone_examples = _clean(body.tone_examples, 3, 80)
    p.scope.level = body.scope_level if body.scope_level in ("opinion", "answer") else "opinion"
    p.scope.no_commit = _clean(body.no_commit, 6, 20)
    p.scope.note = body.scope_note.strip()[:120]
    p.consent = {"store_utterances": body.store_utterances, "use_reports": body.use_reports}
    p.touch()
    await orchestrator.after_persona_change(room_id)
    return await member_detail(room_id, uid)


class ReportIn(BaseModel):
    title: str = ""
    text: str


async def _add_report(room_id: str, uid: str, title: str, text: str) -> dict:
    room, p = _member(room_id, uid)
    if len(text) > 30000:
        raise HTTPException(400, "보고서가 너무 길어요 (3만 자 이내).")
    try:
        rep = persona.add_report(room, p, title, text)
    except ValueError as e:
        raise HTTPException(400, str(e))
    sts, engine = await persona.extract_stances(room, p, rep)
    p.stances = [s for s in p.stances if not (s.status == "candidate" and s.issue_id in {x.issue_id for x in sts})]
    p.stances.extend(sts)
    p.touch()
    await orchestrator.after_persona_change(room_id)
    return {"report": asdict(rep), "candidates": len(sts), "engine": engine,
            "member": await member_detail(room_id, uid)}


@app.post("/api/rooms/{room_id}/members/{uid}/reports")
async def add_report(room_id: str, uid: str, body: ReportIn):
    return await _add_report(room_id, uid, body.title, body.text)


@app.post("/api/rooms/{room_id}/members/{uid}/reports/upload")
async def upload_report(room_id: str, uid: str, file: UploadFile = File(...), title: str = Form("")):
    raw = await file.read()
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(400, "파일은 8MB 이내만 올릴 수 있어요.")
    name = (file.filename or "").lower()
    text = _extract_text(name, raw)
    return await _add_report(room_id, uid, title or Path(file.filename or "보고서").stem, text)


def _extract_text(name: str, raw: bytes) -> str:
    """보고서 파일 → 텍스트. txt/md는 그대로, docx는 문단 XML, pdf는 Docling·pypdf가 있으면."""
    if name.endswith((".txt", ".md", ".markdown")):
        for enc in ("utf-8", "cp949", "euc-kr"):
            try:
                return raw.decode(enc)
            except UnicodeDecodeError:
                continue
        raise HTTPException(400, "글자 인코딩을 읽을 수 없어요.")
    if name.endswith(".docx"):
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                xml = z.read("word/document.xml").decode("utf-8")
        except Exception:
            raise HTTPException(400, "docx 파일을 읽을 수 없어요.")
        paras = []
        for para in re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S):
            t = "".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", para, flags=re.S))
            if t.strip():
                paras.append(re.sub(r"&lt;", "<", re.sub(r"&gt;", ">", re.sub(r"&amp;", "&", t))))
        return "\n\n".join(paras)
    if name.endswith(".pdf"):
        try:
            from docling.document_converter import DocumentConverter   # 선택: Docling (MIT)
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
                f.write(raw)
            return DocumentConverter().convert(f.name).document.export_to_markdown()
        except ImportError:
            pass
        try:
            from pypdf import PdfReader
            return "\n\n".join((pg.extract_text() or "") for pg in PdfReader(io.BytesIO(raw)).pages)
        except ImportError:
            raise HTTPException(400, "PDF를 읽으려면 서버에 docling 또는 pypdf를 설치해 주세요. 지금은 내용을 붙여 넣어 주세요.")
    raise HTTPException(400, "txt, md, docx, pdf 파일만 올릴 수 있어요.")


@app.delete("/api/rooms/{room_id}/members/{uid}/reports/{report_id}")
async def delete_report(room_id: str, uid: str, report_id: str):
    room, p = _member(room_id, uid)
    p.reports = [r for r in p.reports if r.id != report_id]
    p.stances = [s for s in p.stances if not (s.origin == "report" and s.status == "candidate")]
    p.touch()
    await orchestrator.after_persona_change(room_id)
    return await member_detail(room_id, uid)


@app.post("/api/rooms/{room_id}/members/{uid}/interview/plan")
async def interview_plan(room_id: str, uid: str):
    room, p = _member(room_id, uid)
    qs = interview.plan(room, p)
    hub.save_soon(room_id)
    return {"questions": [asdict(q) for q in qs], "member": await member_detail(room_id, uid)}


class AnswerIn(BaseModel):
    text: str


@app.post("/api/rooms/{room_id}/members/{uid}/interview/{qid}/answer")
async def interview_answer(room_id: str, uid: str, qid: str, body: AnswerIn):
    room, p = _member(room_id, uid)
    try:
        q, st, engine = await interview.answer(room, p, qid, body.text[:400])
    except KeyError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    await orchestrator.after_persona_change(room_id)
    return {"question": asdict(q), "stance": asdict(st) if st else None, "engine": engine,
            "member": await member_detail(room_id, uid)}


class ConfirmIn(BaseModel):
    ok: bool = True
    edit: str = ""


@app.post("/api/rooms/{room_id}/members/{uid}/stances/{sid}/confirm")
async def stance_confirm(room_id: str, uid: str, sid: str, body: ConfirmIn):
    room, p = _member(room_id, uid)
    try:
        st, replaced = interview.confirm(p, sid, body.ok, body.edit[:400])
    except KeyError as e:
        raise HTTPException(404, str(e))
    await orchestrator.after_persona_change(room_id)
    return {"stance": asdict(st), "replaced": [asdict(x) for x in replaced],
            "member": await member_detail(room_id, uid)}


class StanceIn(BaseModel):
    issue_id: str = ""
    claim: str
    position: str = ""
    reasons: str = ""
    red_line: str = ""
    unknown: str = ""
    priority: int = 2


@app.post("/api/rooms/{room_id}/members/{uid}/stances")
async def stance_add(room_id: str, uid: str, body: StanceIn):
    """본인이 직접 쓴 입장 카드 (본인이 쓴 것이므로 바로 '확인됨')."""
    room, p = _member(room_id, uid)
    if not body.claim.strip():
        raise HTTPException(400, "주장을 적어 주세요.")
    st = Stance(new_id("s"), body.issue_id, body.claim.strip()[:300], body.position.strip()[:20],
                body.reasons.strip()[:300], "", body.red_line.strip()[:200], body.unknown.strip()[:200],
                max(1, min(3, body.priority)), ["직접 작성"], "candidate", "manual")
    p.stances.append(st)
    _, replaced = interview.confirm(p, st.id, True)
    await orchestrator.after_persona_change(room_id)
    return {"stance": asdict(st), "replaced": [asdict(x) for x in replaced],
            "member": await member_detail(room_id, uid)}


@app.delete("/api/rooms/{room_id}/members/{uid}/stances/{sid}")
async def stance_delete(room_id: str, uid: str, sid: str):
    room, p = _member(room_id, uid)
    p.stances = [s for s in p.stances if s.id != sid]
    p.touch()
    await orchestrator.after_persona_change(room_id)
    return await member_detail(room_id, uid)


@app.delete("/api/rooms/{room_id}/members/{uid}/memory")
async def forget_me(room_id: str, uid: str):
    """내 기억 삭제: 보고서·입장 카드·인터뷰·질문·지난 발언을 모두 지운다 (프로필 이름·역할만 남김)."""
    room, p = _member(room_id, uid)
    p.reports, p.stances, p.interview, p.questions, p.past, p.last_digest = [], [], [], [], [], {}
    p.touch()
    await orchestrator.after_persona_change(room_id)
    await orchestrator.system(room_id, f"{p.name} 님이 미니미의 기억(보고서·입장 카드)을 모두 지웠어요.", event="forget")
    return await member_detail(room_id, uid)


class QAnswerIn(BaseModel):
    text: str
    share: bool = True


@app.post("/api/rooms/{room_id}/members/{uid}/questions/{qid}/answer")
async def question_answer(room_id: str, uid: str, qid: str, body: QAnswerIn):
    _member(room_id, uid)
    try:
        await orchestrator.answer_question(room_id, uid, qid, body.text[:400], body.share)
    except KeyError as e:
        raise HTTPException(404, _msg(e))
    except ValueError as e:
        raise HTTPException(409 if "이미" in str(e) else 400, _msg(e))
    return await member_detail(room_id, uid)


def _msg(e: Exception) -> str:
    return str(e.args[0]) if e.args else str(e)


# ---------------------------------------------------------------- 회의록 내보내기
@app.get("/api/rooms/{room_id}/minutes.md")
def minutes_md(room_id: str):
    room = _room(room_id)
    m = room.minutes
    if not m:
        raise HTTPException(404, "아직 회의록이 없어요. 회의를 종료하면 만들어져요.")
    minutes.refresh_decisions(room, m)                   # 회의 뒤 승인·이의가 반영된 지금 결정 상태로
    lines = [f"# {room.title or room.room_id} 회의록", "", f"- 안건: {m.get('agenda', '')}",
             f"- 작성: {time.strftime('%Y-%m-%d %H:%M', time.localtime(m.get('ts', time.time())))}", "",
             "## 요약", m.get("summary", ""), ""]
    for it in m.get("issues", []):
        d = it.get("decision") or {}
        lines += [f"## {it['title']} — {minutes.STATUS_KO.get(it['status'], '미논의')}"]
        for o in it.get("opinions", []):
            cite = f" ({', '.join(o['citations'])})" if o.get("citations") else ""
            lines.append(f"- **{o['who']}**: {o['text']}{cite}")
        for c in it.get("conflicts", []):
            lines.append(f"- 충돌: {c}")
        if d:
            lines.append(f"- 결정: {d['text']} [{d['status_ko']}]"
                         + (f" — 확인 필요: {', '.join(d['affected_names'])}" if d.get("affected_names") else ""))
        lines.append("")
    if m.get("questions"):
        lines += ["## 복귀 후 확인할 질문"] + [f"- {q['who']}: {q['text']} ({q['reason']})" for q in m["questions"]] + [""]
    if m.get("next_steps"):
        lines += ["## 다음 할 일"] + [f"- {x}" for x in m["next_steps"]]
    fname = f"minutes-{room_id}.md"
    return PlainTextResponse("\n".join(lines), media_type="text/markdown; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# ---------------------------------------------------------------- 시연 가이드
class DemoIn(BaseModel):
    scene: int = 0
    auto: bool = False
    speed: float = 1.0


@app.post("/api/demo/{room_id}/run")
async def demo_run(room_id: str, body: DemoIn):
    _room(room_id)
    if not 0 <= body.scene < len(demo.SCENES):
        raise HTTPException(400, "없는 장면이에요.")
    demo.start(room_id, body.scene, body.auto, body.speed)
    return demo.snapshot(room_id)


@app.post("/api/demo/{room_id}/stop")
async def demo_stop(room_id: str):
    demo.stop(room_id)
    return demo.snapshot(room_id)


@app.get("/api/demo/{room_id}")
def demo_state(room_id: str):
    return demo.snapshot(room_id)


# ---------------------------------------------------------------- WebSocket 회의방
@app.websocket("/ws/{room_id}/{uid}")
async def ws_room(ws: WebSocket, room_id: str, uid: str):
    observer = ws.query_params.get("observer") == "1"
    if not ROOM_RE.match(room_id) or not UID_RE.match(uid):
        await ws.close(code=4400)
        return
    if room_id != "demo" and not hub.exists(room_id):
        await ws.accept()
        await ws.send_json({"type": "error", "code": "unknown_member", "text": "없는 방이에요."})
        await ws.close(code=4404)
        return
    room = hub.room(room_id)
    if not observer and uid not in room.personas:
        await ws.accept()
        await ws.send_json({"type": "error", "code": "unknown_member", "text": "방에 없는 팀원이에요. 다시 입장해 주세요."})
        await ws.close(code=4404)
        return
    conn = await hub.connect(room_id, uid, ws, observer)
    try:
        await ws.send_json({"type": "hello", "you": uid, "observer": observer, "server_time": time.time()})
        await ws.send_json(orchestrator.room_payload(room))
        await ws.send_json(await orchestrator.members_payload(room_id))
        await ws.send_json({"type": "history", "messages": [m.to_dict() for m in room.messages[-250:]],
                            "drift": room.drift[-80:], "gate": room.gate_log[-1] if room.gate_log else None})
        await ws.send_json(llm.status())
        await ws.send_json(demo.snapshot(room_id))
        await orchestrator.broadcast_members(room_id)
        while True:
            ev = await ws.receive_json()
            await _handle_event(room_id, uid, observer, ev, ws)
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("websocket error room=%s uid=%s", room_id, uid)
    finally:
        hub.disconnect(room_id, conn)
        hub.set_typing(room_id, uid, False)
        try:
            await orchestrator.broadcast_members(room_id)
        except Exception:
            pass


async def _handle_event(room_id: str, uid: str, observer: bool, ev: dict, ws: WebSocket) -> None:
    t = ev.get("type")
    if t == "ping":
        await ws.send_json({"type": "pong", "ts": time.time()})
        return
    if observer:
        return                                           # 관전자는 보기만 한다 (시연은 REST로 조작)
    room = hub.room(room_id)
    if uid not in room.personas:
        return
    if t == "typing":
        hub.set_typing(room_id, uid, bool(ev.get("on")))
        await hub.broadcast(room_id, {"type": "typing", "user_id": uid, "mini": False, "on": bool(ev.get("on"))})
        return
    # 나머지(발언·검증·종료·복귀 요약 등 LLM을 부를 수 있는 처리)는 백그라운드로: 받기 루프가 막히지 않게.
    # 작업은 만든 순서대로 시작하고, 순서가 중요한 처리(발언·안건·종료)는 방별 잠금으로 줄을 선다.
    hub.spawn(room_id, _run_event(room_id, uid, t, ev, ws))


async def _ws_send(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_json(payload)
    except Exception:
        pass


async def _run_event(room_id: str, uid: str, t: str, ev: dict, ws: WebSocket) -> None:
    try:
        await _dispatch(room_id, uid, t, ev, ws)
    except asyncio.CancelledError:
        raise
    except (KeyError, ValueError) as e:
        await _ws_send(ws, {"type": "error", "text": _msg(e)})
    except Exception as e:
        log.exception("event %s failed room=%s uid=%s", t, room_id, uid)
        await _ws_send(ws, {"type": "error", "text": f"처리 중 오류가 났어요: {type(e).__name__}"})


async def _dispatch(room_id: str, uid: str, t: str, ev: dict, ws: WebSocket) -> None:
    room = hub.room(room_id)
    if uid not in room.personas:                         # 그 사이 방이 초기화됐으면 무시
        return
    if t == "message":
        text = (ev.get("text") or "").strip()[:MAX_TEXT]
        if text:
            meta = {}
            if ev.get("refined_from"):
                meta = {"refined_from": str(ev["refined_from"])[:MAX_TEXT], "refined": True}
            await orchestrator.handle_human(room_id, uid, text, meta)
    elif t == "refine":
        text = (ev.get("text") or "").strip()[:MAX_TEXT]
        if text:
            await _ws_send(ws, await orchestrator.refine(room_id, uid, text))
    elif t == "away":
        await orchestrator.set_away(room_id, uid, bool(ev.get("value")))
    elif t == "agenda":
        issues = ev.get("issues")
        await orchestrator.set_agenda(room_id, str(ev.get("title") or ""), issues if isinstance(issues, list) else None)
    elif t == "mode":
        await orchestrator.set_mode(room_id, str(ev.get("mode")), uid)
    elif t == "start_meeting":
        await orchestrator.start_meeting(room_id)
    elif t == "end_meeting":
        if await orchestrator.end_meeting(room_id) is None:
            raise ValueError("이미 회의가 끝났거나 회의록을 만드는 중이에요.")
    elif t == "verify":
        if await orchestrator.request_verify(room_id, uid, str(ev.get("message_id"))) is None:
            raise KeyError("검증할 발언을 찾을 수 없어요.")
    elif t == "mark_decision":
        await orchestrator.mark_decision(room_id, uid, str(ev.get("message_id")))
    elif t == "decide":
        await orchestrator.respond_decision(room_id, uid, str(ev.get("decision_id")), str(ev.get("action")),
                                            str(ev.get("note") or "")[:300])
    elif t == "answer_question":
        await orchestrator.answer_question(room_id, uid, str(ev.get("question_id")), str(ev.get("text") or "")[:400],
                                           bool(ev.get("share", True)))
    elif t == "digest":
        dg = orchestrator.fresh_digest(room, uid)
        if dg:
            await _ws_send(ws, {"type": "away_digest", "user_id": uid, **dg})


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
