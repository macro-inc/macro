use super::*;
use crate::domain::mailbox::commands::MailboxCommandRepository;
use crate::domain::mailbox::drafts::{models::DraftClaimMode, ports::DraftRepository};
use crate::domain::models::UserProvider;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn activation_unparks_a_window_committed_by_a_concurrent_parker(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    sqlx::query!(
        "UPDATE email_links SET is_sync_active=false WHERE id=$1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let mut parker = repo.begin_claim().await.unwrap();
    let window = repo
        .lock_stream_window(&mut parker, super::super::claims::StreamWork::Folder)
        .await
        .unwrap();
    assert_eq!(window.maintained, 1);
    let mut activation = db.begin().await.unwrap();
    sqlx::query!("SAVEPOINT activation_probe")
        .execute(&mut *activation)
        .await
        .unwrap();
    // NOWAIT proves the parker's parent lock conflicts with activation,
    // without polling or relying on task scheduling.
    let blocked = sqlx::query!(
        "SELECT id FROM email_links WHERE id=$1 FOR UPDATE NOWAIT",
        link
    )
    .fetch_one(&mut *activation)
    .await
    .unwrap_err();
    assert_eq!(
        blocked.as_database_error().unwrap().code().as_deref(),
        Some("55P03")
    );
    sqlx::query!("ROLLBACK TO SAVEPOINT activation_probe")
        .execute(&mut *activation)
        .await
        .unwrap();
    parker.commit().await.unwrap();
    sqlx::query!(
        "UPDATE email_links SET is_sync_active=true WHERE id=$1",
        link
    )
    .execute(&mut *activation)
    .await
    .unwrap();
    assert_eq!(
        super::super::parked_work_recovery::unpark_link_page(&mut activation, link, 64)
            .await
            .unwrap(),
        1
    );
    activation.commit().await.unwrap();
    assert!(matches!(
        repo.claim_stream(Uuid::now_v7(), StreamKind::MailFolder)
            .await
            .unwrap(),
        SyncClaim::Acquired(_)
    ));

    // Reverse ordering: activation already owns the parent. The parker
    // skips that parent, and must not leave work parked after activation.
    let (second, second_link) = fixture_for_provider(&db, UserProvider::Imap).await;
    sqlx::query!(
        "UPDATE email_links SET is_sync_active=false WHERE id=$1",
        second_link
    )
    .execute(&db)
    .await
    .unwrap();
    let mut activation = db.begin().await.unwrap();
    sqlx::query!(
        "UPDATE email_links SET is_sync_active=true WHERE id=$1",
        second_link
    )
    .execute(&mut *activation)
    .await
    .unwrap();
    let mut parker = second.begin_claim().await.unwrap();
    let window = second
        .lock_stream_window(&mut parker, super::super::claims::StreamWork::Folder)
        .await
        .unwrap();
    assert_eq!(window.maintained, 0);
    parker.commit().await.unwrap();
    assert_eq!(
        super::super::parked_work_recovery::unpark_link_page(&mut activation, second_link, 64)
            .await
            .unwrap(),
        0
    );
    activation.commit().await.unwrap();
    let lease = second
        .claim_stream(Uuid::now_v7(), StreamKind::MailFolder)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(lease.mailbox.link_id, second_link);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn corrupt_stream_routing_is_parked_without_relabeling(db: PgPool) {
    let (_, link) = fixture(&db).await;
    // Unsupported corruption, not a legacy writer: all real inserts derive
    // their provider, and a link's provider cannot change.
    sqlx::query!(
        "ALTER TABLE email_sync_streams DISABLE TRIGGER email_sync_streams_derive_provider"
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_sync_streams SET provider='IMAP' WHERE link_id=$1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "ALTER TABLE email_sync_streams ENABLE TRIGGER email_sync_streams_derive_provider"
    )
    .execute(&db)
    .await
    .unwrap();
    let repo = PgMailboxSync::new(db.clone()).with_provider(UserProvider::Imap);
    assert!(matches!(
        repo.claim_stream(Uuid::now_v7(), StreamKind::MailFolder)
            .await
            .unwrap(),
        SyncClaim::Progress
    ));
    assert!(matches!(
        repo.claim_stream(Uuid::now_v7(), StreamKind::MailFolder)
            .await
            .unwrap(),
        SyncClaim::Idle
    ));
    let row = sqlx::query!(r#"SELECT provider::text AS "provider!", parked_at IS NOT NULL AS "parked!" FROM email_sync_streams WHERE link_id=$1"#,link)
        .fetch_one(&db).await.unwrap();
    assert_eq!(row.provider, "IMAP");
    assert!(row.parked);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sync_claims_do_not_serialize_on_a_provider_advisory_key(db: PgPool) {
    let (repo, _) = fixture(&db).await;
    let mut other = db.begin().await.unwrap();
    sqlx::query!("SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended('email.mailbox.sync-claims:OUTLOOK',0))")
        .fetch_one(&mut *other).await.unwrap();
    let claimed = repo
        .claim_stream(Uuid::now_v7(), StreamKind::MailFolder)
        .await;
    other.rollback().await.unwrap();
    assert!(
        matches!(claimed, Ok(SyncClaim::Acquired(_))),
        "a sync claim must not wait for a fleet-wide key"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn imap_mutation_claims_proceed_while_the_old_outlook_key_is_held(db: PgPool) {
    let (imap, _) = fixture_for_provider(&db, UserProvider::Imap).await;
    let mut old_binary = db.begin().await.unwrap();
    sqlx::query!("SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended('email.outlook.mutation-claims',0))")
        .fetch_one(&mut *old_binary).await.unwrap();
    // A wrong legacy-key acquisition fails at the real database lock_timeout;
    // no Tokio scheduling or wall-clock threshold decides this assertion.
    assert!(imap.claim_command(Uuid::now_v7()).await.unwrap().is_none());
    assert!(
        imap.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap()
            .is_none()
    );
    old_binary.rollback().await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mutation_claims_use_their_provider_key(db: PgPool) {
    for provider in [UserProvider::Outlook, UserProvider::Imap] {
        let (repo, _) = fixture_for_provider(&db, provider).await;
        let held = repo.mutation_claim_transaction().await.unwrap();
        let mut probe = db.begin().await.unwrap();
        let provider_free = sqlx::query_scalar!(r#"SELECT pg_try_advisory_xact_lock(hashtextextended('email.mailbox.mutation-claims:' || $1::text,0)) AS "free!""#, provider.as_str())
            .fetch_one(&mut *probe).await.unwrap();
        assert!(
            !provider_free,
            "the real mutation transaction must hold its provider key"
        );
        let legacy_free = sqlx::query_scalar!(r#"SELECT pg_try_advisory_xact_lock(hashtextextended('email.outlook.mutation-claims',0)) AS "free!""#)
            .fetch_one(&mut *probe).await.unwrap();
        assert_eq!(legacy_free, provider != UserProvider::Outlook);
        let other = if provider == UserProvider::Outlook {
            UserProvider::Imap
        } else {
            UserProvider::Outlook
        };
        let other_free = sqlx::query_scalar!(r#"SELECT pg_try_advisory_xact_lock(hashtextextended('email.mailbox.mutation-claims:' || $1::text,0)) AS "free!""#, other.as_str())
            .fetch_one(&mut *probe).await.unwrap();
        assert!(
            other_free,
            "other providers retain independent claim capacity"
        );
        // The fixed legacy-first acquisition order is straight-line code and
        // audited by review, not inferred from timing these key probes.
        probe.rollback().await.unwrap();
        held.rollback().await.unwrap();
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_claim_routes_legacy_rows_by_the_link_without_background_repair(db: PgPool) {
    let (outlook, outlook_link) = fixture(&db).await;
    let (gmail, gmail_link) = fixture_for_provider(&db, UserProvider::Gmail).await;
    // Reproduce the pre-trigger legacy cohort in this isolated test database.
    sqlx::query!("ALTER TABLE email_message_reconciliation DISABLE TRIGGER email_message_reconciliation_derive_provider")
        .execute(&db).await.unwrap();
    sqlx::query!(
        "INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import,available_at) VALUES ($1,1,'legacy-gmail',false,now()-interval '1 minute')",
        gmail_link
    ).execute(&db).await.unwrap();
    sqlx::query!("ALTER TABLE email_message_reconciliation ENABLE TRIGGER email_message_reconciliation_derive_provider")
        .execute(&db).await.unwrap();
    sqlx::query!(
        "INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import) VALUES ($1,1,'outlook-ready',false)",
        outlook_link
    ).execute(&db).await.unwrap();

    let claimed = outlook
        .claim_message(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(claimed.mailbox.link_id, outlook_link);
    let repaired = sqlx::query_scalar!(
        r#"SELECT provider::text AS "provider!" FROM email_message_reconciliation WHERE link_id=$1 AND provider_id='legacy-gmail'"#,
        gmail_link
    ).fetch_one(&db).await.unwrap();
    assert_eq!(repaired, "GMAIL");
    let next = gmail
        .claim_message(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(next.mailbox.link_id, gmail_link);
    assert_eq!(next.provider_id.as_str(), "legacy-gmail");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn renewing_a_fresh_stream_lease_does_not_rewrite_its_indexed_deadline(db: PgPool) {
    let (repo, _) = fixture(&db).await;
    let lease = repo
        .claim_stream(macro_uuid::generate_uuid_v7(), StreamKind::MailFolder)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    let before = sqlx::query_scalar!(
        r#"SELECT xmin::text AS "version!" FROM email_sync_streams WHERE id=$1"#,
        lease.id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    repo.renew(SyncLease::Stream(&lease)).await.unwrap();
    let after = sqlx::query_scalar!(
        r#"SELECT xmin::text AS "version!" FROM email_sync_streams WHERE id=$1"#,
        lease.id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(before, after);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_recovery_page_gives_sync_work_room_beside_a_hot_projection_backlog(db: PgPool) {
    let (_, link) = fixture(&db).await;
    let events: Vec<Uuid> = (0..20_000)
        .map(|_| macro_uuid::generate_uuid_v7())
        .collect();
    sqlx::query!(
        r#"INSERT INTO email_projection_outbox(id,link_id,generation,payload,parked_at)
        SELECT id,$1,1,'{"kind":"link_changed"}'::jsonb,now() FROM unnest($2::uuid[]) id"#,
        link,
        &events
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_sync_streams SET parked_at=now() WHERE link_id=$1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_message_reconciliation(link_id,generation,provider_id,is_import,parked_at) VALUES ($1,1,'parked-message',false,now())",
        link
    ).execute(&db).await.unwrap();
    let mut tx = db.begin().await.unwrap();
    let changed = super::super::parked_work_recovery::unpark_link_page(&mut tx, link, 64)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(changed, 64);
    let stream_ready = sqlx::query_scalar!(
        r#"SELECT parked_at IS NULL AS "ready!" FROM email_sync_streams WHERE link_id=$1 AND kind='mail_folder'"#,
        link
    ).fetch_one(&db).await.unwrap();
    let message_ready = sqlx::query_scalar!(
        r#"SELECT parked_at IS NULL AS "ready!" FROM email_message_reconciliation WHERE link_id=$1 AND provider_id='parked-message'"#,
        link
    ).fetch_one(&db).await.unwrap();
    let projection_ready = sqlx::query_scalar!(
        r#"SELECT parked_at IS NULL AS "ready!" FROM email_projection_outbox WHERE id=$1"#,
        events[0]
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(stream_ready);
    assert!(message_ready);
    assert!(projection_ready);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_recovery_page_unparks_a_projection_head_beside_hot_reconciliation(db: PgPool) {
    let (_, link) = fixture(&db).await;
    let events: Vec<Uuid> = (0..1).map(|_| macro_uuid::generate_uuid_v7()).collect();
    sqlx::query!(
        r#"INSERT INTO email_projection_outbox(id,link_id,generation,payload,parked_at)
        SELECT id,$1,1,'{"kind":"link_changed"}'::jsonb,now() FROM unnest($2::uuid[]) id"#,
        link,
        &events
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_sync_streams SET parked_at=now() WHERE link_id=$1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let messages: Vec<String> = (0..20_000)
        .map(|id| format!("parked-message-{id}"))
        .collect();
    sqlx::query!(
        "INSERT INTO email_message_reconciliation(link_id,generation,provider_id,is_import,parked_at) SELECT $1,1,id,false,now() FROM unnest($2::text[]) id",
        link,
        &messages
    ).execute(&db).await.unwrap();
    let mut tx = db.begin().await.unwrap();
    let changed = super::super::parked_work_recovery::unpark_link_page(&mut tx, link, 64)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(changed, 64);
    let stream_ready = sqlx::query_scalar!(
        r#"SELECT parked_at IS NULL AS "ready!" FROM email_sync_streams WHERE link_id=$1 AND kind='mail_folder'"#,
        link
    ).fetch_one(&db).await.unwrap();
    let message_ready = sqlx::query_scalar!(
        r#"SELECT parked_at IS NULL AS "ready!" FROM email_message_reconciliation WHERE link_id=$1 AND provider_id='parked-message-0'"#,
        link
    ).fetch_one(&db).await.unwrap();
    let projection_ready = sqlx::query_scalar!(
        r#"SELECT parked_at IS NULL AS "ready!" FROM email_projection_outbox WHERE id=$1"#,
        events[0]
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(stream_ready);
    assert!(message_ready);
    assert!(projection_ready);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn maintenance_only_windows_park_at_most_64_rows_and_do_not_report_idle(db: PgPool) {
    let telemetry = crate::telemetry_capture::Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = fixture(&db).await;
    sqlx::query!(
        "UPDATE email_links SET is_sync_active=false WHERE id=$1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let messages: Vec<String> = (0..130).map(|id| format!("inactive-{id}")).collect();
    sqlx::query!(
        "INSERT INTO email_message_reconciliation(link_id,generation,provider_id,is_import) SELECT $1,1,id,false FROM unnest($2::text[]) id",
        link,
        &messages,
    ).execute(&db).await.unwrap();

    for expected in [64, 128, 130] {
        let result = repo
            .claim_message(macro_uuid::generate_uuid_v7())
            .await
            .unwrap();
        assert!(matches!(result, SyncClaim::Progress));
        let parked = sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM email_message_reconciliation WHERE link_id=$1 AND parked_at IS NOT NULL"#,
            link,
        ).fetch_one(&db).await.unwrap();
        assert_eq!(parked, expected);
    }
    assert!(matches!(
        repo.claim_message(macro_uuid::generate_uuid_v7())
            .await
            .unwrap(),
        SyncClaim::Idle,
    ));
    let spans = telemetry.spans("email.mailbox.claim");
    let windows: Vec<_> = spans
        .iter()
        .map(|span| {
            (
                span["mailbox.window_rows"].as_str(),
                span["mailbox.window_maintained"].as_str(),
                span["mailbox.outcome"].as_str(),
            )
        })
        .collect();
    assert_eq!(
        windows,
        vec![
            ("64", "64", "progress"),
            ("64", "64", "progress"),
            ("2", "2", "progress")
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn message_renewals_write_only_when_the_owned_lease_needs_an_extension(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    sqlx::query!(
        "INSERT INTO email_message_reconciliation(link_id,generation,provider_id,is_import) VALUES ($1,1,'renew-message',false)",
        link,
    ).execute(&db).await.unwrap();
    let lease = repo
        .claim_message(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    let before = sqlx::query_scalar!(
        r#"SELECT xmin::text AS "version!" FROM email_message_reconciliation WHERE link_id=$1 AND provider_id='renew-message'"#,
        link,
    ).fetch_one(&db).await.unwrap();
    repo.renew(SyncLease::Message(&lease)).await.unwrap();
    let fresh = sqlx::query_scalar!(
        r#"SELECT xmin::text AS "version!" FROM email_message_reconciliation WHERE link_id=$1 AND provider_id='renew-message'"#,
        link,
    ).fetch_one(&db).await.unwrap();
    assert_eq!(before, fresh);

    // Advance the persisted lease age without sleeping or changing its owner.
    sqlx::query!(
        "UPDATE email_message_reconciliation SET lease_until=now()+interval '149 seconds' WHERE link_id=$1 AND provider_id='renew-message'",
        link,
    ).execute(&db).await.unwrap();
    repo.renew(SyncLease::Message(&lease)).await.unwrap();
    let extended = sqlx::query_scalar!(
        r#"SELECT lease_until > now()+interval '150 seconds' AS "extended!" FROM email_message_reconciliation WHERE link_id=$1 AND provider_id='renew-message'"#,
        link,
    ).fetch_one(&db).await.unwrap();
    assert!(extended);
    sqlx::query!(
        "UPDATE email_message_reconciliation SET lease_id=$2 WHERE link_id=$1 AND provider_id='renew-message'",
        link,
        macro_uuid::generate_uuid_v7(),
    ).execute(&db).await.unwrap();
    assert!(matches!(
        repo.renew(SyncLease::Message(&lease)).await,
        Err(MailboxError::Stale)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn live_reconciliation_stays_ahead_of_older_imports_across_windows(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let messages: Vec<String> = (0..65).map(|id| format!("priority-{id}")).collect();
    sqlx::query!(
        "INSERT INTO email_message_reconciliation(link_id,generation,provider_id,is_import,available_at) SELECT $1,1,'import-'||id,true,now()-interval '1 day' FROM unnest($2::text[]) id",
        link,
        &messages,
    ).execute(&db).await.unwrap();
    sqlx::query!(
        "INSERT INTO email_message_reconciliation(link_id,generation,provider_id,is_import) SELECT $1,1,'live-'||id,false FROM unnest($2::text[]) id",
        link,
        &messages,
    ).execute(&db).await.unwrap();
    for _ in 0..65 {
        let lease = repo
            .claim_message(macro_uuid::generate_uuid_v7())
            .await
            .unwrap()
            .into_lease()
            .unwrap();
        assert!(
            !lease.is_import,
            "due live work must be claimed before any older import"
        );
        assert!(lease.provider_id.as_str().starts_with("live-"));
    }
    let next = repo
        .claim_message(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert!(next.is_import);
    assert!(next.provider_id.as_str().starts_with("import-"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn small_recovery_budget_one_can_unpark_a_stream(db: PgPool) {
    let (_, link) = fixture(&db).await;
    sqlx::query!(
        "UPDATE email_sync_streams SET parked_at=now() WHERE link_id=$1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let mut tx = db.begin().await.unwrap();
    let rows = super::super::parked_work_recovery::unpark_link_page(&mut tx, link, 1)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(
        rows, 1,
        "a zero initial quota must still borrow unused room"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn small_recovery_budget_two_can_unpark_reconciliation(db: PgPool) {
    let (_, link) = fixture(&db).await;
    sqlx::query!(
        "INSERT INTO email_message_reconciliation(link_id,generation,provider_id,is_import,parked_at) VALUES ($1,1,'small-first',false,now()),($1,1,'small-second',false,now())",
        link,
    ).execute(&db).await.unwrap();
    let mut tx = db.begin().await.unwrap();
    let rows = super::super::parked_work_recovery::unpark_link_page(&mut tx, link, 2)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(
        rows, 2,
        "a zero initial quota must still borrow unused room"
    );
}
