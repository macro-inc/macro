use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

// From the `get_process_scheduled_messages` fixture.
const LINK: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000e01);
const THREAD: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000e201);
const PARENT: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000e6a1);

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../../crates/email_db_client/fixtures",
        scripts("get_process_scheduled_messages")
    )
)]
async fn reply_to_an_unsynced_sent_parent_uses_its_delivery_identity(
    pool: PgPool,
) -> anyhow::Result<()> {
    // A sent sequence step inbox sync hasn't stored yet: no Message-ID header.
    sqlx::query!(
        r#"INSERT INTO email_messages (id, thread_id, link_id, provider_thread_id, is_draft, is_sent, from_contact_id, headers_jsonb)
           VALUES ($1, $2, $3, 'gmail-thread-1', false, true, '00000000-0000-0000-0000-0000000ce001', $4)"#,
        PARENT,
        THREAD,
        LINK,
        serde_json::json!([{ "Macro-In-Reply-To": "ignored" }]),
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, delivery_message_id, source)
           VALUES ($1, $2, NOW(), true, 'parent.1@example.com', 'sequence')"#,
        LINK,
        PARENT,
    )
    .execute(&pool)
    .await?;

    assert_eq!(
        generate_email_threading_headers(&pool, Some(PARENT), LINK).await,
        (
            Some("parent.1@example.com".to_owned()),
            Some(vec!["parent.1@example.com".to_owned()])
        )
    );
    Ok(())
}
