"""미니미를 만드는 여러 방법 — 문서가 없어도 회의 전 1분이면 준비할 수 있게.

보고서를 쓰는 학생은 많지 않다. 그래서 보고서 업로드는 그대로 두고, 더 가벼운 길을 함께 둔다.
어떤 길로 들어와도 '본인이 확인한 것만 미니미가 쓴다'는 원칙은 같다.

1. 빠른 입장 체크  쟁점마다 선택지를 고르고 이유·조건을 한 줄씩. 본인이 직접 고른 것이라 바로 '확인됨'.
2. 전달 메모       회의에서 그대로 전해 줄 말. 미니미가 고치지 않고 회의마다 한 번 그대로 전한다.
3. 채팅 가져오기   단톡방 내보내기 파일은 브라우저에서 읽고 '내 말'만 서버로 온다 (다른 사람 말은 저장하지 않는다).
                  내 말에서 쟁점별 입장 카드 초안을 만들고, 본인이 '맞아요'를 눌러야 근거가 된다.
4. 자료 파일       txt·md·docx·pdf(쪽 번호)·pptx(슬라이드 번호)·hwpx. 올리기 전에 추출된 글을 보여 주고 고칠 수 있게 한다.
5. 미니미 파일     다른 회의방에서 내보낸 내 미니미(JSON)를 불러온다. 프로필·자료는 그대로,
                  입장 카드는 새 안건에 맞는지 모르므로 '초안'으로 들어와 다시 확인한다.
"""
from __future__ import annotations

import io
import re
import time
import zipfile
from dataclasses import asdict

from . import config, ko, llm
from .agenda import detect_issue, detect_position, issue_lexicon, stance_position
from .interview import confirm
from .models import Persona, Report, Room, Stance, new_id
from .retrieval import tokens

MAX_CHAT_LINES = 400
QUICK_ANY = "상관없음"          # 빠른 입장 체크의 '어느 쪽이든 괜찮아요'


# ---------------------------------------------------------------- 1. 빠른 입장 체크
def quick_claim(issue, choice: str, reason: str) -> tuple[str, str]:
    """선택지·이유 → 입장 카드 주장 문장과 선택지 라벨. AI가 풀어 쓰지 않고 고른 그대로 적는다 (덧붙임 0)."""
    choice = choice.strip()
    reason = ko.casual_to_polite(reason.strip()).strip() if reason.strip() else ""
    if choice == QUICK_ANY:
        claim = "저는 이 쟁점은 어느 쪽이든 괜찮아요."
        pos = ""
    elif choice:
        claim = f"저는 {choice} 쪽이에요."
        pos = choice if issue and choice in {o["label"] for o in issue.options} else detect_position(issue, choice)
    else:
        claim, pos = "", detect_position(issue, reason) if reason else ""
    if reason:
        claim = f"{claim} {reason}".strip()
    return claim, pos


def quick(room: Room, p: Persona, items: list[dict]) -> tuple[list[Stance], list[Stance]]:
    """[{issue_id, choice, reason, red_line, unknown}] → 확인된 입장 카드. 같은 쟁점의 예전 카드는 새 것으로 바뀐다."""
    created: list[Stance] = []
    replaced: list[Stance] = []
    for it in items:
        issue = room.issue(str(it.get("issue_id") or ""))
        if issue is None:
            continue
        choice = str(it.get("choice") or "").strip()[:30]
        reason = str(it.get("reason") or "").strip()[:200]
        red = str(it.get("red_line") or "").strip()[:200]
        unknown = str(it.get("unknown") or "").strip()[:200]
        claim, pos = quick_claim(issue, choice, reason)
        if not claim:
            continue                                     # '아직 모름'이면 카드를 만들지 않는다 → 회의에서 질문으로 남긴다
        st = Stance(new_id("s"), issue.id, claim[:300], pos, "", "", ko.casual_to_polite(red).strip() if red else "",
                    unknown, 1 if red else 2, ["빠른 입장"], "candidate", "quick")
        # 같은 쟁점에 예전 빠른 입장이 있으면 다시 고른 것으로 본다 (선택지가 같아도 바꾼다)
        for old in p.confirmed(issue.id):
            if old.origin == "quick":
                old.status = "rejected"
                replaced.append(old)
        p.stances.append(st)
        _, rep = confirm(p, st.id, True)
        replaced.extend(rep)
        created.append(st)
    p.touch()
    return created, replaced


# ---------------------------------------------------------------- 2. 전달 메모
def add_memo(room: Room, p: Persona, text: str, issue_id: str = "") -> Stance:
    text = text.strip()
    if not text:
        raise ValueError("전할 말을 적어 주세요.")
    if issue_id == "-":                                  # '쟁점 없이': 회의가 시작되면(첫 발언 때) 전한다
        issue_id = ""
    else:
        if issue_id and room.issue(issue_id) is None:
            issue_id = ""
        if not issue_id:
            issue_id, _ = detect_issue(room, text)
    issue = room.issue(issue_id)
    st = Stance(new_id("s"), issue_id, text[:300], stance_position(issue, text) if issue else "", "", "",
                ko.red_line(text), "", 1, ["전달 메모"], "confirmed", "memo")
    p.stances.append(st)
    p.touch()
    return st


def memos_to_deliver(room: Room, p: Persona, issue_id: str) -> list[Stance]:
    """지금 쟁점(또는 쟁점 없는 메모)에 해당하고 이번 회의에서 아직 전하지 않은 메모."""
    started = room.meeting.get("started_at") or 0
    out = []
    for s in p.stances:
        if s.origin != "memo" or s.status != "confirmed":
            continue
        if p.memo_log.get(s.id) == started:
            continue
        if not s.issue_id or s.issue_id == issue_id:
            out.append(s)
    return out


# ---------------------------------------------------------------- 3. 채팅 가져오기 (내 말만)
def clean_lines(lines: list) -> list[dict]:
    """브라우저가 보낸 '내 말' 목록을 정리한다. 사진·이모티콘·삭제된 메시지·링크만 있는 줄은 버린다."""
    out = []
    skip = re.compile(r"^(사진|동영상|이모티콘|파일|삭제된 메시지입니다\.?|사진 \d+장|<사진 읽지 않음>|https?://\S+)$")
    for x in lines[:MAX_CHAT_LINES * 2]:
        if isinstance(x, str):
            x = {"text": x}
        if not isinstance(x, dict):
            continue
        t = re.sub(r"\s+", " ", str(x.get("text") or "")).strip()[:300]
        if len(t) < 4 or skip.match(t):
            continue
        out.append({"text": t, "when": str(x.get("when") or "")[:40]})
    return out[-MAX_CHAT_LINES:]


_PREFER = re.compile(r"(생각|좋|낫|맞는|맞아|찬성|반대|해야|원해|원한|가자|하자|중요|현실적|맡을|맡겠|할게)")


def _rule_chat(room: Room, lines: list[dict], labels: list[str]) -> list[Stance]:
    """규칙: 쟁점마다 입장을 밝힌 내 말 중 선호 표현이 있는 가장 나중 줄을 주장으로,
    숫자·이유가 있는 줄을 근거로, '꼭·반드시' 같은 조건은 양보 불가선으로 나눈다."""
    out = []
    for issue in room.issues:
        lex = issue_lexicon(issue)
        best = None
        for n, ln in enumerate(lines):
            t = ln["text"]
            pos = stance_position(issue, t) if issue.options else ""
            overlap = len(set(tokens(t)) & lex)
            if issue.options and not pos:
                continue
            if not issue.options and (overlap < 2 or not ko.STANCE_CUES.search(t)):
                continue
            cond_only = bool(ko.red_line(t)) and not _PREFER.search(re.sub(r"(꼭|반드시|절대)\s*\S+", "", t))
            score = (2 if _PREFER.search(t) else 0) - (2 if cond_only else 0) + n / max(1, len(lines))   # 나중 말일수록 지금 생각
            if not best or score >= best[0]:
                best = (score, n, t, pos)
        if not best:
            continue
        _, n, t, pos = best
        reason, rn = "", None
        for m, ln in enumerate(lines):
            if m == n:
                continue
            s2 = ln["text"]
            sc = len(set(tokens(s2)) & lex) + (1.5 if re.search(r"\d", s2) else 0) + (1 if ko.GROUNDS.search(s2) else 0)
            if sc >= 2.5 and (rn is None or sc > reason[0]):
                reason, rn = (sc, s2), m
        red = next((ko.red_line(ln["text"]) for ln in lines
                    if (stance_position(issue, ln["text"]) == pos or not pos) and ko.red_line(ln["text"])), "")
        srcs = [labels[n]] + ([labels[rn]] if rn is not None else [])
        lead = re.compile(r"^(근데|그런데|그래서|그럼|아|음|일단|솔직히)\s+")       # 대화체 접속어는 입장 문장에서 뺀다
        claim = ko.casual_to_polite(lead.sub("", t))
        why = ko.casual_to_polite(lead.sub("", reason[1])) if reason else ""
        if red and red.rstrip(".") in claim:
            red = ""                                        # 주장 문장과 같은 조건은 두 번 쓰지 않는다
        out.append(Stance(new_id("s"), issue.id, claim, pos, why, "", red, "", 2, srcs, "candidate", "chat"))
    return out


async def chat_candidates(room: Room, p: Persona, lines: list[dict]) -> tuple[list[Stance], str]:
    """내 채팅 말 → 쟁점별 입장 카드 초안 (본인 확인 전에는 근거로 쓰지 않는다)."""
    labels = [f"채팅 {n + 1}" for n in range(len(lines))]
    # 쟁점과 관련 있는 줄만 모델에 보낸다 (보내는 양을 줄인다)
    lex = set().union(*(issue_lexicon(i) for i in room.issues)) if room.issues else set()
    keep = [n for n, ln in enumerate(lines) if set(tokens(ln["text"])) & lex][-60:]
    out: list[Stance] = []
    engine = llm.RULE
    if keep and room.issues:
        from .persona import _EXTRACT_SCHEMA
        issues_txt = "\n".join(
            f"- {i.id}: {i.title}" + (f" (선택지: {', '.join(o['label'] for o in i.options)})" if i.options else "")
            for i in room.issues)
        paras = "\n".join(f"[{labels[n]}] {lines[n]['text']}" for n in keep)
        sys_p, user_p, _ = llm.prompt("extract", issues=issues_txt, paragraphs=paras)
        sys_p += "\n- 이 글은 보고서가 아니라 본인이 단톡방에서 한 말들입니다. 반말이어도 1인칭 존댓말로 바꿔 쓰되 뜻은 바꾸지 않습니다."
        data, engine = await llm.call_json("extract", "slow", sys_p, user_p, _EXTRACT_SCHEMA, temperature=0.1,
                                           max_tokens=900)
        if data is not None:
            valid = {i.id: i for i in room.issues}
            for d in data.get("stances", []):
                issue = valid.get(d.get("issue_id", ""))
                claim = (d.get("claim") or "").strip()
                srcs = [s for s in d.get("sources", []) if s in labels]
                if not issue or not claim or not srcs:
                    continue
                pos = d.get("position", "")
                if pos not in {o["label"] for o in issue.options}:
                    pos = detect_position(issue, claim)
                out.append(Stance(new_id("s"), issue.id, claim, pos, d.get("reasons", ""), d.get("warrant", ""),
                                  d.get("red_line", ""), d.get("unknown", ""), int(d.get("priority") or 2), srcs,
                                  "candidate", "chat"))
    if not out:
        out, engine = _rule_chat(room, lines, labels), llm.RULE
    return out, engine


def import_chat(room: Room, p: Persona, lines: list[dict], stances: list[Stance], source: str) -> None:
    """내 말은 '지난 발언'으로 남겨 2차 검증(이전 발언과 충돌)에 쓰고, 초안 카드는 같은 쟁점의 예전 초안을 바꾼다."""
    when = {"kakao": "단톡방", "slack": "슬랙", "discord": "디스코드"}.get(source, "채팅")
    for ln in lines[-80:]:
        issue_id, _ = detect_issue(room, ln["text"])
        p.past.append({"text": ln["text"], "issue_id": issue_id, "when": f"{when} {ln['when']}".strip()})
    p.past = p.past[-200:]
    ids = {s.issue_id for s in stances}
    p.stances = [s for s in p.stances if not (s.status == "candidate" and s.origin == "chat" and s.issue_id in ids)]
    p.stances.extend(stances)
    p.touch()


# ---------------------------------------------------------------- 4. 자료 파일 → 글 (쪽 번호 포함)
class ExtractError(ValueError):
    pass


def _decode(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ExtractError("글자 인코딩을 읽을 수 없어요.")


def _xml_text(xml: str, tag: str) -> list[str]:
    """XML 안의 문단 단위 글. tag = 'a:p'(pptx) | 'hp:p'(hwpx) | 'w:p'(docx)."""
    ns = tag.split(":")[0]
    paras = []
    for para in re.findall(rf"<{tag}[ >].*?</{tag}>", xml, flags=re.S):
        t = "".join(re.findall(rf"<{ns}:t(?:\s[^>]*)?>(.*?)</{ns}:t>", para, flags=re.S))
        t = re.sub(r"<[^>]+>", "", t)
        t = t.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'").replace("&amp;", "&")
        if t.strip():
            paras.append(t.strip())
    return paras


def extract_file(name: str, raw: bytes) -> dict:
    """파일 → {text, pages(쪽별 글, 모르면 None), source, warnings}. 저장하지 않는다 (미리보기용)."""
    name = (name or "").lower()
    warnings: list[str] = []
    if name.endswith((".txt", ".md", ".markdown")):
        return {"text": _decode(raw), "pages": None, "source": "txt", "warnings": warnings}
    if name.endswith(".docx"):
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                xml = z.read("word/document.xml").decode("utf-8")
        except Exception:
            raise ExtractError("docx 파일을 읽을 수 없어요.")
        if "<w:tbl" in xml:
            warnings.append("표가 있어요. 표 안의 글은 칸 순서대로 이어 붙여져서 뜻이 어색할 수 있어요.")
        if "<w:drawing" in xml or "<pic:pic" in xml:
            warnings.append("그림이 있어요. 그림 속 글자는 읽지 못했어요.")
        return {"text": "\n\n".join(_xml_text(xml, "w:p")), "pages": None, "source": "docx", "warnings": warnings}
    if name.endswith(".pptx"):
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                slides = sorted((n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)),
                                key=lambda n: int(re.search(r"(\d+)\.xml$", n).group(1)))
                pages = ["\n\n".join(_xml_text(z.read(n).decode("utf-8"), "a:p")) for n in slides]
                notes = sum(1 for n in z.namelist() if n.startswith("ppt/notesSlides/"))
                pics = sum(1 for n in z.namelist() if n.startswith("ppt/media/"))
        except Exception:
            raise ExtractError("pptx 파일을 읽을 수 없어요.")
        if pics:
            warnings.append(f"그림·차트 {pics}개 속 글자는 읽지 못했어요. 중요한 숫자는 아래에서 직접 적어 주세요.")
        if notes:
            warnings.append("발표자 노트는 넣지 않았어요.")
        return {"text": "\n\n".join(x for x in pages if x), "pages": pages, "source": "pptx", "warnings": warnings}
    if name.endswith(".hwpx"):
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                secs = sorted((n for n in z.namelist() if re.match(r"Contents/section\d+\.xml$", n, flags=re.I)),
                              key=lambda n: int(re.search(r"(\d+)\.xml$", n).group(1)))
                text = "\n\n".join("\n\n".join(_xml_text(z.read(n).decode("utf-8"), "hp:p")) for n in secs)
        except Exception:
            raise ExtractError("hwpx 파일을 읽을 수 없어요.")
        return {"text": text, "pages": None, "source": "hwpx", "warnings": warnings}
    if name.endswith(".hwp"):
        raise ExtractError("한글 .hwp는 읽을 수 없어요. 한글에서 '다른 이름으로 저장 → hwpx' 또는 PDF로 저장해 올려 주세요.")
    if name.endswith(".pdf"):
        pages = None
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(raw))
            pages = [(pg.extract_text() or "") for pg in reader.pages]
        except ImportError:
            pass
        except Exception:
            raise ExtractError("PDF 파일을 읽을 수 없어요. 암호가 걸려 있거나 손상됐을 수 있어요.")
        if pages is None:
            try:
                from docling.document_converter import DocumentConverter   # 선택: Docling (MIT)
                import tempfile
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
                    f.write(raw)
                return {"text": DocumentConverter().convert(f.name).document.export_to_markdown(), "pages": None,
                        "source": "pdf", "warnings": warnings}
            except ImportError:
                raise ExtractError("PDF를 읽으려면 서버에 pypdf를 설치해 주세요 (pip install pypdf). 지금은 내용을 붙여 넣어 주세요.")
        empty = [n + 1 for n, t in enumerate(pages) if len(t.strip()) < 20]
        if pages and len(empty) == len(pages):
            raise ExtractError("PDF에서 글자를 찾지 못했어요. 스캔한 이미지 PDF 같아요. 내용을 붙여 넣어 주세요.")
        if empty:
            shown = ", ".join(map(str, empty[:6])) + (" 등" if len(empty) > 6 else "")
            warnings.append(f"{shown}쪽에서는 글자를 거의 찾지 못했어요. 그림이나 스캔이면 직접 적어 주세요.")
        if any(re.search(r"(\S+\s{2,}){3,}\S+", t) for t in pages):
            warnings.append("표처럼 보이는 부분이 있어요. 칸이 뒤섞였을 수 있으니 숫자를 확인해 주세요.")
        return {"text": "\n\n".join(t for t in pages if t.strip()), "pages": pages, "source": "pdf", "warnings": warnings}
    raise ExtractError("txt · md · docx · pdf · pptx · hwpx 파일만 올릴 수 있어요.")


# ---------------------------------------------------------------- 5. 미니미 파일 내보내기·불러오기
EXPORT_KIND = "minime-persona"


def export_persona(room: Room, p: Persona) -> dict:
    """내 미니미를 파일로. 다른 사람 정보(남긴 질문의 질문자, 회의 대화)는 넣지 않는다."""
    issues = {i.id: i.title for i in room.issues}
    return {
        "kind": EXPORT_KIND, "version": 1, "exported_at": time.time(),
        "name": p.name, "role": p.role,
        "profile": asdict(p.profile), "scope": asdict(p.scope),
        "reports": [{"title": r.title, "paragraphs": r.paragraphs, "source": r.source, "pages": r.pages} for r in p.reports],
        "stances": [{**{k: v for k, v in asdict(s).items() if k not in ("id", "ts", "status")},
                     "issue_title": issues.get(s.issue_id, "")}
                    for s in p.stances if s.status == "confirmed" and s.origin != "memo"],
    }


def _match_issue(room: Room, st: dict) -> str:
    """다른 방의 입장 카드 → 이 방의 쟁점. 제목이 같거나 선택지가 맞을 때만 붙인다."""
    title = str(st.get("issue_title") or "")
    for i in room.issues:
        if title and i.title == title:
            return i.id
    pos = str(st.get("position") or "")
    for i in room.issues:
        if pos and pos in {o["label"] for o in i.options}:
            return i.id
    issue_id, score = detect_issue(room, str(st.get("claim") or ""))
    return issue_id if score >= 1.0 else ""


def import_persona(room: Room, p: Persona, data: dict) -> dict:
    if not isinstance(data, dict) or data.get("kind") != EXPORT_KIND:
        raise ValueError("MINIME에서 내보낸 미니미 파일이 아니에요.")
    prof = data.get("profile") or {}
    for key, n, ln in (("expertise", 8, 20), ("criteria", 3, 40), ("projects", 3, 160), ("tone_examples", 3, 80)):
        vals = [str(x).strip()[:ln] for x in prof.get(key, []) if str(x).strip()][:n]
        if vals and not getattr(p.profile, key):
            setattr(p.profile, key, vals)
    if prof.get("intro") and not p.profile.intro:
        p.profile.intro = str(prof["intro"])[:120]
    added_r = 0
    have = {tuple(r.paragraphs) for r in p.reports}
    for r in (data.get("reports") or [])[:5]:
        paras = [str(x)[:600] for x in (r.get("paragraphs") or []) if str(x).strip()][:40]
        if paras and tuple(paras) not in have:
            pages = [int(x) for x in (r.get("pages") or []) if str(x).isdigit()]
            p.reports.append(Report(new_id("r"), str(r.get("title") or "불러온 자료")[:60], paras, source="import",
                                    pages=pages if len(pages) == len(paras) else []))
            added_r += 1
    added_s = 0
    for st in (data.get("stances") or [])[:30]:
        claim = str(st.get("claim") or "").strip()[:300]
        if not claim:
            continue
        p.stances.append(Stance(new_id("s"), _match_issue(room, st), claim, str(st.get("position") or "")[:20],
                                str(st.get("reasons") or "")[:300], str(st.get("warrant") or "")[:200],
                                str(st.get("red_line") or "")[:200], str(st.get("unknown") or "")[:200],
                                max(1, min(3, int(st.get("priority") or 2))), ["지난 미니미"], "candidate", "import"))
        added_s += 1
    p.touch()
    return {"reports": added_r, "stances": added_s}
