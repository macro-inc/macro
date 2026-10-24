use serde::{Deserialize, Serialize};
use strum::Display;
use uuid::Uuid;

/// Gmail's limit on message ids in one `messages.batchModify` request.
pub const MAX_BATCH_MODIFY_MESSAGES: usize = 1000;

/// Message type for the Gmail operations worker queue.
/// Contains the link_id (to fetch the Gmail access token) and the operation to perform.
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GmailOpsPubsubMessage {
    pub link_id: Uuid,
    pub operation: GmailOpsOperation,
}

/// Operations that can be performed asynchronously against the Gmail API.
#[derive(Debug, Deserialize, Serialize, Clone, Display)]
#[serde(rename_all = "snake_case")]
pub enum GmailOpsOperation {
    /// Add or remove labels from one message in Gmail. Producers enqueue
    /// `ModifyMessageLabelsBatch`; this form stays decodable so queued and
    /// retrying messages from earlier releases still drain.
    ModifyMessageLabels(ModifyMessageLabelsPayload),
    /// Add or remove the same labels on messages with one Gmail request
    ModifyMessageLabelsBatch(ModifyMessageLabelsBatchPayload),
    /// Delete a label from Gmail
    DeleteLabel(DeleteLabelPayload),
    /// Create a filter to block a sender in Gmail
    BlockSender(BlockSenderPayload),
    /// Remove a block filter for a sender in Gmail
    UnblockSender(UnblockSenderPayload),
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModifyMessageLabelsPayload {
    /// The database ID of the message to modify
    pub db_message_id: Uuid,
    /// The Gmail provider message ID
    pub provider_message_id: String,
    pub labels_to_add: Vec<String>,
    pub labels_to_remove: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModifyMessageLabelsBatchPayload {
    /// At most [`MAX_BATCH_MODIFY_MESSAGES`] messages, so the batch is one
    /// Gmail request
    pub messages: Vec<GmailMessageRef>,
    pub labels_to_add: Vec<String>,
    pub labels_to_remove: Vec<String>,
}

/// The database and Gmail ids of one message.
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GmailMessageRef {
    pub db_message_id: Uuid,
    pub provider_message_id: String,
}

impl From<ModifyMessageLabelsPayload> for ModifyMessageLabelsBatchPayload {
    fn from(payload: ModifyMessageLabelsPayload) -> Self {
        Self {
            messages: vec![GmailMessageRef {
                db_message_id: payload.db_message_id,
                provider_message_id: payload.provider_message_id,
            }],
            labels_to_add: payload.labels_to_add,
            labels_to_remove: payload.labels_to_remove,
        }
    }
}

impl ModifyMessageLabelsBatchPayload {
    /// Splits a label write into payloads that each fit one Gmail request.
    pub fn chunked(
        messages: Vec<GmailMessageRef>,
        labels_to_add: Vec<String>,
        labels_to_remove: Vec<String>,
    ) -> Vec<Self> {
        messages
            .chunks(MAX_BATCH_MODIFY_MESSAGES)
            .map(|chunk| Self {
                messages: chunk.to_vec(),
                labels_to_add: labels_to_add.clone(),
                labels_to_remove: labels_to_remove.clone(),
            })
            .collect()
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeleteLabelPayload {
    pub provider_label_id: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BlockSenderPayload {
    pub email_address: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnblockSenderPayload {
    pub email_address: String,
}

#[cfg(test)]
mod test;
