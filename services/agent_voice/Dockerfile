FROM python:3.13-slim AS build
ENV PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt .
RUN python -m venv .venv && .venv/bin/pip install --no-cache-dir -r requirements.txt
COPY *.py ./
RUN .venv/bin/python worker.py download-files

FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH"
RUN useradd --create-home --uid 10001 macro-voice
WORKDIR /app
COPY --from=build --chown=macro-voice:macro-voice /app /app
# Silero keeps its packaged model with the installed plugin.
USER macro-voice
CMD ["python", "worker.py", "start"]
