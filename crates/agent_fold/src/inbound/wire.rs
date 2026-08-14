//! The browser-facing envelopes around the serializable domain vocabulary.
//!
//! The renderable message, tool, permission, and metadata types live in
//! [`crate::domain::model`] and define their wire representation directly.
//! This module only adds transport context the domain does not own: the
//! session that scopes a message id, and whether a streamed message is new or
//! updated.
//!
//! Kept apart from [`crate::inbound::wasm`], which is wasm32-only, so the
//! native `export_types` binary can generate the browser's TypeScript contract.

use crate::domain::log::AgentSessionId;
use crate::domain::model::{
    Author, FoldEvent, FoldedMessage as ModelFoldedMessage, MessagePart, SessionMetadata,
    StopReason,
};
use serde::Serialize;
use specta::Type;

#[cfg(test)]
mod test;

/// One renderable message, scoped to its agent session for the browser.
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FoldedMessage {
    /// Session that scopes this message id.
    agent_session_id: String,
    /// The turn within the session, assigned in log order from zero.
    turn: u32,
    /// Who produced the message.
    author: Author,
    /// The id the control endpoint returned for the action that derived this
    /// message, for correlation. Absent on agent messages and on frames the
    /// control plane did not mint.
    request_id: Option<String>,
    /// Ordered renderable content. Never empty.
    parts: Vec<MessagePart>,
    /// How the turn ended, absent while it remains in flight.
    stop: Option<StopReason>,
}

impl FoldedMessage {
    /// Build the browser form of `message`, keyed to `session`.
    #[must_use]
    pub fn new(session: AgentSessionId, message: ModelFoldedMessage) -> Self {
        Self {
            agent_session_id: session.to_string(),
            turn: message.id.0,
            author: message.author,
            request_id: message.request_id.map(|id| id.to_string()),
            parts: message.parts.into_inner(),
            stop: message.stop,
        }
    }
}

/// One change a pushed frame implied.
///
/// Payloads are carried whole rather than as deltas: a reader replaces the
/// message under the same session, turn, and author, or replaces its metadata
/// outright.
#[derive(Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FoldedStreamEvent {
    /// A message derived for the first time.
    New {
        /// The message as it now stands.
        message: FoldedMessage,
    },
    /// A previously reported message, changed.
    Update {
        /// The message as it now stands.
        message: FoldedMessage,
    },
    /// The session's metadata changed; here it is in full.
    Metadata {
        /// The metadata as it now stands.
        metadata: SessionMetadata,
    },
}

impl FoldedStreamEvent {
    /// Build the browser form of `event`, keyed to `session`.
    #[must_use]
    pub fn new(session: AgentSessionId, event: FoldEvent<'_>) -> Self {
        match event {
            FoldEvent::NewMessage(message) => Self::New {
                message: FoldedMessage::new(session, message.into_owned()),
            },
            FoldEvent::MessageUpdate(message) => Self::Update {
                message: FoldedMessage::new(session, message.into_owned()),
            },
            FoldEvent::MetadataUpdated(metadata) => Self::Metadata {
                metadata: metadata.into_owned(),
            },
        }
    }
}
