//! The dial-out link to the harness service's runtime gateway.

use agent_runtime_protocol::domain::connection::RuntimeChannel;
use agent_runtime_protocol::domain::schema::v0::{
    ACCEPTS_AGENTS_CHANGED, ACCEPTS_APPLY_AGENT, RUNTIME_ACCEPTS_HEADER,
};
use agent_runtime_protocol::outbound::websocket::connect_runtime;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

/// Dial the runtime gateway, presenting the harness credential. A WebSocket
/// upgrade is an ordinary HTTP request, so the same header every other
/// harness call uses works here too.
pub async fn dial(
    gateway_url: &str,
    harness_token: &str,
) -> Result<RuntimeChannel, tokio_tungstenite::tungstenite::Error> {
    let mut request = gateway_url.into_client_request()?;
    let headers = request.headers_mut();
    let token = harness_token.parse().map_err(bad_header)?;
    headers.insert("x-macro-harness-token", token);
    // The service sends the optional messages this daemon handles only
    // because it lists them here.
    let accepts = [ACCEPTS_AGENTS_CHANGED, ACCEPTS_APPLY_AGENT].join(",");
    headers.insert(RUNTIME_ACCEPTS_HEADER, accepts.parse().map_err(bad_header)?);
    let (stream, _response) = tokio_tungstenite::connect_async(request).await?;
    Ok(connect_runtime(stream))
}

fn bad_header(
    _: tokio_tungstenite::tungstenite::http::header::InvalidHeaderValue,
) -> tokio_tungstenite::tungstenite::Error {
    tokio_tungstenite::tungstenite::Error::Url(
        tokio_tungstenite::tungstenite::error::UrlError::UnableToConnect(
            "the harness credential is not a valid header value".to_owned(),
        ),
    )
}
