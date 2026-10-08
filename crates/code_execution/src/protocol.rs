//! Version-one private WebSocket transport. One socket owns one execution.

use crate::domain::{ExecuteRequest, ExecutionEvent, HostReply};
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;

/// Ceiling before JSON decoding, separate from source and child frame limits.
pub const MAX_WIRE_BYTES: usize = 512 * 1024;

/// Dedicated service credential; deliberately does not implement `Debug`.
#[derive(Clone)]
pub struct ServiceToken(String);

impl ServiceToken {
    /// Require a sufficiently long printable token usable in a bearer header.
    pub fn new(value: String) -> Result<Self, rootcause::Report> {
        if !(32..=256).contains(&value.len()) || !value.bytes().all(|b| b.is_ascii_graphic()) {
            return Err(rootcause::report!(
                "runner token must contain 32–256 printable ASCII characters"
            ));
        }
        Ok(Self(value))
    }

    pub(crate) fn matches(&self, candidate: &str) -> bool {
        bool::from(self.0.as_bytes().ct_eq(candidate.as_bytes()))
    }

    pub(crate) fn authorization(&self) -> String {
        format!("Bearer {}", self.0)
    }
}

/// Only the authenticated backend can write these frames.
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ClientMessage {
    /// Must be the first frame, exactly once.
    Execute {
        /// Program and requested deadline.
        request: ExecuteRequest,
    },
    /// Resolve a pending bridge request on this socket.
    Reply {
        /// Correlated tool response.
        reply: HostReply,
    },
    /// Cancel this socket's execution and wait for its terminal event.
    Cancel,
}

/// Supervisor output, distinct from sandbox stdout.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    /// Ordered live activity.
    Event {
        /// Event with host-stamped execution identity and sequence.
        event: ExecutionEvent,
    },
    /// Admission or connection protocol failure, before normal termination.
    Rejected {
        /// Safe diagnostic.
        message: String,
    },
}
