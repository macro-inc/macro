#!/usr/bin/env bash
# Re-resolve package-lock.json for the ACP adapter version macrod pins in
# crates/coding_agent_worker/src/tui/agent_catalog/claude_code.rs.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pin="$here/../../../crates/coding_agent_worker/src/tui/agent_catalog/claude_code.rs"
version="$(sed -n 's|.*"@agentclientprotocol/claude-agent-acp@\([^"]*\)".*|\1|p' "$pin")"
[ -n "$version" ] || { echo "no adapter pin in $pin" >&2; exit 1; }

if [ -z "${MACRO_BOX_LOCK_IN_SHELL:-}" ]; then
  export MACRO_BOX_LOCK_IN_SHELL=1
  exec nix shell nixpkgs#nodejs_24 nixpkgs#jq --command bash "${BASH_SOURCE[0]}"
fi

jq -n --arg version "$version" '{
  name: "macro-box-claude-agent-acp",
  version: $version,
  private: true,
  dependencies: { "@agentclientprotocol/claude-agent-acp": $version }
}' > "$here/package.json"
rm -f "$here/package-lock.json"
(cd "$here" && npm install --package-lock-only --no-audit --no-fund --loglevel=error)
