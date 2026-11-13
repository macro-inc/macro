use super::appearance::ChangeAppearance;
use super::event_runs::{AuthorizedEventRun, ClaimToken, ConfigurationRevision};
use super::event_trigger::{EventName, EventReference};
use super::execution::ExecutionHandle;
use super::models::{
    ActionConfiguration, ActionConfigurationUpdate, ActionExecutionRecord, CreatedRoutine,
    DispatchEvent, InProgressExecution, ListScope, ListedAction, ListedRun, RunCaller, RunHistory,
    RunningRun, ScheduledAction, ScheduledActionUpdate, SubRoutineKey,
};
use super::templates::{RoutineTemplate, ShareRoutineTemplate, TemplateSnapshot};
use anyhow::Result;
use bots::domain::models::AgentMcpServer;
use chrono::{DateTime, Utc};
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel, RequiredPermission, ViewAccessLevel,
};
use entity_registry::OwnedPurgeOutcome;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_entity::EntityAppearance;
use model_owner::{CreationPrincipal, Owner};
use rootcause::Report;
use std::collections::HashMap;
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

    /// Atomically replace presentation and record the actual change in entity history.
    fn set_appearance(
        &self,
        change: ChangeAppearance,
    ) -> impl Future<Output = Result<Option<EntityAppearance>>> + Send;

    /// Deletes the action row, its `entity_access` rows (`entity_type =
    /// 'scheduled_action'`), history, and the `entity` row in one transaction. A missing
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

    /// The latest finished run of each action that has one. Ids without runs
    /// are omitted.
    fn last_runs(
        &self,
        action_ids: &[Uuid],
    ) -> impl Future<Output = Result<HashMap<Uuid, ActionExecutionRecord>>> + Send;

    /// Advance the cron firing time; event actions are left unchanged.
    fn update_next_run_at(&self, id: &Uuid) -> impl Future<Output = Result<()>> + Send;

    fn update_last_executed(
        &self,
        id: &Uuid,
        executed_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<()>> + Send;
}

/// Sub-routines: the routines a routine's runs created, and the run in
/// progress a new one would belong to.
pub trait SubRoutines: Send + Sync + 'static {
    /// `routine`'s run in progress, if it has one.
    fn running_run(
        &self,
        routine: &Uuid,
    ) -> impl Future<Output = Result<Option<RunningRun>>> + Send;

    /// The run in progress whose Ask AI step opened agent session `session`:
    /// a run's id is also the id of the session it opens.
    fn running_run_of_session(
        &self,
        session: &Uuid,
    ) -> impl Future<Output = Result<Option<RunningRun>>> + Send;

    /// `parent`'s sub-routines, oldest first: every active one, and the
    /// newest finished one-time ones, which accumulate without bound.
    fn children(&self, parent: &Uuid) -> impl Future<Output = Result<Vec<ScheduledAction>>> + Send;

    /// The active sub-routines of `parents`, oldest first: every one except
    /// finished one-time ones.
    fn active_children(
        &self,
        parents: &[Uuid],
    ) -> impl Future<Output = Result<Vec<ScheduledAction>>> + Send;

    /// The rows among `ids` that are top-level routines. Missing ids omitted.
    fn top_level_by_ids(
        &self,
        ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<ScheduledAction>>> + Send;

    /// `parent`'s sub-routine created under `key`, if there is one.
    fn child_by_key(
        &self,
        parent: &Uuid,
        key: &SubRoutineKey,
    ) -> impl Future<Output = Result<Option<ScheduledAction>>> + Send;

    /// Make a sub-routine a top-level routine: it forgets its parent, the run
    /// that created it and its key. `None` when it has no parent.
    fn detach(&self, id: &Uuid) -> impl Future<Output = Result<Option<ScheduledAction>>> + Send;

    /// The sub-routines of `parent` that `runs` created, each with its run.
    fn created_by_runs(
        &self,
        parent: &Uuid,
        runs: &[Uuid],
    ) -> impl Future<Output = Result<Vec<(Uuid, CreatedRoutine)>>> + Send;
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
    /// The routine a receipt names, when the receipt's user owns it; anyone
    /// else gets `ActionPolicyError::NotFound`, as run history does.
    fn get_action<T: RequiredPermission>(
        &self,
        receipt: &EntityAccessReceipt<T>,
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
    /// Always a top-level routine.
    fn create_action(
        &self,
        principal: &CreationPrincipal,
        input: ActionConfiguration,
    ) -> impl Future<Output = Result<ScheduledAction>> + Send;

    /// [`Self::create_action`] for a request whose credential may come from
    /// a routine's run. A create that `caller` proves comes from a run in
    /// progress makes a sub-routine of that routine (of its parent, when it
    /// is a sub-routine itself), refused with `TooManySubRoutines` at the
    /// cap. With `key`, the parent's sub-routine already created under that
    /// key is updated instead; a key outside a run is `KeyOutsideRun`.
    fn create_action_from(
        &self,
        principal: &CreationPrincipal,
        input: ActionConfiguration,
        caller: RunCaller,
        key: Option<SubRoutineKey>,
    ) -> impl Future<Output = Result<SavedAction>> + Send;

    /// Make the receipt's sub-routine a top-level routine that no longer
    /// follows its parent. `NotSubRoutine` when it has no parent.
    fn detach_action(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> impl Future<Output = Result<ScheduledAction>> + Send;

    /// What saving `input` as `principal`'s routine would find wrong, and the
    /// routine as it would be stored, without saving anything. A check made
    /// by a routine draft's session (`correlation`, the code-mode invocation
    /// the request's credential names) is kept as that draft's answer, with
    /// the items it says it `created` for the routine.
    fn check_action(
        &self,
        principal: &CreationPrincipal,
        input: ActionConfiguration,
        created: Vec<super::models::CreatedItem>,
        correlation: Option<Uuid>,
    ) -> impl Future<Output = Result<super::models::RoutineCheck>> + Send;

    /// [`Self::check_action`] for a routine the drafter wrote itself for
    /// `owner`, outside any session: nothing is kept.
    fn check_draft(
        &self,
        owner: &MacroUserIdStr<'static>,
        input: ActionConfiguration,
    ) -> impl Future<Output = Result<super::models::RoutineCheck>> + Send;

    /// `create_action` for a routine activated from `template_id`, recorded
    /// as given: callers check that the template exists.
    fn create_action_from_template(
        &self,
        principal: &CreationPrincipal,
        input: ActionConfiguration,
        template_id: Uuid,
        appearance: EntityAppearance,
    ) -> impl Future<Output = Result<ScheduledAction>> + Send;

    /// `create_action` for a routine saved from routine suggestion
    /// `suggestion_id`, recorded as given: it only marks that suggestion
    /// taken for the routine's owner.
    fn create_action_from_suggestion(
        &self,
        principal: &CreationPrincipal,
        input: ActionConfiguration,
        suggestion_id: Uuid,
    ) -> impl Future<Output = Result<ScheduledAction>> + Send;

    /// Actions `user_id` can access, within `scope`. Legacy clients see cron
    /// actions only; backend clients opt into events. ID-based operations and
    /// workers must never authorize through this list.
    fn get_actions(
        &self,
        user_id: MacroUserIdStr<'static>,
        include_events: bool,
        scope: ListScope,
    ) -> impl Future<Output = Result<Vec<ListedAction>>> + Send;

    fn update_action(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        input: ActionConfigurationUpdate,
    ) -> impl Future<Output = Result<ScheduledAction>> + Send;

    /// Change the owner's routine presentation without changing its execution revision.
    fn set_appearance(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        appearance: EntityAppearance,
    ) -> impl Future<Output = Result<EntityAppearance>> + Send;

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

    /// The routine's finished runs, newest first, each with the routines it
    /// created that still follow it.
    fn get_execution_records(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<Vec<ListedRun>>> + Send;

    /// Macro's catalog routines with schedules in `timezone`, without code
    /// steps on hosts where code can't be saved.
    fn catalog(&self, timezone: chrono_tz::Tz) -> Vec<super::catalog::CatalogEntry>;

    /// How the routine's code steps were brought to new SDKs, newest first.
    fn get_code_upgrades(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<Vec<super::code_upgrade::CodeUpgrade>>> + Send;
}

/// A create's result: a new routine, or the sub-routine its key already named.
#[derive(Debug, Clone)]
pub enum SavedAction {
    Created(ScheduledAction),
    /// The parent's sub-routine under the same key, updated in place.
    Updated(ScheduledAction),
}

impl SavedAction {
    pub fn into_action(self) -> ScheduledAction {
        match self {
            Self::Created(action) | Self::Updated(action) => action,
        }
    }
}

/// AI that drafts routines and their steps from people's words.
pub trait RoutineDraftService: Send + Sync + 'static {
    /// Draft what `request` asks for, billed to `owner`, naming the items
    /// `context` lists. A [`super::drafts::Draft::Failed`] says why AI
    /// couldn't; an error means the request can't be drafted at all.
    fn draft(
        &self,
        owner: MacroUserIdStr<'static>,
        request: super::drafts::DraftRequest,
        context: super::drafts::DraftContext,
    ) -> impl Future<Output = Result<super::drafts::Draft>> + Send;
}

/// What a routine suggestion was, for the log of a routine saved from it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SuggestionOrigin {
    /// `for_you` (AI's) or `macro` (a template).
    pub from: &'static str,
    /// `catalog` or `routine`.
    pub kind: &'static str,
    /// The surface it belongs to most.
    pub surface: Option<&'static str>,
}

/// Finds what a suggestion was. Object-safe, so the scheduled action service
/// need not know the suggestion store's type.
#[async_trait::async_trait]
pub trait SuggestionOrigins: Send + Sync + 'static {
    /// What suggestion `suggestion`, made to `owner`, was, if it is one.
    async fn origin(
        &self,
        owner: &MacroUserIdStr<'static>,
        suggestion: Uuid,
    ) -> Result<Option<SuggestionOrigin>>;
}

/// Where a draft's session hands its routine back: one row per draft,
/// keyed by the draft session's id, so the drafter reads what the session
/// checked whichever replicas each ran on. Object-safe: the drafter and the
/// check share one erased store.
#[async_trait::async_trait]
pub trait DraftHandBacks: Send + Sync + 'static {
    /// Start a draft whose session is `session`, run as `agent` for `owner`.
    async fn begin(
        &self,
        session: Uuid,
        owner: &MacroUserIdStr<'static>,
        agent: bot_id::BotId,
    ) -> Result<()>;

    /// Keep `check` as the routine `session`'s draft hands back, and add
    /// `created` to what it created, if `session` is a draft `owner`
    /// started. Whether it was.
    async fn record(
        &self,
        session: Uuid,
        owner: &MacroUserIdStr<'static>,
        check: &super::models::RoutineCheck,
        created: &[super::models::CreatedItem],
    ) -> Result<bool>;

    /// The draft's latest check, and how many checks it made.
    async fn handed_back(&self, session: Uuid) -> Result<HandedBack>;

    /// Forget the draft.
    async fn finish(&self, session: Uuid) -> Result<()>;

    /// Drafts started before `before`, oldest first, at most `limit`. Only
    /// drafts a waiting request runs; background drafts have their own
    /// lifecycle ([`DraftJobStore`]).
    async fn stale(&self, before: DateTime<Utc>, limit: u16) -> Result<Vec<StaleDraft>>;
}

/// The model a routine draft is written with, admitted and billed as the
/// person's automation usage. Object-safe (`async_trait`): the drafter holds
/// it erased.
#[async_trait::async_trait]
pub trait DraftModel: Send + Sync + 'static {
    /// Admit `owner`'s usage for one draft, before its first call.
    async fn admit(
        &self,
        owner: &MacroUserIdStr<'static>,
    ) -> Result<(), ai_billing::AiAdmissionError>;

    /// One call's answer, as text.
    async fn complete(
        &self,
        owner: &MacroUserIdStr<'static>,
        call: super::drafts::direct::DraftCall<'_>,
    ) -> Result<String, super::drafts::direct::DraftCallError>;
}

/// Finds the items a person can access by the names a request uses, of
/// any kind, in one call. Object-safe (`async_trait`): the drafter holds it
/// erased.
#[async_trait::async_trait]
pub trait NameLookups: Send + Sync + 'static {
    /// What each of `names` matched, in the order asked, and the kinds that
    /// couldn't be searched.
    async fn look_up(
        &self,
        owner: &MacroUserIdStr<'static>,
        names: &[super::drafts::direct::NameAsked],
    ) -> Result<super::drafts::direct::NameAnswers, super::drafts::direct::NameLookupError>;
}

/// Saving's checks for a routine a drafter wrote, as its owner, saving
/// nothing. Object-safe (`async_trait`): the drafter holds it erased.
#[async_trait::async_trait]
pub trait DraftChecks: Send + Sync + 'static {
    async fn check(
        &self,
        owner: &MacroUserIdStr<'static>,
        routine: ActionConfiguration,
    ) -> Result<super::models::RoutineCheck>;
}

/// Background drafts' rows: the same rows [`DraftHandBacks`] keeps checks
/// on, with a state, what was asked, the progress and, once finished, the
/// result. Any replica reads and changes them. Object-safe: the drafting
/// job holds it erased, as it does the hand-backs.
#[async_trait::async_trait]
pub trait DraftJobStore: Send + Sync + 'static {
    /// Start `job`, drafting, unless its owner has a live job (drafting,
    /// ready or failed) with its client id, or `limit` jobs drafting that
    /// started after `since`. One owner's starts are serialized, so starts
    /// sent together never pass the limit together.
    async fn begin_job(
        &self,
        job: &super::drafts::jobs::NewDraftJob,
        limit: u32,
        since: DateTime<Utc>,
    ) -> Result<super::drafts::jobs::Begun>;

    /// `owner`'s live job that the start with `client_id` began.
    async fn started(
        &self,
        owner: &MacroUserIdStr<'static>,
        client_id: Uuid,
    ) -> Result<Option<super::drafts::jobs::DraftJob>>;

    /// Keep `progress` on a job still drafting. Whether it was.
    async fn progress(
        &self,
        session: Uuid,
        progress: &super::drafts::progress::DraftJobProgress,
    ) -> Result<bool>;

    /// Finish a job still drafting with `draft`, ready or failed as it says.
    async fn finish_job(
        &self,
        session: Uuid,
        draft: &super::drafts::Draft,
    ) -> Result<super::drafts::jobs::Finished>;

    /// `owner`'s jobs that are drafting or finished, newest first, at most
    /// `limit`. Cancelled ones aren't.
    async fn jobs(
        &self,
        owner: &MacroUserIdStr<'static>,
        limit: u16,
    ) -> Result<Vec<super::drafts::jobs::DraftJob>>;

    /// `owner`'s job `session`, unless it was cancelled.
    async fn job(
        &self,
        owner: &MacroUserIdStr<'static>,
        session: Uuid,
    ) -> Result<Option<super::drafts::jobs::DraftJob>>;

    /// Cancel `owner`'s job `session`, drafting or finished: no one reads it
    /// again. What it was, unless it is someone else's, missing or cancelled
    /// already.
    async fn cancel_job(
        &self,
        owner: &MacroUserIdStr<'static>,
        session: Uuid,
    ) -> Result<Option<super::drafts::jobs::CancelledJob>>;

    /// Fail jobs still drafting that started before `before`, whose drafter
    /// is gone, with `draft`. Those it failed, oldest first, at most `limit`;
    /// one replica fails each.
    async fn interrupt(
        &self,
        before: DateTime<Utc>,
        draft: &super::drafts::Draft,
        limit: u16,
    ) -> Result<Vec<super::drafts::jobs::InterruptedJob>>;

    /// Jobs cancelled before `before`, whose drafter never cleaned up.
    async fn abandoned(&self, before: DateTime<Utc>, limit: u16) -> Result<Vec<StaleDraft>>;

    /// Jobs that finished before `before` and were never discarded.
    async fn expired(&self, before: DateTime<Utc>, limit: u16) -> Result<Vec<StaleDraft>>;
}

/// Pushes how a background draft is going to its owner's open apps.
pub trait RoutineDraftUpdates: Send + Sync + 'static {
    fn publish_draft(
        &self,
        owner: &MacroUserIdStr<'static>,
        update: super::drafts::jobs::DraftUpdate,
    ) -> impl Future<Output = ()> + Send;
}

/// Drafts that run in the background: a person starts one and reads its
/// result later, from any replica.
pub trait RoutineDraftJobService: Send + Sync + 'static {
    /// Start drafting `request` for `owner`, once it is valid and its usage
    /// admitted, which the blocking draft's errors say otherwise.
    /// `client_id` is the id the client gave the start: sent again, it
    /// answers with the job it started while that job is live, starting
    /// nothing. `traceparent` is the starting request's trace context.
    fn start(
        &self,
        owner: MacroUserIdStr<'static>,
        client_id: Uuid,
        request: super::drafts::DraftRequest,
        context: super::drafts::DraftContext,
        traceparent: Option<String>,
    ) -> impl Future<Output = Result<super::drafts::jobs::DraftJob>> + Send;

    /// `owner`'s jobs drafting, and those finished but not discarded.
    fn jobs(
        &self,
        owner: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<super::drafts::jobs::DraftJob>>> + Send;

    /// `owner`'s job `id`; [`super::drafts::jobs::DraftJobError::NotFound`]
    /// for anyone else's.
    fn job(
        &self,
        owner: MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<super::drafts::jobs::DraftJob>> + Send;

    /// Cancel `owner`'s job `id` while it drafts, or discard it once
    /// finished.
    fn discard(
        &self,
        owner: MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<()>> + Send;
}

/// What a draft's session handed back so far.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct HandedBack {
    /// Its latest check; `None` before its first.
    pub check: Option<super::models::RoutineCheck>,
    /// Its latest check that passed, kept even when a later one failed.
    pub passed: Option<super::models::RoutineCheck>,
    /// How many checks it made.
    pub checks: u32,
    /// What it said it created for the routine, across its checks.
    pub created: Vec<super::models::CreatedItem>,
    /// Whether its owner cancelled it: a background draft's drafter stops.
    pub cancelled: bool,
}

/// A draft left behind, for the sweep.
#[derive(Debug, Clone, PartialEq)]
pub struct StaleDraft {
    pub session: Uuid,
    pub owner: MacroUserIdStr<'static>,
    pub agent: bot_id::BotId,
}

/// What an agent session's programs created, from the activity recorded for
/// its code-mode invocations. Written asynchronously, so a read right after
/// a creation can miss it. Object-safe so the drafter holds it erased.
#[async_trait::async_trait]
pub trait SessionCreations: Send + Sync + 'static {
    /// Items `session` created, as its activity records them so far.
    async fn created_by(&self, session: Uuid) -> Result<Vec<super::models::CreatedItem>>;
}

/// A host that records no session activity.
pub struct NoSessionCreations;

#[async_trait::async_trait]
impl SessionCreations for NoSessionCreations {
    async fn created_by(&self, _session: Uuid) -> Result<Vec<super::models::CreatedItem>> {
        Ok(Vec::new())
    }
}

/// The agent session a code-mode request came from, by the invocation its
/// credential names. Object-safe for the same reason.
#[async_trait::async_trait]
pub trait RequestSessions: Send + Sync + 'static {
    /// The session behind `correlation`, if it still exists.
    async fn session_of(&self, correlation: Uuid) -> Result<Option<Uuid>>;
}

/// No code-mode requests reach this host.
pub struct NoRequestSessions;

#[async_trait::async_trait]
impl RequestSessions for NoRequestSessions {
    async fn session_of(&self, _correlation: Uuid) -> Result<Option<Uuid>> {
        Ok(None)
    }
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
        input: ActionConfiguration,
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
    pub fn cause(&self) -> trigger_context::origin::RoutineCause {
        use trigger_context::origin::RoutineCause;
        match self {
            Self::Scheduled { .. } => RoutineCause::Scheduled,
            Self::Manual { .. } => RoutineCause::Manual,
            Self::Event(run) => RoutineCause::Event {
                event_id: run.pending.event.event_id().into(),
            },
        }
    }

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

    /// The SDK reference for `symbols`, named as [`Self::reference`]'s
    /// entity indexes name them, with the types those references name, for
    /// whoever writes code that uses them: also the indexes of entities
    /// they belong to that `shown` doesn't hold, and which names the SDK
    /// doesn't have. Empty when there's nothing to say.
    fn symbol_references(&self, symbols: &[String], shown: &str) -> String {
        let _ = (symbols, shown);
        String::new()
    }

    /// Every area of the SDK, one line each: its name and when to use it.
    /// Empty when code can't run here.
    fn sdk_areas(&self) -> String {
        String::new()
    }

    /// The guidance and index of each SDK area `areas` names, as
    /// [`Self::sdk_areas`] names them; names it doesn't know are skipped.
    fn area_reference(&self, areas: &[String]) -> String {
        let _ = areas;
        String::new()
    }

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
    /// Who its writes are attributed to.
    pub acts_as: routine_program::CodeIdentity,
    /// The routine it belongs to, stamped on its credential so its writes
    /// never trigger routines.
    pub routine_id: macro_uuid::Uuid,
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
    /// How long it waited for a free slot, when that was a second or more.
    pub waited_ms: Option<u32>,
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
            waited_ms: None,
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

    fn symbol_references(&self, symbols: &[String], shown: &str) -> String {
        self.as_ref()
            .map(|code| code.symbol_references(symbols, shown))
            .unwrap_or_default()
    }

    fn sdk_areas(&self) -> String {
        self.as_ref().map(Code::sdk_areas).unwrap_or_default()
    }

    fn area_reference(&self, areas: &[String]) -> String {
        self.as_ref()
            .map(|code| code.area_reference(areas))
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
    /// Only code: no step reaches a model or agent.
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
    pub routine_name: String,
    /// The name of the routine it follows, when it is a sub-routine.
    pub parent_name: Option<String>,
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

/// Tells both observers, in order.
impl<First: RoutineRunObserver, Second: RoutineRunObserver> RoutineRunObserver for (First, Second) {
    fn run_finished(&self, run: FinishedRoutineRun) {
        self.0.run_finished(run.clone());
        self.1.run_finished(run);
    }
}
