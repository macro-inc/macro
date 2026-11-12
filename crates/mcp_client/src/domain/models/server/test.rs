use super::*;
use crate::domain::models::MacroUserIdStr;
use crate::outbound::guarded_http::AddressPolicy;
use axum::{Router, routing::post};
use macro_user_id::cowlike::CowLike;
use tokio::sync::Notify;

/// A store the unauthenticated connect path never touches.
struct UntouchedStore;

impl McpServerStore for UntouchedStore {
    type Err = anyhow::Error;

    async fn save(&self, _record: &McpServerRecord) -> Result<(), Self::Err> {
        unreachable!()
    }

    async fn load(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _server_url: &str,
    ) -> Result<Option<McpServerRecord>, Self::Err> {
        unreachable!()
    }

    async fn delete(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _server_url: &str,
    ) -> Result<(), Self::Err> {
        unreachable!()
    }

    async fn list(
        &self,
        _user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<McpServerRecord>, Self::Err> {
        unreachable!()
    }
}

/// A server that accepts the initialize request and never answers it gives
/// up after the handshake deadline instead of holding the connect forever.
#[tokio::test]
async fn a_server_that_never_answers_initialize_times_out() {
    let received = Arc::new(Notify::new());
    let router = Router::new().route(
        "/mcp",
        post({
            let received = Arc::clone(&received);
            move || async move {
                received.notify_one();
                std::future::pending::<()>().await
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });

    let record = McpServerRecord {
        user_id: MacroUserIdStr::parse_from_str("macro|owner@example.com")
            .unwrap()
            .into_owned(),
        url: format!("http://127.0.0.1:{port}/mcp"),
        server_name: "Stalled".to_owned(),
        credentials: None,
        enabled: true,
    };
    let http = McpHttp::new(AddressPolicy::AnyAddress).unwrap();
    let connect =
        tokio::spawn(async move { record.connect(&http, Arc::new(UntouchedStore)).await });

    // Only once the server holds the request does the clock jump ahead, so
    // the deadline fires mid-handshake rather than before the request lands.
    received.notified().await;
    tokio::time::pause();

    let error = connect.await.unwrap().unwrap_err();
    let timed_out = error
        .downcast_ref::<HandshakeTimedOut>()
        .unwrap_or_else(|| panic!("expected a handshake timeout, got {error:?}"));
    assert_eq!(timed_out.0, HANDSHAKE_TIMEOUT);
}
