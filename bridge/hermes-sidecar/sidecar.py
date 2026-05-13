"""
tend Hermes sidecar.

Thin HTTP wrapper around the Hermes Python agent runtime
(https://github.com/NousResearch/hermes-agent). Exposes a single
streaming endpoint so the Node bridge can talk to Hermes via plain
JSON over HTTP without dealing with Python imports or process state.

Endpoints:
  GET  /healthz
  POST /chat   {agent, message, stream}  ->  SSE stream

Wire format (matches what bridge/bridge.js expects):
  Each event:    data: {"delta": "<chunk of text>"}
  Terminator:    data: [DONE]
  Error:         data: {"error": "<message>"}

Run locally:
  pip install -r requirements.txt
  HERMES_CONFIG_DIR=/var/lib/hermes/agents \
  uvicorn sidecar:app --host 0.0.0.0 --port 8500

Or via the bundled Dockerfile (docker-compose.yml in deploy/).
"""

import asyncio
import json
import os
from typing import AsyncIterator

from fastapi import FastAPI, Request, HTTPException
from sse_starlette.sse import EventSourceResponse

# ---------------------------------------------------------------------------
# Hermes integration point.
#
# Hermes is a Python package (`hermes-agent`). Once installed, the actual
# integration call replaces _stream_from_stub() below. The most likely
# patterns, in order of cleanliness:
#
#   1. Direct Python import. Pseudocode (verify module paths against the
#      live Hermes source once installed):
#
#          from hermes.agent import Agent
#          agent = Agent.load(agent_name, config_dir=HERMES_CONFIG_DIR)
#          async for chunk in agent.stream(message):
#              yield chunk
#
#   2. Subprocess invocation. Spawn `hermes --json --agent <name>` and
#      stream stdout. Slower per-turn but isolates per-tenant runtimes.
#
#   3. Hermes gateway webhook. Register the sidecar as a custom messaging
#      channel via `hermes gateway` configuration, then mirror events
#      from the gateway over here. Useful only if the project later wants
#      Telegram/Discord parity.
#
# Pick #1 first, fall back to #2 if you want hard tenant isolation.
# ---------------------------------------------------------------------------

HERMES_CONFIG_DIR = os.environ.get("HERMES_CONFIG_DIR", "/var/lib/hermes/agents")
ALLOW_ORIGIN = os.environ.get("ALLOW_ORIGIN", "*")

app = FastAPI()


@app.get("/healthz")
async def healthz():
    return {"ok": True, "hermes_config_dir": HERMES_CONFIG_DIR}


@app.post("/chat")
async def chat(req: Request):
    try:
        body = await req.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid json")

    agent_name = (body.get("agent") or "main").strip()
    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="message required")

    async def event_stream() -> AsyncIterator[dict]:
        try:
            async for chunk in _stream_response(agent_name, message):
                yield {"data": json.dumps({"delta": chunk})}
            yield {"data": "[DONE]"}
        except Exception as exc:  # surface the error to the bridge
            yield {"data": json.dumps({"error": str(exc)})}

    return EventSourceResponse(
        event_stream(),
        headers={"Access-Control-Allow-Origin": ALLOW_ORIGIN},
    )


async def _stream_response(agent_name: str, message: str) -> AsyncIterator[str]:
    """Yield chunks of text from the Hermes agent for `agent_name`.

    Replace the body of this function with the real Hermes call once the
    package is installed and you've confirmed the import path.
    """
    # ---- begin TODO: replace with Hermes call ----
    async for chunk in _stream_from_stub(agent_name, message):
        yield chunk
    # ---- end TODO ----


async def _stream_from_stub(agent_name: str, message: str) -> AsyncIterator[str]:
    """Echo placeholder so the bridge -> sidecar -> chat-UI path can be
    end-to-end tested before Hermes is fully wired."""
    preamble = f"[sidecar stub · agent={agent_name}] You asked: \"{message}\". "
    body = (
        "Hermes is not wired yet on this sidecar. Once you replace "
        "_stream_response() with a real call to the hermes-agent Python "
        "package, this stream will be the agent's actual answer, grounded "
        "in your tenant's data via the skills you've configured."
    )
    for word in (preamble + body).split(" "):
        yield word + " "
        await asyncio.sleep(0.02)
