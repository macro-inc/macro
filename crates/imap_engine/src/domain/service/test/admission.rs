use super::*;

#[tokio::test(start_paused = true)]
async fn submission_admission_wait_is_bounded_without_marking_or_sending() {
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
    let engine = Engine::new(repository.clone(), Arc::new(TestCipher), transport.clone());
    let held = engine.operation_capacity.acquire_many(16).await.unwrap();
    let started = tokio::time::Instant::now();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(61),
        engine.execute(
            Binding {
                link_id: Uuid::now_v7(),
                sync_generation: 1,
                grant_generation: 1,
            },
            Operation::Submit {
                id: "missing".into(),
            },
        ),
    )
    .await
    .expect("submission admission must have a bounded wait");
    // Before reading the durable record, a prior submission is still unknown.
    // This must not be upgraded to a typed proof of non-submission.
    assert_eq!(result, Err(Error::ConnectionUnavailable));
    assert_eq!(started.elapsed(), std::time::Duration::from_secs(60));
    assert!(!repository.saved_unknown.load(Ordering::Acquire));
    assert_eq!(transport.submissions.load(Ordering::Acquire), 0);
    drop(held);
}

#[tokio::test(start_paused = true)]
async fn smtp_receives_the_original_deadline_after_waiting_for_admission() {
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
    let engine = Engine::new(repository, Arc::new(TestCipher), transport.clone());
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let draft: Draft = serde_json::from_value(
        engine.execute(binding, Operation::CreateDraft { input: DraftInput {
            correlation: Uuid::now_v7(),
            revision: 1,
            reply_to: None,
            content: serde_json::json!({
                "message_id": "admission-budget@example.net",
                "message": {
                    "link_id": binding.link_id,
                    "subject": "synthetic",
                    "to": [{"email": "recipient@example.net", "name": null, "photo_url": null}],
                    "body_text": "synthetic payload"
                },
                "from": {"email": "owner@example.net", "name": null, "photo_url": null},
                "parent_message_id": null,
                "references": null
            }),
        }}).await.unwrap()
    ).unwrap();
    let held = engine.operation_capacity.acquire_many(16).await.unwrap();
    let started = tokio::time::Instant::now();
    let mut submission = Box::pin(engine.execute(binding, Operation::Submit { id: draft.id }));
    // Enter the real semaphore wait once, before advancing the paused clock.
    assert!(futures::poll!(submission.as_mut()).is_pending());
    tokio::time::advance(std::time::Duration::from_secs(40)).await;
    drop(held);
    assert!(submission.await.is_ok());
    assert_eq!(transport.submissions.load(Ordering::Acquire), 1);
    assert_eq!(
        *transport.submission_deadline.lock().unwrap(),
        Some(started + std::time::Duration::from_secs(60))
    );
    assert_eq!(started.elapsed(), std::time::Duration::from_secs(40));
}

#[tokio::test]
async fn interactive_message_lookup_is_not_queued_behind_sync_admission() {
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
    let engine = Engine::new(repository, Arc::new(TestCipher), transport);
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    // Occupy the two sync slots without performing provider IO. Poll enough
    // waiting syncs once to reproduce the old 16-permit interactive starvation.
    let active_syncs = engine
        .synchronization_capacity
        .acquire_many(2)
        .await
        .unwrap();
    let mut queued_syncs = Vec::new();
    for _ in 0..16 {
        let mut queued = Box::pin(engine.execute(binding, Operation::Sync));
        assert!(futures::poll!(queued.as_mut()).is_pending());
        queued_syncs.push(queued);
    }
    assert_eq!(engine.operation_capacity.available_permits(), 16);
    assert_eq!(engine.synchronization_waiting.load(Ordering::Relaxed), 16);
    let mut lookup = Box::pin(engine.execute(
        binding,
        Operation::Message {
            id: "missing".into(),
        },
    ));
    let message = match futures::poll!(lookup.as_mut()) {
        std::task::Poll::Ready(result) => result.unwrap(),
        std::task::Poll::Pending => panic!("interactive reads must not wait for sync admission"),
    };
    assert!(message.is_null());
    drop(queued_syncs);
    drop(active_syncs);
    assert_eq!(engine.synchronization_waiting.load(Ordering::Relaxed), 0);
}

#[tokio::test]
async fn ingestion_burst_does_not_queue_a_user_message_read() {
    for class in [OperationClass::Ingestion, OperationClass::Import] {
        let mut state = AccountState::default();
        merge_snapshot(
            &mut state,
            vec![RemoteFolder {
                virtual_label: None,
                uid_next: Some(2),
                phantom: None,
                detected_role: None,
                monitored: true,
                folder: Folder {
                    sync_enabled: true,
                    id: "inbox".into(),
                    parent_id: None,
                    name: "INBOX".into(),
                    role: FolderRole::Inbox,
                    has_children: false,
                    total_items: Some(1),
                },
                path: "INBOX".into(),
                uid_validity: 1,
                highest_modseq: None,
                sync_tier: SyncTier::Full,
                messages: vec![RemoteMessage {
                    gmail_labels: None,
                    uid: 1,
                    flags: Vec::new(),
                    mime: Arc::from(b"Message-ID: <ingestion@example.net>\r\n\r\n".as_slice()),
                    size: 64,
                    received_at: Utc::now(),
                    modseq: None,
                    gmail_message_id: None,
                    native_message_id: None,
                    native_thread_id: None,
                }],
            }],
        )
        .unwrap();
        let message_id = state.messages.keys().next().unwrap().clone();
        let repository = Arc::new(MemoryRepository {
            state: std::sync::Mutex::new(state),
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
            provider_work: Some(control),
        });
        let engine = Engine::new(repository, Arc::new(TestCipher), transport);
        let binding = Binding {
            link_id: Uuid::now_v7(),
            sync_generation: 1,
            grant_generation: 1,
        };
        let mut ingestion = Vec::new();
        for _ in 0..16 {
            let mut read = Box::pin(engine.execute_in_class(
                binding,
                Operation::Message {
                    id: message_id.clone(),
                },
                class,
            ));
            assert!(futures::poll!(read.as_mut()).is_pending());
            ingestion.push(read);
        }
        // At least one ingestion reached provider IO and remains blocked there.
        assert_eq!(observed.try_recv().unwrap(), binding.link_id);
        let mut user_read = Box::pin(engine.execute(
            binding,
            Operation::Message {
                id: "missing".into(),
            },
        ));
        let result = match futures::poll!(user_read.as_mut()) {
            std::task::Poll::Ready(result) => result.unwrap(),
            std::task::Poll::Pending => panic!("user reads must not queue behind ingestion"),
        };
        assert!(result.is_null());
        assert_eq!(engine.operation_capacity.available_permits(), 16);
        if matches!(class, OperationClass::Import) {
            let live_read = engine
                .execute_in_class(
                    binding,
                    Operation::Message {
                        id: "missing".into(),
                    },
                    OperationClass::Ingestion,
                )
                .await
                .unwrap();
            assert!(live_read.is_null());
        }
        drop(ingestion);
        assert_eq!(engine.ingestion_capacity.available_permits(), 4);
        assert_eq!(engine.import_capacity.available_permits(), 2);
        assert_eq!(engine.ingestion_waiting.load(Ordering::Relaxed), 0);
        assert_eq!(engine.import_waiting.load(Ordering::Relaxed), 0);
    }
}

#[tokio::test(start_paused = true)]
async fn queued_accounts_rotate_after_stalled_and_cancelled_sync_rounds() {
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
    let engine = Engine::new(repository, Arc::new(TestCipher), transport);
    let bindings = (0..7)
        .map(|_| Binding {
            link_id: Uuid::now_v7(),
            sync_generation: 1,
            grant_generation: 1,
        })
        .collect::<Vec<_>>();
    let mut rounds = Vec::new();
    let began = tokio::time::Instant::now();
    for binding in &bindings {
        let mut round = Box::pin(engine.execute(*binding, Operation::Sync));
        assert!(futures::poll!(round.as_mut()).is_pending());
        rounds.push(Some(round));
    }
    assert_eq!(observed.try_recv().unwrap(), bindings[0].link_id);
    assert_eq!(observed.try_recv().unwrap(), bindings[1].link_id);
    assert!(observed.try_recv().is_err());
    assert_eq!(engine.operation_capacity.available_permits(), 16);

    // Cancelling an active round frees its slot for the oldest waiting account.
    drop(rounds[0].take());
    assert!(futures::poll!(rounds[2].as_mut().unwrap().as_mut()).is_pending());
    assert_eq!(observed.try_recv().unwrap(), bindings[2].link_id);
    let mut next_started = 3;
    let mut completed = 0;
    for _ in 0..3 {
        tokio::time::advance(SYNC_ROUND_BUDGET).await;
        let mut wave_completed = 0;
        for slot in &mut rounds {
            let Some(round) = slot else { continue };
            if let std::task::Poll::Ready(result) = futures::poll!(round.as_mut()) {
                assert_eq!(result, Err(Error::ConnectionUnavailable));
                *slot = None;
                wave_completed += 1;
            }
        }
        assert_eq!(wave_completed, 2, "stalled rounds must release both slots");
        completed += wave_completed;
        let through = (next_started + 2).min(bindings.len());
        for binding in &bindings[next_started..through] {
            assert_eq!(observed.try_recv().unwrap(), binding.link_id);
        }
        assert!(observed.try_recv().is_err());
        next_started = through;
    }
    assert_eq!(completed, bindings.len() - 1);
    assert_eq!(next_started, bindings.len());
    assert!(rounds.iter().all(Option::is_none));
    assert!(began.elapsed() <= SYNC_ROUND_BUDGET * 4);
    assert_eq!(engine.synchronization_capacity.available_permits(), 2);
    assert_eq!(engine.synchronization_waiting.load(Ordering::Relaxed), 0);
}

#[tokio::test]
async fn configured_sync_capacity_bounds_started_rounds_without_limiting_bindings() {
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
    for invalid in [0, 17] {
        assert!(matches!(SyncConcurrency::new(invalid), Err(Error::Invalid)));
    }
    let engine = Engine::new(repository, Arc::new(TestCipher), transport)
        .with_sync_concurrency(SyncConcurrency::new(1).unwrap());
    let first = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let second = Binding {
        link_id: Uuid::now_v7(),
        ..first
    };
    let mut active = Box::pin(engine.execute(first, Operation::Sync));
    let mut queued = Box::pin(engine.execute(second, Operation::Sync));
    assert!(futures::poll!(active.as_mut()).is_pending());
    assert!(futures::poll!(queued.as_mut()).is_pending());
    assert_eq!(observed.try_recv().unwrap(), first.link_id);
    assert!(observed.try_recv().is_err());
    drop(active);
    assert!(futures::poll!(queued.as_mut()).is_pending());
    assert_eq!(observed.try_recv().unwrap(), second.link_id);
    drop(queued);
    assert_eq!(engine.synchronization_waiting.load(Ordering::Relaxed), 0);
    assert_eq!(engine.synchronization_capacity.available_permits(), 1);
}

#[tokio::test(start_paused = true)]
async fn sync_state_loading_counts_toward_the_round_work_budget() {
    let repository = Arc::new(MemoryRepository {
        state: std::sync::Mutex::new(AccountState::default()),
        saved_unknown: AtomicBool::new(false),
        owner_available: AtomicBool::new(true),
        owner_claims: std::sync::atomic::AtomicU32::new(0),
        owner_gate: std::sync::Mutex::new(None),
        owner_errors: std::sync::atomic::AtomicU32::new(0),
        releases: std::sync::atomic::AtomicU32::new(0),
        acquire_gate: Some(Arc::new(tokio::sync::Semaphore::new(0))),
    });
    let transport = Arc::new(UncertainTransport {
        repository: repository.clone(),
        submissions: std::sync::atomic::AtomicU32::new(0),
        deadline: AtomicBool::new(false),
        sent_found: std::sync::Mutex::new(std::collections::BTreeSet::new()),
        submission_deadline: std::sync::Mutex::new(None),
        provider_work: None,
    });
    let engine = Engine::new(repository, Arc::new(TestCipher), transport);
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let mut round = Box::pin(engine.execute(binding, Operation::Sync));
    assert!(futures::poll!(round.as_mut()).is_pending());
    tokio::time::advance(SYNC_ROUND_BUDGET).await;
    match futures::poll!(round.as_mut()) {
        std::task::Poll::Ready(result) => assert_eq!(result, Err(Error::ConnectionUnavailable)),
        std::task::Poll::Pending => panic!("state loading must not extend the sync work budget"),
    }
    assert_eq!(engine.synchronization_capacity.available_permits(), 2);
}

#[tokio::test]
async fn saturation_is_exportable_while_the_admission_wait_is_still_pending() {
    use tracing::instrument::WithSubscriber;
    use tracing_subscriber::prelude::*;
    #[derive(Clone, Default)]
    struct Capture {
        ids: Arc<std::sync::Mutex<std::collections::HashSet<tracing::span::Id>>>,
        closed: Arc<std::sync::atomic::AtomicU32>,
    }
    impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for Capture {
        fn on_new_span(
            &self,
            attrs: &tracing::span::Attributes<'_>,
            id: &tracing::span::Id,
            _: tracing_subscriber::layer::Context<'_, S>,
        ) {
            if attrs.metadata().name() == "imap.admission.saturation" {
                self.ids.lock().unwrap().insert(id.clone());
            }
        }
        fn on_close(&self, id: tracing::span::Id, _: tracing_subscriber::layer::Context<'_, S>) {
            if self.ids.lock().unwrap().remove(&id) {
                self.closed.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
    let capture = Capture::default();
    let subscriber = tracing_subscriber::registry().with(capture.clone());
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
    let engine = Engine::new(repository, Arc::new(TestCipher), transport);
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
    async {
        let mut queued = Box::pin(engine.execute(binding, Operation::Sync));
        assert!(futures::poll!(queued.as_mut()).is_pending());
        engine.report_admission_saturation();
        assert_eq!(capture.closed.load(Ordering::Relaxed), 1);
        assert!(futures::poll!(queued.as_mut()).is_pending());
        drop(queued);
        engine.report_admission_saturation();
        assert_eq!(capture.closed.load(Ordering::Relaxed), 1);
    }
    .with_subscriber(subscriber)
    .await;
    drop(held);
}
