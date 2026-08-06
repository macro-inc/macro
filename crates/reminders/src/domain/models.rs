//! Domain models for reminders.

#[cfg(test)]
mod test;

use std::str::FromStr;

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use cron::Schedule as CronSchedule;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use serde::{Deserialize, Deserializer, Serialize};
use uuid::Uuid;

/// Upper bound on a reminder's description in characters, so list payloads
/// stay sane. Mirrored by the `reminder_description_max_length` DB constraint.
pub const MAX_DESCRIPTION_LEN: usize = 2_000;

/// Default number of reminders returned by a list request.
pub const DEFAULT_PAGE_SIZE: u32 = 100;

/// Largest page a client may ask for.
pub const MAX_PAGE_SIZE: u32 = 500;

/// A cron expression the `cron` crate could not parse.
#[derive(Debug, thiserror::Error)]
#[error(
    "invalid cron expression ({0}); expected 5 fields (min hour dom mon dow) \
     or 6-7 fields (sec min hour dom mon dow [year]), e.g. `0 0 9 * * *` for daily at 09:00"
)]
pub struct InvalidCron(String);

/// A cron expression, validated and normalized on construction.
///
/// The `cron` crate requires 6 or 7 fields (`sec min hour dom mon dow [year]`),
/// but the conventional 5-field form is what most clients send, so a 5-field
/// expression is normalized by prepending a zero-seconds field: `0 9 * * *`
/// becomes `0 0 9 * * *`, both meaning daily at 09:00.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct ReminderCron(String);

impl ReminderCron {
    /// Validate, normalize, and wrap a cron expression.
    pub fn parse(cron: impl Into<String>) -> Result<Self, InvalidCron> {
        let cron = normalize_cron(cron.into());
        CronSchedule::from_str(&cron).map_err(|e| InvalidCron(e.to_string()))?;
        Ok(Self(cron))
    }

    /// The expression as stored.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The first firing strictly after `after`, evaluated in `timezone` and
    /// returned in UTC. `None` when the expression has no further firing (it
    /// can be year-qualified).
    pub fn next_run_after(&self, after: DateTime<Utc>, timezone: Tz) -> Option<DateTime<Utc>> {
        CronSchedule::from_str(&self.0)
            .expect("cron validated on construction")
            .after(&after.with_timezone(&timezone))
            .next()
            .map(|dt| dt.with_timezone(&Utc))
    }
}

impl<'de> Deserialize<'de> for ReminderCron {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        ReminderCron::parse(raw).map_err(serde::de::Error::custom)
    }
}

/// Drop any precision finer than a microsecond, matching what a cursor encodes
/// and what Postgres stores.
fn truncate_to_micros(at: DateTime<Utc>) -> DateTime<Utc> {
    DateTime::from_timestamp_micros(at.timestamp_micros()).unwrap_or(at)
}

/// Promote a conventional 5-field cron to the 6-field form the `cron` crate
/// parses. Anything else is passed through for `cron` to accept or reject.
fn normalize_cron(cron: String) -> String {
    if cron.split_whitespace().count() == 5 {
        return format!("0 {}", cron.trim());
    }
    cron
}

/// When a reminder fires.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ReminderSchedule {
    /// Fires once, at a fixed instant.
    #[serde(rename_all = "camelCase")]
    Once {
        /// The instant to fire at.
        remind_at: DateTime<Utc>,
    },
    /// Fires repeatedly, on a cron schedule evaluated in `timezone`.
    #[serde(rename_all = "camelCase")]
    Recurring {
        /// Cron expression, either the conventional 5-field
        /// `min hour dom mon dow` or the 6-/7-field
        /// `sec min hour dom mon dow [year]`. A 5-field expression is stored
        /// normalized to 6 fields with a zero seconds field, so `0 9 * * *` and
        /// `0 0 9 * * *` are the same schedule and both read back as the latter.
        #[cfg_attr(feature = "inbound", schema(value_type = String))]
        cron: ReminderCron,
        /// The timezone the cron expression is evaluated in.
        #[cfg_attr(feature = "inbound", schema(value_type = String))]
        timezone: Tz,
    },
}

impl ReminderSchedule {
    /// The first firing strictly after `now`, in UTC.
    ///
    /// `None` means the schedule will never fire again: a one-shot whose
    /// instant has passed, or a cron with no upcoming match.
    pub fn next_run_after(&self, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
        match self {
            Self::Once { remind_at } => (*remind_at > now).then_some(*remind_at),
            Self::Recurring { cron, timezone } => cron.next_run_after(now, *timezone),
        }
    }

    /// Whether this schedule fires more than once.
    pub fn repeats(&self) -> bool {
        matches!(self, Self::Recurring { .. })
    }
}

/// A reminder belonging to a user.
///
/// `user_id` is deliberately absent: a reminder is only ever read by its owner,
/// so the field would be redundant on the wire.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    /// Reminder id.
    pub id: Uuid,
    /// What to remind the user about.
    pub description: String,
    /// Type of the associated entity, when the reminder is attached to one.
    // Inlined so the shared `EntityType` component name is not claimed in
    // specs that also expose another `EntityType` enum.
    #[cfg_attr(feature = "inbound", schema(inline))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<EntityType>,
    /// Id of the associated entity, when the reminder is attached to one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<String>,
    /// When and how often the reminder fires.
    pub schedule: ReminderSchedule,
    /// The next firing, derived from `schedule` on write.
    pub next_run_at: DateTime<Utc>,
    /// When false, the dispatcher skips this reminder.
    pub enabled: bool,
    /// Set once a one-shot reminder has fired.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,
    /// When the reminder was created.
    pub created_at: DateTime<Utc>,
    /// When the reminder was last modified.
    pub updated_at: DateTime<Utc>,
}

impl Reminder {
    /// The associated entity, when the reminder is attached to one.
    pub fn entity(&self) -> Option<Entity<'_>> {
        match (self.entity_type, self.entity_id.as_deref()) {
            (Some(entity_type), Some(entity_id)) => Some(entity_type.with_entity_str(entity_id)),
            _ => None,
        }
    }
}

/// The caller's reminders, soonest firing first.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct RemindersList {
    /// The reminders.
    pub reminders: Vec<Reminder>,
    /// Pass back as `cursor` to fetch the next page. Absent on the last page —
    /// its absence is the only end-of-list signal, since a page can be short.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// A cursor into the list ordering, `(next_run_at, created_at, id)`.
///
/// Encoded as microsecond timestamps and a uuid joined by `.`, all of which are
/// unreserved in a URI, so the value survives a query string untouched. RFC 3339
/// would carry a `+` that decodes to a space, and `|` is not unreserved.
///
/// Positions compare at microsecond precision, matching Postgres `timestamptz`.
/// Reminders always originate from the repository, so their timestamps are
/// already microsecond-precise; [`ReminderCursor::after`] truncates anything
/// finer rather than silently rounding past a row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReminderCursor {
    /// `next_run_at` of the last reminder on the previous page.
    pub next_run_at: DateTime<Utc>,
    /// `created_at` of the last reminder on the previous page.
    pub created_at: DateTime<Utc>,
    /// `id` of the last reminder on the previous page.
    pub id: Uuid,
}

/// A cursor string that could not be decoded.
#[derive(Debug, thiserror::Error)]
#[error("invalid cursor")]
pub struct InvalidCursor;

impl ReminderCursor {
    /// The cursor pointing just past `reminder`.
    ///
    /// Timestamps are truncated to microseconds so the cursor encodes without
    /// loss. A sub-microsecond timestamp (only reachable from a synthetic
    /// reminder, never from the repository) truncates downward, which can
    /// re-return that row rather than skip it.
    pub fn after(reminder: &Reminder) -> Self {
        Self {
            next_run_at: truncate_to_micros(reminder.next_run_at),
            created_at: truncate_to_micros(reminder.created_at),
            id: reminder.id,
        }
    }

    /// Encode for transport.
    pub fn encode(&self) -> String {
        format!(
            "{}.{}.{}",
            self.next_run_at.timestamp_micros(),
            self.created_at.timestamp_micros(),
            self.id
        )
    }

    /// Decode a cursor produced by [`ReminderCursor::encode`].
    pub fn decode(raw: &str) -> Result<Self, InvalidCursor> {
        let mut parts = raw.split('.');
        let next_run_at = parts.next().ok_or(InvalidCursor)?;
        let created_at = parts.next().ok_or(InvalidCursor)?;
        let id = parts.next().ok_or(InvalidCursor)?;
        if parts.next().is_some() {
            return Err(InvalidCursor);
        }

        let micros_to_utc = |raw: &str| {
            raw.parse::<i64>()
                .ok()
                .and_then(DateTime::from_timestamp_micros)
                .ok_or(InvalidCursor)
        };

        Ok(Self {
            next_run_at: micros_to_utc(next_run_at)?,
            created_at: micros_to_utc(created_at)?,
            id: id.parse().map_err(|_| InvalidCursor)?,
        })
    }
}

/// One batch of rows read from storage.
///
/// Rows that could not be decoded are reported rather than dropped silently:
/// the caller needs `last_examined` to advance the cursor past them, otherwise
/// a page made entirely of unreadable rows would end pagination early and hide
/// every readable row behind it.
#[derive(Debug, Clone, Default)]
pub struct ReminderBatch {
    /// The rows that decoded successfully, in `(next_run_at, created_at, id)` order.
    pub reminders: Vec<Reminder>,
    /// How many rows in this batch could not be decoded.
    pub skipped: usize,
    /// Position of the last row examined, decoded or not. `None` for an empty
    /// batch.
    pub last_examined: Option<ReminderCursor>,
}

impl ReminderBatch {
    /// Total rows read, including the ones that could not be decoded.
    pub fn examined(&self) -> usize {
        self.reminders.len() + self.skipped
    }
}

/// One page of reminders.
#[derive(Debug, Clone)]
pub struct ReminderPage {
    /// The reminders on this page, soonest firing first.
    pub reminders: Vec<Reminder>,
    /// Where the next page starts, when there is one.
    pub next_cursor: Option<ReminderCursor>,
}

/// A request to create a reminder, before validation.
#[derive(Debug, Clone)]
pub struct CreateReminder {
    /// What to remind the user about.
    pub description: String,
    /// When and how often the reminder fires.
    ///
    /// The entity to attach to is not named here: it comes from the
    /// [`EntityAccessReceipt`](entity_access::domain::models::EntityAccessReceipt)
    /// passed alongside, so a caller cannot reference an entity without first
    /// proving access to it.
    pub schedule: ReminderSchedule,
}

/// A request to modify a reminder. `None` leaves a field unchanged; the entity
/// association is not modifiable, since changing it would need a fresh access
/// receipt for the new entity.
#[derive(Debug, Clone, Default)]
pub struct ReminderPatch {
    /// Replacement description.
    pub description: Option<String>,
    /// Replacement schedule.
    pub schedule: Option<ReminderSchedule>,
    /// Whether the dispatcher should consider this reminder.
    pub enabled: Option<bool>,
}

impl ReminderPatch {
    /// Whether the patch would change anything.
    pub fn is_empty(&self) -> bool {
        self.description.is_none() && self.schedule.is_none() && self.enabled.is_none()
    }
}

/// Which of a user's reminders to list, and where in the ordering to resume.
#[derive(Debug, Clone, Default)]
pub struct ReminderFilter {
    /// Restrict to reminders attached to this entity.
    pub entity: Option<Entity<'static>>,
    /// Include reminders that have already fired.
    pub include_completed: bool,
    /// Resume after this position in the ordering.
    pub cursor: Option<ReminderCursor>,
    /// Page size requested by the caller. `None` uses [`DEFAULT_PAGE_SIZE`];
    /// anything above [`MAX_PAGE_SIZE`] is clamped down to it.
    pub limit: Option<u32>,
}

impl ReminderFilter {
    /// The effective page size, clamped into range.
    pub fn page_size(&self) -> u32 {
        self.limit
            .unwrap_or(DEFAULT_PAGE_SIZE)
            .clamp(1, MAX_PAGE_SIZE)
    }
}

/// A validated reminder ready to be persisted, with `next_run_at` derived.
#[derive(Debug, Clone)]
pub struct NewReminder {
    /// What to remind the user about.
    pub description: String,
    /// The entity the reminder is attached to, if any.
    pub entity: Option<Entity<'static>>,
    /// When and how often the reminder fires.
    pub schedule: ReminderSchedule,
    /// The first firing, derived from `schedule`.
    pub next_run_at: DateTime<Utc>,
}

/// A new schedule together with the `next_run_at` derived from it.
#[derive(Debug, Clone)]
pub struct ScheduleUpdate {
    /// The replacement schedule.
    pub schedule: ReminderSchedule,
    /// The next firing, derived from `schedule`.
    pub next_run_at: DateTime<Utc>,
}

/// A validated partial update.
#[derive(Debug, Clone, Default)]
pub struct ReminderUpdate {
    /// Replacement description.
    pub description: Option<String>,
    /// Replacement schedule and its derived next firing.
    pub schedule: Option<ScheduleUpdate>,
    /// Replacement enabled flag.
    pub enabled: Option<bool>,
}

/// A reminder that is due to fire, with everything the dispatcher needs to
/// notify its owner.
///
/// Carries `owner_id` because dispatch is the one path that crosses users:
/// [`RemindersRepo`](crate::domain::ports::RemindersRepo) is scoped to a single
/// caller, while the dispatcher sweeps every user's reminders at once.
#[derive(Debug, Clone)]
pub struct DueReminder {
    /// The reminder itself.
    pub reminder: Reminder,
    /// The user the reminder belongs to, and the only recipient of its
    /// notification.
    pub owner_id: MacroUserIdStr<'static>,
    /// The firing being delivered. Also the occurrence's `scheduled_for`, which
    /// is what makes a firing claimable exactly once.
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
    /// The reminder recurs. Recurring dispatch is not implemented, and firing
    /// one here would deliver it once and complete it forever.
    SkippedRecurring,
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

impl From<InvalidCron> for ReminderError {
    fn from(err: InvalidCron) -> Self {
        ReminderError::BadRequest(err.to_string())
    }
}

impl From<InvalidCursor> for ReminderError {
    fn from(err: InvalidCursor) -> Self {
        ReminderError::BadRequest(err.to_string())
    }
}
