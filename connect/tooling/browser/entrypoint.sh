#!/bin/bash
# Macro Connect's own browser: the shared agent browser's entrypoint
# (docker/headless-chrome/entrypoint.sh) on separate ports, with a profile
# that only ever holds the connect@macro.com sessions.
# Chromium on a virtual display, watchable over noVNC, driveable over CDP.
# Runs with host networking (see docker-compose.yml); everything binds
# loopback deliberately — CDP controls a browser that may hold logged-in
# sessions and noVNC has no password, so nothing listens beyond the host.
#  :98   Xvfb virtual display
#  5901  x11vnc (loopback)
#  6081  noVNC web client (http://localhost:6081/vnc.html)
#  9333  CDP (Chrome binds loopback; host networking makes that the host's)
set -euo pipefail

WIDTH="${SCREEN_WIDTH:-1600}"
HEIGHT="${SCREEN_HEIGHT:-1000}"
export DISPLAY=:98

# A container *restart* keeps /tmp; a stale lock makes Xvfb refuse to start.
rm -f /tmp/.X98-lock /tmp/.X11-unix/X98

Xvfb :98 -screen 0 "${WIDTH}x${HEIGHT}x24" -nolisten tcp &
for _ in $(seq 1 50); do
  [ -e /tmp/.X11-unix/X98 ] && break
  sleep 0.1
done
[ -e /tmp/.X11-unix/X98 ] || {
  echo "Xvfb failed to start" >&2
  exit 1
}

x11vnc -display :98 -listen 127.0.0.1 -rfbport 5901 -nopw -forever -shared -quiet -bg
websockify --web /usr/share/novnc 127.0.0.1:6081 127.0.0.1:5901 &

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
  --remote-debugging-port=9333 \
  --remote-allow-origins='*' \
  --user-data-dir=/data/chrome-profile \
  about:blank
