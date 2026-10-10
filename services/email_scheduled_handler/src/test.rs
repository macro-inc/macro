use crate::outbound::fetch_pending_scheduled_messages;
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn fetch_pending_returns_only_eligible_messages(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let results = fetch_pending_scheduled_messages(&pool).await?;

    // Legacy non-draft immediate sends must never be resurrected.
    // - Message 1: Draft with past send_time, not sent
    // - Message 5: Draft with past send_time, not sent (different link)
    assert_eq!(results.len(), 2);

    let message_ids: Vec<Uuid> = results.iter().map(|r| r.message_id).collect();

    assert!(message_ids.contains(&Uuid::parse_str("00000000-0000-0000-0000-00000000f501")?));
    assert!(message_ids.contains(&Uuid::parse_str("00000000-0000-0000-0000-00000000f505")?));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn fetch_pending_excludes_future_send_time(pool: Pool<Postgres>) -> Result<()> {
    let results = fetch_pending_scheduled_messages(&pool).await?;

    let message_ids: Vec<Uuid> = results.iter().map(|r| r.message_id).collect();

    // Message 2 has future send_time, should not be included
    assert!(!message_ids.contains(&Uuid::parse_str("00000000-0000-0000-0000-00000000f502")?));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn fetch_pending_excludes_already_sent(pool: Pool<Postgres>) -> Result<()> {
    let results = fetch_pending_scheduled_messages(&pool).await?;

    let message_ids: Vec<Uuid> = results.iter().map(|r| r.message_id).collect();

    // Message 3 has sent = true, should not be included
    assert!(!message_ids.contains(&Uuid::parse_str("00000000-0000-0000-0000-00000000f503")?));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn fetch_pending_recovers_only_admitted_graphql_immediate_sends(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000f504")?;
    sqlx::query!(
        "UPDATE email_messages SET is_sent = false WHERE id = $1",
        message_id
    )
    .execute(&pool)
    .await?;
    assert!(
        !fetch_pending_scheduled_messages(&pool)
            .await?
            .iter()
            .any(|row| row.message_id == message_id)
    );
    sqlx::query!("INSERT INTO email_send_attempts (user_id,link_id,attempt_id,message_id) SELECT 'test',link_id,$1,id FROM email_messages WHERE id=$2", Uuid::new_v4(),message_id).execute(&pool).await?;
    assert!(
        fetch_pending_scheduled_messages(&pool)
            .await?
            .iter()
            .any(|row| row.message_id == message_id)
    );
    sqlx::query!(
        "UPDATE email_scheduled_messages SET processing = true WHERE message_id=$1",
        message_id
    )
    .execute(&pool)
    .await?;
    assert!(
        !fetch_pending_scheduled_messages(&pool)
            .await?
            .iter()
            .any(|row| row.message_id == message_id)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn scanner_recovers_managed_rest_sends_without_resurrecting_legacy_sends(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000f504")?;
    sqlx::query!(
        "UPDATE email_messages SET is_sent = false WHERE id = $1",
        message_id
    )
    .execute(&pool)
    .await?;
    assert!(
        !fetch_pending_scheduled_messages(&pool)
            .await?
            .iter()
            .any(|row| row.message_id == message_id)
    );

    // REST admission creates no GraphQL attempt. The managed claim is its fence.
    for (status, submitted) in [("ready", false), ("ready", true), ("unconfirmed", true)] {
        sqlx::query!(
            "UPDATE email_scheduled_messages SET delivery_claim_id=$2,
             delivery_status=$3, processing=$4,
             delivery_started_at=CASE WHEN $4 THEN NOW() ELSE NULL END,
             delivery_lease_expires_at=NOW()+INTERVAL '5 minutes' WHERE message_id=$1",
            message_id,
            Uuid::new_v4(),
            status,
            submitted,
        )
        .execute(&pool)
        .await?;
        assert!(
            !fetch_pending_scheduled_messages(&pool)
                .await?
                .iter()
                .any(|row| row.message_id == message_id)
        );
        sqlx::query!(
            "UPDATE email_scheduled_messages SET delivery_lease_expires_at=NOW()-INTERVAL '1 second' WHERE message_id=$1",
            message_id,
        ).execute(&pool).await?;
        assert!(
            fetch_pending_scheduled_messages(&pool)
                .await?
                .iter()
                .any(|row| row.message_id == message_id)
        );
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn fetch_pending_returns_correct_link_ids(pool: Pool<Postgres>) -> Result<()> {
    let results = fetch_pending_scheduled_messages(&pool).await?;

    let link_id_1 = Uuid::parse_str("00000000-0000-0000-0000-000000000f01")?;
    let link_id_2 = Uuid::parse_str("00000000-0000-0000-0000-000000000f02")?;

    // Find message from link 1
    let msg_from_link_1 = results
        .iter()
        .find(|r| r.message_id == Uuid::parse_str("00000000-0000-0000-0000-00000000f501").unwrap());
    assert!(msg_from_link_1.is_some());
    assert_eq!(msg_from_link_1.unwrap().link_id, link_id_1);

    // Find message from link 2
    let msg_from_link_2 = results
        .iter()
        .find(|r| r.message_id == Uuid::parse_str("00000000-0000-0000-0000-00000000f505").unwrap());
    assert!(msg_from_link_2.is_some());
    assert_eq!(msg_from_link_2.unwrap().link_id, link_id_2);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fetch_pending_returns_empty_when_no_scheduled_messages(
    pool: Pool<Postgres>,
) -> Result<()> {
    // No fixtures loaded, database is empty
    let results = fetch_pending_scheduled_messages(&pool).await?;

    assert!(results.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn scanner_recovers_expired_preparation_submission_and_legacy_claims(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message = Uuid::parse_str("00000000-0000-0000-0000-00000000f501")?;
    // Both modern phases have a lease. Neither may disappear from recovery forever.
    for submitted in [false, true] {
        sqlx::query!(
            "UPDATE email_scheduled_messages SET processing=true, delivery_claim_id=$2,
             delivery_lease_expires_at=NOW()-INTERVAL '1 second',
             delivery_started_at=CASE WHEN $3 THEN NOW()-INTERVAL '10 minutes' ELSE NULL END
             WHERE message_id=$1",
            message,
            Uuid::new_v4(),
            submitted,
        )
        .execute(&pool)
        .await?;
        assert!(
            fetch_pending_scheduled_messages(&pool)
                .await?
                .iter()
                .any(|row| row.message_id == message)
        );
    }
    sqlx::query!(
        "UPDATE email_scheduled_messages SET delivery_claim_id=NULL, delivery_lease_expires_at=NULL,
         delivery_started_at=NULL, updated_at=NOW()-INTERVAL '10 minutes' WHERE message_id=$1",
        message,
    )
    .execute(&pool)
    .await?;
    assert!(
        fetch_pending_scheduled_messages(&pool)
            .await?
            .iter()
            .any(|row| row.message_id == message)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn scanner_obeys_active_lease_and_preparation_backoff(pool: Pool<Postgres>) -> Result<()> {
    let message = Uuid::parse_str("00000000-0000-0000-0000-00000000f501")?;
    for processing in [true, false] {
        sqlx::query!(
            "UPDATE email_scheduled_messages SET processing=$2,
             delivery_lease_expires_at=NOW()+INTERVAL '5 minutes' WHERE message_id=$1",
            message,
            processing,
        )
        .execute(&pool)
        .await?;
        assert!(
            !fetch_pending_scheduled_messages(&pool)
                .await?
                .iter()
                .any(|row| row.message_id == message)
        );
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn scanner_does_not_restart_failed_delivery_after_expiry(pool: Pool<Postgres>) -> Result<()> {
    let message = Uuid::parse_str("00000000-0000-0000-0000-00000000f501")?;
    sqlx::query!(
        "UPDATE email_scheduled_messages SET processing=true, delivery_status='failed',
         delivery_lease_expires_at=NOW()-INTERVAL '1 day' WHERE message_id=$1",
        message,
    )
    .execute(&pool)
    .await?;
    assert!(
        !fetch_pending_scheduled_messages(&pool)
            .await?
            .iter()
            .any(|row| row.message_id == message)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("fetch_pending_scheduled_messages"))
)]
async fn scanner_retries_unconfirmed_lookups_only_after_backoff(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message = Uuid::parse_str("00000000-0000-0000-0000-00000000f501")?;
    sqlx::query!(
        "UPDATE email_scheduled_messages SET processing=true, delivery_status='unconfirmed',
         delivery_started_at=NOW(), delivery_lease_expires_at=NOW()+INTERVAL '5 minutes' WHERE message_id=$1",
        message,
    ).execute(&pool).await?;
    assert!(
        !fetch_pending_scheduled_messages(&pool)
            .await?
            .iter()
            .any(|row| row.message_id == message)
    );
    sqlx::query!(
        "UPDATE email_scheduled_messages SET delivery_lease_expires_at=NOW()-INTERVAL '1 second' WHERE message_id=$1",
        message,
    ).execute(&pool).await?;
    assert!(
        fetch_pending_scheduled_messages(&pool)
            .await?
            .iter()
            .any(|row| row.message_id == message)
    );
    Ok(())
}
