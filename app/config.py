"""환경변수와 상수. 모델 교체(로컬 → API)는 이 파일과 .env만 바꾸면 된다."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _f(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


def _list(name: str, default: str) -> list[str]:
    return [x.strip().lower() for x in os.getenv(name, default).split(",") if x.strip()]


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data"))
PROMPT_DIR = ROOT / "prompts"

# ---------------------------------------------------------------- LLM 엔진 순서
# 앞에서부터 시도하고, 실패(시간 초과·연결 끊김·형식 오류)하면 다음으로 넘어간다.
# 마지막 rule은 항상 붙는다(모델이 전부 죽어도 회의는 계속된다).
#   로컬만:        LLM_ORDER=ollama
#   로컬 → API:    LLM_ORDER=ollama,api     (기본)
#   API만:         LLM_ORDER=api
#   규칙만(시연):  LLM_ORDER=rule
LLM_ORDER = [x for x in _list("LLM_ORDER", "ollama,api") if x in ("ollama", "api", "rule")]

# 로컬 Ollama (네이티브 /api/chat: JSON 스키마 강제 + 생각 모드 끄기 + 모델 상주)
OLLAMA_BASE = os.getenv("OLLAMA_BASE", os.getenv("LLM_BASE", "http://localhost:11434")).rstrip("/")
if OLLAMA_BASE.endswith("/v1"):           # v3 문서의 OpenAI 호환 주소를 넣어도 동작하게
    OLLAMA_BASE = OLLAMA_BASE[:-3]
FAST_MODEL = os.getenv("FAST_MODEL", "qwen3.5:4b")      # 빠른 레인: 개입 판단
SLOW_MODEL = os.getenv("SLOW_MODEL", "qwen3.5:9b")      # 생각 레인: 발언·검증·회의록
EMBED_MODEL = os.getenv("EMBED_MODEL", "bge-m3")        # 검색 임베딩 (없으면 내장 n-gram 벡터)
OLLAMA_KEEP_ALIVE = os.getenv("OLLAMA_KEEP_ALIVE", "30m")

# 클라우드 API (OpenAI 호환이면 무엇이든: OpenAI, Groq, Gemini, OpenRouter, vLLM, LM Studio ...)
API_BASE = os.getenv("API_BASE", "https://api.openai.com/v1").rstrip("/")
API_KEY = os.getenv("API_KEY", os.getenv("LLM_KEY", os.getenv("OPENAI_API_KEY", "")))
API_FAST_MODEL = os.getenv("API_FAST_MODEL", os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
API_SLOW_MODEL = os.getenv("API_SLOW_MODEL", os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
API_JSON_MODE = os.getenv("API_JSON_MODE", "1") != "0"  # response_format 미지원 서비스면 0

# 레인별 시간 제한(초). API는 네트워크 왕복이 있어 조금 넉넉하게.
FAST_TIMEOUT = _f("FAST_TIMEOUT", 2.5)
SLOW_TIMEOUT = _f("SLOW_TIMEOUT", 30)
API_FAST_TIMEOUT = _f("API_FAST_TIMEOUT", 6)
API_SLOW_TIMEOUT = _f("API_SLOW_TIMEOUT", 30)
EMBED_TIMEOUT = _f("EMBED_TIMEOUT", 8)

# 서킷 브레이커: 연속 N번 실패하면 일정 시간 그 엔진을 건너뛴다.
BREAKER_FAILS = int(_f("BREAKER_FAILS", 3))
BREAKER_COOLDOWN = _f("BREAKER_COOLDOWN", 45)

# ---------------------------------------------------------------- 개입 게이트 (M2)
GATE_MODE = os.getenv("GATE_MODE", "hybrid").lower()     # rule | hybrid | llm  (후보 A / C / D)
GATE_HIGH = _f("GATE_HIGH", 0.42)      # 이 이상이면 규칙만으로 '말한다'
GATE_LOW = _f("GATE_LOW", 0.22)        # 이 이하면 규칙만으로 '침묵'. 사이 구간만 모델에게 묻는다
GATE_MID = _f("GATE_MID", 0.32)        # 모델이 없을 때 사이 구간의 기준
COOLDOWN_SEC = _f("COOLDOWN_SEC", 12)  # 같은 미니미가 다시 말하기까지 최소 간격
TYPING_WAIT_SEC = _f("TYPING_WAIT_SEC", 2.5)  # 사람이 입력 중이면 이만큼까지 기다린다

# ---------------------------------------------------------------- 근거 (M1)
EVIDENCE_MIN = _f("EVIDENCE_MIN", 0.35)       # 이 점수 아래면 말하지 않는다 (eval/eval.py --sweep 으로 정함)
SUPPORT_MIN = _f("SUPPORT_MIN", 0.18)         # 핵심어 검사(NLI를 못 쓸 때)의 최소 일치도
# 근거 검증: 미니미 문장의 사실 부분(core)을 인용 문단이 함의하는지 NLI 모델로 판정 (app/nli.py)
VERIFY_MODE = os.getenv("VERIFY_MODE", "auto").lower()   # auto | nli | lexical | off
VERIFY_THRESHOLD = _f("VERIFY_THRESHOLD", 0.5)           # 함의 확률이 이 아래면 그 문장을 지운다
NLI_MODEL = os.getenv("NLI_MODEL", "MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7")
TONE_SLACK = int(_f("TONE_SLACK", 25))                   # 말투 문장(text)이 사실 부분(core)보다 길어도 되는 글자 수
RETRIEVAL_METHOD = os.getenv("RETRIEVAL_METHOD", "hybrid").lower()   # hybrid | bm25 | vector (eval로 비교해 고른다)

# ---------------------------------------------------------------- 안건 이탈 (M4)
DRIFT_THRESHOLD = _f("DRIFT_THRESHOLD", 0.80)  # 안건 거리(0~1). 이 위가 K턴 이어지면 상기
DRIFT_K = int(_f("DRIFT_K", 2))
DRIFT_COOLDOWN_SEC = _f("DRIFT_COOLDOWN_SEC", 40)

# ---------------------------------------------------------------- 기타
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")
SHORT_TERM_N = int(_f("SHORT_TERM_N", 24))
PUBLIC_URL = os.getenv("PUBLIC_URL", "").rstrip("/")   # QR 초대 링크에 쓸 주소 (비우면 자동)
ALLOW_ORIGINS = [x.strip() for x in os.getenv("ALLOW_ORIGINS", "*").split(",") if x.strip()]
MAX_MEMBERS = int(_f("MAX_MEMBERS", 8))
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "0301")   # 방 관리(목록·초기화·삭제) 비밀번호
