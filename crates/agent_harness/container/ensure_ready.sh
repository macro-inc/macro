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
# MACRO_EGRESS_URL and MACRO_SESSION_TOKEN come from the sandbox environment.
# Git presents the latter only to the Macro egress origin; the proxy selects the
# repository from the session and exchanges it for a scoped GitHub App token.
set -e

workspace_dir=/workspace
sidecar_port=8700
# Macro dev shell baked into the image at build time, so a sandbox skips
# realizing it. Sourced only if present, so an image built without that layer
# still starts.
repo_env_file=/env/repo-dev-env.sh
sidecar_log=/tmp/acp-sidecar.log

# 1. The repo, unless it is already cloned. Scope the helper to Macro egress so
#    an agent cannot redirect the session token to another host.
if [ ! -d "$workspace_dir/.git" ]; then
  egress_git_url="${MACRO_EGRESS_URL%/}/git"
  git config --global "credential.${MACRO_EGRESS_URL}.helper" \
    '!f() { echo username=x-access-token; echo "password=$MACRO_SESSION_TOKEN"; }; f'
  git clone --depth 1 "$egress_git_url" "$workspace_dir"
fi

# 2. The sidecar, unless it is already answering. The baked dev shell goes
#    first on PATH, with the image's own tools still reachable behind it.
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
