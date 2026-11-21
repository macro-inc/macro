use super::*;
use crate::test_support::{Reply, serve_script};

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
        parse_deleted_by_query(
            r#"{"deleted":2,"version_conflicts":1,"failures":[]}"#,
            OpensearchOperation::DeleteEmailMessages
        )
        .unwrap(),
        DeletedByQuery {
            deleted: 2,
            version_conflicts: 1
        }
    );
    assert_eq!(
        parse_deleted_by_query(r#"{"took":3}"#, OpensearchOperation::DeleteEmailMessages).unwrap(),
        DeletedByQuery::default()
    );
    assert!(
        parse_deleted_by_query(
            r#"{"deleted":0,"failures":[{"cause":{"type":"es_rejected_execution_exception"}}]}"#,
            OpensearchOperation::DeleteEmailMessages,
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
    let (url, server) = serve_script(vec![
        Reply::Respond("200 OK", r#"{"result":"deleted"}"#),
        Reply::Respond(
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
    assert!(!sweep.contains("refresh=true"), "{sweep}");
    let body: serde_json::Value = serde_json::from_str(sweep_body).unwrap();
    assert_eq!(body, outside_thread_query("message-1", "thread-1"));
}

#[tokio::test]
async fn a_message_never_indexed_under_its_thread_is_still_swept_elsewhere() {
    let (url, server) = serve_script(vec![
        Reply::Respond("404 Not Found", r#"{"result":"not_found"}"#),
        Reply::Respond(
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

#[tokio::test]
async fn a_conflicted_page_delete_refreshes_before_it_fails() {
    let (url, server) = serve_script(vec![
        Reply::Respond(
            "200 OK",
            r#"{"deleted":0,"version_conflicts":1,"failures":[]}"#,
        ),
        Reply::Respond(
            "200 OK",
            r#"{"_shards":{"total":1,"successful":1,"failed":0}}"#,
        ),
    ]);
    let client = crate::OpensearchClient::new(url, "".into(), "".into()).unwrap();

    let result = client
        .delete_email_messages(&["message-1".to_owned()], None)
        .await;
    let requests = server.join().unwrap();

    assert!(result.is_err(), "the caller rereads the thread");
    assert!(
        requests[1].0.ends_with("/emails/_refresh HTTP/1.1"),
        "{}",
        requests[1].0
    );
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

/// The event thread's document is searchable and has a copy under another
/// thread; another message was indexed a moment ago and no refresh has made it
/// searchable. Each delete removes every copy without forcing a refresh, a
/// repeat within the refresh interval forces none either, and a thread
/// reindex that deletes the same message before the next refresh fails once,
/// refreshed, so its retry goes through.
#[tokio::test]
#[ignore = "requires local OpenSearch at http://localhost:9200"]
async fn deleted_messages_leave_every_thread_without_a_forced_refresh() {
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
        index_email_document(os, &index, "thread-1", "message-1").await?;
        index_email_document(os, &index, "old-thread", "message-1").await?;
        index_email_document(os, &index, "old-thread", "message-2").await?;
        refresh_email_index(os, &index).await?;
        index_email_document(os, &index, "thread-3", "message-3").await?;
        let refreshes = refresh_count(os, &index).await?;

        let first = delete_email_message(os, "message-1", "thread-1", Some(&index)).await?;
        let unrefreshed = delete_email_message(os, "message-3", "thread-3", Some(&index)).await?;
        let repeat = delete_email_message(os, "message-3", "thread-3", Some(&index)).await?;

        assert_eq!(
            refresh_count(os, &index).await?,
            refreshes,
            "a delete forced a refresh"
        );
        assert!(first.by_id);
        assert_eq!(
            first.other_threads,
            EmailMessageDeleted {
                deleted: 1,
                passes: 1
            }
        );
        assert!(unrefreshed.by_id, "found before any refresh");
        assert_eq!(unrefreshed.other_threads.passes, 1);
        assert!(!repeat.by_id);
        assert_eq!(repeat.other_threads.passes, 1);

        let page = ["message-1".to_owned()];
        assert!(
            client
                .delete_email_messages(&page, Some(&index))
                .await
                .is_err(),
            "the page delete meets the message's unrefreshed deletions"
        );
        client.delete_email_messages(&page, Some(&index)).await?;

        refresh_email_index(os, &index).await?;
        assert_eq!(message_documents(os, &index, "message-1").await?, 0);
        assert_eq!(message_documents(os, &index, "message-3").await?, 0);
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

#[test]
fn a_moved_message_keeps_only_its_copy_under_its_current_thread() {
    assert_eq!(
        outside_thread_query("message-1", "thread-2"),
        serde_json::json!({
            "query": {
                "bool": {
                    "filter": [{ "term": { "message_id": "message-1" } }],
                    "must_not": [{ "term": { "entity_id": "thread-2" } }]
                }
            }
        })
    );
}

#[tokio::test]
async fn deleting_a_moved_message_s_old_copies_forces_no_refresh() {
    let (url, server) = crate::test_support::serve_once(
        "200 OK",
        r#"{"deleted":1,"version_conflicts":0,"failures":[]}"#,
    );
    let client = crate::OpensearchClient::new(url, "".into(), "".into()).unwrap();

    client
        .delete_email_message_outside_thread("message-1", "thread-2")
        .await
        .unwrap();

    let (request_line, body) = server.join().unwrap();
    assert!(
        request_line.starts_with("POST /emails/_delete_by_query?"),
        "{request_line}"
    );
    assert!(request_line.contains("conflicts=proceed"), "{request_line}");
    assert!(!request_line.contains("refresh"), "{request_line}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&body).unwrap(),
        outside_thread_query("message-1", "thread-2")
    );
}

#[test]
fn a_running_delete_task_reports_its_progress() {
    let task = parse_email_delete_task(
        r#"{"completed":false,"task":{"status":{"total":40,"deleted":5}}}"#,
    )
    .unwrap();

    assert_eq!(
        task,
        EmailDeleteTask {
            deleted: 5,
            total: 40,
            state: EmailDeleteState::Running,
        }
    );
}

#[test]
fn a_completed_delete_task_reports_its_response_counts() {
    let task = parse_email_delete_task(
        r#"{"completed":true,"task":{"status":{"total":40,"deleted":39}},"response":{"total":40,"deleted":40,"failures":[],"timed_out":false,"canceled":""}}"#,
    )
    .unwrap();

    assert_eq!(
        task,
        EmailDeleteTask {
            deleted: 40,
            total: 40,
            state: EmailDeleteState::Completed,
        }
    );
}

#[test]
fn per_document_failures_fail_the_task_with_a_short_description() {
    let task = parse_email_delete_task(
        r#"{"completed":true,"response":{"total":40,"deleted":3,"failures":[{"cause":{"type":"es_rejected_execution_exception","reason":"rejected","caused_by":{"type":"nested"}}},{"cause":{"type":"other"}}]}}"#,
    )
    .unwrap();

    assert_eq!(
        task.state,
        EmailDeleteState::Failed(
            "2 failures, first: es_rejected_execution_exception: rejected".into()
        )
    );
    assert_eq!((task.deleted, task.total), (3, 40));
}

#[test]
fn a_task_error_fails_the_task() {
    let task = parse_email_delete_task(
        r#"{"completed":true,"error":{"type":"search_phase_execution_exception","reason":"all shards failed"}}"#,
    )
    .unwrap();

    assert_eq!(
        task.state,
        EmailDeleteState::Failed("search_phase_execution_exception: all shards failed".into())
    );
}

#[test]
fn a_cancelled_task_is_not_completed() {
    let task = parse_email_delete_task(
        r#"{"completed":true,"response":{"total":40,"deleted":10,"failures":[],"canceled":"by user request"}}"#,
    )
    .unwrap();

    assert_eq!(
        task.state,
        EmailDeleteState::Canceled("by user request".into())
    );
}

#[test]
fn a_timed_out_task_is_not_completed() {
    let task = parse_email_delete_task(
        r#"{"completed":true,"response":{"total":40,"deleted":10,"failures":[],"timed_out":true}}"#,
    )
    .unwrap();

    assert_eq!(task.state, EmailDeleteState::Failed("timed out".into()));
}

#[test]
fn a_started_task_returns_its_id() {
    assert_eq!(
        parse_started_task(r#"{"task":"oTUltX4IQMOUUVeiohTt8A:12345"}"#)
            .unwrap()
            .as_str(),
        "oTUltX4IQMOUUVeiohTt8A:12345"
    );
    assert!(parse_started_task(r#"{"deleted":0}"#).is_err());
    assert!(parse_started_task(r#"{"task":"not-a-task"}"#).is_err());
}

#[test]
fn task_ids_need_a_node_and_a_number() {
    assert!(EmailDeleteTaskId::try_from("node:1".to_owned()).is_ok());
    for bad in ["node", ":1", "node:", "node:x1"] {
        assert!(
            EmailDeleteTaskId::try_from(bad.to_owned()).is_err(),
            "{bad}"
        );
    }
}

#[test]
fn a_task_that_skipped_changed_documents_is_not_completed() {
    let task = parse_email_delete_task(
        r#"{"completed":true,"response":{"total":40,"deleted":39,"version_conflicts":1,"failures":[]}}"#,
    )
    .unwrap();

    assert_eq!(
        task.state,
        EmailDeleteState::Failed("1 documents changed while being deleted and were skipped".into())
    );
}

#[test]
fn the_running_delete_for_an_inbox_is_found_by_its_opaque_id() {
    let listing = r#"{"tasks":[
        {"node":"n1","id":7,"parent_task_id":null,"headers":{"X-Opaque-Id":"email-link-delete:other"}},
        {"node":"n1","id":8,"parent_task_id":"n1:9","headers":{"X-Opaque-Id":"email-link-delete:inbox"}},
        {"node":"n1","id":9,"parent_task_id":null,"headers":{"X-Opaque-Id":"email-link-delete:inbox"}}
    ]}"#;

    assert_eq!(
        parse_running_email_link_delete(listing, "inbox")
            .unwrap()
            .map(|id| id.as_str().to_owned()),
        Some("n1:9".to_owned()),
        "the parent, not its slice"
    );
    assert_eq!(
        parse_running_email_link_delete(listing, "missing").unwrap(),
        None
    );
    assert_eq!(
        parse_running_email_link_delete(r#"{"tasks":[]}"#, "inbox").unwrap(),
        None
    );
}

const RUNNING_FOR_INBOX: &str = r#"{"tasks":[{"node":"n1","id":9,"parent_task_id":null,"headers":{"X-Opaque-Id":"email-link-delete:inbox"}}]}"#;

#[tokio::test]
async fn an_inbox_with_a_running_delete_adopts_it_without_starting_another() {
    let (url, server) = serve_script(vec![Reply::Respond("200 OK", RUNNING_FOR_INBOX)]);
    let client = crate::OpensearchClient::new(url, "".into(), "".into()).unwrap();

    let task = client
        .start_email_link_delete("inbox", 1_000)
        .await
        .unwrap();

    assert_eq!(task.as_str(), "n1:9");
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 1, "{requests:?}");
    for part in [
        "GET /_tasks?",
        "actions=indices%3Adata%2Fwrite%2Fdelete%2Fbyquery",
        "detailed=true",
        "group_by=none",
        "timeout=10s",
    ] {
        assert!(requests[0].0.contains(part), "{part} in {}", requests[0].0);
    }
}

#[tokio::test]
async fn an_inbox_without_a_running_delete_starts_one_tagged_with_its_opaque_id() {
    let (url, server) = serve_script(vec![
        Reply::Respond("200 OK", r#"{"tasks":[]}"#),
        Reply::Respond("200 OK", r#"{"task":"n1:5"}"#),
    ]);
    let client = crate::OpensearchClient::new(url, "".into(), "".into()).unwrap();

    let task = client
        .start_email_link_delete("inbox", 1_000)
        .await
        .unwrap();

    assert_eq!(task.as_str(), "n1:5");
    let requests = server.join().unwrap();
    assert!(
        requests[1].0.starts_with("POST /emails/_delete_by_query?"),
        "{}",
        requests[1].0
    );
    assert!(
        requests[1]
            .0
            .ends_with(" x-opaque-id=email-link-delete:inbox"),
        "{}",
        requests[1].0
    );
}

#[tokio::test]
async fn a_start_lost_in_flight_is_adopted_from_a_second_listing() {
    let (url, server) = serve_script(vec![
        Reply::Respond("200 OK", r#"{"tasks":[]}"#),
        Reply::Close,
        Reply::Respond("200 OK", RUNNING_FOR_INBOX),
    ]);
    let client = crate::OpensearchClient::new(url, "".into(), "".into()).unwrap();

    let task = client
        .start_email_link_delete("inbox", 1_000)
        .await
        .unwrap();

    assert_eq!(task.as_str(), "n1:9");
    assert_eq!(server.join().unwrap().len(), 3);
}

#[test]
fn a_listing_some_node_failed_to_answer_is_an_error() {
    assert!(
        parse_running_email_link_delete(
            r#"{"node_failures":[{"type":"failed_node_exception"}],"tasks":[]}"#,
            "inbox"
        )
        .is_err()
    );
}
