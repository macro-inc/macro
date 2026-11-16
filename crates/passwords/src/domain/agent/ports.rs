//! Capabilities the agent vault requires. Policy stays in the agent service.
use super::{AgentAccessRow, AgentAction, DirectoryAgent, StoredRequestStatus, WakeId};
use crate::domain::models::{Error, ItemId, Permission, Record, TeamId, TotpKeyId};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

// Ports are object-safe (`Arc<dyn Port>`) for composition, so they use async_trait.

/// Authoritative agent account facts, owned by the agent platform.
#[async_trait::async_trait]
pub trait AgentDirectory: Send + Sync {
    /// Resolve the agent behind an API-key user; `None` when it is not an agent
    /// the directory knows. Dependency failures are errors, never admission.
    async fn resolve(
        &self,
        api_key_user: &MacroUserIdStr<'_>,
    ) -> Result<Option<DirectoryAgent>, Error>;
}

/// Agent vault rollout and provider presence; every off, missing or failed
/// evaluation is reported as disabled.
#[async_trait::async_trait]
pub trait AgentAvailability: Send + Sync {
    /// The user's own snapshot enables both the Passwords and agent-vault keys.
    /// Evaluated for the agent on agent routes and for the reviewer on human
    /// review routes; never inherited from another account.
    async fn agent_vault_enabled(&self, user: &MacroUserIdStr<'_>) -> bool;
    /// Provider configuration is present. Never performs provider I/O.
    fn provider_configured(&self) -> bool;
}

/// One fixed agent audit entry; never values, names, URLs or query text.
#[derive(Clone, Debug)]
pub struct AgentAudit {
    /// Team of the item.
    pub team: TeamId,
    /// Audited item.
    pub item: ItemId,
    /// Principal acting: the agent, or the human reviewer.
    pub actor: MacroUserIdStr<'static>,
    /// Agent the entry is about.
    pub agent: MacroUserIdStr<'static>,
    /// Untrusted wake correlation of agent actions.
    pub wake: Option<WakeId>,
    /// Fixed action.
    pub action: AgentAction,
    /// Permission revision after the action, when it concerns access.
    pub permission_revision: Option<i64>,
    /// Idempotency key of the entry.
    pub event_id: Uuid,
}

/// The agent publishing a write intent or enrollment, retained for its audit.
#[derive(Clone, Debug)]
pub struct IntentAgent {
    /// Publishing agent.
    pub agent: MacroUserIdStr<'static>,
    /// Wake correlation of the original attempt.
    pub wake: WakeId,
    /// Audited action: create or update for intents, TOTP setup for enrollments.
    pub action: AgentAction,
}

/// Lifecycle state of an enrollment generation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EnrollmentState {
    /// Staged, not yet active.
    Pending,
    /// The item's active generation.
    Active,
    /// Replaced or removed.
    Retired,
}

/// Bounds the repository enforces inside one request transaction.
#[derive(Clone, Copy, Debug)]
pub struct RequestLimits {
    /// Wait after a denial before the same agent may re-request the item.
    pub denied_cooldown: chrono::Duration,
    /// New requests an agent may make per team within `window`.
    pub max_new_requests: i64,
    /// Rate window.
    pub window: chrono::Duration,
}

/// Outcome of one request attempt, decided atomically with its effects.
#[derive(Clone, Debug)]
pub enum RequestOutcome {
    /// A new pending request committed with its audit and notification event.
    Created(AgentAccessRow),
    /// The existing pending request; nothing new was recorded.
    Deduplicated(AgentAccessRow),
    /// Rejected until the given time.
    RetryAt(DateTime<Utc>),
}

/// A new request committed atomically with its audit and notification event.
#[derive(Clone, Debug)]
pub struct NewRequest {
    /// Team of the item.
    pub team: TeamId,
    /// Requested item.
    pub item: ItemId,
    /// Requesting agent.
    pub agent: MacroUserIdStr<'static>,
    /// Wake correlation.
    pub wake: WakeId,
    /// Requested permission.
    pub permission: Permission,
    /// Human creator to notify alongside current team administrators.
    pub human_creator: Option<MacroUserIdStr<'static>>,
    /// New request id.
    pub request_id: Uuid,
    /// Item display name, frozen into the reviewer notification.
    pub item_name: String,
    /// Enforced bounds.
    pub limits: RequestLimits,
}

/// A grant/approval transition committed atomically with the item's grants,
/// the request state, its audit entry and the agent's resolution event.
#[derive(Clone)]
pub struct AccessTransition {
    /// Item after the transition, carrying its new grants. Saved with the
    /// metadata revision CAS against `record.revision`.
    pub record: Record,
    /// Agent concerned.
    pub agent: MacroUserIdStr<'static>,
    /// Standing approval after the transition.
    pub approved: bool,
    /// Expected request revision (resolve) or permission revision (revoke).
    pub expected: Expected,
    /// New request status, when the transition resolves or revokes a request.
    pub request_status: Option<StoredRequestStatus>,
    /// Whether the grant or approval changes, advancing the permission revision.
    pub permission_changed: bool,
    /// Human reviewer.
    pub reviewer: MacroUserIdStr<'static>,
    /// Audited action.
    pub action: AgentAction,
}

/// Compare-and-set guard of a transition.
#[derive(Clone, Copy, Debug)]
pub enum Expected {
    /// The pending request id and its revision.
    Request {
        /// Request id under review.
        id: Uuid,
        /// Request revision observed by the reviewer.
        revision: i64,
    },
    /// The agent's permission revision on the item.
    PermissionRevision(i64),
}

/// A pending request listed for review.
#[derive(Clone)]
pub struct PendingRequest {
    /// Item record.
    pub record: Record,
    /// Requesting agent.
    pub agent: MacroUserIdStr<'static>,
    /// Stored access facts including the pending request.
    pub row: AgentAccessRow,
}

/// A committed request transition awaiting delivery.
#[derive(Clone, Debug)]
pub struct AccessEvent {
    /// Outbox id; also the delivery idempotency key.
    pub id: Uuid,
    /// Team of the item.
    pub team: TeamId,
    /// Item.
    pub item: ItemId,
    /// Current item display name, for reviewer notifications.
    pub item_name: String,
    /// Agent addressed by resolution events.
    pub agent: MacroUserIdStr<'static>,
    /// Request.
    pub request_id: Uuid,
    /// New status; `Pending` announces a request to its reviewers.
    pub status: StoredRequestStatus,
    /// Humans to notify of a pending request, resolved at commit.
    pub reviewers: Vec<MacroUserIdStr<'static>>,
}

/// Agent persistence beside the human repository. Values never cross it.
#[async_trait::async_trait]
pub trait AgentRepository: Send + Sync {
    /// Publish an agent's metadata intent before a value write, retaining the
    /// agent identity whose audit completes with the intent. Serialized with team
    /// closure; rejects non-agent publishers and, for an existing item, an agent
    /// without a current usable Edit grant. A retry must match the stored
    /// publisher and action exactly; its original wake is kept.
    async fn stage(
        &self,
        operation: Uuid,
        record: &Record,
        publisher: &IntentAgent,
    ) -> Result<(), Error>;
    /// Persist a pending enrollment retaining the agent identity audited at activation.
    async fn stage_totp(
        &self,
        team: TeamId,
        item: ItemId,
        key: TotpKeyId,
        publisher: &IntentAgent,
    ) -> Result<(), Error>;
    /// The item and state of an enrollment generation in the team.
    async fn enrollment(
        &self,
        team: TeamId,
        key: TotpKeyId,
    ) -> Result<Option<(ItemId, EnrollmentState)>, Error>;
    /// Live items the agent may discover, newest first, after `after`.
    async fn catalog(
        &self,
        team: TeamId,
        agent: &MacroUserIdStr<'_>,
        query: &str,
        after: Option<ItemId>,
        limit: u8,
    ) -> Result<Vec<Record>, Error>;
    /// Stored access facts of the agent on the items.
    async fn access(
        &self,
        team: TeamId,
        items: &[ItemId],
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Vec<(ItemId, AgentAccessRow)>, Error>;
    /// Record audit entries.
    async fn audit(&self, entries: &[AgentAudit]) -> Result<(), Error>;
    /// Create, deduplicate or reject a request within one transaction.
    async fn request(&self, request: NewRequest) -> Result<RequestOutcome, Error>;
    /// Apply a grant/approval transition within one transaction.
    async fn transition(&self, transition: AccessTransition) -> Result<AgentAccessRow, Error>;
    /// Pending requests on the team, optionally only items created by `creator`,
    /// ordered by request id after `after`.
    async fn pending(
        &self,
        team: TeamId,
        creator: Option<&MacroUserIdStr<'_>>,
        after: Option<Uuid>,
        limit: u8,
    ) -> Result<Vec<PendingRequest>, Error>;
    /// The agent and access facts of one request on the item.
    async fn find_request(
        &self,
        team: TeamId,
        item: ItemId,
        request: Uuid,
    ) -> Result<Option<(MacroUserIdStr<'static>, AgentAccessRow)>, Error>;
    /// Every agent with an access row on the item, ordered by agent id after `after`.
    async fn item_access(
        &self,
        team: TeamId,
        item: ItemId,
        after: Option<&MacroUserIdStr<'_>>,
        limit: u8,
    ) -> Result<Vec<(MacroUserIdStr<'static>, AgentAccessRow)>, Error>;
    /// A bounded batch of due undelivered events, oldest due first.
    async fn undelivered(&self) -> Result<Vec<AccessEvent>, Error>;
    /// Mark an event delivered.
    async fn delivered(&self, id: Uuid) -> Result<(), Error>;
    /// Postpone a failed event with bounded exponential backoff.
    async fn defer(&self, id: Uuid) -> Result<(), Error>;
}

/// Delivers committed request events: resolution hints to the agent and
/// pending-request notifications to reviewers. Events grant nothing.
#[async_trait::async_trait]
pub trait AccessEventSink: Send + Sync {
    /// Deliver at least once; `event.id` deduplicates.
    async fn deliver(&self, event: &AccessEvent) -> Result<(), Error>;
}
