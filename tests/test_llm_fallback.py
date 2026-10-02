"""엔진 하네스: 로컬(Ollama) → API → 규칙 대체, 형식 오류 재시도, 서킷 브레이커, 출처 검사."""
import asyncio
import time

import pytest

from app import config, llm, persona, seed
from app.models import Message

SCHEMA = {"type": "object", "required": ["text"], "properties": {"text": {"type": "string"}}}


@pytest.fixture
def engines(fake_llm, monkeypatch):
    monkeypatch.setattr(config, "LLM_ORDER", ["ollama", "api"])
    monkeypatch.setattr(config, "OLLAMA_BASE", fake_llm["url"])
    monkeypatch.setattr(config, "API_BASE", fake_llm["url"] + "/v1")
    monkeypatch.setattr(config, "API_KEY", "test")
    monkeypatch.setattr(config, "BREAKER_FAILS", 3)
    for e in llm.ENGINES.values():
        e.reachable = None
        for st in e.lanes.values():
            st.open_until = 0
            st.consecutive_fail = 0
    llm.set_force_rule(False)
    fake_llm["state"].update(mode="ok", calls=[], bad_once_done=False)
    yield fake_llm["state"]
    llm.set_force_rule(False)


def call():
    return asyncio.run(llm.call_json("t", "slow", "시스템", "사용자", SCHEMA))


def test_local_first(engines):
    asyncio.run(llm.probe())
    data, eng = call()
    assert eng == "ollama:qwen3.5:9b" and data["text"]
    assert engines["calls"][-1]["kind"] == "ollama"


def test_bad_json_retried_once(engines):
    engines["mode"] = "bad_json_once"
    data, eng = call()
    assert eng.startswith("ollama") and len([c for c in engines["calls"] if c["kind"] == "ollama"]) == 2


def test_falls_back_to_api_then_rule(engines, monkeypatch):
    monkeypatch.setattr(config, "OLLAMA_BASE", "http://127.0.0.1:9")       # 로컬 모델이 죽음
    data, eng = call()
    assert eng.startswith("api:")
    engines["mode"] = "error"                                               # API도 실패
    data, eng = call()
    assert data is None and eng == "rule"


def test_circuit_breaker(engines, monkeypatch):
    monkeypatch.setattr(config, "LLM_ORDER", ["api"])
    engines["mode"] = "error"
    for _ in range(3):
        call()
    assert llm.ENGINES["api"].lanes["slow"].open_until > time.time()
    n = len(engines["calls"])
    assert call() == (None, "rule") and len(engines["calls"]) == n        # 열려 있으면 부르지도 않는다


def test_force_rule_switch(engines):
    llm.set_force_rule(True)
    assert call() == (None, "rule") and not engines["calls"]
    assert llm.status()["force_rule"]


def test_citation_check_drops_hallucination(engines):
    room = seed.fresh_room("t-llm")
    msg = Message("human", "나는 A안이 현실적이라고 봐", "jongwon", issue_id="i1")
    room.messages.append(msg)

    async def go():
        idx = await persona.get_index(room, "dongjun")
        hits = await idx.search(msg.text, k=5)
        return await persona.compose(room, "dongjun", msg, "rebuttal", "i1", hits)
    out = asyncio.run(go())
    assert out["engine"].startswith("ollama")
    assert out["dropped"] == 1                                              # '화성 이주' 문장은 지워진다
    assert "화성" not in out["text"] and out["citations"]
