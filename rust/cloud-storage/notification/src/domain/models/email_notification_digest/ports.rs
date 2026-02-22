use crate::domain::models::{TaggedContent, UserNotificationRow};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde::Deserialize;
use std::time::Duration;
use uuid::Uuid;

/// trait for checking whether or not a user exists
pub trait UserExistenceChecker: Send + Sync + 'static {
    /// does the user exist in the database?
    fn user_exists<'a>(
        &self,
        id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
}

/// A batch of notifications ready to be sent as a digest email.
#[derive(Debug)]
pub struct DigestBatch {
    /// The user to send the digest to.
    pub user_id: MacroUserIdStr<'static>,
    /// The notifications to include in the digest.
    pub notifications: Vec<UserNotificationRow<TaggedContent<serde_json::Value>>>,
}

/// Result of attempting to claim a digest batch.
#[derive(Debug)]
pub enum ClaimResult {
    /// A digest batch is ready and was claimed.
    Ready(DigestBatch),
    /// No digests are pending.
    Empty,
    /// Digests are pending but none are ready yet. Contains duration until the next one is ready.
    Wait(Duration),
}

/// Trait for batching notifications into digests for delayed email delivery.
///
/// Implementations should handle:
/// - Adding notifications to a user's pending digest
/// - Scheduling when the digest should be sent
/// - Atomically claiming digests for processing to prevent duplicates
pub trait DigestBatcher: Send + Sync + 'static {
    /// Add a notification to a user's pending digest batch.
    ///
    /// If this is the first notification for the user, schedules the digest
    /// to be sent after `send_after` duration.
    fn add_to_digest(
        &self,
        notification: &UserNotificationRow<serde_json::Value>,
        send_after: Duration,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Claim and return one digest batch that is ready to be sent.
    ///
    /// Returns:
    /// - `ClaimResult::Ready(batch)` - a batch was claimed and is ready to send
    /// - `ClaimResult::Empty` - no digests are pending
    /// - `ClaimResult::Wait(duration)` - digests are pending but not ready; wait this long
    ///
    /// The claim is atomic - only one caller will receive a given user's digest
    /// even with concurrent workers.
    fn claim_ready_digest(&self) -> impl Future<Output = Result<ClaimResult, Report>> + Send;
}

/// trait for checking whether or not a user has push notifications enabled
pub trait PushNotificationChecker: Send + Sync + 'static {
    /// does the user have push notifications enabled?
    fn push_notification_enabled<'a>(
        &self,
        user: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
}

/// trait for checking the duration since the last known online time of the user
pub trait LastOnlineChecker: Send + Sync + 'static {
    /// return the duration since the last known online time of the user
    fn last_online_checker<'a>(
        &self,
        user: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<Duration, Report>> + Send;
}

/// The id of a message that was send as a push notification to SNS
#[derive(Debug, Clone, Deserialize)]
#[serde(transparent)]
pub struct MessageId(pub String);

/// trait for storage a message_id associated with a user_notification PK
/// the user notification PK is (notification uuid, userid)
pub trait MessageReceiptRepo: Send + Sync + 'static {
    /// create a record in the database which associates the PK message_id with the FK to user_notifications (user_id, notification_id)
    fn record_message_id(
        &self,
        message_id: MessageId,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// given a message_id mark the row in the database as failed and then return the associated FK for the failed record
    fn mark_message_failed(
        &self,
        message_id: MessageId,
    ) -> impl Future<Output = Result<(MacroUserIdStr<'static>, Uuid), Report>> + Send;

    /// given the user_notification FK, check if all messages for this notification have failed
    fn did_all_messages_fail(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
}

/// trait which abstracts away the sending of a notification
pub trait NotificationSendChecker: Send {
    /// the type returned when the notification was sent successfully
    type Ok: Send;
    /// the error type of the request
    type Err: Send;

    /// try to send the notification
    fn send_notification(self) -> impl Future<Output = Result<Self::Ok, Self::Err>> + Send;

    /// extract the message Id from the return value
    fn extract_message_id(res: &Self::Ok) -> MessageId;
}
