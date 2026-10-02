@echo off
chcp 65001 >nul
REM MyMini 실행 (Windows). 처음이면 가상환경을 만들고 패키지를 설치한다.
cd /d %~dp0
if not exist .venv (
  python -m venv .venv
  .venv\Scripts\python -m pip install -q --upgrade pip
  .venv\Scripts\python -m pip install -q -r requirements.txt
)
if not exist .env copy .env.example .env
if "%PORT%"=="" set PORT=8000
echo.
echo   MyMini를 띄웁니다 - http://localhost:%PORT%
echo   팀원 접속 주소(같은 와이파이)는 아래 로그의 '팀원 접속 주소'를 보세요.
echo   Windows 방화벽 허용 창이 뜨면 [허용]을 누르세요.
echo.
.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port %PORT%
