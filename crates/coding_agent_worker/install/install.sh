#!/bin/sh
# macrod's installer moved to crates/agents/macrod/install/install.sh. This
# forwards the old URL, which install instructions published before the
# move still use:
#
#   curl -fsSL https://raw.githubusercontent.com/macro-inc/macro/main/crates/coding_agent_worker/install/install.sh | sh
#
# Flags and MACROD_* environment variables pass through unchanged.
set -eu
curl -fsSL https://raw.githubusercontent.com/macro-inc/macro/main/crates/agents/macrod/install/install.sh | sh -s -- "$@"
