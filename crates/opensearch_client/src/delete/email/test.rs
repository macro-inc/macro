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
