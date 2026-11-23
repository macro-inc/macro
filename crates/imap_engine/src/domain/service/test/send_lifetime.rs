use super::*;
use std::sync::atomic::AtomicU32;

pub(crate) struct PendingSubmission {
    pub(crate) repository: Arc<MemoryRepository>,
    pub(crate) transport: Arc<UncertainTransport>,
    pub(crate) engine: Arc<Engine>,
    pub(crate) binding: Binding,
    pub(crate) draft: Draft,
    pub(crate) control: Arc<ProviderWorkControl>,
    pub(crate) started: tokio::sync::mpsc::UnboundedReceiver<Uuid>,
}

impl PendingSubmission {
    pub(crate) async fn new() -> Self {
        let repository = Arc::new(MemoryRepository {
            revision: Default::default(),
            scoped_acquire_errors: Default::default(),
            state: Default::default(),
            saved_unknown: AtomicBool::new(false),
            command_leases: None,
            owner_available: AtomicBool::new(true),
            owner_claims: AtomicU32::new(0),
            owner_gate: Default::default(),
            owner_errors: AtomicU32::new(0),
            renewal: Default::default(),
            releases: AtomicU32::new(0),
            acquire_gate: None,
        });
        let (sender, started) = tokio::sync::mpsc::unbounded_channel();
        let control = Arc::new(ProviderWorkControl {
            idle: None,
            failures: Default::default(),
            organization: None,
            source: None,
            started: sender,
            released: tokio::sync::Semaphore::new(0),
        });
        let transport = Arc::new(UncertainTransport {
            repository: repository.clone(),
            submissions: AtomicU32::new(0),
            deadline: AtomicBool::new(false),
            sent_found: Default::default(),
            submission_deadline: Default::default(),
            submit_control: Some(control.clone()),
            refusal: None,
            provider_work: None,
        });
        let engine = Arc::new(Engine::new(
            repository.clone(),
            Arc::new(TestCipher),
            transport.clone(),
            tokio_util::task::TaskTracker::new(),
            tokio_util::sync::CancellationToken::new(),
        ));
        let binding = Binding {
            link_id: Uuid::now_v7(),
            sync_generation: 1,
            grant_generation: 1,
        };
        let draft = serde_json::from_value(engine.execute(binding, Operation::CreateDraft {
            input: DraftInput {
                correlation: Uuid::now_v7(), revision: 1, reply_to: None,
                content: serde_json::json!({
                    "message_id": "bounded-submission@example.net",
                    "message": {"link_id":binding.link_id,"subject":"synthetic",
                        "to":[{"email":"recipient@example.net","name":null,"photo_url":null}],
                        "body_text":"synthetic payload"},
                    "from":{"email":"owner@example.net","name":null,"photo_url":null},
                    "parent_message_id":null,"references":null
                }),
            },
        }).await.unwrap()).unwrap();
        Self {
            repository,
            transport,
            engine,
            binding,
            draft,
            control,
            started,
        }
    }
}

#[tokio::test(start_paused = true)]
async fn submission_starts_without_an_immediate_renew_and_survives_renewal_errors() {
    let mut fixture = PendingSubmission::new().await;
    fixture
        .repository
        .renewal
        .failures
        .store(2, Ordering::Release);
    let engine = fixture.engine.clone();
    let binding = fixture.binding;
    let id = fixture.draft.id.clone();
    let mut submission =
        tokio::spawn(async move { engine.execute(binding, Operation::Submit { id }).await });
    tokio::select! {
        started = fixture.started.recv() => assert_eq!(started, Some(binding.link_id)),
        result = &mut submission => panic!("submission ended before provider release: {result:?}"),
    }
    assert_eq!(fixture.repository.renewal.calls.load(Ordering::Acquire), 0);
    assert!(fixture.repository.saved_unknown.load(Ordering::Acquire));
    for _ in 0..2 {
        tokio::time::advance(std::time::Duration::from_secs(60)).await;
        fixture.repository.renewal.attempted.notified().await;
        assert!(!submission.is_finished());
    }
    fixture.control.released.add_permits(1);
    let outcome: SubmissionOutcome =
        serde_json::from_value(submission.await.unwrap().unwrap()).unwrap();
    assert_eq!(outcome, SubmissionOutcome::Unknown);
    // A repeated submission consults the durable Unknown record, never SMTP.
    let result = fixture
        .engine
        .execute(
            binding,
            Operation::Submit {
                id: fixture.draft.id,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_value::<SubmissionOutcome>(result).unwrap(),
        SubmissionOutcome::Unknown
    );
    assert_eq!(fixture.transport.submissions.load(Ordering::Acquire), 1);
}

#[tokio::test(start_paused = true)]
async fn the_shutdown_drain_boundary_keeps_the_submission_unknown() {
    let mut fixture = PendingSubmission::new().await;
    let tasks = fixture.engine.submission_tasks.clone();
    let engine = fixture.engine.clone();
    let id = fixture.draft.id.clone();
    let binding = fixture.binding;
    let request = tokio::spawn(async move {
        engine
            .execute_tracked(
                binding,
                Operation::Submit { id },
                OperationClass::Interactive,
            )
            .await
    });
    assert_eq!(fixture.started.recv().await, Some(binding.link_id));
    request.abort();
    assert!(matches!(request.await, Err(error) if error.is_cancelled()));
    tasks.close();
    let before = tokio::time::Instant::now();
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(30), tasks.wait())
            .await
            .is_err()
    );
    assert_eq!(before.elapsed(), std::time::Duration::from_secs(30));
    assert_eq!(
        fixture.repository.state.lock().unwrap().drafts[&fixture.draft.id].submission,
        Some(SubmissionOutcome::Unknown)
    );
    assert_eq!(fixture.transport.submissions.load(Ordering::Acquire), 1);
    // Permit cleanup only after observing the state a process cut-off retains.
    fixture.control.released.add_permits(1);
    tasks.wait().await;
}

#[tokio::test(start_paused = true)]
async fn a_hanging_lease_renewal_cannot_stop_the_submission_deadline() {
    let mut fixture = PendingSubmission::new().await;
    *fixture.repository.renewal.blocked.lock().unwrap() =
        Some(Arc::new(tokio::sync::Semaphore::new(0)));
    let engine = fixture.engine.clone();
    let binding = fixture.binding;
    let id = fixture.draft.id.clone();
    let before = tokio::time::Instant::now();
    let submission =
        tokio::spawn(async move { engine.execute(binding, Operation::Submit { id }).await });
    assert_eq!(fixture.started.recv().await, Some(binding.link_id));
    tokio::time::advance(std::time::Duration::from_secs(60)).await;
    fixture.repository.renewal.attempted.notified().await;
    tokio::time::advance(std::time::Duration::from_secs(300)).await;
    let result = tokio::time::timeout(std::time::Duration::from_secs(1), submission)
        .await
        .expect("a pending renewal must not stop SMTP's deadline")
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_value::<SubmissionOutcome>(result).unwrap(),
        SubmissionOutcome::Unknown
    );
    assert_eq!(before.elapsed(), std::time::Duration::from_secs(360));
    assert!(
        fixture
            .repository
            .state
            .lock()
            .unwrap()
            .send_penalty_until
            .is_some()
    );
}

#[tokio::test(start_paused = true)]
async fn shutdown_refuses_an_unadmitted_send_without_marking_unknown() {
    let fixture = PendingSubmission::new().await;
    fixture.engine.shutdown.cancel();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        fixture.engine.clone().execute_tracked(
            fixture.binding,
            Operation::Submit {
                id: fixture.draft.id.clone(),
            },
            OperationClass::Interactive,
        ),
    )
    .await
    .expect("shutdown must reject before provider work");
    assert_eq!(result, Err(Error::SendUnavailable));
    assert!(!fixture.repository.saved_unknown.load(Ordering::Acquire));
    assert_eq!(fixture.transport.submissions.load(Ordering::Acquire), 0);
}

#[tokio::test(start_paused = true)]
async fn shutdown_preserves_a_prior_unknown_instead_of_claiming_non_delivery() {
    let fixture = PendingSubmission::new().await;
    fixture
        .repository
        .state
        .lock()
        .unwrap()
        .drafts
        .get_mut(&fixture.draft.id)
        .unwrap()
        .submission = Some(SubmissionOutcome::Unknown);
    fixture.engine.shutdown.cancel();
    let result = fixture
        .engine
        .clone()
        .execute_tracked(
            fixture.binding,
            Operation::Submit {
                id: fixture.draft.id,
            },
            OperationClass::Interactive,
        )
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_value::<SubmissionOutcome>(result).unwrap(),
        SubmissionOutcome::Unknown
    );
    assert_eq!(fixture.transport.submissions.load(Ordering::Acquire), 0);
}

#[tokio::test(start_paused = true)]
async fn shutdown_releases_a_queued_submission_before_it_saves_unknown() {
    let fixture = PendingSubmission::new().await;
    let held = fixture
        .engine
        .operation_capacity
        .acquire_many(16)
        .await
        .unwrap();
    let request = fixture.engine.execute(
        fixture.binding,
        Operation::Submit {
            id: fixture.draft.id.clone(),
        },
    );
    tokio::pin!(request);
    assert!(futures::poll!(request.as_mut()).is_pending());
    assert_eq!(fixture.engine.operation_waiting.load(Ordering::Acquire), 1);
    fixture.engine.shutdown.cancel();
    assert_eq!(request.await, Err(Error::SendUnavailable));
    assert!(!fixture.repository.saved_unknown.load(Ordering::Acquire));
    assert_eq!(fixture.transport.submissions.load(Ordering::Acquire), 0);
    drop(held);
}

#[tokio::test(start_paused = true)]
async fn shutdown_does_not_cancel_smtp_that_was_already_admitted() {
    let mut fixture = PendingSubmission::new().await;
    let engine = fixture.engine.clone();
    let binding = fixture.binding;
    let id = fixture.draft.id.clone();
    let request = tokio::spawn(async move {
        engine
            .execute_tracked(
                binding,
                Operation::Submit { id },
                OperationClass::Interactive,
            )
            .await
    });
    assert_eq!(fixture.started.recv().await, Some(binding.link_id));
    fixture.engine.shutdown.cancel();
    fixture.control.released.add_permits(1);
    let result = request.await.unwrap().unwrap();
    assert_eq!(
        serde_json::from_value::<SubmissionOutcome>(result).unwrap(),
        SubmissionOutcome::Unknown
    );
    assert_eq!(fixture.transport.submissions.load(Ordering::Acquire), 1);
}
