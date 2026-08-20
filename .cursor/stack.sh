#!/usr/bin/env bash
set -euo pipefail

# On-demand product stack. start.sh is infra-only so cargo-test agents do not
# boot FusionAuth. Binaries come from $HOME/.cache/macro-cloud (survives
# checkout). --no-build skips zigbuild. Do not pass --build-aux-services.

# shellcheck source=cloud-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cloud-lib.sh"

bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/start.sh"

cd /workspace
nix develop --command bash -lc "
  set -euo pipefail
  export PATH=\"\${HOME}/.nix-profile/bin:\${PATH}\"
  export MACRO_STACK_SNAPSHOT_DIR='${MACRO_STACK_SNAPSHOT_DIR}'
  just stack up --no-doppler --no-build
"

echo "cursor-cloud stack: app ready"
