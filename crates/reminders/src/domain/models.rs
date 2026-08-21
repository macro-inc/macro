//! Domain models for reminders.

#[cfg(test)]
mod test;

use std::str::FromStr;

use chrono::{DateTime, Timelike, Utc};
use chrono_tz::Tz;
use cron::Schedule as CronSchedule;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use serde::{Deserialize, Deserializer, Serialize};
use uuid::Uuid;

/// Upper bound on a reminder's description in characters, so list payloads
/// stay sane. Mirrored by the `reminder_description_max_length` DB constraint.
pub const MAX_DESCRIPTION_LEN: usize = 2_000;

/// The outside limit on how late a recurring firing may be delivered.
///
/// A backstop for the long-period schedules, where the primary rule — a firing
/// is stale once the next one has come due — would otherwise permit delivering
/// a monthly reminder three weeks after the fact. Deliberately generous: an
/// hour of queue backlog or a short outage must not cost anyone their daily
/// reminder, so the threshold sits far above any delay healthy dispatch
/// produces rather than close to it.
///
/// Also what marks a reminder revived from months out of service as needing a
/// recomputed firing rather than the one it went quiet on.
pub const MAX_RECURRING_LATENESS: chrono::Duration = chrono::Duration::hours(24);

/// The closest together two firings of a recurring reminder may be.
///
/// The sweep ticks once a minute, so a schedule finer than that cannot be
/// honoured; this sits well above the tick because a reminder arriving every
/// few minutes is a notification storm rather than a reminder. The composer
/// only builds daily, weekly and monthly schedules, so this guards the API
/// rather than anything a user can click.
pub const MIN_RECURRING_INTERVAL: chrono::Duration = chrono::Duration::minutes(5);

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

/// Drop everything finer than a minute.
fn floor_to_minute(at: DateTime<Utc>) -> DateTime<Utc> {
    at.with_second(0)
        .and_then(|at| at.with_nanosecond(0))
        .unwrap_or(at)
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

    /// Drop sub-minute precision from a one-shot firing.
    ///
    /// "Remind me in ten minutes" at 16:06:32 means 16:16, not 16:16:32. The
    /// seconds are an artifact of when the request happened to be sent, they
    /// are not something the owner chose, and a reminder that fires at a ragged
    /// time reads as a bug.
    ///
    /// Recurring schedules are left alone: their seconds come from a cron the
    /// owner wrote, so `30 0 9 * * *` means 09:00:30 and flooring it would
    /// quietly ignore what they asked for.
    pub fn floored_to_minute(self) -> Self {
        match self {
            Self::Once { remind_at } => Self::Once {
                remind_at: floor_to_minute(remind_at),
            },
            recurring @ Self::Recurring { .. } => recurring,
        }
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
    /// Set once the owner marks the reminder as dealt with. Firing does not
    /// set it — a delivered reminder is waiting on its owner, not finished.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,
    /// When the reminder was created.
    pub created_at: DateTime<Utc>,
    /// When the reminder was last modified.
    pub updated_at: DateTime<Utc>,
}

/// The `"{type}:{id}"` token identifying a reminder's referenced entity.
///
/// Soup filters on these rather than on a pair of columns, so the format is
/// defined here and mirrored by `entity_type || ':' || entity_id` in the
/// repository's Soup query.
pub fn entity_token(entity: &Entity<'_>) -> String {
    format!("{}:{}", entity.entity_type.as_ref(), entity.entity_id)
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

/// Display details of the entity a reminder is about, resolved alongside the
/// reminder itself.
///
/// A reminder has no block of its own — it opens, and is iconed as, whatever it
/// references. Which block that is depends on the referenced document's file
/// type, so resolving it client-side would mean a second fetch per row against
/// a synchronous icon path. Reading it here keeps Soup to one round trip.
///
/// Only documents populate these; every other entity type is identified by its
/// [`EntityType`] alone.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ReminderReference {
    /// The referenced document's file type, e.g. `md` or `pdf`.
    pub file_type: Option<String>,
    /// The referenced document's sub type, e.g. `task` or `snippet`.
    pub sub_type: Option<String>,
}

/// A reminder together with what it references, as Soup needs it.
#[derive(Debug, Clone)]
pub struct ReminderForSoup {
    /// The reminder itself.
    pub reminder: Reminder,
    /// Details of [`Reminder::entity`], when it resolves to something readable.
    /// `None` for a standalone reminder, a non-document entity, or a reference
    /// that no longer exists.
    pub reference: Option<ReminderReference>,
}

/// Which end of the `next_run_at` ordering the Soup feed wants.
///
/// This picks the rows, not just their display order: the read is bounded by a
/// limit with no cursor, so asking for the wrong end silently returns a
/// different set of reminders.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SoupOrder {
    /// Soonest `next_run_at` first — overdue and imminent reminders.
    SoonestFirst,
    /// Latest `next_run_at` first, matching Soup's usual newest-first feeds.
    #[default]
    LatestFirst,
}

/// One Soup read of a user's reminders.
///
/// Bundled rather than passed positionally: the filters are four `Option`s and
/// slices in a row, where a transposed pair type-checks and silently returns
/// the wrong rows.
#[derive(Debug, Clone, Copy)]
pub struct SoupReminderQuery<'a> {
    /// Restrict to these reminder ids. Empty means no constraint.
    pub ids: &'a [Uuid],
    /// Restrict to reminders attached to these entities, each `"{type}:{id}"`.
    /// Empty means no constraint.
    pub entities: &'a [String],
    /// Filter on whether the owner marked it done. `None` returns both.
    pub completed: Option<bool>,
    /// Filter on whether it has come due. `None` returns both.
    pub fired: Option<bool>,
    /// Which end of the `next_run_at` ordering `limit` rows come from.
    pub order: SoupOrder,
    /// Upper bound on rows returned.
    pub limit: i64,
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
    /// Mark the reminder as dealt with (`true`) or live again (`false`).
    ///
    /// Separate from `enabled`: a disabled reminder is one the dispatcher
    /// skips, while a completed one has been handled. Only the owner sets it —
    /// firing does not, or a reminder would arrive already dealt with.
    pub completed: Option<bool>,
}

impl ReminderPatch {
    /// Whether the patch would change anything.
    pub fn is_empty(&self) -> bool {
        self.description.is_none()
            && self.schedule.is_none()
            && self.enabled.is_none()
            && self.completed.is_none()
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
    /// Replacement completed flag. See [`ReminderPatch::completed`].
    pub completed: Option<bool>,
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

/// Where a series goes once the firing in hand is finished.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Advance {
    /// The firing to move to.
    pub next_run_at: DateTime<Utc>,
    /// Whether to clear the owner's "done" acknowledgement.
    ///
    /// True when this delivery notified them: marking a recurring reminder done
    /// settles the firing in front of you, not the standing arrangement, so a
    /// fresh notification makes that acknowledgement stale and the reminder
    /// outstanding again.
    ///
    /// False when the firing was rolled forward without notifying. Nothing
    /// reached the owner, so nothing has superseded what they already dealt
    /// with, and clearing it would return the reminder to their attention with
    /// no notification to explain why.
    pub clear_completion: bool,
}

/// What finishing a firing did to the reminder behind it.
///
/// Reported rather than assumed because the advance is allowed to not happen,
/// and "the owner rescheduled" and "the advance silently failed" leave exactly
/// the same row behind. Without this the caller cannot tell them apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Completion {
    /// Nothing to advance: a one-shot, or a series with no firing left.
    NoAdvance,
    /// The series moved on to the firing it was given.
    Advanced,
    /// An advance was asked for and declined, because the reminder no longer
    /// sits on the firing that was delivered.
    ///
    /// Named for what is known rather than for the likely cause. A reschedule
    /// mid-flight is the ordinary one and outranks the series, but the row may
    /// equally have been deleted, completed, or disabled between the read that
    /// resolved this firing and the write that finished it. All this reports is
    /// that the guard held. Expected, not an error.
    NotAdvanced,
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
    /// A recurring firing too far behind to be worth sending, moved on to its
    /// next occurrence without notifying. Covers a dispatcher outage, and the
    /// series whose `next_run_at` was frozen before recurring dispatch existed
    /// — delivering either would announce a reminder about a moment long past.
    RolledForward,
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
