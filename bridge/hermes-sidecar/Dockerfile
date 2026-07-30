FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY sidecar.py .

ENV HERMES_CONFIG_DIR=/var/lib/hermes/agents
EXPOSE 8500

CMD ["uvicorn", "sidecar:app", "--host", "0.0.0.0", "--port", "8500"]
