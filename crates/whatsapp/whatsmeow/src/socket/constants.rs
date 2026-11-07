// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow socket/constants.go (MPL-2.0, Copyright (c) Tulir Asokan)

use crate::binary::token;

/// The Origin header for all WhatsApp websocket connections.
pub const ORIGIN: &str = "https://web.whatsapp.com";
/// The websocket URL for the multidevice protocol.
pub const URL: &str = "wss://web.whatsapp.com/ws/chat";

/// The Noise protocol name, padded to 32 bytes so it is used as the initial
/// hash directly.
pub const NOISE_START_PATTERN: &[u8] = b"Noise_XX_25519_AESGCM_SHA256\x00\x00\x00\x00";

/// The magic value in the connection header.
pub const WA_MAGIC_VALUE: u8 = 6;

/// The header sent before the first frame of a connection.
pub const WA_CONN_HEADER: [u8; 4] = [b'W', b'A', WA_MAGIC_VALUE, token::DICT_VERSION];

/// Frames must be shorter than this.
pub const FRAME_MAX_SIZE: usize = 1 << 24;
/// The length of the big-endian frame length prefix.
pub const FRAME_LENGTH_SIZE: usize = 3;

/// Errors from the frame and noise sockets.
#[derive(Debug, thiserror::Error)]
pub enum SocketError {
    /// The frame is [`FRAME_MAX_SIZE`] bytes or larger.
    #[error("frame too large (got {length} bytes, max {FRAME_MAX_SIZE} bytes)")]
    FrameTooLarge {
        /// The frame length.
        length: usize,
    },
    /// The socket isn't connected.
    #[error("frame socket is closed")]
    SocketClosed,
    /// Dialing the websocket failed. Go wraps the HTTP status code in
    /// `ErrWithStatusCode` when there was a response.
    #[error("failed to dial whatsapp web websocket (status {status_code:?}): {source}")]
    DialFailed {
        /// The HTTP status of the failed upgrade, if the server answered.
        status_code: Option<u16>,
        /// The websocket error.
        source: Box<tokio_tungstenite::tungstenite::Error>,
    },
    /// Writing to the websocket failed.
    #[error("failed to write to websocket: {0}")]
    Write(#[source] Box<tokio_tungstenite::tungstenite::Error>),
    /// Encrypting a frame failed.
    #[error("failed to encrypt frame: {0}")]
    Encrypt(#[from] crate::util::gcmutil::GcmError),
}
