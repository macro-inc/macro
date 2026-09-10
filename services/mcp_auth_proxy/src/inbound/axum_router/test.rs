use std::sync::Arc;

use super::{health, mcp_router, mount_at_root_and_prefix};
use crate::domain::{
    models::{
        AccessToken, IssuedAuthorizationCode, PendingAuthorization, RefreshToken, UpstreamTokens,
    },
    ports::OAuthProvider,
    service::{InflightAuthStore, McpAuthProxyServiceImpl},
};
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    routing::get,
};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use tower::ServiceExt;

async fn ok() -> &'static str {
    "ok"
}

fn sample_app() -> Router {
    mount_at_root_and_prefix(
        Router::new()
            .route("/health", get(ok))
            .route("/oauth/callback", get(ok))
            .route("/.well-known/oauth-protected-resource", get(ok))
            .route("/.well-known/oauth-protected-resource/mcp", get(ok))
            .route("/mcp", get(ok)),
    )
}

async fn get_status(app: Router, path: &str) -> StatusCode {
    app.oneshot(
        Request::builder()
            .uri(path)
            .method("GET")
            .body(Body::empty())
            .unwrap(),
    )
    .await
    .unwrap()
    .status()
}

#[derive(Clone, Default)]
struct NoopInflightAuth;

impl InflightAuthStore for NoopInflightAuth {
    async fn insert_pending(
        &self,
        _session_id: &str,
        _pending: PendingAuthorization,
    ) -> anyhow::Result<()> {
        Ok(())
    }

    async fn take_pending(
        &self,
        _session_id: &str,
    ) -> anyhow::Result<Option<PendingAuthorization>> {
        Ok(None)
    }

    async fn insert_issued(
        &self,
        _code: &str,
        _issued: IssuedAuthorizationCode,
    ) -> anyhow::Result<()> {
        Ok(())
    }

    async fn take_issued(&self, _code: &str) -> anyhow::Result<Option<IssuedAuthorizationCode>> {
        Ok(None)
    }

    async fn cleanup_expired(&self) -> anyhow::Result<()> {
        Ok(())
    }
}

struct NoopOAuthProvider;

impl OAuthProvider for NoopOAuthProvider {
    fn construct_authorize_url(&self, state: &str) -> anyhow::Result<String> {
        Ok(format!(
            "https://upstream.example.com/authorize?state={state}"
        ))
    }

    fn exchange_authorization_code<'a>(
        &'a self,
        _code: &'a str,
    ) -> crate::domain::ports::UpstreamTokensFuture<'a> {
        Box::pin(async {
            Ok(UpstreamTokens {
                access_token: AccessToken::from("access"),
                refresh_token: RefreshToken::from("refresh"),
                expires_in: 3600,
            })
        })
    }

    fn refresh_access_token<'a>(
        &'a self,
        _refresh_token: &'a RefreshToken,
    ) -> crate::domain::ports::UpstreamTokensFuture<'a> {
        Box::pin(async {
            Ok(UpstreamTokens {
                access_token: AccessToken::from("access"),
                refresh_token: RefreshToken::from("refresh"),
                expires_in: 3600,
            })
        })
    }
}

fn built_router() -> Router {
    mcp_router(
        McpAuthProxyServiceImpl::new(
            "https://mcp.example.com".to_owned(),
            Arc::new(NoopInflightAuth),
            Arc::new(NoopOAuthProvider),
        ),
        JwtValidationArgs::new_testing(),
        Router::new().route("/", get(ok)),
    )
}

#[tokio::test]
async fn health_is_reachable_at_root_and_gateway_prefix() {
    for path in ["/health", "/mcp/health"] {
        let response = mount_at_root_and_prefix(Router::new().route("/health", get(health)))
            .oneshot(
                Request::builder()
                    .uri(path)
                    .method("GET")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK, "{path}");
    }
}

#[tokio::test]
async fn existing_paths_stay_and_are_also_served_under_the_prefix() {
    for path in [
        "/health",
        "/mcp/health",
        "/oauth/callback",
        "/mcp/oauth/callback",
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
        "/mcp/.well-known/oauth-protected-resource",
        "/mcp/.well-known/oauth-protected-resource/mcp",
        "/mcp",
        "/mcp/mcp",
    ] {
        assert_eq!(
            get_status(sample_app(), path).await,
            StatusCode::OK,
            "{path}"
        );
    }
}

#[tokio::test]
async fn mcp_router_builds_without_overlapping_routes() {
    let app = built_router();
    for path in [
        "/health",
        "/mcp/health",
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
        "/mcp/.well-known/oauth-protected-resource",
        "/mcp/.well-known/oauth-protected-resource/mcp",
        "/.well-known/oauth-authorization-server",
        "/mcp/.well-known/oauth-authorization-server",
    ] {
        assert_eq!(
            get_status(app.clone(), path).await,
            StatusCode::OK,
            "{path}"
        );
    }
}

#[tokio::test]
async fn unprefixed_unknown_path_is_not_rewritten_onto_the_prefix() {
    let response = mount_at_root_and_prefix(Router::new().route("/health", get(health)))
        .oneshot(
            Request::builder()
                .uri("/missing")
                .method("GET")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
