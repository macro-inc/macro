use models_email::service::{label::LabelInfo, message::ParsedSearchMessage};

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
    }
}

#[test]
fn classifies_mixed_thread_messages() {
    let messages = [
        message(Some(system_labels::SPAM), Some("spam")),
        message(Some(system_labels::TRASH), None),
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
/// its body, accepts document and bulk writes, and answers deletes-by-query.
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
            } else if uri.path().ends_with("/_bulk") {
                Json(serde_json::json!({ "errors": false, "items": [] })).into_response()
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

/// A thread of `messages` messages a second apart, so pages split it the same
/// way on every read.
async fn thread_with_messages(pool: &sqlx::PgPool, messages: i32) -> Uuid {
    let link_id = Uuid::now_v7();
    let thread_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
         VALUES ($1, 'macro|owner@example.com', 'owner', $2, 'GMAIL')",
        link_id,
        format!("{link_id}@example.com"),
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
         SELECT gen_random_uuid(), $1, $2, 'subject', 'message ' || n, now() - make_interval(secs => n)
         FROM generate_series(1, $3) AS n",
        thread_id,
        link_id,
        messages,
    )
    .execute(pool)
    .await
    .unwrap();
    thread_id
}

/// Counts the page queries a thread reindex issues, by their span.
#[derive(Clone, Default)]
struct PageReads(std::sync::Arc<std::sync::atomic::AtomicUsize>);

impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for PageReads {
    fn on_new_span(
        &self,
        attributes: &tracing::span::Attributes<'_>,
        _: &tracing::span::Id,
        _: tracing_subscriber::layer::Context<'_, S>,
    ) {
        if attributes.metadata().name() == "get_paginated_parsed_search_messages_by_thread_id" {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
    }
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn a_thread_reindex_stops_at_its_first_short_page(pool: sqlx::PgPool) {
    use tracing::instrument::WithSubscriber as _;
    use tracing_subscriber::layer::SubscriberExt as _;

    let page_reads = PageReads::default();
    let subscriber =
        tracing::Dispatch::new(tracing_subscriber::registry().with(page_reads.clone()));
    // Another test thread may have registered the page query's callsite with
    // a "never" interest, so register it with a first pass, then recompute its
    // interest. The recompute runs under this subscriber because, while it is
    // the only one ever registered, tracing consults just the thread default.
    let warm_up = thread_with_messages(&pool, 1).await;
    let (opensearch, _) = fake_opensearch().await;
    process_upsert_thread_message(&opensearch, &pool, warm_up, "macro|owner@example.com", None)
        .with_subscriber(subscriber.clone())
        .await
        .unwrap();
    tracing::dispatcher::with_default(&subscriber, tracing::callsite::rebuild_interest_cache);

    // (messages in the thread, page queries, documents per bulk request)
    for (messages, expected_page_reads, expected_bulk_sizes) in
        [(1, 1, vec![1]), (100, 2, vec![100]), (101, 2, vec![100, 1])]
    {
        let thread_id = thread_with_messages(&pool, messages).await;
        let (opensearch, requests) = fake_opensearch().await;
        page_reads.0.store(0, std::sync::atomic::Ordering::SeqCst);

        process_upsert_thread_message(
            &opensearch,
            &pool,
            thread_id,
            "macro|owner@example.com",
            None,
        )
        .with_subscriber(subscriber.clone())
        .await
        .unwrap();

        let bulk_document_ids: Vec<Vec<String>> = requests
            .lock()
            .unwrap()
            .iter()
            .filter(|(request, _)| request.starts_with("POST /emails/_bulk"))
            .map(|(_, body)| {
                body.lines()
                    .filter_map(|line| {
                        let line: serde_json::Value = serde_json::from_str(line).unwrap();
                        line["index"]["_id"].as_str().map(str::to_string)
                    })
                    .collect()
            })
            .collect();
        let mut indexed: Vec<String> = bulk_document_ids.concat();
        indexed.sort();
        let mut stored: Vec<String> = sqlx::query_scalar!(
            "SELECT thread_id::text || ':' || id::text AS \"id!\" FROM email_messages WHERE thread_id = $1",
            thread_id,
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        stored.sort();

        assert_eq!(
            page_reads.0.load(std::sync::atomic::Ordering::SeqCst),
            expected_page_reads,
            "page queries for a thread of {messages}"
        );
        assert_eq!(
            bulk_document_ids.iter().map(Vec::len).collect::<Vec<_>>(),
            expected_bulk_sizes,
            "bulk requests for a thread of {messages}"
        );
        assert_eq!(
            indexed, stored,
            "every message of a thread of {messages} is indexed once"
        );
    }
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn a_page_with_rejected_items_does_not_keep_later_pages_out(pool: sqlx::PgPool) {
    let thread_id = thread_with_messages(&pool, 101).await;
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
    let thread_id = thread_with_messages(&pool, 101).await;
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
