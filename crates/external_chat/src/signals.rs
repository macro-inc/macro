//! Signals to DSS over Postgres `NOTIFY`, and the trace context they carry.
//! Each payload is a JSON [`Signal`] (or [`ChangeSignal`] for [`CHANGED`])
//! with the sender's `traceparent`, so the receiver joins its trace. Provider
//! processes send them too; not an adapter.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// `<blob_id>`: attachment bytes are ready to import (DSS listens).
pub const MEDIA_READY: &str = "whatsapp_media_ready";
/// `<message_id>`: an external chat message notification is ready (DSS listens).
pub const CHAT_EFFECTS: &str = "external_chat_effects";
/// A [`ChangeSignal`]: something a page shows changed (DSS listens and
/// pushes `external_chat_changed` to the people who see it).
pub const CHANGED: &str = "external_chat_changed";

/// Payload of every signal except [`CHANGED`], including the providers' own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Signal {
    /// The id the channel documents.
    pub id: Uuid,
    /// The sender's W3C trace context.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traceparent: Option<String>,
}

impl Signal {
    /// Read a payload; `None` when malformed.
    pub fn parse(payload: &str) -> Option<Self> {
        serde_json::from_str(payload).ok()
    }
}

/// What changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "scope", rename_all = "snake_case")]
pub enum Change {
    /// A provider account's own chat list changed: its owner's add list.
    Chats {
        /// Account whose chat list changed.
        account_id: Uuid,
    },
    /// An external chat's details, timeline or sends changed: everyone who
    /// can view it.
    Chat {
        /// External chat entity.
        chat_id: Uuid,
    },
}

/// Payload of [`CHANGED`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChangeSignal {
    /// What changed.
    #[serde(flatten)]
    pub change: Change,
    /// The sender's W3C trace context.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traceparent: Option<String>,
}

impl ChangeSignal {
    /// Read a payload; `None` when malformed.
    pub fn parse(payload: &str) -> Option<Self> {
        serde_json::from_str(payload).ok()
    }
}

/// W3C trace context across the Postgres hops.
#[cfg(feature = "outbound")]
pub mod trace_context;

#[cfg(test)]
mod test;
