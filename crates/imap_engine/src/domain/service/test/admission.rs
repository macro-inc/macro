use super::*;

#[tokio::test(start_paused = true)]
async fn submission_admission_wait_is_bounded_without_marking_or_sending() {
    let repository = Arc::new(MemoryRepository {
        state: std::sync::Mutex::new(AccountState::default()),
        saved_unknown: AtomicBool::new(false),
        owner_available: AtomicBool::new(true),
    });
    let transport = Arc::new(UncertainTransport {
        repository: repository.clone(),
        submissions: std::sync::atomic::AtomicU32::new(0),
        deadline: AtomicBool::new(false),
        sent_found: std::sync::Mutex::new(std::collections::BTreeSet::new()),
        submission_deadline: std::sync::Mutex::new(None),
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
    });
    let transport = Arc::new(UncertainTransport {
        repository: repository.clone(),
        submissions: std::sync::atomic::AtomicU32::new(0),
        deadline: AtomicBool::new(false),
        sent_found: std::sync::Mutex::new(std::collections::BTreeSet::new()),
        submission_deadline: std::sync::Mutex::new(None),
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
