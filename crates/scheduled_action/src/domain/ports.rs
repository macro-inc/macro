use super::event_runs::{AuthorizedEventRun, ClaimToken, ConfigurationRevision};
use super::event_trigger::{EventName, EventReference};
use super::execution::ExecutionHandle;
use super::models::{
    ActionExecutionRecord, CreateScheduledAction, DispatchEvent, InProgressExecution, RunHistory,
    ScheduledAction, ScheduledActionUpdate, UpdateScheduledAction,
};
use super::templates::{RoutineTemplate, ShareRoutineTemplate, TemplateSnapshot};
use anyhow::Result;
use bots::domain::models::AgentMcpServer;
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
use trigger_context::{RoutineEvent, TriggerContext};

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

    /// When the routine last finished a run and last succeeded, for its code.
    fn run_history(&self, action_id: &Uuid) -> impl Future<Output = Result<RunHistory>> + Send {
        let _ = action_id;
        async { Ok(RunHistory::default()) }
    }

    /// The latest execution record of each of `action_ids` that has run.
    fn get_latest_execution_records(
        &self,
        action_ids: &[Uuid],
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
    /// Read a routine by its unguessable ID for an authenticated viewer.
    fn get_action(&self, id: Uuid) -> impl Future<Output = Result<ScheduledAction>> + Send;

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

    /// `create_action` for a routine activated from `template_id`, recorded
    /// as given: callers check that the template exists.
    fn create_action_from_template(
        &self,
        principal: &CreationPrincipal,
        input: CreateScheduledAction,
        template_id: Uuid,
    ) -> impl Future<Output = Result<ScheduledAction>> + Send;

    /// Actions `user_id` can access. Legacy clients see cron actions only;
    /// backend clients opt into events. ID-based operations and workers must
    /// never authorize through this list.
    fn get_actions(
        &self,
        user_id: MacroUserIdStr<'static>,
        include_events: bool,
    ) -> impl Future<Output = Result<Vec<ScheduledAction>>> + Send;

    /// [`Self::get_actions`], each with its latest run when `user_id` owns
    /// it: run history stays owner-scoped.
    fn get_actions_with_last_run(
        &self,
        user_id: MacroUserIdStr<'static>,
        include_events: bool,
    ) -> impl Future<Output = Result<Vec<(ScheduledAction, Option<ActionExecutionRecord>)>>> + Send;

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

    /// How to write a code step for `task`: the shared guide, the type of
    /// `main`'s argument, and the SDK reference relevant to the task.
    fn code_guide(
        &self,
        user: MacroUserIdStr<'static>,
        task: &str,
    ) -> impl Future<Output = Result<super::code_check::CodeGuide>> + Send;

    /// Type-check a routine's code steps the way saving it does, without
    /// saving it.
    fn check_code(
        &self,
        steps: &serde_json::Value,
    ) -> impl Future<Output = Result<super::code_check::CodeCheck>> + Send;

    /// How the routine's code steps were brought to new SDKs, newest first.
    fn get_code_upgrades(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<Vec<super::code_upgrade::CodeUpgrade>>> + Send;
}

/// Templates shared from routines, keyed by their source routine's ID.
pub trait RoutineTemplateRepo: Send + Sync + 'static {
    /// Create the template or replace its snapshot, keeping its creation time.
    fn upsert_template(
        &self,
        snapshot: TemplateSnapshot,
    ) -> impl Future<Output = Result<RoutineTemplate>> + Send;

    /// A missing template is `Ok(())`.
    fn delete_template(&self, id: &Uuid) -> impl Future<Output = Result<()>> + Send;

    fn get_template(
        &self,
        id: &Uuid,
    ) -> impl Future<Output = Result<Option<RoutineTemplate>>> + Send;
}

/// Sharing routines as templates and activating them.
pub trait RoutineTemplateService: Send + Sync + 'static {
    /// Share the receipt's routine, or replace its shared snapshot with the
    /// routine's current configuration.
    fn share_template(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        input: ShareRoutineTemplate,
    ) -> impl Future<Output = Result<RoutineTemplate>> + Send;

    /// Stop sharing. Routines already activated from it keep running.
    fn unshare_template(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Read a template by its unguessable ID for a viewer with sharing enabled.
    fn get_template(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> impl Future<Output = Result<RoutineTemplate>> + Send;

    /// Create the principal's own routine from a shared template. The input
    /// is the activator's filled-in configuration, validated like any create.
    fn activate_template(
        &self,
        principal: &CreationPrincipal,
        template_id: Uuid,
        input: CreateScheduledAction,
    ) -> impl Future<Output = Result<ScheduledAction>> + Send;
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

/// What started a routine run.
#[derive(Clone, Copy)]
pub enum RoutineRun<'a> {
    /// One of its schedules came due.
    Scheduled { scheduled_for: DateTime<Utc> },
    /// Its owner started it by hand.
    Manual { requested_at: DateTime<Utc> },
    /// An event it watches happened, and its owner may read it.
    Event(&'a AuthorizedEventRun),
}

impl RoutineRun<'_> {
    pub fn event(&self) -> Option<&EventReference> {
        match self {
            Self::Event(run) => Some(&run.pending.event),
            Self::Scheduled { .. } | Self::Manual { .. } => None,
        }
    }
}

/// Reads the event a routine fired on, as the routine owner, through the
/// run's access receipt. Content that is gone or unreadable is `Err`.
pub trait RoutineEventReader: Send + Sync + 'static {
    fn read_event(
        &self,
        owner: &MacroUserIdStr<'static>,
        run: &AuthorizedEventRun,
    ) -> impl Future<Output = Result<RoutineEvent, Report>> + Send;
}

/// Execution dependencies, separate from claim/history orchestration.
pub trait ScheduledAgentRunner: Send + Sync + 'static {
    /// Prepare without starting the task. Remote runners must use the handle's
    /// preallocated IDs and retain established resources before any further await.
    /// A run that does not start with an agent may establish no resource here.
    /// The handle survives errors and cancellation of this future.
    fn prepare(
        &self,
        action: &ScheduledAction,
        handle: &mut ExecutionHandle,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Run to terminal completion, not merely submission. Dropping this future
    /// must signal local session/tool guards; remote cleanup uses `cancel`.
    /// Record each step's result and any resource on the handle as it happens:
    /// the handle survives errors and cancellation. `firing` says what started
    /// the run; an event firing carries the owner's access to the event.
    fn run(
        &self,
        action: &ScheduledAction,
        handle: &mut ExecutionHandle,
        firing: RoutineRun<'_>,
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

/// Runs a routine's agent step: at most one per run, under the run handle's
/// preallocated session and action ids.
pub trait RoutineAgents: Send + Sync + 'static {
    /// Open an idle session for `step` as `action`'s owner, listed the way the
    /// routine says and handed the routine's required `apps`. Record the
    /// persona on the handle before awaiting, and the transcript as soon as it
    /// exists, so cleanup and history survive a failed or cancelled preparation.
    fn prepare(
        &self,
        action: &ScheduledAction,
        step: &routine_program::AgentStep,
        apps: &[AgentMcpServer],
        handle: &mut ExecutionHandle,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Deliver `prompt` once to the prepared session, with the structured
    /// account of what fired the routine when there is one, and wait for its
    /// outcome. Never replay the prompt after an ambiguous failure.
    fn run(
        &self,
        owner: &MacroUserIdStr<'static>,
        handle: &ExecutionHandle,
        prompt: String,
        context: Option<TriggerContext>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Best-effort stop of a session this run opened or tried to open. Safe
    /// when no agent was involved.
    fn cancel(
        &self,
        owner: &MacroUserIdStr<'static>,
        handle: &ExecutionHandle,
    ) -> impl Future<Output = Result<()>> + Send;
}

/// Runs a routine's tool steps: one allowlisted catalog tool at a time, as
/// the routine's owner, outside any agent session. Implemented in the process
/// that holds the tool catalog; never replay a call after an ambiguous
/// failure, since tools are not idempotent.
pub trait RoutineTools: Send + Sync + 'static {
    /// Call `tool` with `arguments` as `owner`. A tool that refuses or fails
    /// answers [`RoutineToolOutcome::Failed`] with its reason for the owner.
    fn call(
        &self,
        owner: &MacroUserIdStr<'static>,
        tool: routine_program::RoutineTool,
        arguments: serde_json::Map<String, serde_json::Value>,
    ) -> impl Future<Output = RoutineToolOutcome> + Send;
}

/// What a routine's tool call did.
#[derive(Debug, Clone, PartialEq)]
pub enum RoutineToolOutcome {
    /// The tool ran; its output, or null when too large to keep.
    Completed {
        /// The tool's JSON output, available to later steps' templates.
        output: serde_json::Value,
    },
    /// The tool refused or failed, in words written for the routine's owner.
    Failed {
        /// Why, kept in the run's history.
        message: String,
    },
}

/// Checks and runs a routine's code steps as its owner, in the process that
/// holds the SDK executor. Never replay a run after an ambiguous failure:
/// its writes may have happened.
pub trait RoutineCode: Send + Sync + 'static {
    /// The version code is type-checked against now: the SDK and the step
    /// contract ([`routine_program::code_version`]). `None` when code can't
    /// run here.
    fn sdk(&self) -> Option<routine_program::SdkFingerprint>;

    /// Type-check a program's code steps together against [`Self::sdk`] and
    /// the step contract, each step seeing the outputs of the steps before
    /// it. The steps with problems, each written as the type checker
    /// reported it; empty when every step checks.
    fn check_program(
        &self,
        program: &routine_program::RoutineProgram,
    ) -> impl Future<Output = Result<Vec<StepProblems>, CodeUnavailable>> + Send;

    /// The IANA time zone of `owner`'s primary calendar, when they have one.
    fn owner_time_zone(
        &self,
        owner: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Option<String>> + Send;

    /// Run one code step as `owner`. A dry run sends no writes.
    fn run(
        &self,
        owner: &MacroUserIdStr<'static>,
        run: CodeRun<'_>,
    ) -> impl Future<Output = CodeOutcome> + Send;

    /// The SDK reference for code that does `task` (entity indexes with
    /// method signatures), chosen for `user`.
    fn reference(
        &self,
        user: &MacroUserIdStr<'static>,
        task: &str,
    ) -> impl Future<Output = Result<String, CodeUnavailable>> + Send;

    /// The SDK declarations of the types `problems` name, for whoever fixes
    /// the code.
    fn declarations(&self, problems: &[String]) -> String;

    /// Rewrite `step`'s source so the problems [`Self::check_program`]
    /// found go away, keeping what it does, billed to `owner`. `steps` is
    /// the TypeScript type of the outputs it reads. The model sees the code
    /// and the problems, never the routine's data. Why it couldn't, for the
    /// owner.
    fn rewrite(
        &self,
        owner: &MacroUserIdStr<'static>,
        step: &routine_program::CodeStep,
        steps: &str,
        problems: &[String],
    ) -> impl Future<Output = Result<String, String>> + Send;
}

/// A code step that doesn't type-check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepProblems {
    /// Which code step, counted in program order from zero.
    pub index: usize,
    /// Its title.
    pub title: String,
    /// The problems, as the type checker reported them.
    pub problems: Vec<String>,
}

/// Code can't be checked or run right now; the reason is for the owner.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct CodeUnavailable(pub String);

/// One code step to run.
#[derive(Debug, Clone, Copy)]
pub struct CodeRun<'a> {
    /// The step.
    pub step: &'a routine_program::CodeStep,
    /// `run`, `routine` and `trigger`, as `main` receives them.
    pub context: &'a serde_json::Value,
    /// Outputs of earlier steps with ids.
    pub steps: &'a serde_json::Value,
    /// Answer every write with an empty result instead of sending it.
    pub dry_run: bool,
}

/// What one code step did.
#[derive(Debug, Clone, PartialEq)]
pub struct CodeOutcome {
    /// What `main` returned, or why the step failed, for the owner.
    pub result: Result<serde_json::Value, String>,
    /// Its SDK calls, in the order they started.
    pub calls: Vec<routine_program::CallRecord>,
    /// More calls ran than `calls` records.
    pub calls_truncated: bool,
}

/// Hosts without an SDK executor: code steps fail with a reason.
pub struct NoRoutineCode;

const NO_CODE: &str = "Code steps can't run here: no code executor is configured.";

impl RoutineCode for NoRoutineCode {
    fn sdk(&self) -> Option<routine_program::SdkFingerprint> {
        None
    }

    async fn check_program(
        &self,
        _: &routine_program::RoutineProgram,
    ) -> Result<Vec<StepProblems>, CodeUnavailable> {
        Err(CodeUnavailable(NO_CODE.to_owned()))
    }

    async fn owner_time_zone(&self, _: &MacroUserIdStr<'static>) -> Option<String> {
        None
    }

    async fn run(&self, _: &MacroUserIdStr<'static>, _: CodeRun<'_>) -> CodeOutcome {
        CodeOutcome {
            result: Err(NO_CODE.to_owned()),
            calls: Vec::new(),
            calls_truncated: false,
        }
    }

    async fn reference(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
    ) -> Result<String, CodeUnavailable> {
        Err(CodeUnavailable(NO_CODE.to_owned()))
    }

    fn declarations(&self, _: &[String]) -> String {
        String::new()
    }

    async fn rewrite(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &routine_program::CodeStep,
        _: &str,
        _: &[String],
    ) -> Result<String, String> {
        Err(NO_CODE.to_owned())
    }
}

/// A host that may not have an executor: `None` behaves like [`NoRoutineCode`].
impl<Code: RoutineCode> RoutineCode for Option<Code> {
    fn sdk(&self) -> Option<routine_program::SdkFingerprint> {
        self.as_ref().and_then(RoutineCode::sdk)
    }

    async fn check_program(
        &self,
        program: &routine_program::RoutineProgram,
    ) -> Result<Vec<StepProblems>, CodeUnavailable> {
        match self {
            Some(code) => code.check_program(program).await,
            None => NoRoutineCode.check_program(program).await,
        }
    }

    async fn owner_time_zone(&self, owner: &MacroUserIdStr<'static>) -> Option<String> {
        match self {
            Some(code) => code.owner_time_zone(owner).await,
            None => None,
        }
    }

    async fn run(&self, owner: &MacroUserIdStr<'static>, run: CodeRun<'_>) -> CodeOutcome {
        match self {
            Some(code) => code.run(owner, run).await,
            None => NoRoutineCode.run(owner, run).await,
        }
    }

    async fn reference(
        &self,
        user: &MacroUserIdStr<'static>,
        task: &str,
    ) -> Result<String, CodeUnavailable> {
        match self {
            Some(code) => code.reference(user, task).await,
            None => NoRoutineCode.reference(user, task).await,
        }
    }

    fn declarations(&self, problems: &[String]) -> String {
        self.as_ref()
            .map(|code| code.declarations(problems))
            .unwrap_or_default()
    }

    async fn rewrite(
        &self,
        owner: &MacroUserIdStr<'static>,
        step: &routine_program::CodeStep,
        steps: &str,
        problems: &[String],
    ) -> Result<String, String> {
        match self {
            Some(code) => code.rewrite(owner, step, steps, problems).await,
            None => NoRoutineCode.rewrite(owner, step, steps, problems).await,
        }
    }
}

/// Records how a routine's code was brought to a new SDK. Every write is
/// fenced by the routine's configuration revision, so an owner's edit made
/// meanwhile wins.
pub trait CodeUpgrades: Send + Sync + 'static {
    /// The code checked as it was: record `sdk` on the routine's task.
    fn record_checked(
        &self,
        action: &ScheduledAction,
        sdk: &routine_program::SdkFingerprint,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Claim the one rewrite for this routine and SDK. False when another
    /// run holds it, or it already ended; a claim left running for long by a
    /// stopped process can be taken over.
    fn claim_rewrite(
        &self,
        action: &ScheduledAction,
        sdk: &routine_program::SdkFingerprint,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Save a checked rewrite as the routine's task.
    fn save_rewrite(
        &self,
        action: &ScheduledAction,
        sdk: &routine_program::SdkFingerprint,
        task: &serde_json::Value,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Pause the routine for its owner, with why and the rewrite that
    /// failed its checks, if there was one.
    fn needs_update(
        &self,
        action: &ScheduledAction,
        sdk: &routine_program::SdkFingerprint,
        reason: &str,
        proposal: Option<&serde_json::Value>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Up to `limit` enabled routines with code steps last checked against
    /// another SDK than `sdk`, by id after `after`.
    fn stale_routines(
        &self,
        sdk: &routine_program::SdkFingerprint,
        after: Option<Uuid>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<Uuid>>> + Send;

    /// The routine's upgrades, newest first.
    fn list_upgrades(
        &self,
        action_id: Uuid,
    ) -> impl Future<Output = Result<Vec<super::code_upgrade::CodeUpgrade>>> + Send;
}

pub trait ScheduledActionLiveUpdate: Send + Sync + 'static {
    fn publish_update(&self, update: ScheduledActionUpdate) -> impl Future<Output = ()> + Send;
}

/// What started a finished routine run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunTrigger {
    /// One of its schedules came due.
    Scheduled,
    /// Its owner started it by hand.
    Manual,
    /// An event it watches happened.
    Event(EventName),
}

/// Who did a routine run's work: a program's agent step, when it has one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunTarget {
    /// A model, prompted directly.
    Model,
    /// One of the owner's agents.
    Agent,
    /// Only actions and decisions: no step reaches a model or agent.
    Steps,
    /// The task could not be read.
    Unknown,
}

/// How a routine run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunEnd {
    Succeeded,
    Failed,
    /// Shutdown or the event worker stopped it.
    Interrupted,
    /// The owner's AI allowance refused the run before it started.
    AiLimitReached,
}

/// A routine run that started and then ended, whatever the outcome.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FinishedRoutineRun {
    pub owner: MacroUserIdStr<'static>,
    pub routine_id: Uuid,
    pub trigger: RunTrigger,
    pub target: RunTarget,
    pub end: RunEnd,
    pub duration: chrono::Duration,
}

/// Told about every finished routine run, e.g. for product analytics.
/// Called on the run's task, so implementations must be quick or spawn.
pub trait RoutineRunObserver: Send + Sync + 'static {
    fn run_finished(&self, run: FinishedRoutineRun);
}

impl RoutineRunObserver for () {
    fn run_finished(&self, _run: FinishedRoutineRun) {}
}
