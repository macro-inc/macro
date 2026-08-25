//! The dial-out link to the harness service's runtime gateway.

use agent_runtime_protocol::domain::connection::RuntimeChannel;
use agent_runtime_protocol::outbound::websocket::connect_runtime;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

/// Dial a session's gateway URL - the `gatewayUrl` returned by
/// `POST /agent-sessions`, taken verbatim - presenting the bot's API token
/// with the standard bot credential headers. A WebSocket upgrade is an
/// ordinary HTTP request, so the same headers every other bot call uses
/// work here too.
pub async fn dial(
    gateway_url: &str,
    bot_token: &str,
    bot_scope: &str,
) -> Result<RuntimeChannel, tokio_tungstenite::tungstenite::Error> {
    let mut request = gateway_url.into_client_request()?;
    let headers = request.headers_mut();
    let token = bot_token.parse().map_err(bad_header)?;
    headers.insert("x-macro-bot-token", token);
    let scope = bot_scope.parse().map_err(bad_header)?;
    headers.insert("x-macro-bot-scope", scope);
    let (stream, _response) = tokio_tungstenite::connect_async(request).await?;
    Ok(connect_runtime(stream))
}

fn bad_header(
    _: tokio_tungstenite::tungstenite::http::header::InvalidHeaderValue,
) -> tokio_tungstenite::tungstenite::Error {
    tokio_tungstenite::tungstenite::Error::Url(
        tokio_tungstenite::tungstenite::error::UrlError::UnableToConnect(
            "bot credentials are not valid header values".to_owned(),
        ),
    )
}
