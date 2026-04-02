use serde::{Deserialize, Serialize};
use strum::Display;
use uuid::Uuid;

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
    /// Add or remove labels from messages in Gmail
    ModifyMessageLabels(ModifyMessageLabelsPayload),
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
