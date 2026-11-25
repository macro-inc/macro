use super::*;
use crate::domain::service::test::{
    TestCipher,
    sync_cost::{SnapshotTransport, inbox},
};
use crate::domain::service::{Engine, VerificationScopeKey};
use std::sync::Arc;

#[sqlx::test(migrations = false)]
async fn moved_message_uses_persisted_fingerprint_without_a_json_copy(pool: PgPool) {
    schema(&pool).await;
    let link = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_links(id,macro_id,provider)VALUES($1,'owner','IMAP')",
        link
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO imap_accounts(link_id,user_id,sync_generation,grant_generation,credential_ciphertext,state)VALUES($1,'owner',1,1,decode('01','hex'),$2)",link,serde_json::to_value(AccountState::default()).unwrap()).execute(&pool).await.unwrap();
    let binding = Binding {
        link_id: link,
        sync_generation: 1,
        grant_generation: 1,
    };
    let mut initial = inbox(1, 2);
    initial[0].messages[0].native_message_id = None;
    initial[0].messages[0].native_thread_id = None;
    let mut moved = inbox(1, 100);
    moved[0].folder.id = "archive".into();
    moved[0].folder.role = FolderRole::Archive;
    moved[0].path = "Archive".into();
    moved[0].messages[0] = initial[0].messages[0].clone();
    moved[0].messages[0].uid = 99;
    let repository = Arc::new(PgRepository::new(pool.clone()));
    let engine = Engine::new_for_test(
        VerificationScopeKey::derive("synthetic-test-auth-key").unwrap(),
        repository.clone(),
        Arc::new(TestCipher),
        Arc::new(SnapshotTransport::new(vec![initial, moved])),
        tokio_util::task::TaskTracker::new(),
        tokio_util::sync::CancellationToken::new(),
    );
    engine.execute(binding, Operation::Sync).await.unwrap();
    let before = repository.acquire(binding).await.unwrap();
    let original = before.state.locations[0].message_id.clone();
    repository.release(&before).await.unwrap();
    let exists=sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='imap_state_entries'::regclass AND attname='fingerprint' AND NOT attisdropped) AS "present!""#).fetch_one(&pool).await.unwrap();
    assert!(
        exists,
        "location fingerprint must be stored in an indexed bytea column"
    );
    let doc = sqlx::query_scalar!(
        "SELECT document FROM imap_state_entries WHERE link_id=$1 AND kind='location'",
        link
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        doc.get("fingerprint").is_none(),
        "do not retain the unused document copy"
    );
    engine.execute(binding, Operation::Sync).await.unwrap();
    let after = repository.acquire(binding).await.unwrap();
    assert_eq!(after.state.locations.len(), 1);
    assert_eq!(after.state.locations[0].message_id, original);
    assert_eq!(after.state.locations[0].folder_id, "archive");
    repository.release(&after).await.unwrap();

    let wire = chrono::DateTime::parse_from_rfc3339("2023-11-15T03:43:20.123456789+05:30")
        .unwrap()
        .with_timezone(&Utc);
    let stored = sqlx::query_scalar!(r#"SELECT $1::timestamptz AS "date!""#, wire)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        MessageFingerprint::new(b"headers", wire, 200),
        MessageFingerprint::new(b"headers", stored, 200)
    );
    for invalid in [None, Some(vec![0u8; 31]), Some(vec![0u8; 33])] {
        let mut tx = pool.begin().await.unwrap();
        let result = sqlx::query!(
            "UPDATE imap_state_entries SET fingerprint=$2 WHERE link_id=$1 AND kind='location'",
            link,
            invalid
        )
        .execute(&mut *tx)
        .await;
        assert_eq!(
            result
                .unwrap_err()
                .as_database_error()
                .unwrap()
                .code()
                .as_deref(),
            Some("23514")
        );
        tx.rollback().await.unwrap();
    }
    let mut account = repository.acquire(binding).await.unwrap();
    let fingerprints = vec![account.state.locations[0].fingerprint];
    let stale = repository.acquire(binding).await;
    assert!(matches!(stale, Err(Error::AccountBusy)));
    account.revision += 1;
    assert!(matches!(
        repository.lookup_locations(&account, &fingerprints).await,
        Err(Error::Conflict)
    ));
    account.revision -= 1;
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query!("LOCK TABLE imap_state_entries IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *blocker)
        .await
        .unwrap();
    assert!(matches!(
        repository.lookup_locations(&account, &fingerprints).await,
        Err(Error::ConnectionUnavailable)
    ));
    blocker.rollback().await.unwrap();
    assert_eq!(
        repository
            .lookup_locations(&account, &fingerprints)
            .await
            .unwrap(),
        account.state.locations
    );
    repository.release(&account).await.unwrap();
}

#[sqlx::test(migrations = false)]
async fn mixed_utf8_location_keys_match_rust_order_through_the_indexed_lookup(pool: PgPool) {
    schema(&pool).await;
    let link = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_links(id,macro_id,provider)VALUES($1,'owner','IMAP')",
        link
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO imap_accounts(link_id,user_id,sync_generation,grant_generation,credential_ciphertext,state)VALUES($1,'owner',1,1,decode('01','hex'),$2)",link,serde_json::to_value(AccountState::default()).unwrap()).execute(&pool).await.unwrap();
    let binding = Binding {
        link_id: link,
        sync_generation: 1,
        grant_generation: 1,
    };
    let mut moved = inbox(1, 100);
    moved[0].folder.id = "dest".into();
    moved[0].messages[0].native_message_id = None;
    moved[0].messages[0].native_thread_id = None;
    let repository = Arc::new(PgRepository::new(pool));
    let engine = Engine::new_for_test(
        VerificationScopeKey::derive("synthetic-test-auth-key").unwrap(),
        repository.clone(),
        Arc::new(TestCipher),
        Arc::new(SnapshotTransport::new(vec![
            crate::domain::service::test::sync_cost::fingerprint_copies_in_mixed_folders(),
            moved,
        ])),
        tokio_util::task::TaskTracker::new(),
        tokio_util::sync::CancellationToken::new(),
    );
    engine.execute(binding, Operation::Sync).await.unwrap();
    let before = repository.acquire(binding).await.unwrap();
    let mut expected = before
        .state
        .locations
        .iter()
        .map(|location| location.storage_key())
        .collect::<Vec<_>>();
    expected.sort();
    let greatest_id = before
        .state
        .locations
        .iter()
        .max_by_key(|location| location.storage_key())
        .unwrap()
        .message_id
        .clone();
    let fingerprint = before.state.locations[0].fingerprint;
    let matches = repository
        .lookup_locations(&before, &[fingerprint, fingerprint])
        .await
        .unwrap();
    assert_eq!(
        matches
            .iter()
            .map(|location| location.storage_key())
            .collect::<Vec<_>>(),
        expected
    );
    assert_eq!(
        matches.len(),
        6,
        "the batch must preserve ANY's set semantics for repeated digests"
    );
    repository.release(&before).await.unwrap();
    engine.execute(binding, Operation::Sync).await.unwrap();
    let after = repository.acquire(binding).await.unwrap();
    assert_eq!(after.state.locations.len(), 1);
    assert_eq!(after.state.locations[0].message_id, greatest_id);
    repository.release(&after).await.unwrap();
}

async fn fingerprint_binding(pool: &PgPool) -> Binding {
    let link = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_links(id,macro_id,provider)VALUES($1,'owner','IMAP')",
        link
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO imap_accounts(link_id,user_id,sync_generation,grant_generation,credential_ciphertext,state)VALUES($1,'owner',1,1,decode('01','hex'),$2)",link,serde_json::to_value(AccountState::default()).unwrap()).execute(pool).await.unwrap();
    Binding {
        link_id: link,
        sync_generation: 1,
        grant_generation: 1,
    }
}
fn fingerprint_engine(repository: Arc<PgRepository>, transport: Arc<dyn MailTransport>) -> Engine {
    Engine::new_for_test(
        VerificationScopeKey::derive("synthetic-test-auth-key").unwrap(),
        repository,
        Arc::new(TestCipher),
        transport,
        tokio_util::task::TaskTracker::new(),
        tokio_util::sync::CancellationToken::new(),
    )
}
fn fingerprint_snapshot() -> Vec<RemoteFolder> {
    let mut snapshot = inbox(1, 2);
    snapshot[0].messages[0].native_message_id = None;
    snapshot[0].messages[0].native_thread_id = None;
    snapshot
}

#[sqlx::test(migrations = false)]
async fn fingerprint_lookup_and_sync_never_cross_links_with_the_same_digest(pool: PgPool) {
    schema(&pool).await;
    let a = fingerprint_binding(&pool).await;
    let b = fingerprint_binding(&pool).await;
    let initial = fingerprint_snapshot();
    let mut foreign = fingerprint_snapshot();
    foreign[0].folder.id = "foreign".into();
    foreign[0].path = "Foreign".into();
    let mut moved = fingerprint_snapshot();
    moved[0].folder.id = "archive".into();
    moved[0].path = "Archive".into();
    moved[0].messages[0].uid = 9;
    let repository = Arc::new(PgRepository::new(pool));
    let engine_a = fingerprint_engine(
        repository.clone(),
        Arc::new(SnapshotTransport::new(vec![initial, moved])),
    );
    let engine_b = fingerprint_engine(
        repository.clone(),
        Arc::new(SnapshotTransport::new(vec![foreign])),
    );
    engine_a.execute(a, Operation::Sync).await.unwrap();
    engine_b.execute(b, Operation::Sync).await.unwrap();
    let before_a = repository.acquire(a).await.unwrap();
    let before_b = repository.acquire(b).await.unwrap();
    let fingerprint = before_a.state.locations[0].fingerprint;
    assert_eq!(before_b.state.locations[0].fingerprint, fingerprint);
    assert_ne!(
        before_a.state.locations[0].message_id,
        before_b.state.locations[0].message_id
    );
    assert_eq!(
        repository
            .lookup_locations(&before_a, &[fingerprint])
            .await
            .unwrap(),
        before_a.state.locations
    );
    let original = before_a.state.locations[0].message_id.clone();
    let foreign = before_b.state.locations.clone();
    repository.release(&before_a).await.unwrap();
    repository.release(&before_b).await.unwrap();
    engine_a.execute(a, Operation::Sync).await.unwrap();
    let after_a = repository.acquire(a).await.unwrap();
    let after_b = repository.acquire(b).await.unwrap();
    assert_eq!(after_a.state.locations.len(), 1);
    assert_eq!(after_a.state.locations[0].message_id, original);
    assert_eq!(after_a.state.locations[0].folder_id, "archive");
    assert_eq!(after_b.state.locations, foreign);
    repository.release(&after_a).await.unwrap();
    repository.release(&after_b).await.unwrap();
}

#[sqlx::test(migrations = false)]
async fn fingerprint_lookup_preserves_identity_when_uidvalidity_reuses_a_uid(pool: PgPool) {
    schema(&pool).await;
    let binding = fingerprint_binding(&pool).await;
    let initial = fingerprint_snapshot();
    let mut reset = fingerprint_snapshot();
    reset[0].uid_validity = 2;
    let repository = Arc::new(PgRepository::new(pool));
    let engine = fingerprint_engine(
        repository.clone(),
        Arc::new(SnapshotTransport::new(vec![initial, reset])),
    );
    engine.execute(binding, Operation::Sync).await.unwrap();
    let before = repository.acquire(binding).await.unwrap();
    let location = before.state.locations[0].clone();
    repository.release(&before).await.unwrap();
    engine.execute(binding, Operation::Sync).await.unwrap();
    let after = repository.acquire(binding).await.unwrap();
    assert_eq!(after.state.locations.len(), 1);
    assert_eq!(after.state.locations[0].message_id, location.message_id);
    assert_eq!(after.state.locations[0].uid, location.uid);
    assert_eq!(after.state.locations[0].uid_validity, 2);
    assert_eq!(after.state.locations[0].fingerprint, location.fingerprint);
    repository.release(&after).await.unwrap();
}

#[sqlx::test(migrations = false)]
async fn fingerprint_lookup_resolves_a_move_without_copyuid_placeholder(pool: PgPool) {
    schema(&pool).await;
    let binding = fingerprint_binding(&pool).await;
    let mut initial = fingerprint_snapshot();
    let current = initial[0].messages[0].clone();
    let mut archive = fingerprint_snapshot().remove(0);
    archive.folder.id = "archive".into();
    archive.folder.name = "Archive".into();
    archive.folder.role = FolderRole::Archive;
    archive.path = "Archive".into();
    archive.messages.clear();
    initial.push(archive);
    let mut moved = fingerprint_snapshot();
    moved[0].messages.clear();
    let mut destination = fingerprint_snapshot().remove(0);
    destination.folder.id = "archive".into();
    destination.folder.name = "Archive".into();
    destination.folder.role = FolderRole::Archive;
    destination.path = "Archive".into();
    destination.messages[0].uid = 9;
    destination.uid_next = Some(10);
    moved.push(destination);
    let transport = Arc::new(MoveWithoutCopyUidTransport {
        snapshots: SnapshotTransport::new(vec![initial, moved]),
        current,
        applied: std::sync::atomic::AtomicBool::new(false),
    });
    let repository = Arc::new(PgRepository::new(pool));
    let engine = fingerprint_engine(repository.clone(), transport.clone());
    engine.execute(binding, Operation::Sync).await.unwrap();
    let before = repository.acquire(binding).await.unwrap();
    let original = before.state.locations[0].clone();
    repository.release(&before).await.unwrap();
    engine
        .execute(
            binding,
            Operation::Apply {
                id: original.message_id.clone(),
                request: ActionRequest {
                    action: serde_json::to_value(
                        email_api_client::domain::models::MessageAction::Archive,
                    )
                    .unwrap(),
                    expected_version: None,
                },
            },
        )
        .await
        .unwrap();
    assert!(transport.applied.load(std::sync::atomic::Ordering::SeqCst));
    let pending = repository.acquire(binding).await.unwrap();
    let placeholder = pending
        .state
        .locations
        .iter()
        .find(|l| l.folder_id == "archive")
        .unwrap();
    assert_eq!(placeholder.uid, 0);
    assert_eq!(placeholder.fingerprint, original.fingerprint);
    assert!(
        repository
            .lookup_locations(&pending, &[original.fingerprint])
            .await
            .unwrap()
            .contains(placeholder)
    );
    repository.release(&pending).await.unwrap();
    engine.execute(binding, Operation::Sync).await.unwrap();
    let after = repository.acquire(binding).await.unwrap();
    assert_eq!(after.state.locations.len(), 1);
    assert_eq!(after.state.locations[0].message_id, original.message_id);
    assert_eq!(after.state.locations[0].folder_id, "archive");
    assert_eq!(after.state.locations[0].uid, 9);
    repository.release(&after).await.unwrap();
}

struct MoveWithoutCopyUidTransport {
    snapshots: SnapshotTransport,
    current: RemoteMessage,
    applied: std::sync::atomic::AtomicBool,
}
#[async_trait::async_trait]
impl MailTransport for MoveWithoutCopyUidTransport {
    async fn maintenance(&self) {}

    async fn verify_features(
        &self,
        credentials: &Credentials,
    ) -> Result<Option<crate::domain::server_features::ServerFeatures>, Error> {
        self.verify(credentials).await?;
        Ok(None)
    }

    async fn snapshot(
        &self,
        credentials: &Credentials,
        state: &AccountState,
    ) -> Result<Vec<RemoteFolder>, Error> {
        self.snapshots.snapshot(credentials, state).await
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
        folder: &str,
        epoch: u32,
        uid: u32,
    ) -> Result<Option<RemoteMessage>, Error> {
        assert_eq!((folder, epoch, uid), ("INBOX", 1, self.current.uid));
        Ok(Some(self.current.clone()))
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
        folder: &str,
        epoch: u32,
        uid: u32,
        action: RemoteAction,
    ) -> Result<RemoteWriteReceipt, ApplyError> {
        assert_eq!((folder, epoch, uid), ("INBOX", 1, self.current.uid));
        assert!(matches!(action, RemoteAction::Move(ref path) if path == "Archive"));
        self.applied
            .store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(RemoteWriteReceipt {
            destination_uid: None,
        })
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
    async fn save_sent(
        &self,
        _: &Credentials,
        _: &str,
        _: &[u8],
        _: bool,
    ) -> Result<SentCopy, Error> {
        Err(Error::Invalid)
    }
}
