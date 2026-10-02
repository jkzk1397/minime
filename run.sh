#!/usr/bin/env bash
# MyMini 실행 (macOS / Linux). 처음이면 가상환경을 만들고 패키지를 설치한다.
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  ./.venv/bin/pip install -q --upgrade pip
  ./.venv/bin/pip install -q -r requirements.txt
fi
[ -f .env ] || cp .env.example .env
PORT="${PORT:-8000}"
echo ""
echo "  MyMini를 띄웁니다 → http://localhost:${PORT}"
echo "  팀원 접속 주소(같은 와이파이)는 서버 로그의 '팀원 접속 주소'를 보세요. 화면의 [초대] 버튼으로 QR도 볼 수 있어요."
echo ""
exec ./.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
