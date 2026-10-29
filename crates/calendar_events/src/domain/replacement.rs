//! A replacement is a new invitation followed by conditional cancellation of the old one.
//! The journal consumes creation once; ambiguous responses are reconciled by reading.
use super::{models::*, ports::*};
use rootcause::Report;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// Frozen provider facts. Opaque payloads are interpreted only by the provider adapter.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReplacementSnapshot {
    /// Exact provider event or occurrence to cancel.
    pub source_id: String,
    /// Whether the connected mailbox organizes the event.
    pub is_organizer: bool,
    /// Title shown at confirmation.
    pub title: String,
    /// Time shown at confirmation.
    pub time: EventTime,
    /// Number of guests receiving a fresh invitation.
    pub attendee_count: usize,
    /// Whether this replaces an entire recurring series.
    pub is_series: bool,
    /// Whether the replacement omits the provider conference.
    pub remove_conference: bool,
    /// Safe provider link for review or manual recovery.
    pub provider_url: Option<String>,
    /// Frozen event, versions, and provider creation fields.
    pub payload: Value,
    /// All exceptions and cancellations, including those outside the sync horizon.
    pub occurrences: Vec<Value>,
}
impl ReplacementSnapshot {
    /// Create, copy every exception/cancellation, then cancel the original.
    pub fn write_count(&self) -> i32 {
        self.occurrences.len() as i32 + 2
    }
}

/// Durable operation. Calendar deletion cascades its journal; deleting the old event does not.
#[derive(Clone, Debug)]
pub struct CalendarReplacement {
    /// Stable confirmation and recovery identity.
    pub id: Uuid,
    /// Actor who prepared and confirmed this operation.
    pub user_id: String,
    /// Authorized calendar, retained after the old event is retired.
    pub calendar_id: Uuid,
    /// Original Macro event, retained as an identifier rather than a foreign key.
    pub event_id: Uuid,
    /// Provider master; serializes overlapping series and occurrence replacements.
    pub master_id: String,
    /// Original-start key when replacing a single occurrence.
    pub recurrence_id: Option<String>,
    /// Immutable details the actor approved.
    pub snapshot: ReplacementSnapshot,
    /// Next provider write; all earlier writes have been confirmed.
    pub next_step: i32,
    /// A write is persisted before execution. A create with this set may only be read back.
    pub command: Option<Value>,
    /// New provider identity once creation is confirmed.
    pub replacement_provider_id: Option<String>,
    /// Canonical completion result, retained for retries after old-event retirement.
    pub result: Option<CalendarEvent>,
}

/// Provider facts after executing or checking one persisted command.
pub enum ReplacementWriteOutcome {
    /// Provider explicitly rejected creation before applying it; a later retry is safe.
    Rejected(CalendarProviderError),
    /// The write is confirmed; creation also returns its new provider identity.
    Applied(Option<String>),
    /// Creation may still be in flight or invisible to reads. Do not send again.
    Unconfirmed,
}

/// User-visible workflow state.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ReplacementStatus {
    /// No provider changes have been initiated.
    NeedsConfirmation,
    /// Confirmation was recorded; resume checks the existing operation.
    InProgress,
    /// New event persisted and original cancellation confirmed.
    Complete,
}

/// Safe preview and recovery response; never exposes the opaque provider snapshot.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CalendarReplacementView {
    /// Use this identity when confirming or checking progress.
    pub operation_id: Uuid,
    /// Current durable state.
    pub status: ReplacementStatus,
    /// Frozen title.
    pub title: String,
    /// Frozen time.
    pub time: EventTime,
    /// Guest count for cancellation and reinvitation confirmation.
    pub attendee_count: usize,
    /// Entire recurring series, including exceptions, is replaced.
    pub is_series: bool,
    /// The provider conference is removed.
    pub remove_conference: bool,
    /// Original event for manual review.
    pub provider_url: Option<String>,
    /// New provider event, when creation was confirmed.
    pub replacement_url: Option<String>,
    /// Number of completed provider steps.
    pub completed_steps: i32,
    /// Number of provider steps in this operation.
    pub total_steps: i32,
    /// Returned after the complete operation has been persisted.
    pub event: Option<CalendarEvent>,
}
impl CalendarReplacement {
    /// Project safe workflow details for the actor.
    pub fn view(&self, replacement_url: Option<String>) -> CalendarReplacementView {
        CalendarReplacementView {
            operation_id: self.id,
            status: if self.result.is_some() {
                ReplacementStatus::Complete
            } else if self.next_step > 0 || self.command.is_some() {
                ReplacementStatus::InProgress
            } else {
                ReplacementStatus::NeedsConfirmation
            },
            title: self.snapshot.title.clone(),
            time: self.snapshot.time.clone(),
            attendee_count: self.snapshot.attendee_count,
            is_series: self.snapshot.is_series,
            remove_conference: self.snapshot.remove_conference,
            provider_url: self.snapshot.provider_url.clone(),
            replacement_url,
            completed_steps: self.next_step,
            total_steps: self.snapshot.write_count(),
            event: self.result.clone(),
        }
    }
}

/// Journal compare-and-set operations. None means another request advanced the operation.
pub trait CalendarReplacementRepository: Send + Sync + 'static {
    /// Schedule a bounded batch of confirmed operations for background read-back and progress.
    fn claim_pending_replacements(
        &self,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<(String, Uuid)>, Report>> + Send;
    /// Return the active operation for this series, restricted to this actor.
    fn active_replacement(
        &self,
        user_id: &str,
        calendar_id: Uuid,
        master_id: &str,
    ) -> impl Future<Output = Result<Option<CalendarReplacement>, Report>> + Send;
    /// Insert a preview, or return the actor's already-active operation. Other actors conflict.
    fn prepare_replacement(
        &self,
        operation: CalendarReplacement,
    ) -> impl Future<Output = Result<CalendarReplacement, Report>> + Send;
    /// Load only an operation belonging to this actor.
    fn replacement(
        &self,
        user_id: &str,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<CalendarReplacement>, Report>> + Send;
    /// Atomically freeze the command. Exactly one caller is authorized to initiate a create.
    fn start_replacement_step(
        &self,
        id: Uuid,
        step: i32,
        command: &Value,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
    /// Release a create command only after a definite rejection (never after a timeout).
    fn reject_replacement_create(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Advance only this step; repeats and concurrent read-back completion are harmless.
    fn finish_replacement_step(
        &self,
        id: Uuid,
        step: i32,
        created_id: Option<&str>,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
    /// Persist the final canonical result after provider and projection work completes.
    fn complete_replacement(
        &self,
        id: Uuid,
        event: &CalendarEvent,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Discard an unconfirmed preview; a started operation can never be forgotten this way.
    fn discard_replacement(
        &self,
        user_id: &str,
        id: Uuid,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
}

/// Provider I/O needed by the replacement use case. No actor authorization lives here.
pub trait CalendarReplacementProvider: Send + Sync + 'static {
    /// Read fresh, complete provider details without writing.
    fn inspect_replacement(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        master: &str,
        recurrence_id: Option<&str>,
        remove_conference: bool,
    ) -> impl Future<Output = Result<ReplacementSnapshot, CalendarProviderError>> + Send;
    /// Resolve a provider-owned HTTPS event link without constructing one on the frontend.
    fn event_url(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        id: &str,
        recurrence_id: Option<&str>,
    ) -> impl Future<Output = Result<Option<String>, CalendarProviderError>> + Send;
    /// Prepare one conditional write from frozen facts and current provider identities.
    fn prepare_replacement_write(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        operation: &CalendarReplacement,
    ) -> impl Future<Output = Result<Value, CalendarProviderError>> + Send;
    /// Apply or read back a persisted command. Creation is allowed only for the CAS winner.
    fn apply_replacement_write(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        command: &Value,
        allow_create: bool,
    ) -> impl Future<Output = Result<ReplacementWriteOutcome, CalendarProviderError>> + Send;
    /// Read the normalized echo for projection or return None for a confirmed deletion.
    fn replacement_echo(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        id: &str,
    ) -> impl Future<Output = Result<Option<CalendarEventUpsert>, CalendarProviderError>> + Send;
}

/// Authenticated application use cases for explicit provider differences.
pub trait CalendarReplacementService: Send + Sync + 'static {
    /// Recover confirmed operations after client disconnects and service restarts.
    fn recover_replacements(&self) -> impl Future<Output = Result<usize, Report>> + Send;
    /// Prepare an organizer-only replacement; never modifies the provider.
    fn prepare_replacement(
        &self,
        user_id: &str,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        recurrence_id: Option<String>,
        remove_conference: bool,
    ) -> impl Future<Output = Result<CalendarReplacementView, CalendarMutationError>> + Send;
    /// Confirm the saved preview, or safely resume the same confirmed operation.
    fn confirm_replacement(
        &self,
        user_id: &str,
        id: Uuid,
    ) -> impl Future<Output = Result<CalendarReplacementView, CalendarMutationError>> + Send;
    /// Read progress without initiating provider writes.
    fn replacement_status(
        &self,
        user_id: &str,
        id: Uuid,
    ) -> impl Future<Output = Result<CalendarReplacementView, CalendarMutationError>> + Send;
    /// Abandon a preview only before confirmation.
    fn discard_replacement(
        &self,
        user_id: &str,
        id: Uuid,
    ) -> impl Future<Output = Result<(), CalendarMutationError>> + Send;
    /// Resolve a safe provider link after checking event visibility.
    fn event_provider_url(
        &self,
        user_id: &str,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        recurrence_id: Option<String>,
    ) -> impl Future<Output = Result<Option<String>, CalendarMutationError>> + Send;
}
