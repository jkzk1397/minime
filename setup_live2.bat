@echo off
chcp 65001 >nul
REM 직접 입력 방(live2): live 와 똑같이 민준·지연·하린 자료만 채우고 도윤은 비워 둠. 자동 진행만 없음.
REM 서버(run.bat)를 켠 상태에서 실행. 다시 실행하면 대화를 지우고 처음 상태로 되돌린다.
cd /d %~dp0
if "%PORT%"=="" set PORT=8000
curl -s -X DELETE http://localhost:%PORT%/api/rooms/live2 >nul 2>&1
curl -s -f -X POST http://localhost:%PORT%/api/rooms -H "Content-Type: application/json" -d "{\"room_id\":\"live2\",\"seed\":\"live\"}" >nul
if errorlevel 1 (
  echo   서버가 꺼져 있어요. run.bat 을 먼저 켜고 다시 실행하세요.
) else (
  echo   live2 방을 준비했어요. 로비에서 방 코드 live2 로 들어가 각자 자기 이름을 누르세요.
  echo   live 와 같은 순서로 진행하되, 대사는 전부 직접 입력해요.
)
pause
