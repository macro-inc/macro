#!/bin/bash
# Chromium on a virtual display, watchable over noVNC, driveable over CDP.
# Runs with host networking (see docker-compose.yml); everything binds
# loopback deliberately — CDP controls a browser that may hold logged-in
# sessions and noVNC has no password, so nothing listens beyond the host.
#  :99   Xvfb virtual display
#  5900  x11vnc (loopback)
#  6080  noVNC web client (http://localhost:6080/vnc.html)
#  9222  CDP (Chrome binds loopback; host networking makes that the host's)
set -euo pipefail

WIDTH="${SCREEN_WIDTH:-1600}"
HEIGHT="${SCREEN_HEIGHT:-1000}"
export DISPLAY=:99

# A container *restart* keeps /tmp; a stale lock makes Xvfb refuse to start.
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

Xvfb :99 -screen 0 "${WIDTH}x${HEIGHT}x24" -nolisten tcp &
for _ in $(seq 1 50); do
  [ -e /tmp/.X11-unix/X99 ] && break
  sleep 0.1
done
[ -e /tmp/.X11-unix/X99 ] || {
  echo "Xvfb failed to start" >&2
  exit 1
}

x11vnc -display :99 -listen 127.0.0.1 -nopw -forever -shared -quiet -bg
websockify --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 &

# Chromium is the foreground process: if it dies, the container exits and the
# restart policy brings the whole display stack back. (A backgrounded browser
# would leave the container "healthy" with nothing behind the CDP port.)
# Not --headless: rendering to the Xvfb display is what makes the session
# watchable. Agent-opened tabs all land in this one window.
exec chromium \
  --disable-dev-shm-usage \
  --no-first-run \
  --disable-session-crashed-bubble \
  --window-size="${WIDTH},${HEIGHT}" \
  --window-position=0,0 \
  --remote-debugging-port=9222 \
  --remote-allow-origins='*' \
  --user-data-dir=/data/chrome-profile \
  about:blank
