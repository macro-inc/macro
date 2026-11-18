use super::*;

#[test]
fn resolves_default_email_destination() {
    assert_eq!(
        resolve_destination(None),
        models_opensearch::SearchIndex::Emails.as_ref()
    );
}

#[test]
fn resolves_overridden_email_destination() {
    assert_eq!(
        resolve_destination(Some("emails_backfill")),
        "emails_backfill"
    );
}

#[test]
fn delete_by_query_counts_default_to_zero_and_failures_fail_the_call() {
    assert_eq!(
        parse_deleted_by_query(r#"{"deleted":2,"version_conflicts":1,"failures":[]}"#).unwrap(),
        DeletedByQuery {
            deleted: 2,
            version_conflicts: 1
        }
    );
    assert_eq!(
        parse_deleted_by_query(r#"{"took":3}"#).unwrap(),
        DeletedByQuery::default()
    );
    assert!(
        parse_deleted_by_query(
            r#"{"deleted":0,"failures":[{"cause":{"type":"es_rejected_execution_exception"}}]}"#
        )
        .is_err()
    );
}

fn scripted(
    passes: Vec<DeletedByQuery>,
) -> (
    std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<DeletedByQuery>>>,
    impl FnMut() -> std::future::Ready<Result<DeletedByQuery>>,
) {
    let passes = std::sync::Arc::new(std::sync::Mutex::new(std::collections::VecDeque::from(
        passes,
    )));
    let remaining = std::sync::Arc::clone(&passes);
    (passes, move || {
        std::future::ready(Ok(remaining
            .lock()
            .unwrap()
            .pop_front()
            .expect("no unscripted delete pass")))
    })
}

fn counted_refresh(
    refreshes: &std::sync::atomic::AtomicUsize,
) -> impl FnOnce() -> std::future::Ready<Result<()>> + '_ {
    move || {
        refreshes.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        std::future::ready(Ok(()))
    }
}

#[tokio::test]
async fn a_message_delete_without_conflicts_runs_once_and_never_refreshes() {
    let refreshes = std::sync::atomic::AtomicUsize::new(0);
    let (left, pass) = scripted(vec![DeletedByQuery {
        deleted: 1,
        version_conflicts: 0,
    }]);

    let deleted = delete_with_recheck(pass, counted_refresh(&refreshes))
        .await
        .unwrap();

    assert_eq!(
        deleted,
        EmailMessageDeleted {
            deleted: 1,
            passes: 1
        }
    );
    assert!(left.lock().unwrap().is_empty());
    assert_eq!(refreshes.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_conflicted_message_delete_refreshes_then_deletes_on_a_second_pass() {
    let refreshes = std::sync::atomic::AtomicUsize::new(0);
    let (left, pass) = scripted(vec![
        DeletedByQuery {
            deleted: 0,
            version_conflicts: 1,
        },
        DeletedByQuery {
            deleted: 1,
            version_conflicts: 0,
        },
    ]);

    let deleted = delete_with_recheck(pass, counted_refresh(&refreshes))
        .await
        .unwrap();

    assert_eq!(
        deleted,
        EmailMessageDeleted {
            deleted: 1,
            passes: 2
        }
    );
    assert!(left.lock().unwrap().is_empty());
    assert_eq!(refreshes.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_message_that_keeps_conflicting_fails_for_the_caller_to_retry() {
    let refreshes = std::sync::atomic::AtomicUsize::new(0);
    let (_, pass) = scripted(vec![
        DeletedByQuery {
            deleted: 0,
            version_conflicts: 1,
        },
        DeletedByQuery {
            deleted: 0,
            version_conflicts: 1,
        },
    ]);

    assert!(
        delete_with_recheck(pass, counted_refresh(&refreshes))
            .await
            .is_err()
    );
}

#[test]
fn a_thread_page_delete_with_a_conflict_fails_so_the_thread_is_reread() {
    assert!(
        fail_on_conflict(DeletedByQuery {
            deleted: 2,
            version_conflicts: 1
        })
        .is_err()
    );
    assert_eq!(
        fail_on_conflict(DeletedByQuery {
            deleted: 2,
            version_conflicts: 0
        })
        .unwrap(),
        DeletedByQuery {
            deleted: 2,
            version_conflicts: 0
        }
    );
}

#[tokio::test]
async fn a_thread_page_is_one_delete_by_query_over_all_its_message_ids() {
    let (url, server) = crate::test_support::serve_once(
        "200 OK",
        r#"{"deleted":2,"version_conflicts":0,"failures":[]}"#,
    );
    let client = crate::OpensearchClient::new(url, "".into(), "".into()).unwrap();

    client
        .delete_email_messages(&["message-1".to_owned(), "message-2".to_owned()], None)
        .await
        .unwrap();
    let (request_line, request_body) = server.join().unwrap();

    assert!(
        request_line.starts_with("POST /emails/_delete_by_query?"),
        "{request_line}"
    );
    assert!(request_line.contains("conflicts=proceed"), "{request_line}");
    assert!(request_line.contains("refresh=true"), "{request_line}");
    let body: serde_json::Value = serde_json::from_str(&request_body).unwrap();
    assert_eq!(
        body,
        serde_json::json!({ "query": { "terms": { "message_id": ["message-1", "message-2"] } } })
    );
}

#[tokio::test]
async fn a_page_without_spam_or_trash_sends_no_request() {
    // Nothing listens on port 1, so any request would fail.
    let client =
        crate::OpensearchClient::new("http://127.0.0.1:1".into(), "".into(), "".into()).unwrap();

    client.delete_email_messages(&[], None).await.unwrap();
}

#[tokio::test]
async fn a_page_over_the_id_limit_is_deleted_in_chunks_and_its_counts_summed() {
    let (first_url, first) = crate::test_support::serve_once(
        "200 OK",
        r#"{"deleted":1000,"version_conflicts":0,"failures":[]}"#,
    );
    let ids: Vec<String> = (0..MESSAGE_IDS_PER_DELETE + 1)
        .map(|index| format!("message-{index}"))
        .collect();
    let client = crate::OpensearchClient::new(first_url, "".into(), "".into()).unwrap();

    // The one-request server answers the first chunk; the second chunk then
    // finds nothing listening, which proves the ids went out in two requests.
    let result = client.delete_email_messages(&ids, None).await;
    let (_, first_body) = first.join().unwrap();

    let first_body: serde_json::Value = serde_json::from_str(&first_body).unwrap();
    assert_eq!(
        first_body["query"]["terms"]["message_id"]
            .as_array()
            .unwrap()
            .len(),
        MESSAGE_IDS_PER_DELETE
    );
    assert!(result.is_err(), "the second chunk needed its own request");
}

#[test]
fn chunk_counts_add_up() {
    let mut total = DeletedByQuery {
        deleted: 2,
        version_conflicts: 0,
    };
    total += DeletedByQuery {
        deleted: 3,
        version_conflicts: 1,
    };
    assert_eq!(
        total,
        DeletedByQuery {
            deleted: 5,
            version_conflicts: 1
        }
    );
}

#[tokio::test]
async fn a_message_delete_goes_by_id_then_sweeps_other_threads_without_forcing_a_refresh() {
    let (url, server) = crate::test_support::serve_in_order(vec![
        ("200 OK", r#"{"result":"deleted"}"#),
        (
            "200 OK",
            r#"{"deleted":1,"version_conflicts":0,"failures":[]}"#,
        ),
    ]);
    let client = crate::OpensearchClient::new(url, "".into(), "".into()).unwrap();

    client
        .delete_email_message("message-1", "thread-1", None)
        .await
        .unwrap();
    let requests = server.join().unwrap();

    let (by_id, _) = &requests[0];
    assert!(
        by_id.starts_with("DELETE /emails/_doc/thread-1%3Amessage-1 "),
        "{by_id}"
    );
    let (sweep, sweep_body) = &requests[1];
    assert!(
        sweep.starts_with("POST /emails/_delete_by_query?"),
        "{sweep}"
    );
    assert!(sweep.contains("conflicts=proceed"), "{sweep}");
    assert!(sweep.contains("refresh=false"), "{sweep}");
    let body: serde_json::Value = serde_json::from_str(sweep_body).unwrap();
    assert_eq!(
        body,
        serde_json::json!({ "query": { "bool": {
            "filter": [{ "term": { "message_id": "message-1" } }],
            "must_not": [{ "ids": { "values": ["thread-1:message-1"] } }],
        } } })
    );
}

#[tokio::test]
async fn a_message_never_indexed_under_its_thread_is_still_swept_elsewhere() {
    let (url, server) = crate::test_support::serve_in_order(vec![
        ("404 Not Found", r#"{"result":"not_found"}"#),
        (
            "200 OK",
            r#"{"deleted":0,"version_conflicts":0,"failures":[]}"#,
        ),
    ]);
    let client = crate::OpensearchClient::new(url, "".into(), "".into()).unwrap();

    client
        .delete_email_message("message-1", "thread-1", None)
        .await
        .unwrap();

    assert_eq!(server.join().unwrap().len(), 2);
}

#[test]
fn only_a_missing_document_is_a_harmless_404() {
    assert!(is_missing_document(404, r#"{"result":"not_found"}"#));
    assert!(!is_missing_document(
        404,
        r#"{"error":{"type":"index_not_found_exception"},"status":404}"#
    ));
    assert!(!is_missing_document(500, r#"{"result":"not_found"}"#));
}

async fn index_email_document(
    client: &opensearch::OpenSearch,
    index: &str,
    thread_id: &str,
    message_id: &str,
) -> anyhow::Result<()> {
    client
        .index(opensearch::IndexParts::IndexId(
            index,
            &crate::upsert::email::email_document_id(thread_id, message_id),
        ))
        .body(serde_json::json!({"entity_id": thread_id, "message_id": message_id}))
        .send()
        .await?
        .error_for_status_code()?;
    Ok(())
}

async fn refresh_email_index(client: &opensearch::OpenSearch, index: &str) -> anyhow::Result<()> {
    client
        .indices()
        .refresh(opensearch::indices::IndicesRefreshParts::Index(&[index]))
        .send()
        .await?
        .error_for_status_code()?;
    Ok(())
}

async fn refresh_count(client: &opensearch::OpenSearch, index: &str) -> anyhow::Result<u64> {
    let stats: serde_json::Value = client
        .indices()
        .stats(opensearch::indices::IndicesStatsParts::IndexMetric(
            &[index],
            &["refresh"],
        ))
        .send()
        .await?
        .error_for_status_code()?
        .json()
        .await?;
    Ok(stats["_all"]["primaries"]["refresh"]["total"]
        .as_u64()
        .unwrap_or_default())
}

async fn message_documents(
    client: &opensearch::OpenSearch,
    index: &str,
    message_id: &str,
) -> anyhow::Result<u64> {
    let body: serde_json::Value = client
        .count(opensearch::CountParts::Index(&[index]))
        .body(serde_json::json!({"query": {"term": {"message_id": message_id}}}))
        .send()
        .await?
        .error_for_status_code()?
        .json()
        .await?;
    Ok(body["count"].as_u64().unwrap_or_default())
}

/// The message's document under its own thread was indexed a moment ago and
/// no refresh has made it searchable; a copy under another thread is
/// searchable. Both go, and the delete forces no refresh.
#[tokio::test]
#[ignore = "requires local OpenSearch at http://localhost:9200"]
async fn a_deleted_message_leaves_every_thread_without_a_forced_refresh() {
    let client =
        crate::OpensearchClient::new("http://localhost:9200".into(), "".into(), "".into()).unwrap();
    let index = format!("email-message-delete-test-{}", uuid::Uuid::now_v7());
    client
        .ensure_index_exists(
            &index,
            serde_json::json!({
                "settings": {"number_of_shards": 2, "number_of_replicas": 0, "refresh_interval": "-1"},
                "mappings": {"dynamic": false, "properties": {
                    "entity_id": {"type": "keyword"},
                    "message_id": {"type": "keyword"}
                }}
            }),
        )
        .await
        .unwrap();
    let os = &client.inner;

    let result: anyhow::Result<()> = async {
        index_email_document(os, &index, "old-thread", "message-1").await?;
        index_email_document(os, &index, "old-thread", "message-2").await?;
        refresh_email_index(os, &index).await?;
        index_email_document(os, &index, "thread-1", "message-1").await?;
        let refreshes = refresh_count(os, &index).await?;

        let removed = delete_email_message(os, "message-1", "thread-1", Some(&index)).await?;

        assert_eq!(
            refresh_count(os, &index).await?,
            refreshes,
            "the delete forced a refresh"
        );
        assert!(removed.by_id);
        assert_eq!(
            removed.other_threads,
            EmailMessageDeleted {
                deleted: 1,
                passes: 1
            }
        );
        refresh_email_index(os, &index).await?;
        assert_eq!(message_documents(os, &index, "message-1").await?, 0);
        assert_eq!(
            message_documents(os, &index, "message-2").await?,
            1,
            "another message was deleted"
        );
        Ok(())
    }
    .await;
    os.indices()
        .delete(opensearch::indices::IndicesDeleteParts::Index(&[&index]))
        .send()
        .await
        .ok();
    result.unwrap();
}
