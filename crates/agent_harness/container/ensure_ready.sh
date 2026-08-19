#!/usr/bin/env bash
# Bring a booted sandbox to "ready", idempotently.
#
# Run by `agent_harness::outbound::provision::ensure_ready_command`, which embeds
# this file with `include_str!`. Every stage skips itself when already done, so
# this is safe on first boot, on reconnect, and after a machine restart.
#
# The paths below are properties of the container image (see the service's
# `container/Dockerfile`), not configuration, which is why they live here rather
# than in Rust. The one value Rust also needs is the sidecar port, because it
# has to dial the sidecar afterwards - `provision::SIDECAR_PORT` mirrors it and
# a test asserts the two agree.
#
# REPO_URL and GITHUB_TOKEN come from the sandbox environment, set at creation.
# They are never interpolated into this script.
set -e

workspace_dir=/workspace
sidecar_port=8700
# Macro dev shell baked into the image at build time; absent on images built
# without the github_token secret.
repo_env_file=/env/repo-dev-env.sh
sidecar_log=/tmp/acp-sidecar.log

# 1. Credentials, so the clone below can read a private repo.
gh auth setup-git --hostname github.com --force

# 2. The repo, unless it is already cloned.
if [ ! -d "$workspace_dir/.git" ]; then
  git clone --depth 1 "$REPO_URL" "$workspace_dir"
fi

# 3. The sidecar, unless it is already answering. The baked dev shell goes
#    first on PATH, with the image's own tools (opencode, gh) still reachable
#    behind it.
#
#    Checked explicitly because `nohup ... &` backgrounds the process, so its
#    failure is invisible to `set -e` - a missing binary would otherwise show up
#    only as a readiness timeout a minute later, with nothing to point at it.
if [ ! -x /opt/acp-sidecar ]; then
  echo "no executable /opt/acp-sidecar in this image; was it built into it?" >&2
  exit 1
fi

if ! curl -sf "localhost:$sidecar_port/ping" >/dev/null 2>&1; then
  baked_path="$PATH"
  if [ -f "$repo_env_file" ]; then
    # shellcheck disable=SC1090
    source "$repo_env_file"
    export PATH="$PATH:$baked_path"
  fi
  nohup /opt/acp-sidecar >"$sidecar_log" 2>&1 &
fi
