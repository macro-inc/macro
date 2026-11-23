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
    // Reproduce rows that existed BEFORE the provider-derivation trigger. This setting is
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
async fn an_empty_non_outlook_link_does_not_consume_a_repair_page(pool: PgPool) {
    let empty = legacy_queue(&pool, UserProvider::Gmail, 0).await;
    let populated = legacy_queue(&pool, UserProvider::Gmail, 2).await;
    let repository = PgProviderRepair(pool.clone());
    assert!(matches!(
        repair_once(&repository).await.unwrap(),
        RepairTick::Progress(_)
    ));
    let pending = sqlx::query_scalar!(
        "SELECT pending_links FROM email_reconciliation_provider_backfill WHERE name='v1'"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(pending, vec![populated]);
    assert!(!pending.contains(&empty));
    assert_eq!(finish(&repository).await.rows_repaired, 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_pending_link_does_not_strand_the_repair(pool: PgPool) {
    let deleted = legacy_queue(&pool, UserProvider::Gmail, 2).await;
    let retained = legacy_queue(&pool, UserProvider::Gmail, 3).await;
    let repository = PgProviderRepair(pool.clone());
    assert!(matches!(
        repair_once(&repository).await.unwrap(),
        RepairTick::Progress(_)
    ));
    sqlx::query!("DELETE FROM email_links WHERE id=$1", deleted)
        .execute(&pool)
        .await
        .unwrap();
    let progress = finish(&repository).await;
    assert_eq!(progress.rows_repaired, 3);
    let provider = sqlx::query_scalar!(
        r#"SELECT provider::text AS "provider!" FROM email_message_reconciliation
        WHERE link_id=$1 LIMIT 1"#,
        retained
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(provider, UserProvider::Gmail.as_str());
}

mod scale;
