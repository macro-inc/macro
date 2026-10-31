#!/usr/bin/env bash
# Start (or restart) Macro Connect's browser: Chromium signed in only as
# connect@macro.com. Same image as the shared agent browser, different ports
# and a dedicated profile volume. Loopback only; watch over SSH:
#   ssh -L 6081:localhost:6081 <host>  then open http://localhost:6081/vnc.html
# Agents drive it over CDP at http://localhost:9333.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
docker rm -f macro-connect-browser >/dev/null 2>&1 || true
docker run -d --name macro-connect-browser --restart unless-stopped --init \
  --network host --cap-add SYS_ADMIN \
  -v macro-connect-browser-profile:/data \
  -v "$here/entrypoint.sh:/entrypoint.sh:ro" \
  macro-local-headless-chrome:dev
