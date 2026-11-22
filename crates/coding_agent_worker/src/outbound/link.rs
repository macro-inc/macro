//! The dial-out link to the harness service's runtime gateway.

use agent_runtime_protocol::domain::connection::RuntimeChannel;
use agent_runtime_protocol::domain::schema::v0::{
    ACCEPTS_AGENTS_CHANGED, ACCEPTS_APPLY_AGENT, ACCEPTS_RECHECK_TEAMMATE_HOST,
    ACCEPTS_TEAMMATE_CONTAINER, RUNTIME_ACCEPTS_HEADER,
};
use agent_runtime_protocol::outbound::websocket::connect_runtime;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

/// The optional teammate messages a dial lists.
#[derive(Debug, Clone, Copy, Default)]
pub struct Accepts {
    /// The teammate container capability, which the engine check grants.
    pub teammate_container: bool,
    /// The recheck hint, which hosting set up grants (engine up or not).
    pub recheck_teammate_host: bool,
}

/// Dial the runtime gateway, presenting the harness credential. A WebSocket
/// upgrade is an ordinary HTTP request, so the same header every other
/// harness call uses works here too.
pub async fn dial(
    gateway_url: &str,
    harness_token: &str,
    listed: Accepts,
) -> Result<RuntimeChannel, tokio_tungstenite::tungstenite::Error> {
    let mut request = gateway_url.into_client_request()?;
    let headers = request.headers_mut();
    let token = harness_token.parse().map_err(bad_header)?;
    headers.insert("x-macro-harness-token", token);
    // The service sends the optional messages this daemon handles only
    // because it lists them here.
    headers.insert(
        RUNTIME_ACCEPTS_HEADER,
        accepts(listed).parse().map_err(bad_header)?,
    );
    let (stream, _response) = tokio_tungstenite::connect_async(request).await?;
    Ok(connect_runtime(stream))
}

/// The optional messages this daemon handles, as the accepts header lists
/// them.
pub fn accepts(listed: Accepts) -> String {
    let mut accepts = vec![ACCEPTS_AGENTS_CHANGED, ACCEPTS_APPLY_AGENT];
    if listed.teammate_container {
        accepts.push(ACCEPTS_TEAMMATE_CONTAINER);
    }
    if listed.recheck_teammate_host {
        accepts.push(ACCEPTS_RECHECK_TEAMMATE_HOST);
    }
    accepts.join(",")
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
