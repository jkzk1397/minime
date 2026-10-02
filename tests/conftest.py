import os
import socket
import sys
import tempfile
import threading
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="mymini-test-"))
os.environ["LLM_ORDER"] = os.environ.get("TEST_LLM_ORDER", "rule")
os.environ["COOLDOWN_SEC"] = "0"


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture(scope="session")
def fake_llm():
    """가짜 LLM 서버를 백그라운드 스레드로 띄운다."""
    import uvicorn
    from tests import fake_llm as fl
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(fl.app, host="127.0.0.1", port=port, log_level="error"))
    th = threading.Thread(target=server.run, daemon=True)
    th.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    yield {"url": f"http://127.0.0.1:{port}", "state": fl.STATE}
    server.should_exit = True
    th.join(timeout=5)
