"""테스트용 가짜 LLM 서버: Ollama(/api/*)와 OpenAI 호환(/v1/chat/completions)을 흉내 낸다.

MODE 로 동작을 바꾼다: ok | bad_json_once | error | slow
speak 요청에는 근거 문장 1개(통과) + 지어낸 문장 1개(출처 검사에서 지워져야 함)를 돌려준다.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI()
STATE = {"mode": "ok", "calls": [], "bad_once_done": False}


def _minimal(schema: dict):
    t = schema.get("type")
    if "enum" in schema:
        return schema["enum"][0]
    if t == "object":
        return {k: _minimal(v) for k, v in schema.get("properties", {}).items() if k in schema.get("required", [])}
    if t == "array":
        return []
    if t == "string":
        return "테스트"
    if t == "boolean":
        return False
    if t in ("number", "integer"):
        return 1
    return None


def _answer(system: str, user: str, schema: dict) -> dict:
    if "AI 미니미입니다" in system and "sentences" in json.dumps(schema):
        labels = re.findall(r"^- ([^:\n]{2,24}): (.+)$", user, flags=re.M)
        if labels:
            lab, text = labels[0]
            first = re.split(r"(?<=[.!?])\s", text)[0]
            return {"sentences": [{"text": first, "core": first, "cites": [lab]},
                                  {"text": "화성 이주 우주선 예산도 이미 확보했어요", "cites": [lab]}]}
    if "개입 판단기" in system:
        m = re.search(r"^- (\w+) \(", user, flags=re.M)
        return {"speak": True, "who": m.group(1) if m else "", "act": "opinion", "reason": "모델 판정(테스트)"}
    if "'입장 카드'를 뽑는" in system:
        return {"stances": [{"issue_id": "i1", "claim": "저는 B안이 좋아요.", "position": "B안", "reasons": "",
                             "warrant": "", "red_line": "", "unknown": "", "priority": 1, "sources": ["보고서 5문단"]}]}
    if "풀어 씁니다" in system:
        return {"text": "모델이 풀어 쓴 입장이에요.", "position": "", "red_line": ""}
    return _minimal(schema)


async def _gate(kind: str, body: dict):
    STATE["calls"].append({"kind": kind, "model": body.get("model")})
    mode = STATE["mode"]
    if mode == "error":
        return JSONResponse({"error": "boom"}, status_code=500)
    if mode == "slow":
        await asyncio.sleep(10)
    if mode == "bad_json_once" and not STATE["bad_once_done"]:
        STATE["bad_once_done"] = True
        return "이건 JSON이 아니에요"
    return None


@app.get("/api/tags")
async def tags():
    return {"models": [{"name": "qwen3.5:4b"}, {"name": "qwen3.5:9b"}, {"name": "bge-m3:latest"}]}


@app.post("/api/chat")
async def ollama_chat(req: Request):
    body = await req.json()
    bad = await _gate("ollama", body)
    if isinstance(bad, JSONResponse):
        return bad
    sysm, user = body["messages"][0]["content"], body["messages"][1]["content"]
    content = bad if isinstance(bad, str) else json.dumps(_answer(sysm, user, body.get("format") or {}), ensure_ascii=False)
    return {"message": {"role": "assistant", "content": content}, "prompt_eval_count": 120, "eval_count": 30}


@app.post("/api/embed")
async def embed(req: Request):
    body = await req.json()
    out = []
    for t in body["input"]:
        h = hashlib.sha256(t.encode()).digest()
        out.append([b / 127.5 - 1 for b in h] * 4)          # 평균 0 → 무관한 문장끼리 코사인 ≈ 0
    return {"embeddings": out}


@app.post("/v1/chat/completions")
async def openai_chat(req: Request):
    body = await req.json()
    bad = await _gate("api", body)
    if isinstance(bad, JSONResponse):
        return bad
    sysm, user = body["messages"][0]["content"], body["messages"][1]["content"]
    m = re.search(r"JSON 스키마를 따르는 JSON 객체 하나만 출력하세요:\n(\{.*\})", sysm, flags=re.S)
    schema = json.loads(m.group(1)) if m else {}
    content = bad if isinstance(bad, str) else json.dumps(_answer(sysm, user, schema), ensure_ascii=False)
    return {"choices": [{"message": {"content": content}}], "usage": {"prompt_tokens": 100, "completion_tokens": 20}}
