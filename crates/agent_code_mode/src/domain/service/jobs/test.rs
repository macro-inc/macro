use super::*;
use agent_runtime_protocol::domain::job::JobStatus;
use agent_session::testing::test_agent_session;
use serde_json::json;
use tokio::sync::Notify;

const TURN: macro_uuid::Uuid = macro_uuid::Uuid::from_u128(1);
/// The correlation every job credential of the fake signs.
const JOB_CORRELATION: macro_uuid::Uuid = macro_uuid::Uuid::from_u128(0x10b);

/// Job rows and the session they report to, in memory.
#[derive(Default)]
struct Rows {
    records: Mutex<HashMap<ExecutionId, (AgentSessionId, ExecutionRecord, bool, bool)>>,
    notifications: Mutex<Vec<PendingNotification>>,
    updates: Mutex<Vec<JobUpdatedNotification>>,
    archived: Mutex<bool>,
    settled: Notify,
    /// How many settles fail before one goes through.
    failing_settles: std::sync::atomic::AtomicUsize,
}

impl Rows {
    fn record(&self, job: ExecutionId) -> ExecutionRecord {
        self.records.lock().unwrap()[&job].1.clone()
    }
    fn settlements(&self) -> Vec<JobSettlement> {
        self.notifications
            .lock()
            .unwrap()
            .iter()
            .map(|pending| {
                assert!(pending.wake, "a settled job wakes its session");
                match &pending.notification.event {
                    NotificationEvent::JobSettled(settlement) => settlement.clone(),
                    other => panic!("unexpected event {other:?}"),
                }
            })
            .collect()
    }
    fn statuses(&self) -> Vec<JobStatus> {
        self.updates
            .lock()
            .unwrap()
            .iter()
            .map(|update| update.status)
            .collect()
    }
}

#[async_trait]
impl JobStore for Rows {
    async fn launch(
        &self,
        session: AgentSessionId,
        _: &MacroUserIdStr<'static>,
        record: &ExecutionRecord,
        caps: JobCaps,
    ) -> Result<(), CodeModeError> {
        let mut records = self.records.lock().unwrap();
        if records.contains_key(&record.execution_id) {
            return Err(CodeModeError::Duplicate);
        }
        let running = records
            .values()
            .filter(|(owner, _, _, settled)| *owner == session && !settled)
            .count();
        if running >= usize::from(caps.per_session) {
            return Err(CodeModeError::JobLimit("too many".into()));
        }
        records.insert(record.execution_id, (session, record.clone(), false, false));
        Ok(())
    }
    async fn save_activity(
        &self,
        _: AgentSessionId,
        record: &ExecutionRecord,
    ) -> Result<(), CodeModeError> {
        let mut records = self.records.lock().unwrap();
        let row = records
            .get_mut(&record.execution_id)
            .ok_or(CodeModeError::NotFound)?;
        if row.3 {
            return Err(CodeModeError::NotFound);
        }
        row.1 = record.clone();
        Ok(())
    }
    async fn control(
        &self,
        _: AgentSessionId,
        job: ExecutionId,
    ) -> Result<JobControl, CodeModeError> {
        Ok(match self.records.lock().unwrap().get(&job) {
            None => JobControl::Gone,
            Some((_, _, _, true)) => JobControl::Settled,
            Some((_, _, true, _)) => JobControl::CancelRequested,
            Some(_) => JobControl::Running,
        })
    }
    async fn request_cancel(
        &self,
        _: AgentSessionId,
        job: ExecutionId,
    ) -> Result<JobCancel, CodeModeError> {
        let mut records = self.records.lock().unwrap();
        let row = records.get_mut(&job).ok_or(CodeModeError::NotFound)?;
        row.2 = true;
        Ok(if row.3 {
            JobCancel::AlreadySettled
        } else {
            JobCancel::Requested
        })
    }
    async fn settle(
        &self,
        _: AgentSessionId,
        record: &ExecutionRecord,
        notification: Option<&PendingNotification>,
    ) -> Result<bool, CodeModeError> {
        use std::sync::atomic::Ordering;
        if self
            .failing_settles
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |left| {
                left.checked_sub(1)
            })
            .is_ok()
        {
            return Err(CodeModeError::Unavailable);
        }
        let mut records = self.records.lock().unwrap();
        let row = records
            .get_mut(&record.execution_id)
            .ok_or(CodeModeError::NotFound)?;
        if row.3 {
            return Ok(false);
        }
        row.1 = record.clone();
        row.3 = true;
        self.notifications
            .lock()
            .unwrap()
            .extend(notification.cloned());
        self.settled.notify_one();
        Ok(true)
    }
    async fn overdue(
        &self,
        before: chrono::DateTime<chrono::Utc>,
        _: u16,
    ) -> Result<Vec<(AgentSessionId, ExecutionRecord)>, CodeModeError> {
        Ok(self
            .records
            .lock()
            .unwrap()
            .values()
            .filter(|(_, record, _, settled)| {
                !settled && record.job.as_ref().is_some_and(|job| job.deadline < before)
            })
            .map(|(session, record, _, _)| (*session, record.clone()))
            .collect())
    }
    async fn list(
        &self,
        session: AgentSessionId,
        _: chrono::DateTime<chrono::Utc>,
        _: u16,
    ) -> Result<Vec<ExecutionRecord>, CodeModeError> {
        Ok(self
            .records
            .lock()
            .unwrap()
            .values()
            .filter(|(owner, ..)| *owner == session)
            .map(|(_, record, ..)| record.clone())
            .collect())
    }
}

#[async_trait]
impl JobSessions for Rows {
    async fn open(&self, _: AgentSessionId) -> Result<bool, CodeModeError> {
        Ok(!*self.archived.lock().unwrap())
    }
    async fn announce(
        &self,
        _: AgentSessionId,
        update: &JobUpdatedNotification,
    ) -> Result<(), CodeModeError> {
        self.updates.lock().unwrap().push(update.clone());
        Ok(())
    }
}

/// Foreground records, for calls that run in the foreground.
#[derive(Default)]
struct Foreground(Mutex<HashMap<ExecutionId, ExecutionRecord>>);

#[async_trait]
impl ExecutionStore for Foreground {
    async fn create(
        &self,
        _: AgentSessionId,
        record: &ExecutionRecord,
    ) -> Result<(), CodeModeError> {
        self.0
            .lock()
            .unwrap()
            .insert(record.execution_id, record.clone());
        Ok(())
    }
    async fn save(&self, _: AgentSessionId, record: &ExecutionRecord) -> Result<(), CodeModeError> {
        self.0
            .lock()
            .unwrap()
            .insert(record.execution_id, record.clone());
        Ok(())
    }
    async fn get(
        &self,
        _: AgentSessionId,
        execution: ExecutionId,
    ) -> Result<ExecutionRecord, CodeModeError> {
        self.0
            .lock()
            .unwrap()
            .get(&execution)
            .cloned()
            .ok_or(CodeModeError::NotFound)
    }
}

/// The job store also answers the foreground store's reads of job records,
/// as the one table does in production.
struct Journal {
    jobs: Arc<Rows>,
    foreground: Foreground,
}

#[async_trait]
impl ExecutionStore for Journal {
    async fn create(
        &self,
        session: AgentSessionId,
        record: &ExecutionRecord,
    ) -> Result<(), CodeModeError> {
        self.foreground.create(session, record).await
    }
    async fn save(
        &self,
        session: AgentSessionId,
        record: &ExecutionRecord,
    ) -> Result<(), CodeModeError> {
        self.foreground.save(session, record).await
    }
    async fn get(
        &self,
        session: AgentSessionId,
        execution: ExecutionId,
    ) -> Result<ExecutionRecord, CodeModeError> {
        if let Some((_, record, ..)) = self.jobs.records.lock().unwrap().get(&execution) {
            return Ok(record.clone());
        }
        self.foreground.get(session, execution).await
    }
}

struct Turns;
#[async_trait]
impl ExecutionTurns for Turns {
    async fn active(&self, _: AgentSessionId) -> Result<Option<macro_uuid::Uuid>, CodeModeError> {
        Ok(Some(TURN))
    }
}

/// Allows a detach unless told why not, and records each approval and each
/// credential's lifetime.
#[derive(Default)]
struct Credentials {
    refuse: Option<String>,
    /// Refuse to mint a job's credential.
    refuse_mint: bool,
    approvals: std::sync::atomic::AtomicUsize,
    lifetimes: Mutex<Vec<RunLifetime>>,
    revoked: Mutex<Vec<macro_uuid::Uuid>>,
    /// How many revokes fail before one goes through.
    failing_revokes: std::sync::atomic::AtomicUsize,
}

impl Credentials {
    fn minted(&self) -> usize {
        self.lifetimes.lock().unwrap().len()
    }
    fn approved(&self) -> usize {
        self.approvals.load(std::sync::atomic::Ordering::SeqCst)
    }
}
#[async_trait]
impl ExecutionCredentials for Credentials {
    async fn issue(
        &self,
        identity: &ExecutionIdentity,
        _: &str,
        _: CancellationToken,
    ) -> Result<IssuedRun, CodeModeError> {
        self.lifetimes.lock().unwrap().push(identity.lifetime);
        Ok(IssuedRun {
            correlation_id: macro_uuid::Uuid::from_u128(0xf0),
            environment: code_execution::domain::RunEnvironment::default(),
            acting_user: identity.owner.clone(),
        })
    }
    async fn approve_job(
        &self,
        identity: &ExecutionIdentity,
        _: &str,
        _: CancellationToken,
    ) -> Result<MacroUserIdStr<'static>, CodeModeError> {
        self.approvals
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(identity.owner.clone())
    }
    async fn mint_job(
        &self,
        identity: &ExecutionIdentity,
        acting_user: &MacroUserIdStr<'static>,
    ) -> Result<IssuedRun, CodeModeError> {
        if self.refuse_mint {
            return Err(CodeModeError::Unavailable);
        }
        self.lifetimes.lock().unwrap().push(identity.lifetime);
        Ok(IssuedRun {
            correlation_id: JOB_CORRELATION,
            environment: code_execution::domain::RunEnvironment::default(),
            acting_user: acting_user.clone(),
        })
    }
    async fn revoke_job(&self, correlation: macro_uuid::Uuid) -> Result<(), CodeModeError> {
        use std::sync::atomic::Ordering;
        if self
            .failing_revokes
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |left| {
                left.checked_sub(1)
            })
            .is_ok()
        {
            return Err(CodeModeError::Unavailable);
        }
        self.revoked.lock().unwrap().push(correlation);
        Ok(())
    }
    async fn may_detach(&self, _: &ExecutionIdentity) -> Result<Detach, CodeModeError> {
        Ok(match &self.refuse {
            Some(reason) => Detach::Refused(reason.clone()),
            None => Detach::Allowed,
        })
    }
}

struct NoImages;
#[async_trait]
impl ModelImages for NoImages {
    async fn load_png(
        &self,
        _: &StaticFileId,
        _: &MacroUserIdStr<'_>,
    ) -> anyhow::Result<ModelImage> {
        anyhow::bail!("no images here")
    }
}

/// Runs until released, cancelled or out of time, reporting one SDK call.
struct Held {
    release: Notify,
    started: Notify,
    /// One permit per program started.
    starts: Semaphore,
}
impl Default for Held {
    fn default() -> Self {
        Self {
            release: Notify::new(),
            started: Notify::new(),
            starts: Semaphore::new(0),
        }
    }
}
#[async_trait]
impl ProgramExecutor for Held {
    async fn check_program(
        &self,
        request: &ExecuteRequest,
        _: code_execution::domain::ContextShape,
        _: CancellationToken,
    ) -> Result<(), Outcome> {
        if request.source.contains("TYPE_ERROR") {
            return Err(code_execution::domain::ExecutionFailure::new(
                code_execution::domain::FailureCode::Compile,
                "The program wasn't run: it doesn't type-check against the Macro SDK.",
            )
            .into());
        }
        Ok(())
    }
    async fn execute_program_with_progress(
        &self,
        request: ExecuteRequest,
        _: code_execution::domain::RunEnvironment,
        cancellation: CancellationToken,
        progress: tokio::sync::mpsc::Sender<serde_json::Value>,
    ) -> Outcome {
        let _ = progress
            .send(json!({"id": 1, "service": "cognition", "operation": "decisions", "status": "started"}))
            .await;
        self.started.notify_one();
        self.starts.add_permits(1);
        tokio::select! {
            () = self.release.notified() => Outcome::Succeeded { value: json!({"data": "passed"}) },
            () = cancellation.cancelled() => Outcome::Cancelled,
            () = tokio::time::sleep(Duration::from_millis(request.timeout_ms)) => Outcome::TimedOut,
        }
    }
    async fn execute_program(
        &self,
        _: ExecuteRequest,
        _: code_execution::domain::RunEnvironment,
        _: CancellationToken,
    ) -> Outcome {
        Outcome::Succeeded {
            value: json!({"data": "foreground"}),
        }
    }
}

struct Harness {
    service: CodeModeService,
    rows: Arc<Rows>,
    program: Arc<Held>,
    credentials: Arc<Credentials>,
    session: AgentSession,
}

fn harness(credentials: Credentials) -> Harness {
    let rows = Arc::new(Rows::default());
    let program = Arc::new(Held::default());
    let credentials = Arc::new(credentials);
    let service = CodeModeService::new(
        Some(program.clone()),
        credentials.clone(),
        Arc::new(Journal {
            jobs: rows.clone(),
            foreground: Foreground::default(),
        }),
        Arc::new(Turns),
        Arc::new(NoImages),
    )
    .with_jobs(JobRuntime {
        executor: program.clone(),
        store: rows.clone(),
        sessions: rows.clone(),
    });
    Harness {
        service,
        rows,
        program,
        credentials,
        session: test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7())),
    }
}

fn check_routine() -> ExecuteRequest {
    ExecuteRequest {
        source: "export async function main() { return {data: await check()}; }".into(),
        timeout_ms: 30_000,
    }
}

fn background(title: &str) -> Option<BackgroundRequest> {
    Some(BackgroundRequest {
        title: title.into(),
        sends: false,
    })
}

impl Harness {
    async fn launch(
        &self,
        id: ExecutionId,
        request: ExecuteRequest,
    ) -> Result<ExecutionReceipt, CodeModeError> {
        self.launch_in(&self.session, id, request, background("Checking routine"))
            .await
    }

    async fn launch_in(
        &self,
        session: &AgentSession,
        id: ExecutionId,
        request: ExecuteRequest,
        background: Option<BackgroundRequest>,
    ) -> Result<ExecutionReceipt, CodeModeError> {
        self.service
            .execute(
                session,
                id,
                ai_toolset::actor::ToolActor::Owner,
                TURN,
                request,
                background,
                CancellationToken::new(),
            )
            .await
    }

    fn jobs(&self) -> &Jobs {
        self.service.jobs.as_deref().unwrap()
    }

    /// Take every job slot of this replica, as long jobs would.
    async fn fill_slots(&self) -> tokio::sync::OwnedSemaphorePermit {
        Arc::clone(&self.jobs().slots)
            .acquire_many_owned(u32::try_from(JOB_SLOTS).unwrap())
            .await
            .unwrap()
    }
}

fn another_session() -> AgentSession {
    test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7()))
}

/// The routine example: the check starts, the call returns at once while it
/// runs, and its result arrives later as one waking `job.settled` event.
#[tokio::test]
async fn a_background_execution_returns_at_once_and_settles_into_one_waking_event() {
    let harness = harness(Credentials::default());
    let id = ExecutionId::mint();
    let receipt = harness.launch(id, check_routine()).await.unwrap();
    assert_eq!(receipt.status, ExecutionStatus::Running);
    assert_eq!(receipt.error, None);
    assert_eq!(receipt.job.as_ref().unwrap().title, "Checking routine");
    harness.program.started.notified().await;
    assert!(harness.rows.settlements().is_empty());

    harness.program.release.notify_one();
    harness.rows.settled.notified().await;

    assert_eq!(
        harness.rows.settlements(),
        [JobSettlement {
            job_id: id.as_uuid(),
            title: "Checking routine".into(),
            status: JobStatus::Done,
            result: Some(json!({"data": "passed", "reviews": []})),
            error: None,
            never_ran: false,
        }]
    );
    assert_eq!(
        harness.rows.statuses(),
        [JobStatus::Running, JobStatus::Done]
    );
    let record = harness.rows.record(id);
    assert_eq!(record.status, ExecutionStatus::Succeeded);
    assert_eq!(record.activity.len(), 1);
    let lifetimes = harness.credentials.lifetimes.lock().unwrap().clone();
    assert_eq!(
        record.credential_correlation_id,
        Some(JOB_CORRELATION),
        "the job is bound to its own credential"
    );
    let job = record.job.unwrap();
    assert!(
        matches!(lifetimes[..], [RunLifetime::Job { deadline }] if deadline == job.deadline),
        "the credential lasts as long as the job: {lifetimes:?}"
    );
    assert!(!job.never_ran);
    assert_eq!(
        *harness.credentials.revoked.lock().unwrap(),
        [JOB_CORRELATION],
        "its credential is revoked once its program stops"
    );
}

/// Where a job may not run, the call runs in the foreground and says why.
#[tokio::test]
async fn a_refused_background_runs_in_the_foreground_and_says_why() {
    let harness = harness(Credentials {
        refuse: Some("Someone other than the owner prompted this turn.".into()),
        ..Default::default()
    });
    // In the foreground the call waits for the program, so let it finish.
    harness.program.release.notify_one();
    let receipt = harness
        .launch(ExecutionId::mint(), check_routine())
        .await
        .unwrap();
    assert_eq!(receipt.status, ExecutionStatus::Succeeded);
    assert_eq!(receipt.job, None);
    assert_eq!(
        receipt.ran_in_foreground.as_deref(),
        Some("Someone other than the owner prompted this turn.")
    );
    assert!(harness.rows.records.lock().unwrap().is_empty());
    assert_eq!(
        *harness.credentials.lifetimes.lock().unwrap(),
        [RunLifetime::Foreground]
    );
}

/// The same launch sent again is the same job; two launches of the same
/// program under the same title in one turn are two jobs.
#[tokio::test]
async fn a_resent_launch_is_the_same_job_and_identical_launches_are_two_jobs() {
    let harness = harness(Credentials::default());
    let id = ExecutionId::mint();
    harness.launch(id, check_routine()).await.unwrap();
    let again = harness.launch(id, check_routine()).await.unwrap();
    assert_eq!(again.execution_id, id);
    let second = harness
        .launch(ExecutionId::mint(), check_routine())
        .await
        .unwrap();
    assert_ne!(second.execution_id, id);
    assert_eq!(harness.rows.records.lock().unwrap().len(), 2);
    assert_eq!(harness.credentials.approved(), 2);
    harness.service.shutdown_jobs().await;
}

/// The cap refuses a launch before anything runs.
#[tokio::test]
async fn a_launch_past_the_session_cap_does_not_run() {
    let harness = harness(Credentials::default());
    for _ in 0..JOB_CAPS.per_session {
        harness
            .launch(ExecutionId::mint(), check_routine())
            .await
            .unwrap();
    }
    let refused = harness.launch(ExecutionId::mint(), check_routine()).await;
    assert!(matches!(refused, Err(CodeModeError::JobLimit(_))));
    assert_eq!(
        harness.credentials.approved(),
        usize::from(JOB_CAPS.per_session)
    );
    harness.service.shutdown_jobs().await;
}

/// A program with type errors settles in the call, without an event: the
/// agent reads its errors in the receipt.
#[tokio::test]
async fn a_type_error_settles_quietly_in_the_receipt() {
    let harness = harness(Credentials::default());
    let receipt = harness
        .launch(
            ExecutionId::mint(),
            ExecuteRequest {
                source: "export async function main() { return TYPE_ERROR; }".into(),
                timeout_ms: 30_000,
            },
        )
        .await
        .unwrap();
    assert_eq!(receipt.status, ExecutionStatus::Failed);
    assert_eq!(harness.credentials.approved(), 0);
    assert_eq!(harness.credentials.minted(), 0);
    assert!(harness.rows.settlements().is_empty());
}

#[tokio::test]
async fn cancelling_a_job_stops_it_and_settles_it_once() {
    let harness = harness(Credentials::default());
    let id = ExecutionId::mint();
    harness.launch(id, check_routine()).await.unwrap();
    harness.program.started.notified().await;
    assert_eq!(
        harness
            .service
            .cancel_job(harness.session.id, id)
            .await
            .unwrap(),
        JobCancel::Requested
    );
    harness.rows.settled.notified().await;
    let settlements = harness.rows.settlements();
    assert_eq!(settlements.len(), 1);
    assert_eq!(settlements[0].status, JobStatus::Cancelled);
    assert_eq!(settlements[0].error.as_deref(), Some(CANCELLED));
    assert_eq!(
        harness
            .service
            .cancel_job(harness.session.id, id)
            .await
            .unwrap(),
        JobCancel::AlreadySettled
    );
}

/// A cancel from another replica arrives through the job's row.
#[tokio::test(start_paused = true)]
async fn a_cancel_written_to_the_row_stops_the_job() {
    let harness = harness(Credentials::default());
    let id = ExecutionId::mint();
    harness.launch(id, check_routine()).await.unwrap();
    harness.program.started.notified().await;
    harness
        .rows
        .request_cancel(harness.session.id, id)
        .await
        .unwrap();
    harness.rows.settled.notified().await;
    assert_eq!(harness.rows.settlements()[0].status, JobStatus::Cancelled);
}

#[tokio::test(start_paused = true)]
async fn archiving_the_session_cancels_its_jobs() {
    let harness = harness(Credentials::default());
    let id = ExecutionId::mint();
    harness.launch(id, check_routine()).await.unwrap();
    harness.program.started.notified().await;
    *harness.rows.archived.lock().unwrap() = true;
    harness.rows.settled.notified().await;
    let settlement = &harness.rows.settlements()[0];
    assert_eq!(settlement.status, JobStatus::Cancelled);
    assert_eq!(settlement.error.as_deref(), Some(ARCHIVED));
}

#[tokio::test(start_paused = true)]
async fn a_job_stops_at_its_limit() {
    let harness = harness(Credentials::default());
    let id = ExecutionId::mint();
    harness.launch(id, check_routine()).await.unwrap();
    harness.rows.settled.notified().await;
    let settlement = &harness.rows.settlements()[0];
    assert_eq!(settlement.status, JobStatus::TimedOut);
    assert_eq!(settlement.error.as_deref(), Some(TIMED_OUT));
}

/// A replica that stops settles its jobs as interrupted, never as cancelled.
#[tokio::test]
async fn shutdown_settles_running_jobs_as_interrupted() {
    let harness = harness(Credentials::default());
    let id = ExecutionId::mint();
    harness.launch(id, check_routine()).await.unwrap();
    harness.program.started.notified().await;
    harness.service.shutdown_jobs().await;
    let settlement = &harness.rows.settlements()[0];
    assert_eq!(settlement.status, JobStatus::Interrupted);
    assert_eq!(settlement.error.as_deref(), Some(INTERRUPTED));
    assert_eq!(harness.rows.record(id).status, ExecutionStatus::Interrupted);
}

/// The sweep settles what a dead replica left, once.
#[tokio::test]
async fn the_sweep_settles_a_dead_replicas_job_once() {
    let harness = harness(Credentials::default());
    let id = ExecutionId::mint();
    let long_ago = chrono::Utc::now() - chrono::TimeDelta::hours(1);
    harness.rows.records.lock().unwrap().insert(
        id,
        (
            harness.session.id,
            ExecutionRecord {
                credential_correlation_id: Some(JOB_CORRELATION),
                execution_id: id,
                acting_as: Some(ai_toolset::actor::ToolActor::Owner),
                turn_id: Some(TURN),
                source: check_routine().source,
                status: ExecutionStatus::Running,
                result: None,
                error: None,
                calls: Vec::new(),
                activity: Vec::new(),
                activity_truncated: false,
                job: Some(JobInfo {
                    title: "Scanning inbox".into(),
                    started_at: long_ago,
                    deadline: long_ago + chrono::TimeDelta::minutes(10),
                    never_ran: false,
                }),
            },
            false,
            false,
        ),
    );
    assert_eq!(harness.service.sweep_jobs().await.unwrap(), 1);
    assert_eq!(harness.service.sweep_jobs().await.unwrap(), 0);
    let settlements = harness.rows.settlements();
    assert_eq!(settlements.len(), 1);
    assert_eq!(settlements[0].status, JobStatus::Interrupted);
    assert_eq!(harness.rows.statuses(), [JobStatus::Interrupted]);
    // The dead replica's job credential stops working too.
    assert_eq!(
        *harness.credentials.revoked.lock().unwrap(),
        [JOB_CORRELATION]
    );
}

#[tokio::test]
async fn the_job_list_names_running_and_settled_jobs() {
    let harness = harness(Credentials::default());
    let id = ExecutionId::mint();
    harness.launch(id, check_routine()).await.unwrap();
    let jobs = harness.service.jobs(harness.session.id).await.unwrap();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].job_id, id.as_uuid());
    assert_eq!(jobs[0].status, JobStatus::Running);
    harness.service.shutdown_jobs().await;
}

#[test]
fn a_result_too_large_for_the_event_is_left_out_with_a_reason() {
    let record = ExecutionRecord {
        credential_correlation_id: None,
        execution_id: ExecutionId::mint(),
        acting_as: None,
        turn_id: None,
        source: String::new(),
        status: ExecutionStatus::Succeeded,
        result: Some(json!({"data": "x".repeat(MAX_SETTLED_RESULT_BYTES)})),
        error: None,
        calls: Vec::new(),
        activity: Vec::new(),
        activity_truncated: false,
        job: None,
    };
    let settlement = settlement(&record);
    assert_eq!(settlement.result, None);
    assert!(settlement.error.unwrap().contains("too large"));
}

/// A failed settle write is retried, so the job settles with its real
/// outcome now rather than reading as interrupted when the sweep finds it.
#[tokio::test(start_paused = true)]
async fn a_settle_that_fails_once_is_retried() {
    let harness = harness(Credentials::default());
    harness
        .rows
        .failing_settles
        .store(1, std::sync::atomic::Ordering::SeqCst);
    let id = ExecutionId::mint();
    harness.launch(id, check_routine()).await.unwrap();
    harness.program.started.notified().await;
    harness.program.release.notify_one();
    harness.rows.settled.notified().await;
    assert_eq!(harness.rows.record(id).status, ExecutionStatus::Succeeded);
    assert_eq!(harness.rows.settlements().len(), 1);
}

/// A program can throw an error of any size; the event that carries it to
/// the agent must still fit.
#[test]
fn a_huge_error_is_cut_so_its_event_fits() {
    let record = ExecutionRecord {
        credential_correlation_id: None,
        execution_id: ExecutionId::mint(),
        acting_as: None,
        turn_id: None,
        source: String::new(),
        status: ExecutionStatus::Failed,
        result: None,
        error: Some("é".repeat(100_000)),
        calls: Vec::new(),
        activity: Vec::new(),
        activity_truncated: false,
        job: None,
    };
    let settlement = settlement(&record);
    assert!(settlement.error.as_ref().unwrap().len() < MAX_SETTLED_ERROR_BYTES + 64);
    assert!(
        PendingNotification::new(ProduceNotification {
            session_id: AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7()),
            subject_id: record.execution_id.to_string(),
            event: NotificationEvent::JobSettled(settlement),
            dedupe_key: None,
            wake: true,
        })
        .is_ok()
    );
}

/// Until its credential can be revoked, a job never sends: a launch that asks
/// to runs in the foreground, under its turn, and says why.
#[tokio::test]
async fn a_launch_that_sends_runs_in_the_foreground() {
    let harness = harness(Credentials::default());
    harness.program.release.notify_one();
    let receipt = harness
        .launch_in(
            &harness.session,
            ExecutionId::mint(),
            check_routine(),
            Some(BackgroundRequest {
                title: "Saving routine".into(),
                sends: true,
            }),
        )
        .await
        .unwrap();
    assert_eq!(receipt.job, None);
    assert_eq!(
        receipt.ran_in_foreground.as_deref(),
        Some(SENDS_IN_FOREGROUND)
    );
    assert!(harness.rows.records.lock().unwrap().is_empty());
    assert_eq!(
        *harness.credentials.lifetimes.lock().unwrap(),
        [RunLifetime::Foreground]
    );
}

/// A job's credential is minted when it gets a slot, not at launch: time in
/// the queue is not token time.
#[tokio::test]
async fn a_queued_job_has_no_credential_until_it_gets_a_slot() {
    let harness = harness(Credentials::default());
    let slots = harness.fill_slots().await;
    let id = ExecutionId::mint();
    let receipt = harness.launch(id, check_routine()).await.unwrap();
    assert_eq!(receipt.status, ExecutionStatus::Running);
    assert_eq!(harness.credentials.approved(), 1);
    assert_eq!(harness.credentials.minted(), 0);
    assert_eq!(harness.rows.record(id).credential_correlation_id, None);

    drop(slots);
    harness.program.starts.acquire().await.unwrap().forget();
    assert_eq!(harness.credentials.minted(), 1);
    assert_eq!(
        harness.rows.record(id).credential_correlation_id,
        Some(JOB_CORRELATION)
    );
    harness.service.shutdown_jobs().await;
}

/// The server stopping while a job still waits for a slot (a restart before
/// it ran) settles it as interrupted before it started: its card and its
/// wake row both say it didn't run, and no credential was ever minted.
#[tokio::test]
async fn a_restart_before_a_job_runs_says_it_did_not_run() {
    let harness = harness(Credentials::default());
    let _slots = harness.fill_slots().await;
    let id = ExecutionId::mint();
    harness.launch(id, check_routine()).await.unwrap();
    harness.service.shutdown_jobs().await;
    let settlement = &harness.rows.settlements()[0];
    assert_eq!(settlement.status, JobStatus::Interrupted);
    assert_eq!(settlement.error.as_deref(), Some(INTERRUPTED_BEFORE_START));
    assert!(settlement.never_ran, "the wake row says it didn't run");
    assert!(
        harness.rows.record(id).job.unwrap().never_ran,
        "so does its card"
    );
    assert_eq!(harness.credentials.minted(), 0);
}

/// A job that never got a slot says nothing ran, not that its calls may
/// have taken effect.
#[tokio::test(start_paused = true)]
async fn a_job_that_never_got_a_slot_says_it_did_not_start() {
    let harness = harness(Credentials::default());
    let _slots = harness.fill_slots().await;
    let id = ExecutionId::mint();
    harness.launch(id, check_routine()).await.unwrap();
    harness.rows.settled.notified().await;
    let settlement = &harness.rows.settlements()[0];
    assert_eq!(settlement.status, JobStatus::TimedOut);
    assert_eq!(settlement.error.as_deref(), Some(NEVER_STARTED));
    // Its wake row says so too.
    assert!(settlement.never_ran);
    assert_eq!(harness.credentials.minted(), 0);
    // Its card says it never ran.
    assert!(harness.rows.record(id).job.unwrap().never_ran);
}

#[tokio::test]
async fn a_job_cancelled_while_queued_says_nothing_ran() {
    let harness = harness(Credentials::default());
    let _slots = harness.fill_slots().await;
    let id = ExecutionId::mint();
    harness.launch(id, check_routine()).await.unwrap();
    harness
        .service
        .cancel_job(harness.session.id, id)
        .await
        .unwrap();
    harness.rows.settled.notified().await;
    let settlement = &harness.rows.settlements()[0];
    assert_eq!(settlement.status, JobStatus::Cancelled);
    assert_eq!(settlement.error.as_deref(), Some(CANCELLED_BEFORE_START));
    assert_eq!(harness.credentials.minted(), 0);
    assert!(harness.credentials.revoked.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_job_whose_credential_cannot_be_minted_fails_without_running() {
    let harness = harness(Credentials {
        refuse_mint: true,
        ..Default::default()
    });
    let id = ExecutionId::mint();
    harness.launch(id, check_routine()).await.unwrap();
    harness.rows.settled.notified().await;
    let settlement = &harness.rows.settlements()[0];
    assert_eq!(settlement.status, JobStatus::Failed);
    assert_eq!(settlement.error.as_deref(), Some(NO_CREDENTIAL));
    assert_eq!(harness.program.starts.available_permits(), 0);
}

/// A replica takes only so many jobs, running and queued; past that a
/// launch runs in the foreground instead of waiting out its limit.
#[tokio::test]
async fn a_replica_full_of_jobs_runs_the_next_in_the_foreground() {
    let harness = harness(Credentials::default());
    let _taken = Arc::clone(&harness.jobs().taken)
        .acquire_many_owned(u32::try_from(JOBS_ON_REPLICA).unwrap())
        .await
        .unwrap();
    harness.program.release.notify_one();
    let receipt = harness
        .launch_in(
            &another_session(),
            ExecutionId::mint(),
            check_routine(),
            background("Scanning inbox"),
        )
        .await
        .unwrap();
    assert_eq!(receipt.job, None);
    assert_eq!(receipt.ran_in_foreground.as_deref(), Some(REPLICA_BUSY));
    assert!(harness.rows.records.lock().unwrap().is_empty());
}

/// A job's place on the replica is freed when it settles.
#[tokio::test]
async fn a_settled_job_frees_its_place_on_the_replica() {
    let harness = harness(Credentials::default());
    let id = ExecutionId::mint();
    harness.launch(id, check_routine()).await.unwrap();
    assert_eq!(
        harness.jobs().taken.available_permits(),
        JOBS_ON_REPLICA - 1
    );
    harness.program.started.notified().await;
    harness.program.release.notify_one();
    harness.service.shutdown_jobs().await;
    assert_eq!(harness.jobs().taken.available_permits(), JOBS_ON_REPLICA);
}

/// A dead replica's job that never got its credential never ran, and the
/// sweep says so.
#[tokio::test]
async fn the_sweep_says_a_dead_replicas_queued_job_never_ran() {
    let harness = harness(Credentials::default());
    let id = ExecutionId::mint();
    let long_ago = chrono::Utc::now() - chrono::TimeDelta::hours(1);
    harness.rows.records.lock().unwrap().insert(
        id,
        (
            harness.session.id,
            ExecutionRecord {
                credential_correlation_id: None,
                execution_id: id,
                acting_as: Some(ai_toolset::actor::ToolActor::Owner),
                turn_id: Some(TURN),
                source: check_routine().source,
                status: ExecutionStatus::Running,
                result: None,
                error: None,
                calls: Vec::new(),
                activity: Vec::new(),
                activity_truncated: false,
                job: Some(JobInfo {
                    title: "Scanning inbox".into(),
                    started_at: long_ago,
                    deadline: long_ago + chrono::TimeDelta::minutes(10),
                    never_ran: false,
                }),
            },
            false,
            false,
        ),
    );
    assert_eq!(harness.service.sweep_jobs().await.unwrap(), 1);
    let settlement = &harness.rows.settlements()[0];
    assert_eq!(settlement.status, JobStatus::Interrupted);
    assert_eq!(settlement.error.as_deref(), Some(INTERRUPTED_BEFORE_START));
    // Its wake row says so too.
    assert!(settlement.never_ran);
    assert!(harness.rows.record(id).job.unwrap().never_ran);
    assert!(harness.credentials.revoked.lock().unwrap().is_empty());
}

/// A revoke that fails is retried, so a settled job doesn't leave its
/// credential working until the deadline.
#[tokio::test(start_paused = true)]
async fn a_revoke_that_fails_once_is_retried() {
    let harness = harness(Credentials {
        failing_revokes: std::sync::atomic::AtomicUsize::new(2),
        ..Default::default()
    });
    let id = ExecutionId::mint();
    harness.launch(id, check_routine()).await.unwrap();
    harness.program.started.notified().await;
    harness.program.release.notify_one();
    harness.rows.settled.notified().await;
    assert_eq!(
        *harness.credentials.revoked.lock().unwrap(),
        [JOB_CORRELATION]
    );
}
