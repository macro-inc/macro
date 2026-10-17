//! The dial-out link to the harness service's runtime gateway.

use agent_runtime_protocol::domain::connection::RuntimeChannel;
use agent_runtime_protocol::domain::dial::OPERATOR_ALLOWS_BYPASS_HEADER;
use agent_runtime_protocol::outbound::websocket::connect_runtime;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;

/// Dial the runtime gateway, presenting the harness credential. A WebSocket
/// upgrade is an ordinary HTTP request, so the same header every other
/// harness call uses works here too. Every dial also reports the operator's
/// local consent to permission bypass, so a changed setting reaches the
/// server on the next connect.
pub async fn dial(
    gateway_url: &str,
    harness_token: &str,
    allow_permission_bypass: bool,
) -> Result<RuntimeChannel, tokio_tungstenite::tungstenite::Error> {
    let mut request = gateway_url.into_client_request()?;
    let headers = request.headers_mut();
    let token = harness_token.parse().map_err(bad_header)?;
    headers.insert("x-macro-harness-token", token);
    headers.insert(
        OPERATOR_ALLOWS_BYPASS_HEADER,
        HeaderValue::from_static(if allow_permission_bypass {
            "true"
        } else {
            "false"
        }),
    );
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
