#!/usr/bin/env bash
# Run as root inside a macro-box guest: enrollment finds Claude Code with its
# ACP adapter already installed, so macrod never runs npm.
set -euo pipefail

environment=$(systemctl show macrod-enroll.service --property=Environment --value)
systemd-run --quiet --wait --pipe --collect \
  --property="Environment=$environment" /usr/local/bin/macrod detect-agents \
  | jq --exit-status 'any(.agents[]; .id == "claude-code" and .needs_install == false)'
