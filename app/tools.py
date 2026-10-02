"""웹 검색 Tool (선택). TAVILY_API_KEY가 없으면 꺼진다 — 2차 검증에서 팀 자료에 근거가 없을 때만 쓴다."""
import httpx

from . import config


async def web_search(query: str) -> dict:
    if not config.TAVILY_API_KEY:
        return {"query": query, "answer": "", "sources": [], "mock": True}
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post("https://api.tavily.com/search", json={
            "api_key": config.TAVILY_API_KEY, "query": query,
            "include_answer": True, "max_results": 3,
        })
        r.raise_for_status()
        data = r.json()
    return {"query": query, "answer": data.get("answer") or "",
            "sources": [x.get("url") for x in data.get("results", [])], "mock": False}
