//! Durable single-thread email reminder workflow.
//!
//! Every writer (including generic edit/remove and dispatch) takes the same
//! user/thread lock. Intent is stored before email side effects; the minute
//! sweep retries incomplete intent after a crash. Operation identities outlive
//! cancellation, so a timed-out request cannot recreate a removed follow-up.

use super::{models::ReminderError, ports::RemindersRepo};
use chrono::{DateTime, Utc};
use email::domain::followup::ReplyBaseline;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub mod dispatch;
pub mod reminder_service;
pub mod service;

/// When an email follow-up should return the conversation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum EmailReminderCondition {
    /// Cancel when a new inbound reply arrives after the captured baseline.
    #[default]
    IfNoReply,
    /// Return even if a reply has arrived.
    Regardless,
}

/// Durable progress of an email operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum FollowupState {
    /// Intent saved; archive needs to finish.
    Archiving,
    /// Archived and waiting for a reply or the selected time.
    Pending,
    /// Removal/undo requested; inbox restoration needs to finish.
    Returning,
    /// Due-time return succeeded; alert delivery may still be retrying.
    Returned,
    /// New reply, deleted thread, trash or lost access made it ineligible.
    Cancelled,
    /// User removed/undid the follow-up and restoration finished.
    Removed,
}

impl FollowupState {
    /// Stable indexed database spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Archiving => "archiving",
            Self::Pending => "pending",
            Self::Returning => "returning",
            Self::Returned => "returned",
            Self::Cancelled => "cancelled",
            Self::Removed => "removed",
        }
    }
    /// Whether this workflow reserves the user's one active slot.
    pub fn active(self) -> bool {
        matches!(self, Self::Archiving | Self::Pending | Self::Returning)
    }
}

/// Public status shown on email and in the Reminders editor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EmailFollowup {
    /// Its ordinary reminder, used by the existing alert/management surfaces.
    pub reminder_id: Uuid,
    /// Conversation identity.
    pub thread_id: Uuid,
    /// Canonical owned/delegated inbox.
    pub link_id: Uuid,
    /// Condition, defaulting to no reply for new follow-ups.
    pub condition: EmailReminderCondition,
    /// Confirmed schedule.
    pub remind_at: DateTime<Utc>,
    /// Last accepted operation; edits/removal compare this to prevent stale undo.
    pub revision: Uuid,
    /// Durable lifecycle progress.
    pub state: FollowupState,
}

/// Persisted private state. Reply identities never need to reach the browser.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FollowupRecord {
    /// Public projection.
    pub followup: EmailFollowup,
    /// Authenticated owner, not necessarily the inbox owner for delegation.
    pub user_id: MacroUserIdStr<'static>,
    /// Stable reply boundary.
    pub baseline: ReplyBaseline,
    /// Undo restores original visibility, including sent-only conversations.
    pub original_inbox_visible: bool,
    /// Preserve ordering when undo/rollback restores the original inbox state.
    #[serde(default)]
    pub original_returned_at: Option<DateTime<Utc>>,
    /// Whether this is an undo/rollback rather than an explicit return.
    #[serde(default)]
    pub restore_original: bool,
    /// Visibility desired by an explicit remove/undo operation.
    pub restore_inbox_visible: bool,
    /// A reply-triggered restoration finishes without a reminder alert.
    #[serde(default)]
    pub cancel_on_restore: bool,
}

/// Lookup response, including an email with no follow-up yet.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct EmailFollowupResponse {
    /// Most recent specialized follow-up, if any.
    pub followup: Option<EmailFollowup>,
}

/// Idempotent email command. Reusing an operation ID with different data fails.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum EmailFollowupCommand {
    /// Create or edit one follow-up. An edit requires the displayed revision.
    Set {
        /// Unique request identity retained across network retries.
        #[serde(rename = "operationId")]
        operation_id: Uuid,
        /// None for creation, the current revision for edits.
        #[serde(rename = "expectedRevision")]
        expected_revision: Option<Uuid>,
        /// One future instant; conditional recurrence is deliberately absent.
        #[serde(rename = "remindAt")]
        remind_at: DateTime<Utc>,
        /// Reply condition.
        condition: EmailReminderCondition,
    },
    /// Cancel and restore the conversation without leaving a future alert.
    Remove {
        /// Unique request identity.
        #[serde(rename = "operationId")]
        operation_id: Uuid,
        /// Reject removal if a newer edit has replaced this operation.
        #[serde(rename = "expectedRevision")]
        expected_revision: Uuid,
        /// Undo restores original visibility; ordinary Remove returns to inbox.
        #[serde(default)]
        undo: bool,
    },
}

impl EmailFollowupCommand {
    /// Request identity shared by create/edit/remove.
    pub fn operation_id(&self) -> Uuid {
        match self {
            Self::Set { operation_id, .. } | Self::Remove { operation_id, .. } => *operation_id,
        }
    }
}

/// Repository contract for the durable workflow, alongside ordinary reminders.
pub trait EmailFollowupRepo: RemindersRepo {
    /// A database-wide lock; dropping it releases serialization after a crash.
    type Guard: Send;
    /// Serialize every operation affecting this user/thread, across processes.
    fn lock_followup(
        &self,
        user: &MacroUserIdStr<'_>,
        thread: Uuid,
    ) -> impl Future<Output = Result<Self::Guard, ReminderError>> + Send;
    /// Most recently created workflow for this thread, including terminal state.
    fn thread_followup(
        &self,
        user: &MacroUserIdStr<'_>,
        thread: Uuid,
    ) -> impl Future<Output = Result<Option<FollowupRecord>, ReminderError>> + Send;
    /// Resolve a reminder's specialization, without treating generic email reminders as follow-ups.
    fn reminder_followup(
        &self,
        user: &MacroUserIdStr<'_>,
        reminder: Uuid,
    ) -> impl Future<Output = Result<Option<FollowupRecord>, ReminderError>> + Send;
    /// Return the previously accepted command and associated reminder identity.
    fn previous_operation(
        &self,
        user: &MacroUserIdStr<'_>,
        operation: Uuid,
    ) -> impl Future<Output = Result<Option<(Uuid, EmailFollowupCommand)>, ReminderError>> + Send;
    /// Atomically persist intent, its operation identity and the ordinary reminder.
    /// The caller holds the user/thread guard. `description` is supplied on create.
    fn save_followup(
        &self,
        record: &FollowupRecord,
        command: Option<&EmailFollowupCommand>,
        description: Option<&str>,
    ) -> impl Future<Output = Result<(), ReminderError>> + Send;
    /// Page active workflows by reminder ID so every minute can reconcile replies
    /// and unfinished email effects, even when no browser is connected.
    fn reconciliation_page(
        &self,
        after: Option<Uuid>,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<FollowupRecord>, ReminderError>> + Send;
}
