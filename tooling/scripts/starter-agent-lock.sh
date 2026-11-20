#!/usr/bin/env bash
# Write packages/starter-agent/bun.lock as a standalone lockfile: an agent's
# repo is rendered from that directory outside the monorepo, and its image
# installs node_modules from exactly this lock. `--check` fails instead of
# writing when the committed lock is stale.
# Run it inside `nix develop`: the image installs with the devshell's Bun,
# which reads only lockfile version 1.
set -euo pipefail

case "$(bun --version)" in
  1.3.*) ;;
  *) echo "run inside nix develop: Bun $(bun --version) writes a lockfile the image's Bun cannot read" >&2; exit 1 ;;
esac

repo_root=$(git rev-parse --show-toplevel)
package="$repo_root/packages/starter-agent"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

cp "$package/package.json" "$scratch/package.json"
if [ "${1:-}" = "--check" ]; then
  cp "$package/bun.lock" "$scratch/bun.lock"
  (cd "$scratch" && bun install --lockfile-only --frozen-lockfile --no-progress >/dev/null) \
    || { echo "packages/starter-agent/bun.lock is stale: run tooling/scripts/starter-agent-lock.sh" >&2; exit 1; }
  exit 0
fi
(cd "$scratch" && bun install --lockfile-only --no-progress >/dev/null)
cp "$scratch/bun.lock" "$package/bun.lock"
echo "wrote packages/starter-agent/bun.lock"
