use super::*;
use sqlx::{Pool, Postgres};

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("chat_message_info")))]
async fn persistent_chat_messages_are_indexed_for_search(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let persistent = get_chat_message_info(&pool, "chat-persistent", "msg-persistent")
        .await?
        .expect("persistent chat message should be returned for indexing");
    assert_eq!(persistent.content, "codebase brighter");
    assert!(persistent.deleted_at.is_none());

    let ephemeral = get_chat_message_info(&pool, "chat-ephemeral", "msg-ephemeral")
        .await?
        .expect("ephemeral chat message should be returned for indexing");
    assert_eq!(ephemeral.content, "another message");
    assert!(ephemeral.deleted_at.is_none());

    Ok(())
}
