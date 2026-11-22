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
}
fn fixture(failure: Error) -> Fixture {
    let repository = Arc::new(MemoryRepository {
        state: std::sync::Mutex::new(AccountState::default()),
        saved_unknown: AtomicBool::new(false),
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
            failures: BTreeMap::new(),
            organization: None,
            source: None,
            started,
            released: tokio::sync::Semaphore::new(1),
        })),
    });
    let engine =
        Engine::new(repository.clone(), cipher.clone(), transport).with_notifier(notifier.clone());
    Fixture {
        engine,
        repository,
        cipher,
        notifier,
        provider,
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
