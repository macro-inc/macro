use mcp_auth_proxy::domain::redirect_uri::{RedirectTrust, RedirectUriPolicy};

use super::*;

#[test]
fn default_redirect_hosts_trust_cursor_web_agent_callbacks() {
    let policy = RedirectUriPolicy::new(DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS);

    assert_eq!(
        policy.trust("https://cursor.com/agents/mcp/oauth/callback"),
        Some(RedirectTrust::Trusted)
    );
    assert_eq!(
        policy.trust("https://www.cursor.com/agents/mcp/oauth/callback"),
        Some(RedirectTrust::Trusted)
    );
}
