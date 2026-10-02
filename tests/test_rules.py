"""규칙 도구: 존댓말, 질문 종류, 호출, 수치, 입장·쟁점 인식, 안건 거리."""
from app import agenda, ko, seed


def test_polite_and_casual():
    assert ko.casual_to_polite("맞아 B안. 근데 공연 1팀은 남기자") == "네, 맞아요. B안이에요. 다만 공연 1팀은 남기는 게 좋겠어요."
    assert ko.casual_to_polite("나는 자료조사랑 질의응답 근거 정리 맡을게. 발표는 좀 부담돼") == \
        "저는 자료조사랑 질의응답 근거 정리 맡을게요. 발표는 좀 부담돼요."
    assert ko.polite("실제로 작년 체험 부스 중 3곳은 운영 인원이 부족해 둘째 날 문을 닫았다.").endswith("닫았어요.")
    assert ko.polite("리허설은 발표 전에 최소 두 번 해야 한다.") == "리허설은 발표 전에 최소 두 번 해야 해요."


def test_question_kind_and_mentions():
    assert ko.question_kind("민수 미니미, 무대 음향 장비 대여 업체는 알아봤어?") == "fact"
    assert ko.question_kind("하은이 생각은 어때?") == "opinion"
    assert ko.question_kind("발표에서 맡고 싶은 역할이 뭐야?") == "opinion"
    assert ko.question_kind("좋아. 그렇게 하자") == ""
    names = {"minsu": "민수", "haeun": "하은"}
    assert ko.addressed_mini("@민수 예산 어때?", names) == ["minsu"]
    assert ko.mentions("하은아 리허설 날짜 정해 줄 수 있지?", names) == ["haeun"]
    assert ko.COMMIT.search("하은아 리허설 날짜는 네가 정해 줄 수 있지?")
    assert ko.strip_address("하은 미니미, 타 대학 사례는 어떤 게 있어?", list(names.values())).startswith(", 타 대학")


def test_numbers():
    assert ko.numbers("만족도 조사 응답자가 2천 명이었어") == [(2000.0, "명", "응답자")]
    assert ko.numbers("예산의 90%가 공연비") == [(90.0, "%", "예산")]


def test_position_and_issue():
    i1 = seed.ISSUES[0]
    assert agenda.detect_position(i1, "나는 공연이 축제의 얼굴이라 A안이 현실적이라고 봐") == "A안"
    assert agenda.detect_position(i1, "A안보다 B안이 낫다") == "B안"
    assert agenda.detect_position(i1, "연예인 섭외비를 줄이고 학생 참여 프로그램 예산을 늘리는 B안을 제안해야 한다") == "B안"
    assert agenda.detect_position(i1, "무대 음향 장비 대여 업체는 알아봤어?") == ""        # 단서어만으론 입장 아님
    assert agenda.stance_position(seed.ISSUES[1], "타 대학 사례는 어떤 게 있어?") == ""   # 질문은 입장 아님
    room = seed.fresh_room("t-rules")
    assert agenda.detect_issue(room, "하은아 리허설 날짜는 네가 정해 줄 수 있지?")[0] == "i3"
    assert agenda.detect_issue(room, "설문으로 할까 사례 조사로 할까")[0] == "i2"


def test_drift_distance():
    room = seed.fresh_room("t-drift")
    assert agenda.distance(room, "근데 어제 축구 봤어? 손흥민 골 미쳤던데") == 1.0
    assert agenda.distance(room, "예산은 B안으로 가자. 학생 참여 프로그램이 중요해") < 0.5
    assert agenda.distance(room, "ㅋㅋ") is None                                   # 내용어 없는 맞장구는 제외
