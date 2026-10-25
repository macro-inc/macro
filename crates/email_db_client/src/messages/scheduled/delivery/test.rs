use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn identity() -> (Uuid, Uuid) {
    (
        Uuid::parse_str("00000000-0000-0000-0000-000000000e01").unwrap(),
        Uuid::parse_str("00000000-0000-0000-0000-00000000e501").unwrap(),
    )
}

async fn claim(pool: &PgPool) -> anyhow::Result<DeliveryClaim> {
    let (link, message) = identity();
    claim_delivery(pool, link, message, 300)
        .await?
        .ok_or_else(|| anyhow::anyhow!("expected a delivery claim"))
}

async fn expire(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE email_scheduled_messages SET delivery_lease_expires_at = NOW() - INTERVAL '1 second' WHERE message_id = $1",
        identity().1,
    ).execute(pool).await?;
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
struct State {
    token: Option<Uuid>,
    processing: bool,
    sent: bool,
    started: bool,
    status: String,
    expires: Option<chrono::DateTime<chrono::Utc>>,
}

async fn state(pool: &PgPool) -> anyhow::Result<State> {
    let row = sqlx::query!(
        r#"SELECT delivery_claim_id, processing, sent, delivery_started_at IS NOT NULL AS "started!",
                  delivery_status, delivery_lease_expires_at
           FROM email_scheduled_messages WHERE message_id = $1"#,
        identity().1,
    ).fetch_one(pool).await?;
    Ok(State {
        token: row.delivery_claim_id,
        processing: row.processing,
        sent: row.sent,
        started: row.started,
        status: row.delivery_status,
        expires: row.delivery_lease_expires_at,
    })
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("get_process_scheduled_messages")
    )
)]
async fn concurrent_claims_have_one_owner(pool: PgPool) -> anyhow::Result<()> {
    let (link, message) = identity();
    let (first, second) = tokio::join!(
        claim_delivery(&pool, link, message, 300),
        claim_delivery(&pool, link, message, 300),
    );
    let owners: Vec<_> = [first?, second?].into_iter().flatten().collect();
    assert_eq!(owners.len(), 1);
    assert!(!owners[0].requires_reconciliation);
    assert!(owners[0].message_id_header.is_some());
    assert_eq!(state(&pool).await?.token, Some(owners[0].token.0));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("get_process_scheduled_messages")
    )
)]
async fn expiry_before_submission_allows_preparation_with_same_message_id(
    pool: PgPool,
) -> anyhow::Result<()> {
    let first = claim(&pool).await?;
    expire(&pool).await?;
    assert!(!begin_submission(&pool, &first, 300).await?);
    let second = claim(&pool).await?;
    assert_ne!(first.token, second.token);
    assert_eq!(first.message_id_header, second.message_id_header);
    assert!(!second.requires_reconciliation);
    assert!(begin_submission(&pool, &second, 300).await?);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("get_process_scheduled_messages")
    )
)]
async fn expiry_after_submission_permits_only_reconciliation(pool: PgPool) -> anyhow::Result<()> {
    let first = claim(&pool).await?;
    assert!(begin_submission(&pool, &first, 300).await?);
    expire(&pool).await?;
    let second = claim(&pool).await?;
    assert!(second.requires_reconciliation);
    assert_eq!(first.message_id_header, second.message_id_header);
    assert!(!begin_submission(&pool, &second, 300).await?);
    let before = state(&pool).await?;
    release_preparation(&pool, &second, 0).await?;
    assert_eq!(state(&pool).await?, before);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("get_process_scheduled_messages")
    )
)]
async fn old_worker_claim_without_message_id_remains_ambiguous(pool: PgPool) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE email_scheduled_messages SET processing = true, updated_at = NOW() - INTERVAL '1 day' WHERE message_id = $1",
        identity().1,
    ).execute(&pool).await?;
    let recovered = claim(&pool).await?;
    assert!(recovered.requires_reconciliation);
    assert!(recovered.message_id_header.is_none());
    assert!(state(&pool).await?.started);
    assert!(!begin_submission(&pool, &recovered, 300).await?);
    expire(&pool).await?;
    let again = claim(&pool).await?;
    assert!(again.requires_reconciliation);
    assert!(again.message_id_header.is_none());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("get_process_scheduled_messages")
    )
)]
async fn reclaimed_worker_fences_every_stale_transition(pool: PgPool) -> anyhow::Result<()> {
    let old = claim(&pool).await?;
    expire(&pool).await?;
    let current = claim(&pool).await?;
    assert!(begin_submission(&pool, &current, 300).await?);
    let before = state(&pool).await?;
    assert!(!begin_submission(&pool, &old, 300).await?);
    assert_eq!(state(&pool).await?, before);
    release_preparation(&pool, &old, 0).await?;
    assert_eq!(state(&pool).await?, before);
    for unconfirmed in [false, true] {
        pause_delivery(&pool, &old, unconfirmed, 0).await?;
        assert_eq!(state(&pool).await?, before);
    }
    let mut tx = pool.begin().await?;
    assert!(!complete_delivery(&mut tx, &old).await?);
    tx.commit().await?;
    assert_eq!(state(&pool).await?, before);
    let mut tx = pool.begin().await?;
    assert!(complete_delivery(&mut tx, &current).await?);
    tx.commit().await?;
    assert!(state(&pool).await?.sent);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("get_process_scheduled_messages")
    )
)]
async fn failed_delivery_never_becomes_claimable_just_because_time_passes(
    pool: PgPool,
) -> anyhow::Result<()> {
    let first = claim(&pool).await?;
    pause_delivery(&pool, &first, false, 0).await?;
    expire(&pool).await?;
    let (link, message) = identity();
    assert!(claim_delivery(&pool, link, message, 300).await?.is_none());
    let current = state(&pool).await?;
    assert_eq!(current.status, "failed");
    assert!(
        current.processing,
        "old workers must not retry this paused row"
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("get_process_scheduled_messages")
    )
)]
async fn unconfirmed_delivery_can_only_be_claimed_for_lookup(pool: PgPool) -> anyhow::Result<()> {
    let first = claim(&pool).await?;
    assert!(begin_submission(&pool, &first, 300).await?);
    pause_delivery(&pool, &first, true, 300).await?;
    let (link, message) = identity();
    assert!(claim_delivery(&pool, link, message, 300).await?.is_none());
    expire(&pool).await?;
    let recovered = claim(&pool).await?;
    assert!(recovered.requires_reconciliation);
    assert!(!begin_submission(&pool, &recovered, 300).await?);
    let mut tx = pool.begin().await?;
    assert!(complete_delivery(&mut tx, &recovered).await?);
    tx.commit().await?;
    assert!(state(&pool).await?.sent);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("get_process_scheduled_messages")
    )
)]
async fn preparation_release_backs_off_and_preserves_stable_identity(
    pool: PgPool,
) -> anyhow::Result<()> {
    let first = claim(&pool).await?;
    release_preparation(&pool, &first, 300).await?;
    assert!(state(&pool).await?.processing);
    // An old deployed worker only understands this processing predicate.
    let claimed = sqlx::query!(
        "UPDATE email_scheduled_messages SET processing = true, updated_at = NOW() WHERE message_id = $1 AND processing = false AND sent = false RETURNING message_id",
        identity().1,
    ).fetch_optional(&pool).await?;
    assert!(claimed.is_none());
    let (link, message) = identity();
    assert!(claim_delivery(&pool, link, message, 300).await?.is_none());
    expire(&pool).await?;
    let retried = claim(&pool).await?;
    assert!(!retried.requires_reconciliation);
    assert_eq!(first.message_id_header, retried.message_id_header);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("get_process_scheduled_messages")
    )
)]
async fn pre_upgrade_unfenced_clear_cannot_reopen_uncertain_delivery(
    pool: PgPool,
) -> anyhow::Result<()> {
    let first = claim(&pool).await?;
    assert!(begin_submission(&pool, &first, 300).await?);
    expire(&pool).await?;
    let current = claim(&pool).await?;
    pause_delivery(&pool, &current, true, 300).await?;
    let before = state(&pool).await?;
    // This is deliberately the old unfenced UPDATE, not the guarded current helper.
    let error = sqlx::query!(
        "UPDATE email_scheduled_messages SET processing=false, updated_at=NOW() WHERE message_id=$1",
        identity().1,
    ).execute(&pool).await.unwrap_err();
    assert_eq!(
        error
            .as_database_error()
            .and_then(|error| error.code())
            .as_deref(),
        Some("23514")
    );
    assert_eq!(state(&pool).await?, before);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("get_process_scheduled_messages")
    )
)]
async fn pre_upgrade_successful_completion_remains_compatible(pool: PgPool) -> anyhow::Result<()> {
    let first = claim(&pool).await?;
    assert!(begin_submission(&pool, &first, 300).await?);
    sqlx::query!(
        "UPDATE email_scheduled_messages SET sent=true, processing=false, updated_at=NOW() WHERE message_id=$1",
        identity().1,
    ).execute(&pool).await?;
    let completed = state(&pool).await?;
    assert!(completed.sent);
    assert!(!completed.processing);
    assert!(
        claim_delivery(&pool, identity().0, identity().1, 300)
            .await?
            .is_none()
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("get_process_scheduled_messages")
    )
)]
async fn pre_upgrade_unfenced_clear_cannot_reopen_failed_delivery(
    pool: PgPool,
) -> anyhow::Result<()> {
    let current = claim(&pool).await?;
    pause_delivery(&pool, &current, false, 300).await?;
    let before = state(&pool).await?;
    let error = sqlx::query!(
        "UPDATE email_scheduled_messages SET processing=false, updated_at=NOW() WHERE message_id=$1",
        identity().1,
    ).execute(&pool).await.unwrap_err();
    assert_eq!(
        error
            .as_database_error()
            .and_then(|error| error.code())
            .as_deref(),
        Some("23514")
    );
    assert_eq!(state(&pool).await?, before);
    Ok(())
}
