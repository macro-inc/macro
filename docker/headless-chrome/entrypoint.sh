#!/bin/bash
# Chromium on a virtual display, watchable over noVNC, driveable over CDP.
#  :99      Xvfb virtual display
#  5900     x11vnc (loopback only — noVNC is the public face)
#  6080     noVNC web client (http://localhost:6080/vnc.html)
#  9222     CDP, socat-forwarded because Chrome only binds loopback
set -euo pipefail

WIDTH="${SCREEN_WIDTH:-1600}"
HEIGHT="${SCREEN_HEIGHT:-1000}"
export DISPLAY=:99

Xvfb :99 -screen 0 "${WIDTH}x${HEIGHT}x24" -nolisten tcp &
# Wait for the display before anything tries to attach to it.
for _ in $(seq 1 50); do
  [ -e /tmp/.X11-unix/X99 ] && break
  sleep 0.1
done

x11vnc -display :99 -listen 127.0.0.1 -nopw -forever -shared -quiet -bg
websockify --web /usr/share/novnc 6080 127.0.0.1:5900 &

# Not --headless: rendering to the Xvfb display is what makes the session
# watchable. Agent-opened tabs all land in this one window.
chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --no-first-run \
  --disable-session-crashed-bubble \
  --window-size="${WIDTH},${HEIGHT}" \
  --window-position=0,0 \
  --remote-debugging-port=9223 \
  --remote-allow-origins='*' \
  --user-data-dir=/data/chrome-profile \
  about:blank &

exec socat tcp-listen:9222,fork,reuseaddr,bind=0.0.0.0 tcp:127.0.0.1:9223
