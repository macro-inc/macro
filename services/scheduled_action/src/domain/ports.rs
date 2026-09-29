use super::event_runs::ClaimToken;
use super::event_trigger::EventReference;
use super::execution::ExecutionHandle;
use super::models::{
    ActionExecutionRecord, CreateScheduledAction, DispatchEvent, InProgressExecution,
    ScheduledAction, ScheduledActionUpdate, UpdateScheduledAction,
};
use anyhow::Result;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
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

    fn get_actions(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<ScheduledAction>>> + Send;

    /// Look up one action owned by the caller, independently of list filtering.
    fn get_action(
        &self,
        id: &Uuid,
        user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<ScheduledAction>>> + Send;

    /// Return the next `limit` enabled cron actions ordered by `next_run_at` ASC,
    /// filtering out those currently claimed by another worker (i.e. claimed
    /// within `MAX_ACTION_TIME`). Used by the polling dispatcher to find work.
    fn get_next_unclaimed_actions(
        &self,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<ScheduledAction>>> + Send;

    /// Atomically replace configuration only when the stored revision is the
    /// predecessor of the supplied revision. While claimed, only disabling with
    /// otherwise identical configuration is allowed. Return UpdateConflict on
    /// stale revisions or a concurrent claim; never overwrite execution state.
    fn update_action(
        &self,
        action: ScheduledAction,
    ) -> impl Future<Output = Result<ScheduledAction>> + Send;

    fn delete_action(
        &self,
        id: &Uuid,
        macro_user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<()>> + Send;

    fn claim_action(&self, id: &Uuid) -> impl Future<Output = Result<ClaimToken>> + Send;

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

/// Lists one user's routines for read-only clients.
///
/// The list includes cron and event triggers, keeps only actions whose owner
/// is that user, and orders them by `(created_at, id)`.
pub trait ScheduledActionReadService: Send + Sync + 'static {
    /// Routines owned by `user_id` in stable `(created_at, id)` order.
    fn list_owned(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = std::result::Result<Vec<ScheduledAction>, Report>> + Send;
}

pub trait ScheduledActionService: Send + Sync + 'static {
    /// Delete all of a user's actions before account deletion, including disabled
    /// and claimed actions. Repeating a completed cleanup succeeds.
    fn delete_user_actions(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<()>> + Send;

    fn create_action(
        &self,
        input: CreateScheduledAction,
        user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<ScheduledAction>> + Send;

    /// Legacy clients see cron actions only. Backend clients opt into events.
    /// ID-based operations and workers must never authorize through this list.
    fn get_actions(
        &self,
        user_id: MacroUserIdStr<'static>,
        include_events: bool,
    ) -> impl Future<Output = Result<Vec<ScheduledAction>>> + Send;

    fn update_action(
        &self,
        id: &Uuid,
        input: UpdateScheduledAction,
        macro_user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<ScheduledAction>> + Send;

    fn delete_action(
        &self,
        id: &Uuid,
        macro_user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<()>> + Send;

    fn execute_action_now(
        &self,
        id: &Uuid,
        macro_user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<InProgressExecution>> + Send;

    fn get_execution_records(
        &self,
        id: &Uuid,
        macro_user_id: MacroUserIdStr<'static>,
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
