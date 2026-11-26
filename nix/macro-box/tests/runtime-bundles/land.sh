#!/usr/bin/env bash
set -euo pipefail
cd /home/macro/agent/workspace
printf '\n// Fixture behavior changed by a land.\n' >> cli.ts
git add cli.ts
git commit -qm behavior-land
