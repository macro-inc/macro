use mcp_auth_proxy::domain::redirect_uri::RedirectUriPolicy;

use super::*;

#[test]
fn default_redirect_hosts_permit_cursor_web_agent_callbacks() {
    let policy = RedirectUriPolicy::new(DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS);

    assert!(policy.permits("https://cursor.com/agents/mcp/oauth/callback"));
    assert!(policy.permits("https://www.cursor.com/agents/mcp/oauth/callback"));
}
