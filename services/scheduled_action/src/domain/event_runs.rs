//! Durable event-run contracts. Database transactions, Kafka acknowledgments and
//! agent transport are adapter concerns; admission and authorization policy are
//! domain concerns.

use chrono::{DateTime, Utc};
use entity_access::domain::models::{
    EntityAccessReceipt, EntityType, RequiredPermission, ViewAccessLevel, ViewOnly,
};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::{Uuid, generate_uuid_v7};
use model_owner::Owner;
use rootcause::Report;
use serde::{Deserialize, Serialize};

use super::event_trigger::{
    EventEntityType, EventFilters, EventId, EventReference, EventRejection, IncomingEvent,
};
use super::models::{ActionExecutionRecord, ScheduledAction};

pub mod admission;
pub mod dispatch;

#[cfg(test)]
mod test_support;

/// Independent of `updated_at`, which execution bookkeeping also changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "i64", into = "i64")]
pub struct ConfigurationRevision(i64);

impl ConfigurationRevision {
    pub const INITIAL: Self = Self(1);

    pub fn next(self) -> Result<Self, RunContractError> {
        self.0
            .checked_add(1)
            .map(Self)
            .ok_or(RunContractError::RevisionOverflow)
    }

    pub fn get(self) -> i64 {
        self.0
    }
}

impl TryFrom<i64> for ConfigurationRevision {
    type Error = RunContractError;

    fn try_from(value: i64) -> Result<Self, Self::Error> {
        if value < 1 {
            return Err(RunContractError::InvalidRevision);
        }
        Ok(Self(value))
    }
}

impl From<ConfigurationRevision> for i64 {
    fn from(revision: ConfigurationRevision) -> Self {
        revision.0
    }
}

/// A fresh token for each execution, including cron/manual claims. Release and
/// finalization must compare it, so an expired worker cannot release a new run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "Uuid", into = "Uuid")]
pub struct ClaimToken(Uuid);

impl ClaimToken {
    pub fn generate() -> Self {
        Self(generate_uuid_v7())
    }
    pub fn as_uuid(self) -> Uuid {
        self.0
    }
}

impl TryFrom<Uuid> for ClaimToken {
    type Error = RunContractError;

    fn try_from(value: Uuid) -> Result<Self, Self::Error> {
        EventId::try_from(value).map_err(|_| RunContractError::InvalidClaimToken)?;
        Ok(Self(value))
    }
}

impl From<ClaimToken> for Uuid {
    fn from(token: ClaimToken) -> Self {
        token.0
    }
}

/// Every repository scan and maintenance pass is explicitly bounded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PageSize(u16);

impl PageSize {
    pub const MAX: u16 = 100;
    pub fn get(self) -> u16 {
        self.0
    }
}

impl TryFrom<u16> for PageSize {
    type Error = RunContractError;

    fn try_from(value: u16) -> Result<Self, Self::Error> {
        if value == 0 || value > Self::MAX {
            return Err(RunContractError::InvalidPageSize);
        }
        Ok(Self(value))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum RunContractError {
    #[error("configuration revisions must be positive")]
    InvalidRevision,
    #[error("configuration revision overflow")]
    RevisionOverflow,
    #[error("claim tokens must be UUIDv7")]
    InvalidClaimToken,
    #[error("page sizes must be between 1 and 100")]
    InvalidPageSize,
}

/// Natural deduplication key. A matching event has at most one run per action,
/// even if several filters matched or the source is redelivered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventRunKey {
    pub action_id: Uuid,
    pub event_id: EventId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CancellationReason {
    AccessDenied,
    Disabled,
    Superseded,
    NotUserOwned,
}

/// All outcomes are terminal. In particular, failure and interruption never
/// return a started run to pending, even if no agent side effect is known.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EventRunOutcome {
    Succeeded,
    Failed,
    Cancelled { reason: CancellationReason },
    Interrupted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum EventRunState {
    Pending,
    Started {
        token: ClaimToken,
        started_at: DateTime<Utc>,
        deadline: DateTime<Utc>,
    },
    Finished {
        outcome: EventRunOutcome,
        finished_at: DateTime<Utc>,
        execution_record_id: Option<Uuid>,
    },
}

/// Current configuration, reloaded before dispatch. A selector is not an access
/// grant; the action's owner (not the event actor) must be authorized.
#[derive(Debug, Clone)]
pub struct EventActionConfiguration {
    pub action_id: Uuid,
    pub owner: Owner,
    pub enabled: bool,
    pub revision: ConfigurationRevision,
    pub filters: EventFilters,
    pub activated_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct PendingEventRun {
    pub action_id: Uuid,
    pub revision: ConfigurationRevision,
    pub event: EventReference,
    pub admitted_at: DateTime<Utc>,
}

impl PendingEventRun {
    pub fn key(&self) -> EventRunKey {
        EventRunKey {
            action_id: self.action_id,
            event_id: self.event.event_id(),
        }
    }
}

/// Entity-specific view capability. Channel permission semantics are distinct
/// from item access levels and must not be converted into document permissions.
#[derive(Debug, Clone)]
pub enum EventAccessCapability {
    Document(EntityAccessReceipt<ViewAccessLevel>),
    Channel(EntityAccessReceipt<ViewOnly>),
}

impl EventAccessCapability {
    /// Require a directly authenticated owner, the exact entity, and its kind.
    /// In particular, a bot acting on behalf of the owner is not the owner.
    pub fn authorizes(&self, owner: &MacroUserIdStr<'static>, event: &EventReference) -> bool {
        match (self, event.entity_type()) {
            (Self::Document(receipt), EventEntityType::Document) => {
                receipt_matches(receipt, owner, event, EntityType::Document)
            }
            (Self::Channel(receipt), EventEntityType::Channel) => {
                receipt_matches(receipt, owner, event, EntityType::Channel)
            }
            _ => false,
        }
    }
}

fn receipt_matches<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
    owner: &MacroUserIdStr<'static>,
    event: &EventReference,
    kind: EntityType,
) -> bool {
    receipt
        .get_authenticated_user()
        .is_ok_and(|user| user == owner)
        && receipt.entity().entity_type == kind
        && Uuid::parse_str(&receipt.entity().entity_id).ok() == Some(event.entity_id())
}

/// Receipt minted for the current action owner and triggering entity.
pub struct AuthorizedEventRun {
    pub pending: PendingEventRun,
    pub access: EventAccessCapability,
}

impl AuthorizedEventRun {
    /// Validate current configuration and receipt binding before the fenced
    /// started transition. A revision race is checked again by the repository.
    pub fn prepare(
        pending: PendingEventRun,
        configuration: &EventActionConfiguration,
        access: EventAccessCapability,
    ) -> Result<Self, CancellationReason> {
        configuration.check_pending(&pending)?;
        let Owner::User(owner) = &configuration.owner else {
            return Err(CancellationReason::NotUserOwned);
        };
        if !access.authorizes(owner, &pending.event) {
            return Err(CancellationReason::AccessDenied);
        }
        Ok(Self { pending, access })
    }
}

impl EventActionConfiguration {
    fn check_pending(&self, pending: &PendingEventRun) -> Result<(), CancellationReason> {
        if !self.enabled {
            return Err(CancellationReason::Disabled);
        }
        if self.action_id != pending.action_id
            || self.revision != pending.revision
            || !self.filters.matches(&pending.event, self.activated_at)
        {
            return Err(CancellationReason::Superseded);
        }
        if !matches!(self.owner, Owner::User(_)) {
            return Err(CancellationReason::NotUserOwned);
        }
        Ok(())
    }
}

/// Claim is the start linearization point. Configuration changes after this
/// transition do not retroactively undo a run. Execution must not claim again.
pub struct ClaimedEventRun {
    pub run: AuthorizedEventRun,
    pub action: ScheduledAction,
    pub token: ClaimToken,
    pub started_at: DateTime<Utc>,
    pub deadline: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdmissionResult {
    Admitted,
    AlreadyPresent,
    /// Deleted, disabled, changed trigger/revision or outside activation.
    Ineligible,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FinalizationResult {
    Finalized,
    AlreadyFinalized,
    /// No writes allowed with a stale/foreign token (including claim release).
    StaleClaim,
}

/// Runner result is data, not a transport error. Infrastructure failure after
/// start is a failed/interrupted attempt, not permission to execute again.
pub struct EventExecutionResult {
    pub outcome: EventRunOutcome,
    pub record: Option<ActionExecutionRecord>,
}

pub struct FinalizeEventRun {
    pub key: EventRunKey,
    pub token: ClaimToken,
    pub finished_at: DateTime<Utc>,
    pub execution: EventExecutionResult,
}

/// A bounded raw page, with invalid persisted configurations omitted.
pub struct CandidateActionPage {
    pub configurations: Vec<EventActionConfiguration>,
    /// Last raw action ID, including invalid rows. None only at end of scan.
    pub next_after: Option<Uuid>,
}

/// Durable queue port. Implementations own locking, deduplication and fencing,
/// but not user authorization or event attribution policy.
pub trait EventRunRepository: Send + Sync + 'static {
    /// Keyset page ordered by action ID. May return indexed coarse candidates;
    /// the domain must recheck exact filters and the activation boundary.
    /// Advance by the raw-page cursor even when every configuration is invalid.
    fn candidate_actions(
        &self,
        event: &EventReference,
        after: Option<Uuid>,
        limit: PageSize,
    ) -> impl Future<Output = Result<CandidateActionPage, Report>> + Send;

    /// None also covers actions that are no longer event-triggered.
    fn current_configuration(
        &self,
        action_id: Uuid,
    ) -> impl Future<Output = Result<Option<EventActionConfiguration>, Report>> + Send;

    /// Atomically recheck enabled/event trigger/revision/activation and insert
    /// ON CONFLICT DO NOTHING. Redelivery after partial fan-out is safe.
    fn admit(
        &self,
        action_id: Uuid,
        revision: ConfigurationRevision,
        event: &EventReference,
    ) -> impl Future<Output = Result<AdmissionResult, Report>> + Send;

    /// Oldest pending run per available action, in durable admission order.
    /// Busy actions must not starve independent actions out of this page.
    fn pending_runs(
        &self,
        limit: PageSize,
    ) -> impl Future<Output = Result<Vec<PendingEventRun>, Report>> + Send;

    /// Atomically claim action + oldest pending run and transition to started.
    /// Recheck revision, enabled/event trigger and no other active execution
    /// (including cron/manual). None means the claim race was lost/ineligible.
    fn claim(
        &self,
        run: AuthorizedEventRun,
        token: ClaimToken,
        started_at: DateTime<Utc>,
        deadline: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<ClaimedEventRun>, Report>> + Send;

    /// Idempotent bookkeeping only: history, terminal outcome and fenced action
    /// release must commit together. Retain the deduplication row until deletion.
    fn finalize(
        &self,
        run: FinalizeEventRun,
    ) -> impl Future<Output = Result<FinalizationResult, Report>> + Send;

    /// Compare pending state and revision; never cancel a newer/started run.
    fn cancel_pending(
        &self,
        key: EventRunKey,
        revision: ConfigurationRevision,
        reason: CancellationReason,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Bounded cleanup of disabled/superseded pending rows, and expired started
    /// rows. Expired started rows become interrupted, never pending. Release
    /// only their own claim tokens. Return the number of affected rows.
    fn reconcile(
        &self,
        now: DateTime<Utc>,
        limit: PageSize,
    ) -> impl Future<Output = Result<u16, Report>> + Send;
}

/// None is a definitive denial/missing entity. Infrastructure unavailability is
/// Err, never None. Implement with the owning entity-access receipt service.
pub trait CurrentOwnerAccess: Send + Sync + 'static {
    fn authorize(
        &self,
        owner: &MacroUserIdStr<'static>,
        event: &EventReference,
    ) -> impl Future<Output = Result<Option<EventAccessCapability>, Report>> + Send;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventIngestionResult {
    /// All eligible candidates were durably handled (including no matches).
    Admitted {
        inserted: u64,
    },
    Rejected(EventRejection),
}

/// Kafka calls only this port. Ok permits acknowledgment; Err is transient and
/// must not advance the source offset, including after partial fan-out.
pub trait EventIngestion: Send + Sync + 'static {
    fn ingest(
        &self,
        event: &IncomingEvent,
    ) -> impl Future<Output = Result<EventIngestionResult, Report>> + Send;
}

/// Await completion of an already-started run; do not spawn untracked work.
/// Enforce the claim deadline and propagate cancellation through agent/tools.
/// Shutdown/timeouts are terminal interruption/failure, never scheduled retries.
pub trait EventExecutor: Send + Sync + 'static {
    fn execute(
        &self,
        run: &ClaimedEventRun,
        cancellation: impl Future<Output = ()> + Send,
    ) -> impl Future<Output = EventExecutionResult> + Send;
}
