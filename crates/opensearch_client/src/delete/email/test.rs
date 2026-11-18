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

#[tokio::test]
async fn a_delete_without_conflicts_runs_once() {
    let (left, pass) = scripted(vec![DeletedByQuery {
        deleted: 3,
        version_conflicts: 0,
    }]);
    assert_eq!(delete_with_recheck(pass).await.unwrap(), 3);
    assert!(left.lock().unwrap().is_empty());
}

#[tokio::test]
async fn documents_skipped_on_conflict_are_deleted_on_a_second_pass() {
    let (left, pass) = scripted(vec![
        DeletedByQuery {
            deleted: 1,
            version_conflicts: 1,
        },
        DeletedByQuery {
            deleted: 1,
            version_conflicts: 0,
        },
    ]);
    assert_eq!(delete_with_recheck(pass).await.unwrap(), 2);
    assert!(left.lock().unwrap().is_empty());
}

#[tokio::test]
async fn documents_that_keep_conflicting_fail_the_delete_for_the_caller_to_retry() {
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
    assert!(delete_with_recheck(pass).await.is_err());
}
