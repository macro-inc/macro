use models_email::service::{
    label::{LabelInfo, system_labels},
    message::ParsedSearchMessage,
};

use super::*;

fn message(label: Option<&str>, content: Option<&str>) -> ParsedSearchMessage {
    ParsedSearchMessage {
        db_id: Uuid::new_v4(),
        link_id: Uuid::new_v4(),
        thread_db_id: Uuid::new_v4(),
        subject: None,
        from: None,
        reply_to: None,
        to: Vec::new(),
        cc: Vec::new(),
        bcc: Vec::new(),
        labels: label
            .map(|provider_id| {
                vec![LabelInfo {
                    provider_id: provider_id.to_string(),
                    name: provider_id.to_string(),
                }]
            })
            .unwrap_or_default(),
        body_parsed_linkless: content.map(str::to_string),
        internal_date_ts: None,
        excluded_from_search: false,
    }
}

/// A message its mailbox facts put in Trash or Junk or gone at the provider;
/// an Outlook one has no label saying so.
fn excluded(content: Option<&str>) -> ParsedSearchMessage {
    ParsedSearchMessage {
        excluded_from_search: true,
        ..message(None, content)
    }
}

#[test]
fn classifies_mixed_thread_messages() {
    let messages = [
        excluded(Some("trashed at Outlook")),
        excluded(None),
        message(Some(system_labels::INBOX), None),
        message(Some(system_labels::INBOX), Some("ordinary")),
    ];

    let dispositions: Vec<_> = messages.iter().map(classify_thread_message).collect();

    assert_eq!(
        dispositions,
        vec![
            ThreadMessageDisposition::Delete,
            ThreadMessageDisposition::Delete,
            ThreadMessageDisposition::SkipMissingContent,
            ThreadMessageDisposition::Upsert,
        ]
    );
}

#[test]
fn indexes_a_message_without_a_from_contact() {
    let message = message(Some(system_labels::INBOX), None);
    let now = EpochMillis::new(0).expect("epoch is a valid timestamp");

    let args = upsert_args(message, "body".into(), "owner", Vec::new(), now);

    assert_eq!(args.sender, "");
    assert_eq!(args.content, "body");
}

type Requests = std::sync::Arc<std::sync::Mutex<Vec<(String, String)>>>;

/// Stands in for OpenSearch: records each request as `METHOD path?query` with
/// its body, accepts document writes, and answers deletes-by-query.
async fn fake_opensearch() -> (opensearch_client::OpensearchClient, Requests) {
    use axum::{
        Json,
        body::Bytes,
        http::{Method, Uri},
        response::IntoResponse,
    };

    let requests = Requests::default();
    let recorded = requests.clone();
    let app = axum::Router::new().fallback(move |method: Method, uri: Uri, body: Bytes| {
        let recorded = recorded.clone();
        async move {
            recorded.lock().unwrap().push((
                format!("{method} {uri}"),
                String::from_utf8_lossy(&body).into_owned(),
            ));
            if uri.path().ends_with("/_delete_by_query") {
                Json(serde_json::json!({ "deleted": 1, "version_conflicts": 0, "failures": [] }))
                    .into_response()
            } else {
                Json(serde_json::json!({ "result": "created" })).into_response()
            }
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (
        opensearch_client::OpensearchClient::new(endpoint, String::new(), String::new()).unwrap(),
        requests,
    )
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn a_sent_message_is_indexed_under_its_thread_then_its_old_copies_go(pool: sqlx::PgPool) {
    let link_id = Uuid::now_v7();
    let thread_id = Uuid::now_v7();
    let message_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
         VALUES ($1, 'macro|sender@example.com', 'sender', 'sender@example.com', 'GMAIL')",
        link_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_threads (id, link_id) VALUES ($1, $2)",
        thread_id,
        link_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_messages (id, thread_id, link_id, subject, body_text, internal_date_ts)
         VALUES ($1, $2, $3, 'subject', 'hello there', now())",
        message_id,
        thread_id,
        link_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let (opensearch, requests) = fake_opensearch().await;

    process_upsert_sent_message(&opensearch, &pool, message_id, "macro|sender@example.com")
        .await
        .unwrap();

    let requests = requests.lock().unwrap().clone();
    assert_eq!(requests.len(), 2, "{requests:?}");
    assert!(
        requests[0].0.starts_with("POST /emails/_doc/")
            && requests[0].0.contains(&thread_id.to_string()),
        "the new copy is written first: {}",
        requests[0].0
    );
    assert!(
        requests[1].0.starts_with("POST /emails/_delete_by_query?")
            && !requests[1].0.contains("refresh"),
        "{}",
        requests[1].0
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&requests[1].1).unwrap(),
        serde_json::json!({
            "query": {
                "bool": {
                    "filter": [{ "term": { "message_id": message_id.to_string() } }],
                    "must_not": [{ "term": { "entity_id": thread_id.to_string() } }]
                }
            }
        })
    );
}

/// Stands in for OpenSearch's `_bulk`: answers the first request with
/// `first`, every later one with success, and counts them.
async fn bulk_answering_first_with(
    first: serde_json::Value,
) -> (
    opensearch_client::OpensearchClient,
    std::sync::Arc<std::sync::atomic::AtomicUsize>,
) {
    use axum::{Json, http::Uri, response::IntoResponse};
    use std::sync::atomic::{AtomicUsize, Ordering};

    let bulks = std::sync::Arc::new(AtomicUsize::new(0));
    let counted = bulks.clone();
    let app = axum::Router::new().fallback(move |uri: Uri| {
        let (counted, first) = (counted.clone(), first.clone());
        async move {
            if !uri.path().ends_with("/_bulk") {
                return Json(serde_json::json!({ "deleted": 0, "failures": [] })).into_response();
            }
            if counted.fetch_add(1, Ordering::SeqCst) == 0 {
                return Json(first).into_response();
            }
            Json(serde_json::json!({
                "errors": false,
                "items": [{ "index": { "status": 201 } }]
            }))
            .into_response()
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (
        opensearch_client::OpensearchClient::new(endpoint, String::new(), String::new()).unwrap(),
        bulks,
    )
}

/// A thread with one more message than a page holds, so it is written in two
/// bulk requests.
async fn two_page_thread(pool: &sqlx::PgPool) -> Uuid {
    let link_id = Uuid::now_v7();
    let thread_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
         VALUES ($1, 'macro|owner@example.com', 'owner', 'owner@example.com', 'GMAIL')",
        link_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_threads (id, link_id) VALUES ($1, $2)",
        thread_id,
        link_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_messages (id, thread_id, link_id, subject, body_text, internal_date_ts)
         SELECT gen_random_uuid(), $1, $2, 'subject', 'hello there', now()
         FROM generate_series(1, 101)",
        thread_id,
        link_id,
    )
    .execute(pool)
    .await
    .unwrap();
    thread_id
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn a_page_with_rejected_items_does_not_keep_later_pages_out(pool: sqlx::PgPool) {
    let thread_id = two_page_thread(&pool).await;
    let (opensearch, bulks) = bulk_answering_first_with(serde_json::json!({
        "errors": true,
        "items": [
            { "index": { "status": 201 } },
            { "index": { "status": 400, "error": {
                "type": "mapper_parsing_exception", "reason": "failed to parse field" } } }
        ]
    }))
    .await;

    let result = process_upsert_thread_message(
        &opensearch,
        &pool,
        thread_id,
        "macro|owner@example.com",
        None,
    )
    .await;

    assert_eq!(bulks.load(std::sync::atomic::Ordering::SeqCst), 2);
    let error = result.expect_err("the rejected item still fails the thread");
    assert!(
        matches!(
            error.downcast_ref::<opensearch_client::error::OpensearchClientError>(),
            Some(
                opensearch_client::error::OpensearchClientError::BulkItemsFailed {
                    failed: 1,
                    refusal: None,
                    ..
                }
            )
        ),
        "{error:?}"
    );
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn a_refused_page_stops_the_thread(pool: sqlx::PgPool) {
    let thread_id = two_page_thread(&pool).await;
    let (opensearch, bulks) = bulk_answering_first_with(serde_json::json!({
        "errors": true,
        "items": [{ "index": { "status": 429, "error": {
            "type": "rejected_execution_exception", "reason": "rejected execution" } } }]
    }))
    .await;

    let result = process_upsert_thread_message(
        &opensearch,
        &pool,
        thread_id,
        "macro|owner@example.com",
        None,
    )
    .await;

    assert_eq!(bulks.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(result.is_err());
}
