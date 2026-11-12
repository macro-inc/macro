use super::*;
use crate::domain::models::MacroUserIdStr;
use crate::outbound::guarded_http::{AddressPolicy, McpHttp};
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

/// A server that, like Google's and Datadog's, has no `initialize` for the
/// newest protocol version and refuses it instead of negotiating down.
struct RefusesVersionsWithoutInitialize;

impl rmcp::ServerHandler for RefusesVersionsWithoutInitialize {
    async fn initialize(
        &self,
        request: rmcp::model::InitializeRequestParams,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> std::result::Result<rmcp::model::InitializeResult, rmcp::model::ErrorData> {
        if !request.protocol_version.has_initialize() {
            return Err(rmcp::model::ErrorData::new(
                rmcp::model::ErrorCode::METHOD_NOT_FOUND,
                "Method not supported",
                None,
            ));
        }
        context.peer.set_peer_info(request.clone());
        self.negotiate_initialize(&request)
    }

    fn get_info(&self) -> rmcp::model::ServerConfig {
        rmcp::model::ServerConfig::default()
    }
}

#[tokio::test]
async fn client_info_opens_with_a_protocol_version_that_has_initialize() {
    let (server_side, client_side) = tokio::io::duplex(8192);
    tokio::spawn(async move {
        if let Ok(running) =
            rmcp::ServiceExt::serve(RefusesVersionsWithoutInitialize, server_side).await
        {
            let _ = running.waiting().await;
        }
    });

    let client = client_info()
        .serve(client_side)
        .await
        .expect("handshake with a server that refuses initialize for 2026-07-28");
    assert!(client.peer_info().is_some());
}

#[test]
fn rmcp_default_client_config_would_ask_for_a_version_without_initialize() {
    // Guards the reason `client_info` pins: if rmcp's default ever gains an
    // `initialize`, the pin is no longer needed.
    assert!(!ClientConfig::default().protocol_version.has_initialize());
}
