import json
import os
import secrets
import time
from pathlib import Path


HOME_DIR = Path(os.environ.get("TEND_HOME", str(Path.home() / ".tend")))
CRED_FILE = HOME_DIR / "credentials"
STATE_FILE = HOME_DIR / "state.json"


def _ensure_home() -> None:
    HOME_DIR.mkdir(parents=True, exist_ok=True)


def write_credentials(workspace: str) -> str:
    _ensure_home()
    token = "tend_sandbox_" + secrets.token_hex(16)
    CRED_FILE.write_text(
        json.dumps(
            {"workspace": workspace, "token": token, "issued_at": int(time.time())},
            indent=2,
        )
    )
    os.chmod(CRED_FILE, 0o600)
    return token


def read_credentials() -> dict:
    if not CRED_FILE.exists():
        return {}
    try:
        return json.loads(CRED_FILE.read_text())
    except json.JSONDecodeError:
        return {}


def load_state() -> dict:
    _ensure_home()
    if not STATE_FILE.exists():
        return _default_state()
    try:
        return json.loads(STATE_FILE.read_text())
    except json.JSONDecodeError:
        return _default_state()


def save_state(state: dict) -> None:
    _ensure_home()
    STATE_FILE.write_text(json.dumps(state, indent=2))


def _default_state() -> dict:
    return {
        "workspaces": {},
        "targets": {
            "staging": {"deployed_version": None, "migrations": []},
            "production": {"deployed_version": None, "migrations": []},
        },
        "runs": [],
        "policies": {},
        "resolution_queue": [],
    }
