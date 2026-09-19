use super::{GATEWAY_PATH_PREFIX, egress_app, health_router, mount_at_root_and_prefix};
use agent_egress::domain::error::EgressError;
use agent_egress::domain::model::{
    EgressTarget, GitEndpoint, GitService, McpDestination, McpServerSlug, ProxyRequest,
    ProxyResponse, SessionToken,
};
use agent_egress::domain::service::EgressService;
use agent_egress::inbound::axum_router::EgressRouterState;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

#[tokio::test]
async fn health_is_reachable_at_root_and_gateway_prefix() {
    for path in ["/health", "/agent-harness/health"] {
        let response = mount_at_root_and_prefix(
            health_router(tokio::sync::watch::channel(true).1),
            GATEWAY_PATH_PREFIX,
        )
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
async fn unprefixed_unknown_path_is_not_rewritten_onto_the_prefix() {
    let response = mount_at_root_and_prefix(
        health_router(tokio::sync::watch::channel(true).1),
        GATEWAY_PATH_PREFIX,
    )
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

#[tokio::test]
async fn health_fails_while_the_command_bus_is_disconnected() {
    let response = health_router(tokio::sync::watch::channel(false).1)
        .oneshot(
            Request::builder()
                .uri("/health")
                .method("GET")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[derive(Default)]
struct EgressSpy {
    seen: Mutex<Vec<(String, EgressTarget, String)>>,
}

impl EgressService for EgressSpy {
    async fn proxy(
        &self,
        token: &SessionToken,
        target: EgressTarget,
        request: ProxyRequest,
    ) -> Result<ProxyResponse, EgressError> {
        self.seen.lock().unwrap().push((
            token.as_str().to_owned(),
            target,
            request.uri().to_string(),
        ));
        // Distinguish a request dispatched to the service from a routing or
        // authentication refusal without needing an upstream HTTP client.
        Err(EgressError::RequestTooLarge)
    }
}

#[tokio::test]
async fn egress_health_is_reachable_directly_and_through_the_gateway() {
    let service = Arc::new(EgressSpy::default());
    let app = egress_app(EgressRouterState::new(Arc::clone(&service)));
    for path in ["/health", "/agent-harness-egress/health"] {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{path}");
    }
    assert!(service.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn gateway_egress_preserves_tokens_targets_and_git_query_strings() {
    for (method, path, authorization, target) in [
        (
            "POST",
            "/mcp/datadog",
            "Bearer session",
            EgressTarget::McpServer(McpDestination::Connected(
                McpServerSlug::parse("datadog").unwrap(),
            )),
        ),
        (
            "DELETE",
            "/mcp-macro",
            "Bearer session",
            EgressTarget::McpServer(McpDestination::Macro),
        ),
        (
            "GET",
            "/git/info/refs?service=git-upload-pack",
            // Basic x:session, as sent by Git's credential helper.
            "Basic eDpzZXNzaW9u",
            EgressTarget::GitHubGit {
                endpoint: GitEndpoint::InfoRefs {
                    service: GitService::UploadPack,
                },
            },
        ),
        (
            "POST",
            "/git/git-receive-pack",
            "Basic eDpzZXNzaW9u",
            EgressTarget::GitHubGit {
                endpoint: GitEndpoint::ReceivePack,
            },
        ),
    ] {
        for prefix in ["", "/agent-harness-egress"] {
            let service = Arc::new(EgressSpy::default());
            let response = egress_app(EgressRouterState::new(Arc::clone(&service)))
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(format!("{prefix}{path}"))
                        .header("authorization", authorization)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
            assert_eq!(
                *service.seen.lock().unwrap(),
                [("session".to_owned(), target.clone(), path.to_owned())]
            );
        }
    }
}

#[tokio::test]
async fn gateway_egress_keeps_authentication_and_git_basic_challenge() {
    let service = Arc::new(EgressSpy::default());
    for path in [
        "/mcp/datadog",
        "/mcp-macro",
        "/git/info/refs?service=git-upload-pack",
    ] {
        let response = egress_app(EgressRouterState::new(Arc::clone(&service)))
            .oneshot(
                Request::builder()
                    .uri(format!("/agent-harness-egress{path}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response.headers().contains_key("www-authenticate"),
            path.starts_with("/git/")
        );
    }
    assert!(service.seen.lock().unwrap().is_empty());
}
