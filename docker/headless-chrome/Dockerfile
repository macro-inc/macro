# Watchable "headless" Chrome for agents: real Chromium on an Xvfb display,
# CDP on 9222, and the display streamed over noVNC on 6080 so a human can
# watch what an agent is doing in the browser. See the `headless-chrome`
# service in docker/docker-compose.yml. No EXPOSE: the service runs with host
# networking, ports are documented in entrypoint.sh.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    chromium-sandbox \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    fonts-liberation \
    fonts-noto-color-emoji \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY docker/headless-chrome/entrypoint.sh /entrypoint.sh

# Non-root so Chromium's sandbox works and --no-sandbox (and its permanent
# warning infobar) isn't needed. Debian's chromium ships the setuid sandbox
# helper for kernels/seccomp setups where the namespace sandbox is blocked.
RUN useradd --create-home --uid 1000 chrome \
    && mkdir -p /data/chrome-profile \
    && chown -R chrome:chrome /data \
    # Non-root Xvfb can't create the X socket dir itself.
    && mkdir -p /tmp/.X11-unix \
    && chmod 1777 /tmp/.X11-unix
USER chrome

ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]
