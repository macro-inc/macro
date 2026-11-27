use super::*;
use crate::domain::catalog::Overlays;
use crate::domain::models::{ConnectorId, ConnectorKey, ServerUrl};
use crate::domain::sign_in::{ServerAuthorization, ServerSignIns};
use crate::fake::FakeOverlays;
use crate::inbound::ConnectorChange;
use crate::inbound::test_support::user;
use axum::body::{Body, to_bytes};
use axum::http::Request;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Mutex;
use tower::ServiceExt as _;

/// Signs `owner` in to whatever server the code names: `code=<url>`.
struct CodeIsServer;

#[async_trait::async_trait]
impl ServerAuthorization for CodeIsServer {
    async fn complete(
        &self,
        code: &str,
        state: &str,
    ) -> Result<(MacroUserIdStr<'static>, ServerUrl), rootcause::Report> {
        if state != "a-state" {
            return Err(rootcause::report!("unknown state"));
        }
        Ok((user("owner"), ServerUrl::parse(code)?))
    }

    fn client_metadata(&self) -> serde_json::Value {
        serde_json::json!({"client_id": "https://macro.test/mcp/servers/auth/client-metadata"})
    }
}

fn router(connected: &Arc<Mutex<Vec<ConnectorChange>>>) -> Router {
    let overlays = Overlays::new([(
        ConnectorId::parse("figma").unwrap(),
        ServerUrl::parse("https://mcp.figma.com/mcp").unwrap(),
    )]);
    let sign_ins = ServerSignIns::new(Arc::new(CodeIsServer), FakeOverlays(overlays));
    let log = connected.clone();
    let hook: ConnectorHook = Arc::new(move |change| {
        log.lock().unwrap().push(change);
        Box::pin(async {})
    });

    callbacks_router(CallbacksState::new(sign_ins).with_connected_hook(hook))
        .merge(pipedream_webhook_router(SECRET.to_owned()))
}

const SECRET: &str = "s3cret";

async fn get(router: Router, uri: &str) -> (StatusCode, String) {
    let response = router
        .oneshot(Request::get(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, String::from_utf8(body.to_vec()).unwrap())
}

#[tokio::test]
async fn a_finished_sign_in_tells_the_hook_what_was_connected() {
    let connected = Arc::new(Mutex::new(Vec::new()));

    let (status, body) = get(
        router(&connected),
        "/mcp/servers/auth/callback?code=https%3A%2F%2Fmcp.example.com%2Fmcp&state=a-state",
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, "Authorization successful. You can close this tab.");
    assert_eq!(
        *connected.lock().unwrap(),
        [ConnectorChange {
            user: user("owner"),
            key: ConnectorKey::Server(ServerUrl::parse("https://mcp.example.com/mcp").unwrap()),
        }]
    );
}

#[tokio::test]
async fn signing_in_at_an_overlay_address_connects_the_app() {
    let connected = Arc::new(Mutex::new(Vec::new()));

    let (status, _) = get(
        router(&connected),
        "/mcp/servers/auth/callback?code=https%3A%2F%2Fmcp.figma.com%2Fmcp&state=a-state",
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let keys: Vec<ConnectorKey> = connected
        .lock()
        .unwrap()
        .iter()
        .map(|change| change.key.clone())
        .collect();
    assert_eq!(
        keys,
        [ConnectorKey::App(ConnectorId::parse("figma").unwrap())]
    );
}

#[tokio::test]
async fn a_refused_or_malformed_redirect_is_a_bad_request() {
    let connected = Arc::new(Mutex::new(Vec::new()));

    let (refused, body) = get(
        router(&connected),
        "/mcp/servers/auth/callback?error=access_denied&error_description=user%20declined&state=a-state",
    )
    .await;
    let (malformed, _) = get(
        router(&connected),
        "/mcp/servers/auth/callback?state=a-state",
    )
    .await;

    assert_eq!(refused, StatusCode::BAD_REQUEST);
    assert!(body.contains("access_denied: user declined"), "{body}");
    assert_eq!(malformed, StatusCode::BAD_REQUEST);
    assert!(connected.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_failed_exchange_is_an_error_and_tells_no_hook() {
    let connected = Arc::new(Mutex::new(Vec::new()));

    let (status, body) = get(
        router(&connected),
        "/mcp/servers/auth/callback?code=https%3A%2F%2Fmcp.example.com%2Fmcp&state=forged",
    )
    .await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(!body.contains("unknown state"), "{body}");
    assert!(connected.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_client_metadata_document_is_public() {
    let (status, body) = get(router(&Arc::default()), "/mcp/servers/auth/client-metadata").await;

    assert_eq!(status, StatusCode::OK);
    let body: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(
        body["client_id"],
        "https://macro.test/mcp/servers/auth/client-metadata"
    );
}

#[tokio::test]
async fn the_consent_page_says_whether_it_connected() {
    let (connected, page) = get(
        router(&Arc::default()),
        "/pipedream/mcp/connect/callback?status=connected",
    )
    .await;
    let (failed, failure) = get(
        router(&Arc::default()),
        "/pipedream/mcp/connect/callback?status=error",
    )
    .await;

    assert_eq!(connected, StatusCode::OK);
    assert!(page.contains("Connected."));
    assert_eq!(failed, StatusCode::OK);
    assert!(failure.contains("did not finish"));
}

async fn post_webhook(uri: &str) -> StatusCode {
    router(&Arc::default())
        .oneshot(
            Request::post(uri)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"event":"CONNECTION_SUCCESS"}"#))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn the_webhook_checks_its_secret() {
    assert_eq!(
        post_webhook("/pipedream/mcp/webhook").await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        post_webhook("/pipedream/mcp/webhook?secret=wrong").await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        post_webhook("/pipedream/mcp/webhook?secret=s3cret").await,
        StatusCode::NO_CONTENT
    );
}
