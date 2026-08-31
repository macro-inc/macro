# Watchable "headless" Chrome for agents: real Chromium on an Xvfb display,
# CDP on 9222, and the display streamed over noVNC on 6080 so a human can
# watch what an agent is doing in the browser. See the `headless-chrome`
# service in docker/docker-compose.yml. No EXPOSE: the service runs with host
# networking, ports are documented in entrypoint.sh.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    fonts-liberation \
    fonts-noto-color-emoji \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY docker/headless-chrome/entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]
