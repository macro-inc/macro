use super::*;
use crate::domain::model::{GitService, ProxyBody, RepoSlug};
use axum::body::to_bytes;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use http::Method;
use http::header::AUTHORIZATION;
use http_body_util::Empty;
use std::sync::Mutex;
use tower::ServiceExt;

/// Records what the router decided, and answers however it was built to.
struct SpyService {
    seen: Mutex<Vec<(String, EgressTarget)>>,
    answer: Option<EgressError>,
}

impl SpyService {
    fn accepting() -> Arc<Self> {
        Arc::new(Self {
            seen: Mutex::default(),
            answer: None,
        })
    }

    fn refusing(answer: EgressError) -> Arc<Self> {
        Arc::new(Self {
            seen: Mutex::default(),
            answer: Some(answer),
        })
    }

    fn targets(&self) -> Vec<EgressTarget> {
        self.seen
            .lock()
            .expect("lock")
            .iter()
            .map(|(_token, target)| target.clone())
            .collect()
    }

    fn tokens(&self) -> Vec<String> {
        self.seen
            .lock()
            .expect("lock")
            .iter()
            .map(|(token, _target)| token.clone())
            .collect()
    }
}

impl EgressService for SpyService {
    async fn proxy(
        &self,
        token: &SessionToken,
        target: EgressTarget,
        _request: ProxyRequest,
    ) -> Result<ProxyResponse, EgressError> {
        self.seen
            .lock()
            .expect("lock")
            .push((token.as_str().to_owned(), target));

        match &self.answer {
            None => {
                let body: ProxyBody = Empty::new().map_err(|never| match never {}).boxed_unsync();
                let mut response = http::Response::new(body);
                *response.status_mut() = StatusCode::ACCEPTED;
                Ok(response)
            }
            Some(EgressError::RepoUnavailable(repo)) => {
                Err(EgressError::RepoUnavailable(repo.clone()))
            }
            Some(EgressError::MethodNotAllowed(method)) => {
                Err(EgressError::MethodNotAllowed(method.clone()))
            }
            Some(EgressError::SessionClosed) => Err(EgressError::SessionClosed),
            Some(EgressError::Upstream(_)) => {
                Err(EgressError::Upstream(rootcause::report!("unreachable")))
            }
            Some(_) => Err(EgressError::Unauthenticated("refused by the spy")),
        }
    }
}

async fn call(service: &Arc<SpyService>, request: Request) -> Response {
    egress_router(EgressRouterState::new(Arc::clone(service)))
        .oneshot(request)
        .await
        .expect("infallible")
}

fn get(uri: &str, authorization: Option<&str>) -> Request {
    let mut builder = Request::builder().method(Method::GET).uri(uri);
    if let Some(value) = authorization {
        builder = builder.header(AUTHORIZATION, value);
    }
    builder.body(Body::empty()).expect("request")
}

async fn body_text(response: Response) -> String {
    let bytes = to_bytes(response.into_body(), 64 * 1024)
        .await
        .expect("body");
    String::from_utf8(bytes.to_vec()).expect("utf8")
}

#[tokio::test]
async fn serves_health_without_a_token() {
    let service = SpyService::accepting();
    let response = call(&service, get("/health", None)).await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_text(response).await, "ok");
}

#[tokio::test]
async fn routes_a_slug_to_an_mcp_target() {
    let service = SpyService::accepting();
    let response = call(&service, get("/mcp/datadog", Some("Bearer session"))).await;

    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert_eq!(
        service.targets(),
        [EgressTarget::McpServer(McpDestination::Connected(
            McpServerSlug::parse("datadog").expect("slug")
        ))]
    );
}

/// git speaks to us through a credential helper, which can only present a
/// token as a Basic password. Both spellings have to reach the same session.
#[tokio::test]
async fn accepts_the_token_as_a_bearer_or_as_a_basic_password() {
    let service = SpyService::accepting();

    call(&service, get("/mcp/datadog", Some("Bearer the-token"))).await;
    let basic = format!("Basic {}", BASE64.encode("x-access-token:the-token"));
    call(&service, get("/mcp/datadog", Some(&basic))).await;

    assert_eq!(service.tokens(), ["the-token", "the-token"]);
}

#[tokio::test]
async fn a_request_without_a_token_never_reaches_the_service() {
    let service = SpyService::accepting();
    let response = call(&service, get("/mcp/datadog", None)).await;

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(service.targets().is_empty());
}

/// The sandbox's remote is just `<egress>/git`; git appends the smart-HTTP
/// suffix itself, and there is nowhere in the route for it to name a
/// repository.
#[tokio::test]
async fn routes_a_git_path_to_an_allowlisted_endpoint() {
    let service = SpyService::accepting();
    let response = call(
        &service,
        get(
            "/git/info/refs?service=git-upload-pack",
            Some("Bearer session"),
        ),
    )
    .await;

    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert_eq!(
        service.targets(),
        [EgressTarget::GitHubGit {
            endpoint: GitEndpoint::InfoRefs {
                service: GitService::UploadPack
            },
        }]
    );
}

/// The dumb-HTTP object endpoints are not in the allowlist, so they are not
/// routed - the service never sees them and no credential is minted.
#[tokio::test]
async fn a_git_path_outside_the_allowlist_is_not_routed() {
    let service = SpyService::accepting();
    let response = call(
        &service,
        get("/git/objects/ab/cdef0123456789", Some("Bearer session")),
    )
    .await;

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert!(service.targets().is_empty());
}

#[tokio::test]
async fn maps_each_refusal_to_the_status_that_tells_the_agent_what_to_do() {
    for (error, expected) in [
        (
            EgressError::Unauthenticated("unknown session token"),
            StatusCode::UNAUTHORIZED,
        ),
        (EgressError::SessionClosed, StatusCode::UNAUTHORIZED),
        (
            EgressError::RepoUnavailable(RepoSlug::parse("other", "repo").expect("slug")),
            StatusCode::FORBIDDEN,
        ),
        (
            EgressError::MethodNotAllowed(Method::PUT),
            StatusCode::METHOD_NOT_ALLOWED,
        ),
        (
            EgressError::Upstream(rootcause::report!("nope")),
            StatusCode::BAD_GATEWAY,
        ),
    ] {
        let service = SpyService::refusing(error);
        let response = call(&service, get("/mcp/datadog", Some("Bearer session"))).await;
        assert_eq!(response.status(), expected);
    }
}

/// The sandbox runs model-authored code, so a response body is something the
/// model reads. An upstream or transport failure whose `Display` quotes the
/// request it failed on would be quoting a request we had just stamped a
/// credential onto.
#[tokio::test]
async fn an_error_body_never_carries_internal_detail() {
    let service = SpyService::refusing(EgressError::Upstream(rootcause::report!(
        "POST https://mcp.example.com/mcp failed: authorization: Bearer dd-oauth-token"
    )));
    let response = call(&service, get("/mcp/datadog", Some("Bearer session"))).await;

    let body = body_text(response).await;
    assert!(!body.contains("dd-oauth-token"), "{body}");
    assert!(!body.contains("mcp.example.com"), "{body}");
    assert_eq!(body, "The upstream could not be reached.");
}

/// git makes its first request bare and only consults its credential helper
/// once the server asks for authentication. Asking is this header: without it
/// libcurl has no auth scheme to choose, so git never sends the token it
/// already holds and the clone dies as "Authentication failed".
#[tokio::test]
async fn an_unauthenticated_git_request_is_told_to_use_basic() {
    let service = SpyService::accepting();
    let response = call(
        &service,
        get("/git/info/refs?service=git-upload-pack", None),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response
            .headers()
            .get(http::header::WWW_AUTHENTICATE)
            .and_then(|value| value.to_str().ok()),
        Some(r#"Basic realm="Macro egress", charset="UTF-8""#)
    );
}

/// Only git needs the challenge. An MCP client sends its bearer token up
/// front, and advertising Basic would invite it to prompt for a password that
/// does not exist.
#[tokio::test]
async fn an_unauthenticated_mcp_request_is_not_told_to_use_basic() {
    let service = SpyService::accepting();
    let response = call(&service, get("/mcp/datadog", None)).await;

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(
        !response
            .headers()
            .contains_key(http::header::WWW_AUTHENTICATE)
    );
}
