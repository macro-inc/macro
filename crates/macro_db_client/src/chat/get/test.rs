use super::*;
use sqlx::{Pool, Postgres};

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("chat_message_info")))]
async fn returns_persistent_and_ephemeral_chat_message_metadata(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let persistent = get_chat_message_info(&pool, "chat-persistent", "msg-persistent")
        .await?
        .expect("persistent chat message should be returned for indexing");
    assert_eq!(persistent.name, "persistent chat");
    assert_eq!(persistent.content, "codebase brighter");
    assert_eq!(persistent.role, "user");
    assert_eq!(persistent.owner_user_id, "macro|user@user.com");
    assert_eq!(
        persistent.created_at,
        "2024-01-02T03:04:05.123Z".parse::<DateTime<Utc>>()?
    );
    assert_eq!(
        persistent.updated_at,
        "2024-01-03T04:05:06.789Z".parse::<DateTime<Utc>>()?
    );
    assert!(persistent.deleted_at.is_none());

    let ephemeral = get_chat_message_info(&pool, "chat-ephemeral", "msg-ephemeral")
        .await?
        .expect("ephemeral chat message should be returned for indexing");
    assert_eq!(ephemeral.name, "ephemeral chat");
    assert_eq!(ephemeral.content, "another message");
    assert_eq!(ephemeral.role, "assistant");
    assert_eq!(ephemeral.owner_user_id, "macro|user@user.com");
    assert_eq!(
        ephemeral.created_at,
        "2024-02-02T03:04:05.123Z".parse::<DateTime<Utc>>()?
    );
    assert_eq!(
        ephemeral.updated_at,
        "2024-02-03T04:05:06.789Z".parse::<DateTime<Utc>>()?
    );
    assert!(ephemeral.deleted_at.is_none());

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("chat_message_info")))]
async fn returns_soft_deleted_chat_message_metadata(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let message = get_chat_message_info(&pool, "chat-deleted", "msg-deleted")
        .await?
        .expect("soft-deleted chat message should be returned for removal");

    assert_eq!(message.name, "deleted chat");
    assert_eq!(message.content, "remove from search");
    assert_eq!(message.role, "assistant");
    assert_eq!(message.owner_user_id, "macro|user@user.com");
    assert_eq!(
        message.created_at,
        "2024-03-02T03:04:05.123Z".parse::<DateTime<Utc>>()?
    );
    assert_eq!(
        message.updated_at,
        "2024-03-03T04:05:06.789Z".parse::<DateTime<Utc>>()?
    );
    assert_eq!(
        message.deleted_at,
        Some("2024-03-04T05:06:07.890Z".parse::<DateTime<Utc>>()?)
    );

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("chat_message_info")))]
async fn returns_none_for_missing_or_mismatched_message_id(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    assert!(
        get_chat_message_info(&pool, "chat-persistent", "msg-missing")
            .await?
            .is_none()
    );
    assert!(
        get_chat_message_info(&pool, "chat-ephemeral", "msg-persistent")
            .await?
            .is_none()
    );

    Ok(())
}
