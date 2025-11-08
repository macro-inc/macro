use crate::model::Message;
use anyhow::{Context, Result};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

/// get all the messages around a message (before/after in same channel), including current
#[tracing::instrument(skip(db))]
pub async fn get_messages_with_context(
    db: &Pool<Postgres>,
    message_id: &Uuid,
    before: i64,
    after: i64,
) -> Result<Vec<Message>> {
    let msg = sqlx::query_as!(
        Message,
        r#"
        SELECT
        id,
        channel_id,
        sender_id,
        content,
        created_at,
        updated_at,
        thread_id,
        edited_at as "edited_at: chrono::DateTime<chrono::Utc>",
        deleted_at as "deleted_at: chrono::DateTime<chrono::Utc>"
        FROM comms_messages
        WHERE id = $1;
        "#,
        message_id
    )
    .fetch_one(db)
    .await;

    if let &Err(sqlx::Error::RowNotFound) = &msg {
        return Ok(vec![]);
    }

    let msg = msg.context("fetch message")?;

    let mut before = sqlx::query_as!(
        Message,
        r#"
        SELECT
            id,
            channel_id,
            sender_id,
            content,
            created_at,
            updated_at,
            thread_id,
            edited_at as "edited_at: chrono::DateTime<chrono::Utc>",
            deleted_at as "deleted_at: chrono::DateTime<chrono::Utc>"
        FROM comms_messages
        WHERE channel_id = (SELECT channel_id FROM comms_messages WHERE id=$1)
        AND
        created_at < (SELECT created_at FROM comms_messages WHERE id=$1)
        ORDER BY created_at DESC
        LIMIT $2
        "#,
        message_id,
        before
    )
    .fetch_all(db)
    .await
    .context("fetch message before")?
    .into_iter()
    .rev()
    .collect::<Vec<_>>();

    let mut after = sqlx::query_as!(
        Message,
        r#"
        SELECT
        id,
        channel_id,
        sender_id,
        content,
        created_at,
        updated_at,
        thread_id,
        edited_at as "edited_at: chrono::DateTime<chrono::Utc>",
        deleted_at as "deleted_at: chrono::DateTime<chrono::Utc>"
        FROM comms_messages
        WHERE channel_id = (SELECT channel_id FROM comms_messages WHERE id=$1)
        AND
        created_at > (SELECT created_at FROM comms_messages WHERE id=$1)
        ORDER BY created_at ASC
        LIMIT $2
        "#,
        message_id,
        after
    )
    .fetch_all(db)
    .await
    .context("fetch message after")?;

    let mut all = Vec::new();
    all.append(&mut before);
    all.push(msg);
    all.append(&mut after);
    Ok(all)
}

#[cfg(test)]
mod test {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("messages_with_context"))
    )]
    async fn test_get_single_message_only(pool: Pool<Postgres>) {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
        let message_id = uuid::uuid!("bbbbbbbb-0000-0000-0000-000000000005");

        let messages = get_messages_with_context(&pool, &message_id, 0, 0)
            .await
            .unwrap();

        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].id, message_id);
        assert_eq!(messages[0].content, "Message 5");
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("messages_with_context"))
    )]
    async fn test_get_messages_with_before_and_after(pool: Pool<Postgres>) {
        let message_id = uuid::uuid!("bbbbbbbb-0000-0000-0000-000000000005");

        let messages = get_messages_with_context(&pool, &message_id, 2, 3)
            .await
            .unwrap();

        // Should return: message 3, 4, 5, 6, 7, 8 (2 before, target, 3 after)
        assert_eq!(messages.len(), 6);

        // Verify order is chronological
        assert_eq!(messages[0].content, "Message 3");
        assert_eq!(messages[1].content, "Message 4");
        assert_eq!(messages[2].content, "Message 5"); // Target message
        assert_eq!(messages[3].content, "Message 6");
        assert_eq!(messages[4].content, "Message 7");
        assert_eq!(messages[5].content, "Message 8");
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("messages_with_context"))
    )]
    async fn test_get_messages_nonexistent_message(pool: Pool<Postgres>) {
        let message_id = uuid::uuid!("99999999-9999-9999-9999-999999999999");

        let result = get_messages_with_context(&pool, &message_id, 2, 3).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }
}
