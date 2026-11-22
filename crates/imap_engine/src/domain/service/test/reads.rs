use super::fakes::OrganizationWorkControl;
use super::*;

struct ReadFixture {
    engine: Engine,
    repository: Arc<MemoryRepository>,
    control: Arc<ProviderWorkControl>,
    observed: tokio::sync::mpsc::UnboundedReceiver<Uuid>,
    binding: Binding,
    message_id: String,
}
fn read_fixture(
    source: Vec<u8>,
    failures: BTreeMap<u32, Error>,
    organization: Option<Arc<OrganizationWorkControl>>,
) -> ReadFixture {
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
    let (started, observed) = tokio::sync::mpsc::unbounded_channel();
    let control = Arc::new(ProviderWorkControl {
        failures,
        organization,
        source: Some(source),
        started,
        released: tokio::sync::Semaphore::new(0),
    });
    let transport = Arc::new(UncertainTransport {
        repository: repository.clone(),
        submissions: std::sync::atomic::AtomicU32::new(0),
        deadline: AtomicBool::new(false),
        sent_found: std::sync::Mutex::new(std::collections::BTreeSet::new()),
        submission_deadline: std::sync::Mutex::new(None),
        refusal: None,
        provider_work: Some(control.clone()),
    });
    let engine = Engine::new(repository.clone(), Arc::new(TestCipher), transport);
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    ReadFixture {
        engine,
        repository,
        control,
        observed,
        binding,
        message_id,
    }
}

#[tokio::test]
async fn remote_message_results_recheck_access_after_io() {
    for (lost_owner, needs_reauth) in [(false, false), (true, false), (false, true)] {
        let ReadFixture {
            engine,
            repository,
            control,
            mut observed,
            binding,
            message_id,
        } = read_fixture(
            b"Message-ID: <ingestion@example.net>\r\nSubject: Synthetic\r\n\r\nTest body".to_vec(),
            BTreeMap::new(),
            None,
        );
        let mut reading = Box::pin(engine.execute(binding, Operation::Message { id: message_id }));
        assert!(futures::poll!(reading.as_mut()).is_pending());
        assert_eq!(observed.try_recv().unwrap(), binding.link_id);
        repository
            .owner_available
            .store(!lost_owner, Ordering::Release);
        repository.state.lock().unwrap().needs_reauth = needs_reauth;
        control.released.add_permits(1);
        let result = reading.await;
        if lost_owner {
            assert!(matches!(result, Err(Error::Conflict)));
        } else if needs_reauth {
            assert!(matches!(result, Err(Error::CredentialsRejected)));
        } else {
            let message: Message = serde_json::from_value(result.unwrap()).unwrap();
            assert!(message.source_complete);
            assert!(
                String::from_utf8(STANDARD.decode(message.mime_base64).unwrap())
                    .unwrap()
                    .contains("Test body")
            );
        }
        assert_eq!(repository.releases.load(Ordering::Relaxed), 0);
    }
}

#[tokio::test]
async fn oversized_sources_are_not_fetched_or_retried_when_the_size_is_known() {
    let ReadFixture {
        engine,
        repository,
        control,
        mut observed,
        binding,
        message_id,
    } = read_fixture(vec![b'x'; 26 * 1024 * 1024], BTreeMap::new(), None);
    repository
        .state
        .lock()
        .unwrap()
        .messages
        .get_mut(&message_id)
        .unwrap()
        .size = 26 * 1024 * 1024;
    control.released.add_permits(2);
    let result = engine
        .execute(binding, Operation::Message { id: message_id })
        .await;
    assert!(matches!(result, Err(Error::MessageTooLarge)));
    assert!(
        observed.try_recv().is_err(),
        "known oversized content must not be downloaded"
    );
}

#[tokio::test]
async fn recent_inbox_defers_one_busy_body_without_restarting_the_batch() {
    let ReadFixture {
        engine,
        repository,
        control,
        mut observed,
        binding,
        message_id,
    } = read_fixture(
        b"Message-ID: <synthetic@example.net>\r\n\r\nTest body".to_vec(),
        BTreeMap::from([(2, Error::AccountBusy)]),
        None,
    );
    {
        let mut state = repository.state.lock().unwrap();
        let original = state.messages.get(&message_id).unwrap().clone();
        let location = state.locations.first().unwrap().clone();
        for uid in [2, 3] {
            let id = format!("m:{uid}");
            state.messages.insert(
                id.clone(),
                Message {
                    id: id.clone(),
                    received_at: original.received_at - Duration::seconds(i64::from(uid)),
                    ..original.clone()
                },
            );
            state.locations.push(Location {
                uid,
                message_id: id,
                ..location.clone()
            });
        }
    }
    control.released.add_permits(8);
    let messages: Vec<Message> = serde_json::from_value(
        engine
            .execute(binding, Operation::RecentInbox { limit: 3 })
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        messages
            .iter()
            .map(|message| message.id.as_str())
            .collect::<Vec<_>>(),
        vec![message_id.as_str(), "m:3"]
    );
    assert!(messages.iter().all(|message| message.source_complete));
    assert_eq!(std::iter::from_fn(|| observed.try_recv().ok()).count(), 4);
}

#[tokio::test]
async fn a_busy_followup_after_a_provider_write_never_replays_the_action() {
    let organization = Arc::new(OrganizationWorkControl {
        writes: std::sync::atomic::AtomicU32::new(0),
        seen: AtomicBool::new(false),
        busy_after_write: AtomicBool::new(true),
    });
    let ReadFixture {
        engine,
        binding,
        message_id,
        ..
    } = read_fixture(Vec::new(), BTreeMap::new(), Some(organization.clone()));
    let result = engine
        .execute(
            binding,
            Operation::Apply {
                id: message_id,
                request: ActionRequest {
                    action: serde_json::json!({"action":"set_read","value":true}),
                    expected_version: None,
                },
            },
        )
        .await;
    assert!(matches!(result, Err(Error::ConnectionUnavailable)));
    assert_eq!(organization.writes.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn an_underreported_oversized_source_is_fetched_once_and_never_retried() {
    let ReadFixture {
        engine,
        control,
        mut observed,
        binding,
        message_id,
        ..
    } = read_fixture(vec![b'x'; 26 * 1024 * 1024], BTreeMap::new(), None);
    control.released.add_permits(2);
    let result = engine
        .execute(binding, Operation::Message { id: message_id })
        .await;
    assert!(matches!(result, Err(Error::MessageTooLarge)));
    assert_eq!(observed.try_recv().unwrap(), binding.link_id);
    assert!(observed.try_recv().is_err());
}

#[tokio::test]
async fn an_all_busy_recent_batch_retries_only_deferred_items_and_reports_busy() {
    let ReadFixture {
        engine,
        control,
        mut observed,
        binding,
        ..
    } = read_fixture(
        b"Message-ID: <synthetic@example.net>\r\n\r\nTest body".to_vec(),
        BTreeMap::from([(1, Error::AccountBusy)]),
        None,
    );
    control.released.add_permits(2);
    let result = engine
        .execute(binding, Operation::RecentInbox { limit: 3 })
        .await;
    assert!(matches!(result, Err(Error::AccountBusy)));
    assert_eq!(std::iter::from_fn(|| observed.try_recv().ok()).count(), 2);
}

#[tokio::test]
async fn oversized_sync_preserves_the_complete_index_and_projects_health_without_reauth() {
    let ReadFixture {
        engine,
        repository,
        control,
        binding,
        observed: _observed,
        message_id,
        ..
    } = read_fixture(
        Vec::new(),
        BTreeMap::from([(0, Error::SnapshotTooLarge)]),
        None,
    );
    control.released.add_permits(1);
    let mut account = repository.acquire(binding).await.unwrap();
    let before = serde_json::to_value(&account.state.messages).unwrap();
    assert_eq!(
        engine.refresh(&mut account).await,
        Err(Error::SnapshotTooLarge)
    );
    let state = repository.state.lock().unwrap();
    assert_eq!(
        state.mailbox_issue,
        Some(models_email::service::link::MailboxIssue::SnapshotTooLarge)
    );
    assert!(!state.needs_reauth);
    assert!(state.notification_pending);
    assert_eq!(serde_json::to_value(&state.messages).unwrap(), before);
    assert!(state.messages.contains_key(&message_id));
}

#[tokio::test]
async fn a_complete_sync_clears_the_previous_size_issue() {
    let ReadFixture {
        engine,
        repository,
        control,
        binding,
        observed: _observed,
        ..
    } = read_fixture(Vec::new(), BTreeMap::new(), None);
    {
        let mut state = repository.state.lock().unwrap();
        state.mailbox_issue = Some(models_email::service::link::MailboxIssue::SnapshotTooLarge);
        state.sync_size_failures = 5;
        state.sync_retry_at = Some(Utc::now() - chrono::Duration::seconds(1));
    }
    control.released.add_permits(1);
    let mut account = repository.acquire(binding).await.unwrap();
    engine.refresh(&mut account).await.unwrap();
    let state = repository.state.lock().unwrap();
    assert_eq!(state.mailbox_issue, None);
    assert_eq!(state.sync_retry_at, None);
    assert_eq!(state.sync_size_failures, 0);
}

#[tokio::test]
async fn oversized_snapshots_transfer_once_per_growing_durable_backoff_window() {
    let ReadFixture {
        engine,
        repository,
        control,
        binding,
        mut observed,
        ..
    } = read_fixture(
        Vec::new(),
        BTreeMap::from([(0, Error::SnapshotTooLarge)]),
        None,
    );
    control.released.add_permits(10);
    let start = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
    let mut next = start;
    for hours in [1, 2, 4, 8, 16, 24, 24] {
        // Re-acquire persisted state as a fresh actor/replica would do.
        let mut account = repository.acquire(binding).await.unwrap();
        assert_eq!(
            engine.refresh_at(&mut account, next).await,
            Err(Error::SnapshotTooLarge)
        );
        assert_eq!(observed.try_recv().unwrap(), binding.link_id);
        let deadline = next + chrono::Duration::hours(hours);
        assert_eq!(
            repository.state.lock().unwrap().sync_retry_at,
            Some(deadline)
        );
        for offset in [1, hours * 1800, hours * 3600 - 1] {
            let mut reloaded = repository.acquire(binding).await.unwrap();
            assert_eq!(
                engine
                    .refresh_at(&mut reloaded, next + chrono::Duration::seconds(offset))
                    .await,
                Err(Error::SnapshotTooLarge)
            );
            assert!(observed.try_recv().is_err());
        }
        next = deadline;
    }
    // The fenced preference write clears only the deadline. A wake may make
    // one new attempt, then repeated wakeups use its next durable window.
    repository.state.lock().unwrap().sync_retry_at = None;
    let changed_at = next - chrono::Duration::hours(12);
    let mut changed = repository.acquire(binding).await.unwrap();
    assert_eq!(
        engine.refresh_at(&mut changed, changed_at).await,
        Err(Error::SnapshotTooLarge)
    );
    assert_eq!(observed.try_recv().unwrap(), binding.link_id);
    let mut woken_again = repository.acquire(binding).await.unwrap();
    assert_eq!(
        engine.refresh_at(&mut woken_again, changed_at).await,
        Err(Error::SnapshotTooLarge)
    );
    assert!(observed.try_recv().is_err());
}
