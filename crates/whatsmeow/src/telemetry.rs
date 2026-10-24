// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// A Macro addition with no whatsmeow counterpart.

//! Helpers for the tracing spans this port adds to whatsmeow's flows. Span
//! fields hold kinds, counts and outcomes only: never JIDs, phone numbers,
//! message content or keys.

use tracing::Span;

use crate::binary::Node;
use crate::errors::ClientError;

/// Why the client is (re)connecting: the `reason` of a `whatsmeow.connect`
/// span.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::IntoStaticStr)]
pub(crate) enum ConnectReason {
    /// [`crate::client::Client::connect`].
    #[strum(serialize = "initial")]
    Initial,
    /// The server's 515 stream error (restart, e.g. after pairing).
    #[strum(serialize = "restart_515")]
    Restart515,
    /// The websocket closed from the other side.
    #[strum(serialize = "network_drop")]
    NetworkDrop,
    /// [`crate::client::Client::reset_connection`].
    #[strum(serialize = "forced_reset")]
    ForcedReset,
    /// Keepalive pings failed for too long.
    #[strum(serialize = "keepalive_timeout")]
    KeepaliveTimeout,
    /// The initial connect failed with a retryable error.
    #[strum(serialize = "connect_failed")]
    ConnectFailed,
}

impl ConnectReason {
    pub(crate) fn as_str(self) -> &'static str {
        self.into()
    }
}

/// Marks a span as failed; the span must declare `otel.status_code`.
pub(crate) fn mark_error(span: &Span) {
    span.record("otel.status_code", "ERROR");
}

/// Records `outcome` (`ok` or `error`) and the error status of a span that
/// declares both fields.
pub(crate) fn record_result<Value, Error>(span: &Span, result: &Result<Value, Error>) {
    match result {
        Ok(_) => {
            span.record("outcome", "ok");
        }
        Err(_) => {
            span.record("outcome", "error");
            mark_error(span);
        }
    }
}

/// Records the outcome of an info query on its `whatsmeow.iq` span:
/// `ok`, `timeout`, `disconnected`, or `error` with the IQ `error_code`.
pub(crate) fn record_iq_result(span: &Span, result: &Result<Node, ClientError>) {
    let error = match result {
        Ok(_) => {
            span.record("outcome", "ok");
            return;
        }
        Err(error) => error.innermost(),
    };
    let outcome = match error {
        ClientError::IqTimedOut => "timeout",
        ClientError::Disconnected(_) | ClientError::NotConnected => "disconnected",
        ClientError::Iq(iq) => {
            span.record("error_code", iq.code);
            "error"
        }
        _ => "failed",
    };
    span.record("outcome", outcome);
    mark_error(span);
}

/// The tag of an info query's first child, which names the request (e.g.
/// `query`, `count`, `participants`).
pub(crate) fn iq_kind(content: Option<&crate::binary::NodeContent>) -> &str {
    match content {
        Some(crate::binary::NodeContent::Nodes(children)) => {
            children.first().map_or("", |child| child.tag.as_str())
        }
        _ => "",
    }
}

#[cfg(test)]
mod test;
