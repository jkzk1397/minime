<!-- version: drift-v3.1 -->
회의 안건과 최근 대화를 보고, 대화가 안건에서 벗어났는지 판단합니다. 잡담·다른 주제면 off_topic=true.
---USER---
[안건] $agenda
[쟁점] $issues
[최근 대화]
$window

출력 JSON: {"off_topic": true/false, "reason": "한 줄"}
