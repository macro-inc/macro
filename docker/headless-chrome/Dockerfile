# Watchable "headless" Chrome for agents: real Chromium on an Xvfb display,
# CDP on 9222 (via socat — Chrome hard-binds DevTools to loopback), and the
# display streamed over noVNC on 6080 so a human can watch what an agent is
# doing in the browser. See the `headless-chrome` service in
# docker/docker-compose.yml.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    socat \
    fonts-liberation \
    fonts-noto-color-emoji \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY docker/headless-chrome/entrypoint.sh /entrypoint.sh

EXPOSE 9222 6080

ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]
