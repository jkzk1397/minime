# MyMini backend (FastAPI + WebSocket)

사람과 AI 미니미가 한 방에서 회의하는 서버입니다. 키가 없으면 MOCK 모드로 돌아가서 바로 시연할 수 있습니다.

> **"내가 회의에 못 가도, 내 미니미는 회의에 간다."**

## 문서
| 문서 | 내용 |
|---|---|
| [기획서](docs/01-기획서.md) | 문제, 아이디어, 핵심 기능, 차별점, MVP 범위 |
| [기술서](docs/02-기술서.md) | 구조, 오케스트레이터 동작 원리, API 명세, 로드맵 |
| [데모 가이드](docs/03-데모-시나리오.md) | 실행 방법, 3분 발표 시나리오, 예상 질문 |

발표용 데모는 `demo-v1.html`을 브라우저로 열면 서버 없이 바로 재생됩니다.

## 실행
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # OPENAI_API_KEY를 넣으면 실제 LLM 사용
uvicorn app.main:app --reload --port 8000
```
브라우저 3개(또는 탭 3개)로 `http://localhost:8000` 을 열고 각각 종원/민수/지현으로 입장하세요.

## WebSocket 프로토콜
접속: `ws://HOST/ws/{room_id}/{user_id}`

클라이언트 -> 서버
| type | 필드 | 설명 |
|---|---|---|
| message | text, mode(direct/delegate) | 직접 발언 / 한 줄만 말하고 미니미가 풀어쓰기 |
| away | value(bool) | 자리 비움 on/off. off 시 본인에게만 부재 요약 전송 |
| agenda | text | 안건 설정 |
| end_meeting | - | 회의 결과 정리 |

서버 -> 클라이언트: `history`, `message`(kind: human/mini/system/tool/result/digest), `presence`, `orchestrator`(scores, pick, why), `typing`, `agenda`, `activity`

## 구조
- `app/orchestrator.py` 점수 -> 선택 -> 발언을 MAX_ROUNDS까지 반복(AI끼리 토론). 자리 비운 사람 미니미 +0.3, 직전 발언자 제외.
- `app/llm.py` score / reply / expand / digest / minutes. 키 없으면 MOCK.
- `app/tools.py` 검색 Tool (Tavily 키 없으면 모의 결과).
- `app/store.py` 인메모리 Hub. 다음 단계에서 PostgreSQL + pgvector로 교체.

## 배포
Railway/Render에서 start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
(WebSocket은 자동으로 wss로 올라갑니다.)
