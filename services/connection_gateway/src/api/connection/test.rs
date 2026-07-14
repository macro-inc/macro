use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use axum::{
    Router,
    extract::{FromRef, State, ws::WebSocketUpgrade},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};

use super::authenticated_websocket_upgrade;
use macro_authorization::{
    MacroAuthorizationError, MacroAuthorizationExtractor, MacroAuthorizationServiceImpl,
    testing::FakeMacroAuthorizationService,
};
use tokio_tungstenite::{connect_async, tungstenite::Error as WebSocketError};

#[derive(Clone)]
struct TestState {
    authorization_service: MacroAuthorizationServiceImpl,
    upgrade_count: Arc<AtomicUsize>,
}

impl FromRef<TestState> for MacroAuthorizationServiceImpl {
    fn from_ref(state: &TestState) -> Self {
        state.authorization_service.clone()
    }
}

async fn authenticated_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<TestState>,
    authorization: MacroAuthorizationExtractor,
) -> impl IntoResponse {
    state.upgrade_count.fetch_add(1, Ordering::SeqCst);
    authenticated_websocket_upgrade(
        ws,
        authorization,
        |_socket, _user_id, _user_context| async {},
    )
}

fn test_router(authorization_service: FakeMacroAuthorizationService) -> (Router, Arc<AtomicUsize>) {
    let upgrade_count = Arc::new(AtomicUsize::new(0));
    let state = TestState {
        authorization_service: MacroAuthorizationServiceImpl::new(authorization_service),
        upgrade_count: Arc::clone(&upgrade_count),
    };

    (
        Router::new()
            .route("/", get(authenticated_upgrade))
            .with_state(state),
        upgrade_count,
    )
}

async fn serve(router: Router) -> (std::net::SocketAddr, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test listener should bind");
    let address = listener
        .local_addr()
        .expect("test listener should have an address");
    let server = tokio::spawn(async move {
        axum::serve(listener, router)
            .await
            .expect("test server should run");
    });
    (address, server)
}

#[tokio::test]
async fn query_token_authenticates_websocket_upgrade() {
    let authorization_service = FakeMacroAuthorizationService::default();
    let (router, upgrade_count) = test_router(authorization_service.clone());
    let (address, server) = serve(router).await;

    let (_socket, response) = connect_async(format!("ws://{address}/?macro-api-token=query-token"))
        .await
        .expect("query token should authorize the websocket");
    server.abort();

    assert_eq!(response.status(), StatusCode::SWITCHING_PROTOCOLS);
    assert_eq!(authorization_service.calls(), ["query-token"]);
    assert_eq!(upgrade_count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn invalid_token_is_rejected_before_websocket_upgrade() {
    let authorization_service =
        FakeMacroAuthorizationService::never(MacroAuthorizationError::InvalidCredentials);
    let (router, upgrade_count) = test_router(authorization_service.clone());
    let (address, server) = serve(router).await;

    let error = connect_async(format!("ws://{address}/?macro-api-token=invalid"))
        .await
        .expect_err("invalid token should reject the websocket handshake");
    server.abort();
    let WebSocketError::Http(response) = error else {
        panic!("expected an HTTP rejection, got {error}");
    };

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response.body().as_deref(),
        Some(r#"{"message":"unauthorized"}"#.as_bytes())
    );
    assert_eq!(authorization_service.calls(), ["invalid"]);
    assert_eq!(upgrade_count.load(Ordering::SeqCst), 0);
}
