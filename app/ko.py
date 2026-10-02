"""한국어 규칙 도구: 문장 나누기, 존댓말 바꾸기, 단서어(입장·약속·결정·과잉 일반화) 감지.

모델이 없을 때(규칙 대체)도 미니미가 어색하지 않은 문장을 쓰게 하는 최소한의 장치다.
"""
from __future__ import annotations

import re

# ---------------------------------------------------------------- 문장
_SENT = re.compile(r"(?<=[.!?。])\s+|(?<=[다요죠음함])\.\s*|\n+")


def sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", text.strip())
    out = []
    for p in parts:
        p = p.strip()
        if p:
            out.append(p)
    return out


def has_batchim(ch: str) -> bool:
    if not ch:
        return False
    code = ord(ch[-1]) - 0xAC00
    if 0 <= code <= 11171:
        return code % 28 != 0
    return ch[-1].lower() in "lmnr0136789"   # 영문·숫자 끝 (엘, 엠, 엔, 알 / 영, 일, 삼, 육, 칠, 팔, 구)


def eun(word: str) -> str:
    return "은" if has_batchim(word) else "는"


def iga(word: str) -> str:
    return "이" if has_batchim(word) else "가"


def ro(word: str) -> str:
    if not word:
        return "로"
    code = ord(word[-1]) - 0xAC00
    if 0 <= code <= 11171 and code % 28 not in (0, 8):     # 받침 있고 ㄹ이 아니면 '으로'
        return "으로"
    return "로"


def ida(word: str) -> str:
    """명사 뒤 '이에요/예요'."""
    return "이에요" if has_batchim(word) else "예요"



# ---------------------------------------------------------------- '-ㄴ다/-는다' → '-아요/-어요' (자모 계산)
_IRREG = {"만든다": "만들어요", "든다": "들어요", "논다": "놀아요", "안다": "알아요", "판다": "팔아요", "운다": "울어요",
          "연다": "열어요", "건다": "걸어요", "듣는다": "들어요", "걷는다": "걸어요", "돕는다": "도와요", "짓는다": "지어요",
          "낫는다": "나아요", "붓는다": "부어요", "줍는다": "주워요", "눕는다": "누워요"}
_MED_TO = {20: 6, 8: 9, 13: 14, 11: 10}          # ㅣ→ㅕ, ㅗ→ㅘ, ㅜ→ㅝ, ㅚ→ㅙ


def _syl(ini: int, med: int, fin: int = 0) -> str:
    return chr(0xAC00 + ini * 588 + med * 28 + fin)


def _parts(ch: str):
    c = ord(ch) - 0xAC00
    return (c // 588, (c % 588) // 28, c % 28) if 0 <= c <= 11171 else None


def conj_nda(word: str) -> str | None:
    """'걸린다'→'걸려요', '닫는다'→'닫아요', '쓴다'→'써요'. 모르는 형태면 None."""
    for k, v in _IRREG.items():
        if word.endswith(k):
            return word[: -len(k)] + v
    if word.endswith("는다") and len(word) >= 3:
        stem = word[:-2]
        p = _parts(stem[-1])
        if not p or p[2] == 0:
            return None
        return stem + ("아요" if p[1] in (0, 8) else "어요")
    if word.endswith("다") and len(word) >= 2:
        p = _parts(word[-2])
        if not p or p[2] != 4:                     # 받침 ㄴ이어야 '-ㄴ다'
            return None
        ini, med, _ = p
        head = word[:-2]
        if ini == 18 and med == 0:                 # 한다 → 해요
            return head + "해요"
        if med == 18:                              # ㅡ 탈락: 쓴다→써요, 바쁜다(드묾)
            prev = _parts(head[-1]) if head else None
            return head + _syl(ini, 0 if prev and prev[1] in (0, 8) else 4) + "요"
        if med in _MED_TO:
            return head + _syl(ini, _MED_TO[med]) + "요"
        if med in (16, 19):                        # ㅟ, ㅢ → '쉬어요'
            return head + _syl(ini, med) + "어요"
        return head + _syl(ini, med) + "요"         # ㅏ ㅓ ㅐ ㅔ ㅕ ㅘ ㅝ ㅙ: 간다→가요, 선다→서요
    return None


# ---------------------------------------------------------------- 존댓말
_WRITTEN = [
    (r"생각한다$", "생각해요"), (r"해야 한다$", "해야 해요"), (r"겠다$", "겠어요"),
    (r"([았었였])다$", r"\1어요"), (r"하다$", "해요"), (r"한다$", "해요"), (r"된다$", "돼요"),
    (r"있다$", "있어요"), (r"없다$", "없어요"), (r"좋다$", "좋아요"), (r"높다$", "높아요"), (r"낮다$", "낮아요"),
    (r"많다$", "많아요"), (r"적다$", "적어요"), (r"같다$", "같아요"), (r"싶다$", "싶어요"), (r"크다$", "커요"),
    (r"본다$", "봐요"), (r"준다$", "줘요"), (r"낫다$", "나아요"), (r"이다$", "이에요"), (r"것이다$", "거예요"),
    (r"이었다$", "이었어요"), (r"않는다$", "않아요"), (r"줄어든다$", "줄어들어요"), (r"늘어난다$", "늘어나요"),
]
_CASUAL = [
    (r"(거|것)야$", "거예요"), (r"이야$", "이에요"), (r"(?<=[가-힣])야$", "예요"),
    (r"(?<=[가-힣])자$", "는 게 좋겠어요"), (r"게$", "게요"), (r"돼$", "돼요"), (r"해$", "해요"),
    (r"(?<=[가-힣])지$", "지요"), (r"[아어와워봐줘래]$", lambda m: m.group(0) + "요"), (r"(?<=[가-힣])네$", "네요"),
    (r"(?<=[가-힣])듯$", "듯해요"), (r"(으로|로)$", r"\1 하면 좋겠어요"), (r"모름$", "몰라요"), (r"(?<=[가-힣])음$", "어요"),
]
_PRONOUN = [(r"(^|\s)나는\s", r"\1저는 "), (r"(^|\s)난\s", r"\1저는 "), (r"(^|\s)내가\s", r"\1제가 "),
            (r"(^|\s)나도\s", r"\1저도 "), (r"(^|\s)내\s", r"\1제 "), (r"(^|\s)나한테\s", r"\1저한테 ")]
_POLITE_END = re.compile(r"(요|니다|니까|죠|까요)$")


def polite(sentence: str) -> str:
    """한 문장을 회의용 존댓말로. 바꿀 수 없으면 그대로 둔다."""
    s = sentence.strip()
    if not s:
        return s
    m = re.search(r"([.!?~]+)$", s)
    punct = "?" if (m and "?" in m.group(1)) else "."
    body = s[: m.start()] if m else s
    body = body.strip()
    tail = ""
    pm = re.search(r"\s*\([^()]*\)$", body)            # 끝의 괄호 설명 '(5점 만점)'은 떼었다가 다시 붙인다
    if pm and pm.start() > 0:
        tail, body = body[pm.start():], body[:pm.start()].rstrip()
    for pat, rep in _PRONOUN:
        body = re.sub(pat, rep, body)
    body = re.sub(r"^(그래서|그러니까|따라서)\s*", "", body)
    if _POLITE_END.search(body):
        return body + tail + punct
    for pat, rep in _WRITTEN:
        if re.search(pat, body):
            return re.sub(pat, rep, body) + tail + punct
    m2 = re.search(r"([가-힣]+)$", body)
    if m2 and re.search(r"(ㄴ다|는다|[가-힣]다)$", m2.group(1)):
        conj = conj_nda(m2.group(1))
        if conj:
            return body[: m2.start()] + conj + tail + punct
    for pat, rep in _CASUAL:
        if re.search(pat, body):
            return re.sub(pat, rep, body) + tail + punct
    if re.search(r"(에|에서|에게|한테|까지|부터|을|를|와|과|랑|하고|처럼|보다|의)$", body):
        return body + tail + punct                   # 조사로 끝난 조각은 지어내지 않고 그대로 둔다
    if re.search(r"[가-힣A-Za-z0-9]$", body) and not re.search(r"(다|요|죠|고|며|서|면|데|만|도)$", body):
        return body + ida(body) + tail + punct       # 명사로 끝나면 '…이에요'
    return body + tail + punct


def _add_n(stem: str) -> str:
    p = _parts(stem[-1]) if stem else None
    if not p:
        return stem + "는"
    if p[2] == 0:
        return stem[:-1] + _syl(p[0], p[1], 4)      # 하 → 한, 남기 → 남긴
    return stem + "는"


def proposal(sentence: str) -> str:
    """'그럼 영상으로 하자' → '그럼 영상으로 해요' (제안의 뜻을 유지한 존댓말)."""
    s = sentence.strip()
    m = re.search(r"([가-힣]+)자([.!~]*)$", s)
    if not m or len(m.group(1)) < 1:
        return polite(s)
    stem = m.group(1)
    conj = conj_nda(_add_n(stem) + "다")
    return (s[: m.start()] + conj + ".") if conj else polite(s)


def casual_to_polite(text: str, keep_proposal: bool = False) -> str:
    """한 줄 답('맞아 B안. 근데 공연 1팀은 남기자')을 풀어 쓴 존댓말 문장들로.
    keep_proposal=True면 '~하자'를 '~해요'로 (회의 발언 다듬기), 아니면 '~하는 게 좋겠어요' (입장 문장)."""
    t = text.strip()
    t = re.sub(r"\s+", " ", t)
    lead = ""
    m = re.match(r"^(맞아|응|ㅇㅇ|그래|네|예|맞아요|넹|웅)[,.!\s]*", t)
    if m:
        lead = "네, 맞아요."
        t = t[m.end():]
    parts = re.split(r"[.!?]\s*|\s+(?=근데\s)|\s*,\s*(?=그리고|근데|다만)", t)
    out = []
    for p in parts:
        p = p.strip(" ,")
        if not p:
            continue
        p = re.sub(r"^근데\s*", "다만 ", p)
        out.append(proposal(p) if keep_proposal and re.search(r"[가-힣]자$", p) else polite(p))
    return " ".join(([lead] if lead else []) + out).strip()


def is_affirmative(text: str) -> bool:
    return bool(re.match(r"^\s*(맞아|응|ㅇㅇ|그래|네|예|맞아요|맞습니다|넹|웅|좋아|ok|오케이)", text, re.I))


def written_to_spoken(sentence: str) -> str:
    return polite(sentence)


# ---------------------------------------------------------------- 단서어
COMMIT = re.compile(r"(맡아\s?줄|맡을\s?수|맡아\s?줘|맡아\s?줄래|맡을래|해\s?줄\s?수|해\s?줄래|해\s?줘|할\s?수\s?있(?:지|어|냐|나|죠)|"
                    r"정해\s?줄|정해\s?줘|약속|책임지|언제까지|마감|확정해|해\s?줄\s?거지|가능하지|가능해\?|되지\?|올\s?수\s?있)")
QUESTION = re.compile(r"(\?|까$|까\?|니\?|냐|어때|어떻게 생각|생각은|의견은|알아봤|있어\?|했어\?|어땠)")
DECISION = re.compile(r"(으?로\s?하자|으?로\s?가자|하는\s?걸로|가는\s?걸로|결정|확정|정하자|그렇게\s?하자|합시다|결론|"
                      r"으?로\s?정해|이대로\s?가|하기로|맡는\s?걸로|맡기로)")
DECISION_STRONG = re.compile(r"(으?로\s?하자|으?로\s?가자|하는\s?걸로|가는\s?걸로|결정하|확정|결론|이대로\s?가|하기로|맡는\s?걸로|"
                             r"맡기로|으?로\s?정하자|으?로\s?정해|으?로\s?(해요|가요|합시다|하죠|가죠|갑시다))")
FACT_Q = re.compile(r"(알아봤|몇\s?(명|개|번|시|일|원|%|곳|팀)?|언제|얼마|어디|누가|누구|업체|날짜|정확히|구체적으로)")
OPINION_Q = re.compile(r"(생각|의견|어때|어떻게\s?(봐|보|생각)|입장|찬성|반대|동의|괜찮|어느\s?쪽|싶은|싶어|원하|원해|맡고|맡을|선호)")
_STRONG_FACT = re.compile(r"(알아봤|몇\s?(명|개|번|시|일|원|%|곳|팀)|언제|얼마|어디|업체|날짜)")


def question_kind(text: str) -> str:
    """'fact'(사실을 묻는 질문: 근거 문단이 그 내용을 덮어야 답한다) / 'opinion'(입장을 묻는 질문) / ''(질문 아님)."""
    if not QUESTION.search(text):
        return ""
    if _STRONG_FACT.search(text):
        return "fact"
    if OPINION_Q.search(text):
        return "opinion"            # 본인의 선호·입장을 묻는 질문 ('맡고 싶은 역할이 뭐야?')
    return "fact"


def decision_sentence(text: str, has_position) -> str:
    """결정 문장을 고른다. 강한 표현('B안으로 가자', '~하는 걸로')이거나, 약한 표현('정하자')이면
    같은 문장에 선택지 입장이 있어야 한다. 질문 문장은 결정이 아니다."""
    for s in sentences(text):
        if "?" in s:
            continue
        if DECISION_STRONG.search(s) or (DECISION.search(s) and has_position(s)):
            return s
    return ""
ABSOLUTE = re.compile(r"(항상|절대|무조건|반드시|100%|확실|모든|모두|전부|누구나|누구도|아무도|하나도|전혀|당연히|언제나|매번|틀림없)")
GROUNDS = re.compile(r"(때문|왜냐하면|니까|므로|근거|자료|조사|설문|통계|결과|에 따르면|\d)")
POS_CUES = ["찬성", "좋", "낫", "가자", "하자", "선택", "지지", "필요", "해야", "제안", "유지", "늘리", "늘려", "확대",
            "동의", "추천", "원해", "원하", "현실적", "괜찮", "가는 게", "으로 가", "로 가", "맞는", "효과적"]
NEG_CUES = ["반대", "별로", "말고", "아니", "보다는", "보다", "줄이", "줄여", "없애", "부담", "어렵", "문제", "안 돼", "안돼",
            "싫", "대신", "빼", "줄일"]
STANCE_CUES = re.compile(r"(생각|해야|좋다|좋겠|낫다|제안|필요|맡겠|맡을|찬성|반대|원한|중요|현실적)")


def mentions(text: str, names: dict[str, str]) -> list[str]:
    """'@혜중', '혜중 미니미', '혜중아', '혜중 님' 같은 호출을 찾는다. names: uid -> 이름"""
    out = []
    for uid, name in names.items():
        if not name:
            continue
        pat = rf"(@{re.escape(name)}|{re.escape(name)}\s?(미니미|님|씨|아|야|이가|이는|이도|이)?(?=[\s,?!.]|$|생각|의견|은|는|이|가))"
        if re.search(pat, text):
            out.append(uid)
    return out


def addressed_mini(text: str, names: dict[str, str]) -> list[str]:
    """명시적으로 미니미를 부른 경우 ('@혜중', '혜중 미니미')."""
    return [uid for uid, n in names.items() if n and re.search(rf"(@{re.escape(n)}|{re.escape(n)}\s?미니미)", text)]


def strip_address(text: str, names: list[str]) -> str:
    """검색 질의에서 호칭('혜중 미니미', '@동준', '동준아')을 뺀다. 이름은 근거 문단에 없어서 점수를 깎기 때문."""
    t = text
    for n in sorted((x for x in names if x), key=len, reverse=True):
        t = re.sub(rf"@?{re.escape(n)}\s?(미니미|님|씨|아|야|이가|이는|이도|이)?(?=[\s,?!.]|$)", " ", t)
    t = re.sub(r"미니미", " ", t)
    return re.sub(r"\s+", " ", t).strip() or text


_NUM = re.compile(r"(\d+(?:[.,]\d+)?)\s*(천|만|억)?\s*(명|%|퍼센트|점|원|곳|팀|장|번|분|개|배|시간|일|주)")
_MULT = {"천": 1e3, "만": 1e4, "억": 1e8}


def numbers(text: str) -> list[tuple[float, str, str]]:
    """'응답자가 2천 명' → [(2000.0, '명', '응답자')]. 단위와 바로 앞 명사(무엇의 숫자인지)를 함께 돌려준다."""
    out = []
    for m in _NUM.finditer(text):
        try:
            v = float(m.group(1).replace(",", "")) * _MULT.get(m.group(2) or "", 1)
        except ValueError:
            continue
        unit = "%" if m.group(3) == "퍼센트" else m.group(3)
        before = re.findall(r"[가-힣A-Za-z]+", text[max(0, m.start() - 14): m.start()])
        subject = _JOSA_TAIL.sub("", before[-1]) if before else ""
        out.append((v, unit, subject))
    return out


_JOSA_TAIL = re.compile(r"(은|는|이|가|을|를|의|에서|에|도|만|로|으로)$")


# ---------------------------------------------------------------- 양보 불가 조건
_RED_CUE = re.compile(r"(꼭|반드시|절대|양보\s*(?:못|할\s*수\s*없)|없으면\s*안|빠지면\s*안|빼면\s*안|유지해|유지하|남기|남겨|빼지\s*말)")
_CLAUSE = re.compile(r"[.!?\n]+|(?:^|\s)(?:근데|그런데|다만|단,|하지만|그래도|대신)\s+")


def red_line(text: str) -> str:
    """한 줄 답에서 '이것만은 지켜야 한다'는 조건을 뽑는다 ('맞아 B안. 근데 공연 1팀은 꼭 남기자' → '공연 1팀은 꼭 남기는 게 좋겠어요').
    모델이 양보 불가 조건을 따로 돌려주지 않을 때(규칙 대체 포함) 쓴다. 단서어가 없으면 빈 문자열."""
    for clause in _CLAUSE.split(text or ""):
        c = clause.strip(" ,")
        if len(c) >= 4 and _RED_CUE.search(c):
            return casual_to_polite(c).strip()
    return ""
