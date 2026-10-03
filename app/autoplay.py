"""실전 시연 자동 진행 (docs/06-실전-시연-대본.md).

'실전 시연용'으로 만든 방에서 동준(발표자)의 대리 참석이 켜지는 순간 시작한다.
종원·정민의 대사, 2차 검증 요청, 역할 결정을 대본 순서대로 보낸다 (회의 종료는 마지막에 직접).
미니미의 판단·발언·검증·회의록은 매번 실제 모듈이 만든다. 대사만 대본이다.

속도: 각 단계는 앞 단계의 미니미 답이 실제로 나올 때까지 기다린 뒤, 발표자가 설명할 시간(hold)만큼 쉰다.
화면 위 '자동 진행' 줄의 [바로 다음]으로 남은 시간을 건너뛰고, [멈춤]으로 멈출 수 있다.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time

from . import orchestrator
from .store import hub

log = logging.getLogger("minime")

LIVE_UIDS = {"jw", "hj", "jm", "dj"}          # seed.seed_live_room 의 팀원
PRESENTER = "dj"
START_DELAY = 4.0                             # 대리 참석 안내가 뜨고 첫 대사까지
SPEED = float(os.getenv("LIVE_AUTOPLAY_SPEED", "1.0") or 1.0)   # hold 배율 (1.0 = 대본 속도)
ENABLED = os.getenv("LIVE_AUTOPLAY", "1") != "0"

LINES = {
    "a": "나는 공연이 축제의 얼굴이라 A안이 현실적이라고 봐.",
    "ask": "동준 미니미, 무대 음향 장비 대여 업체는 알아봤어?",
    "b": "결론적으로 B안으로 가자. 학생 참여 프로그램이 만족도가 항상 더 높으니까 확실해.",
    "role": "좋아. 발표 역할은 내가 사회, 정민이가 본론 발표, 혜중이가 자료 설명, 동준이가 질의응답 맡는 걸로 하자.",
}
# hold = 이 단계가 끝난 뒤 발표자 설명 시간(초)
STEPS = [
    {"label": "종원: A안 의견 → 동준 미니미 반론", "say": ("jw", LINES["a"]), "hold": 18},
    {"label": "정민: 동준 미니미에게 모르는 걸 질문", "say": ("jm", LINES["ask"]), "hold": 8},
    {"label": "정민: B안으로 결론 → 결정 보류", "say": ("jm", LINES["b"]), "hold": 2},
    {"label": "정민: 내 미니미에게 2차 검증", "verify": ("jm", "결론적으로 B안"), "hold": 24},
    {"label": "종원: 발표 역할 정하기 → 결정 보류", "say": ("jw", LINES["role"]), "hold": 0},
]
# 회의 종료는 자동으로 하지 않는다: 끝난 회의에서는 미니미가 답하지 않아서, 남는 시간에 기능을 더 보여 줄 수 없다.
# 마지막에 공유 화면에서 [⋯] → [회의 종료 · 회의록]을 직접 누른다.

_state: dict[str, dict] = {}
_tasks: dict[str, asyncio.Task] = {}
_skip: dict[str, asyncio.Event] = {}


def is_live_room(room) -> bool:
    return LIVE_UIDS <= set(room.personas)


def snapshot(room_id: str) -> dict:
    st = _state.get(room_id) or {"status": "idle"}
    return {"type": "autoplay", **st, "total": len(STEPS), "now": time.time()}


async def _emit(room_id: str, **kw) -> None:
    st = _state.setdefault(room_id, {"status": "idle"})
    st.update(kw)
    await hub.broadcast(room_id, snapshot(room_id))


def maybe_start(room_id: str) -> None:
    """동준의 대리 참석이 켜졌을 때 orchestrator 가 부른다. 방마다 한 번만."""
    room = hub.room(room_id)
    if not ENABLED or not is_live_room(room):
        return
    if _state.get(room_id, {}).get("status") in ("running", "paused", "done"):
        return
    _skip[room_id] = asyncio.Event()
    _tasks[room_id] = asyncio.create_task(_run(room_id))


def stop(room_id: str, clear: bool = False) -> None:
    t = _tasks.pop(room_id, None)
    if t and not t.done():
        t.cancel()
    if clear:
        _state.pop(room_id, None)
        _skip.pop(room_id, None)


async def control(room_id: str, action: str) -> dict:
    st = _state.get(room_id)
    if not st:
        return snapshot(room_id)
    if action == "next" and room_id in _skip:
        _skip[room_id].set()
    elif action == "pause" and st.get("status") == "running":
        await _emit(room_id, status="paused", until=0)
    elif action == "resume" and st.get("status") == "paused":
        await _emit(room_id, status="running")
        _skip[room_id].set()
    elif action == "stop":
        stop(room_id)
        await _emit(room_id, status="done", label="자동 진행을 멈췄어요", until=0)
    return snapshot(room_id)


async def _hold(room_id: str, seconds: float) -> None:
    """설명 시간. [바로 다음]이면 바로 끝나고, [멈춤]이면 [이어서]를 누를 때까지 기다린다."""
    ev = _skip[room_id]
    ev.clear()
    secs = max(0.0, seconds * SPEED)
    await _emit(room_id, until=time.time() + secs)
    try:
        await asyncio.wait_for(ev.wait(), timeout=secs)
    except asyncio.TimeoutError:
        pass
    while _state[room_id].get("status") == "paused":
        ev.clear()
        await ev.wait()


async def _say(room_id: str, uid: str, text: str) -> None:
    hub.set_typing(room_id, uid, True)
    await hub.broadcast(room_id, {"type": "typing", "user_id": uid, "mini": False, "on": True})
    await asyncio.sleep(min(2.0, 0.5 + len(text) * 0.02))
    hub.set_typing(room_id, uid, False)
    await hub.broadcast(room_id, {"type": "typing", "user_id": uid, "mini": False, "on": False})
    _, task = await orchestrator.handle_human(room_id, uid, text)
    try:                                               # 미니미 답(또는 침묵 판단)이 나올 때까지 기다린다
        await asyncio.wait_for(asyncio.shield(task), timeout=45)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        pass


async def _run(room_id: str) -> None:
    try:
        await _emit(room_id, status="running", step=0, label="곧 시작해요", next_label=STEPS[0]["label"], until=0)
        await _hold(room_id, START_DELAY / max(SPEED, 0.01))
        for i, step in enumerate(STEPS):
            nxt = STEPS[i + 1]["label"] if i + 1 < len(STEPS) else ""
            await _emit(room_id, step=i + 1, label=step["label"], next_label=nxt, until=0)
            room = hub.room(room_id)
            if "say" in step:
                uid, text = step["say"]
                if uid in room.personas:
                    await _say(room_id, uid, text)
            elif "verify" in step:
                uid, match = step["verify"]
                target = next((m for m in reversed(room.messages) if m.kind == "human" and match in m.text), None)
                if target:
                    await orchestrator.request_verify(room_id, uid, target.id)
            elif step.get("end"):
                await orchestrator.end_meeting(room_id)
            if step["hold"]:
                await _hold(room_id, step["hold"])
        await _emit(room_id, status="done", label="자동 진행 끝 · [돌아왔어요] → 승인 · 마지막에 [⋯] → 회의 종료", next_label="", until=0)
    except asyncio.CancelledError:
        raise
    except Exception as e:                             # 시연은 멈추지 않고 이유를 보여 준다
        log.exception("autoplay failed room=%s", room_id)
        await _emit(room_id, status="error", label=f"자동 진행 오류: {e}", until=0)


async def presenter_back(room_id: str) -> None:
    """동준이 일찍 돌아오면 남은 자동 진행은 멈춘다 (돌아온 뒤에 대사가 계속 나가지 않게)."""
    st = _state.get(room_id)
    if st and st.get("status") in ("running", "paused"):
        stop(room_id)
        await _emit(room_id, status="done", label="동준이 돌아와서 자동 진행을 마쳤어요", next_label="", until=0)
