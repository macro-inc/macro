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
            OpensearchOperation::DeleteEmailByUserId
        )
        .unwrap(),
        DeletedByQuery {
            deleted: 2,
            version_conflicts: 1
        }
    );
    assert_eq!(
        parse_deleted_by_query(r#"{"took":3}"#, OpensearchOperation::DeleteEmailByUserId).unwrap(),
        DeletedByQuery::default()
    );
    assert!(
        parse_deleted_by_query(
            r#"{"deleted":0,"failures":[{"cause":{"type":"es_rejected_execution_exception"}}]}"#,
            OpensearchOperation::DeleteEmailByUserId,
        )
        .is_err()
    );
}

#[test]
fn a_copy_search_finds_a_message_s_documents_outside_the_kept_threads() {
    let after = serde_json::json!(["message-1", "thread-1"]);
    assert_eq!(
        message_documents_query(
            &["message-1".to_owned()],
            &["thread-2".to_owned()],
            Some(&after)
        ),
        serde_json::json!({
            "size": MESSAGE_DOCUMENTS_PER_PAGE,
            "_source": ["entity_id", "message_id"],
            "sort": [{ "message_id": "asc" }, { "entity_id": "asc" }],
            "search_after": ["message-1", "thread-1"],
            "query": {
                "bool": {
                    "filter": [{ "terms": { "message_id": ["message-1"] } }],
                    "must_not": [{ "terms": { "entity_id": ["thread-2"] } }]
                }
            }
        })
    );
}

fn hit(thread_id: &str, message_id: &str) -> String {
    format!(
        r#"{{"_id":"{thread_id}:{message_id}","_source":{{"entity_id":"{thread_id}","message_id":"{message_id}"}},"sort":["{message_id}","{thread_id}"]}}"#
    )
}

fn page(hits: &[String]) -> &'static str {
    let body = format!(
        r#"{{"took":1,"timed_out":false,"_shards":{{"total":3,"successful":3,"failed":0}},"hits":{{"hits":[{}]}}}}"#,
        hits.join(",")
    );
    Box::leak(body.into_boxed_str())
}

#[tokio::test]
async fn a_copy_search_returns_each_document_s_thread_and_message() {
    let (url, server) = serve_script(vec![Reply::Respond(
        "200 OK",
        page(&[hit("thread-1", "message-1"), hit("old-thread", "message-1")]),
    )]);
    let client = crate::OpensearchClient::new(url, "".into(), "".into()).unwrap();

    let found = client
        .email_message_documents(&["message-1".to_owned()], &[], None)
        .await
        .unwrap();

    let requests = server.join().unwrap();
    assert!(
        requests[0]
            .0
            .starts_with("POST /emails/_search?allow_partial_search_results=false "),
        "{}",
        requests[0].0
    );
    assert_eq!(
        found,
        [
            EmailDocumentKey {
                thread_id: "thread-1".to_owned(),
                message_id: "message-1".to_owned(),
            },
            EmailDocumentKey {
                thread_id: "old-thread".to_owned(),
                message_id: "message-1".to_owned(),
            },
        ]
    );
}

/// A search with more matches than a page goes on from the last hit until a
/// page comes back short, so no copy is left behind.
#[tokio::test]
async fn a_copy_search_pages_through_every_match() {
    let first: Vec<String> = (0..MESSAGE_DOCUMENTS_PER_PAGE)
        .map(|n| hit(&format!("thread-{n:04}"), "message-1"))
        .collect();
    let (url, server) = serve_script(vec![
        Reply::Respond("200 OK", page(&first)),
        Reply::Respond("200 OK", page(&[hit("thread-9999", "message-1")])),
    ]);
    let client = crate::OpensearchClient::new(url, "".into(), "".into()).unwrap();

    let found = client
        .email_message_documents(&["message-1".to_owned()], &[], None)
        .await
        .unwrap();

    let requests = server.join().unwrap();
    assert_eq!(found.len(), MESSAGE_DOCUMENTS_PER_PAGE + 1);
    let second: serde_json::Value = serde_json::from_str(&requests[1].1).unwrap();
    assert_eq!(
        second["search_after"],
        serde_json::json!(["message-1", "thread-0999"])
    );
}

#[test]
fn a_copy_search_with_a_failed_shard_or_a_timeout_fails() {
    for body in [
        r#"{"timed_out":false,"_shards":{"total":3,"successful":2,"failed":1},"hits":{"hits":[]}}"#,
        r#"{"timed_out":true,"_shards":{"total":3,"successful":3,"failed":0},"hits":{"hits":[]}}"#,
    ] {
        assert!(parse_message_documents(body).is_err(), "{body}");
    }
}

#[tokio::test]
async fn a_copy_search_for_no_message_sends_nothing() {
    let client =
        crate::OpensearchClient::new("http://127.0.0.1:9".into(), "".into(), "".into()).unwrap();

    let found = client
        .email_message_documents(&[], &[], None)
        .await
        .unwrap();

    assert!(found.is_empty());
}

fn args(thread_id: &str, message_id: &str) -> crate::upsert::email::UpsertEmailArgs {
    crate::upsert::email::UpsertEmailArgs {
        thread_id: thread_id.to_owned(),
        message_id: message_id.to_owned(),
        sender: String::new(),
        sender_name: None,
        reply_to: None,
        recipients: vec![],
        recipient_names: vec![],
        cc: vec![],
        cc_names: vec![],
        bcc: vec![],
        bcc_names: vec![],
        labels: vec![],
        link_id: "link-1".to_owned(),
        user_id: "user-1".to_owned(),
        updated_at_millis: crate::date_format::EpochMillis::new(20).unwrap(),
        subject: None,
        sent_at_millis: None,
        content: "Body".to_owned(),
        properties: vec![],
    }
}

/// The race the fence closes, on a real index: a reindex reads a thread while
/// it still holds a message, the message is deleted with a later version,
/// then the reindex writes what it read. The index refuses the stale write,
/// while it remembers the delete's version (`gc_deletes`), and a later
/// writer's write still applies.
#[tokio::test]
#[ignore = "requires local OpenSearch at http://localhost:9200"]
async fn a_stale_reindex_cannot_bring_back_a_deleted_message() {
    let client =
        crate::OpensearchClient::new("http://localhost:9200".into(), "".into(), "".into()).unwrap();
    let index = format!("email-fence-test-{}", uuid::Uuid::now_v7());
    client
        .ensure_index_exists(
            &index,
            serde_json::json!({
                "settings": {"number_of_shards": 2, "number_of_replicas": 0, "gc_deletes": "15m"},
                "mappings": {"dynamic": false, "properties": {
                    "entity_id": {"type": "keyword"},
                    "message_id": {"type": "keyword"}
                }}
            }),
        )
        .await
        .unwrap();

    let result: anyhow::Result<()> = async {
        let first = client
            .write_email_documents(100, &[args("thread-1", "message-1")], &[], Some(&index))
            .await?;
        anyhow::ensure!(first.indexed == 1, "the first write was not applied");

        let removed = EmailDocumentKey {
            thread_id: "thread-1".to_owned(),
            message_id: "message-1".to_owned(),
        };
        let delete = client
            .write_email_documents(300, &[], std::slice::from_ref(&removed), Some(&index))
            .await?;
        anyhow::ensure!(delete.deleted == 1, "the delete was not applied");

        let stale = client
            .write_email_documents(200, &[args("thread-1", "message-1")], &[], Some(&index))
            .await?;
        anyhow::ensure!(
            stale
                == crate::upsert::email::EmailWrites {
                    indexed: 0,
                    deleted: 0,
                    refused_stale: 1,
                },
            "the stale write was not refused: {stale:?}"
        );
        client
            .inner
            .indices()
            .refresh(opensearch::indices::IndicesRefreshParts::Index(&[&index]))
            .send()
            .await?
            .error_for_status_code()?;
        anyhow::ensure!(
            client
                .email_message_documents(&["message-1".to_owned()], &[], Some(&index))
                .await?
                .is_empty(),
            "the deleted message came back"
        );

        let later = client
            .write_email_documents(400, &[args("thread-1", "message-1")], &[], Some(&index))
            .await?;
        anyhow::ensure!(later.indexed == 1, "a later writer must still apply");
        Ok(())
    }
    .await;
    client
        .inner
        .indices()
        .delete(opensearch::indices::IndicesDeleteParts::Index(&[&index]))
        .send()
        .await
        .ok();
    result.unwrap();
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
