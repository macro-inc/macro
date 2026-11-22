use super::*;
use email::domain::models::UserProvider;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

async fn legacy_queue(pool: &PgPool, provider: UserProvider, rows: i64) -> Uuid {
    let link = Uuid::now_v7();
    let identity = link.to_string();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
        VALUES ($1, 'macro|repair@example.com', $2, 'repair@example.com', $3::text::email_user_provider_enum)
        "#,
        link,
        identity,
        provider.as_str(),
    )
    .execute(pool).await.unwrap();
    // Reproduce rows that existed BEFORE the new trigger/FK. This setting is
    // transaction-local in an isolated test database; ordinary writes below
    // run with every trigger and constraint enabled.
    for start in (1..=rows).step_by(100_000) {
        let mut tx = pool.begin().await.unwrap();
        sqlx::query!("SET LOCAL session_replication_role = 'replica'")
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query!(
        r#"
        INSERT INTO email_message_reconciliation (link_id, generation, provider_id, is_import, provider)
        SELECT $1, 1, 'legacy-' || lpad(n::text, 8, '0'), false, 'OUTLOOK'
        FROM generate_series($2::bigint, $3::bigint) n
        ON CONFLICT (link_id, generation, provider_id) DO NOTHING
        "#,
        link,
        start,
        (start + 99_999).min(rows),
    )
    .execute(&mut *tx).await.unwrap();
        tx.commit().await.unwrap();
    }
    link
}

async fn finish(repository: &PgProviderRepair) -> RepairProgress {
    for _ in 0..100 {
        if matches!(repair_once(repository).await.unwrap(), RepairTick::Complete) {
            return match repository.claim(Uuid::now_v7()).await.unwrap() {
                RepairClaim::Complete(progress) => progress,
                _ => panic!("completion must be durable"),
            };
        }
    }
    panic!("small fixture must finish within bounded pages");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn repair_resumes_with_one_owner_and_legacy_writers_remain_correct(pool: PgPool) {
    let gmail = legacy_queue(&pool, UserProvider::Gmail, 2501).await;
    let outlook = legacy_queue(&pool, UserProvider::Outlook, 2000).await;
    legacy_queue(&pool, UserProvider::Imap, 2).await;
    let first = PgProviderRepair(pool.clone());
    let second = PgProviderRepair(pool.clone());
    // The authoritative parent gate, also present in the old binary, keeps
    // legacy Gmail rows out of Outlook claims before their metadata is repaired.
    use email::domain::mailbox::MailboxSyncRepository;
    let mailbox = email::outbound::mailbox_pg::PgMailboxSync::new(pool.clone())
        .with_provider(UserProvider::Outlook)
        .claim_message(Uuid::now_v7())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(mailbox.mailbox.link_id, outlook);
    let lease = match first.claim(Uuid::now_v7()).await.unwrap() {
        RepairClaim::Acquired(lease) => lease,
        _ => panic!("first replica must own the page"),
    };
    assert!(matches!(
        second.claim(Uuid::now_v7()).await.unwrap(),
        RepairClaim::Busy
    ));
    first.scan(lease).await.unwrap();
    assert!(matches!(
        first.scan(lease).await,
        Err(RepairError::LeaseLost)
    ));
    let page_lease = match first.claim(Uuid::now_v7()).await.unwrap() {
        RepairClaim::Acquired(lease) => lease,
        _ => panic!("the next child page must be claimable"),
    };
    assert_eq!(
        first.scan(page_lease).await.unwrap().progress.rows_repaired,
        1000
    );

    // An old binary omits provider. Even a key behind the scanner's cursor
    // must be correct immediately, without requiring a second backfill scan.
    sqlx::query!(
        r#"
        INSERT INTO email_message_reconciliation (link_id, generation, provider_id, is_import)
        VALUES ($1, 1, 'legacy-00000000', false)
        ON CONFLICT (link_id, generation, provider_id) DO NOTHING
        "#,
        gmail,
    )
    .execute(&pool)
    .await
    .unwrap();
    let provider = sqlx::query_scalar!(
        r#"
        SELECT provider::text AS "provider!"
        FROM email_message_reconciliation
        WHERE link_id = $1 AND generation = 1 AND provider_id = 'legacy-00000000'
        "#,
        gmail,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(provider, UserProvider::Gmail.as_str());
    drop(first);
    let progress = finish(&second).await;
    assert_eq!(progress.rows_repaired, 2503);
    assert_eq!(progress.message_rows_scanned, 2503);
    assert!(progress.batches >= 6);
    let invalid = sqlx::query_scalar!(
        r#"
        SELECT count(*) AS "count!"
        FROM email_message_reconciliation q
        JOIN email_links l ON l.id = q.link_id
        WHERE q.provider IS DISTINCT FROM l.provider
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(invalid, 0);
    let validated = sqlx::query_scalar!(
        r#"
        SELECT count(*) FILTER (WHERE convalidated) AS "validated!"
        FROM pg_constraint
        WHERE conname IN (
            'email_message_reconciliation_link_provider_fkey',
            'email_sync_streams_link_provider_fkey'
        )
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(validated, 2);
    assert_eq!(finish(&second).await.rows_repaired, progress.rows_repaired);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failed_page_does_not_advance_and_an_expired_owner_cannot_write(pool: PgPool) {
    let gmail = legacy_queue(&pool, UserProvider::Gmail, 1001).await;
    let repository = PgProviderRepair(pool.clone());
    assert!(matches!(
        repair_once(&repository).await.unwrap(),
        RepairTick::Progress(_)
    ));
    let lease = match repository.claim(Uuid::now_v7()).await.unwrap() {
        RepairClaim::Acquired(lease) => lease,
        _ => panic!("page must be claimable"),
    };
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query!(
        r#"
        SELECT provider_id
        FROM email_message_reconciliation
        WHERE link_id = $1 AND generation = 1 AND provider_id = 'legacy-00000001'
        FOR UPDATE
        "#,
        gmail,
    )
    .fetch_one(&mut *blocker)
    .await
    .unwrap();
    assert!(matches!(
        repository.scan(lease).await,
        Err(RepairError::LockBusy)
    ));
    let repaired = sqlx::query_scalar!(
        r#"
        SELECT rows_repaired
        FROM email_reconciliation_provider_backfill
        WHERE name = 'v1'
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(repaired, 0);
    blocker.rollback().await.unwrap();
    sqlx::query!(
        r#"
        UPDATE email_reconciliation_provider_backfill
        SET lease_until = clock_timestamp() - interval '1 second'
        WHERE name = 'v1' AND lease_id = $1
        "#,
        lease.id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let replacement = match repository.claim(Uuid::now_v7()).await.unwrap() {
        RepairClaim::Acquired(lease) => lease,
        _ => panic!("a new replica must recover an expired page"),
    };
    assert!(matches!(
        repository.scan(lease).await,
        Err(RepairError::LeaseLost)
    ));
    repository.scan(replacement).await.unwrap();
    assert_eq!(finish(&repository).await.rows_repaired, 1001);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn validation_is_after_the_marker_and_lock_failure_is_durably_deferred(pool: PgPool) {
    legacy_queue(&pool, UserProvider::Gmail, 2).await;
    let repository = PgProviderRepair(pool.clone());
    let lease = match repository.claim(Uuid::now_v7()).await.unwrap() {
        RepairClaim::Acquired(lease) => lease,
        _ => panic!("scan must be claimable"),
    };
    assert!(matches!(
        repository.validate(lease).await,
        Err(RepairError::InvalidState)
    ));
    repository.scan(lease).await.unwrap();
    for _ in 0..10 {
        let phase = sqlx::query_scalar!(
            "SELECT phase FROM email_reconciliation_provider_backfill WHERE name = 'v1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        if phase == RepairPhase::Validating.as_ref() {
            break;
        }
        repair_once(&repository).await.unwrap();
    }
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query!("LOCK TABLE email_message_reconciliation IN SHARE UPDATE EXCLUSIVE MODE")
        .execute(&mut *blocker)
        .await
        .unwrap();
    assert!(matches!(
        repair_once(&repository).await.unwrap(),
        RepairTick::ValidationDeferred
    ));
    let pending = sqlx::query!(
        r#"
        SELECT phase, scan_completed_at, completed_at, validation_failures, lease_id,
            available_at > clock_timestamp() AS "delayed!"
        FROM email_reconciliation_provider_backfill
        WHERE name = 'v1'
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(pending.phase, RepairPhase::Validating.as_ref());
    assert!(pending.scan_completed_at.is_some() && pending.completed_at.is_none());
    assert_eq!(pending.validation_failures, 1);
    assert!(pending.lease_id.is_none() && pending.delayed);
    assert!(matches!(
        repository.claim(Uuid::now_v7()).await.unwrap(),
        RepairClaim::Busy
    ));
    blocker.rollback().await.unwrap();
    sqlx::query!(
        "UPDATE email_reconciliation_provider_backfill SET available_at = clock_timestamp() WHERE name = 'v1'",
    )
    .execute(&pool).await.unwrap();
    assert!(matches!(
        repair_once(&repository).await.unwrap(),
        RepairTick::Complete
    ));
}

mod scale;

async fn reach_validation(repository: &PgProviderRepair) {
    for _ in 0..20 {
        if let RepairTick::Progress(batch) = repair_once(repository).await.unwrap() {
            if batch.phase == RepairPhase::Validating {
                return;
            }
        } else {
            panic!("the bounded fixture must finish its scan before validation");
        }
    }
    panic!("small fixture exceeded its page bound");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn more_than_eight_lock_failures_never_consume_the_constraint_cap(pool: PgPool) {
    legacy_queue(&pool, UserProvider::Gmail, 2).await;
    let repository = PgProviderRepair(pool.clone());
    reach_validation(&repository).await;
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query!("LOCK TABLE email_message_reconciliation IN SHARE UPDATE EXCLUSIVE MODE")
        .execute(&mut *blocker)
        .await
        .unwrap();
    for attempt in 1..=9 {
        assert!(matches!(
            repair_once(&repository).await.unwrap(),
            RepairTick::ValidationDeferred
        ));
        let progress = sqlx::query!(
            r#"
            SELECT validation_failures, constraint_failures
            FROM email_reconciliation_provider_backfill
            WHERE name = 'v1'
            "#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(progress.validation_failures, attempt);
        assert_eq!(progress.constraint_failures, 0);
        sqlx::query!(
            r#"
            UPDATE email_reconciliation_provider_backfill
            SET available_at = clock_timestamp()
            WHERE name = 'v1'
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    blocker.rollback().await.unwrap();
    assert!(matches!(
        repair_once(&repository).await.unwrap(),
        RepairTick::Complete
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn inconsistent_legacy_streams_reach_a_durable_capped_alarm_state(pool: PgPool) {
    let link = legacy_queue(&pool, UserProvider::Gmail, 0).await;
    let stream = Uuid::now_v7();
    let mut seed = pool.begin().await.unwrap();
    // Reproduce unsupported legacy corruption only inside this isolated test.
    sqlx::query!("SET LOCAL session_replication_role = 'replica'")
        .execute(&mut *seed)
        .await
        .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_sync_streams (id, link_id, generation, kind, scope_id, provider)
        VALUES ($1, $2, 1, 'mail_folder', 'legacy-inbox', 'OUTLOOK')
        ON CONFLICT (id) DO NOTHING
        "#,
        stream,
        link,
    )
    .execute(&mut *seed)
    .await
    .unwrap();
    seed.commit().await.unwrap();
    let repository = PgProviderRepair(pool.clone());
    reach_validation(&repository).await;
    for attempt in 1..=8 {
        let tick = repair_once(&repository).await.unwrap();
        assert_eq!(tick.delay().as_secs(), if attempt == 8 { 3600 } else { 5 });
        let progress = sqlx::query!(
            r#"
            SELECT validation_failures, constraint_failures
            FROM email_reconciliation_provider_backfill
            WHERE name = 'v1'
            "#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(progress.validation_failures, attempt);
        assert_eq!(progress.constraint_failures, attempt);
        sqlx::query!(
            r#"
            UPDATE email_reconciliation_provider_backfill
            SET available_at = clock_timestamp()
            WHERE name = 'v1'
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    // Even after repairing the fixture, a capped worker emits an alarm heartbeat
    // instead of silently starting another validation scan or claiming completion.
    sqlx::query!(
        r#"
        UPDATE email_sync_streams
        SET provider = 'GMAIL'
        WHERE id = $1
        "#,
        stream,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repair_once(&repository).await.unwrap().delay().as_secs(),
        3600
    );
    let status = sqlx::query!(
        r#"
        SELECT validation_failures, constraint_failures, completed_at,
            available_at > clock_timestamp() + interval '59 minutes' AS "delayed!"
        FROM email_reconciliation_provider_backfill
        WHERE name = 'v1'
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(status.constraint_failures, 8);
    assert_eq!(status.validation_failures, 8);
    assert!(status.completed_at.is_none() && status.delayed);
    let validated = sqlx::query_scalar!(
        r#"
        SELECT count(*) FILTER (WHERE convalidated) AS "validated!"
        FROM pg_constraint
        WHERE conname IN (
            'email_message_reconciliation_link_provider_fkey',
            'email_sync_streams_link_provider_fkey'
        )
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(validated, 0);

    // This is the runbook's approved cap-only reset, after the fixture repair.
    // Keep its scan cursor, marker and historical failures intact.
    let mut recovery = pool.begin().await.unwrap();
    sqlx::query!("SET LOCAL lock_timeout = '1s'")
        .execute(&mut *recovery)
        .await
        .unwrap();
    sqlx::query!("SET LOCAL statement_timeout = '5s'")
        .execute(&mut *recovery)
        .await
        .unwrap();
    let changed = sqlx::query!(
        r#"
        UPDATE public.email_reconciliation_provider_backfill
        SET
            constraint_failures = 0,
            available_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE name = 'v1'
            AND phase = 'validating'
            AND constraint_failures >= 8
            AND lease_id IS NULL
        "#,
    )
    .execute(&mut *recovery)
    .await
    .unwrap()
    .rows_affected();
    assert_eq!(changed, 1);
    recovery.commit().await.unwrap();
    assert!(matches!(
        repair_once(&repository).await.unwrap(),
        RepairTick::Complete
    ));
    match repository.claim(Uuid::now_v7()).await.unwrap() {
        RepairClaim::Complete(progress) => {
            assert_eq!(progress.constraint_failures, 0);
            assert_eq!(progress.validation_failures, 8);
        }
        _ => panic!("the authorized reset must resume validation and complete"),
    }
}
