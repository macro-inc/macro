use std::sync::Mutex;

use agent_session::domain::routines::RoutineSessionError;
use ai_billing::AiAdmissionError;
use chrono::DateTime;
use serde_json::json;

use super::super::test::{
    BUG_REPORTS, JobRow, Rows, Sessions, add, agent_step, code_step, configuration, context,
    drafts, message_posted, owner, plain, routine,
};
use super::super::{ACTIVITY_SETTLE, InvalidDraft, POLL};
use super::*;
use crate::domain::code_check::test::Checker;
use crate::domain::drafts::progress::DraftStage;
use crate::domain::ports::{DraftHandBacks, StaleDraft};

#[async_trait::async_trait]
impl DraftJobStore for Rows {
    async fn begin_job(&self, job: &NewDraftJob) -> Result<bool> {
        if self.live(&job.owner, job.client_id).is_some() {
            return Ok(false);
        }
        self.drafts.lock().unwrap().insert(
            job.session,
            (
                job.owner.clone(),
                job.agent,
                Default::default(),
                job.created_at,
            ),
        );
        self.jobs.lock().unwrap().insert(
            job.session,
            JobRow {
                client_id: job.client_id,
                phase: DraftJobPhase::Drafting,
                request: job.request.clone(),
                progress: job.progress.clone(),
                result: None,
                finished_at: None,
                traceparent: job.traceparent.clone(),
            },
        );
        Ok(true)
    }

    async fn started(
        &self,
        owner: &MacroUserIdStr<'static>,
        client_id: Uuid,
    ) -> Result<Option<DraftJob>> {
        Ok(self
            .live(owner, client_id)
            .and_then(|session| self.read(session)))
    }

    async fn drafting(&self, owner: &MacroUserIdStr<'static>) -> Result<u32> {
        let drafts = self.drafts.lock().unwrap();
        Ok(self
            .jobs
            .lock()
            .unwrap()
            .iter()
            .filter(|(session, job)| {
                job.phase == DraftJobPhase::Drafting
                    && drafts.get(session).is_some_and(|draft| draft.0 == *owner)
            })
            .count() as u32)
    }

    async fn progress(&self, session: Uuid, progress: &DraftJobProgress) -> Result<bool> {
        Ok(match self.jobs.lock().unwrap().get_mut(&session) {
            Some(job) if job.phase == DraftJobPhase::Drafting => {
                job.progress = progress.clone();
                true
            }
            _ => false,
        })
    }

    async fn finish_job(&self, session: Uuid, draft: &Draft) -> Result<Finished> {
        Ok(match self.jobs.lock().unwrap().get_mut(&session) {
            Some(job) if job.phase == DraftJobPhase::Drafting => {
                job.phase = DraftJobPhase::finished(draft);
                job.result = Some(draft.clone());
                job.finished_at = Some(Utc::now());
                Finished::Written
            }
            Some(job) if job.phase == DraftJobPhase::Cancelled => Finished::Cancelled,
            _ => Finished::Gone,
        })
    }

    async fn jobs(&self, owner: &MacroUserIdStr<'static>, limit: u16) -> Result<Vec<DraftJob>> {
        let mine: Vec<Uuid> = self
            .drafts
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, (by, ..))| by == owner)
            .map(|(session, _)| *session)
            .collect();
        let mut jobs: Vec<DraftJob> = mine.into_iter().filter_map(|id| self.read(id)).collect();
        jobs.sort_by_key(|job| std::cmp::Reverse(job.created_at));
        jobs.truncate(usize::from(limit));
        Ok(jobs)
    }

    async fn job(&self, owner: &MacroUserIdStr<'static>, session: Uuid) -> Result<Option<DraftJob>> {
        let mine = self
            .drafts
            .lock()
            .unwrap()
            .get(&session)
            .is_some_and(|(by, ..)| by == owner);
        Ok(if mine { self.read(session) } else { None })
    }

    async fn cancel_job(
        &self,
        owner: &MacroUserIdStr<'static>,
        session: Uuid,
    ) -> Result<Option<CancelledJob>> {
        let drafts = self.drafts.lock().unwrap();
        let Some((by, agent, ..)) = drafts.get(&session) else {
            return Ok(None);
        };
        let mut jobs = self.jobs.lock().unwrap();
        Ok(match jobs.get_mut(&session) {
            Some(job) if by == owner && job.phase != DraftJobPhase::Cancelled => {
                job.phase = DraftJobPhase::Cancelled;
                Some(CancelledJob {
                    finished: job.finished_at.is_some(),
                    agent: *agent,
                    progress: job.progress.clone(),
                    traceparent: job.traceparent.clone(),
                })
            }
            _ => None,
        })
    }

    async fn interrupt(
        &self,
        before: DateTime<Utc>,
        draft: &Draft,
        _limit: u16,
    ) -> Result<Vec<InterruptedJob>> {
        let drafts = self.drafts.lock().unwrap();
        let mut interrupted = Vec::new();
        for (session, job) in self.jobs.lock().unwrap().iter_mut() {
            let Some((owner, agent, _, started)) = drafts.get(session) else {
                continue;
            };
            if job.phase == DraftJobPhase::Drafting && *started < before {
                job.phase = DraftJobPhase::finished(draft);
                job.result = Some(draft.clone());
                job.finished_at = Some(Utc::now());
                interrupted.push(InterruptedJob {
                    draft: StaleDraft {
                        session: *session,
                        owner: owner.clone(),
                        agent: *agent,
                    },
                    progress: job.progress.clone(),
                    traceparent: job.traceparent.clone(),
                });
            }
        }
        Ok(interrupted)
    }

    async fn abandoned(&self, before: DateTime<Utc>, _limit: u16) -> Result<Vec<StaleDraft>> {
        Ok(self.matching(|job, started| {
            job.phase == DraftJobPhase::Cancelled && started < before
        }))
    }

    async fn expired(&self, before: DateTime<Utc>, _limit: u16) -> Result<Vec<StaleDraft>> {
        Ok(self.matching(|job, _| {
            matches!(job.phase, DraftJobPhase::Ready | DraftJobPhase::Failed)
                && job.finished_at.is_some_and(|finished| finished < before)
        }))
    }
}

impl Rows {
    /// `owner`'s live job the start with `client_id` began.
    fn live(&self, owner: &MacroUserIdStr<'static>, client_id: Uuid) -> Option<Uuid> {
        let drafts = self.drafts.lock().unwrap();
        self.jobs
            .lock()
            .unwrap()
            .iter()
            .find(|(session, job)| {
                job.client_id == client_id
                    && job.phase != DraftJobPhase::Cancelled
                    && drafts.get(*session).is_some_and(|(by, ..)| by == owner)
            })
            .map(|(session, _)| *session)
    }

    /// Job `session` as its owner reads it.
    fn read(&self, session: Uuid) -> Option<DraftJob> {
        let started = self.drafts.lock().unwrap().get(&session)?.3;
        let job = self.jobs.lock().unwrap().get(&session)?.clone();
        (job.phase != DraftJobPhase::Cancelled).then(|| {
            DraftJob::stored(
                session,
                job.request,
                job.progress,
                started,
                job.phase,
                job.result,
                job.finished_at,
            )
        })
    }

    fn matching(&self, keep: impl Fn(&JobRow, DateTime<Utc>) -> bool) -> Vec<StaleDraft> {
        let drafts = self.drafts.lock().unwrap();
        self.jobs
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(session, job)| {
                let (owner, agent, _, started) = drafts.get(session)?;
                keep(job, *started).then(|| StaleDraft {
                    session: *session,
                    owner: owner.clone(),
                    agent: *agent,
                })
            })
            .collect()
    }

    fn phase(&self, session: Uuid) -> Option<DraftJobPhase> {
        self.jobs.lock().unwrap().get(&session).map(|job| job.phase)
    }
}

/// What reached the owners' open apps.
#[derive(Default)]
struct Published(Mutex<Vec<(MacroUserIdStr<'static>, DraftUpdate)>>);

impl RoutineDraftUpdates for Published {
    async fn publish_draft(&self, owner: &MacroUserIdStr<'static>, update: DraftUpdate) {
        self.0.lock().unwrap().push((owner.clone(), update));
    }
}

impl Published {
    fn of(&self, id: Uuid) -> Vec<DraftUpdate> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, update)| update.draft_id == id)
            .map(|(_, update)| update.clone())
            .collect()
    }
}

/// A replica's background drafts, over the shared rows.
struct Replica {
    jobs: DraftJobs<Checker, Sessions, Published>,
    published: Arc<Published>,
    tasks: TaskTracker,
    shutdown: CancellationToken,
}

impl Replica {
    fn new(rows: &Arc<Rows>, sessions: &Arc<Sessions>) -> Self {
        let published = Arc::new(Published::default());
        let (tasks, shutdown) = (TaskTracker::new(), CancellationToken::new());
        Self {
            jobs: DraftJobs::new(
                Arc::new(drafts(rows, sessions)),
                Arc::clone(rows) as Arc<dyn DraftJobStore>,
                Arc::clone(&published),
                tasks.clone(),
                shutdown.clone(),
            ),
            published,
            tasks,
            shutdown,
        }
    }

    /// Start `request` as a new start.
    async fn start(&self, request: DraftRequest) -> Result<DraftJob> {
        self.start_as(macro_uuid::generate_uuid_v7(), request).await
    }

    /// Start `request` as the start the client gave `client_id`.
    async fn start_as(&self, client_id: Uuid, request: DraftRequest) -> Result<DraftJob> {
        self.jobs
            .start(
                owner(),
                client_id,
                request,
                context(),
                Some(TRACEPARENT.into()),
            )
            .await
    }

    /// Wait for every job this replica runs to finish.
    async fn settled(&self) {
        self.tasks.close();
        self.tasks.wait().await;
        self.tasks.reopen();
    }
}

const TRACEPARENT: &str = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

fn stranger() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|stranger@example.com").unwrap()
}

/// A session whose turn checks `steps` once, then keeps running.
fn checks_and_runs(rows: &Arc<Rows>, steps: serde_json::Value) -> Arc<Sessions> {
    let mut sessions = Sessions::new(
        rows,
        Box::new(move |_| {
            vec![plain(configuration(
                "Bug tasks",
                message_posted(&[]),
                steps.clone(),
            ))]
        }),
    );
    sessions.hangs = true;
    Arc::new(sessions)
}

fn hangs(rows: &Arc<Rows>) -> Arc<Sessions> {
    let mut sessions = Sessions::new(rows, Box::new(|_| Vec::new()));
    sessions.hangs = true;
    Arc::new(sessions)
}

/// Starting answers once the model writes, long before the draft is done,
/// which goes on in the background with its row drafting.
#[tokio::test(start_paused = true)]
async fn starting_answers_at_once_and_drafts_in_the_background() {
    let rows = Arc::new(Rows::default());
    let sessions = hangs(&rows);
    let replica = Replica::new(&rows, &sessions);

    let started = tokio::time::Instant::now();
    let job = replica.start(routine(BUG_REPORTS)).await.unwrap();

    assert!(started.elapsed() < POLL, "{:?}", started.elapsed());
    assert_eq!(job.state, DraftJobState::Drafting);
    assert_eq!(job.progress.stage, DraftStage::Writing);
    assert_eq!(
        job.request,
        DraftAsked {
            kind: DraftKind::Routine,
            description: BUG_REPORTS.into(),
        }
    );
    // Its id is its hidden session's, still running.
    let session = sessions.prepared.lock().unwrap()[0].session_id;
    assert_eq!(job.id, session.as_uuid());
    assert!(sessions.cancelled.lock().unwrap().is_empty());
    assert_eq!(rows.phase(job.id), Some(DraftJobPhase::Drafting));
    assert_eq!(
        rows.jobs.lock().unwrap()[&job.id].traceparent.as_deref(),
        Some(TRACEPARENT)
    );
    assert!(!replica.tasks.is_empty());
    let wire = serde_json::to_value(&job).unwrap();
    assert_eq!(wire["state"], "drafting");
    assert_eq!(wire["request"]["kind"], "routine");
    assert!(wire["createdAt"].is_string(), "{wire}");

    // A reload, here or on any replica, reads it from its row.
    let other = Replica::new(&rows, &sessions);
    assert_eq!(
        other.jobs.jobs(owner()).await.unwrap()[0].state,
        DraftJobState::Drafting
    );
    // It times out like any draft: the last check, or why it failed.
    replica.settled().await;
    assert!(started.elapsed() >= DRAFT_TIMEOUT - ACTIVITY_SETTLE);
    assert!(matches!(
        replica.jobs.job(owner(), job.id).await.unwrap().state,
        DraftJobState::Failed { .. }
    ));
}

/// Each milestone reaches the row and the owner's apps, a fixing draft's
/// failed check included, and the result follows.
#[tokio::test(start_paused = true)]
async fn progress_reaches_the_row_and_the_owner() {
    let rows = Arc::new(Rows::default());
    // Its check fails, and the model goes on fixing it.
    let sessions = checks_and_runs(&rows, json!([code_step("Make a task", "bad")]));
    let replica = Replica::new(&rows, &sessions);

    let job = replica.start(routine(BUG_REPORTS)).await.unwrap();
    tokio::time::sleep(POLL * 2).await;

    let progress = rows.jobs.lock().unwrap()[&job.id].progress.clone();
    assert_eq!(progress.stage, DraftStage::Fixing);
    let check = progress.check.unwrap();
    assert_eq!((check.checks, check.ok, check.problems), (1, false, 1));
    assert_eq!(check.name, "Bug tasks");
    assert_eq!(check.steps[0].title, "Make a task");
    let published = replica.published.of(job.id);
    assert_eq!(
        published
            .iter()
            .map(|update| (update.state, update.progress.stage))
            .collect::<Vec<_>>(),
        [
            (DraftUpdateState::Drafting, DraftStage::Writing),
            (DraftUpdateState::Drafting, DraftStage::Fixing),
        ]
    );
    let wire = serde_json::to_value(published.last().unwrap()).unwrap();
    assert_eq!(wire["draftId"], json!(job.id));
    assert_eq!(wire["state"], "drafting");
    assert_eq!(wire["progress"]["check"]["problems"], 1);
    // Code never goes out with progress.
    assert!(!wire.to_string().contains("\"bad\""), "{wire}");

    replica.settled().await;
    let finished = replica.published.of(job.id);
    let last = finished.last().unwrap();
    assert_eq!(last.state, DraftUpdateState::Ready);
    assert_eq!(last.progress.stage, DraftStage::Fixing);
}

/// A check that passes makes the draft ready: it is read until discarded,
/// and only by its owner.
#[tokio::test(start_paused = true)]
async fn a_ready_draft_is_readable_until_its_owner_discards_it() {
    let rows = Arc::new(Rows::default());
    let sessions = checks_and_runs(&rows, json!([code_step("Make a task", "good")]));
    let replica = Replica::new(&rows, &sessions);

    let job = replica.start(routine(BUG_REPORTS)).await.unwrap();
    replica.settled().await;

    let ready = replica.jobs.job(owner(), job.id).await.unwrap();
    let DraftJobState::Ready { draft, .. } = &ready.state else {
        panic!("expected a ready draft, got {ready:?}");
    };
    let Draft::Routine(routine) = draft else {
        panic!("expected a routine, got {draft:?}");
    };
    assert_eq!(routine.name, "Bug tasks");
    assert_eq!(ready.progress.stage, DraftStage::Checked);
    let wire = serde_json::to_value(&ready).unwrap();
    assert_eq!(wire["state"], "ready");
    assert_eq!(wire["draft"]["outcome"], "routine");
    assert!(wire["finishedAt"].is_string(), "{wire}");
    assert_eq!(
        replica.published.of(job.id).last().unwrap().state,
        DraftUpdateState::Ready
    );
    // Stopped, but kept with its row until it is opened.
    let session = AgentSessionId::new_from_uuid(job.id);
    assert_eq!(*sessions.cancelled.lock().unwrap(), [session]);
    assert!(sessions.deleted.lock().unwrap().is_empty());
    assert_eq!(replica.jobs.jobs(owner()).await.unwrap(), [ready]);

    // Nobody else reads or discards it.
    let error = replica.jobs.job(stranger(), job.id).await.unwrap_err();
    assert_eq!(
        error.downcast_ref::<DraftJobError>(),
        Some(&DraftJobError::NotFound)
    );
    assert!(replica.jobs.jobs(stranger()).await.unwrap().is_empty());
    let error = replica.jobs.discard(stranger(), job.id).await.unwrap_err();
    assert_eq!(
        error.downcast_ref::<DraftJobError>(),
        Some(&DraftJobError::NotFound)
    );

    replica.jobs.discard(owner(), job.id).await.unwrap();

    assert_eq!(*sessions.deleted.lock().unwrap(), [session]);
    assert!(rows.drafts.lock().unwrap().is_empty());
    assert!(replica.jobs.jobs(owner()).await.unwrap().is_empty());
    assert_eq!(
        replica.published.of(job.id).last().unwrap().state,
        DraftUpdateState::Removed
    );
    // Gone: discarding again finds nothing.
    assert!(replica.jobs.discard(owner(), job.id).await.is_err());
}

/// A start sent again, as the client sends it when its connection drops,
/// answers with the job the first began, on any replica and even once it is
/// ready, and starts no second session. Discarded, the same id starts
/// afresh.
#[tokio::test(start_paused = true)]
async fn a_start_sent_again_answers_with_the_same_job() {
    let rows = Arc::new(Rows::default());
    let sessions = checks_and_runs(&rows, json!([code_step("Make a task", "good")]));
    let replica = Replica::new(&rows, &sessions);
    let other = Replica::new(&rows, &sessions);
    let client_id = macro_uuid::generate_uuid_v7();

    let job = replica.start_as(client_id, routine(BUG_REPORTS)).await.unwrap();
    let again = other.start_as(client_id, routine(BUG_REPORTS)).await.unwrap();

    assert_eq!(again.id, job.id);
    assert_eq!(again.state, DraftJobState::Drafting);
    assert_eq!(sessions.prepared.lock().unwrap().len(), 1);
    assert_eq!(rows.jobs.lock().unwrap().len(), 1);

    replica.settled().await;
    let ready = replica.start_as(client_id, routine(BUG_REPORTS)).await.unwrap();
    assert_eq!(ready.id, job.id);
    assert!(matches!(ready.state, DraftJobState::Ready { .. }), "{ready:?}");
    assert_eq!(sessions.prepared.lock().unwrap().len(), 1);

    // Someone else's start with the same id is theirs.
    let theirs = replica
        .jobs
        .start(stranger(), client_id, routine(BUG_REPORTS), context(), None)
        .await
        .unwrap();
    assert_ne!(theirs.id, job.id);

    replica.jobs.discard(owner(), job.id).await.unwrap();
    let fresh = replica.start_as(client_id, routine(BUG_REPORTS)).await.unwrap();
    assert_ne!(fresh.id, job.id);
}

/// At the drafting limit, a start sent again still finds its job.
#[tokio::test(start_paused = true)]
async fn a_start_sent_again_at_the_limit_finds_its_job() {
    let rows = Arc::new(Rows::default());
    let sessions = hangs(&rows);
    let replica = Replica::new(&rows, &sessions);
    for _ in 1..MAX_DRAFTING {
        replica.start(routine(BUG_REPORTS)).await.unwrap();
    }
    let client_id = macro_uuid::generate_uuid_v7();
    let job = replica.start_as(client_id, routine(BUG_REPORTS)).await.unwrap();

    let again = replica.start_as(client_id, routine(BUG_REPORTS)).await.unwrap();

    assert_eq!(again.id, job.id);
    assert_eq!(
        sessions.prepared.lock().unwrap().len() as u32,
        MAX_DRAFTING
    );
}

/// A cancel on any replica marks the row; the drafter, wherever it runs,
/// stops at its next read of it and deletes the session and the row.
#[tokio::test(start_paused = true)]
async fn a_cancel_from_another_replica_stops_the_drafter() {
    let rows = Arc::new(Rows::default());
    let sessions = hangs(&rows);
    let drafting = Replica::new(&rows, &sessions);
    let other = Replica::new(&rows, &sessions);

    let job = drafting.start(routine(BUG_REPORTS)).await.unwrap();
    tokio::time::sleep(Duration::from_secs(5)).await;
    let cancelled_at = tokio::time::Instant::now();
    other.jobs.discard(owner(), job.id).await.unwrap();

    // Hidden at once from every list.
    assert!(drafting.jobs.jobs(owner()).await.unwrap().is_empty());
    assert_eq!(
        other.published.of(job.id).last().unwrap().state,
        DraftUpdateState::Removed
    );
    sessions.deletes.notified().await;
    assert!(cancelled_at.elapsed() <= POLL, "{:?}", cancelled_at.elapsed());
    let session = AgentSessionId::new_from_uuid(job.id);
    assert_eq!(*sessions.cancelled.lock().unwrap(), [session]);
    assert_eq!(*sessions.deleted.lock().unwrap(), [session]);
    drafting.settled().await;
    assert!(rows.drafts.lock().unwrap().is_empty());
    assert!(rows.jobs.lock().unwrap().is_empty());
    // It never publishes a result nobody wants.
    assert!(
        drafting
            .published
            .of(job.id)
            .iter()
            .all(|update| update.state == DraftUpdateState::Drafting)
    );
}

/// A host that stops ends its drafts within the shutdown's time, failed as
/// interrupted, which its owner reads from any replica.
#[tokio::test(start_paused = true)]
async fn shutdown_fails_running_drafts_as_interrupted() {
    let rows = Arc::new(Rows::default());
    let sessions = hangs(&rows);
    let replica = Replica::new(&rows, &sessions);
    let job = replica.start(routine(BUG_REPORTS)).await.unwrap();
    tokio::time::sleep(Duration::from_secs(3)).await;

    let stopping = tokio::time::Instant::now();
    replica.shutdown.cancel();
    replica.settled().await;

    // Well within the harness's eight seconds to shut down.
    assert!(
        stopping.elapsed() <= ACTIVITY_SETTLE + POLL,
        "{:?}",
        stopping.elapsed()
    );
    let other = Replica::new(&rows, &sessions);
    let interrupted = other.jobs.job(owner(), job.id).await.unwrap();
    let DraftJobState::Failed { message, .. } = &interrupted.state else {
        panic!("expected a failed draft, got {interrupted:?}");
    };
    assert_eq!(message, INTERRUPTED);
    assert_eq!(
        replica.published.of(job.id).last().unwrap().state,
        DraftUpdateState::Failed
    );
    let session = AgentSessionId::new_from_uuid(job.id);
    assert_eq!(*sessions.cancelled.lock().unwrap(), [session]);
}

/// The sweep fails drafts whose drafter died, stopping their sessions, and
/// keeps finished ones until their retention; cancelled ones nobody cleaned
/// up, and finished ones past it, go with their sessions.
#[tokio::test(start_paused = true)]
async fn the_sweep_fails_interrupted_drafts_and_keeps_unopened_ones() {
    let rows = Arc::new(Rows::default());
    let sessions = hangs(&rows);
    let replica = Replica::new(&rows, &sessions);
    let begin = |phase: DraftJobPhase, started: chrono::Duration, finished: Option<chrono::Duration>| {
        let session = macro_uuid::generate_uuid_v7();
        let now = Utc::now();
        rows.drafts.lock().unwrap().insert(
            session,
            (owner(), bot_id::MACRO_NEW_BOT_ID, Default::default(), now - started),
        );
        rows.jobs.lock().unwrap().insert(
            session,
            JobRow {
                client_id: macro_uuid::generate_uuid_v7(),
                phase,
                request: DraftAsked::default(),
                progress: DraftJobProgress {
                    stage: DraftStage::Writing,
                    ..Default::default()
                },
                result: finished.map(|_| failed("no")),
                finished_at: finished.map(|ago| now - ago),
                traceparent: Some(TRACEPARENT.into()),
            },
        );
        session
    };
    let minutes = chrono::Duration::minutes;
    let days = chrono::Duration::days;
    let died = begin(DraftJobPhase::Drafting, minutes(10), None);
    let running = begin(DraftJobPhase::Drafting, minutes(1), None);
    let unopened = begin(DraftJobPhase::Ready, days(2), Some(days(1)));
    let forgotten = begin(DraftJobPhase::Failed, days(9), Some(days(8)));
    let abandoned = begin(DraftJobPhase::Cancelled, minutes(10), None);
    // A draft its request waits for is the other sweep's.
    let waited = macro_uuid::generate_uuid_v7();
    rows.begin(waited, &owner(), bot_id::MACRO_NEW_BOT_ID)
        .await
        .unwrap();
    rows.drafts.lock().unwrap().get_mut(&waited).unwrap().3 = Utc::now() - minutes(11);

    assert_eq!(replica.jobs.sweep().await.unwrap(), 3);

    let interrupted = replica.jobs.job(owner(), died).await.unwrap();
    assert!(
        matches!(&interrupted.state, DraftJobState::Failed { message, .. } if message == INTERRUPTED),
        "{interrupted:?}"
    );
    assert_eq!(
        replica.published.of(died),
        [DraftUpdate {
            draft_id: died,
            state: DraftUpdateState::Failed,
            progress: interrupted.progress,
        }]
    );
    assert_eq!(rows.phase(running), Some(DraftJobPhase::Drafting));
    assert_eq!(rows.phase(unopened), Some(DraftJobPhase::Ready));
    assert_eq!(rows.phase(forgotten), None);
    assert_eq!(rows.phase(abandoned), None);
    assert!(rows.drafts.lock().unwrap().contains_key(&waited));
    let ids = |calls: &Mutex<Vec<AgentSessionId>>| {
        let mut ids: Vec<Uuid> = calls.lock().unwrap().iter().map(|id| id.as_uuid()).collect();
        ids.sort();
        ids
    };
    let mut stopped = vec![died, abandoned];
    stopped.sort();
    assert_eq!(ids(&sessions.cancelled), stopped);
    let mut deleted = vec![forgotten, abandoned];
    deleted.sort();
    assert_eq!(ids(&sessions.deleted), deleted);

    // The blocking sweep leaves background drafts alone.
    assert_eq!(
        Arc::new(drafts(&rows, &sessions)).sweep().await.unwrap(),
        1
    );
    assert_eq!(rows.phase(unopened), Some(DraftJobPhase::Ready));
    assert_eq!(rows.phase(died), Some(DraftJobPhase::Failed));
}

/// A refused admission is the blocking route's error, and leaves nothing.
#[tokio::test(start_paused = true)]
async fn a_refused_admission_is_an_error_and_leaves_nothing() {
    let rows = Arc::new(Rows::default());
    let mut sessions = Sessions::new(&rows, Box::new(|_| Vec::new()));
    sessions.refuses = Some(RoutineSessionError::Admission(
        AiAdmissionError::Unavailable,
    ));
    let sessions = Arc::new(sessions);
    let replica = Replica::new(&rows, &sessions);

    let error = replica.start(routine(BUG_REPORTS)).await.unwrap_err();

    assert!(error.downcast_ref::<AiAdmissionError>().is_some(), "{error:?}");
    assert!(rows.drafts.lock().unwrap().is_empty());
    assert!(rows.jobs.lock().unwrap().is_empty());
    assert!(replica.jobs.jobs(owner()).await.unwrap().is_empty());
}

/// What the blocking route refuses, starting refuses too, before any row;
/// what it answers as failed comes back failed.
#[tokio::test(start_paused = true)]
async fn requests_it_cannot_draft_are_refused_or_failed_at_once() {
    let rows = Arc::new(Rows::default());
    let sessions = hangs(&rows);
    let replica = Replica::new(&rows, &sessions);

    let error = replica.start(routine(" ")).await.unwrap_err();
    assert!(error.downcast_ref::<InvalidDraft>().is_some(), "{error:?}");
    assert!(rows.drafts.lock().unwrap().is_empty());

    let job = replica
        .start(add(
            "research it",
            vec![agent_step()],
            Some(super::super::StepKind::Agent),
        ))
        .await
        .unwrap();
    assert!(
        matches!(&job.state, DraftJobState::Failed { message, .. } if message == super::super::HAS_AGENT),
        "{job:?}"
    );
    assert!(sessions.prepared.lock().unwrap().is_empty());
}

/// One person has a few drafts drafting at once, no more.
#[tokio::test(start_paused = true)]
async fn too_many_drafts_at_once_are_refused() {
    let rows = Arc::new(Rows::default());
    let sessions = hangs(&rows);
    let replica = Replica::new(&rows, &sessions);
    for _ in 0..MAX_DRAFTING {
        replica.start(routine(BUG_REPORTS)).await.unwrap();
    }

    let error = replica.start(routine(BUG_REPORTS)).await.unwrap_err();

    assert_eq!(
        error.downcast_ref::<DraftJobError>(),
        Some(&DraftJobError::TooMany)
    );
    // Someone else still can.
    replica
        .jobs
        .start(
            stranger(),
            macro_uuid::generate_uuid_v7(),
            routine(BUG_REPORTS),
            context(),
            None,
        )
        .await
        .unwrap();
}
