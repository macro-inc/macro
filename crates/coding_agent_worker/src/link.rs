//! The dial-out link to the harness service's runtime gateway.

use crate::config::Session;
use agent_runtime_protocol::domain::connection::RuntimeChannel;
use agent_runtime_protocol::outbound::websocket::connect_runtime;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::AUTHORIZATION;

/// Dial `{gateway_url}/{session_id}/ws` with the session's bearer token and
/// bridge the socket into the runtime-side channel.
pub async fn dial(
    session: &Session,
) -> Result<RuntimeChannel, tokio_tungstenite::tungstenite::Error> {
    let url = format!(
        "{}/{}/ws",
        session.gateway_url.trim_end_matches('/'),
        session.id
    );
    let mut request = url.into_client_request()?;
    request.headers_mut().insert(
        AUTHORIZATION,
        format!("Bearer {}", session.token).parse().map_err(|_| {
            tokio_tungstenite::tungstenite::Error::Url(
                tokio_tungstenite::tungstenite::error::UrlError::UnableToConnect(
                    "session token is not a valid header value".to_owned(),
                ),
            )
        })?,
    );
    let (stream, _response) = tokio_tungstenite::connect_async(request).await?;
    Ok(connect_runtime(stream))
}
