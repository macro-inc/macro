use chrono::{Duration, TimeZone, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{PgPool, types::Uuid};

use super::*;

async fn insert_outlook_link(pool: &PgPool, suffix: &str) -> anyhow::Result<Uuid> {
    let link_id = Uuid::new_v4();
    let macro_id = format!("macro|outlook-sync-{suffix}@example.com");
    let email_address = format!("outlook-sync-{suffix}@example.com");
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
        VALUES ($1, $2, $2, $3, 'OUTLOOK')
        "#,
        link_id,
        macro_id,
        email_address
    )
    .execute(pool)
    .await?;

    Ok(link_id)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn crud_lookups_and_long_delta_cursor(pool: PgPool) -> anyhow::Result<()> {
    let link_id = insert_outlook_link(&pool, "primary").await?;
    let expires_at = Utc.timestamp_opt(1_900_000_000, 0).single().unwrap();
    let long_cursor = format!(
        "https://graph.microsoft.com/delta?token={}",
        "x".repeat(16_384)
    );

    assert!(get_outlook_sync_state(&pool, link_id).await?.is_none());

    upsert_outlook_sync_state(
        &pool,
        link_id,
        Some("subscription-1"),
        Some(expires_at),
        Some(&long_cursor),
    )
    .await?;

    let state = get_outlook_sync_state(&pool, link_id)
        .await?
        .expect("upserted state should exist");
    assert_eq!(state.subscription_id.as_deref(), Some("subscription-1"));
    assert_eq!(state.subscription_expires_at, Some(expires_at));
    assert_eq!(state.delta_cursor.as_deref(), Some(long_cursor.as_str()));

    let by_subscription = get_outlook_sync_state_by_subscription_id(&pool, "subscription-1")
        .await?
        .expect("subscription lookup should find the state");
    assert_eq!(by_subscription.link_id, link_id);

    assert!(
        get_outlook_sync_states_expiring_before(&pool, expires_at - Duration::seconds(1), 10)
            .await?
            .is_empty()
    );
    let expiring =
        get_outlook_sync_states_expiring_before(&pool, expires_at + Duration::seconds(1), 10)
            .await?;
    assert_eq!(expiring.len(), 1);
    assert_eq!(expiring[0].link_id, link_id);

    assert!(update_outlook_delta_cursor(&pool, link_id, Some("next-cursor")).await?);
    let renewed_expiry = expires_at + Duration::days(1);
    assert!(
        update_outlook_subscription(&pool, link_id, Some("subscription-2"), Some(renewed_expiry),)
            .await?
    );

    let updated = get_outlook_sync_state(&pool, link_id).await?.unwrap();
    assert_eq!(updated.delta_cursor.as_deref(), Some("next-cursor"));
    assert_eq!(updated.subscription_id.as_deref(), Some("subscription-2"));
    assert_eq!(updated.subscription_expires_at, Some(renewed_expiry));

    assert!(delete_outlook_sync_state(&pool, link_id).await?);
    assert!(!delete_outlook_sync_state(&pool, link_id).await?);
    assert!(get_outlook_sync_state(&pool, link_id).await?.is_none());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn subscription_is_unique_and_link_deletion_cascades(pool: PgPool) -> anyhow::Result<()> {
    let first_link_id = insert_outlook_link(&pool, "first").await?;
    let second_link_id = insert_outlook_link(&pool, "second").await?;

    upsert_outlook_sync_state(
        &pool,
        first_link_id,
        Some("unique-subscription"),
        None,
        None,
    )
    .await?;
    let duplicate = upsert_outlook_sync_state(
        &pool,
        second_link_id,
        Some("unique-subscription"),
        None,
        None,
    )
    .await;
    assert!(duplicate.is_err(), "subscription IDs must remain unique");

    sqlx::query!("DELETE FROM email_links WHERE id = $1", first_link_id)
        .execute(&pool)
        .await?;
    assert!(
        get_outlook_sync_state_by_subscription_id(&pool, "unique-subscription")
            .await?
            .is_none(),
        "deleting a link must cascade to its Outlook state"
    );

    Ok(())
}
