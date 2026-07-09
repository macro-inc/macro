---
name: initialize-workspace
description: "Initialize the current repo when an agent first starts in a repository. Use at the beginning of every new agent session before editing files by verifying the Pi bash tool is already running inside the repo Nix shell, setting up direnv on NixOS when available, then running `just rust/cloud-storage/setup_test_envs`."
allowed-tools: Bash Read
---

# Initialize Workspace

Run this skill once near the beginning of a new agent session for this repository, before making other changes. Do not rerun it in the same session unless the user asks or the earlier run failed for an environmental reason that has since been fixed.

## Working Directory

Run all commands from the repository root.

## Important Pi/Nix Behavior

A command such as `direnv allow`, `eval "$(direnv export bash)"`, or `nix develop -c "$SHELL"` only affects the child shell running that command. It cannot mutate the already-running Pi process or automatically change later `bash` tool calls.

This repository solves that with checked-in Pi project config:

- `.pi/settings.json` sets `shellPath` to `.pi/bin/nix-develop-shell`.
- `.pi/bin/nix-develop-shell` wraps Pi `bash` tool calls with `nix develop <repo> -c bash` only when `nix` and `flake.nix` are available; otherwise it falls back to plain `bash`.

After Pi starts or reloads with that setting, normal `bash` tool calls automatically run inside the repo Nix shell on machines with Nix. On machines without Nix, the wrapper is a no-op pass-through to `bash`. The wrapper deliberately uses `bash`, not `$SHELL`, because Pi's tool sends bash commands and user shells such as fish are not bash-compatible.

If the verification step below says the Nix shell is not active, stop and tell the user to run `/reload` or restart Pi from a trusted repo/workspace before continuing.

## Steps

### 1. Verify this agent's bash tool is already inside the Nix shell

```bash
set -euo pipefail

if [ -f flake.nix ] && command -v nix >/dev/null 2>&1; then
  if [ -n "${IN_NIX_SHELL:-}" ]; then
    echo "nix-shell-active: IN_NIX_SHELL=${IN_NIX_SHELL}"
  else
    echo "nix-shell-not-active: run /reload or restart Pi so .pi/settings.json shellPath is applied" >&2
    exit 1
  fi
else
  echo "nix-shell-check-skipped: no flake.nix or nix command unavailable"
fi
```

### 2. Set up `.envrc` and allow direnv only when supported

Run this only when both conditions are true:

- The machine is running NixOS.
- `direnv` is installed and available on `PATH`.

Use this safe wrapper so the direnv command is never run on unsupported systems:

```bash
if { [ -e /etc/NIXOS ] || ( [ -f /etc/os-release ] && . /etc/os-release && [ "${ID:-}" = "nixos" ] ); } && command -v direnv >/dev/null 2>&1; then
  echo -e "use flake\nwatch_file nix/*.nix" > .envrc
  direnv allow
  echo "direnv-setup-ran"
else
  echo "direnv-setup-skipped: requires NixOS and direnv on PATH"
fi
```

### 3. Run the test-environment setup command

```bash
just rust/cloud-storage/setup_test_envs
```

If any command fails, stop and report the failure before proceeding with repo work.

## Final Response

Briefly say whether the Nix shell verification passed, whether direnv setup ran or was skipped, and whether `just rust/cloud-storage/setup_test_envs` passed.
