use super::*;

fn policy() -> RedirectUriPolicy {
    RedirectUriPolicy::new(["claude.ai", "cursor.com"])
}

#[test]
fn trusts_listed_https_host() {
    assert_eq!(
        policy().trust("https://claude.ai/api/mcp/auth_callback"),
        Some(RedirectTrust::Trusted)
    );
}

#[test]
fn trusts_listed_https_host_regardless_of_case() {
    assert_eq!(
        policy().trust("https://Claude.AI/api/mcp/auth_callback"),
        Some(RedirectTrust::Trusted)
    );
}

#[test]
fn unlisted_https_host_requires_consent() {
    assert_eq!(
        policy().trust("https://gateway.example/oauth/callback"),
        Some(RedirectTrust::RequiresConsent)
    );
}

#[test]
fn subdomain_of_listed_host_requires_consent() {
    assert_eq!(
        policy().trust("https://mcp.claude.ai/callback"),
        Some(RedirectTrust::RequiresConsent)
    );
}

#[test]
fn listed_host_used_as_a_subdomain_label_requires_consent() {
    assert_eq!(
        policy().trust("https://claude.ai.attacker.example/callback"),
        Some(RedirectTrust::RequiresConsent)
    );
}

#[test]
fn rejects_credentials_in_the_authority() {
    assert_eq!(
        policy().trust("https://claude.ai@attacker.example/callback"),
        None
    );
}

#[test]
fn rejects_fragment_on_redirect_uri() {
    assert_eq!(policy().trust("https://claude.ai/callback#fragment"), None);
}

#[test]
fn trusts_loopback_http_on_any_port() {
    let policy = policy();
    assert_eq!(
        policy.trust("http://127.0.0.1:51000/oauth/callback"),
        Some(RedirectTrust::Trusted)
    );
    assert_eq!(
        policy.trust("http://localhost:8123/callback"),
        Some(RedirectTrust::Trusted)
    );
    assert_eq!(
        policy.trust("http://[::1]:9000/callback"),
        Some(RedirectTrust::Trusted)
    );
}

#[test]
fn rejects_non_loopback_http() {
    assert_eq!(policy().trust("http://claude.ai/callback"), None);
    assert_eq!(policy().trust("http://attacker.example/callback"), None);
}

#[test]
fn rejects_non_http_schemes() {
    let policy = policy();
    assert_eq!(policy.trust("javascript:alert(1)"), None);
    assert_eq!(policy.trust("data:text/html,hi"), None);
    assert_eq!(policy.trust("com.attacker.app:/callback"), None);
}

#[test]
fn rejects_unparseable_uri() {
    assert_eq!(policy().trust("not a uri"), None);
}

#[test]
fn empty_allowlist_trusts_only_loopback() {
    let policy = RedirectUriPolicy::new(Vec::<String>::new());
    assert_eq!(
        policy.trust("http://127.0.0.1:51000/oauth/callback"),
        Some(RedirectTrust::Trusted)
    );
    assert_eq!(
        policy.trust("https://claude.ai/api/mcp/auth_callback"),
        Some(RedirectTrust::RequiresConsent)
    );
}
