use super::*;
use agent_client_protocol::schema::v1::RequestId;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

const SESSION: &str = "11111111-1111-1111-1111-111111111111";
const OTHER_SESSION: &str = "22222222-2222-2222-2222-222222222222";

fn session() -> Uuid {
    Uuid::parse_str(SESSION).unwrap()
}

fn message(id: i64) -> RawJsonRpcMessage {
    RawJsonRpcMessage::request(
        "session/prompt".to_string(),
        serde_json::json!({"sessionId": "", "prompt": []}),
        RequestId::Number(id),
    )
    .unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users", "chats"))
)]
async fn enqueue_then_list_returns_oldest_first_per_session(pool: Pool<Postgres>) {
    let queue = PgPendingMessages::new(pool);

    queue.enqueue(session(), message(1)).await.unwrap();
    queue.enqueue(session(), message(2)).await.unwrap();
    queue
        .enqueue(Uuid::parse_str(OTHER_SESSION).unwrap(), message(3))
        .await
        .unwrap();

    let listed = queue.list(session()).await.unwrap();
    assert_eq!(listed.len(), 2);
    let ids: Vec<i64> = listed
        .iter()
        .map(|pending| match &pending.message {
            RawJsonRpcMessage::Request(request) => match &request.id {
                RequestId::Number(id) => *id,
                other => panic!("expected a numeric request id, got {other:?}"),
            },
            other => panic!("expected a request, got {other:?}"),
        })
        .collect();
    assert_eq!(ids, vec![1, 2]);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users", "chats"))
)]
async fn delete_removes_only_the_delivered_row(pool: Pool<Postgres>) {
    let queue = PgPendingMessages::new(pool);

    queue.enqueue(session(), message(1)).await.unwrap();
    queue.enqueue(session(), message(2)).await.unwrap();

    let listed = queue.list(session()).await.unwrap();
    queue.delete(listed[0].id).await.unwrap();

    let remaining = queue.list(session()).await.unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, listed[1].id);

    // Deleting an unknown id is not an error.
    queue.delete(macro_uuid::generate_uuid_v7()).await.unwrap();
}
