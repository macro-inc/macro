use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

// From the `get_process_scheduled_messages` fixture.
const LINK: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000e01);
const OTHER_LINK: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000e02);
const THREAD: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000e201);
const PARENT: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000e6a1);

async fn insert_parent(
    pool: &PgPool,
    is_draft: bool,
    is_sent: bool,
    provider_thread_id: Option<&str>,
    headers: Option<serde_json::Value>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO email_messages (id, thread_id, link_id, provider_thread_id, is_draft, is_sent, from_contact_id, headers_jsonb)
           VALUES ($1, $2, $3, $4, $5, $6, '00000000-0000-0000-0000-0000000ce001', $7)"#,
        PARENT,
        THREAD,
        LINK,
        provider_thread_id,
        is_draft,
        is_sent,
        headers,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn schedule_parent(
    pool: &PgPool,
    sent: bool,
    status: &str,
    delivery_message_id: Option<&str>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, processing, delivery_status, delivery_message_id, source)
           VALUES ($1, $2, NOW(), $3, $4 <> 'ready', $4, $5, 'sequence')"#,
        LINK,
        PARENT,
        sent,
        status,
        delivery_message_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

fn order_error(result: anyhow::Result<ReplyThreading>) -> Option<ReplyOrderError> {
    result.err()?.downcast_ref::<ReplyOrderError>().copied()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../../crates/email_db_client/fixtures",
        scripts("get_process_scheduled_messages")
    )
)]
async fn reply_waits_for_a_scheduled_parent(pool: PgPool) -> anyhow::Result<()> {
    insert_parent(&pool, true, false, None, None).await?;
    schedule_parent(&pool, false, "ready", None).await?;
    assert_eq!(
        order_error(reply_threading(&pool, Some(PARENT), LINK).await),
        Some(ReplyOrderError::ParentPending)
    );

    // An uncertain parent delivery may still have been sent; keep waiting.
    sqlx::query!(
        "UPDATE email_scheduled_messages SET delivery_status = 'unconfirmed', processing = true WHERE message_id = $1",
        PARENT
    )
    .execute(&pool)
    .await?;
    assert_eq!(
        order_error(reply_threading(&pool, Some(PARENT), LINK).await),
        Some(ReplyOrderError::ParentPending)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../../crates/email_db_client/fixtures",
        scripts("get_process_scheduled_messages")
    )
)]
async fn reply_fails_when_its_parent_will_not_be_sent(pool: PgPool) -> anyhow::Result<()> {
    insert_parent(&pool, true, false, None, None).await?;
    assert_eq!(
        order_error(reply_threading(&pool, Some(PARENT), LINK).await),
        Some(ReplyOrderError::ParentUnsent),
        "an unscheduled draft parent"
    );

    schedule_parent(&pool, false, "failed", Some("parent.1@example.com")).await?;
    assert_eq!(
        order_error(reply_threading(&pool, Some(PARENT), LINK).await),
        Some(ReplyOrderError::ParentUnsent),
        "a draft parent whose delivery failed"
    );

    // A failed immediate send is no longer a draft, but was not sent either.
    sqlx::query!(
        "UPDATE email_messages SET is_draft = false WHERE id = $1",
        PARENT
    )
    .execute(&pool)
    .await?;
    assert_eq!(
        order_error(reply_threading(&pool, Some(PARENT), LINK).await),
        Some(ReplyOrderError::ParentUnsent),
        "a failed send"
    );
    Ok(())
}

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
    insert_parent(
        &pool,
        false,
        true,
        Some("gmail-thread-1"),
        Some(serde_json::json!([{ "Macro-In-Reply-To": "ignored" }])),
    )
    .await?;
    schedule_parent(&pool, true, "ready", Some("parent.1@example.com")).await?;

    assert_eq!(
        reply_threading(&pool, Some(PARENT), LINK).await?,
        ReplyThreading {
            parent_message_id: Some("parent.1@example.com".to_owned()),
            references: Some(vec!["parent.1@example.com".to_owned()]),
            provider_thread_id: Some("gmail-thread-1".to_owned()),
        }
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../../crates/email_db_client/fixtures",
        scripts("get_process_scheduled_messages")
    )
)]
async fn reply_to_a_synced_parent_uses_its_headers(pool: PgPool) -> anyhow::Result<()> {
    insert_parent(
        &pool,
        false,
        true,
        Some("gmail-thread-1"),
        Some(serde_json::json!([
            { "name": "Message-ID", "value": "<synced@example.com>" },
            { "name": "References", "value": "<root@example.com>" },
        ])),
    )
    .await?;
    schedule_parent(&pool, true, "ready", Some("parent.1@example.com")).await?;

    assert_eq!(
        reply_threading(&pool, Some(PARENT), LINK).await?,
        ReplyThreading {
            parent_message_id: Some("synced@example.com".to_owned()),
            references: Some(vec![
                "root@example.com".to_owned(),
                "synced@example.com".to_owned()
            ]),
            provider_thread_id: Some("gmail-thread-1".to_owned()),
        }
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../../crates/email_db_client/fixtures",
        scripts("get_process_scheduled_messages")
    )
)]
async fn reply_without_a_reachable_parent_is_unthreaded(pool: PgPool) -> anyhow::Result<()> {
    assert_eq!(
        reply_threading(&pool, None, LINK).await?,
        ReplyThreading::default()
    );
    assert_eq!(
        reply_threading(&pool, Some(PARENT), LINK).await?,
        ReplyThreading::default(),
        "a deleted parent"
    );
    // A received parent in another inbox.
    insert_parent(&pool, false, false, Some("gmail-thread-1"), None).await?;
    assert_eq!(
        reply_threading(&pool, Some(PARENT), OTHER_LINK).await?,
        ReplyThreading::default(),
        "a parent in another inbox belongs to another account's threads"
    );
    Ok(())
}
