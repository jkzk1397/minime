"""시연 가이드: 서비스 흐름을 장면 단위로 '진짜 백엔드'에서 실행한다.

입력(대사·보고서·인터뷰 답)만 대본이고, 미니미의 판단·발언·검증·회의록은 실제 모듈이 만든다.
모든 접속자 화면이 같이 움직이고, 발표 화면은 장면마다 볼 곳(대시보드·준비 화면·복귀 화면)을 안내한다.
"""
from __future__ import annotations

import asyncio
import time

from . import interview, llm, orchestrator, persona, seed
from .store import hub

SCENES = [
    {
        "id": 0, "title": "팀과 안건", "metric": "주제 부합성",
        "narration": "'스피치와 토론' 4조입니다. 오늘 안건은 축제 예산 정책 제안 발표 준비, 쟁점은 3개예요. "
                     "그런데 오늘 회의에는 2명이 수업 때문에 못 옵니다. 원래라면 회의가 미뤄지죠.",
        "focus": "agenda",
        "steps": [{"do": "reset"}, {"do": "wait", "s": 0.6}],
    },
    {
        "id": 1, "title": "준비: 민수의 미니미 만들기", "metric": "페르소나 충실도",
        "narration": "민수가 회의 전에 보고서를 올리면 AI가 입장 카드 초안을 만들고, 빈 쟁점만 질문합니다. "
                     "한 줄로 대충 답해도 미니미가 풀어 쓰고, 본인이 '맞아요'를 누른 것만 근거가 됩니다. 준비도가 1/3 → 3/3으로 차오릅니다.",
        "focus": "prep", "view": "prep:minsu",
        "steps": [{"do": "report", "uid": "minsu"}, {"do": "wait", "s": 1.2}, {"do": "interview", "uid": "minsu"}],
    },
    {
        "id": 2, "title": "대리 참석: 2명이 빠져도 회의는 열린다", "metric": "개입 F1 · 근거 일치율",
        "narration": "민수와 하은이 미니미를 켜고 빠집니다. 종원이 A안을 꺼내자, 민수의 미니미가 반론합니다. "
                     "모든 문장에 출처 칩이 붙고, 오른쪽 '미니미의 머릿속'에서 왜 지금 말했는지 점수로 보입니다.",
        "focus": "gate",
        "steps": [
            {"do": "away", "uid": "minsu", "on": True}, {"do": "wait", "s": 0.5},
            {"do": "away", "uid": "haeun", "on": True}, {"do": "wait", "s": 0.8},
            {"do": "say", "uid": "jongwon", "text": "오늘은 예산안부터 정하자. 나는 공연이 축제의 얼굴이라 A안이 현실적이라고 봐."},
            {"do": "wait", "s": 1.4},
            {"do": "say", "uid": "jihyun", "text": "오 데이터가 있으니까 설득력 있네. 하은이 생각은 어때?"},
        ],
    },
    {
        "id": 3, "title": "침묵: 근거가 없으면 말하지 않는다", "metric": "올바른 침묵률",
        "narration": "민수 보고서에 없는 걸 물으면, 미니미는 지어내지 않고 '민수 님께 확인이 필요해요'라고 답한 뒤 "
                     "복귀 후 확인할 질문으로 남깁니다. 날짜를 정해 달라는 약속 요청도 위임 범위 밖이라 보류합니다.",
        "focus": "evidence",
        "steps": [
            {"do": "say", "uid": "jihyun", "text": "민수 미니미, 무대 음향 장비 대여 업체는 알아봤어?"},
            {"do": "wait", "s": 1.2},
            {"do": "say", "uid": "jongwon", "text": "하은아 리허설 날짜는 네가 정해 줄 수 있지? 목요일 어때?"},
        ],
    },
    {
        "id": 4, "title": "흐름 유지: 안건 이탈 감지", "metric": "흐름 이탈 대응",
        "narration": "잡담이 이어지면 안건 거리 그래프가 치솟고, 두 번 연속 임계값을 넘으면 회의 도우미가 남은 쟁점을 상기시킵니다. "
                     "이 판단에는 LLM이 필요 없어서 0초에 가깝습니다.",
        "focus": "drift",
        "steps": [
            {"do": "say", "uid": "jongwon", "text": "근데 어제 축구 봤어? 손흥민 골 미쳤던데"},
            {"do": "wait", "s": 0.8},
            {"do": "say", "uid": "jihyun", "text": "ㅋㅋ 봤지. 오늘 점심 학식 뭐 나와?"},
        ],
    },
    {
        "id": 5, "title": "2차 검증과 보류 결정", "metric": "검증 탐지율",
        "narration": "지현이 결론을 내리자 불참자에게 영향을 주는 결정이라 자동으로 '보류'됩니다. "
                     "지현이 자기 미니미에게 검증을 맡기면 '근거 약함 · 지난 회의 발언과 충돌 · 놓친 점 · 반대 관점' 카드가 나옵니다. 고칠지는 사람이 정합니다.",
        "focus": "verify",
        "steps": [
            {"do": "say", "uid": "jihyun", "text": "결론적으로 B안으로 가자. 학생 참여 프로그램이 만족도가 항상 더 높으니까 확실해."},
            {"do": "wait", "s": 1.0},
            {"do": "verify", "uid": "jihyun", "match": "결론적으로 B안"},
            {"do": "wait", "s": 1.6},
            {"do": "say", "uid": "jongwon",
             "text": "좋아. 발표 역할은 내가 사회랑 도입, 지현이가 본론, 민수가 질의응답 근거 정리하는 걸로 하자."},
        ],
    },
    {
        "id": 6, "title": "모델이 꺼져도 회의는 계속", "metric": "기술성 · 완성도",
        "narration": "시연 중에 모델을 끕니다. 엔진 표시가 '규칙 대체'로 바뀌어도 하은의 미니미는 보고서 문장을 그대로 인용해 답합니다. "
                     "모델이 늦거나 죽어도 회의는 멈추지 않습니다.",
        "focus": "engine",
        "steps": [
            {"do": "engine", "force_rule": True}, {"do": "wait", "s": 0.8},
            {"do": "say", "uid": "jongwon", "text": "하은 미니미, 타 대학 사례는 어떤 게 있어?"},
            {"do": "wait", "s": 1.2}, {"do": "engine", "force_rule": False},
        ],
    },
    {
        "id": 7, "title": "회의 종료: 쟁점별 회의록", "metric": "회의 결과 정리",
        "narration": "회의를 끝내면 쟁점마다 누가 무슨 의견을 냈는지, 충돌과 결정 상태(확정·보류·확인 필요)가 정리됩니다.",
        "focus": "minutes",
        "steps": [{"do": "end"}],
    },
    {
        "id": 8, "title": "복귀: 내가 빠진 사이", "metric": "현장 적용성",
        "narration": "돌아온 민수는 '내가 빠진 사이'에서 미니미가 한 말과 보류 결정을 확인합니다. "
                     "예산안은 승인하고, 역할 분담에는 이의를 달고, 미니미가 남긴 질문에 답하면 다음 회의부터는 미니미가 답할 수 있습니다.",
        "focus": "digest", "view": "digest:minsu",
        "steps": [
            {"do": "away", "uid": "minsu", "on": False}, {"do": "wait", "s": 2.0},
            {"do": "decide", "uid": "minsu", "match": "B안", "action": "approve"}, {"do": "wait", "s": 1.4},
            {"do": "decide", "uid": "minsu", "match": "역할", "action": "object",
             "note": "질의응답 근거 정리는 좋아요. 그런데 설문 결과 슬라이드는 제가 직접 발표하고 싶어요."},
            {"do": "wait", "s": 1.4},
            {"do": "answer_q", "uid": "minsu", "match": "음향",
             "text": "음향 장비 업체는 아직 안 알아봤어. 이번 주 금요일까지 3곳 견적 받아 볼게"},
        ],
    },
]

_state: dict[str, dict] = {}
_tasks: dict[str, asyncio.Task] = {}


def state(room_id: str) -> dict:
    return _state.setdefault(room_id, {"type": "demo", "scene": -1, "status": "idle", "done": [], "step": "",
                                       "auto": False, "speed": 1.0, "view": "", "focus": ""})


def scenes_public() -> list[dict]:
    return [{k: v for k, v in s.items() if k != "steps"} for s in SCENES]


async def _emit(room_id: str, **kw) -> None:
    st = state(room_id)
    st.update(kw)
    await hub.broadcast(room_id, {**st, "scenes": scenes_public()})


def start(room_id: str, scene: int, auto: bool, speed: float) -> None:
    stop(room_id)
    st = state(room_id)
    st["speed"] = max(0.3, min(2.0, speed))
    st["auto"] = auto
    _tasks[room_id] = asyncio.create_task(_run(room_id, scene, auto))


def stop(room_id: str) -> None:
    t = _tasks.pop(room_id, None)
    if t and not t.done():
        t.cancel()


async def _run(room_id: str, first: int, auto: bool) -> None:
    sc = first
    try:
        while 0 <= sc < len(SCENES):
            scene = SCENES[sc]
            await _emit(room_id, scene=sc, status="running", step="", view=scene.get("view", ""),
                        focus=scene.get("focus", ""))
            for step in scene["steps"]:
                await _do(room_id, step)
            done = sorted(set(state(room_id)["done"]) | {sc})
            await _emit(room_id, status="done", done=done, step="")
            if not auto:
                break
            await asyncio.sleep(4.5 * state(room_id)["speed"])
            sc += 1
    except asyncio.CancelledError:
        await _emit(room_id, status="idle", step="")
        raise
    except Exception as e:                                  # 시연은 멈추지 않고 이유를 보여 준다
        await _emit(room_id, status="error", step=f"오류: {e}")
    finally:
        if llm.force_rule() and state(room_id).get("forced_by_demo"):
            llm.set_force_rule(False)


async def _sleep(room_id: str, s: float) -> None:
    await asyncio.sleep(s * state(room_id)["speed"])


async def _do(room_id: str, step: dict) -> None:
    room = hub.room(room_id)
    kind = step["do"]
    if kind == "wait":
        await _sleep(room_id, step["s"])
    elif kind == "reset":
        old = hub.room(room_id)
        fresh = seed.fresh_room(room_id)
        fresh.title = old.title or fresh.title
        hub.replace(fresh)
        state(room_id)["done"] = []
        await hub.broadcast(room_id, {"type": "reset"})
        await orchestrator.broadcast_room(room_id)
        await orchestrator.broadcast_members(room_id)
        await _emit(room_id, step="방을 시연 시작 상태로 되돌렸어요")
    elif kind == "report":
        p = room.personas[step["uid"]]
        title, paras = seed.MINSU_REPORT
        await _emit(room_id, step=f"{p.name}: 보고서 업로드 → 입장 카드 초안 만들기")
        p.reports = []
        p.stances = [s for s in p.stances if s.origin != "report"]
        rep = persona.add_report(room, p, title, "\n\n".join(paras))
        sts, engine = await persona.extract_stances(room, p, rep)
        p.stances.extend(sts)
        p.touch()
        await orchestrator.after_persona_change(room_id)
        await hub.broadcast(room_id, {"type": "prep_update", "user_id": p.user_id, "event": "report",
                                      "engine": engine})
    elif kind == "interview":
        p = room.personas[step["uid"]]
        qs = interview.plan(room, p)
        await hub.broadcast(room_id, {"type": "prep_update", "user_id": p.user_id, "event": "plan"})
        for q in qs:
            ans = seed.MINSU_INTERVIEW_ANSWERS.get(q.issue_id, "")
            if not ans:
                continue
            await _emit(room_id, step=f"인터뷰: {q.question[:40]}…  → \"{ans}\"")
            await _sleep(room_id, 1.4)
            _, st, engine = await interview.answer(room, p, q.id, ans)
            await hub.broadcast(room_id, {"type": "prep_update", "user_id": p.user_id, "event": "answer",
                                          "engine": engine})
            await _sleep(room_id, 1.2)
            if st:
                interview.confirm(p, st.id, True)
            await orchestrator.after_persona_change(room_id)
            await hub.broadcast(room_id, {"type": "prep_update", "user_id": p.user_id, "event": "confirm"})
    elif kind == "away":
        p = room.personas[step["uid"]]
        await _emit(room_id, step=f"{p.name}: 대리 참석 {'ON' if step['on'] else 'OFF'}")
        await orchestrator.set_away(room_id, step["uid"], step["on"])
    elif kind == "say":
        p = room.personas[step["uid"]]
        await _emit(room_id, step=f"{p.name}: {step['text']}")
        hub.set_typing(room_id, step["uid"], True)
        await hub.broadcast(room_id, {"type": "typing", "user_id": step["uid"], "mini": False, "on": True})
        await _sleep(room_id, min(2.2, 0.5 + len(step["text"]) * 0.025))
        await hub.broadcast(room_id, {"type": "typing", "user_id": step["uid"], "mini": False, "on": False})
        _, task = await orchestrator.handle_human(room_id, step["uid"], step["text"])
        await task
    elif kind == "verify":
        target = next((m for m in reversed(room.messages) if m.kind == "human" and step["match"] in m.text), None)
        if target:
            await _emit(room_id, step=f"{room.personas[step['uid']].name}: 내 미니미에게 2차 검증 맡기기")
            await orchestrator.request_verify(room_id, step["uid"], target.id)
    elif kind == "engine":
        st = state(room_id)
        if step["force_rule"]:
            st["forced_by_demo"] = not llm.force_rule()
            llm.set_force_rule(True)
            await _emit(room_id, step="모델 끄기 → 모든 단계가 규칙으로 대체")
        elif st.get("forced_by_demo"):
            llm.set_force_rule(False)
            st["forced_by_demo"] = False
            await _emit(room_id, step="모델 다시 켜기")
    elif kind == "end":
        await _emit(room_id, step="회의 종료 → 쟁점별 회의록 정리")
        await orchestrator.end_meeting(room_id)
    elif kind == "decide":
        uid = step["uid"]
        d = next((x for x in room.decisions if uid in x.affected and step["match"] in x.text
                  and uid not in x.responses), None)
        if d:
            await _emit(room_id, step=f"{room.personas[uid].name}: '{d.text[:24]}…' {'승인' if step['action'] == 'approve' else '이의'}")
            await orchestrator.respond_decision(room_id, uid, d.id, step["action"], step.get("note", ""))
    elif kind == "answer_q":
        p = room.personas[step["uid"]]
        q = next((x for x in p.questions if x.status == "open" and step["match"] in x.text), None)
        if q:
            await _emit(room_id, step=f"{p.name}: 미니미가 남긴 질문에 답하기")
            await orchestrator.answer_question(room_id, step["uid"], q.id, step["text"], share=True)
    await asyncio.sleep(0)


def snapshot(room_id: str) -> dict:
    return {**state(room_id), "scenes": scenes_public(), "ts": time.time()}
