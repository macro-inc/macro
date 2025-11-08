pub mod contacts;
pub mod error;
pub mod history;
pub mod labels;
pub mod operations;
pub mod webhook;

use serde::{Deserialize, Serialize};

// -- Threads objects --
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListThreadsResponse {
    pub threads: Option<Vec<ThreadSummary>>,
    pub next_page_token: Option<String>,
}

// Represents a single thread resource within the list
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSummary {
    pub id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThreadResource {
    pub id: String,
    pub messages: Vec<MessageResource>,
}

// -- Messages objects --

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MessageResource {
    pub id: String,
    pub thread_id: String,
    #[serde(default)]
    pub label_ids: Vec<String>,
    pub snippet: String,
    pub size_estimate: u64,
    pub history_id: String,
    #[serde(rename = "internalDate")]
    pub internal_date: String,
    pub payload: MessagePart,
}

// response from the get thread endpoint with ?format=minimal - we just care about thread_id and the message ids inside
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MinimalThreadResource {
    pub id: String,
    pub messages: Vec<MinimalMessageResource>,
}

// response from the get message endpoint with ?format=minimal - we just care about the ids
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MinimalMessageResource {
    pub id: String,
    pub thread_id: String,
    #[serde(default)]
    pub label_ids: Vec<String>,
}

/// the message resource returned by gmail API when sending a message
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SentMessageResource {
    pub id: String,
    pub thread_id: String,
}

/// Request payload for sending a message to Gmail API
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SendMessagePayload {
    /// Base64-encoded email content
    pub raw: String,
    /// Optional thread ID to include the message in an existing thread
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MessagePart {
    #[serde(default)]
    pub part_id: String,
    pub mime_type: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub headers: Vec<Header>,
    #[serde(default)]
    pub body: Option<MessagePartBody>,
    #[serde(default)]
    pub parts: Option<Vec<MessagePart>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Header {
    pub name: String,
    pub value: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MessagePartBody {
    // a different value is returned by the gmail API for this each time you fetch a message -
    // don't make the mistake of using it to uniquely identify an attachment
    #[serde(default)]
    pub attachment_id: Option<String>,
    pub size: i64,
    #[serde(rename = "data")]
    #[serde(default)]
    pub data_base64: Option<String>,
}

// -- Attachments objects --

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentGetResponse {
    pub size: i64,
    pub data: Option<String>,
}

#[derive(Clone, Debug)]
pub struct AttachmentFetchInfo {
    pub message_id: String,
    pub attachment_id: String,
    pub size: i64,
}

pub struct AttachmentFetchResult {
    pub message_id: String,
    pub attachment_id: String,
    pub data: anyhow::Result<Vec<u8>>,
}

// -- History objects --

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfileResponse {
    pub history_id: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryListResponse {
    pub history: Option<Vec<HistoryRecord>>,
    pub next_page_token: Option<String>,
    pub history_id: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecord {
    pub id: String,
    pub messages: Option<Vec<HistoryMessage>>,
    pub messages_added: Option<Vec<MessageAdded>>,
    pub messages_deleted: Option<Vec<MessageDeleted>>,
    pub labels_added: Option<Vec<LabelAdded>>,
    pub labels_removed: Option<Vec<LabelRemoved>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MessageAdded {
    pub message: HistoryMessage,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MessageDeleted {
    pub message: HistoryMessage,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LabelAdded {
    pub message: HistoryMessage,
    pub label_ids: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LabelRemoved {
    pub message: HistoryMessage,
    pub label_ids: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMessage {
    pub id: String,
    pub thread_id: String,
}

/// Request body for registering a watch notification
#[derive(Debug, Serialize)]
pub struct WatchRequest {
    pub topic_name: String,
}

/// Request body for modifying Gmail message labels
#[derive(Debug, Serialize)]
pub struct ModifyLabelsRequest {
    #[serde(rename = "addLabelIds")]
    pub add_label_ids: Vec<String>,

    #[serde(rename = "removeLabelIds")]
    pub remove_label_ids: Vec<String>,
}

/// Response structure for Gmail user profile data
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailUserProfile {
    pub email_address: String,
    pub messages_total: i32,
    pub threads_total: i32,
    pub history_id: String,
}
