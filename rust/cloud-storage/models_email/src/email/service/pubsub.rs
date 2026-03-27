use crate::service::contact::Contact;
use serde::{Deserialize, Serialize};
use strum::{Display, EnumString};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
#[error("{reason}: {source}")]
pub struct DetailedError {
    pub reason: FailureReason,
    #[source]
    pub source: anyhow::Error,
}

#[derive(Debug, Error)]
pub enum ProcessingError {
    #[error("Retryable error occurred")]
    Retryable(#[source] DetailedError),

    #[error("Non-retryable error occurred")]
    NonRetryable(#[source] DetailedError),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Display, EnumString)]
pub enum FailureReason {
    DatabaseQueryFailed,
    RedisQueryFailed,
    SqsEnqueueFailed,
    AccessTokenFetchFailed,
    MessageNotFoundInProvider,
    MessageNotFoundInDatabase,
    LinkNotFound,
    BackfillJobNotFound,
    GmailApiFailed,
    GmailApiRateLimited,
    OutdatedHistoryId,
    AttachmentParsingFailed,
    DSSUploadFailed,
    InvalidData,
}

/// The message sent to the link manager SQS queue.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "operation")]
pub enum LinkManagerMessage {
    /// Triggers a contact sync and refreshes the Gmail watch subscription to continue receiving
    /// inbox notifications for the user.
    Refresh { link_id: Uuid },
    /// Delete a single link from the database.
    DeleteLink { link_id: Uuid },
    /// Delete all links for a user, identified by fusionauth_user_id.
    DeleteUser { fusionauth_user_id: String },
}

/// The message we send from the email_scheduled_handler lambda to the service via SQS to trigger
/// the sending of a scheduled message
#[derive(Debug, Serialize, Deserialize)]
pub struct ScheduledPubsubMessage {
    pub link_id: Uuid,
    pub message_id: Uuid,
}

/// The message we send to the sfs_uploader telling it what image URL to upload
#[derive(Debug, Serialize, Deserialize)]
pub struct SFSUploaderMessage {
    pub contact: Contact,
}
