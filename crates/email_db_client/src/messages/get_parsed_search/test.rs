use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

// From the `get_thread_summary_info` fixture: a thread of two drafts.
const LINK: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000001c);
const THREAD: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000302);
const DRAFT: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_0000000e0604);
const STEP: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_0000000e0605);

fn ids(messages: Vec<ParsedSearchMessage>) -> Vec<Uuid> {
    messages.into_iter().map(|message| message.db_id).collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("get_thread_summary_info"))
)]
async fn search_reads_leave_out_pending_sequence_steps(pool: PgPool) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO email_scheduled_messages (link_id, message_id, send_time, source)
           VALUES ($1, $2, NOW() + INTERVAL '1 day', 'sequence')"#,
        LINK,
        STEP,
    )
    .execute(&pool)
    .await?;
    assert_eq!(
        ids(get_parsed_search_messages_by_thread_ids(&pool, &[THREAD]).await?),
        vec![DRAFT]
    );
    assert_eq!(
        ids(get_paginated_parsed_search_messages_by_thread_id(&pool, THREAD, 0, 100).await?),
        vec![DRAFT]
    );
    assert!(
        get_parsed_search_message_by_id(&pool, &STEP)
            .await?
            .is_none()
    );

    // A failed step is the user's draft again, searchable like any other.
    sqlx::query!(
        "UPDATE email_scheduled_messages SET delivery_status = 'failed', processing = true WHERE message_id = $1",
        STEP,
    )
    .execute(&pool)
    .await?;
    assert_eq!(
        ids(get_parsed_search_messages_by_thread_ids(&pool, &[THREAD]).await?),
        vec![STEP, DRAFT]
    );
    Ok(())
}
