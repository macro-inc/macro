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
