//! Signals between DSS and the session service over Postgres `NOTIFY`, and
//! the trace context they carry. Each payload is a JSON [`Signal`] (or
//! [`ChangeSignal`] for [`CHANGED`]) with the sender's `traceparent`, so the
//! receiver joins its trace. Shared by both sides; not an adapter.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// `<pairing_id>`: start, update or stop pairing.
pub const PAIRING_REQUESTED: &str = "whatsapp_pairing_requested";
/// `<account_id>`: claim pending sends.
pub const SEND_REQUESTED: &str = "whatsapp_send_requested";
/// `<account_id>`: re-read the account's groups.
pub const GROUPS_REQUESTED: &str = "whatsapp_groups_requested";
/// `<account_id>`: consent or adopted groups changed; re-read the account.
pub const ACCOUNT_CHANGED: &str = "whatsapp_account_changed";
/// `<account_id>`: a replica released the account (session service only).
pub const ACCOUNT_RELEASED: &str = "whatsapp_account_released";
/// `<blob_id>`: attachment bytes are ready to import (DSS listens).
pub const MEDIA_READY: &str = "whatsapp_media_ready";
/// `<message_id>`: a standalone message notification is ready (DSS listens).
pub const GROUP_EFFECTS: &str = "whatsapp_group_effects";
/// A [`ChangeSignal`]: something a page shows changed (DSS listens and
/// pushes `whatsapp_changed` to the people who see it).
pub const CHANGED: &str = "whatsapp_changed";

/// Payload of every signal except [`CHANGED`].
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
    /// The account's own group list (roster) changed: its owner's add list.
    Groups {
        /// Account whose roster changed.
        account_id: Uuid,
    },
    /// A group entity's details, timeline or sends changed: everyone who
    /// can view it.
    Group {
        /// Group entity.
        group_id: Uuid,
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
