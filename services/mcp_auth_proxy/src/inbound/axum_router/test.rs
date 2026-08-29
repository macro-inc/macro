//! Route-level coverage for protected-resource metadata discovery.

use std::sync::Arc;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    routing,
};
use tower::ServiceExt;

use super::protected_resource_metadata;
use crate::domain::{
    models::{AccessToken, IssuedAuthorizationCode, PendingAuthorization, RefreshToken},
    ports::{OAuthProvider, TokenPairFuture},
    service::{InflightAuthStore, McpAuthProxyServiceImpl},
};

struct NoopInflightAuth;

impl InflightAuthStore for NoopInflightAuth {
    async fn insert_pending(
        &self,
        _session_id: &str,
        _pending: PendingAuthorization,
    ) -> anyhow::Result<()> {
        unreachable!("prm route test must not touch inflight store")
    }

    async fn take_pending(
        &self,
        _session_id: &str,
    ) -> anyhow::Result<Option<PendingAuthorization>> {
        unreachable!("prm route test must not touch inflight store")
    }

    async fn insert_issued(
        &self,
        _code: &str,
        _issued: IssuedAuthorizationCode,
    ) -> anyhow::Result<()> {
        unreachable!("prm route test must not touch inflight store")
    }

    async fn take_issued(&self, _code: &str) -> anyhow::Result<Option<IssuedAuthorizationCode>> {
        unreachable!("prm route test must not touch inflight store")
    }

    async fn cleanup_expired(&self) -> anyhow::Result<()> {
        unreachable!("prm route test must not touch inflight store")
    }
}

struct DummyOAuthProvider;

impl OAuthProvider for DummyOAuthProvider {
    fn construct_authorize_url(&self, _state: &str) -> anyhow::Result<String> {
        unreachable!("prm route test must not call OAuthProvider")
    }

    fn exchange_authorization_code<'a>(&'a self, _code: &'a str) -> TokenPairFuture<'a> {
        Box::pin(async {
            unreachable!("prm route test must not call OAuthProvider");
            #[allow(unreachable_code)]
            Ok((AccessToken::from(""), RefreshToken::from("")))
        })
    }

    fn refresh_access_token<'a>(&'a self, _refresh_token: &'a RefreshToken) -> TokenPairFuture<'a> {
        Box::pin(async {
            unreachable!("prm route test must not call OAuthProvider");
            #[allow(unreachable_code)]
            Ok((AccessToken::from(""), RefreshToken::from("")))
        })
    }
}

/// Minimal PRM routes matching production discovery layout (no JWT / MCP nest).
fn prm_discovery_router() -> Router {
    let auth_proxy = McpAuthProxyServiceImpl::new(
        "https://mcp-server.example.com".to_owned(),
        Arc::new(NoopInflightAuth),
        Arc::new(DummyOAuthProvider),
    );
    Router::new()
        .route(
            "/.well-known/oauth-protected-resource",
            routing::get(protected_resource_metadata::<NoopInflightAuth>),
        )
        .route(
            "/.well-known/oauth-protected-resource/mcp",
            routing::get(protected_resource_metadata::<NoopInflightAuth>),
        )
        .route(
            "/mcp/.well-known/oauth-protected-resource",
            routing::get(protected_resource_metadata::<NoopInflightAuth>),
        )
        .with_state(auth_proxy)
}

async fn get(app: Router, uri: &str) -> axum::http::Response<Body> {
    app.oneshot(
        Request::builder()
            .uri(uri)
            .body(Body::empty())
            .expect("request"),
    )
    .await
    .expect("oneshot")
}

async fn assert_prm_document(uri: &str) {
    let res = get(prm_discovery_router(), uri).await;
    assert_eq!(res.status(), StatusCode::OK);
    let body = to_bytes(res.into_body(), 64 * 1024).await.expect("body");
    let meta: serde_json::Value = serde_json::from_slice(&body).expect("json");
    assert_eq!(
        meta.get("resource").and_then(|v| v.as_str()),
        Some("https://mcp-server.example.com/mcp")
    );
    assert_eq!(
        meta.get("resource_name").and_then(|v| v.as_str()),
        Some("Macro MCP")
    );
}

#[tokio::test]
async fn origin_prm_well_known_returns_resource_document() {
    assert_prm_document("/.well-known/oauth-protected-resource").await;
}

#[tokio::test]
async fn path_insertion_prm_returns_resource_document() {
    assert_prm_document("/.well-known/oauth-protected-resource/mcp").await;
}

#[tokio::test]
async fn path_style_prm_returns_same_resource_document() {
    assert_prm_document("/mcp/.well-known/oauth-protected-resource").await;
}
