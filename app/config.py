import os
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")
SPEAK_THRESHOLD = float(os.getenv("SPEAK_THRESHOLD", "0.6"))
MAX_ROUNDS = int(os.getenv("MAX_ROUNDS", "4"))
AWAY_BOOST = 0.3          # 자리 비운 사람의 미니미 가산점
PRESENT_FACTOR = 0.85     # 참여 중인 사람의 미니미는 덜 끼어든다
SHORT_TERM_N = 30         # 단기 기억: 최근 메시지 수
MOCK = not OPENAI_API_KEY
