//! The log frame a saved review leaves each time it changes.
//!
//! A review's record lives beside the session, not in its log, so viewers of
//! the session would otherwise have to poll it. Every save logs one of these:
//! an ACP extension notification (`_macro/...`) in the runtime's direction,
//! like the egress proxy's held tool calls, so every existing reader of the
//! log accepts it and ignores a method it does not know. It names the review
//! and its new revision and nothing else; readers fetch the record.

use agent_client_protocol::{JsonRpcMessage as _, JsonRpcNotification, RawJsonRpcMessage};
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::schema::v0::{AcpMessage, ToServerMessage};

#[cfg(test)]
mod test;

/// A review's saved record moved to `revision`: presented, edited, decided,
/// or an item's action finished.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonRpcNotification, Type)]
#[notification(method = "_macro/review_updated")]
#[serde(rename_all = "camelCase")]
pub struct ReviewUpdatedNotification {
    /// The review that changed.
    #[specta(type = String)]
    pub review_id: Uuid,
    /// Its saved revision after the change.
    #[specta(type = i32)]
    pub revision: i64,
}

impl ReviewUpdatedNotification {
    /// The frame to log.
    ///
    /// # Panics
    ///
    /// Never: the notification is plain data and always serializes.
    #[must_use]
    pub fn to_server_message(&self) -> ToServerMessage {
        let params = serde_json::to_value(self).expect("a review update serializes");
        let frame = RawJsonRpcMessage::notification(self.method().to_owned(), params)
            .expect("an object is valid notification params");
        ToServerMessage::Acp(AcpMessage(frame))
    }
}
