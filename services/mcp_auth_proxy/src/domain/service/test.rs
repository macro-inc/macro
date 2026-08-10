use std::sync::Arc;

use super::{InflightAuthStore, McpAuthProxyService, McpAuthProxyServiceImpl};
use crate::domain::{
    models::{AccessToken, IssuedAuthorizationCode, PendingAuthorization, RefreshToken},
    ports::{OAuthProvider, TokenPairFuture},
};

/// No-op inflight store: metadata tests never call storage.
struct NoopInflightAuth;

impl InflightAuthStore for NoopInflightAuth {
    async fn insert_pending(
        &self,
        _session_id: &str,
        _pending: PendingAuthorization,
    ) -> anyhow::Result<()> {
        unreachable!("metadata test must not touch inflight store")
    }

    async fn take_pending(
        &self,
        _session_id: &str,
    ) -> anyhow::Result<Option<PendingAuthorization>> {
        unreachable!("metadata test must not touch inflight store")
    }

    async fn insert_issued(
        &self,
        _code: &str,
        _issued: IssuedAuthorizationCode,
    ) -> anyhow::Result<()> {
        unreachable!("metadata test must not touch inflight store")
    }

    async fn take_issued(&self, _code: &str) -> anyhow::Result<Option<IssuedAuthorizationCode>> {
        unreachable!("metadata test must not touch inflight store")
    }

    async fn cleanup_expired(&self) -> anyhow::Result<()> {
        unreachable!("metadata test must not touch inflight store")
    }
}

/// Dummy OAuth provider: metadata tests never call upstream.
struct DummyOAuthProvider;

impl OAuthProvider for DummyOAuthProvider {
    fn construct_authorize_url(&self, _state: &str) -> anyhow::Result<String> {
        unreachable!("metadata test must not call OAuthProvider")
    }

    fn exchange_authorization_code<'a>(&'a self, _code: &'a str) -> TokenPairFuture<'a> {
        Box::pin(async {
            unreachable!("metadata test must not call OAuthProvider");
            #[allow(unreachable_code)]
            // AccessToken/RefreshToken are opaque newtypes; use From, not tuple ctors.
            Ok((AccessToken::from(""), RefreshToken::from("")))
        })
    }

    fn refresh_access_token<'a>(&'a self, _refresh_token: &'a RefreshToken) -> TokenPairFuture<'a> {
        Box::pin(async {
            unreachable!("metadata test must not call OAuthProvider");
            #[allow(unreachable_code)]
            Ok((AccessToken::from(""), RefreshToken::from("")))
        })
    }
}

fn service_with_public_url(public_url: &str) -> McpAuthProxyServiceImpl<NoopInflightAuth> {
    McpAuthProxyServiceImpl::new(
        public_url.to_owned(),
        Arc::new(NoopInflightAuth),
        Arc::new(DummyOAuthProvider),
    )
}

#[test]
fn protected_resource_metadata_includes_rfc9728_resource() {
    let svc = service_with_public_url("https://mcp-server.example.com");
    let meta = svc.protected_resource_metadata();

    assert_eq!(
        meta.get("resource").and_then(|v| v.as_str()),
        Some("https://mcp-server.example.com/mcp")
    );
    assert_eq!(
        meta.get("authorization_server").and_then(|v| v.as_str()),
        Some("https://mcp-server.example.com")
    );
    assert_eq!(
        meta.get("authorization_servers"),
        Some(&serde_json::json!(["https://mcp-server.example.com"]))
    );
    assert_eq!(
        meta.get("resource_name").and_then(|v| v.as_str()),
        Some("Macro MCP")
    );
    assert!(
        meta.get("scopes_supported").is_none(),
        "must not invent scopes_supported; got {meta}"
    );
}
