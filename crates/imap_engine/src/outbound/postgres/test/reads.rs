use super::*;

#[sqlx::test(migrations = false)]
async fn scoped_reads_share_a_snapshot_and_cannot_mutate_or_outlive_access(pool: PgPool) {
    schema(&pool).await;
    let link = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, provider)
        VALUES ($1, 'owner', 'IMAP')
        "#,
        link,
    )
    .execute(&pool)
    .await
    .unwrap();
    let health = serde_json::to_value(AccountState::default()).unwrap();
    sqlx::query!(
        r#"
        INSERT INTO imap_accounts (link_id, user_id, sync_generation, grant_generation, credential_ciphertext, state)
        VALUES ($1, 'owner', 1, 1, decode('01', 'hex'), $2)
        "#,
        link,
        health,
    ).execute(&pool).await.unwrap();
    let binding = Binding {
        link_id: link,
        sync_generation: 1,
        grant_generation: 1,
    };
    let repo = PgRepository::new(pool.clone());
    let (mut snapshot, mut before) = repo.begin_read(binding).await.unwrap();
    let statement =
        sqlx::query_scalar!(r#"SELECT current_setting('statement_timeout') AS "timeout!""#)
            .fetch_one(&mut *snapshot)
            .await
            .unwrap();
    let idle = sqlx::query_scalar!(
        r#"SELECT current_setting('idle_in_transaction_session_timeout') AS "timeout!""#
    )
    .fetch_one(&mut *snapshot)
    .await
    .unwrap();
    assert_eq!(statement, "30s");
    assert_eq!(idle, "10s");
    let mut writer = repo.acquire(binding).await.unwrap();
    writer.state.sends_today = 7;
    writer.state.folders.insert(
        "inbox".into(),
        FolderState {
            monitored: true,
            virtual_label: None,
            uid_next: None,
            phantom: None,
            detected_role: None,
            folder: Folder {
                sync_enabled: true,
                id: "inbox".into(),
                parent_id: None,
                name: "INBOX".into(),
                role: FolderRole::Inbox,
                has_children: false,
                total_items: Some(0),
            },
            path: "INBOX".into(),
            uid_validity: 1,
            highest_modseq: None,
            sync_tier: None,
            sequence: 0,
            journal: Vec::new(),
        },
    );
    repo.save(&mut writer).await.unwrap();
    // Commit a new catalog between the scalar read and hydration. Both reads
    // must still observe the transaction's original revision, never a mixture.
    repo.hydrate(&mut snapshot, &mut before, StateSelection::Catalog)
        .await
        .unwrap();
    snapshot.commit().await.unwrap();
    assert_eq!(before.state.sends_today, 0);
    assert!(before.state.folders.is_empty());
    let mut current = repo
        .read_scoped(binding, StateSelection::Catalog)
        .await
        .unwrap();
    assert_eq!(current.state.sends_today, 7);
    assert_eq!(current.state.folders.len(), 1);
    assert!(current.lease_id.is_none());
    assert!(matches!(
        repo.save(&mut current).await,
        Err(Error::Conflict)
    ));
    assert!(matches!(
        repo.save_health(&mut current).await,
        Err(Error::Conflict)
    ));
    assert!(matches!(repo.renew(&current).await, Err(Error::Conflict)));
    assert!(matches!(repo.release(&current).await, Err(Error::Conflict)));
    repo.renew(&writer).await.unwrap();
    repo.validate_read(&current).await.unwrap();
    current.user_id = "another-owner".into();
    assert!(matches!(
        repo.validate_read(&current).await,
        Err(Error::Conflict)
    ));
    current.user_id = "owner".into();
    // A one-connection pool must be available while the lazy MIME fetch waits.
    // Keep the writer's command lease held throughout this read.
    writer.state.messages.insert(
        "m:one".into(),
        Message {
            id: "m:one".into(),
            thread_id: "t:one".into(),
            folder_id: "inbox".into(),
            flags: Vec::new(),
            tags: Vec::new(),
            version: "v1".into(),
            mime_base64: String::new(),
            source_complete: false,
            classification: None,
            received_at: Utc::now(),
            size: 64,
            is_sent: false,
            draft_correlation: None,
        },
    );
    writer.state.locations.push(Location {
        folder_id: "inbox".into(),
        uid_validity: 1,
        uid: 1,
        message_id: "m:one".into(),
        fingerprint: "synthetic".into(),
    });
    repo.save(&mut writer).await.unwrap();
    let one = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with((*pool.connect_options()).clone())
        .await
        .unwrap();
    use crate::domain::service::test::{
        MemoryRepository, ProviderWorkControl, TestCipher, UncertainTransport,
    };
    use std::sync::{
        Arc,
        atomic::{AtomicBool, AtomicU32},
    };
    let fake = Arc::new(MemoryRepository {
        revision: Default::default(),
        scoped_acquire_errors: Default::default(),
        state: std::sync::Mutex::new(AccountState::default()),
        saved_unknown: AtomicBool::new(false),
        command_leases: None,
        owner_available: AtomicBool::new(true),
        owner_claims: AtomicU32::new(0),
        owner_errors: AtomicU32::new(0),
        releases: AtomicU32::new(0),
        owner_gate: std::sync::Mutex::new(None),
        acquire_gate: None,
    });
    let (started, mut observed) = tokio::sync::mpsc::unbounded_channel();
    let control = Arc::new(ProviderWorkControl {
        idle: None,
        failures: std::collections::BTreeMap::new(),
        organization: None,
        source: Some(b"Message-ID: <synthetic@example.net>\r\n\r\nTest body".to_vec()),
        started,
        released: tokio::sync::Semaphore::new(0),
    });
    let transport = Arc::new(UncertainTransport {
        repository: fake,
        submissions: AtomicU32::new(0),
        deadline: AtomicBool::new(false),
        sent_found: std::sync::Mutex::new(Default::default()),
        submission_deadline: std::sync::Mutex::new(None),
        refusal: None,
        provider_work: Some(control.clone()),
    });
    let engine = crate::domain::service::Engine::new(
        Arc::new(PgRepository::new(one.clone())),
        Arc::new(TestCipher),
        transport,
    );
    let reading = tokio::spawn(async move {
        engine
            .execute(binding, Operation::Message { id: "m:one".into() })
            .await
    });
    assert_eq!(observed.recv().await.unwrap(), link);
    let available = tokio::time::timeout(std::time::Duration::from_secs(5), one.acquire())
        .await
        .expect("MIME IO must not retain the database connection")
        .unwrap();
    drop(available);
    control.released.add_permits(1);
    let message: Message = serde_json::from_value(reading.await.unwrap().unwrap()).unwrap();
    assert!(message.source_complete);
    one.close().await;
    writer.state.needs_reauth = true;
    repo.save_health(&mut writer).await.unwrap();
    assert!(matches!(
        repo.validate_read(&current).await,
        Err(Error::CredentialsRejected)
    ));
    writer.state.needs_reauth = false;
    repo.save_health(&mut writer).await.unwrap();
    for (active, reauth, sync_generation, grant_generation, owner) in [
        (false, false, 1i64, 1i64, "owner"),
        (true, true, 1, 1, "owner"),
        (true, false, 2, 1, "owner"),
        (true, false, 1, 2, "owner"),
        (true, false, 1, 1, "another-owner"),
    ] {
        sqlx::query!(
            r#"
            UPDATE email_links
            SET
                is_sync_active = $2,
                needs_reauth = $3,
                sync_generation = $4,
                grant_generation = $5,
                macro_id = $6
            WHERE id = $1
            "#,
            link,
            active,
            reauth,
            sync_generation,
            grant_generation,
            owner,
        )
        .execute(&pool)
        .await
        .unwrap();
        assert!(matches!(
            repo.validate_read(&current).await,
            Err(Error::Conflict)
        ));
        assert!(matches!(
            repo.read_scoped(binding, StateSelection::Catalog).await,
            Err(Error::Conflict)
        ));
    }
}
