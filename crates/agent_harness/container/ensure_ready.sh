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
# REPO_URL, GITHUB_TOKEN and MACRO_PERSONA_PROMPT come from the sandbox
# environment, set at creation. They are never interpolated into this script.
# REPO_URL is absent when the persona named no repository.
set -e

workspace_dir=/workspace
sidecar_port=8700
# Macro dev shell baked into the image at build time; absent on images built
# without the github_token secret.
repo_env_file=/env/repo-dev-env.sh
sidecar_log=/tmp/acp-sidecar.log
# Named by the baked opencode.json's `instructions`, so it must exist on every
# boot even when the persona has nothing to say.
persona_prompt_file=/etc/macro-agent/PERSONA.md

# 1. Credentials, so the clone below can read a private repo.
gh auth setup-git --hostname github.com --force

# 2. The persona's instructions. Rewritten every boot: the persona may have
#    been edited since this sandbox last started.
printf %s "${MACRO_PERSONA_PROMPT:-}" >"$persona_prompt_file"

#    Make sure the harness is actually told to read that file. The config is
#    baked into the image, so a sandbox running an older snapshot would write
#    the prompt and silently ignore it - the worst kind of failure, because the
#    agent still answers, just not as the persona. Adding the entry here
#    instead couples the prompt to the deployed service rather than to whenever
#    the snapshot was last rebuilt. Idempotent, so resuming is safe.
node <<'ENSURE_INSTRUCTIONS'
const fs = require('node:fs');
const path = '/root/.config/opencode/opencode.json';
const file = '/etc/macro-agent/PERSONA.md';
const config = JSON.parse(fs.readFileSync(path, 'utf8'));
config.instructions = config.instructions ?? [];
if (!config.instructions.includes(file)) {
  config.instructions.push(file);
  fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}
ENSURE_INSTRUCTIONS

# 3. The repo, unless it is already cloned - or unless the persona named none,
#    in which case the agent works in an empty workspace and there is no
#    default repository standing behind it.
#
#    The mkdir is not redundant: `git clone` is what used to create the
#    workspace, so without it a repo-less persona leaves the harness to start
#    in a directory that does not exist. opencode exits immediately when that
#    happens, and the session hangs on "waiting for harness" until it is
#    reaped - no error anywhere, because nothing failed loudly.
mkdir -p "$workspace_dir"
if [ -n "${REPO_URL:-}" ] && [ ! -d "$workspace_dir/.git" ]; then
  git clone --depth 1 "$REPO_URL" "$workspace_dir"
fi

# 4. The sidecar, unless it is already answering. The baked dev shell goes
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
