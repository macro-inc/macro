use mcp_auth_proxy::domain::redirect_uri::RedirectUriPolicy;

use super::*;

#[test]
fn default_redirect_hosts_permit_cursor_web_agent_callbacks() {
    let policy = RedirectUriPolicy::new(DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS);

    assert!(policy.permits("https://cursor.com/agents/mcp/oauth/callback"));
    assert!(policy.permits("https://www.cursor.com/agents/mcp/oauth/callback"));
}

#[test]
fn default_redirect_hosts_permit_claude_connector_callbacks_on_both_domains() {
    let policy = RedirectUriPolicy::new(DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS);

    assert!(policy.permits("https://claude.ai/api/mcp/auth_callback"));
    assert!(policy.permits("https://claude.com/api/mcp/auth_callback"));
    // Exact host match: a subdomain of claude.com is not trusted.
    assert!(!policy.permits("https://evil.claude.com/api/mcp/auth_callback"));
}

#[test]
fn agent_setup_is_off_unless_explicitly_true() {
    assert_eq!(AgentSetup::default(), AgentSetup::Disabled);
    let parse = |value: &str| serde_json::from_str::<AgentSetup>(value);
    assert_eq!(parse("true").unwrap(), AgentSetup::Enabled);
    assert_eq!(parse("false").unwrap(), AgentSetup::Disabled);
    assert!(parse("\"yes\"").is_err());
}
