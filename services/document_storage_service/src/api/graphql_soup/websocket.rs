//! GraphQL-only WebSocket transport using Signal's compression-capable fork.

use async_graphql::{
    Data, Executor,
    http::{WebSocket, WebSocketProtocols, WsMessage},
};
use axum::{
    body::Body,
    extract::FromRequestParts,
    http::{HeaderMap, HeaderValue, StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
};
use futures::{SinkExt, StreamExt, future};
use hyper::upgrade::{OnUpgrade, Upgraded};
use hyper_util::rt::TokioIo;
use tokio_tungstenite_signal::WebSocketStream;
use tungstenite_signal::{
    Message,
    extensions::compression::deflate::DeflateConfig,
    handshake::server::{Request, create_response},
    protocol::{CloseFrame, Role, WebSocketConfig},
};

#[cfg(test)]
mod test;

// Preserve the previous Axum receive limits without relying on fork defaults.
// The message limit also applies to decompressed input.
const MAX_GRAPHQL_MESSAGE_BYTES: usize = 64 << 20;
const MAX_GRAPHQL_FRAME_BYTES: usize = 16 << 20;

/// An authenticated handler must call `serve` to complete the upgrade.
/// Merely extracting this value never starts a socket or executes GraphQL.
pub(super) struct GraphqlWebSocketUpgrade {
    response: Response,
    on_upgrade: OnUpgrade,
    protocol: WebSocketProtocols,
    config: WebSocketConfig,
}

impl<S: Send + Sync> FromRequestParts<S> for GraphqlWebSocketUpgrade {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let protocol: WebSocketProtocols = parts
            .headers
            .get(header::SEC_WEBSOCKET_PROTOCOL)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(',').find_map(|p| p.trim().parse().ok()))
            .ok_or_else(|| StatusCode::BAD_REQUEST.into_response())?;

        // Use tungstenite's RFC 6455 handshake validation, including the method,
        // version, upgrade headers and accept key. This route uses HTTP/1.1 GET.
        let mut request = Request::new(());
        *request.method_mut() = parts.method.clone();
        *request.version_mut() = parts.version;
        *request.headers_mut() = parts.headers.clone();
        let mut response = create_response(&request)
            .map_err(|_| StatusCode::BAD_REQUEST.into_response())?
            .map(|()| Body::empty());
        response.headers_mut().insert(
            header::SEC_WEBSOCKET_PROTOCOL,
            HeaderValue::from_static(protocol.sec_websocket_protocol()),
        );

        let mut config = WebSocketConfig::default()
            .max_message_size(Some(MAX_GRAPHQL_MESSAGE_BYTES))
            .max_frame_size(Some(MAX_GRAPHQL_FRAME_BYTES));
        if let Some((deflate, agreed)) = negotiate_compression(&parts.headers) {
            config.extensions.permessage_deflate = Some(deflate);
            response
                .headers_mut()
                .insert(header::SEC_WEBSOCKET_EXTENSIONS, agreed);
        }
        let on_upgrade = parts
            .extensions
            .remove::<OnUpgrade>()
            .ok_or_else(|| StatusCode::UPGRADE_REQUIRED.into_response())?;

        Ok(Self {
            response,
            on_upgrade,
            protocol,
            config,
        })
    }
}

impl GraphqlWebSocketUpgrade {
    /// Start the subscription transport with the handler's authorized context.
    pub(super) fn serve(self, executor: impl Executor, data: Data) -> Response {
        tokio::spawn(async move {
            let upgraded = match self.on_upgrade.await {
                Ok(upgraded) => upgraded,
                Err(error) => {
                    tracing::debug!(error = ?error, "GraphQL WebSocket upgrade failed");
                    return;
                }
            };
            // Only the negotiated parameters are enabled on the raw socket;
            // clients that did not offer compression retain the default config.
            let socket = WebSocketStream::from_raw_socket(
                TokioIo::new(upgraded),
                Role::Server,
                Some(self.config),
            )
            .await;
            serve(socket, executor, data, self.protocol).await;
        });
        self.response
    }
}

async fn serve(
    socket: WebSocketStream<TokioIo<Upgraded>>,
    executor: impl Executor,
    data: Data,
    protocol: WebSocketProtocols,
) {
    let (mut sink, stream) = socket.split();
    // Match async-graphql-axum's transport behavior, without converting message
    // payloads through Axum's separate, uncompressed tungstenite dependency.
    let input = stream
        .take_while(|result| future::ready(result.is_ok()))
        .filter_map(|result| {
            future::ready(match result {
                Ok(message @ (Message::Text(_) | Message::Binary(_))) => Some(message.into_data()),
                _ => None,
            })
        });
    let output = WebSocket::new(executor, input, protocol).connection_data(data);
    futures::pin_mut!(output);
    while let Some(message) = output.next().await {
        let message = match message {
            WsMessage::Text(text) => Message::Text(text.into()),
            WsMessage::Close(code, reason) => Message::Close(Some(CloseFrame {
                code: code.into(),
                reason: reason.into(),
            })),
        };
        if sink.send(message).await.is_err() {
            break;
        }
    }
}

/// Signal's handshake negotiation helpers are private. For Hyper upgrades,
/// conservatively accept known, unquoted RFC 7692 parameters and decline other
/// offers. Declining compression still permits an ordinary WebSocket connection.
fn negotiate_compression(headers: &HeaderMap) -> Option<(DeflateConfig, HeaderValue)> {
    headers
        .get_all(header::SEC_WEBSOCKET_EXTENSIONS)
        .iter()
        .filter_map(|value| value.to_str().ok())
        // Do not split inside a quoted extension parameter. Browsers' standard
        // offers are unquoted; quoted offers can safely fall back to no deflate.
        .filter(|value| !value.contains('"'))
        .flat_map(|value| value.split(','))
        .find_map(accept_deflate_offer)
}

fn accept_deflate_offer(offer: &str) -> Option<(DeflateConfig, HeaderValue)> {
    let mut parameters = offer.split(';').map(str::trim);
    if parameters.next()? != "permessage-deflate" {
        return None;
    }

    // Do not share compression dictionaries between GraphQL messages. Besides
    // bounding retained state, this avoids cross-message compression side channels.
    let mut config = DeflateConfig::default()
        .set_no_context_takeover(Role::Server, true)
        .set_no_context_takeover(Role::Client, true);
    let mut seen = [false; 4];
    let mut response =
        String::from("permessage-deflate; server_no_context_takeover; client_no_context_takeover");
    for parameter in parameters {
        let (name, value) = parameter
            .split_once('=')
            .map_or((parameter, None), |(name, value)| {
                (name.trim(), Some(value.trim()))
            });
        let index = match name {
            "server_no_context_takeover" if value.is_none() => 0,
            "client_no_context_takeover" if value.is_none() => 1,
            "server_max_window_bits" | "client_max_window_bits" => {
                let role = if name == "server_max_window_bits" {
                    Role::Server
                } else {
                    Role::Client
                };
                let bits = match (role, value) {
                    (Role::Client, None) => 15,
                    (_, Some("9")) => 9,
                    (_, Some("10")) => 10,
                    (_, Some("11")) => 11,
                    (_, Some("12")) => 12,
                    (_, Some("13")) => 13,
                    (_, Some("14")) => 14,
                    (_, Some("15")) => 15,
                    _ => return None,
                };
                // The fork's zlib backend cannot send with an 8-bit window.
                config = config.set_max_window_bits(role, bits).ok()?;
                response.push_str(&format!("; {name}={bits}"));
                if role == Role::Server { 2 } else { 3 }
            }
            _ => return None,
        };
        if std::mem::replace(&mut seen[index], true) {
            return None;
        }
    }
    Some((config, HeaderValue::from_str(&response).ok()?))
}
