use crate::service::contact::Contact;
use serde::{Deserialize, Serialize};
use strum::{Display, EnumString, IntoStaticStr};
use thiserror::Error;
use uuid::Uuid;

/// A worker failure with its queue-routing classification.
///
/// Style exception (CS-46): the email worker error plumbing stays on
/// `anyhow::Error` rather than `rootcause`. Every queue operation, policy
/// module, and DLQ path across email_service composes through this
/// `source` field, so migrating is an all-or-nothing cross-crate change —
/// recorded here as the accepted exception rather than mixing the two
/// error stacks module by module.
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
    EmailBackfillInitBusy,
    CalendarBackfillBusy,
    GmailApiFailed,
    GmailApiRateLimited,
    /// Gmail failed with a server or network error.
    GmailApiUnavailable,
    /// A newer label write on the same messages has not finished yet.
    NewerLabelWritePending,
    /// Every fleet-wide backfill write slot stayed taken; the operation is deferred.
    BackfillWritesBusy,
    OutdatedHistoryId,
    AttachmentParsingFailed,
    DSSUploadFailed,
    InvalidData,
}

/// The reason a link was deleted, stored in the email_links_history table.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum DeletionReason {
    Unused,
    Inactive,
    ManuallyDisabled,
    UserDeleted,
    AccessRevoked,
}

impl DeletionReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            DeletionReason::Unused => "Unused",
            DeletionReason::Inactive => "Inactive",
            DeletionReason::ManuallyDisabled => "ManuallyDisabled",
            DeletionReason::UserDeleted => "UserDeleted",
            DeletionReason::AccessRevoked => "AccessRevoked",
        }
    }
}

/// The message sent to the link manager SQS queues; [`LinkManagerMessage::lane`]
/// picks the queue. Its variant name (`IntoStaticStr`) is its `operation` tag.
#[derive(Debug, Serialize, Deserialize, IntoStaticStr)]
#[serde(tag = "operation")]
pub enum LinkManagerMessage {
    /// Triggers a contact sync and refreshes the Gmail watch subscription to continue receiving
    /// inbox notifications for the user.
    Refresh { link_id: Uuid },
    /// Delete a single link from the database.
    DeleteLink {
        link_id: Uuid,
        deletion_reason: DeletionReason,
    },
    /// Delete all links for a user, identified by fusionauth_user_id.
    DeleteUser { fusionauth_user_id: String },
    /// Notify everyone who can act on a link (its owner and any delegates) that
    /// its grant has gone dead and the inbox needs to be reconnected. Enqueued
    /// once, on the edge where a link first transitions into needs-reauth.
    NotifyReauthRequired { link_id: Uuid },
    /// Probe a single link's grant and record its sync health, without renewing the
    /// Gmail watch or syncing contacts. Enqueued by the periodic health poll so a dead
    /// grant surfaces between the daily full refreshes.
    HealthCheck { link_id: Uuid },
}

/// Who sends a [`LinkManagerMessage`], which decides its lane for the kinds both send.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkManagerSender {
    /// The hourly link-maintenance sweep (`email_refresh_handler`).
    Sweep,
    /// Everything else, reacting to an event: a person removing an inbox or asking
    /// for its health, a deleted account, a token refresh that found a dead grant.
    Event,
}

/// Which link-manager queue carries a message. Each has consumers of its own, so a
/// removal someone is waiting on never queues behind the sweep's bulk work.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Display)]
#[strum(serialize_all = "snake_case")]
pub enum LinkManagerLane {
    /// What a person waits on: their own removal, an account deletion, a reauth
    /// notice, a health check they asked for.
    Interactive,
    /// The sweep's periodic work: watch refreshes, health polls and the removal of
    /// unused, inactive and ownerless links, whose purges can each run for minutes.
    Maintenance,
}

impl LinkManagerMessage {
    /// The lane `sender`'s message goes to.
    ///
    /// The sweep's removals reach the link manager twice: the sweep's message marks
    /// the link disconnecting, and the lifecycle's effect publisher then sends the
    /// removal that purges it, as [`LinkManagerSender::Event`] with the same reason.
    /// So unused and inactive removals stay on the maintenance lane by their reason,
    /// whoever sends them. A deleted owner's removal can't be told apart from an
    /// account deletion's, so only the sweep's first message of it moves.
    pub fn lane(&self, sender: LinkManagerSender) -> LinkManagerLane {
        match self {
            LinkManagerMessage::Refresh { .. } => LinkManagerLane::Maintenance,
            LinkManagerMessage::HealthCheck { .. }
            | LinkManagerMessage::DeleteLink {
                deletion_reason: DeletionReason::UserDeleted,
                ..
            } => match sender {
                LinkManagerSender::Sweep => LinkManagerLane::Maintenance,
                LinkManagerSender::Event => LinkManagerLane::Interactive,
            },
            LinkManagerMessage::DeleteLink {
                deletion_reason: DeletionReason::Unused | DeletionReason::Inactive,
                ..
            } => LinkManagerLane::Maintenance,
            LinkManagerMessage::DeleteLink {
                deletion_reason: DeletionReason::ManuallyDisabled | DeletionReason::AccessRevoked,
                ..
            }
            | LinkManagerMessage::DeleteUser { .. }
            | LinkManagerMessage::NotifyReauthRequired { .. } => LinkManagerLane::Interactive,
        }
    }
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

#[cfg(test)]
mod test;
