//! Domain models for email reminder delivery.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Maximum subject length stored with a reminder.
pub const MAX_DESCRIPTION_LEN: usize = 2_000;
/// Default collection page size.
pub const DEFAULT_PAGE_SIZE: u32 = 100;
/// Maximum collection page size.
pub const MAX_PAGE_SIZE: u32 = 500;

/// A cursor string that could not be decoded.
#[derive(Debug, thiserror::Error)]
#[error("invalid cursor")]
pub struct InvalidCursor;

/// Email reminder delivery facts, private to its owner.
#[derive(Debug, Clone)]
pub struct DueReminder {
    /// Identity of this snooze.
    pub reminder_id: Uuid,
    /// Original email thread to notify on.
    pub thread_id: Uuid,
    /// Email subject captured when the snooze was scheduled.
    pub description: String,
    /// Only recipient of this notification.
    pub owner_id: MacroUserIdStr<'static>,
    /// Claimed delivery time; edits invalidate messages for earlier times.
    pub scheduled_for: DateTime<Utc>,
}

/// One firing to deliver: the reminder, and which of its firings this is.
///
/// What a sweep fans out and a delivery resolves back into a [`DueReminder`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DueFiring {
    /// The reminder that came due.
    pub reminder_id: Uuid,
    /// The firing, which is also the occurrence's `scheduled_for`.
    pub scheduled_for: DateTime<Utc>,
}

/// A message on the reminder dispatch queue.
///
/// Wrapped in a struct rather than being a bare enum because EventBridge sends
/// the minutely tick as a literal `{"operation":"sweep"}` payload, and that
/// shape has to survive round-tripping through this type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderDispatchMessage {
    /// What the receiving worker should do.
    pub operation: ReminderDispatchOperation,
}

impl ReminderDispatchMessage {
    /// Wrap an operation for publishing.
    pub fn new(operation: ReminderDispatchOperation) -> Self {
        Self { operation }
    }

    /// The message a sweep publishes for one due firing.
    pub fn deliver(firing: DueFiring) -> Self {
        Self::new(ReminderDispatchOperation::Deliver {
            reminder_id: firing.reminder_id,
            scheduled_for: firing.scheduled_for,
        })
    }
}

/// The work one dispatch message asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReminderDispatchOperation {
    /// Find everything due and fan out a `Deliver` for each.
    ///
    /// A unit variant so it serializes as the bare string `"sweep"`: this is
    /// the static payload an EventBridge rule puts on the queue every minute,
    /// and a rule can only send a constant.
    Sweep,
    /// Deliver one firing: claim it, notify the owner, complete it.
    Deliver {
        /// The reminder that came due.
        reminder_id: Uuid,
        /// Which firing of it. Stale values are dropped rather than delivered
        /// — see [`DeliveryOutcome::Gone`].
        scheduled_for: DateTime<Utc>,
    },
}

/// What one sweep did, for logging and metrics.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SweepSummary {
    /// Firings fanned out onto the queue.
    pub dispatched: usize,
}

/// What became of one `Deliver` message.
///
/// Every variant is a success in the queueing sense — the message is acked.
/// A failure that should be retried surfaces as an `Err` instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryOutcome {
    /// Notified and completed.
    Delivered,
    /// Another worker holds the claim, or it already sent. Duplicate fan-out
    /// is expected — overlapping sweeps and redelivered sweep messages both
    /// produce it — and this is where it stops being a double-send.
    AlreadyClaimed,
    /// Nothing left to deliver: the reminder was deleted, completed, disabled,
    /// or rescheduled out from under this message between sweep and delivery.
    Gone,
}

/// Errors returned by the reminders service.
#[derive(Debug, thiserror::Error)]
pub enum ReminderError {
    /// No such reminder belongs to the caller.
    #[error("reminder not found")]
    NotFound,
    /// The entity the reminder would be attached to does not exist. Distinct
    /// from [`ReminderError::NotFound`] so a failed create does not tell the
    /// caller "reminder not found" about a reminder they were trying to make.
    #[error("entity not found")]
    EntityNotFound,
    /// The request was invalid.
    #[error("{0}")]
    BadRequest(String),
    /// The caller may not attach a reminder to the requested entity. This is an
    /// authorization failure and maps to `403`; authentication failures (`401`)
    /// are produced by the authorization extractor before a handler runs.
    #[error("you do not have access to this entity")]
    EntityAccessDenied,
    /// Any other internal error.
    #[error("internal reminders error: {0:?}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for ReminderError {
    fn from(report: rootcause::Report) -> Self {
        ReminderError::Internal(report)
    }
}

impl From<InvalidCursor> for ReminderError {
    fn from(err: InvalidCursor) -> Self {
        ReminderError::BadRequest(err.to_string())
    }
}
