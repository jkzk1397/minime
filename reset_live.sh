#!/usr/bin/env bash
# 실전 시연용 방(live)을 완전히 지운다. 사용: ./reset_live.sh [방코드]
cd "$(dirname "$0")"
ROOM="${1:-live}"; PORT="${PORT:-8000}"
curl -s -X DELETE "http://localhost:${PORT}/api/rooms/${ROOM}" >/dev/null || echo "  서버가 꺼져 있어서 저장 파일만 지웁니다."
rm -f "data/rooms/${ROOM}.json"
echo "  '${ROOM}' 방을 지웠어요. 로비에서 [새 회의방 만들기]로 빈 방부터 시작하세요."
