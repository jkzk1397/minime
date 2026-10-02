"""LLM 어댑터. OPENAI_API_KEY가 없으면 MOCK 모드로 동작한다."""
from __future__ import annotations
import json
from . import config
from .models import Room, Message

_client = None


def client():
    global _client
    if _client is None:
        from openai import AsyncOpenAI
        _client = AsyncOpenAI(api_key=config.OPENAI_API_KEY)
    return _client


async def _json(system: str, user: str, temperature: float = 0.7) -> dict:
    r = await client().chat.completions.create(
        model=config.OPENAI_MODEL,
        temperature=temperature,
        response_format={"type": "json_object"},
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    )
    return json.loads(r.choices[0].message.content)


def history(room: Room, n: int = config.SHORT_TERM_N) -> str:
    out = []
    for m in room.messages[-n:]:
        if m.kind in ("human", "mini", "tool"):
            who = room.personas[m.user_id].name if m.user_id in room.personas else (m.user_id or "시스템")
            label = f"{who} 미니미" if m.kind == "mini" else (f"검색결과" if m.kind == "tool" else who)
            out.append(f"{label}: {m.text}")
    return "\n".join(out)


def persona_block(room: Room) -> str:
    lines = []
    for uid, p in room.personas.items():
        state = "자리 비움(미니미가 대리 참여)" if room.away.get(uid) else "참여 중"
        mem = " / ".join(p.memory[-5:]) or "-"
        lines.append(f"- {uid} ({p.name}, {p.role}) 말투: {p.tone} | 성향: {p.traits} | 장기기억: {mem} | 상태: {state}")
    return "\n".join(lines)


# ---------------------------------------------------------------- scoring
async def score(room: Room) -> dict:
    """각 미니미가 지금 끼어들어야 하는 정도(0~1)와 이유."""
    if config.MOCK:
        return _mock_score(room)
    system = ("당신은 회의 오케스트레이터입니다. 마지막 메시지에 각 사람의 AI 미니미가 얼마나 반응해야 하는지 0~1로 평가합니다. "
              "이미 충분히 논의됐거나 자기 주인과 무관하면 낮게, 질문받았거나 전문 분야면 높게 줍니다. "
              '출력 JSON: {"scores":{"<user_id>":0.0},"why":"한 문장 이유"}')
    user = f"[안건] {room.agenda or '미정'}\n[인물]\n{persona_block(room)}\n[최근 대화]\n{history(room)}"
    d = await _json(system, user, 0.2)
    return {"scores": {k: float(v) for k, v in d.get("scores", {}).items()}, "why": d.get("why", "")}


# ---------------------------------------------------------------- reply
async def reply(room: Room, uid: str, proxy: bool) -> dict:
    """미니미 발언 생성. {"text": str, "search": str|None}"""
    p = room.personas[uid]
    if config.MOCK:
        return _mock_reply(room, uid, proxy)
    system = (f"당신은 '{p.name}'의 AI 미니미입니다. {p.name}의 말투와 성향으로 회의 채팅방에 한국어 구어체 1~2문장으로 발언합니다.\n"
              f"말투: {p.tone}\n성향: {p.traits}\n장기기억: {' / '.join(p.memory[-5:]) or '-'}\n"
              + ("주인이 자리를 비웠습니다. 주인이 이전에 한 말을 근거로 대신 의견을 전하고, 근거 없는 약속은 하지 않습니다.\n" if proxy else "")
              + "이미 나온 말을 반복하지 말고, 질문/반박/보완/동의 중 하나를 하세요. 사실 확인이 꼭 필요하면 search에 검색어를 넣으세요(아니면 null).\n"
              '출력 JSON: {"text":"...","search":null}')
    user = f"[안건] {room.agenda or '미정'}\n[최근 대화]\n{history(room)}"
    d = await _json(system, user, 0.8)
    return {"text": str(d.get("text", "")).strip(), "search": d.get("search") or None}


async def expand(room: Room, uid: str, brief: str) -> str:
    """사람이 한 줄만 말하면 미니미가 말투에 맞게 풀어서 올린다."""
    p = room.personas[uid]
    if config.MOCK:
        return f'{p.name}이(가) "{brief}"라고 했어. 사용자 입장에서 이해되는지를 기준으로 보고 있고, 구현 가능한 범위인지도 같이 보자는 뜻이야.'
    system = (f"당신은 '{p.name}'의 AI 미니미입니다. {p.name}이(가) 한 줄로 던진 말을 {p.name}의 말투로 2~3문장으로 풀어 채팅방에 올립니다. "
              f"{p.name}이(가) 하지 않은 주장은 추가하지 마세요.\n말투: {p.tone}\n성향: {p.traits}\n"
              '출력 JSON: {"text":"..."}')
    d = await _json(system, f"[최근 대화]\n{history(room, 12)}\n[{p.name}의 한 줄] {brief}", 0.6)
    return str(d.get("text", brief)).strip()


async def digest(room: Room, uid: str, missed: list[Message]) -> str:
    """부재 중 요약."""
    if config.MOCK:
        return f"부재 중 {len(missed)}개의 메시지가 오갔습니다. (MOCK 요약) 미니미가 당신의 기준으로 의견을 전달했습니다."
    body = "\n".join(f"{room.personas[m.user_id].name if m.user_id in room.personas else '시스템'}"
                     f"{' 미니미' if m.kind == 'mini' else ''}: {m.text}" for m in missed if m.kind in ("human", "mini", "tool"))
    d = await _json("자리를 비웠던 사람에게 줄 요약을 한국어로 작성합니다. 결정된 것, 열린 질문, 본인 미니미가 대신 말한 내용 순서로 3~5줄. "
                    '출력 JSON: {"text":"..."}', f"[요약 대상] {room.personas[uid].name}\n[부재 중 대화]\n{body}", 0.3)
    return str(d.get("text", "")).strip()


async def minutes(room: Room) -> dict:
    """회의 결과 정리."""
    if config.MOCK:
        return {"agenda": room.agenda or "미정", "opinions": ["(MOCK) 주요 의견"], "conflicts": ["(MOCK) 의견 충돌"],
                "conclusion": "(MOCK) 결론"}
    d = await _json("회의 대화를 읽고 결과를 정리합니다. 출력 JSON: "
                    '{"agenda":"...","opinions":["..."],"conflicts":["..."],"conclusion":"..."}',
                    f"[안건] {room.agenda or '미정'}\n[대화]\n{history(room, 80)}", 0.2)
    return d


# ---------------------------------------------------------------- mock
_KW = {
    "jihyun": ["ui", "화면", "디자인", "ux", "데모", "사용자", "첫인상"],
    "minsu": ["개발", "구현", "일정", "범위", "api", "서버", "난이도", "websocket", "소켓"],
    "jongwon": ["기획", "방향", "범위", "결론", "정리", "안건"],
}


def _mock_score(room: Room) -> dict:
    last = next((m for m in reversed(room.messages) if m.kind in ("human", "mini", "tool")), None)
    text = (last.text if last else "").lower()
    scores = {}
    for uid in room.personas:
        kws = _KW.get(uid, [])
        hit = sum(1 for k in kws if k in text)
        scores[uid] = min(0.95, 0.35 + 0.25 * hit)
        if last and last.kind == "mini" and last.user_id == uid:
            scores[uid] = 0.0
    return {"scores": scores, "why": "(MOCK) 키워드 일치도 기반 점수"}


def _mock_reply(room: Room, uid: str, proxy: bool) -> dict:
    p = room.personas[uid]
    prefix = f"{p.name}이(가) 자리를 비워서 대신 말할게. " if proxy else ""
    n = sum(1 for m in room.messages if m.kind == "mini" and m.user_id == uid)
    lines = {
        "minsu": ["범위가 걱정이야. 핵심만 먼저 가면 가능할 듯.", "WebSocket이 기본 지원인지 확인이 필요해.", "그 정도면 구현 가능할 듯."],
        "jihyun": ["화면에서 바로 보이는지가 중요할 듯! 데모 장면부터 잡아볼게.", "채팅 화면이랑 상태 표시부터 만들자.", "그 방향 좋을 듯!"],
        "jongwon": ["핵심 장면 하나에 집중하자. 범위는 줄이는 게 어때?", "정리하면 이 방향으로 가자.", "그럼 이대로 결론 내자."],
    }.get(uid, ["의견을 보탤게."])
    search = "FastAPI WebSocket 지원 여부" if uid == "minsu" and n == 1 else None
    return {"text": prefix + lines[min(n, len(lines) - 1)], "search": search}
