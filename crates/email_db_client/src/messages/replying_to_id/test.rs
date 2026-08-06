use super::update_thread_messages_replying_to;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_signal_flag"))
)]
async fn bulk_reply_resolution_preserves_message_updated_at(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000d01")?;
    let thread_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d203")?;
    let parent_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d503")?;
    let child_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d504")?;

    sqlx::query!(
        r#"
        UPDATE email_messages
        SET global_id = 'parent-global-id'
        WHERE id = $1
        "#,
        parent_id
    )
    .execute(&pool)
    .await?;

    sqlx::query!(
        r#"
        UPDATE email_messages
        SET
            headers_jsonb = '[{"name": "In-Reply-To", "value": "parent-global-id"}]'::jsonb,
            updated_at = '2025-01-01 00:00:00+00'::timestamptz
        WHERE id = $1
        "#,
        child_id
    )
    .execute(&pool)
    .await?;

    let updated_at_before = sqlx::query_scalar!(
        "SELECT updated_at FROM email_messages WHERE id = $1",
        child_id
    )
    .fetch_one(&pool)
    .await?;

    let mut connection = pool.acquire().await?;
    update_thread_messages_replying_to(&mut connection, thread_id, link_id).await?;

    let resolved_message = sqlx::query!(
        "SELECT replying_to_id, updated_at FROM email_messages WHERE id = $1",
        child_id
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(resolved_message.replying_to_id, Some(parent_id));
    assert_eq!(resolved_message.updated_at, updated_at_before);

    Ok(())
}
