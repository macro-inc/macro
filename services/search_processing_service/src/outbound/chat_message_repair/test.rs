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

/// Stands in for OpenSearch: answers every request with `status` and `body`.
async fn opensearch_answering(status: u16, body: &'static str) -> Arc<OpensearchClient> {
    use axum::{http::StatusCode, response::IntoResponse};

    let status = StatusCode::from_u16(status).unwrap();
    let app = axum::Router::new().fallback(move || async move {
        (
            status,
            [(axum::http::header::CONTENT_TYPE, "application/json")],
            body,
        )
            .into_response()
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Arc::new(OpensearchClient::new(endpoint, String::new(), String::new()).unwrap())
}

fn gone() -> Vec<IndexedChatMessage> {
    ["message-a", "message-b", "message-c"]
        .map(|message_id| IndexedChatMessage {
            chat_id: "chat-1".to_owned(),
            message_id: message_id.to_owned(),
        })
        .to_vec()
}

#[tokio::test]
async fn a_blocked_index_is_a_refusal_that_stops_the_job() {
    let index = OpenSearchChatMessages(
        opensearch_answering(
            429,
            r#"{"error":{"type":"cluster_block_exception","reason":"index has read-only-allow-delete block"},"status":429}"#,
        )
        .await,
    );

    let result = index.delete(&gone()).await;

    assert!(
        matches!(result, Err(MessageIndexError::Refused(_))),
        "{result:?}"
    );
}

#[tokio::test]
async fn a_bulk_answer_is_counted_item_by_item() {
    let index = OpenSearchChatMessages(
        opensearch_answering(
            200,
            r#"{"errors":false,"items":[
                {"delete":{"_id":"chat-1:message-a","status":200,"result":"deleted"}},
                {"delete":{"_id":"chat-1:message-b","status":404,"result":"not_found"}},
                {"delete":{"_id":"chat-1:message-c","status":200,"result":"deleted"}}
            ]}"#,
        )
        .await,
    );

    let result = index.delete(&gone()).await.unwrap();

    assert_eq!(
        result,
        MessageDelete {
            deleted: 2,
            not_found: 1,
        }
    );
}

#[tokio::test]
async fn a_failed_item_stops_the_job_and_a_refused_one_is_a_refusal() {
    let failed = OpenSearchChatMessages(
        opensearch_answering(
            200,
            r#"{"errors":true,"items":[
                {"delete":{"_id":"chat-1:message-a","status":200,"result":"deleted"}},
                {"delete":{"_id":"chat-1:message-b","status":409,"error":{"type":"version_conflict_engine_exception"}}},
                {"delete":{"_id":"chat-1:message-c","status":200,"result":"deleted"}}
            ]}"#,
        )
        .await,
    );
    let refused = OpenSearchChatMessages(
        opensearch_answering(
            200,
            r#"{"errors":true,"items":[
                {"delete":{"_id":"chat-1:message-a","status":429,"error":{"type":"es_rejected_execution_exception"}}},
                {"delete":{"_id":"chat-1:message-b","status":200,"result":"deleted"}},
                {"delete":{"_id":"chat-1:message-c","status":200,"result":"deleted"}}
            ]}"#,
        )
        .await,
    );

    let failed = failed.delete(&gone()).await;
    let refused = refused.delete(&gone()).await;

    assert!(
        matches!(failed, Err(MessageIndexError::ItemsFailed(_))),
        "{failed:?}"
    );
    assert!(
        matches!(refused, Err(MessageIndexError::Refused(_))),
        "{refused:?}"
    );
}

#[tokio::test]
async fn a_refused_page_read_is_a_refusal_that_stops_the_job() {
    let index = OpenSearchChatMessages(
        opensearch_answering(
            429,
            r#"{"error":{"type":"es_rejected_execution_exception","reason":"rejected execution"},"status":429}"#,
        )
        .await,
    );

    let result = index
        .page_after(None, PageSize::try_from(500).unwrap())
        .await;

    assert!(
        matches!(result, Err(MessageIndexError::Refused(_))),
        "{result:?}"
    );
}
