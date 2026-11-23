use super::*;
use std::collections::VecDeque;

pub(crate) struct SnapshotTransport(pub(crate) std::sync::Mutex<VecDeque<Vec<RemoteFolder>>>);
#[async_trait::async_trait]
impl MailTransport for SnapshotTransport {
    async fn snapshot(
        &self,
        _: &Credentials,
        _: &AccountState,
    ) -> Result<Vec<RemoteFolder>, Error> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .pop_front()
            .expect("scripted snapshot"))
    }
    async fn disconnect(&self, _: Binding) -> Result<(), Error> {
        Ok(())
    }
    async fn verify(&self, _: &Credentials) -> Result<(), Error> {
        Err(Error::Invalid)
    }
    async fn message(
        &self,
        _: &Credentials,
        _: &str,
        _: u32,
        _: u32,
    ) -> Result<Option<RemoteMessage>, Error> {
        Err(Error::Invalid)
    }
    async fn source(&self, _: &Credentials, _: &str, _: u32, _: u32) -> Result<Vec<u8>, Error> {
        Err(Error::Invalid)
    }
    async fn wait_change(
        &self,
        _: &Credentials,
        _: &[FolderState],
        _: u64,
    ) -> Result<WaitOutcome, Error> {
        Err(Error::Invalid)
    }
    async fn wait_folder(
        &self,
        _: &Credentials,
        _: &FolderState,
        _: u64,
    ) -> Result<WaitOutcome, Error> {
        Err(Error::Invalid)
    }
    async fn apply(
        &self,
        _: &Credentials,
        _: &str,
        _: u32,
        _: u32,
        _: RemoteAction,
    ) -> Result<RemoteWriteReceipt, ApplyError> {
        Err(ApplyError::NotStarted(Error::Invalid))
    }
    async fn submit(
        &self,
        _: &Credentials,
        _: &str,
        _: &[String],
        _: &[u8],
        _: tokio::time::Instant,
    ) -> Result<TransportSubmission, Error> {
        Err(Error::Invalid)
    }
    async fn save_sent(&self, _: &Credentials, _: &str, _: &[u8], _: bool) -> Result<bool, Error> {
        Err(Error::Invalid)
    }
}

pub(crate) fn inbox(count: u32, uid_next: u32) -> Vec<RemoteFolder> {
    vec![RemoteFolder {
        virtual_label: None, uid_next: Some(uid_next), phantom: None, detected_role: None,
        monitored: true,
        folder: Folder { sync_enabled: true, id: "inbox".into(), parent_id: None,
            name: "INBOX".into(), role: FolderRole::Inbox, has_children: false, total_items: Some(count) },
        path: "INBOX".into(), uid_validity: 1, highest_modseq: None, sync_tier: SyncTier::Full,
        messages: (1..=count).map(|uid| RemoteMessage {
            gmail_labels: None, uid, flags: Vec::new(),
            mime: format!("From: sender@example.net\r\nTo: owner@example.net\r\nMessage-ID: <{uid}@example.net>\r\nSubject: example\r\n\r\n").into_bytes().into(),
            size: 200, received_at: Utc.timestamp_opt(1_700_000_000, 0).unwrap(), modseq: None,
            gmail_message_id: None, native_message_id: Some(format!("native:{uid}")), native_thread_id: Some(format!("thread:{uid}")),
        }).collect(),
    }]
}

struct Fixture {
    engine: Engine,
    repository: Arc<MemoryRepository>,
    notifier: Arc<RecordingNotifier>,
    binding: Binding,
}
fn fixture(snapshots: Vec<Vec<RemoteFolder>>) -> Fixture {
    let repository = Arc::new(MemoryRepository {
        renewal: Default::default(),
        revision: Default::default(),
        scoped_acquire_errors: Default::default(),
        owner_claims: Default::default(),
        owner_gate: Default::default(),
        owner_errors: Default::default(),
        releases: Default::default(),
        acquire_gate: None,
        command_leases: None,
        owner_available: AtomicBool::new(true),
        state: Default::default(),
        saved_unknown: AtomicBool::new(false),
    });
    let notifier = Arc::new(RecordingNotifier::default());
    let engine = Engine::new(
        crate::domain::service::VerificationScopeKey::derive("synthetic-test-auth-key").unwrap(),
        repository.clone(),
        Arc::new(TestCipher),
        Arc::new(SnapshotTransport(std::sync::Mutex::new(snapshots.into()))),
        tokio_util::task::TaskTracker::new(),
        tokio_util::sync::CancellationToken::new(),
    )
    .with_notifier(notifier.clone());
    Fixture {
        engine,
        repository,
        notifier,
        binding: Binding {
            link_id: Uuid::now_v7(),
            sync_generation: 1,
            grant_generation: 1,
        },
    }
}

#[tokio::test]
async fn unchanged_sync_does_not_save_or_notify() {
    let f = fixture(vec![inbox(2, 3), inbox(2, 3)]);
    f.engine.execute(f.binding, Operation::Sync).await.unwrap();
    let revision = f.repository.revision.load(Ordering::Acquire);
    f.engine.execute(f.binding, Operation::Sync).await.unwrap();
    assert_eq!(f.repository.revision.load(Ordering::Acquire), revision);
    assert_eq!(f.notifier.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn baseline_only_change_is_saved_without_notification() {
    let f = fixture(vec![inbox(2, 3), inbox(2, 4)]);
    f.engine.execute(f.binding, Operation::Sync).await.unwrap();
    let revision = f.repository.revision.load(Ordering::Acquire);
    f.engine.execute(f.binding, Operation::Sync).await.unwrap();
    assert_eq!(f.repository.revision.load(Ordering::Acquire), revision + 1);
    assert_eq!(
        f.repository.state.lock().unwrap().folders["inbox"].uid_next,
        Some(4)
    );
    assert_eq!(f.notifier.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn failed_hint_survives_quiet_sync_without_a_new_revision() {
    let f = fixture(vec![inbox(2, 3), inbox(2, 3)]);
    f.notifier.1.store(1, Ordering::Release);
    f.engine.execute(f.binding, Operation::Sync).await.unwrap();
    let revision = f.repository.revision.load(Ordering::Acquire);
    let pending_since = f
        .repository
        .state
        .lock()
        .unwrap()
        .notification_pending_since;
    f.engine.execute(f.binding, Operation::Sync).await.unwrap();
    assert_eq!(f.repository.revision.load(Ordering::Acquire), revision);
    let state = f.repository.state.lock().unwrap();
    assert!(state.notification_pending);
    assert_eq!(state.notification_pending_since, pending_since);
    drop(state);
    let mut age = 0;
    let mut acked = None;
    f.engine
        .flush_host_hint_once(f.binding, Uuid::now_v7(), 3, &mut age, &mut acked)
        .await
        .unwrap();
    assert!(!f.repository.state.lock().unwrap().notification_pending);
    assert_eq!(f.notifier.0.lock().unwrap()[0].revision, Some(revision));
}

#[tokio::test(start_paused = true)]
async fn quiet_sync_does_not_bypass_a_pending_hints_retry_backoff() {
    let f = fixture(vec![inbox(2, 3), inbox(2, 3)]);
    f.notifier.1.store(3, Ordering::Release);
    f.engine.execute(f.binding, Operation::Sync).await.unwrap();
    let revision = f.repository.revision.load(Ordering::Acquire);
    let stopped = tokio_util::sync::CancellationToken::new();
    let changed = Arc::new(tokio::sync::Notify::new());
    let retries = f
        .engine
        .retry_host_hints(f.binding, Uuid::now_v7(), &stopped, &changed);
    tokio::pin!(retries);
    assert!(futures::poll!(&mut retries).is_pending());
    assert_eq!(f.notifier.1.load(Ordering::Acquire), 1);
    f.engine.execute(f.binding, Operation::Sync).await.unwrap();
    assert_eq!(
        f.notifier.1.load(Ordering::Acquire),
        1,
        "quiet Sync must leave the retry delay intact"
    );
    assert_eq!(f.repository.revision.load(Ordering::Acquire), revision);
    tokio::time::advance(std::time::Duration::from_secs(5)).await;
    assert!(futures::poll!(&mut retries).is_pending());
    assert_eq!(f.notifier.1.load(Ordering::Acquire), 0);
    tokio::time::advance(std::time::Duration::from_secs(10)).await;
    assert!(futures::poll!(&mut retries).is_pending());
    assert_eq!(f.notifier.0.lock().unwrap().len(), 1);
    assert!(!f.repository.state.lock().unwrap().notification_pending);
    stopped.cancel();
    retries.await.unwrap();
}

#[tokio::test]
async fn health_recovery_notifies_even_when_the_snapshot_is_unchanged() {
    let f = fixture(vec![inbox(2, 3), inbox(2, 3)]);
    f.engine.execute(f.binding, Operation::Sync).await.unwrap();
    {
        let mut state = f.repository.state.lock().unwrap();
        state.mailbox_issue = Some(models_email::service::link::MailboxIssue::SnapshotTooLarge);
        state.sync_size_failures = 3;
    }
    let revision = f.repository.revision.load(Ordering::Acquire);
    f.engine.execute(f.binding, Operation::Sync).await.unwrap();
    assert_eq!(f.repository.revision.load(Ordering::Acquire), revision + 2);
    assert_eq!(f.notifier.0.lock().unwrap().len(), 2);
    let state = f.repository.state.lock().unwrap();
    assert!(state.mailbox_issue.is_none());
    assert_eq!(state.sync_size_failures, 0);
}

#[tokio::test]
async fn folder_rename_epoch_reset_and_removal_notify_without_messages() {
    let mut renamed = inbox(0, 1);
    renamed[0].folder.name = "Renamed".into();
    let mut reset = inbox(0, 1);
    reset[0].folder.name = "Renamed".into();
    reset[0].uid_validity = 2;
    let f = fixture(vec![inbox(0, 1), renamed, reset, Vec::new()]);
    for _ in 0..4 {
        f.engine.execute(f.binding, Operation::Sync).await.unwrap();
    }
    assert_eq!(f.notifier.0.lock().unwrap().len(), 4);
    assert!(f.repository.state.lock().unwrap().folders.is_empty());
}

#[tokio::test]
async fn flag_change_advances_the_journal_once() {
    let mut seen = inbox(1, 2);
    seen[0].messages[0].flags.push("\\Seen".into());
    let mut repeated = inbox(1, 2);
    repeated[0].messages[0].flags.push("\\Seen".into());
    let f = fixture(vec![inbox(1, 2), seen, repeated]);
    f.engine.execute(f.binding, Operation::Sync).await.unwrap();
    f.engine.execute(f.binding, Operation::Sync).await.unwrap();
    let revision = f.repository.revision.load(Ordering::Acquire);
    f.engine.execute(f.binding, Operation::Sync).await.unwrap();
    assert_eq!(f.repository.revision.load(Ordering::Acquire), revision);
    assert_eq!(
        f.repository.state.lock().unwrap().folders["inbox"].sequence,
        2
    );
    assert_eq!(f.notifier.0.lock().unwrap().len(), 2);
}
