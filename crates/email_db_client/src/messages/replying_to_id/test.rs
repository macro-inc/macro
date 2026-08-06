use super::update_thread_messages_replying_to;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_signal_flag"))
)]
async fn resolves_stored_and_legacy_reply_chains_without_external_fallback(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000d01")?;
    let thread_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d203")?;
    let parent_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d503")?;
    let legacy_child_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d504")?;
    let stored_grandchild_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d590")?;
    let external_reference_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d591")?;
    let malformed_header_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d592")?;
    let absent_header_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d593")?;

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
            global_id = 'legacy-child-global-id',
            in_reply_to_message_id_header = NULL,
            headers_jsonb = '[{"name": "in-reply-to", "value": "  parent-global-id  "}]'::jsonb,
            updated_at = '2025-01-01 00:00:00+00'::timestamptz
        WHERE id = $1
        "#,
        legacy_child_id
    )
    .execute(&pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO email_messages (
            id, thread_id, link_id, provider_id, global_id, in_reply_to_message_id_header,
            headers_jsonb, has_attachments, is_read, is_starred, is_sent, is_draft
        )
        VALUES
            ($1, $5, $6, 'stored-grandchild', 'stored-grandchild-global-id', 'legacy-child-global-id', NULL, false, false, false, false, false),
            ($2, $5, $6, 'external-reference', 'external-reference-global-id', 'outside-this-thread', '[{"name":"In-Reply-To","value":"parent-global-id"}]'::jsonb, false, false, false, false, false),
            ($3, $5, $6, 'malformed-header', 'malformed-header-global-id', NULL, '{"name":"In-Reply-To","value":"parent-global-id"}'::jsonb, false, false, false, false, false),
            ($4, $5, $6, 'absent-header', 'absent-header-global-id', NULL, '[{"name":"Subject","value":"No reply"}]'::jsonb, false, false, false, false, false)
        "#,
        stored_grandchild_id,
        external_reference_id,
        malformed_header_id,
        absent_header_id,
        thread_id,
        link_id,
    )
    .execute(&pool)
    .await?;

    let updated_at_before = sqlx::query_scalar!(
        "SELECT updated_at FROM email_messages WHERE id = $1",
        legacy_child_id
    )
    .fetch_one(&pool)
    .await?;

    let mut connection = pool.acquire().await?;
    update_thread_messages_replying_to(&mut connection, thread_id, link_id).await?;
    drop(connection);

    let resolved_messages = sqlx::query!(
        r#"
        SELECT id, replying_to_id
        FROM email_messages
        WHERE id = ANY($1)
        "#,
        &[
            legacy_child_id,
            stored_grandchild_id,
            external_reference_id,
            malformed_header_id,
            absent_header_id,
        ]
    )
    .fetch_all(&pool)
    .await?;

    let replying_to_id = |message_id| {
        resolved_messages
            .iter()
            .find(|message| message.id == message_id)
            .and_then(|message| message.replying_to_id)
    };

    assert_eq!(replying_to_id(legacy_child_id), Some(parent_id));
    assert_eq!(replying_to_id(stored_grandchild_id), Some(legacy_child_id));
    assert_eq!(replying_to_id(external_reference_id), None);
    assert_eq!(replying_to_id(malformed_header_id), None);
    assert_eq!(replying_to_id(absent_header_id), None);

    let updated_at_after = sqlx::query_scalar!(
        "SELECT updated_at FROM email_messages WHERE id = $1",
        legacy_child_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(updated_at_after, updated_at_before);

    Ok(())
}
