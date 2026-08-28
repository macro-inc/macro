use super::*;

fn policy() -> RedirectUriPolicy {
    RedirectUriPolicy::new(["claude.ai", "cursor.com"])
}

#[test]
fn permits_trusted_https_host() {
    assert!(policy().permits("https://claude.ai/api/mcp/auth_callback"));
}

#[test]
fn permits_trusted_https_host_regardless_of_case() {
    assert!(policy().permits("https://Claude.AI/api/mcp/auth_callback"));
}

#[test]
fn rejects_untrusted_https_host() {
    assert!(!policy().permits("https://attacker.example/callback"));
}

#[test]
fn rejects_subdomain_of_trusted_host() {
    assert!(!policy().permits("https://mcp.claude.ai/callback"));
}

#[test]
fn rejects_trusted_host_used_as_a_subdomain_label() {
    assert!(!policy().permits("https://claude.ai.attacker.example/callback"));
}

#[test]
fn rejects_trusted_host_in_userinfo() {
    assert!(!policy().permits("https://claude.ai@attacker.example/callback"));
}

#[test]
fn rejects_fragment_on_redirect_uri() {
    assert!(!policy().permits("https://claude.ai/callback#fragment"));
}

#[test]
fn permits_loopback_http_on_any_port() {
    let policy = policy();
    assert!(policy.permits("http://127.0.0.1:51000/oauth/callback"));
    assert!(policy.permits("http://localhost:8123/callback"));
    assert!(policy.permits("http://[::1]:9000/callback"));
}

#[test]
fn rejects_non_loopback_http() {
    assert!(!policy().permits("http://claude.ai/callback"));
    assert!(!policy().permits("http://attacker.example/callback"));
}

#[test]
fn rejects_non_http_schemes() {
    let policy = policy();
    assert!(!policy.permits("javascript:alert(1)"));
    assert!(!policy.permits("data:text/html,hi"));
    assert!(!policy.permits("com.attacker.app:/callback"));
}

#[test]
fn rejects_unparseable_uri() {
    assert!(!policy().permits("not a uri"));
}

#[test]
fn empty_allowlist_permits_only_loopback() {
    let policy = RedirectUriPolicy::new(Vec::<String>::new());
    assert!(policy.permits("http://127.0.0.1:51000/oauth/callback"));
    assert!(!policy.permits("https://claude.ai/api/mcp/auth_callback"));
}
