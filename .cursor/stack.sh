#!/usr/bin/env bash
set -euo pipefail

# On-demand product stack. start.sh is infra-only so cargo-test agents do not
# boot FusionAuth. Binaries and the frontend bundle must already be in the
# snapshot (install.sh); --no-build skips the ~8 min zigbuild.
# Do not pass --build-aux-services.

export PATH="${HOME}/.nix-profile/bin:/nix/var/nix/profiles/default/bin:${PATH}"

bash /workspace/.cursor/start.sh

cd /workspace
nix develop --command bash -lc '
  set -euo pipefail
  export PATH="${HOME}/.nix-profile/bin:${PATH}"
  just stack up --no-doppler --no-build
'

echo "cursor-cloud stack: app ready"
