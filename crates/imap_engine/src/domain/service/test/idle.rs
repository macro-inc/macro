//! Planned IDLE renewals stay healthy and never enter reconnect backoff.
use super::fakes::IdleWorkControl;
use super::*;
use std::time::Duration;
use tracing::instrument::WithSubscriber;
use tracing_subscriber::prelude::*;

#[derive(Clone)]
struct RetryCounts(Arc<std::sync::Mutex<Vec<u64>>>);
impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for RetryCounts {
    fn on_new_span(
        &self,
        attrs: &tracing::span::Attributes<'_>,
        _: &tracing::span::Id,
        _: tracing_subscriber::layer::Context<'_, S>,
    ) {
        if attrs.metadata().name() != "imap.account_round" {
            return;
        }
        struct Visitor<'a>(&'a mut Vec<u64>);
        impl tracing::field::Visit for Visitor<'_> {
            fn record_debug(&mut self, _: &tracing::field::Field, _: &dyn std::fmt::Debug) {}
            fn record_u64(&mut self, field: &tracing::field::Field, value: u64) {
                if field.name() == "retry_count" {
                    self.0.push(value);
                }
            }
        }
        attrs.record(&mut Visitor(&mut self.0.lock().unwrap()));
    }
}

#[tokio::test(start_paused = true)]
async fn a_planned_idle_restart_stays_stable_and_rearms_without_rescanning() {
    let retry_counts = Arc::new(std::sync::Mutex::new(Vec::new()));
    // tracing-core's single-dispatch fast path asks the registering thread's
    // current dispatcher for interest. Keep a second dispatch alive so another
    // test using NoSubscriber cannot disable the actor's shared callsite.
    let _interest_guard = tracing::Dispatch::new(tracing_subscriber::registry());
    let subscriber = tracing_subscriber::registry().with(RetryCounts(retry_counts.clone()));
    let repository = Arc::new(MemoryRepository {
        revision: Default::default(),
        scoped_acquire_errors: Default::default(),
        owner_claims: Default::default(),
        owner_gate: Default::default(),
        owner_errors: Default::default(),
        renewal: Default::default(),
        releases: Default::default(),
        acquire_gate: None,
        command_leases: None,
        owner_available: AtomicBool::new(true),
        state: Default::default(),
        saved_unknown: AtomicBool::new(false),
    });
    let idle = Arc::new(IdleWorkControl {
        entries: Default::default(),
        started: Default::default(),
        released: tokio::sync::Semaphore::new(0),
        outcome: WaitOutcome::Restarted,
    });
    let (started, mut rounds) = tokio::sync::mpsc::unbounded_channel();
    let control = Arc::new(ProviderWorkControl {
        idle: Some(idle.clone()),
        failures: Default::default(),
        organization: None,
        source: None,
        started,
        released: tokio::sync::Semaphore::new(1),
    });
    let transport = Arc::new(UncertainTransport {
        repository: repository.clone(),
        submissions: Default::default(),
        deadline: AtomicBool::new(false),
        submission_deadline: Default::default(),
        submit_control: None,
        refusal: None,
        sent_found: Default::default(),
        provider_work: Some(control.clone()),
    });
    let engine = Engine::new(
        repository,
        Arc::new(TestCipher),
        transport,
        tokio_util::task::TaskTracker::new(),
        tokio_util::sync::CancellationToken::new(),
    );
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let cancelled = tokio_util::sync::CancellationToken::new();
    let mut actor = Box::pin(
        engine
            .run_account(binding, cancelled.clone())
            .with_subscriber(subscriber),
    );
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert_eq!(rounds.try_recv().unwrap(), binding.link_id);
    let entered = idle.started.notified();
    tokio::pin!(entered);
    assert!(futures::poll!(entered.as_mut()).is_ready());
    assert_eq!(idle.entries.load(Ordering::Relaxed), 1);
    let before = tokio::time::Instant::now();
    tokio::time::advance(std::time::Duration::from_secs(180)).await;
    idle.released.add_permits(1);
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert!(
        matches!(
            rounds.try_recv(),
            Err(tokio::sync::mpsc::error::TryRecvError::Empty)
        ),
        "planned renewal must not scan the mailbox again"
    );
    let rearmed = idle.started.notified();
    tokio::pin!(rearmed);
    assert!(
        futures::poll!(rearmed.as_mut()).is_ready(),
        "planned renewal must re-arm the cheap change check immediately"
    );
    assert_eq!(idle.entries.load(Ordering::Relaxed), 2);
    assert_eq!(*retry_counts.lock().unwrap(), vec![0, 0]);
    assert_eq!(before.elapsed(), std::time::Duration::from_secs(180));
    assert_eq!(
        engine
            .idle_policy
            .lock()
            .unwrap()
            .state("imap.example.net")
            .cloned(),
        Some(crate::domain::adaptive_idle::IdleState::default()),
        "planned renewal is Stable, not drop evidence"
    );
    control.released.add_permits(1);
    tokio::time::advance(Duration::from_secs(1620)).await;
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert_eq!(
        rounds.try_recv().unwrap(),
        binding.link_id,
        "the slower thirty-minute walk must still scan an unchanged mailbox"
    );
    cancelled.cancel();
    actor.await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn an_unavailable_baseline_backs_off_full_scans_to_the_periodic_walk() {
    let repository = Arc::new(MemoryRepository {
        revision: Default::default(),
        scoped_acquire_errors: Default::default(),
        owner_claims: Default::default(),
        owner_gate: Default::default(),
        owner_errors: Default::default(),
        renewal: Default::default(),
        releases: Default::default(),
        acquire_gate: None,
        command_leases: Some(Default::default()),
        owner_available: AtomicBool::new(true),
        state: Default::default(),
        saved_unknown: AtomicBool::new(false),
    });
    let idle = Arc::new(IdleWorkControl {
        entries: Default::default(),
        started: Default::default(),
        released: tokio::sync::Semaphore::new(0),
        outcome: WaitOutcome::BaselineUnavailable,
    });
    let (started, mut scans) = tokio::sync::mpsc::unbounded_channel();
    let transport = Arc::new(UncertainTransport {
        repository: repository.clone(),
        submissions: Default::default(),
        deadline: AtomicBool::new(false),
        submission_deadline: Default::default(),
        submit_control: None,
        refusal: None,
        sent_found: Default::default(),
        provider_work: Some(Arc::new(ProviderWorkControl {
            idle: Some(idle.clone()),
            failures: Default::default(),
            organization: None,
            source: None,
            started,
            released: tokio::sync::Semaphore::new(20),
        })),
    });
    let engine = Engine::new(
        repository.clone(),
        Arc::new(TestCipher),
        transport.clone(),
        tokio_util::task::TaskTracker::new(),
        tokio_util::sync::CancellationToken::new(),
    );
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let cancelled = tokio_util::sync::CancellationToken::new();
    let mut actor = Box::pin(engine.run_account(binding, cancelled.clone()));
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert_eq!(scans.try_recv().unwrap(), binding.link_id);
    for delay in [30, 60, 120, 240, 480, 960, 1800, 1800] {
        idle.released.add_permits(1);
        assert!(futures::poll!(actor.as_mut()).is_pending());
        assert!(
            scans.try_recv().is_err(),
            "unavailable baseline must not immediately rescan"
        );
        let claims_before = repository.owner_claims.load(Ordering::Relaxed);
        tokio::time::advance(Duration::from_secs(delay - 1)).await;
        assert!(futures::poll!(actor.as_mut()).is_pending());
        assert!(
            scans.try_recv().is_err(),
            "scan ran before its growing deadline"
        );
        if delay > 60 {
            assert!(
                repository.owner_claims.load(Ordering::Relaxed) > claims_before,
                "owner heartbeat stopped during baseline backoff"
            );
        }
        tokio::time::advance(Duration::from_secs(1)).await;
        assert!(futures::poll!(actor.as_mut()).is_pending());
        assert_eq!(scans.try_recv().unwrap(), binding.link_id);
    }
    assert!(
        repository.owner_claims.load(Ordering::Relaxed) > 8,
        "backoff must retain ownership through heartbeats"
    );
    idle.released.add_permits(1);
    assert!(futures::poll!(actor.as_mut()).is_pending());
    let held = repository
        .acquire_scoped(binding, StateSelection::Catalog)
        .await
        .unwrap();
    assert!(
        matches!(
            repository
                .acquire_scoped(binding, StateSelection::Catalog)
                .await,
            Err(Error::AccountBusy)
        ),
        "the fixture must actually enforce command leases"
    );
    repository.release(&held).await.unwrap();
    let input = DraftInput {
        correlation: Uuid::now_v7(),
        revision: 1,
        reply_to: None,
        content: serde_json::json!({
            "message_id": "backoff-send@example.net",
            "message": { "link_id": binding.link_id, "subject": "test",
                "to": [{ "email": "recipient@example.net", "name": null, "photo_url": null }],
                "body_text": "payload" },
            "from": { "email": "owner@example.net", "name": null, "photo_url": null },
            "parent_message_id": null, "references": null,
        }),
    };
    let draft: Draft = serde_json::from_value(
        engine
            .execute(binding, Operation::CreateDraft { input })
            .await
            .unwrap(),
    )
    .unwrap();
    let submission: SubmissionOutcome = serde_json::from_value(
        engine
            .execute(binding, Operation::Submit { id: draft.id })
            .await
            .unwrap(),
    )
    .unwrap();
    // The provider stub is deliberately uncertain. Reaching it once proves
    // command admission was available while the actor retained only ownership.
    assert_eq!(submission, SubmissionOutcome::Unknown);
    assert_eq!(transport.submissions.load(Ordering::Acquire), 1);
    cancelled.cancel();
    actor.await.unwrap();
}
