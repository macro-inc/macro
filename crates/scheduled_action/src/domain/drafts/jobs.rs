//! Drafts that run in the background. Starting one answers once its usage is
//! admitted (the model is writing); the draft goes on in a task on the
//! replica that started it, reporting its progress to its row and to its
//! owner's open apps, and keeps its result on the row until its owner opens
//! or discards it. Any replica reads the row: a reload lists the owner's
//! jobs, and a cancel marks the row, which the drafter reads every poll, so
//! it stops wherever it runs. A job whose host stops is failed as
//! interrupted, by its drafter when the host shuts down, or by the sweep when
//! the host died.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use agent_session::domain::model::AgentSessionId;
use agent_session::domain::routines::RoutineSessions;
use anyhow::{Context as _, Result};
use bot_id::BotId;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use routine_program::Step;
use serde::{Deserialize, Serialize};
use tokio::sync::{oneshot, watch};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;
use utoipa::ToSchema;

use super::progress::{DraftJobProgress, DraftMilestone, DraftProgress};
use super::{
    DRAFT_TIMEOUT, Draft, DraftContext, DraftCreated, DraftRequest, Drafting, INTERRUPTED,
    RoutineDrafts, SWEEP_BATCH, TIMED_OUT, draft_span, failed, finish, stale_action,
};
use crate::domain::ports::{
    DraftJobStore, RoutineCode, RoutineDraftJobService, RoutineDraftUpdates, StaleDraft,
};

#[cfg(test)]
mod test;

/// The live message a background draft's progress reaches its owner in.
pub const ROUTINE_DRAFT_UPDATE_MESSAGE_TYPE: &str = "routine_draft_update";
/// Jobs one person may have drafting at once.
pub const MAX_DRAFTING: u32 = 3;
/// Jobs a list shows.
pub const LISTED: u16 = 20;
/// How long a job's drafter may run: its draft takes [`DRAFT_TIMEOUT`], and
/// one still going after this is stopped and its job failed as timed out.
pub const JOB_LIMIT: Duration = DRAFT_TIMEOUT.saturating_add(Duration::from_secs(60));
/// How long after it started a job still drafting has surely lost its
/// drafter: a live drafter finishes its job within [`JOB_LIMIT`].
pub const INTERRUPTED_AFTER: Duration = JOB_LIMIT.saturating_add(Duration::from_secs(60));
/// How long a finished job waits to be opened before the sweep deletes it.
pub const FINISHED_RETENTION: Duration = Duration::from_secs(7 * 24 * 60 * 60);
/// How many times a job's result is written before it is given up.
const RESULT_WRITES: u8 = 3;
/// How long the first rewrite of a result waits; each later one waits longer.
const RESULT_REWRITE_WAIT: Duration = Duration::from_millis(200);
/// What a job's result reads as when this build can't read it.
pub const UNREADABLE: &str = "Couldn’t open that draft. Please try again.";

/// Why a job can't be read or started.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum DraftJobError {
    /// No such job of the caller's.
    #[error("no such routine draft")]
    NotFound,
    /// The caller has [`MAX_DRAFTING`] jobs drafting already.
    #[error("{MAX_DRAFTING} routines are drafting already; wait for one to finish")]
    TooMany,
}

/// What starting a job's row found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Begun {
    /// The job started, drafting.
    Started,
    /// Its owner has a live job with its client id: the same start, sent
    /// again, began first.
    Repeated,
    /// Its owner has as many jobs drafting as it may.
    TooMany,
}

/// What kind of draft was asked for.
#[derive(
    Debug,
    Clone,
    Copy,
    Default,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    strum::AsRefStr,
    strum::IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum DraftKind {
    #[default]
    Routine,
    AddStep,
    ChangeStep,
}

/// What a job was asked to draft, as its owner reads it back: the kind of
/// request and the words they typed, nothing it was sent with them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DraftAsked {
    pub kind: DraftKind,
    /// The words they typed: the description, or the change asked for.
    pub description: String,
}

impl DraftAsked {
    fn of(request: &DraftRequest) -> Self {
        Self {
            kind: match request {
                DraftRequest::Routine { .. } => DraftKind::Routine,
                DraftRequest::AddStep { .. } => DraftKind::AddStep,
                DraftRequest::ChangeStep { .. } => DraftKind::ChangeStep,
            },
            description: request.text().trim().to_owned(),
        }
    }
}

/// Where a job is, as its row keeps it.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr, strum::EnumString, strum::IntoStaticStr,
)]
#[strum(serialize_all = "snake_case")]
pub enum DraftJobPhase {
    Drafting,
    Ready,
    Failed,
    Cancelled,
}

impl DraftJobPhase {
    /// The phase a job finished with `draft` is in.
    pub fn finished(draft: &Draft) -> Self {
        match draft {
            Draft::Failed { .. } => Self::Failed,
            Draft::Routine(_) | Draft::Step(_) => Self::Ready,
        }
    }
}

/// A background draft, as its owner reads it.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DraftJob {
    /// Its id: its hidden session's.
    pub id: Uuid,
    pub request: DraftAsked,
    pub progress: DraftJobProgress,
    pub created_at: DateTime<Utc>,
    #[serde(flatten)]
    pub state: DraftJobState,
}

/// Where a background draft is.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum DraftJobState {
    /// Still drafting; its progress says how far it got.
    Drafting,
    /// A routine or step to review before saving.
    Ready {
        draft: Draft,
        #[serde(rename = "finishedAt")]
        finished_at: DateTime<Utc>,
    },
    /// Why AI couldn't draft it, for the person, and anything it created
    /// before it gave up.
    Failed {
        message: String,
        created: Vec<DraftCreated>,
        #[serde(rename = "finishedAt")]
        finished_at: DateTime<Utc>,
    },
}

impl DraftJobState {
    /// Its name on the wire and on spans.
    pub fn name(&self) -> &'static str {
        match self {
            Self::Drafting => "drafting",
            Self::Ready { .. } => "ready",
            Self::Failed { .. } => "failed",
        }
    }
}

/// `job`, which a start sent again found, recorded on the start's span.
fn repeated(span: &tracing::Span, job: DraftJob) -> DraftJob {
    span.record("routine.draft.id", job.id.to_string());
    span.record("routine.draft.repeated", true);
    span.record("routine.draft.state", job.state.name());
    job
}

impl DraftJob {
    /// A job as its row keeps it: what was asked, its progress, its phase and
    /// its result. A finished job whose result this build can't read failed.
    pub fn stored(
        id: Uuid,
        request: DraftAsked,
        progress: DraftJobProgress,
        created_at: DateTime<Utc>,
        phase: DraftJobPhase,
        result: Option<Draft>,
        finished_at: Option<DateTime<Utc>>,
    ) -> Self {
        let finished_at = finished_at.unwrap_or(created_at);
        let state = match (phase, result) {
            (DraftJobPhase::Drafting, _) => DraftJobState::Drafting,
            (_, Some(Draft::Failed { message, created })) => DraftJobState::Failed {
                message,
                created,
                finished_at,
            },
            (_, Some(draft)) => DraftJobState::Ready { draft, finished_at },
            (_, None) => DraftJobState::Failed {
                message: UNREADABLE.to_owned(),
                created: Vec::new(),
                finished_at,
            },
        };
        Self {
            id,
            request,
            progress,
            created_at,
            state,
        }
    }
}

/// A job to start.
#[derive(Debug, Clone, PartialEq)]
pub struct NewDraftJob {
    pub session: Uuid,
    pub owner: MacroUserIdStr<'static>,
    /// The id the client gave the start: one live job per id and owner.
    pub client_id: Uuid,
    /// The agent whose session drafts it.
    pub agent: BotId,
    pub request: DraftAsked,
    pub progress: DraftJobProgress,
    pub created_at: DateTime<Utc>,
    /// The starting request's W3C trace context.
    pub traceparent: Option<String>,
}

/// What finishing a job found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Finished {
    /// It was drafting, and now keeps its result.
    Written,
    /// Its owner cancelled it first.
    Cancelled,
    /// It is gone, or the sweep failed it first.
    Gone,
}

/// A job its owner cancelled or discarded.
#[derive(Debug, Clone, PartialEq)]
pub struct CancelledJob {
    /// Whether it had finished: its drafter is done with it.
    pub finished: bool,
    pub agent: BotId,
    pub progress: DraftJobProgress,
    pub traceparent: Option<String>,
}

/// A job the sweep failed because its drafter was gone.
#[derive(Debug, Clone, PartialEq)]
pub struct InterruptedJob {
    pub draft: StaleDraft,
    pub progress: DraftJobProgress,
    pub traceparent: Option<String>,
}

/// How a background draft is going, for its owner's open apps.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DraftUpdate {
    pub draft_id: Uuid,
    pub state: DraftUpdateState,
    pub progress: DraftJobProgress,
}

/// Where a background draft is now; `removed` once cancelled or discarded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DraftUpdateState {
    Drafting,
    Ready,
    Failed,
    Removed,
}

impl DraftUpdateState {
    fn finished(draft: &Draft) -> Self {
        match DraftJobPhase::finished(draft) {
            DraftJobPhase::Failed => Self::Failed,
            _ => Self::Ready,
        }
    }
}

/// Runs background drafts with `drafts`, keeping them on `store` and pushing
/// their progress through `updates`, on `tasks` until `shutdown`.
pub struct DraftJobs<Code, Sessions, Updates> {
    drafts: Arc<RoutineDrafts<Code, Sessions>>,
    store: Arc<dyn DraftJobStore>,
    updates: Arc<Updates>,
    tasks: TaskTracker,
    shutdown: CancellationToken,
}

impl<Code, Sessions, Updates> Clone for DraftJobs<Code, Sessions, Updates> {
    fn clone(&self) -> Self {
        Self {
            drafts: Arc::clone(&self.drafts),
            store: Arc::clone(&self.store),
            updates: Arc::clone(&self.updates),
            tasks: self.tasks.clone(),
            shutdown: self.shutdown.clone(),
        }
    }
}

impl<Code, Sessions, Updates> DraftJobs<Code, Sessions, Updates> {
    /// Jobs run on `tasks`; `shutdown` interrupts them, and each ends with
    /// what it has.
    pub fn new(
        drafts: Arc<RoutineDrafts<Code, Sessions>>,
        store: Arc<dyn DraftJobStore>,
        updates: Arc<Updates>,
        tasks: TaskTracker,
        shutdown: CancellationToken,
    ) -> Self {
        Self {
            drafts,
            store,
            updates,
            tasks,
            shutdown,
        }
    }
}

/// What starting a job learns from it.
enum Admission {
    /// Its prompt was accepted: the model is writing.
    Writing(DraftJobProgress),
    /// Its usage was refused; it is gone.
    Refused(anyhow::Error),
    /// It finished before it was admitted, or was cancelled; its row says.
    Ended,
}

type Answer = Arc<Mutex<Option<oneshot::Sender<Admission>>>>;

/// Answer the request that started a job, once.
fn answer(answer: &Answer, admission: Admission) {
    let sender = answer.lock().ok().and_then(|mut sender| sender.take());
    if let Some(sender) = sender {
        // The request may be gone; the job goes on.
        let _ = sender.send(admission);
    }
}

/// A job's progress: kept for its writer, which writes and pushes it, and the
/// first time the draft is under way, the answer to its start.
struct JobProgress {
    progress: watch::Sender<DraftJobProgress>,
    answer: Answer,
}

impl DraftProgress for JobProgress {
    fn report(&self, milestone: DraftMilestone) {
        // A direct draft says so once its usage is admitted; a session draft
        // once its prompt is accepted. Either may skip ahead.
        let writing = matches!(
            milestone,
            DraftMilestone::Admitted | DraftMilestone::Found(_) | DraftMilestone::Writing
        );
        self.progress
            .send_modify(|progress| progress.reach(milestone));
        if writing {
            answer(
                &self.answer,
                Admission::Writing(self.progress.borrow().clone()),
            );
        }
    }
}

/// One background draft, as its task runs it.
struct Job<Code, Sessions, Updates> {
    drafts: Arc<RoutineDrafts<Code, Sessions>>,
    store: Arc<dyn DraftJobStore>,
    updates: Arc<Updates>,
    owner: MacroUserIdStr<'static>,
    session: AgentSessionId,
    request: DraftRequest,
    program: Vec<Step>,
    context: DraftContext,
    interrupt: CancellationToken,
    answer: Answer,
}

impl<Code: RoutineCode, Sessions: RoutineSessions, Updates: RoutineDraftUpdates>
    Job<Code, Sessions, Updates>
{
    async fn run(self) {
        let Self {
            drafts,
            store,
            updates,
            owner,
            session,
            request,
            program,
            context,
            interrupt,
            answer: answered,
        } = self;
        let id = session.as_uuid();
        let (progress, watching) = watch::channel(DraftJobProgress::default());
        let reporter = JobProgress {
            progress,
            answer: Arc::clone(&answered),
        };
        let drafting = async {
            // Dropped once the draft is done, which ends the writer.
            let reporter = reporter;
            if let Some(direct) = &drafts.direct {
                let run = super::DirectRun {
                    id,
                    progress: &reporter,
                    cancellable: true,
                    interrupt,
                };
                return drafts
                    .direct_draft(direct, &owner, &request, &program, &context, run)
                    .await;
            }
            let brief = match drafts.briefed(&owner, &request, &program, &context) {
                Ok(brief) => brief,
                Err(message) => return Ok(Some(failed(message))),
            };
            drafts
                .drafted(
                    &owner,
                    &request,
                    &program,
                    &context,
                    brief,
                    Drafting {
                        session,
                        progress: &reporter,
                        interrupt,
                        keeps: true,
                    },
                )
                .await
        };
        // A drafter stuck past its own timeout still finishes its job:
        // dropping it stops its session.
        let limited = async {
            tokio::time::timeout(JOB_LIMIT, drafting)
                .await
                .unwrap_or_else(|_| {
                    tracing::warn!("a routine draft ran past its limit; failing it as timed out");
                    Ok(Some(failed(TIMED_OUT)))
                })
        };
        let (outcome, progress) = tokio::join!(
            limited,
            write_progress(store.as_ref(), updates.as_ref(), &owner, id, watching)
        );
        let action = drafts.action(&owner, session);
        match outcome {
            // Its outcome is recorded once, from what finishing it found.
            Ok(Some(draft)) => match write_result(store.as_ref(), id, &draft).await {
                Ok(Finished::Written) => {
                    let draft = finish(draft);
                    updates
                        .publish_draft(
                            &owner,
                            DraftUpdate {
                                draft_id: id,
                                state: DraftUpdateState::finished(&draft),
                                progress,
                            },
                        )
                        .await;
                }
                // Cancelled while it read its result: no one will.
                Ok(Finished::Cancelled) => {
                    tracing::Span::current().record("routine.draft.outcome", "cancelled");
                    drafts.forget_draft(&action, true).await;
                    // Its last word: progress it sent can land after the
                    // cancel's.
                    updates.publish_draft(&owner, removed(id, progress)).await;
                }
                Ok(Finished::Gone) => {
                    finish(draft);
                }
                // Still drafting on its row after every write: the sweep
                // fails it.
                Err(error) => {
                    finish(draft);
                    tracing::error!(error = ?error, "could not finish a routine draft");
                }
            },
            // Cancelled: the drafter deleted its session and row. Its last
            // word, as progress it sent can land after the cancel's.
            Ok(None) => {
                updates.publish_draft(&owner, removed(id, progress)).await;
            }
            // Its usage was refused: it never was.
            Err(error) => {
                drafts.forget_draft(&action, true).await;
                // Its start still waits, unless it was admitted first.
                let waiting = answered.lock().is_ok_and(|sender| sender.is_some());
                if waiting {
                    answer(&answered, Admission::Refused(error));
                } else {
                    tracing::error!(error = ?error, "a routine draft failed after it started");
                }
                // Whoever holds it hears it is gone: a start sent again
                // answers with it drafting while the first start waits.
                updates.publish_draft(&owner, removed(id, progress)).await;
            }
        }
        answer(&answered, Admission::Ended);
    }
}

/// Write `draft` as job `id`'s result, up to [`RESULT_WRITES`] times, so one
/// failed write doesn't lose it.
async fn write_result(store: &dyn DraftJobStore, id: Uuid, draft: &Draft) -> Result<Finished> {
    let mut writes = 1;
    loop {
        match store.finish_job(id, draft).await {
            Err(error) if writes < RESULT_WRITES => {
                tracing::warn!(error = ?error, writes, "could not keep a routine draft's result; trying again");
                tokio::time::sleep(RESULT_REWRITE_WAIT * u32::from(writes)).await;
                writes += 1;
            }
            finished => return finished,
        }
    }
}

/// Job `id` is gone: cancelled, discarded or never admitted.
fn removed(id: Uuid, progress: DraftJobProgress) -> DraftUpdate {
    DraftUpdate {
        draft_id: id,
        state: DraftUpdateState::Removed,
        progress,
    }
}

/// Write each new progress of job `id` to its row and push it to `owner`,
/// until the drafter is done. Reports that arrive while one is written are
/// folded into the next. The last progress.
async fn write_progress(
    store: &dyn DraftJobStore,
    updates: &impl RoutineDraftUpdates,
    owner: &MacroUserIdStr<'static>,
    id: Uuid,
    mut watching: watch::Receiver<DraftJobProgress>,
) -> DraftJobProgress {
    while watching.changed().await.is_ok() {
        let progress = watching.borrow_and_update().clone();
        match store.progress(id, &progress).await {
            Ok(true) => {
                updates
                    .publish_draft(
                        owner,
                        DraftUpdate {
                            draft_id: id,
                            state: DraftUpdateState::Drafting,
                            progress,
                        },
                    )
                    .await;
            }
            // Cancelled: nobody is watching.
            Ok(false) => {}
            Err(error) => {
                tracing::warn!(error = ?error, "could not keep a routine draft's progress");
            }
        }
    }
    watching.borrow().clone()
}

impl<Code: RoutineCode, Sessions: RoutineSessions, Updates: RoutineDraftUpdates>
    RoutineDraftJobService for DraftJobs<Code, Sessions, Updates>
{
    #[tracing::instrument(name = "routine.draft.start", skip_all, fields(
        routine.draft.kind = request.kind_name(),
        routine.draft.id = tracing::field::Empty,
        routine.draft.state = tracing::field::Empty,
        routine.draft.repeated = tracing::field::Empty,
    ), err)]
    async fn start(
        &self,
        owner: MacroUserIdStr<'static>,
        client_id: Uuid,
        request: DraftRequest,
        context: DraftContext,
        traceparent: Option<String>,
    ) -> Result<DraftJob> {
        let (program, context) = self.drafts.read_request(&request, context)?;
        // The rest runs on the jobs' tasks, so a request dropped while its
        // row is written can't leave the row without its drafter.
        let jobs = self.clone();
        self.tasks
            .spawn(
                async move {
                    jobs.begin(owner, client_id, request, program, context, traceparent)
                        .await
                }
                .in_current_span(),
            )
            .await
            .context("start a background routine draft")?
    }

    async fn jobs(&self, owner: MacroUserIdStr<'static>) -> Result<Vec<DraftJob>> {
        self.store.jobs(&owner, LISTED).await
    }

    async fn job(&self, owner: MacroUserIdStr<'static>, id: Uuid) -> Result<DraftJob> {
        Ok(self
            .store
            .job(&owner, id)
            .await?
            .ok_or(DraftJobError::NotFound)?)
    }

    // The span records the draft and how the cancel went, and the trace the
    // draft started in, so the two can be found together.
    #[tracing::instrument(name = "routine.draft.cancel", skip_all, fields(
        routine.draft.id = %id,
        routine.draft.state = tracing::field::Empty,
        routine.draft.outcome = tracing::field::Empty,
        routine.draft.start_traceparent = tracing::field::Empty,
    ), err)]
    async fn discard(&self, owner: MacroUserIdStr<'static>, id: Uuid) -> Result<()> {
        let span = tracing::Span::current();
        let Some(cancelled) = self.store.cancel_job(&owner, id).await? else {
            span.record("routine.draft.outcome", "not_found");
            anyhow::bail!(DraftJobError::NotFound);
        };
        if let Some(traceparent) = &cancelled.traceparent {
            span.record("routine.draft.start_traceparent", traceparent.as_str());
        }
        if cancelled.finished {
            span.record("routine.draft.state", "finished");
            span.record("routine.draft.outcome", "discarded");
            self.drafts
                .forget_draft(
                    &stale_action(&StaleDraft {
                        session: id,
                        owner: owner.clone(),
                        agent: cancelled.agent,
                    }),
                    true,
                )
                .await;
        } else {
            // Its drafter, on whichever replica, stops at its next read of
            // the row and deletes the session and the row; the sweep does
            // when the drafter is gone.
            span.record("routine.draft.state", "drafting");
            span.record("routine.draft.outcome", "cancelled");
        }
        self.updates
            .publish_draft(&owner, removed(id, cancelled.progress))
            .await;
        Ok(())
    }
}

impl<Code: RoutineCode, Sessions: RoutineSessions, Updates: RoutineDraftUpdates>
    DraftJobs<Code, Sessions, Updates>
{
    /// Start's body, from writing the job's row to its admission, in the
    /// start's span: the row, the drafter and the answer to the start.
    async fn begin(
        &self,
        owner: MacroUserIdStr<'static>,
        client_id: Uuid,
        request: DraftRequest,
        program: Vec<Step>,
        context: DraftContext,
        traceparent: Option<String>,
    ) -> Result<DraftJob> {
        let started = tracing::Span::current();
        let session = AgentSessionId::new();
        let id = session.as_uuid();
        let job = NewDraftJob {
            session: id,
            owner: owner.clone(),
            client_id,
            agent: self.drafts.agent.bot,
            request: DraftAsked::of(&request),
            progress: DraftJobProgress::default(),
            created_at: Utc::now(),
            traceparent,
        };
        // Jobs drafting longer than this have lost their drafter, and
        // don't count against the limit.
        let since = job.created_at - chrono::Duration::from_std(INTERRUPTED_AFTER)?;
        match self.store.begin_job(&job, MAX_DRAFTING, since).await? {
            Begun::Started => {}
            Begun::Repeated => {
                // A start sent again, as a client does when its connection
                // drops, answers with the job the first one started.
                let job = self
                    .store
                    .started(&owner, client_id)
                    .await?
                    .ok_or(DraftJobError::NotFound)?;
                return Ok(repeated(&started, job));
            }
            Begun::TooMany => anyhow::bail!(DraftJobError::TooMany),
        }
        started.record("routine.draft.id", id.to_string());
        started.record("routine.draft.repeated", false);
        // The job's span is this request's child, so the whole draft is one
        // trace however long it outlives the request.
        let span = draft_span(&request);
        span.record("routine.draft.background", true);
        let (admitted, admission) = oneshot::channel();
        let answered: Answer = Arc::new(Mutex::new(Some(admitted)));
        self.tasks.spawn(
            Job {
                drafts: Arc::clone(&self.drafts),
                store: Arc::clone(&self.store),
                updates: Arc::clone(&self.updates),
                owner: owner.clone(),
                session,
                request,
                program,
                context,
                interrupt: self.shutdown.child_token(),
                answer: answered,
            }
            .run()
            .instrument(span),
        );
        let job = match admission.await {
            Ok(Admission::Writing(progress)) => DraftJob {
                id,
                request: job.request,
                progress,
                created_at: job.created_at,
                state: DraftJobState::Drafting,
            },
            Ok(Admission::Refused(error)) => return Err(error),
            Ok(Admission::Ended) | Err(_) => self
                .store
                .job(&owner, id)
                .await?
                .ok_or(DraftJobError::NotFound)?,
        };
        started.record("routine.draft.state", job.state.name());
        Ok(job)
    }

    /// Fail jobs whose drafter is gone, telling their owners, and stop their
    /// sessions; delete cancelled jobs nobody cleaned up, and finished jobs
    /// never opened within [`FINISHED_RETENTION`], with their sessions. How
    /// many it handled.
    #[tracing::instrument(name = "routine.draft.jobs.sweep", skip_all, fields(
        routine.draft.interrupted = tracing::field::Empty,
        routine.draft.abandoned = tracing::field::Empty,
        routine.draft.expired = tracing::field::Empty,
    ), err)]
    pub async fn sweep(&self) -> Result<usize> {
        let span = tracing::Span::current();
        let now = Utc::now();
        let interrupted = self
            .store
            .interrupt(
                now - chrono::Duration::from_std(INTERRUPTED_AFTER)?,
                &failed(INTERRUPTED),
                SWEEP_BATCH,
            )
            .await?;
        span.record("routine.draft.interrupted", interrupted.len());
        for job in &interrupted {
            let interrupted = tracing::info_span!(
                "routine.draft.interrupt",
                routine.draft.id = %job.draft.session,
                routine.draft.start_traceparent = job.traceparent.as_deref(),
            );
            async {
                self.updates
                    .publish_draft(
                        &job.draft.owner,
                        DraftUpdate {
                            draft_id: job.draft.session,
                            state: DraftUpdateState::Failed,
                            progress: job.progress.clone(),
                        },
                    )
                    .await;
                // Kept with its row, which its owner opens or discards.
                self.drafts.stop_draft(&stale_action(&job.draft)).await;
            }
            .instrument(interrupted)
            .await;
        }
        let abandoned = self
            .store
            .abandoned(
                now - chrono::Duration::from_std(INTERRUPTED_AFTER)?,
                SWEEP_BATCH,
            )
            .await?;
        span.record("routine.draft.abandoned", abandoned.len());
        for draft in &abandoned {
            self.drafts.forget_draft(&stale_action(draft), false).await;
        }
        let expired = self
            .store
            .expired(
                now - chrono::Duration::from_std(FINISHED_RETENTION)?,
                SWEEP_BATCH,
            )
            .await?;
        span.record("routine.draft.expired", expired.len());
        for draft in &expired {
            self.drafts.forget_draft(&stale_action(draft), true).await;
        }
        Ok(interrupted.len() + abandoned.len() + expired.len())
    }
}
