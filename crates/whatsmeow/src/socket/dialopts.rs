// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow socket/dialopts.go and the headers in
// socket/framesocket.go (MPL-2.0, Copyright (c) Tulir Asokan)

use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::Request;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;

use super::constants::{FRAME_MAX_SIZE, ORIGIN, SocketError};

/// The upgrade request for `url` with the headers whatsmeow sends.
pub(super) fn make_dial_request(url: &str) -> Result<Request, SocketError> {
    let mut request = url
        .into_client_request()
        .map_err(|error| SocketError::DialFailed {
            status_code: None,
            source: Box::new(error),
        })?;
    let headers = request.headers_mut();
    headers.insert("Origin", HeaderValue::from_static(ORIGIN));
    headers.insert("Cache-Control", HeaderValue::from_static("no-cache"));
    headers.insert("Pragma", HeaderValue::from_static("no-cache"));
    Ok(request)
}

/// Go sets the read limit to [`FRAME_MAX_SIZE`].
pub(super) fn websocket_config() -> WebSocketConfig {
    WebSocketConfig::default()
        .max_message_size(Some(FRAME_MAX_SIZE))
        .max_frame_size(Some(FRAME_MAX_SIZE))
}
