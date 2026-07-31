#!/usr/bin/env bash
# Bring the sandbox to "ready" no matter its current state. Every stage skips
# itself when already done, so this is safe to run on first boot, reconnect,
# or after a machine restart. REPO_URL and GITHUB_TOKEN come from the sandbox
# environment.
set -eo pipefail

gh auth setup-git --hostname github.com --force

if [ ! -d /workspace/.git ]; then
  git clone --depth 1 "$REPO_URL" /workspace
fi

# Start the sidecar with the baked repo dev shell first on PATH and the base
# tools (opencode, gh, github-mcp-server) still reachable. The sidecar reads
# ACP_TOKEN from the environment to authenticate bridge connections.
if ! curl -sf localhost:8700/ping >/dev/null 2>&1; then
  baked_path="$PATH"
  if [ -f /env/repo-dev-env.sh ]; then
    # shellcheck disable=SC1091
    source /env/repo-dev-env.sh
    export PATH="$PATH:$baked_path"
  fi
  nohup /opt/acp-sidecar >/tmp/acp-sidecar.log 2>&1 &
fi
