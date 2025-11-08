use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub static EMAIL_INSIGHT_PROVIDER_SOURCE_NAME: &str = "email";

/// Default batch size for email insight backfill operations
pub const EMAIL_INSIGHT_BATCH_SIZE: i64 = 50;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", content = "payload")]
pub enum EmailInfo {
    Backfill(BackfillBatchPayload),
    NewMessages(NewMessagesPayload),
    LinkDeleted(LinkDeletedPayload),
}

#[derive(Serialize, Deserialize, Debug, Clone)]
// NOTE: batches are grouped by user id
pub struct BackfillBatchPayload {
    // we will need to batch by user id
    pub thread_ids: Vec<String>,
    // Size of each batch (threads)
    pub batch_size: i64,
    // True if this is the last batch for the user
    pub is_complete: bool,
    // List of user email addresses
    pub user_emails: Vec<String>,
    // Insights backfill job ID (for tracking)
    pub job_id: String,
    // Insights backfill batch ID (for tracking)
    pub batch_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct NewMessagesPayload {
    pub messages: Vec<NewMessagePayload>,
    // uuid v4 for the batch deduplication id
    #[serde(skip)]
    pub batch_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NewMessagePayload {
    pub thread_id: Uuid,
    pub message_id: Uuid,
    pub user_email: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LinkDeletedPayload {
    pub link_id: String,
    pub email_address: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GenerateEmailInsightContext {
    pub macro_user_id: String,
    #[serde(flatten)]
    pub info: EmailInfo,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackfillEmailInsightsFilter {
    /// The user ids to backfill
    /// If not provided, all users will be backfilled
    pub user_ids: Option<Vec<String>>,
    /// Optional limit on the total number of threads to get for a user
    pub user_thread_limit: Option<i64>,
}
