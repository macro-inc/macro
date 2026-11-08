# macrod's installer moved to crates/agents/macrod/install/install.ps1. This
# forwards the old URL, which install instructions published before the
# move still use:
#
#   irm https://raw.githubusercontent.com/macro-inc/macro/main/crates/coding_agent_worker/install/install.ps1 | iex
#
# MACROD_* environment variables pass through unchanged.
irm https://raw.githubusercontent.com/macro-inc/macro/main/crates/agents/macrod/install/install.ps1 | iex
