use super::*;
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};
use uuid::Uuid;

#[derive(Clone)]
struct Delivery {
    event: Result<ImportEvent, ImportError>,
    receives: u32,
}

#[derive(Default)]
struct State {
    main: VecDeque<Delivery>,
    dlq: VecDeque<Delivery>,
    active: bool,
    settled: bool,
    generation: u64,
    checkpoint: u32,
    claims: usize,
    imports: usize,
    deletes: usize,
    heartbeats: usize,
    visibility: usize,
    publications: usize,
    reconciliations: usize,
    dead_letters: usize,
    heartbeat_error: Option<ImportError>,
    visibility_error: bool,
    heartbeat_hangs: bool,
    import_error: Option<ImportError>,
    claim_error: Option<ImportError>,
    dlq_error: bool,
    delete_error: bool,
    publication_hangs: bool,
    import_delay: Duration,
}

#[derive(Clone, Default)]
struct Fake {
    state: Arc<Mutex<State>>,
    started: CancellationToken,
    stop: CancellationToken,
}

fn event() -> ImportEvent {
    ImportEvent {
        job_id: Uuid::now_v7().try_into().unwrap(),
        slack_channel_id: "C123".parse().unwrap(),
        generation: 1,
    }
}

fn owner() -> WorkerId {
    Uuid::now_v7().try_into().unwrap()
}

fn delivery() -> Delivery {
    Delivery {
        event: Ok(event()),
        receives: 1,
    }
}

fn context(event: &ImportEvent, owner: WorkerId, generation: u64) -> ClaimedConversation {
    let now = Utc::now();
    ClaimedConversation {
        lease: Lease {
            event: event.clone(),
            owner,
            token: Uuid::now_v7().try_into().unwrap(),
            generation,
            expires_at: now + chrono::Duration::minutes(3),
            heartbeat_at: now,
            attempts: generation as u32,
        },
        team_id: Uuid::now_v7().try_into().unwrap(),
        requested_by: MacroUserIdStr::try_from_email("admin@example.com").unwrap(),
        metadata: ConversationMetadata {
            slack_channel_id: event.slack_channel_id.clone(),
            kind: ConversationKind::PublicChannel,
            name: "test".into(),
            folder: "test".parse().unwrap(),
            member_ids: vec![],
            creator_id: None,
            created_at: None,
            archived: false,
            message_count: None,
        },
        users: VerifiedUpload {
            registered: RegisteredUpload {
                descriptor: UploadDescriptor {
                    upload: UploadId::Users,
                    sha256: "0".repeat(64).parse().unwrap(),
                    byte_length: 2,
                    record_count: None,
                },
                key: "users".parse().unwrap(),
            },
            identity: ObjectIdentity::EntityTag("pinned".parse().unwrap()),
        },
        parts: vec![],
        checkpoint: Checkpoint::default(),
        job_created_at: now,
    }
}

impl ImportWorker for Fake {
    async fn claim(&self, event: &ImportEvent, owner: WorkerId) -> PortResult<ClaimOutcome> {
        let mut state = self.state.lock().unwrap();
        state.claims += 1;
        if let Some(code) = state.claim_error {
            return Err(code.into());
        }
        if state.settled {
            return Ok(ClaimOutcome::Obsolete);
        }
        if state.active {
            return Ok(ClaimOutcome::ActiveLease);
        }
        state.active = true;
        state.generation += 1;
        Ok(ClaimOutcome::Claimed(Box::new(context(
            event,
            owner,
            state.generation,
        ))))
    }

    async fn import(&self, context: &ClaimedConversation) -> PortResult<WorkerOutcome> {
        let delay = {
            let mut state = self.state.lock().unwrap();
            state.imports += 1;
            state.checkpoint = 1; // One durable batch before blocking on slow I/O.
            state.import_delay
        };
        self.started.cancel();
        sleep(delay).await;
        let mut state = self.state.lock().unwrap();
        if let Some(code) = state.import_error {
            return Err(code.into());
        }
        assert_eq!(context.lease.generation, state.generation);
        state.checkpoint = 2;
        state.settled = true;
        state.active = false;
        Ok(WorkerOutcome::Acknowledge)
    }

    async fn heartbeat(&self, lease: &Lease) -> PortResult<Lease> {
        let hangs = {
            let mut state = self.state.lock().unwrap();
            state.heartbeats += 1;
            if let Some(code) = state.heartbeat_error {
                return Err(code.into());
            }
            state.heartbeat_hangs
        };
        if hangs {
            std::future::pending::<()>().await;
        }
        Ok(lease.clone())
    }
}

impl ImportConsumer for Fake {
    type Delivery = Delivery;

    async fn receive(&self, dead_letter: bool) -> PortResult<Option<Delivery>> {
        let delivery = {
            let mut state = self.state.lock().unwrap();
            if dead_letter {
                state.dlq.pop_front()
            } else {
                state.main.pop_front()
            }
        };
        if delivery.is_none() {
            std::future::pending::<()>().await;
        }
        Ok(delivery)
    }

    fn envelope(delivery: &Delivery) -> (Result<ImportEvent, ImportError>, u32) {
        (delivery.event.clone(), delivery.receives)
    }

    async fn extend(&self, _: &Delivery) -> PortResult<()> {
        let mut state = self.state.lock().unwrap();
        state.visibility += 1;
        if state.visibility_error {
            return Err(ImportError::Retryable.into());
        }
        Ok(())
    }

    async fn delete(&self, delivery: &Delivery) -> PortResult<()> {
        let mut state = self.state.lock().unwrap();
        assert!(
            state.settled || delivery.event.is_err(),
            "no speculative ack"
        );
        state.deletes += 1;
        self.stop.cancel();
        if state.delete_error {
            return Err(ImportError::Retryable.into());
        }
        Ok(())
    }
}

impl Maintenance for Fake {
    async fn publish(&self) -> PortResult<()> {
        let hangs = {
            let mut state = self.state.lock().unwrap();
            state.publications += 1;
            state.publication_hangs
        };
        if hangs {
            std::future::pending::<()>().await;
        }
        Ok(())
    }
    async fn reconcile(&self) -> PortResult<()> {
        self.state.lock().unwrap().reconciliations += 1;
        Ok(())
    }
    async fn dead_letter(&self, _: &ImportEvent) -> PortResult<WorkerOutcome> {
        let mut state = self.state.lock().unwrap();
        state.dead_letters += 1;
        if state.active {
            return Ok(WorkerOutcome::Defer);
        }
        if state.dlq_error {
            return Err(ImportError::Retryable.into());
        }
        state.settled = true;
        Ok(WorkerOutcome::Acknowledge)
    }
}

fn config() -> WorkerConfig {
    WorkerConfig::new(true, 1, 5).unwrap()
}

async fn attempt(fake: &Fake, delivery: &Delivery, dlq: bool) -> PortResult<WorkerOutcome> {
    handle(fake, fake, fake, delivery, owner(), config(), dlq).await
}

#[test]
fn validates_bounded_concurrency_and_drain_budget() {
    assert!(WorkerConfig::new(true, 0, 5).is_err());
    assert!(WorkerConfig::new(true, 3, 5).is_err());
    assert!(WorkerConfig::new(true, 1, 0).is_err());
    assert!(WorkerConfig::new(true, 2, 5).is_ok());
    assert!(config().drain_timeout < Duration::from_secs(120));
}

#[tokio::test(start_paused = true)]
async fn only_available_slots_receive_and_claim() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Work(AtomicUsize);
    impl ImportWorker for Work {
        async fn claim(&self, event: &ImportEvent, owner: WorkerId) -> PortResult<ClaimOutcome> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(ClaimOutcome::Claimed(Box::new(context(event, owner, 1))))
        }
        async fn import(&self, _: &ClaimedConversation) -> PortResult<WorkerOutcome> {
            std::future::pending().await
        }
        async fn heartbeat(&self, lease: &Lease) -> PortResult<Lease> {
            Ok(lease.clone())
        }
    }

    for concurrency in [1, 2] {
        let fake = Fake::default();
        fake.state
            .lock()
            .unwrap()
            .main
            .extend((0..4).map(|_| delivery()));
        let work = Work(AtomicUsize::new(0));
        let stop = async {
            sleep(Duration::from_secs(1)).await;
            fake.stop.cancel();
        };
        tokio::join!(
            run(
                &work,
                &fake,
                &fake,
                owner(),
                WorkerConfig::new(true, concurrency, 5).unwrap(),
                fake.stop.clone()
            ),
            stop,
        );
        assert_eq!(work.0.load(Ordering::SeqCst), usize::from(concurrency));
        assert_eq!(
            fake.state.lock().unwrap().main.len(),
            4 - usize::from(concurrency)
        );
        assert_eq!(fake.state.lock().unwrap().deletes, 0);
    }
}

#[tokio::test(start_paused = true)]
async fn duplicate_active_delivery_defers_then_terminal_delivery_acknowledges() {
    let fake = Fake::default();
    fake.state.lock().unwrap().active = true;
    assert_eq!(
        attempt(&fake, &delivery(), false).await.unwrap(),
        WorkerOutcome::Defer
    );
    assert_eq!(fake.state.lock().unwrap().imports, 0);
    fake.state.lock().unwrap().settled = true;
    assert_eq!(
        attempt(&fake, &delivery(), false).await.unwrap(),
        WorkerOutcome::Acknowledge
    );
}

#[tokio::test(start_paused = true)]
async fn heartbeats_run_during_slow_batches() {
    let fake = Fake::default();
    fake.state.lock().unwrap().import_delay = Duration::from_secs(125);
    assert_eq!(
        attempt(&fake, &delivery(), false).await.unwrap(),
        WorkerOutcome::Acknowledge
    );
    let state = fake.state.lock().unwrap();
    assert_eq!(state.heartbeats, 2);
    assert_eq!(state.visibility, 2);
    assert!(state.settled);
}

#[tokio::test(start_paused = true)]
async fn visibility_failure_drops_import_without_settlement() {
    let fake = Fake::default();
    {
        let mut state = fake.state.lock().unwrap();
        state.import_delay = Duration::from_secs(125);
        state.visibility_error = true;
    }
    assert_eq!(
        *attempt(&fake, &delivery(), false)
            .await
            .unwrap_err()
            .current_context(),
        ImportError::Retryable
    );
    tokio::time::advance(Duration::from_secs(200)).await;
    let state = fake.state.lock().unwrap();
    assert_eq!(state.checkpoint, 1);
    assert!(!state.settled);
    assert_eq!(state.deletes, 0);
}

#[tokio::test(start_paused = true)]
async fn lost_fence_and_stalled_heartbeat_stop_writes() {
    for hangs in [false, true] {
        let fake = Fake::default();
        {
            let mut state = fake.state.lock().unwrap();
            state.import_delay = Duration::from_secs(125);
            state.heartbeat_hangs = hangs;
            if !hangs {
                state.heartbeat_error = Some(ImportError::LeaseLost);
            }
        }
        let error = attempt(&fake, &delivery(), false).await.unwrap_err();
        assert_eq!(
            *error.current_context(),
            if hangs {
                ImportError::Retryable
            } else {
                ImportError::LeaseLost
            }
        );
        assert_eq!(fake.state.lock().unwrap().checkpoint, 1);
        assert!(!fake.state.lock().unwrap().settled);
    }
}

#[tokio::test(start_paused = true)]
async fn killed_attempt_reclaims_checkpoint_with_new_fence() {
    let fake = Fake::default();
    fake.state.lock().unwrap().import_delay = Duration::from_secs(125);
    let delivery = delivery();
    assert!(
        timeout(Duration::from_secs(10), attempt(&fake, &delivery, false))
            .await
            .is_err()
    );
    assert_eq!(fake.state.lock().unwrap().checkpoint, 1);
    assert_eq!(
        attempt(&fake, &delivery, false).await.unwrap(),
        WorkerOutcome::Defer
    );
    // Simulate database-time expiry/reconciliation, not process-local unlocking.
    fake.state.lock().unwrap().active = false;
    assert_eq!(
        attempt(&fake, &delivery, false).await.unwrap(),
        WorkerOutcome::Acknowledge
    );
    assert_eq!(fake.state.lock().unwrap().generation, 2);
}

#[tokio::test(start_paused = true)]
async fn exhausted_receives_and_dlq_require_durable_failure_and_defer_active_lease() {
    for dlq in [false, true] {
        let fake = Fake::default();
        let mut delivery = delivery();
        delivery.receives = 5;
        fake.state.lock().unwrap().active = true;
        assert_eq!(
            attempt(&fake, &delivery, dlq).await.unwrap(),
            WorkerOutcome::Defer
        );
        fake.state.lock().unwrap().active = false;
        fake.state.lock().unwrap().dlq_error = true;
        assert!(attempt(&fake, &delivery, dlq).await.is_err());
        assert!(!fake.state.lock().unwrap().settled);
        fake.state.lock().unwrap().dlq_error = false;
        assert_eq!(
            attempt(&fake, &delivery, dlq).await.unwrap(),
            WorkerOutcome::Acknowledge
        );
        assert_eq!(fake.state.lock().unwrap().claims, 0);
    }
}

#[tokio::test(start_paused = true)]
async fn malformed_main_redrives_and_malformed_dlq_drops_without_domain_calls() {
    let fake = Fake::default();
    let bad = Delivery {
        event: Err(ImportError::InvalidInput),
        receives: 1,
    };
    assert_eq!(
        attempt(&fake, &bad, false).await.unwrap(),
        WorkerOutcome::Defer
    );
    assert_eq!(
        attempt(&fake, &bad, true).await.unwrap(),
        WorkerOutcome::Acknowledge
    );
    assert_eq!(fake.state.lock().unwrap().claims, 0);
    assert_eq!(fake.state.lock().unwrap().dead_letters, 0);
}

#[tokio::test(start_paused = true)]
async fn transient_errors_and_revoked_admin_never_ack() {
    for claim in [false, true] {
        let fake = Fake::default();
        if claim {
            fake.state.lock().unwrap().claim_error = Some(ImportError::Unavailable);
        } else {
            fake.state.lock().unwrap().import_error = Some(ImportError::Retryable);
        }
        assert!(attempt(&fake, &delivery(), false).await.is_err());
        assert!(!fake.state.lock().unwrap().settled);
        assert_eq!(fake.state.lock().unwrap().deletes, 0);
    }
}

#[tokio::test(start_paused = true)]
async fn delete_failure_is_safe_to_redeliver_after_durable_settlement() {
    let fake = Fake::default();
    fake.state.lock().unwrap().main.push_back(delivery());
    fake.state.lock().unwrap().delete_error = true;
    run(&fake, &fake, &fake, owner(), config(), fake.stop.clone()).await;
    assert_eq!(fake.state.lock().unwrap().deletes, 1);
    assert_eq!(
        attempt(&fake, &delivery(), false).await.unwrap(),
        WorkerOutcome::Acknowledge
    );
    assert_eq!(fake.state.lock().unwrap().imports, 1);
}

#[tokio::test(start_paused = true)]
async fn disabled_mode_keeps_recovery_but_never_receives_main_or_publishes() {
    let fake = Fake::default();
    fake.state.lock().unwrap().main.push_back(delivery());
    let stop = async {
        sleep(Duration::from_secs(15)).await;
        fake.stop.cancel();
    };
    tokio::join!(
        run(
            &fake,
            &fake,
            &fake,
            owner(),
            WorkerConfig::new(false, 1, 5).unwrap(),
            fake.stop.clone()
        ),
        stop
    );
    let state = fake.state.lock().unwrap();
    assert_eq!(state.claims, 0);
    assert_eq!(state.main.len(), 1);
    assert_eq!(state.publications, 0);
    assert!(state.reconciliations > 0);
}

#[tokio::test(start_paused = true)]
async fn slow_publisher_does_not_block_recovery_and_is_retried() {
    let fake = Fake::default();
    fake.state.lock().unwrap().publication_hangs = true;
    let stop = async {
        sleep(Duration::from_secs(75)).await;
        fake.stop.cancel();
    };
    tokio::join!(
        run(&fake, &fake, &fake, owner(), config(), fake.stop.clone()),
        stop
    );
    let state = fake.state.lock().unwrap();
    assert_eq!(state.publications, 2);
    assert!(state.reconciliations >= 7);
}

#[tokio::test(start_paused = true)]
async fn shutdown_during_batch_drains_or_leaves_recoverable_checkpoint() {
    for completes in [false, true] {
        let fake = Fake::default();
        {
            let mut state = fake.state.lock().unwrap();
            state.import_delay = Duration::from_secs(if completes { 90 } else { 300 });
            state.main.push_back(delivery());
            state.main.push_back(delivery());
        }
        let stop = async {
            fake.started.cancelled().await;
            fake.stop.cancel();
        };
        tokio::join!(
            run(&fake, &fake, &fake, owner(), config(), fake.stop.clone()),
            stop
        );
        let state = fake.state.lock().unwrap();
        assert_eq!(state.claims, 1);
        assert_eq!(state.main.len(), 1);
        assert_eq!(state.deletes, usize::from(completes));
        assert_eq!(state.checkpoint, if completes { 2 } else { 1 });
        assert!(state.heartbeats >= 1);
    }
}
