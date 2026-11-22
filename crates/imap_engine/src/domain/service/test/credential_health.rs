use super::*;
use std::sync::atomic::AtomicU32;
use tokio_util::sync::CancellationToken;

struct FailingCipher {
    failure: Error,
    calls: AtomicU32,
    recovered: AtomicBool,
}
#[async_trait::async_trait]
impl CredentialCipher for FailingCipher {
    async fn encrypt(
        &self,
        id: Uuid,
        owner: &str,
        credentials: &Credentials,
    ) -> Result<Vec<u8>, Error> {
        TestCipher.encrypt(id, owner, credentials).await
    }
    async fn decrypt(
        &self,
        id: Uuid,
        owner: &str,
        ciphertext: &[u8],
    ) -> Result<Credentials, Error> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        if self.recovered.load(Ordering::Acquire) {
            return TestCipher.decrypt(id, owner, ciphertext).await;
        }
        Err(self.failure)
    }
}
#[derive(Default)]
struct RecordingNotifier(std::sync::Mutex<Vec<Notification>>, AtomicU32);
#[async_trait::async_trait]
impl Notifier for RecordingNotifier {
    async fn notify(&self, notification: Notification) -> Result<(), Error> {
        if self
            .1
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| n.checked_sub(1))
            .is_ok()
        {
            return Err(Error::ConnectionUnavailable);
        }
        self.0.lock().unwrap().push(notification);
        Ok(())
    }
}
struct Fixture {
    engine: Engine,
    repository: Arc<MemoryRepository>,
    cipher: Arc<FailingCipher>,
    notifier: Arc<RecordingNotifier>,
    provider: tokio::sync::mpsc::UnboundedReceiver<Uuid>,
    binding: Binding,
    transport: Arc<UncertainTransport>,
}
fn fixture(failure: Error) -> Fixture {
    let repository = Arc::new(MemoryRepository {
        revision: Default::default(),
        scoped_acquire_errors: Default::default(),
        state: std::sync::Mutex::new(AccountState::default()),
        saved_unknown: AtomicBool::new(false),
        command_leases: None,
        owner_available: AtomicBool::new(true),
        owner_claims: AtomicU32::new(0),
        owner_gate: std::sync::Mutex::new(None),
        owner_errors: AtomicU32::new(0),
        releases: AtomicU32::new(0),
        acquire_gate: None,
    });
    let cipher = Arc::new(FailingCipher {
        failure,
        calls: AtomicU32::new(0),
        recovered: AtomicBool::new(false),
    });
    let notifier = Arc::new(RecordingNotifier::default());
    let (started, provider) = tokio::sync::mpsc::unbounded_channel();
    let transport = Arc::new(UncertainTransport {
        repository: repository.clone(),
        submissions: AtomicU32::new(0),
        deadline: AtomicBool::new(false),
        sent_found: Default::default(),
        submission_deadline: Default::default(),
        refusal: None,
        provider_work: Some(Arc::new(ProviderWorkControl {
            idle: None,
            failures: BTreeMap::new(),
            organization: None,
            source: None,
            started,
            released: tokio::sync::Semaphore::new(1),
        })),
    });
    let engine = Engine::new(repository.clone(), cipher.clone(), transport.clone())
        .with_notifier(notifier.clone());
    Fixture {
        engine,
        repository,
        cipher,
        notifier,
        provider,
        transport,
        binding: Binding {
            link_id: Uuid::now_v7(),
            sync_generation: 1,
            grant_generation: 1,
        },
    }
}

#[tokio::test(start_paused = true)]
async fn permanently_unreadable_credentials_park_without_claiming_a_provider_rejection() {
    let Fixture {
        engine,
        repository,
        cipher,
        notifier,
        mut provider,
        binding,
        ..
    } = fixture(Error::CredentialsUnreadable);
    let cancel = CancellationToken::new();
    let mut actor = Box::pin(engine.run_account(binding, cancel));
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert_eq!(cipher.calls.load(Ordering::Relaxed), 1);
    tokio::time::advance(std::time::Duration::from_secs(31)).await;
    let result = tokio::time::timeout(std::time::Duration::from_secs(1), actor).await;
    assert_eq!(result.unwrap(), Err(Error::CredentialsUnreadable));
    assert_eq!(cipher.calls.load(Ordering::Relaxed), 2);
    assert!(provider.try_recv().is_err());
    let state = repository.state.lock().unwrap();
    assert!(state.needs_reauth);
    assert_eq!(
        state.mailbox_issue,
        Some(models_email::service::link::MailboxIssue::CredentialsUnreadable)
    );
    let notices = notifier.0.lock().unwrap();
    assert_eq!(notices.len(), 1);
    assert!(!notices[0].credentials_rejected);
    assert_eq!(notices[0].mailbox_issue, state.mailbox_issue);
}

#[tokio::test(start_paused = true)]
async fn transient_kms_outages_keep_retrying_and_resume_without_reconnect() {
    let Fixture {
        engine,
        repository,
        cipher,
        notifier,
        mut provider,
        binding,
        ..
    } = fixture(Error::CredentialsUnavailable);
    let cancel = CancellationToken::new();
    let mut actor = Box::pin(engine.run_account(binding, cancel.clone()));
    assert!(futures::poll!(actor.as_mut()).is_pending());
    for _ in 0..3 {
        tokio::time::advance(std::time::Duration::from_secs(3600)).await;
        assert!(futures::poll!(actor.as_mut()).is_pending());
        assert!(!repository.state.lock().unwrap().needs_reauth);
        assert!(repository.state.lock().unwrap().mailbox_issue.is_none());
        assert!(notifier.0.lock().unwrap().is_empty());
    }
    assert!(provider.try_recv().is_err());
    cipher.recovered.store(true, Ordering::Release);
    tokio::time::advance(std::time::Duration::from_secs(3600)).await;
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert_eq!(provider.try_recv().unwrap(), binding.link_id);
    assert!(!repository.state.lock().unwrap().needs_reauth);
    cancel.cancel();
    assert!(actor.await.is_ok());
}

#[tokio::test(start_paused = true)]
async fn reconnect_health_retries_delivery_without_reopening_the_provider() {
    let Fixture {
        engine,
        repository,
        cipher,
        notifier,
        mut provider,
        binding,
        ..
    } = fixture(Error::CredentialsUnreadable);
    notifier.1.store(1, Ordering::Release);
    let cancel = CancellationToken::new();
    let mut actor = Box::pin(engine.run_account(binding, cancel));
    assert!(futures::poll!(actor.as_mut()).is_pending());
    tokio::time::advance(std::time::Duration::from_secs(31)).await;
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert!(repository.state.lock().unwrap().notification_pending);
    let releases = repository.releases.load(Ordering::Relaxed);
    tokio::time::advance(std::time::Duration::from_secs(5)).await;
    assert_eq!(actor.await, Err(Error::CredentialsUnreadable));
    assert_eq!(cipher.calls.load(Ordering::Relaxed), 2);
    assert!(provider.try_recv().is_err());
    assert!(repository.releases.load(Ordering::Relaxed) > releases);
    assert!(!repository.state.lock().unwrap().notification_pending);
    assert_eq!(notifier.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn parked_credentials_keep_their_distinct_reason_on_later_reads() {
    let Fixture {
        engine,
        repository,
        binding,
        ..
    } = fixture(Error::CredentialsUnavailable);
    {
        let mut state = repository.state.lock().unwrap();
        state.needs_reauth = true;
        state.mailbox_issue =
            Some(models_email::service::link::MailboxIssue::CredentialsUnreadable);
    }
    assert!(matches!(
        engine.execute(binding, Operation::Folders).await,
        Err(Error::CredentialsUnreadable)
    ));
    assert!(matches!(
        engine
            .execute(binding, Operation::RecentInbox { limit: 1 })
            .await,
        Err(Error::CredentialsUnreadable)
    ));
}

#[tokio::test(start_paused = true)]
async fn recovery_notification_is_delivered_after_restart_before_decrypt_or_provider_io() {
    let Fixture {
        engine,
        repository,
        cipher,
        notifier,
        mut provider,
        binding,
        ..
    } = fixture(Error::CredentialsUnavailable);
    {
        let mut state = repository.state.lock().unwrap();
        state.needs_reauth = true;
        state.notification_pending = true;
        state.mailbox_issue =
            Some(models_email::service::link::MailboxIssue::CredentialsUnreadable);
    }
    let cancel = CancellationToken::new();
    let mut actor = Box::pin(engine.run_account(binding, cancel.clone()));
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert_eq!(notifier.0.lock().unwrap().len(), 1);
    assert_eq!(cipher.calls.load(Ordering::Relaxed), 0);
    assert!(provider.try_recv().is_err());
    assert!(!repository.state.lock().unwrap().notification_pending);
    cancel.cancel();
    assert!(actor.await.is_ok());
}

#[tokio::test(start_paused = true)]
async fn failed_host_hint_is_flushed_before_idle_without_waiting_for_another_snapshot() {
    let Fixture {
        engine,
        repository,
        cipher,
        notifier,
        mut provider,
        binding,
        ..
    } = fixture(Error::CredentialsUnavailable);
    cipher.recovered.store(true, Ordering::Release);
    // The host is unavailable while a new snapshot is committed.
    notifier.1.store(20, Ordering::Release);
    let cancel = CancellationToken::new();
    let mut actor = Box::pin(engine.run_account(binding, cancel.clone()));
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert_eq!(provider.try_recv().unwrap(), binding.link_id);
    assert!(repository.state.lock().unwrap().notification_pending);
    assert!(notifier.0.lock().unwrap().is_empty());

    // Host readiness must unblock durable delivery, even when the next
    // snapshot cannot complete (the transport permits only the first scan).
    notifier.1.store(0, Ordering::Release);
    tokio::time::advance(std::time::Duration::from_secs(5)).await;
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert_eq!(notifier.0.lock().unwrap().len(), 1);
    assert!(!repository.state.lock().unwrap().notification_pending);
    cancel.cancel();
    assert!(actor.await.is_ok());
}

#[tokio::test(start_paused = true)]
async fn unavailable_host_hint_does_not_block_the_next_provider_round() {
    let mut fixture = fixture(Error::CredentialsUnavailable);
    fixture.cipher.recovered.store(true, Ordering::Release);
    fixture.notifier.1.store(u32::MAX, Ordering::Release);
    let cancel = CancellationToken::new();
    let mut actor = Box::pin(fixture.engine.run_account(fixture.binding, cancel.clone()));
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert_eq!(
        fixture.provider.try_recv().unwrap(),
        fixture.binding.link_id
    );
    fixture
        .transport
        .provider_work
        .as_ref()
        .unwrap()
        .released
        .add_permits(1);
    fixture.engine.wake_account(fixture.binding.link_id);
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert_eq!(
        fixture.provider.try_recv().unwrap(),
        fixture.binding.link_id
    );
    assert!(
        fixture
            .repository
            .state
            .lock()
            .unwrap()
            .notification_pending
    );
    assert!(fixture.notifier.0.lock().unwrap().is_empty());
    cancel.cancel();
    assert!(actor.await.is_ok());
}

#[tokio::test]
async fn an_ack_for_an_older_snapshot_keeps_the_newer_host_hint_pending() {
    struct ConcurrentSnapshot(Arc<MemoryRepository>, AtomicBool);
    #[async_trait::async_trait]
    impl Notifier for ConcurrentSnapshot {
        async fn notify(&self, _: Notification) -> Result<(), Error> {
            if !self.1.swap(true, Ordering::AcqRel) {
                // A second committed state arrives while HTTP has no lease.
                self.0.revision.fetch_add(1, Ordering::AcqRel);
                self.0.state.lock().unwrap().notification_pending = true;
            }
            Ok(())
        }
    }
    let mut fixture = fixture(Error::CredentialsUnavailable);
    fixture
        .repository
        .state
        .lock()
        .unwrap()
        .notification_pending = true;
    fixture.engine.notifier = Some(Arc::new(ConcurrentSnapshot(
        fixture.repository.clone(),
        AtomicBool::new(false),
    )));
    let owner = Uuid::now_v7();
    let result = fixture
        .engine
        .flush_host_hint_once(fixture.binding, owner, 1, &mut 0, &mut None)
        .await
        .unwrap();
    assert!(matches!(
        result,
        crate::domain::service::host_notifications::HintOutcome::Pending
    ));
    assert!(
        fixture
            .repository
            .state
            .lock()
            .unwrap()
            .notification_pending
    );
    let result = fixture
        .engine
        .flush_host_hint_once(fixture.binding, owner, 2, &mut 5, &mut None)
        .await
        .unwrap();
    assert!(matches!(
        result,
        crate::domain::service::host_notifications::HintOutcome::Acknowledged
    ));
    assert!(
        !fixture
            .repository
            .state
            .lock()
            .unwrap()
            .notification_pending
    );
}

#[tokio::test]
async fn an_ack_is_not_resent_when_clearing_it_meets_local_contention() {
    use crate::domain::service::host_notifications::HintOutcome;
    let fixture = fixture(Error::CredentialsUnavailable);
    {
        let mut state = fixture.repository.state.lock().unwrap();
        state.mark_notification_pending();
        state.notification_pending_since = Some(Utc::now() - chrono::Duration::hours(1));
    }
    fixture
        .repository
        .scoped_acquire_errors
        .store(1, Ordering::Release);
    let owner = Uuid::now_v7();
    let mut acked = None;
    assert_eq!(
        fixture
            .engine
            .flush_host_hint_once(fixture.binding, owner, 1, &mut 0, &mut acked)
            .await
            .err(),
        Some(Error::AccountBusy)
    );
    assert_eq!(fixture.notifier.0.lock().unwrap().len(), 1);
    assert!(
        fixture
            .repository
            .state
            .lock()
            .unwrap()
            .notification_pending
    );
    assert!(matches!(
        fixture
            .engine
            .flush_host_hint_once(fixture.binding, owner, 2, &mut 5, &mut acked)
            .await
            .unwrap(),
        HintOutcome::Acknowledged
    ));
    assert_eq!(
        fixture.notifier.0.lock().unwrap().len(),
        1,
        "retry only the fenced clear after an ACK"
    );
    assert!(
        !fixture
            .repository
            .state
            .lock()
            .unwrap()
            .notification_pending
    );
    assert!(
        fixture
            .repository
            .state
            .lock()
            .unwrap()
            .notification_pending_since
            .is_none()
    );
}

#[tokio::test]
async fn a_hint_task_fenced_by_an_owner_move_stops_cleanly_without_delivery() {
    let fixture = fixture(Error::CredentialsUnavailable);
    fixture
        .repository
        .state
        .lock()
        .unwrap()
        .mark_notification_pending();
    fixture
        .repository
        .owner_available
        .store(false, Ordering::Release);
    let stopped = CancellationToken::new();
    let changed = Arc::new(tokio::sync::Notify::new());
    fixture
        .engine
        .retry_host_hints(fixture.binding, Uuid::now_v7(), &stopped, &changed)
        .await
        .unwrap();
    assert!(fixture.notifier.0.lock().unwrap().is_empty());
    assert!(
        fixture
            .repository
            .state
            .lock()
            .unwrap()
            .notification_pending
    );
}

#[test]
fn pending_age_survives_small_state_serialization_and_repeated_wakes() {
    let mut state = AccountState::default();
    state.mark_notification_pending();
    let since = Utc::now() - chrono::Duration::hours(1);
    state.notification_pending_since = Some(since);
    state.mark_notification_pending();
    let encoded = serde_json::to_value(state.small_state()).unwrap();
    let restored: AccountState = serde_json::from_value(encoded).unwrap();
    assert_eq!(restored.notification_pending_since, Some(since));
    assert!(restored.notification_pending);
}

#[tokio::test]
async fn the_stalled_hint_monitor_uses_durable_age_after_an_actor_restart() {
    use std::io::Write;
    use tracing::instrument::WithSubscriber;
    #[derive(Clone)]
    struct Capture(Arc<std::sync::Mutex<Vec<u8>>>);
    impl Write for Capture {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let fixture = fixture(Error::CredentialsUnavailable);
    {
        let mut state = fixture.repository.state.lock().unwrap();
        state.mark_notification_pending();
        state.notification_pending_since = Some(Utc::now() - chrono::Duration::hours(1));
    }
    fixture.notifier.1.store(1, Ordering::Release);
    let bytes = Arc::new(std::sync::Mutex::new(Vec::new()));
    let writer = Capture(bytes.clone());
    let subscriber = tracing_subscriber::fmt()
        .without_time()
        .with_ansi(false)
        .with_span_events(tracing_subscriber::fmt::format::FmtSpan::CLOSE)
        .with_writer(move || writer.clone())
        .finish();
    let mut acked = None;
    let mut age = 0;
    assert!(
        fixture
            .engine
            .flush_host_hint_once(fixture.binding, Uuid::now_v7(), 1, &mut age, &mut acked)
            .with_subscriber(subscriber)
            .await
            .is_err()
    );
    assert!(
        age >= 3600,
        "the actor warning must receive the persisted pending age"
    );
    let output = String::from_utf8(bytes.lock().unwrap().clone()).unwrap();
    assert!(
        output.contains("notification.pending_too_long=true"),
        "{output}"
    );
}
