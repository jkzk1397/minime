"""근거 검증(NLI) 테스트. 실제 mDeBERTa 대신 가짜 함의 확률을 주입한다.

- text(말투)와 core(사실)를 나눠 core만 검증한다
- 코드 가드: 말투 문장의 숫자·영문 단어가 사실 부분·자료를 넘지 못한다
- 함의 확률 < 기준이면 지우고, 여러 문단 인용은 합친 전제로도 잰다
- NLI를 못 쓰면 핵심어 검사로 대신한다 (회의는 멈추지 않는다)
"""
import asyncio

import pytest

from app import config, nli, persona
from app.retrieval import Chunk

P_SERVER = "서버 구현은 2주 정도 걸릴 것 같다. 프론트는 1주면 된다."
P_SURVEY = "만족도 조사 응답은 812명이었다."
P_BOOTH = "동아리 부스 만족도는 4.2점이었다."

FAKE = {  # (전제에 들어 있는 단서, 가설) → 함의 확률
    ("2주", "서버 구현에 2주쯤 걸린다"): 0.997,
    ("2주", "서버 구현은 금방 끝난다"): 0.02,
}


def _pool(*texts):
    return {f"보고서 {i + 1}문단": Chunk(f"u:p{i}", "u", "report", f"보고서 {i + 1}문단", t)
            for i, t in enumerate(texts)}


@pytest.fixture
def fake_nli(monkeypatch):
    calls = []

    def batch(pairs):
        out = []
        for prem, hyp in pairs:
            calls.append((prem, hyp))
            if "812명" in hyp and "4.2점" in hyp:          # 두 문단을 합쳐야 성립
                out.append(0.93 if ("812명" in prem and "4.2점" in prem) else 0.1)
                continue
            out.append(max([v for (cue, h), v in FAKE.items() if h == hyp and cue in prem] or [0.05]))
        return out

    monkeypatch.setitem(nli._state, "status", "ready")
    monkeypatch.setattr(nli, "_entail_batch", batch)
    monkeypatch.setattr(config, "VERIFY_MODE", "auto")
    return calls


def _check(raw, pool):
    return asyncio.run(persona.check_citations(raw, pool))


def test_entailed_core_passes_and_contradiction_is_dropped(fake_nli):
    pool = _pool(P_SERVER)
    kept, dropped, checks = _check([
        {"text": "제가 보기엔 서버 구현에 2주쯤 걸려요", "core": "서버 구현에 2주쯤 걸린다", "cites": ["보고서 1문단"]},
        {"text": "서버는 금방 끝나요", "core": "서버 구현은 금방 끝난다", "cites": ["보고서 1문단"]},
    ], pool)
    assert [k["core"] for k in kept] == ["서버 구현에 2주쯤 걸린다"]
    assert dropped == 1 and kept[0]["verifier"] == "nli" and kept[0]["support"] > 0.9
    assert "함의 확률" in checks[1]["reason"]


def test_tone_is_not_verified_but_cannot_add_numbers(fake_nli):
    pool = _pool(P_SERVER)
    kept, dropped, checks = _check([
        {"text": "솔직히 걱정되네요, 서버 구현에 2주쯤 걸려요", "core": "서버 구현에 2주쯤 걸린다", "cites": ["보고서 1문단"]},
        {"text": "서버 구현에 2주쯤, 테스트까지 3주 걸려요", "core": "서버 구현에 2주쯤 걸린다", "cites": ["보고서 1문단"]},
        {"text": "서버 구현에 2주쯤 걸려요, Redis까지 쓰면요", "core": "서버 구현에 2주쯤 걸린다", "cites": ["보고서 1문단"]},
    ], pool)
    assert len(kept) == 1 and dropped == 2
    assert checks[1]["method"] == "guard" and "숫자" in checks[1]["reason"]
    assert checks[2]["method"] == "guard" and "영문" in checks[2]["reason"]


def test_core_numbers_must_exist_in_cited_source(fake_nli):
    kept, dropped, checks = _check([
        {"text": "서버는 1주 안에 끝나요", "core": "서버는 5주 안에 끝난다", "cites": ["보고서 1문단"]}], _pool(P_SERVER))
    assert not kept and checks[0]["method"] == "guard"


def test_multi_cite_uses_combined_premise(fake_nli):
    pool = _pool(P_SURVEY, P_BOOTH)
    core = "812명이 답한 조사에서 부스 만족도는 4.2점이었다"
    kept, dropped, _ = _check([{"text": core, "core": core, "cites": ["보고서 1문단", "보고서 2문단"]}], pool)
    assert len(kept) == 1 and dropped == 0
    assert any("812명" in p and "4.2점" in p for p, _ in fake_nli)      # 합친 전제로 쟀다


def test_long_premise_is_split_into_sentence_windows():
    long = " ".join(f"문장 {i}번은 아무 관련이 없는 내용을 길게 늘어놓은 문장이다." for i in range(15)) + " 서버 구현은 2주 걸린다."
    wins = nli._windows(long)
    assert len(wins) > 1 and all(len(w) <= nli._MAX_CHARS * 2 for w in wins)
    assert any("서버 구현은 2주" in w for w in wins)


def test_missing_core_falls_back_to_text(fake_nli):
    kept, _, _ = _check([{"text": "서버 구현에 2주쯤 걸린다", "cites": ["보고서 1문단"]}], _pool(P_SERVER))
    assert kept and kept[0]["core"] == "서버 구현에 2주쯤 걸린다"


def test_lexical_fallback_when_nli_unavailable(monkeypatch):
    monkeypatch.setitem(nli._state, "status", "failed")
    monkeypatch.setattr(config, "VERIFY_MODE", "auto")
    kept, dropped, checks = _check([
        {"text": "동아리 부스 만족도는 4.2점이었어요", "core": "동아리 부스 만족도는 4.2점이었다", "cites": ["보고서 1문단"]},
        {"text": "다들 좋아했어요", "core": "학생들이 모두 좋아했다", "cites": ["보고서 1문단"]},
    ], _pool(P_BOOTH))
    assert nli.method() == "lexical" and len(kept) == 1 and dropped == 1
    assert kept[0]["verifier"] == "lexical"


def test_uncited_sentence_is_dropped(fake_nli):
    kept, dropped, checks = _check([{"text": "서버 구현에 2주쯤 걸린다", "cites": ["보고서 9문단"]}], _pool(P_SERVER))
    assert not kept and checks[0]["reason"] == "출처 없음"


def test_status_reports_method(monkeypatch):
    monkeypatch.setitem(nli._state, "status", "loading")
    monkeypatch.setattr(config, "VERIFY_MODE", "auto")
    assert nli.status()["method"] == "lexical"
    monkeypatch.setattr(config, "VERIFY_MODE", "off")
    assert nli.method() == "off"
