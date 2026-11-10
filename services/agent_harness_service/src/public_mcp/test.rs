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

/// The harness's own sessions reach the public MCP server through its
/// in-network service host, which must be allowed next to the public one.
#[test]
fn the_public_mcp_server_accepts_its_in_network_service_host() {
    let hosts = allowed_hosts("localhost", "agent-harness-service");
    assert!(hosts.iter().any(|host| host == "agent-harness-service"));
    assert!(hosts.iter().any(|host| host == "localhost"));
    assert!(hosts.iter().any(|host| host == "gateway.macro.com"));
}
