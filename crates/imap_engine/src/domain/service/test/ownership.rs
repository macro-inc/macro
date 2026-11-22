use super::*;

#[tokio::test(start_paused = true)]
async fn an_owner_lost_during_sync_queue_never_starts_provider_work() {
    for lost_after in [1, 361] {
        let repository = Arc::new(MemoryRepository {
            state: std::sync::Mutex::new(AccountState::default()),
            saved_unknown: AtomicBool::new(false),
            owner_available: AtomicBool::new(true),
            owner_claims: std::sync::atomic::AtomicU32::new(0),
            owner_gate: std::sync::Mutex::new(None),
            owner_errors: std::sync::atomic::AtomicU32::new(0),
            releases: std::sync::atomic::AtomicU32::new(0),
            acquire_gate: None,
        });
        let (started, mut observed) = tokio::sync::mpsc::unbounded_channel();
        let transport = Arc::new(UncertainTransport {
            repository: repository.clone(),
            submissions: std::sync::atomic::AtomicU32::new(0),
            deadline: AtomicBool::new(false),
            sent_found: std::sync::Mutex::new(std::collections::BTreeSet::new()),
            submission_deadline: std::sync::Mutex::new(None),
            provider_work: Some(Arc::new(ProviderWorkControl {
                source: None,
                started,
                released: tokio::sync::Semaphore::new(1),
            })),
        });
        let engine = Engine::new(repository.clone(), Arc::new(TestCipher), transport);
        let held = engine
            .synchronization_capacity
            .acquire_many(2)
            .await
            .unwrap();
        let binding = Binding {
            link_id: Uuid::now_v7(),
            sync_generation: 1,
            grant_generation: 1,
        };
        let mut actor =
            Box::pin(engine.run_account(binding, tokio_util::sync::CancellationToken::new()));
        assert!(futures::poll!(actor.as_mut()).is_pending());
        assert_eq!(repository.owner_claims.load(Ordering::Relaxed), 1);
        // Model a competing owner before the next heartbeat, and after lease expiry.
        tokio::time::advance(std::time::Duration::from_secs(lost_after)).await;
        repository.owner_available.store(false, Ordering::Release);
        drop(held);
        assert!(actor.await.is_ok());
        assert!(
            observed.try_recv().is_err(),
            "a lost owner must not snapshot before fencing"
        );
    }
}

#[tokio::test(start_paused = true)]
async fn queued_actor_renews_ownership_before_the_lease_can_expire() {
    let repository = Arc::new(MemoryRepository {
        state: std::sync::Mutex::new(AccountState::default()),
        saved_unknown: AtomicBool::new(false),
        owner_available: AtomicBool::new(true),
        owner_claims: std::sync::atomic::AtomicU32::new(0),
        owner_gate: std::sync::Mutex::new(None),
        owner_errors: std::sync::atomic::AtomicU32::new(0),
        releases: std::sync::atomic::AtomicU32::new(0),
        acquire_gate: None,
    });
    let transport = Arc::new(UncertainTransport {
        repository: repository.clone(),
        submissions: std::sync::atomic::AtomicU32::new(0),
        deadline: AtomicBool::new(false),
        sent_found: std::sync::Mutex::new(std::collections::BTreeSet::new()),
        submission_deadline: std::sync::Mutex::new(None),
        provider_work: None,
    });
    let engine = Engine::new(repository.clone(), Arc::new(TestCipher), transport);
    let held = engine
        .synchronization_capacity
        .acquire_many(2)
        .await
        .unwrap();
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let cancellation = tokio_util::sync::CancellationToken::new();
    let mut actor = Box::pin(engine.run_account(binding, cancellation.clone()));
    assert!(futures::poll!(actor.as_mut()).is_pending());
    for expected_claims in 2..=8 {
        tokio::time::advance(std::time::Duration::from_secs(60)).await;
        assert!(futures::poll!(actor.as_mut()).is_pending());
        assert_eq!(
            repository.owner_claims.load(Ordering::Relaxed),
            expected_claims
        );
    }
    cancellation.cancel();
    assert!(actor.await.is_ok());
    drop(held);
    assert_eq!(engine.synchronization_waiting.load(Ordering::Relaxed), 0);
}

#[tokio::test(start_paused = true)]
async fn failed_heartbeat_keeps_inflight_work_alive_until_its_lease_is_released() {
    let repository = Arc::new(MemoryRepository {
        state: std::sync::Mutex::new(AccountState::default()),
        saved_unknown: AtomicBool::new(false),
        owner_available: AtomicBool::new(true),
        owner_claims: std::sync::atomic::AtomicU32::new(0),
        owner_gate: std::sync::Mutex::new(None),
        owner_errors: std::sync::atomic::AtomicU32::new(0),
        releases: std::sync::atomic::AtomicU32::new(0),
        acquire_gate: None,
    });
    let (started, mut observed) = tokio::sync::mpsc::unbounded_channel();
    let control = Arc::new(ProviderWorkControl {
        source: None,
        started,
        released: tokio::sync::Semaphore::new(0),
    });
    let transport = Arc::new(UncertainTransport {
        repository: repository.clone(),
        submissions: std::sync::atomic::AtomicU32::new(0),
        deadline: AtomicBool::new(false),
        sent_found: std::sync::Mutex::new(std::collections::BTreeSet::new()),
        submission_deadline: std::sync::Mutex::new(None),
        provider_work: Some(control.clone()),
    });
    let engine = Engine::new(repository.clone(), Arc::new(TestCipher), transport);
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let cancellation = tokio_util::sync::CancellationToken::new();
    let mut actor = Box::pin(engine.run_account(binding, cancellation.clone()));
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert_eq!(observed.try_recv().unwrap(), binding.link_id);
    repository.owner_errors.store(1, Ordering::Relaxed);
    tokio::time::advance(OWNER_RENEW_INTERVAL).await;
    assert!(futures::poll!(actor.as_mut()).is_pending());
    let claims = repository.owner_claims.load(Ordering::Relaxed);
    tokio::time::advance(OWNER_RENEW_INTERVAL).await;
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert_eq!(repository.owner_claims.load(Ordering::Relaxed), claims + 1);
    assert_eq!(repository.releases.load(Ordering::Relaxed), 0);
    control.released.add_permits(1);
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert_eq!(repository.releases.load(Ordering::Relaxed), 1);
    cancellation.cancel();
    assert!(actor.await.is_ok());
}

#[tokio::test(start_paused = true)]
async fn real_owner_loss_aborts_provider_work_and_releases_the_command_lease() {
    let repository = Arc::new(MemoryRepository {
        state: std::sync::Mutex::new(AccountState::default()),
        saved_unknown: AtomicBool::new(false),
        owner_available: AtomicBool::new(true),
        owner_claims: std::sync::atomic::AtomicU32::new(0),
        owner_gate: std::sync::Mutex::new(None),
        owner_errors: std::sync::atomic::AtomicU32::new(0),
        releases: std::sync::atomic::AtomicU32::new(0),
        acquire_gate: None,
    });
    let (started, mut observed) = tokio::sync::mpsc::unbounded_channel();
    let transport = Arc::new(UncertainTransport {
        repository: repository.clone(),
        submissions: std::sync::atomic::AtomicU32::new(0),
        deadline: AtomicBool::new(false),
        sent_found: std::sync::Mutex::new(std::collections::BTreeSet::new()),
        submission_deadline: std::sync::Mutex::new(None),
        provider_work: Some(Arc::new(ProviderWorkControl {
            source: None,
            started,
            released: tokio::sync::Semaphore::new(0),
        })),
    });
    let engine = Engine::new(repository.clone(), Arc::new(TestCipher), transport);
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let mut actor =
        Box::pin(engine.run_account(binding, tokio_util::sync::CancellationToken::new()));
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert_eq!(observed.try_recv().unwrap(), binding.link_id);
    repository.owner_available.store(false, Ordering::Release);
    tokio::time::advance(OWNER_RENEW_INTERVAL).await;
    assert!(actor.await.is_ok());
    assert_eq!(repository.releases.load(Ordering::Relaxed), 1);
    assert_eq!(engine.synchronization_capacity.available_permits(), 2);
}

#[tokio::test(start_paused = true)]
async fn ownership_loss_drains_acquisition_before_releasing_without_provider_work() {
    let gate = Arc::new(tokio::sync::Semaphore::new(0));
    let repository = Arc::new(MemoryRepository {
        state: std::sync::Mutex::new(AccountState::default()),
        saved_unknown: AtomicBool::new(false),
        owner_available: AtomicBool::new(true),
        owner_claims: std::sync::atomic::AtomicU32::new(0),
        owner_gate: std::sync::Mutex::new(None),
        owner_errors: std::sync::atomic::AtomicU32::new(0),
        releases: std::sync::atomic::AtomicU32::new(0),
        acquire_gate: Some(gate.clone()),
    });
    let (started, mut observed) = tokio::sync::mpsc::unbounded_channel();
    let transport = Arc::new(UncertainTransport {
        repository: repository.clone(),
        submissions: std::sync::atomic::AtomicU32::new(0),
        deadline: AtomicBool::new(false),
        sent_found: std::sync::Mutex::new(std::collections::BTreeSet::new()),
        submission_deadline: std::sync::Mutex::new(None),
        provider_work: Some(Arc::new(ProviderWorkControl {
            source: None,
            started,
            released: tokio::sync::Semaphore::new(0),
        })),
    });
    let engine = Engine::new(repository.clone(), Arc::new(TestCipher), transport);
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let mut actor =
        Box::pin(engine.run_account(binding, tokio_util::sync::CancellationToken::new()));
    assert!(futures::poll!(actor.as_mut()).is_pending());
    repository.owner_available.store(false, Ordering::Release);
    tokio::time::advance(OWNER_RENEW_INTERVAL).await;
    assert!(futures::poll!(actor.as_mut()).is_pending());
    gate.add_permits(1);
    assert!(actor.await.is_ok());
    assert_eq!(repository.releases.load(Ordering::Relaxed), 1);
    assert!(observed.try_recv().is_err());
}

#[tokio::test(start_paused = true)]
async fn a_stalled_heartbeat_does_not_suspend_the_round_or_its_cleanup() {
    let repository = Arc::new(MemoryRepository {
        state: std::sync::Mutex::new(AccountState::default()),
        saved_unknown: AtomicBool::new(false),
        owner_available: AtomicBool::new(true),
        owner_claims: std::sync::atomic::AtomicU32::new(0),
        owner_gate: std::sync::Mutex::new(None),
        owner_errors: std::sync::atomic::AtomicU32::new(0),
        releases: std::sync::atomic::AtomicU32::new(0),
        acquire_gate: None,
    });
    let (started, mut observed) = tokio::sync::mpsc::unbounded_channel();
    let control = Arc::new(ProviderWorkControl {
        source: None,
        started,
        released: tokio::sync::Semaphore::new(0),
    });
    let transport = Arc::new(UncertainTransport {
        repository: repository.clone(),
        submissions: std::sync::atomic::AtomicU32::new(0),
        deadline: AtomicBool::new(false),
        sent_found: std::sync::Mutex::new(std::collections::BTreeSet::new()),
        submission_deadline: std::sync::Mutex::new(None),
        provider_work: Some(control.clone()),
    });
    let engine = Engine::new(repository.clone(), Arc::new(TestCipher), transport);
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let cancellation = tokio_util::sync::CancellationToken::new();
    let mut actor = Box::pin(engine.run_account(binding, cancellation.clone()));
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert_eq!(observed.try_recv().unwrap(), binding.link_id);
    let stalled = Arc::new(tokio::sync::Semaphore::new(0));
    *repository.owner_gate.lock().unwrap() = Some(stalled.clone());
    tokio::time::advance(OWNER_RENEW_INTERVAL).await;
    assert!(futures::poll!(actor.as_mut()).is_pending());
    control.released.add_permits(1);
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert_eq!(repository.releases.load(Ordering::Relaxed), 1);
    // Unblock post-sync fencing as well as the still-pending heartbeat before
    // shutdown; neither is a provider operation or a command-lease owner.
    *repository.owner_gate.lock().unwrap() = None;
    stalled.add_permits(2);
    cancellation.cancel();
    assert!(actor.await.is_ok());
}
