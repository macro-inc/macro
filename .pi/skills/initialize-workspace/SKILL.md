---
name: initialize-workspace
description: Initialize the current repo when an agent first starts in a repository. Use at the beginning of every new agent session before editing files: set up direnv on NixOS when direnv is installed, then run `just rust/cloud-storage/setup_test_envs`.
allowed-tools: Bash Read
---

# Initialize Workspace

Run this skill once near the beginning of a new agent session for this repository, before making other changes. Do not rerun it in the same session unless the user asks or the earlier run failed for an environmental reason that has since been fixed.

## Working Directory

Run all commands from the repository root.

## Steps

1. Set up `.envrc` and allow direnv only when both conditions are true:
   - The machine is running NixOS.
   - `direnv` is installed and available on `PATH`.

   Use this safe wrapper so the direnv command is never run on unsupported systems:

   ```bash
   if { [ -e /etc/NIXOS ] || ( [ -f /etc/os-release ] && . /etc/os-release && [ "${ID:-}" = "nixos" ] ); } && command -v direnv >/dev/null 2>&1; then
     echo -e "use flake\nwatch_file nix/*.nix" > .envrc && direnv allow
   else
     echo "Skipping direnv setup: requires NixOS and direnv on PATH"
   fi
   ```

2. Always run the test-environment setup command:

   ```bash
   just rust/cloud-storage/setup_test_envs
   ```

If any command fails, stop and report the failure before proceeding with repo work.

## Final Response

Briefly say whether direnv setup ran or was skipped, and whether `just rust/cloud-storage/setup_test_envs` passed.
