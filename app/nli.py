"""근거 검증기: 미니미 문장의 사실 부분(core)을 인용 문단이 '함의'하는지 판정한다.

- NLI(자연어 추론): 전제(인용 문단)가 참이면 가설(core)도 참인가 → 함의 확률 0~1.
  발언을 만드는 모델(Qwen)과 검사하는 모델(mDeBERTa XNLI)이 달라서 스스로를 채점하지 않는다.
- 긴 문단은 문장 단위(1문장 · 이웃 2문장 창)로 나눠 가장 높은 확률을 쓴다 (모델 입력 길이 제한).
- 여러 문단을 인용한 문장은 문단을 합친 전제로도 한 번 더 잰다 (두 문단을 합쳐야 성립하는 문장).
- 모델이 없거나(패키지 미설치) 아직 불러오는 중이거나 실패하면 핵심어 일치 검사(lexical)로 대신한다.
  → 검증기가 없어도 회의는 멈추지 않는다.

VERIFY_MODE: auto(기본: NLI가 되면 NLI, 아니면 lexical) | nli | lexical | off
"""
from __future__ import annotations

import asyncio
import logging
import re
import threading

from . import config, ko
from .retrieval import lexical_support

log = logging.getLogger("minime")

_lock = threading.Lock()
_state = {"status": "idle", "error": ""}      # idle | loading | ready | failed | off
_model = None
_tok = None
_entail_idx = 0
_MAX_CHARS = 380                               # 이보다 긴 전제는 문장 단위로 나눠 잰다


def mode() -> str:
    return config.VERIFY_MODE if config.VERIFY_MODE in ("auto", "nli", "lexical", "off") else "auto"


def status() -> dict:
    """화면·/health 표시용. method: 지금 실제로 쓰는 검증 방식."""
    return {"mode": mode(), "nli": _state["status"], "method": method(), "model": config.NLI_MODEL,
            "threshold": config.VERIFY_THRESHOLD, "error": _state["error"]}


def method() -> str:
    m = mode()
    if m in ("off", "lexical"):
        return m
    return "nli" if _state["status"] == "ready" else "lexical"


def load() -> bool:
    """모델을 불러온다 (동기, 스레드에서 부른다). 실패하면 lexical로 대신한다."""
    global _model, _tok, _entail_idx
    if mode() in ("off", "lexical"):
        _state["status"] = "off"
        return False
    with _lock:
        if _state["status"] in ("ready", "failed"):
            return _state["status"] == "ready"
        _state["status"] = "loading"
        try:
            import torch  # noqa: F401
            from transformers import AutoModelForSequenceClassification, AutoTokenizer
            _tok = AutoTokenizer.from_pretrained(config.NLI_MODEL)
            _model = AutoModelForSequenceClassification.from_pretrained(config.NLI_MODEL)
            _model.eval()
            labels = {v.lower(): int(k) for k, v in _model.config.id2label.items()}
            _entail_idx = next((i for name, i in labels.items() if name.startswith("entail")), 0)
            _state["status"] = "ready"
            log.warning("근거 검증: NLI 모델 준비 완료 (%s)", config.NLI_MODEL)
            return True
        except Exception as e:                        # 패키지 없음 · 다운로드 실패 · 메모리 부족
            _state["status"], _state["error"] = "failed", f"{type(e).__name__}: {e}"[:200]
            lvl = logging.ERROR if mode() == "nli" else logging.INFO
            log.log(lvl, "근거 검증: NLI를 쓸 수 없어 핵심어 검사로 대신합니다 (%s)", _state["error"])
            return False


def warmup() -> str:
    load()
    return method()


def _windows(premise: str) -> list[str]:
    """긴 전제 → 1문장 · 이웃 2문장 창. 짧으면 그대로."""
    if len(premise) <= _MAX_CHARS:
        return [premise]
    ss = ko.sentences(premise) or [premise]
    out = list(ss) + [f"{a} {b}" for a, b in zip(ss, ss[1:])]
    return [w[: _MAX_CHARS * 2] for w in out]


def _entail_batch(pairs: list[tuple[str, str]]) -> list[float]:
    import torch
    enc = _tok([p for p, _ in pairs], [h for _, h in pairs], truncation=True, max_length=512,
               padding=True, return_tensors="pt")
    with torch.no_grad():
        probs = torch.softmax(_model(**enc).logits, dim=-1)[:, _entail_idx]
    return [float(x) for x in probs]


def entail_prob(premises: list[str], hypothesis: str) -> float:
    """전제 여러 개 중 가장 잘 뒷받침하는 쪽의 함의 확률. 둘 이상이면 합친 전제도 잰다."""
    cand = []
    for p in premises:
        cand += _windows(p)
    if len(premises) > 1:
        cand += _windows(" ".join(premises))
    cand = list(dict.fromkeys(c for c in cand if c.strip()))
    if not cand:
        return 0.0
    return max(_entail_batch([(c, hypothesis) for c in cand]))


# ---------------------------------------------------------------- 코드 가드 (말투가 사실을 넘지 못하게)
_DIGITS = re.compile(r"\d+(?:[.,]\d+)*")
_LATIN = re.compile(r"[A-Za-z][A-Za-z0-9\-]{1,}")


def _nums(t: str) -> set[str]:
    return {x.replace(",", "") for x in _DIGITS.findall(t)}


def _latin(t: str) -> set[str]:
    return {x.lower() for x in _LATIN.findall(t)}


def guard(text: str, core: str, premises: list[str]) -> str:
    """통과하면 "", 아니면 탈락 이유."""
    src = " ".join(premises)
    if _nums(text) - _nums(core):
        return "말투 문장에 사실 부분에 없는 숫자"
    if _nums(core) - _nums(src):
        return "인용 자료에 없는 숫자"
    if _latin(text) - _latin(core) - _latin(src):
        return "자료에 없는 영문 단어"
    if len(text) > len(core) + config.TONE_SLACK:
        return "말투 문장이 사실 부분보다 지나치게 김"
    return ""


async def check(text: str, core: str, premises: list[str]) -> dict:
    """한 문장 검증. 반환: {ok, score, method, reason}."""
    core = (core or text).strip()
    reason = guard(text, core, premises)
    if reason:
        return {"ok": False, "score": 0.0, "method": "guard", "reason": reason}
    m = method()
    if m == "off":
        return {"ok": True, "score": 1.0, "method": "off", "reason": ""}
    if m == "nli":
        try:
            p = await asyncio.to_thread(entail_prob, premises, core)
            return {"ok": p >= config.VERIFY_THRESHOLD, "score": round(p, 3), "method": "nli",
                    "reason": "" if p >= config.VERIFY_THRESHOLD else f"함의 확률 {p:.2f} < {config.VERIFY_THRESHOLD}"}
        except Exception as e:                    # 추론 중 오류 → 이번 문장은 핵심어 검사로
            log.warning("NLI 추론 실패, 핵심어 검사로 대신: %s", e)
    s = max((lexical_support(core, p) for p in premises), default=0.0)
    return {"ok": s >= config.SUPPORT_MIN, "score": round(s, 3), "method": "lexical",
            "reason": "" if s >= config.SUPPORT_MIN else f"핵심어 일치 {s:.2f} < {config.SUPPORT_MIN}"}
