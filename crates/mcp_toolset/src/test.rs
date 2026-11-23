use super::*;
use rmcp::ServiceExt;

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
