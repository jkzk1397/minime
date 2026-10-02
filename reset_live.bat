@echo off
chcp 65001 >nul
REM 실전 시연용 방(live)을 완전히 지운다. 리허설 뒤, 그리고 본 발표 직전에 한 번 실행.
REM 서버가 켜져 있으면 접속 중인 화면도 로비로 돌아간다. 다른 방 코드: reset_live.bat 방코드
cd /d %~dp0
set "ROOM=%~1"
if "%ROOM%"=="" set ROOM=live
if "%PORT%"=="" set PORT=8000
curl -s -X DELETE http://localhost:%PORT%/api/rooms/%ROOM% >nul 2>&1
if errorlevel 1 (
  echo   서버가 꺼져 있어서 저장 파일만 지웁니다.
)
if exist data\rooms\%ROOM%.json del /q data\rooms\%ROOM%.json
echo.
echo   '%ROOM%' 방을 지웠어요. 이제 로비에서 [새 회의방 만들기]로 빈 방부터 시작하세요.
echo   팀원 휴대폰은 새로고침하면 로비로 돌아가요.
echo.
pause
