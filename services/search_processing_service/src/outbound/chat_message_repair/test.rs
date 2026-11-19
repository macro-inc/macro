use super::*;

fn ids(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|id| id.to_string()).collect()
}

fn set(ids: &[&str]) -> HashSet<String> {
    ids.iter().map(|id| id.to_string()).collect()
}

#[sqlx::test(
    migrations = "../../crates/macro_db_client/migrations",
    fixtures(
        path = "../../../../../crates/macro_db_client/fixtures",
        scripts("chat_message_info")
    )
)]
async fn a_lookup_returns_the_messages_and_chats_that_still_have_rows(pool: PgPool) {
    let rows = PgChatRows::new(pool);

    let messages = rows
        .existing_messages(&ids(&["msg-persistent", "msg-gone", "msg-deleted"]))
        .await
        .unwrap();
    let chats = rows
        .existing_chats(&ids(&["chat-persistent", "chat-gone", "chat-deleted"]))
        .await
        .unwrap();

    assert_eq!(messages, set(&["msg-persistent", "msg-deleted"]));
    assert_eq!(
        chats,
        set(&["chat-persistent", "chat-deleted"]),
        "a trashed chat still has its row"
    );
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn an_empty_lookup_finds_nothing(pool: PgPool) {
    let rows = PgChatRows::new(pool);

    assert!(rows.existing_messages(&[]).await.unwrap().is_empty());
    assert!(rows.existing_chats(&[]).await.unwrap().is_empty());
}
