use super::*;
use crate::process::test_support::fake_opensearch;

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn a_message_of_a_chat_that_is_gone_removes_the_chat_from_search(pool: sqlx::PgPool) {
    let (opensearch, requests) = fake_opensearch().await;

    upsert_chat_message_by_ids(&opensearch, &pool, "chat-gone", "message-gone", None)
        .await
        .unwrap();

    let requests = requests.lock().unwrap().clone();
    assert_eq!(
        requests
            .iter()
            .map(|(line, _)| line.as_str())
            .collect::<Vec<_>>(),
        ["GET /chats/_refresh", "POST /chats/_delete_by_query"]
    );
    assert!(requests[1].1.contains("\"chat-gone\""), "{requests:?}");
    assert!(
        !requests[1].1.contains("message-gone"),
        "the whole chat goes, not one message: {requests:?}"
    );
}

#[sqlx::test(
    migrations = "../../crates/macro_db_client/migrations",
    fixtures(
        path = "../../../../../crates/macro_db_client/fixtures",
        scripts("chat_message_info")
    )
)]
async fn a_message_that_is_gone_from_a_live_chat_removes_only_that_message(pool: sqlx::PgPool) {
    let (opensearch, requests) = fake_opensearch().await;

    upsert_chat_message_by_ids(&opensearch, &pool, "chat-persistent", "message-gone", None)
        .await
        .unwrap();

    let requests = requests.lock().unwrap().clone();
    assert_eq!(
        requests
            .iter()
            .map(|(line, _)| line.as_str())
            .collect::<Vec<_>>(),
        ["GET /chats/_refresh", "POST /chats/_delete_by_query"]
    );
    assert!(requests[1].1.contains("message-gone"), "{requests:?}");
}

#[sqlx::test(
    migrations = "../../crates/macro_db_client/migrations",
    fixtures(
        path = "../../../../../crates/macro_db_client/fixtures",
        scripts("chat_message_info")
    )
)]
async fn a_message_that_is_gone_from_a_trashed_chat_removes_only_that_message(pool: sqlx::PgPool) {
    let (opensearch, requests) = fake_opensearch().await;

    upsert_chat_message_by_ids(&opensearch, &pool, "chat-deleted", "message-gone", None)
        .await
        .unwrap();

    let requests = requests.lock().unwrap().clone();
    assert_eq!(
        requests
            .iter()
            .map(|(line, _)| line.as_str())
            .collect::<Vec<_>>(),
        ["GET /chats/_refresh", "POST /chats/_delete_by_query"]
    );
    assert!(
        requests[1].1.contains("message-gone"),
        "a trashed chat stays searchable: {requests:?}"
    );
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn a_database_error_is_not_read_as_a_chat_that_is_gone(pool: sqlx::PgPool) {
    let (opensearch, requests) = fake_opensearch().await;
    pool.close().await;

    let result =
        upsert_chat_message_by_ids(&opensearch, &pool, "chat-gone", "message-gone", None).await;

    assert!(result.is_err(), "a failed read is retried");
    assert_eq!(*requests.lock().unwrap(), Vec::new());
}
