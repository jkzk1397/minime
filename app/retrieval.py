"""M1 검색: 문단 청킹 → 형태소(Kiwi) BM25 + 벡터 검색 → RRF로 합치기 → 근거 점수(침묵 결정용).

- BM25: 한국어 고유명사·숫자를 잘 잡는다 (Kiwi 형태소 기준, 없으면 간이 토크나이저)
- 벡터: Ollama bge-m3가 있으면 그것을, 없으면 내장 문자 n-gram TF-IDF 벡터를 쓴다 (바꿔 말한 표현 보완)
- RRF: 두 순위를 합친다. 순서는 RRF로 정하고, '말해도 되는가'는 절대 점수(근거 점수)로 정한다
- 근거 점수 = 0.55 × 질의 핵심어 덮는 비율(IDF 가중) + 0.45 × 벡터 유사도(보정)
"""
from __future__ import annotations

import math
import re
import threading
from collections import Counter
from dataclasses import dataclass, field
from typing import Iterable

import numpy as np

from . import llm

# ---------------------------------------------------------------- 토크나이저
_KEEP = {"NNG", "NNP", "SL", "SN", "SH", "XR", "VV", "VA", "VV-I", "VA-I", "VV-R", "VA-R", "MAG"}
_STOP = {
    "생각", "것", "거", "수", "때", "등", "중", "좀", "더", "정도", "부분", "경우", "이번", "오늘", "의견", "얘기",
    "이야기", "말", "진짜", "그냥", "약간", "일단", "우리", "저희", "제", "저", "나", "너", "님", "분", "쪽", "게",
    "하", "되", "있", "없", "같", "보", "가", "오", "주", "맞", "않", "알", "모르", "싶", "들", "받", "쓰", "만들",
    "나오", "그렇", "이렇", "어떻", "많", "적", "크", "작", "좋", "그럼", "그래서", "근데", "그리고", "또", "다시",
    "너무", "정말", "아주", "잘", "다", "안", "못", "왜", "어떻게", "혹시", "먼저", "지금", "이제", "계속", "같이",
    "어", "음", "네", "응", "ㅋㅋ", "ㅎㅎ", "해", "했", "하다", "되다", "있다", "정하", "하기",
}
_kiwi = None
_kiwi_lock = threading.Lock()
_kiwi_failed = False


def _get_kiwi():
    global _kiwi, _kiwi_failed
    if _kiwi is None and not _kiwi_failed:
        with _kiwi_lock:
            if _kiwi is None and not _kiwi_failed:
                try:
                    from kiwipiepy import Kiwi
                    _kiwi = Kiwi()
                    _kiwi.tokenize("준비")          # 첫 호출 지연을 미리 치른다
                except Exception:
                    _kiwi_failed = True
    return _kiwi


def warmup() -> str:
    return "kiwi" if _get_kiwi() is not None else "simple"


_JOSA = re.compile(r"(으로부터|에서부터|이라고|라고|에게서|한테서|에서|에게|한테|으로|부터|까지|보다|처럼|이랑|랑|"
                   r"하고|은|는|이|가|을|를|에|의|와|과|도|만|로|요)$")


def _simple_tokens(text: str) -> list[str]:
    out = []
    for w in re.findall(r"[A-Za-z]+안|[A-Za-z0-9.%]+|[가-힣]+", text):
        w = w.lower()
        if re.fullmatch(r"[가-힣]+", w) and len(w) > 2:
            w = _JOSA.sub("", w) or w
        if w not in _STOP and (len(w) > 1 or re.fullmatch(r"[a-z0-9]", w)):
            out.append(w)
    return out


def tokens(text: str) -> list[str]:
    """검색용 내용어 토큰. 'B안' 같은 선택지 라벨은 한 토큰으로 묶고, 붙은 명사는 2-gram을 더한다."""
    k = _get_kiwi()
    if k is None:
        return _simple_tokens(text)
    toks = k.tokenize(text)
    out: list[str] = []
    prev_noun = ""
    i = 0
    while i < len(toks):
        t = toks[i]
        form, tag = t.form.lower(), t.tag
        if tag == "SL" and i + 1 < len(toks) and toks[i + 1].form == "안" and toks[i + 1].start == t.start + t.len:
            out.append(form + "안")
            prev_noun = ""
            i += 2
            continue
        if tag in _KEEP and form not in _STOP and (len(form) > 1 or tag in ("SL", "SN", "NNG", "NNP")):
            if tag == "MAG" and form not in ("항상", "절대", "반드시", "무조건", "전혀"):
                i += 1
                continue
            out.append(form)
            if tag in ("NNG", "NNP"):
                if prev_noun:
                    out.append(prev_noun + form)
                prev_noun = form
            else:
                prev_noun = ""
        else:
            prev_noun = "" if tag not in ("NNG", "NNP") else prev_noun
        i += 1
    return out


# ---------------------------------------------------------------- 벡터 (내장)
_DIM = 4096


def _ngrams(text: str) -> list[str]:
    s = re.sub(r"\s+", "", text.lower())
    s = re.sub(r"[^\w가-힣%.]", "", s)
    grams = [s[i:i + 2] for i in range(len(s) - 1)] + [s[i:i + 3] for i in range(len(s) - 2)]
    return grams or ([s] if s else [])


def _hash(g: str) -> int:
    h = 2166136261
    for ch in g.encode("utf-8"):
        h = ((h ^ ch) * 16777619) & 0xFFFFFFFF
    return h % _DIM


# ---------------------------------------------------------------- 인덱스
@dataclass
class Chunk:
    id: str
    owner: str
    kind: str          # report | stance | interview | profile | past | utterance | issue
    label: str         # 화면에 보이는 출처 라벨 (예: 보고서 3문단)
    text: str
    issue_id: str = ""
    ref: str = ""      # 원본 id (stance id 등)

    def to_dict(self) -> dict:
        return {"id": self.id, "owner": self.owner, "kind": self.kind, "label": self.label, "text": self.text,
                "issue_id": self.issue_id, "ref": self.ref}


@dataclass
class Hit:
    chunk: Chunk
    bm25: float = 0.0
    cos: float = 0.0
    coverage: float = 0.0
    strength: float = 0.0
    rrf: float = 0.0
    matched: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {**self.chunk.to_dict(), "bm25": round(self.bm25, 3), "cos": round(self.cos, 3),
                "coverage": round(self.coverage, 3), "strength": round(self.strength, 3), "rrf": round(self.rrf, 4),
                "matched": self.matched[:8]}


class Index:
    K1, B = 1.5, 0.75

    def __init__(self, chunks: list[Chunk], dense: list[list[float]] | None = None) -> None:
        self.chunks = chunks
        self.toks = [tokens(c.text) for c in chunks]
        self.tf = [Counter(t) for t in self.toks]
        self.dl = [len(t) for t in self.toks]
        self.avgdl = (sum(self.dl) / len(self.dl)) if self.dl else 1.0
        df: Counter = Counter()
        for t in self.tf:
            df.update(t.keys())
        n = max(1, len(chunks))
        self.idf = {w: math.log(1 + (n - d + 0.5) / (d + 0.5)) for w, d in df.items()}
        self.max_idf = math.log(1 + (n + 0.5) / 0.5)
        # 내장 n-gram 벡터 (IDF 가중)
        gdf: Counter = Counter()
        grams = [Counter(_ngrams(c.text)) for c in chunks]
        for g in grams:
            gdf.update({_hash(x) for x in g})
        self.gidf = np.ones(_DIM, dtype=np.float32) * math.log(1 + n / 0.5)
        for h, d in gdf.items():
            self.gidf[h] = math.log(1 + n / d)
        self.local = np.stack([self._vec(g) for g in grams]) if chunks else np.zeros((0, _DIM), np.float32)
        self.dense = np.array(dense, dtype=np.float32) if dense else None
        if self.dense is not None:
            self.dense /= (np.linalg.norm(self.dense, axis=1, keepdims=True) + 1e-9)
        self.vector_kind = "bge-m3" if self.dense is not None else "n-gram"

    def _vec(self, grams: Counter) -> np.ndarray:
        v = np.zeros(_DIM, dtype=np.float32)
        for g, c in grams.items():
            h = _hash(g)
            v[h] += (1 + math.log(c)) * self.gidf[h]
        nrm = np.linalg.norm(v)
        return v / nrm if nrm else v

    @classmethod
    async def build(cls, chunks: list[Chunk]) -> "Index":
        dense = await llm.embed([c.text for c in chunks]) if chunks else None
        return cls(chunks, dense)

    def bm25_scores(self, q: list[str]) -> np.ndarray:
        s = np.zeros(len(self.chunks), dtype=np.float32)
        for i, tf in enumerate(self.tf):
            denom_base = self.K1 * (1 - self.B + self.B * self.dl[i] / self.avgdl)
            for w in set(q):
                f = tf.get(w)
                if f:
                    s[i] += self.idf.get(w, 0) * f * (self.K1 + 1) / (f + denom_base)
        return s

    async def search(self, query: str, k: int = 5, method: str | None = None,
                     kinds: Iterable[str] | None = None, issue_id: str | None = None) -> list[Hit]:
        if not self.chunks or not query.strip():
            return []
        from . import config
        method = method or config.RETRIEVAL_METHOD
        q = tokens(query)
        allowed = [i for i, c in enumerate(self.chunks)
                   if (kinds is None or c.kind in kinds) and (issue_id is None or c.issue_id in ("", issue_id))]
        if not allowed:
            return []
        bm = self.bm25_scores(q)
        cos, scaled = self._cos(query, await llm.embed([query]) if self.dense is not None else None)
        qset = set(q)
        qweight = sum(self.idf.get(w, self.max_idf) for w in qset) or 1.0
        hits: dict[int, Hit] = {}
        for i in allowed:
            matched = [w for w in qset if w in self.tf[i]]
            coverage = sum(self.idf.get(w, self.max_idf) for w in matched) / qweight if qset else 0.0
            strength = 0.55 * coverage + 0.45 * float(scaled[i])
            hits[i] = Hit(self.chunks[i], float(bm[i]), float(cos[i]), coverage, strength, 0.0, matched)
        r_bm = sorted(allowed, key=lambda i: -bm[i])
        r_vec = sorted(allowed, key=lambda i: -cos[i])
        if method == "bm25":
            order = r_bm
        elif method == "vector":
            order = r_vec
        else:
            for rank, i in enumerate(r_bm):
                hits[i].rrf += 1 / (60 + rank + 1) if bm[i] > 0 else 0
            for rank, i in enumerate(r_vec):
                hits[i].rrf += 1 / (60 + rank + 1)
            order = sorted(allowed, key=lambda i: (-hits[i].rrf, -hits[i].strength))
        return [hits[i] for i in order[:k]]

    def _cos(self, query: str, qdense: list[list[float]] | None) -> tuple[np.ndarray, np.ndarray]:
        if self.dense is not None and qdense:
            qv = np.array(qdense[0], dtype=np.float32)
            qv /= (np.linalg.norm(qv) + 1e-9)
            cos = self.dense @ qv
            return cos, np.clip((cos - 0.40) / 0.35, 0, 1)
        qv = self._vec(Counter(_ngrams(query)))
        cos = self.local @ qv if len(self.local) else np.zeros(0)
        return cos, np.clip(cos / 0.45, 0, 1)

    def similarity(self, a: str, b: str) -> float:
        """두 문장의 내장 n-gram 유사도 (새로움·출처 검사에 쓴다, 0~1)."""
        va, vb = self._vec(Counter(_ngrams(a))), self._vec(Counter(_ngrams(b)))
        return float(va @ vb)


def lexical_support(sentence: str, passage: str) -> float:
    """생성된 문장의 핵심어 중 인용 문단에 실제로 있는 비율 (출처 검사, 0~1)."""
    s = set(tokens(sentence))
    if not s:
        return 0.0
    p = set(tokens(passage))
    return len(s & p) / len(s)


def text_similarity(a: str, b: str) -> float:
    ga, gb = Counter(_ngrams(a)), Counter(_ngrams(b))
    if not ga or not gb:
        return 0.0
    inter = sum((ga & gb).values())
    return 2 * inter / (sum(ga.values()) + sum(gb.values()))
