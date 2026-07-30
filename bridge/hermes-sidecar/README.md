# tend Hermes sidecar

Thin Python service the Node bridge talks to over plain HTTP+SSE so it
never has to deal with Python imports or per-tenant agent state.

```
bridge.js  --POST /chat-->  sidecar.py  --calls-->  hermes-agent (Python)
           <--SSE stream--             <--stream--
```

## Endpoints

| Method | Path       | Purpose                                      |
| ------ | ---------- | -------------------------------------------- |
| GET    | /healthz   | Liveness probe                               |
| POST   | /chat      | `{agent, message}` -> SSE stream of deltas   |

Wire format (matches `bridge/bridge.js`):

```
data: {"delta": "chunk of text"}
...
data: [DONE]
```

Errors come back as `data: {"error": "..."}` then the stream closes.

## Wiring Hermes

`sidecar.py` ships with a stub so the chat UI works end to end before
Hermes is installed. To go live, replace the body of `_stream_response`
with a real call to the Hermes agent runtime. The simplest path:

```python
from hermes.agent import Agent  # verify import path against the live source

async def _stream_response(agent_name, message):
    agent = Agent.load(agent_name, config_dir=HERMES_CONFIG_DIR)
    async for chunk in agent.stream(message):
        yield chunk
```

Then uncomment the `hermes-agent` line in `requirements.txt` and rebuild
the image.

## Local run

```
pip install -r requirements.txt
HERMES_CONFIG_DIR=./agents uvicorn sidecar:app --host 0.0.0.0 --port 8500
```

## Container run

The bundled `Dockerfile` plus `deploy/docker-compose.yml` wire this up
alongside the Node bridge, Nango, Postgres, and Caddy. See
`deploy/README.md` for the VPS install flow.
