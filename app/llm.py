"""LLM 엔진 하네스.

엔진 순서(config.LLM_ORDER)대로 시도한다:  로컬 Ollama → OpenAI 호환 API → 규칙(rule).
- 레인 2개: fast(개입 판단, 짧은 출력) / slow(발언·검증·회의록)
- 단계별 시간 제한, 형식 오류 1회 재시도, 연속 실패 시 서킷 브레이커(일정 시간 건너뜀)
- 모든 호출을 추적(엔진·지연·토큰)해 대시보드의 '엔진' 탭에 보여 준다
- 모든 엔진이 실패하면 (None, "rule")을 돌려준다. 호출한 쪽이 규칙 결과를 쓴다 → 회의는 멈추지 않는다
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from collections import OrderedDict, deque
from dataclasses import dataclass, field
from string import Template
from typing import Any

import httpx

from . import config

RULE = "rule"


# ---------------------------------------------------------------- 프롬프트 파일
_prompt_cache: dict[str, tuple[str, str, str]] = {}


def prompt(prompt_name: str, /, **values: Any) -> tuple[str, str, str]:
    """prompts/{prompt_name}.md 를 읽어 (system, user, version)을 만든다. 자리표시자는 $name 형식."""
    name = prompt_name
    if name not in _prompt_cache:
        raw = (config.PROMPT_DIR / f"{name}.md").read_text(encoding="utf-8")
        m = re.search(r"<!--\s*version:\s*([^\s>]+)\s*-->", raw)
        version = m.group(1) if m else "v0"
        raw = re.sub(r"<!--.*?-->\s*", "", raw, flags=re.S)
        system, _, user = raw.partition("---USER---")
        _prompt_cache[name] = (system.strip(), user.strip(), version)
    system, user, version = _prompt_cache[name]
    vals = {k: (v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)) for k, v in values.items()}
    return Template(system).safe_substitute(vals), Template(user).safe_substitute(vals), version


# ---------------------------------------------------------------- JSON 처리
def _strip_think(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text or "", flags=re.S).strip()


def _extract_json(text: str) -> Any:
    text = _strip_think(text)
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start:end + 1])
    raise ValueError("JSON 없음")


_TYPES = {"string": str, "array": list, "object": dict, "boolean": bool, "number": (int, float), "integer": int}


def _check(schema: dict, data: Any, path: str = "$") -> None:
    """가벼운 JSON 스키마 검사 (type / required / properties / items / enum)."""
    t = schema.get("type")
    if t:
        py = _TYPES.get(t)
        if py and not isinstance(data, py) or (t in ("number", "integer") and isinstance(data, bool)):
            raise ValueError(f"{path}: {t} 아님")
    if "enum" in schema and data not in schema["enum"]:
        raise ValueError(f"{path}: 허용되지 않은 값 {data!r}")
    if isinstance(data, dict):
        for k in schema.get("required", []):
            if k not in data:
                raise ValueError(f"{path}.{k} 누락")
        for k, sub in schema.get("properties", {}).items():
            if k in data and data[k] is not None:
                _check(sub, data[k], f"{path}.{k}")
    if isinstance(data, list) and "items" in schema:
        for i, item in enumerate(data):
            _check(schema["items"], item, f"{path}[{i}]")


# ---------------------------------------------------------------- 엔진
@dataclass
class LaneStat:
    lat: deque = field(default_factory=lambda: deque(maxlen=60))
    ok: int = 0
    fail: int = 0
    consecutive_fail: int = 0
    open_until: float = 0.0
    last_error: str = ""

    def p(self, q: float) -> float | None:
        if not self.lat:
            return None
        xs = sorted(self.lat)
        return round(xs[min(len(xs) - 1, int(q * (len(xs) - 1) + 0.5))], 2)


class Engine:
    name = ""

    def __init__(self) -> None:
        self.lanes = {"fast": LaneStat(), "slow": LaneStat()}
        self.reachable: bool | None = None   # None = 아직 모름
        self.reason = ""

    def model(self, lane: str) -> str:
        raise NotImplementedError

    def configured(self) -> bool:
        return True

    def timeout(self, lane: str) -> float:
        raise NotImplementedError

    def usable(self, lane: str) -> bool:
        if not self.configured() or self.reachable is False:
            return False
        return time.time() >= self.lanes[lane].open_until

    async def chat(self, lane: str, system: str, user: str, schema: dict, temperature: float,
                   max_tokens: int) -> tuple[str, int, int]:
        raise NotImplementedError

    def record(self, lane: str, ok: bool, ms: float, error: str = "") -> None:
        st = self.lanes[lane]
        if ok:
            st.ok += 1
            st.consecutive_fail = 0
            st.lat.append(ms / 1000)
            st.last_error = ""
        else:
            st.fail += 1
            st.consecutive_fail += 1
            st.last_error = error[:160]
            if st.consecutive_fail >= config.BREAKER_FAILS:
                st.open_until = time.time() + config.BREAKER_COOLDOWN
                st.consecutive_fail = 0


class OllamaEngine(Engine):
    name = "ollama"

    def __init__(self) -> None:
        super().__init__()
        self.installed: set[str] = set()
        self.no_think: set[str] = set()     # think 파라미터를 지원하지 않는 모델

    def model(self, lane: str) -> str:
        return config.FAST_MODEL if lane == "fast" else config.SLOW_MODEL

    def timeout(self, lane: str) -> float:
        return config.FAST_TIMEOUT if lane == "fast" else config.SLOW_TIMEOUT

    def usable(self, lane: str) -> bool:
        if self.installed and not _has_model(self.installed, self.model(lane)):
            return False
        return super().usable(lane)

    async def chat(self, lane, system, user, schema, temperature, max_tokens):
        model = self.model(lane)
        body: dict[str, Any] = {
            "model": model, "stream": False, "keep_alive": config.OLLAMA_KEEP_ALIVE,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "format": schema, "options": {"temperature": temperature, "num_predict": max_tokens},
        }
        if model not in self.no_think:
            body["think"] = False
        r = await _http().post(f"{config.OLLAMA_BASE}/api/chat", json=body, timeout=self.timeout(lane))
        if r.status_code == 400 and "think" in r.text and "think" in body:
            self.no_think.add(model)
            body.pop("think")
            r = await _http().post(f"{config.OLLAMA_BASE}/api/chat", json=body, timeout=self.timeout(lane))
        r.raise_for_status()
        d = r.json()
        return d.get("message", {}).get("content", ""), d.get("prompt_eval_count", 0), d.get("eval_count", 0)


class ApiEngine(Engine):
    name = "api"

    def __init__(self) -> None:
        super().__init__()
        self.json_mode = config.API_JSON_MODE

    def configured(self) -> bool:
        return bool(config.API_KEY) or not config.API_BASE.startswith("https://api.openai.com")

    def model(self, lane: str) -> str:
        return config.API_FAST_MODEL if lane == "fast" else config.API_SLOW_MODEL

    def timeout(self, lane: str) -> float:
        return config.API_FAST_TIMEOUT if lane == "fast" else config.API_SLOW_TIMEOUT

    async def chat(self, lane, system, user, schema, temperature, max_tokens):
        body: dict[str, Any] = {
            "model": self.model(lane), "temperature": temperature, "max_tokens": max_tokens,
            "messages": [
                {"role": "system", "content": system + "\n\n반드시 다음 JSON 스키마를 따르는 JSON 객체 하나만 출력하세요:\n"
                 + json.dumps(schema, ensure_ascii=False)},
                {"role": "user", "content": user},
            ],
        }
        if self.json_mode:
            body["response_format"] = {"type": "json_object"}
        headers = {"Authorization": f"Bearer {config.API_KEY}"} if config.API_KEY else {}
        url = f"{config.API_BASE}/chat/completions"
        r = await _http().post(url, json=body, headers=headers, timeout=self.timeout(lane))
        if r.status_code == 400 and "response_format" in r.text and self.json_mode:
            self.json_mode = False          # JSON 모드 미지원 서비스 → 프롬프트만으로
            body.pop("response_format", None)
            r = await _http().post(url, json=body, headers=headers, timeout=self.timeout(lane))
        r.raise_for_status()
        d = r.json()
        usage = d.get("usage") or {}
        return (d["choices"][0]["message"].get("content") or "", usage.get("prompt_tokens", 0),
                usage.get("completion_tokens", 0))


def _has_model(installed: set[str], model: str) -> bool:
    return model in installed or f"{model}:latest" in installed or any(m.split(":")[0] == model for m in installed)


_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=30)
    return _client


ENGINES: dict[str, Engine] = {"ollama": OllamaEngine(), "api": ApiEngine()}
_force_rule = config.LLM_ORDER == [RULE] or not config.LLM_ORDER
_trace: deque = deque(maxlen=80)
_listeners: list = []          # 상태가 바뀌면 알릴 콜백 (main에서 방송용으로 등록)


def order() -> list[str]:
    return [x for x in config.LLM_ORDER if x in ENGINES]


def set_force_rule(on: bool) -> None:
    """시연용 '모델 끄기' 스위치. 켜면 모든 호출이 즉시 규칙으로 대체된다."""
    global _force_rule
    _force_rule = on or config.LLM_ORDER == [RULE]
    _notify()


def force_rule() -> bool:
    return _force_rule


def _notify() -> None:
    for cb in list(_listeners):
        try:
            cb()
        except Exception:
            pass


async def call_json(task: str, lane: str, system: str, user: str, schema: dict, *,
                    temperature: float = 0.3, max_tokens: int = 500) -> tuple[Any, str]:
    """구조화 출력 호출. 성공하면 (data, '엔진:모델'), 모두 실패하면 (None, 'rule')."""
    if _force_rule:
        return None, RULE
    for name in order():
        eng = ENGINES[name]
        if not eng.usable(lane):
            continue
        sys_prompt = system
        for attempt in range(2):                     # 형식 오류면 1회 재시도
            t0 = time.perf_counter()
            entry = {"ts": time.time(), "task": task, "lane": lane, "engine": name, "model": eng.model(lane)}
            try:
                text, tin, tout = await eng.chat(lane, sys_prompt, user, schema, temperature, max_tokens)
                data = _extract_json(text)
                _check(schema, data)
                ms = (time.perf_counter() - t0) * 1000
                eng.record(lane, True, ms)
                eng.reachable = True
                _trace.append({**entry, "ms": round(ms), "ok": True, "tin": tin, "tout": tout, "retry": attempt})
                _notify()
                return data, f"{name}:{eng.model(lane)}"
            except asyncio.CancelledError:
                raise
            except (ValueError, json.JSONDecodeError, KeyError) as e:   # 형식 오류
                ms = (time.perf_counter() - t0) * 1000
                _trace.append({**entry, "ms": round(ms), "ok": False, "error": f"형식 오류: {e}"[:120], "retry": attempt})
                if attempt == 0:
                    sys_prompt = system + "\n\n[주의] 직전 출력이 JSON 형식에 맞지 않았습니다. 설명 없이 스키마에 맞는 JSON만 출력하세요."
                    continue
                eng.record(lane, False, ms, f"형식 오류: {e}")
            except Exception as e:                    # 시간 초과·연결 실패·HTTP 오류
                ms = (time.perf_counter() - t0) * 1000
                msg = "시간 초과" if isinstance(e, httpx.TimeoutException) else f"{type(e).__name__}: {e}"
                if isinstance(e, httpx.ConnectError):
                    eng.reachable = False
                    eng.reason = "연결 안 됨"
                eng.record(lane, False, ms, msg)
                _trace.append({**entry, "ms": round(ms), "ok": False, "error": msg[:120], "retry": attempt})
            break
        _notify()
    return None, RULE


# ---------------------------------------------------------------- 임베딩
_emb_cache: OrderedDict[str, list[float]] = OrderedDict()
_embed_ok: bool | None = None


def embed_available() -> bool:
    eng = ENGINES["ollama"]
    return (not _force_rule and "ollama" in order() and eng.reachable is True and _embed_ok is not False
            and (not eng.installed or _has_model(eng.installed, config.EMBED_MODEL)))


async def embed(texts: list[str]) -> list[list[float]] | None:
    """bge-m3 임베딩 (항상 로컬). 쓸 수 없으면 None → 검색은 내장 n-gram 벡터를 쓴다."""
    global _embed_ok
    if not texts or not embed_available():
        return None
    missing = [t for t in dict.fromkeys(texts) if t not in _emb_cache]
    if missing:
        try:
            r = await _http().post(f"{config.OLLAMA_BASE}/api/embed",
                                   json={"model": config.EMBED_MODEL, "input": missing,
                                         "keep_alive": config.OLLAMA_KEEP_ALIVE},
                                   timeout=config.EMBED_TIMEOUT)
            r.raise_for_status()
            for t, v in zip(missing, r.json()["embeddings"]):
                _emb_cache[t] = v
            _embed_ok = True
            while len(_emb_cache) > 6000:
                _emb_cache.popitem(last=False)
        except asyncio.CancelledError:
            raise
        except Exception:
            _embed_ok = False
            return None
    return [_emb_cache[t] for t in texts]


# ---------------------------------------------------------------- 상태 확인
async def probe() -> None:
    """Ollama가 살아 있는지, 모델이 설치됐는지 확인한다 (주기적으로 호출)."""
    global _embed_ok
    eng = ENGINES["ollama"]
    if "ollama" not in order():
        eng.reachable = False
        eng.reason = "LLM_ORDER에서 제외"
        return
    before = (eng.reachable, tuple(sorted(eng.installed)))
    try:
        r = await _http().get(f"{config.OLLAMA_BASE}/api/tags", timeout=1.5)
        r.raise_for_status()
        eng.installed = {m.get("name", "") for m in r.json().get("models", [])}
        eng.reachable = True
        missing = [m for m in (config.FAST_MODEL, config.SLOW_MODEL) if not _has_model(eng.installed, m)]
        eng.reason = ("미설치: " + ", ".join(missing)) if missing else ""
        if _embed_ok is False and _has_model(eng.installed, config.EMBED_MODEL):
            _embed_ok = None                          # 다시 시도해 볼 수 있게
    except Exception:
        eng.reachable = False
        eng.reason = "Ollama 연결 안 됨"
    if before != (eng.reachable, tuple(sorted(eng.installed))):
        _notify()


def active_label(lane: str) -> str:
    """지금 이 레인이 실제로 쓸 엔진 (대시보드 표시용)."""
    if _force_rule:
        return RULE
    for name in order():
        if ENGINES[name].usable(lane):
            return f"{name}:{ENGINES[name].model(lane)}"
    return RULE


def status() -> dict:
    engines = []
    for name in order():
        e = ENGINES[name]
        lanes = {}
        for lane, st in e.lanes.items():
            lanes[lane] = {"model": e.model(lane), "p50": st.p(0.5), "p95": st.p(0.95), "ok": st.ok, "fail": st.fail,
                           "breaker_open": time.time() < st.open_until, "last_error": st.last_error,
                           "usable": e.usable(lane)}
        engines.append({"name": name, "configured": e.configured(), "reachable": e.reachable, "reason": e.reason,
                        "lanes": lanes})
    return {
        "type": "status", "order": config.LLM_ORDER, "force_rule": _force_rule,
        "fast": active_label("fast"), "slow": active_label("slow"),
        "embed": config.EMBED_MODEL if embed_available() else "n-gram(내장)",
        "gate_mode": config.GATE_MODE, "engines": engines, "trace": list(_trace)[-25:],
    }
