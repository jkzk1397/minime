"""자료조사 Tool. TAVILY_API_KEY가 없으면 모의 결과를 돌려준다."""
import httpx
from . import config


async def web_search(query: str) -> dict:
    if not config.TAVILY_API_KEY:
        return {"query": query, "answer": f"(모의 결과) '{query}'에 대한 공식 문서 요약입니다. 실제 키를 설정하면 웹 검색 결과로 바뀝니다.",
                "sources": [], "mock": True}
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post("https://api.tavily.com/search", json={
            "api_key": config.TAVILY_API_KEY, "query": query,
            "include_answer": True, "max_results": 3,
        })
        r.raise_for_status()
        data = r.json()
    return {"query": query, "answer": data.get("answer") or "",
            "sources": [x.get("url") for x in data.get("results", [])], "mock": False}
