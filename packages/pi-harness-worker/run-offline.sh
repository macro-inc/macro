#!/usr/bin/env bash
set -euo pipefail

# Give Pi a synthetic home and an allowlist of environment variables before import.
proof_root=$(mktemp -d /tmp/pi-harness-proof.XXXXXX)
trap 'rm -rf -- "$proof_root"' EXIT
mkdir -p "$proof_root"/{home/.pi/agent,project/.pi,agent}
for fixture in home/.pi/agent project/.pi; do
  printf '{"extensions":["./unexpected-extension.ts"]}\n' > "$proof_root/$fixture/settings.json"
  printf 'throw new Error("Unexpected Pi discovery");\n' > "$proof_root/$fixture/unexpected-extension.ts"
done
printf "Unexpected project instructions\n" > "$proof_root/project/AGENTS.md"

env -i PI_PROOF_ROOT="$proof_root" HOME="$proof_root/home" PI_OFFLINE=1 PI_TELEMETRY=0 \
  "$(command -v bun)" --no-env-file test --tsconfig-override="$PWD/tsconfig.json" --timeout 5000 "$@" ./offline.test.ts
