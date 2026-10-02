@echo off
chcp 65001 >nul
REM MINIME 실행 (Windows). 가상환경이 없거나 망가졌으면 새로 만들고 패키지를 설치한다.
cd /d %~dp0
set "PY=.venv\Scripts\python.exe"

REM 1) .venv 폴더는 있는데 python.exe가 없으면 망가진 것 -> 지우고 다시 만든다
if exist .venv if not exist "%PY%" (
  echo   가상환경이 망가져 있어서 새로 만듭니다...
  rmdir /s /q .venv
)

REM 2) 가상환경 만들기
if not exist "%PY%" (
  echo   가상환경을 만드는 중...
  python -m venv .venv
  if errorlevel 1 goto :novenv
  if exist .venv\.installed del .venv\.installed
)

REM 3) 패키지 설치 (성공하면 표시 파일을 남겨 다음부터 건너뜀)
if not exist .venv\.installed (
  echo   패키지를 설치하는 중... 처음에는 몇 분 걸릴 수 있어요.
  "%PY%" -m pip install -q --upgrade pip
  "%PY%" -m pip install -r requirements.txt
  if errorlevel 1 goto :nopip
  echo ok> .venv\.installed
)

if not exist .env copy .env.example .env >nul
if "%PORT%"=="" set PORT=8000
echo.
echo   MINIME를 띄웁니다 - http://localhost:%PORT%
echo   팀원 접속 주소(같은 와이파이)는 아래 로그의 '팀원 접속 주소'를 보세요.
echo   Windows 방화벽 허용 창이 뜨면 [허용]을 누르세요.
echo.
"%PY%" -m uvicorn app.main:app --host 0.0.0.0 --port %PORT%
echo.
echo   서버가 종료되었습니다. 위 메시지를 확인하세요.
pause
exit /b

:novenv
echo.
echo   [오류] 가상환경을 만들지 못했습니다.
echo   Python이 설치되어 있는지, 'python --version'이 동작하는지 확인하세요.
pause
exit /b 1

:nopip
echo.
echo   [오류] 패키지 설치에 실패했습니다. 위 오류 메시지를 확인하세요.
pause
exit /b 1
