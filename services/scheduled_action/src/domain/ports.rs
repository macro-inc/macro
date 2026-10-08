use super::event_runs::{ClaimToken, ConfigurationRevision};
use super::event_trigger::EventReference;
use super::execution::ExecutionHandle;
use super::models::{
    ActionExecutionRecord, CreateScheduledAction, DispatchEvent, InProgressExecution,
    ScheduledAction, ScheduledActionUpdate, UpdateScheduledAction,
};
use anyhow::Result;
use chrono::{DateTime, Utc};
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use entity_registry::OwnedPurgeOutcome;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_owner::{CreationPrincipal, Owner};
use rootcause::Report;
use tokio::sync::mpsc::{Receiver, Sender};

/// Validate configuration syntax and authorize its target before persistence.
pub trait TaskTargetValidator: Send + Sync + 'static {
    fn validate_task(
        &self,
        task: &serde_json::Value,
        owner: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<()>> + Send;
}

pub trait ScheduledActionRepo: Send + Sync + 'static {
    fn create_action(
        &self,
        action: ScheduledAction,
    ) -> impl Future<Output = Result<ScheduledAction>> + Send;

    /// Account cleanup only: `WHERE owner = $1`. Never the HTTP list.
    fn get_owned_actions(
        &self,
        owner: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<ScheduledAction>>> + Send;

    /// Rows for ids the grants port already allowed. No owner predicate. Missing ids omitted.
    fn get_actions_by_ids(
        &self,
        ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<ScheduledAction>>> + Send;

    /// By primary key, no owner predicate.
    fn get_action(&self, id: &Uuid)
    -> impl Future<Output = Result<Option<ScheduledAction>>> + Send;

    /// Return the next `limit` enabled cron actions ordered by `next_run_at` ASC,
    /// filtering out those currently claimed by another worker (i.e. claimed
    /// within `MAX_ACTION_TIME`). Used by the polling dispatcher to find work.
    fn get_next_unclaimed_actions(
        &self,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<ScheduledAction>>> + Send;

    /// Replace configuration when `id` matches and the stored revision is the
    /// predecessor, plus the claim fence. No owner predicate. While claimed,
    /// only disabling with otherwise identical configuration is allowed.
    /// `UpdateConflict` on a stale revision or a concurrent claim; never
    /// overwrite execution state.
    fn update_action(
        &self,
        action: ScheduledAction,
    ) -> impl Future<Output = Result<ScheduledAction>> + Send;

    /// Deletes the action row, its `entity_access` rows (`entity_type =
    /// 'scheduled_action'`) and the `entity` row in one transaction. A missing
    /// row is `Ok(())`.
    fn delete_action(&self, id: &Uuid) -> impl Future<Output = Result<()>> + Send;

    /// Claim only while the stored configuration is still `revision`, so a
    /// snapshot read before a pause or update can never start a run. The stored
    /// firing must also match, fencing candidates fetched before a completed run.
    fn claim_action(
        &self,
        id: &Uuid,
        revision: ConfigurationRevision,
        expected_next_run_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> impl Future<Output = Result<ClaimToken>> + Send;

    /// Release only this execution's claim; stale tokens must not mutate a newer run.
    fn release_action(
        &self,
        id: &Uuid,
        token: ClaimToken,
    ) -> impl Future<Output = Result<()>> + Send;

    fn create_execution_record(
        &self,
        record: ActionExecutionRecord,
    ) -> impl Future<Output = Result<()>> + Send;

    fn get_execution_records(
        &self,
        action_id: &Uuid,
    ) -> impl Future<Output = Result<Vec<ActionExecutionRecord>>> + Send;

    /// Advance the cron firing time; event actions are left unchanged.
    fn update_next_run_at(&self, id: &Uuid) -> impl Future<Output = Result<()>> + Send;

    fn update_last_executed(
        &self,
        id: &Uuid,
        executed_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<()>> + Send;
}

/// Lists routines a caller can access for read-only clients.
///
/// The list includes cron and event triggers and orders them by `(created_at, id)`.
pub trait ScheduledActionReadService: Send + Sync + 'static {
    /// Cron and event actions the user can access, ordered by `(created_at, id)`.
    fn list_accessible(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = std::result::Result<Vec<ScheduledAction>, Report>> + Send;
}

pub trait ScheduledActionService: Send + Sync + 'static {
    /// Read a routine only when the caller is its owner.
    fn get_action(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<ScheduledAction>> + Send;

    /// Delete all of a user's actions before account deletion, including disabled
    /// and claimed actions. Repeating a completed cleanup succeeds.
    fn delete_user_actions(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Delete one action while `expected_owner` still owns it, including a
    /// disabled or claimed one. Internal owner removal only. A missing action
    /// is already purged; one under another owner is untouched.
    fn purge_owned_action(
        &self,
        id: Uuid,
        expected_owner: &Owner,
    ) -> impl Future<Output = Result<OwnedPurgeOutcome>> + Send;

    /// Records `principal.owner()`. A non-user owner is `OwnerNotUserError`
    /// before validation and before any write. `BotForUser` records the user.
    fn create_action(
        &self,
        principal: &CreationPrincipal,
        input: CreateScheduledAction,
    ) -> impl Future<Output = Result<ScheduledAction>> + Send;

    /// Actions `user_id` can access. Legacy clients see cron actions only;
    /// backend clients opt into events. ID-based operations and workers must
    /// never authorize through this list.
    fn get_actions(
        &self,
        user_id: MacroUserIdStr<'static>,
        include_events: bool,
    ) -> impl Future<Output = Result<Vec<ScheduledAction>>> + Send;

    fn update_action(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        input: UpdateScheduledAction,
    ) -> impl Future<Output = Result<ScheduledAction>> + Send;

    /// Change activation without touching configuration. Requesting the
    /// current state returns the stored action unchanged.
    fn set_enabled(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        enabled: bool,
    ) -> impl Future<Output = Result<ScheduledAction>> + Send;

    fn delete_action(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<()>> + Send;

    fn execute_action_now(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<InProgressExecution>> + Send;

    fn get_execution_records(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<Vec<ActionExecutionRecord>>> + Send;
}

pub trait ScheduledActionDispatcher {
    fn begin_dispatch_loop(self) -> (Sender<DispatchEvent>, Receiver<InProgressExecution>);
}

pub trait ScheduledActionExecutor {
    fn execute_action(
        &self,
        action: ScheduledAction,
    ) -> impl Future<Output = Result<InProgressExecution>> + Send;
}

/// Execution dependencies, separate from claim/history orchestration.
pub trait ScheduledAgentRunner: Send + Sync + 'static {
    /// Prepare without starting the task. Remote runners must use the handle's
    /// preallocated IDs and retain established resources before any further await.
    /// The handle survives errors and cancellation of this future.
    fn prepare(
        &self,
        action: &ScheduledAction,
        handle: &mut ExecutionHandle,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Run to terminal completion, not merely submission. Dropping this future
    /// must signal local session/tool guards; remote cleanup uses `cancel`.
    fn run(
        &self,
        action: &ScheduledAction,
        handle: &ExecutionHandle,
        event: Option<&EventReference>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Best-effort cleanup, including partially prepared sessions. Must be safe
    /// when no resource was established. The executor bounds this operation and
    /// finalizes history/releases its claim regardless of cleanup failure.
    fn cancel(
        &self,
        action: &ScheduledAction,
        handle: &ExecutionHandle,
    ) -> impl Future<Output = Result<()>> + Send;
}

pub trait ScheduledActionLiveUpdate: Send + Sync + 'static {
    fn publish_update(&self, update: ScheduledActionUpdate) -> impl Future<Output = ()> + Send;
}
