use serde_json::json;

use super::*;
use crate::error::TransportFailure;

fn args() -> ReconcileAgentSessionArgs {
    ReconcileAgentSessionArgs {
        agent_session_id: "session-1".to_owned(),
        name: "Investigate indexing".to_owned(),
        owner_id: "user-1".to_owned(),
        bot_id: "bot-1".to_owned(),
        thread_id: Some("thread-1".to_owned()),
        originating_message_id: None,
        created_at_millis: EpochMillis::new(10).unwrap(),
        updated_at_millis: EpochMillis::new(20).unwrap(),
        version: 1_000,
        messages: vec![AgentSessionMessageDocument {
            turn: 3,
            author: AgentSessionMessageAuthor::Agent,
            author_user_id: None,
            content: "Folded output".to_owned(),
        }],
    }
}

fn user_message(turn: u32, content: &str) -> AgentSessionMessageDocument {
    AgentSessionMessageDocument {
        turn,
        author: AgentSessionMessageAuthor::User,
        author_user_id: Some("user-1".to_owned()),
        content: content.to_owned(),
    }
}

/// The parent `_source` a reconcile of `args` leaves behind.
fn stored_parent_source(args: &ReconcileAgentSessionArgs) -> serde_json::Value {
    let record = plan(args, None, &[]).unwrap().record;
    serde_json::to_value(parent_document(args, &record, &[])).unwrap()
}

#[test]
fn the_parent_records_a_hash_of_each_child_it_holds() {
    let args = args();
    let record = plan(&args, None, &[]).unwrap().record;
    let hash = record["session-1:3:agent"].clone();
    assert_eq!(hash.len(), 16);

    assert_eq!(
        serde_json::to_value(parent_document(&args, &record, &[])).unwrap(),
        json!({
            "agent_session_id": "session-1",
            "name": "Investigate indexing",
            "owner_id": "user-1",
            "bot_id": "bot-1",
            "thread_id": "thread-1",
            "originating_message_id": null,
            "created_at_millis": 10,
            "updated_at_millis": 20,
            "agent_session_relation": "agent_session",
            "indexed_messages": { "session-1:3:agent": hash },
        })
    );
    assert_eq!(
        serde_json::to_value(child_document(&args, &args.messages[0])).unwrap(),
        json!({
            "agent_session_id": "session-1",
            "message_turn": 3,
            "author": "agent",
            "author_user_id": null,
            "content": "Folded output",
            "agent_session_relation": {
                "name": "message",
                "parent": "session-1",
            },
        })
    );
    assert_eq!(
        child_id("session-1", &args.messages[0]),
        "session-1:3:agent"
    );
}

#[test]
fn only_new_or_changed_messages_are_written_and_missing_ones_deleted() {
    let mut args = args();
    args.messages.push(user_message(4, "next prompt"));
    let indexed = plan(&args, None, &[]).unwrap().record;
    assert_eq!(plan(&args, None, &[]).unwrap().write.len(), 2);

    let unchanged = plan(&args, Some(&indexed), &[]).unwrap();
    assert!(unchanged.write.is_empty());
    assert!(unchanged.delete.is_empty());
    assert_eq!(unchanged.unchanged, 2);
    assert_eq!(unchanged.record, indexed);

    // Turn 4's prompt was replaced by a refold, and turn 5 is new.
    args.messages[1].content = "edited prompt".into();
    args.messages.push(user_message(5, "another prompt"));
    let mut previous = indexed.clone();
    previous.insert("session-1:6:agent".into(), "0123456789abcdef".into());
    let changed = plan(&args, Some(&previous), &[]).unwrap();
    let written: Vec<&str> = changed.write.iter().map(|(id, _)| id.as_str()).collect();
    assert_eq!(written, ["session-1:4:user", "session-1:5:user"]);
    assert_eq!(changed.delete, ["session-1:6:agent"]);
    assert_eq!(changed.unchanged, 1);
    assert_eq!(changed.record.len(), 3);
}

#[test]
fn pending_messages_are_rewritten_or_deleted_whatever_the_record_says() {
    let mut args = args();
    args.messages.push(user_message(4, "next prompt"));
    let indexed = plan(&args, None, &[]).unwrap().record;

    // A failed reconcile left turn 4's prompt and a turn 5 reply pending: the
    // record still vouches for the prompt, and the reply was never recorded.
    let pending = [
        "session-1:4:user".to_owned(),
        "session-1:5:agent".to_owned(),
    ];
    let recovered = plan(&args, Some(&indexed), &pending).unwrap();
    let written: Vec<&str> = recovered.write.iter().map(|(id, _)| id.as_str()).collect();
    assert_eq!(written, ["session-1:4:user"]);
    assert_eq!(recovered.delete, ["session-1:5:agent"]);
    assert_eq!(recovered.unchanged, 1);

    let (untouched, touched) = recovered.intent();
    assert_eq!(untouched.keys().collect::<Vec<_>>(), ["session-1:3:agent"]);
    assert_eq!(touched, ["session-1:4:user", "session-1:5:agent"]);
}

#[test]
fn index_override_selects_a_physical_backfill_index() {
    assert_eq!(resolve_destination(None), "agent_sessions");
    assert_eq!(
        resolve_destination(Some("agent_sessions_v2")),
        "agent_sessions_v2"
    );
}

/// One captured HTTP request: its request line and body.
#[derive(Debug)]
struct Captured {
    line: String,
    body: String,
}

/// Answer each request in turn with each status and body, capturing the
/// actual HTTP requests so their serialization is covered.
async fn serve<T, F, Fut>(responses: Vec<(&'static str, String)>, action: F) -> (Vec<Captured>, T)
where
    F: FnOnce(crate::OpensearchClient) -> Fut,
    Fut: std::future::Future<Output = T>,
{
    use std::io::{BufRead, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    use std::time::Duration;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let finished = Arc::new(AtomicBool::new(false));
    let server_finished = Arc::clone(&finished);
    let server = std::thread::spawn(move || {
        let mut requests = Vec::new();
        for (status, body) in responses {
            let (mut stream, _) = listener.accept().unwrap();
            // The client stopped before using every response.
            if server_finished.load(Ordering::SeqCst) {
                break;
            }
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut reader = std::io::BufReader::new(&mut stream);
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let mut content_length = 0;
            loop {
                let mut header = String::new();
                reader.read_line(&mut header).unwrap();
                if header == "\r\n" {
                    break;
                }
                if let Some(value) = header.to_ascii_lowercase().strip_prefix("content-length:") {
                    content_length = value.trim().parse::<usize>().unwrap();
                }
            }
            let mut request_body = vec![0; content_length];
            reader.read_exact(&mut request_body).unwrap();
            requests.push(Captured {
                line,
                body: String::from_utf8(request_body).unwrap(),
            });
            write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        }
        requests
    });
    let client =
        crate::OpensearchClient::new(format!("http://{address}"), "".into(), "".into()).unwrap();
    let result = action(client).await;
    finished.store(true, Ordering::SeqCst);
    // Wakes a server still waiting for a request the client never sent.
    let _ = TcpStream::connect(address);
    (server.join().unwrap(), result)
}

async fn serve_reconcile(
    responses: Vec<(&'static str, String)>,
    args: ReconcileAgentSessionArgs,
    index_override: Option<&'static str>,
) -> (Vec<Captured>, Result<AgentSessionReconcileWrites>) {
    serve(responses, |client| async move {
        client.reconcile_agent_session(&args, index_override).await
    })
    .await
}

fn ok(body: &str) -> (&'static str, String) {
    ("200 OK", body.to_owned())
}

fn not_found() -> (&'static str, String) {
    ("404 Not Found", r#"{"found":false}"#.to_owned())
}

fn found(source: serde_json::Value) -> (&'static str, String) {
    ok(&json!({ "found": true, "_source": source }).to_string())
}

const BULK_OK: &str = r#"{"errors":false}"#;
const SWEEP_EMPTY: &str = r#"{"hits":{"hits":[]}}"#;

#[tokio::test]
async fn a_session_without_a_record_writes_every_child_then_records_them() {
    let (requests, result) = serve_reconcile(
        vec![
            not_found(),
            ok("{}"),
            ok(BULK_OK),
            ok("{}"),
            ok(SWEEP_EMPTY),
        ],
        args(),
        None,
    )
    .await;

    assert_eq!(
        result.unwrap(),
        AgentSessionReconcileWrites {
            parent_written: true,
            messages_written: 1,
            messages_unchanged: 0,
            messages_deleted: 0,
        }
    );
    // The parent names the children it is about to write before writing them.
    let intent: serde_json::Value = serde_json::from_str(&requests[1].body).unwrap();
    assert_eq!(intent["indexed_messages"], json!({}));
    assert_eq!(intent["pending_messages"], json!(["session-1:3:agent"]));
    let requests = [&requests[0], &requests[2], &requests[3], &requests[4]];
    assert!(
        requests[0]
            .line
            .starts_with("GET /agent_sessions/_doc/session-1?"),
        "{requests:?}"
    );
    assert!(requests[1].line.starts_with("POST /agent_sessions/_bulk?"));
    assert!(requests[1].body.contains(r#""_id":"session-1:3:agent""#));
    assert!(
        requests[2]
            .line
            .starts_with("POST /agent_sessions/_doc/session-1?")
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&requests[2].body).unwrap(),
        stored_parent_source(&args())
    );
    assert!(
        requests[3]
            .line
            .starts_with("POST /agent_sessions/_search?")
    );
    for request in [requests[1], requests[2]] {
        assert!(request.line.contains("require_alias=true"), "{request:?}");
    }
    // Every write is fenced by the reconcile's version.
    assert!(
        requests[2].line.contains("version=1000")
            && requests[2].line.contains("version_type=external_gte"),
        "{requests:?}"
    );
    let bulk_action: serde_json::Value =
        serde_json::from_str(requests[1].body.lines().next().unwrap()).unwrap();
    assert_eq!(bulk_action["index"]["version"], 1000);
    assert_eq!(bulk_action["index"]["version_type"], "external_gte");
    for request in requests {
        assert!(!request.line.contains("refresh"), "{request:?}");
    }
}

#[tokio::test]
async fn explicit_backfill_overrides_allow_a_physical_index() {
    let (requests, result) = serve_reconcile(
        vec![
            not_found(),
            ok("{}"),
            ok(BULK_OK),
            ok("{}"),
            ok(SWEEP_EMPTY),
        ],
        args(),
        Some("scratch-index"),
    )
    .await;
    result.unwrap();
    let requests = [&requests[0], &requests[2], &requests[3], &requests[4]];
    assert!(
        requests[0]
            .line
            .starts_with("GET /scratch-index/_doc/session-1?"),
        "{requests:?}"
    );
    assert!(requests[1].line.starts_with("POST /scratch-index/_bulk?"));
    assert!(
        requests[2]
            .line
            .starts_with("POST /scratch-index/_doc/session-1?")
    );
    for request in [requests[1], requests[2]] {
        assert!(request.line.contains("require_alias=false"), "{request:?}");
    }
}

#[tokio::test]
async fn an_unchanged_session_writes_nothing() {
    let (requests, result) = serve_reconcile(
        vec![found(stored_parent_source(&args())), ok(SWEEP_EMPTY)],
        args(),
        None,
    )
    .await;

    assert_eq!(
        result.unwrap(),
        AgentSessionReconcileWrites {
            parent_written: false,
            messages_written: 0,
            messages_unchanged: 1,
            messages_deleted: 0,
        }
    );
    assert_eq!(requests.len(), 2, "{requests:?}");
    assert!(requests[1].line.contains("_search"));
}

#[tokio::test]
async fn a_changed_message_is_rewritten_and_a_removed_one_deleted_by_id() {
    let mut stored = stored_parent_source(&args());
    stored["indexed_messages"] = json!({
        "session-1:3:agent": "0000000000000000",
        "session-1:2:user": "1111111111111111",
    });

    let (requests, result) = serve_reconcile(
        vec![
            found(stored),
            ok("{}"),
            ok(BULK_OK),
            ok("{}"),
            ok(SWEEP_EMPTY),
        ],
        args(),
        None,
    )
    .await;
    let requests = [&requests[0], &requests[2], &requests[3], &requests[4]];

    assert_eq!(
        result.unwrap(),
        AgentSessionReconcileWrites {
            parent_written: true,
            messages_written: 1,
            messages_unchanged: 0,
            messages_deleted: 1,
        }
    );
    let bulk: Vec<serde_json::Value> = requests[1]
        .body
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(
        bulk[0],
        json!({"index": {"_id": "session-1:3:agent", "routing": "session-1", "version": 1000, "version_type": "external_gte"}})
    );
    assert_eq!(
        bulk[2],
        json!({"delete": {"_id": "session-1:2:user", "routing": "session-1", "version": 1000, "version_type": "external_gte"}})
    );
    let parent: serde_json::Value = serde_json::from_str(&requests[2].body).unwrap();
    assert_eq!(parent, stored_parent_source(&args()));
    // The sweep's search may still see the child just deleted, so it skips it.
    let prune: serde_json::Value = serde_json::from_str(&requests[3].body).unwrap();
    let kept = &prune["query"]["bool"]["must_not"][0]["ids"]["values"];
    assert!(
        kept.as_array()
            .unwrap()
            .contains(&json!("session-1:2:user")),
        "{prune}"
    );
}

#[tokio::test]
async fn an_unrecorded_child_is_swept_by_id_under_the_version() {
    let (requests, result) = serve_reconcile(
        vec![
            found(stored_parent_source(&args())),
            ok(r#"{"hits":{"hits":[{"_id":"session-1:9:agent"}]}}"#),
            ok(BULK_OK),
        ],
        args(),
        None,
    )
    .await;

    assert_eq!(result.unwrap().messages_deleted, 1);
    assert_eq!(
        requests[2].body.trim(),
        r#"{"delete":{"_id":"session-1:9:agent","routing":"session-1","version":1000,"version_type":"external_gte"}}"#
    );
}

#[tokio::test]
async fn a_sweep_delete_refused_for_a_newer_child_fails_the_reconcile() {
    let (_, result) = serve_reconcile(
        vec![
            found(stored_parent_source(&args())),
            ok(r#"{"hits":{"hits":[{"_id":"session-1:9:agent"}]}}"#),
            ok(r#"{"errors":true,"items":[{"delete":{"_id":"session-1:9:agent","status":409}}]}"#),
        ],
        args(),
        None,
    )
    .await;

    let Err(OpensearchClientError::Unknown { operation, .. }) = result else {
        panic!("a refused sweep delete must fail the reconcile, got {result:?}");
    };
    assert_eq!(operation, OpensearchOperation::ReconcileAgentSessionPrune);
}

#[tokio::test]
async fn deleting_a_session_sweeps_leftovers_under_its_version_before_the_parent() {
    let (requests, result) = serve(
        vec![
            found(stored_parent_source(&args())),
            ok(BULK_OK),
            ok(r#"{"hits":{"hits":[{"_id":"session-1:1:user"}]}}"#),
            ok(BULK_OK),
            ok(BULK_OK),
        ],
        |client| async move { client.delete_agent_session("session-1", None, 1_000).await },
    )
    .await;

    result.unwrap();
    assert!(
        requests[2]
            .line
            .starts_with("POST /agent_sessions/_search?")
    );
    assert!(
        requests[2].line.contains("routing=session-1"),
        "{requests:?}"
    );
    assert_eq!(
        requests[3].body.trim(),
        r#"{"delete":{"_id":"session-1:1:user","routing":"session-1","version":1000,"version_type":"external_gte"}}"#
    );
    assert!(requests[4].body.contains(r#""_id":"session-1""#));
}

#[tokio::test]
async fn deleting_a_session_without_its_index_sends_no_delete() {
    let (requests, result) = serve(
        vec![(
            "404 Not Found",
            r#"{"error":{"type":"index_not_found_exception"},"status":404}"#.to_owned(),
        )],
        |client| async move { client.delete_agent_session("session-1", None, 1_000).await },
    )
    .await;

    assert!(result.is_err());
    assert_eq!(requests.len(), 1, "{requests:?}");
}

#[tokio::test]
async fn a_missing_alias_stops_a_reconcile_before_any_write() {
    let (requests, result) = serve_reconcile(
        vec![(
            "404 Not Found",
            r#"{"error":{"type":"index_not_found_exception"},"status":404}"#.to_owned(),
        )],
        args(),
        None,
    )
    .await;

    let Err(OpensearchClientError::Unknown { operation, .. }) = result else {
        panic!("expected the missing index to be reported, got {result:?}");
    };
    assert_eq!(operation, OpensearchOperation::ReadAgentSessionParent);
    assert_eq!(requests.len(), 1, "{requests:?}");
}

#[tokio::test]
async fn deleting_a_session_removes_recorded_children_by_id_first() {
    let mut stored = stored_parent_source(&args());
    stored["indexed_messages"] = json!({
        "session-1:3:agent": "0000000000000000",
        "session-1:4:user": "1111111111111111",
    });
    stored["pending_messages"] = json!(["session-1:5:agent"]);

    let (requests, result) = serve(
        vec![found(stored), ok(BULK_OK), ok(SWEEP_EMPTY), ok(BULK_OK)],
        |client| async move { client.delete_agent_session("session-1", None, 1_000).await },
    )
    .await;

    result.unwrap();
    let deleted_ids = |body: &str| -> Vec<String> {
        body.lines()
            .map(|line| {
                let action: serde_json::Value = serde_json::from_str(line).unwrap();
                assert_eq!(action["delete"]["version"], 1000, "{action}");
                assert_eq!(action["delete"]["version_type"], "external_gte", "{action}");
                action["delete"]["_id"].as_str().unwrap().to_owned()
            })
            .collect()
    };
    assert_eq!(
        deleted_ids(&requests[1].body),
        ["session-1:3:agent", "session-1:4:user", "session-1:5:agent"]
    );
    let sweep: serde_json::Value = serde_json::from_str(&requests[2].body).unwrap();
    assert_eq!(
        sweep["query"]["bool"]["must_not"][0]["ids"]["values"],
        json!([
            "session-1:3:agent",
            "session-1:4:user",
            "session-1:5:agent",
            "session-1"
        ])
    );
    assert!(
        requests[2]
            .line
            .starts_with("POST /agent_sessions/_search?")
    );
    // The parent and its record go last.
    assert_eq!(deleted_ids(&requests[3].body), ["session-1"]);
    for request in &requests {
        assert!(!request.line.contains("refresh"), "{request:?}");
    }
}

#[tokio::test]
async fn a_failed_child_delete_keeps_the_parent_for_the_retry() {
    let mut stored = stored_parent_source(&args());
    stored["indexed_messages"] = json!({ "session-1:3:agent": "0000000000000000" });

    let (requests, result) = serve(
        vec![
            found(stored),
            ok(r#"{"errors":true,"items":[{"delete":{"status":503}}]}"#),
        ],
        |client| async move { client.delete_agent_session("session-1", None, 1_000).await },
    )
    .await;

    assert!(result.is_err());
    assert_eq!(requests.len(), 2, "the parent is not deleted: {requests:?}");
}

#[tokio::test]
async fn a_failed_bulk_leaves_its_children_pending() {
    let (requests, result) = serve_reconcile(
        vec![
            not_found(),
            ok("{}"),
            ok(r#"{"errors":true,"items":[{"index":{"status":429}}]}"#),
        ],
        args(),
        None,
    )
    .await;

    let Err(OpensearchClientError::Unknown { operation, .. }) = result else {
        panic!("expected the failed item to be reported, got {result:?}");
    };
    assert_eq!(operation, OpensearchOperation::ReconcileAgentSessionBulk);
    assert_eq!(
        requests.len(),
        3,
        "the parent is not recorded: {requests:?}"
    );
    let intent: serde_json::Value = serde_json::from_str(&requests[1].body).unwrap();
    assert_eq!(intent["pending_messages"], json!(["session-1:3:agent"]));
}

#[tokio::test]
async fn a_recorded_child_left_pending_is_rewritten_though_its_hash_matches() {
    // A reconcile wrote this child with other content, then failed before
    // recording it; the record still holds the hash of what the snapshot has.
    let mut stored = stored_parent_source(&args());
    stored["pending_messages"] = json!(["session-1:3:agent"]);

    let (requests, result) = serve_reconcile(
        vec![
            found(stored),
            ok("{}"),
            ok(BULK_OK),
            ok("{}"),
            ok(SWEEP_EMPTY),
        ],
        args(),
        None,
    )
    .await;

    assert_eq!(result.unwrap().messages_written, 1);
    assert!(requests[2].body.contains(r#""_id":"session-1:3:agent""#));
    let recorded: serde_json::Value = serde_json::from_str(&requests[3].body).unwrap();
    assert_eq!(recorded, stored_parent_source(&args()));
}

#[tokio::test]
async fn a_pending_child_the_snapshot_no_longer_has_is_deleted_by_id() {
    // A reconcile wrote turn 5's reply, then failed before recording it; the
    // snapshot has since lost that turn.
    let mut stored = stored_parent_source(&args());
    stored["pending_messages"] = json!(["session-1:5:agent"]);

    let (requests, result) = serve_reconcile(
        vec![
            found(stored),
            ok("{}"),
            ok(BULK_OK),
            ok("{}"),
            ok(SWEEP_EMPTY),
        ],
        args(),
        None,
    )
    .await;

    assert_eq!(result.unwrap().messages_deleted, 1);
    assert_eq!(
        requests[2].body.trim(),
        r#"{"delete":{"_id":"session-1:5:agent","routing":"session-1","version":1000,"version_type":"external_gte"}}"#
    );
    let recorded: serde_json::Value = serde_json::from_str(&requests[3].body).unwrap();
    assert_eq!(recorded, stored_parent_source(&args()));
    let sweep: serde_json::Value = serde_json::from_str(&requests[4].body).unwrap();
    assert!(
        sweep["query"]["bool"]["must_not"][0]["ids"]["values"]
            .as_array()
            .unwrap()
            .contains(&json!("session-1:5:agent")),
        "{sweep}"
    );
}

#[tokio::test]
async fn a_load_balancer_error_page_on_prune_is_reported_with_its_body() {
    let (_, result) = serve_reconcile(
        vec![
            not_found(),
            ok("{}"),
            ok(BULK_OK),
            ok("{}"),
            (
                "502 Bad Gateway",
                "<html><head><title>502 Bad Gateway</title></head></html>".to_owned(),
            ),
        ],
        args(),
        None,
    )
    .await;

    let Err(OpensearchClientError::Unknown { details, operation }) = result else {
        panic!("expected the 502 page to be reported, got {result:?}");
    };
    assert_eq!(operation, OpensearchOperation::ReconcileAgentSessionPrune);
    assert!(details.contains("502 Bad Gateway"), "{details}");
}

#[tokio::test]
async fn a_connection_closed_without_a_response_reports_the_transport_cause() {
    use std::io::{BufRead, Read};
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    // One connection per attempt, since a lost connection is resent twice.
    let server = std::thread::spawn(move || {
        for _ in 0..3 {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = std::io::BufReader::new(&mut stream);
            let mut content_length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    content_length = value.trim().parse::<usize>().unwrap();
                }
            }
            reader.read_exact(&mut vec![0; content_length]).unwrap();
            // Dropping the stream closes the connection before any response.
        }
    });
    let client =
        crate::OpensearchClient::new(format!("http://{address}"), "".into(), "".into()).unwrap();
    let result = client.reconcile_agent_session(&args(), None).await;
    server.join().unwrap();

    let Err(OpensearchClientError::RequestFailed {
        details,
        cause,
        operation,
    }) = result
    else {
        panic!("expected a request failure, got {result:?}");
    };
    assert_eq!(operation, OpensearchOperation::ReadAgentSessionParent);
    assert_eq!(cause, TransportFailure::ConnectionClosed);
    assert!(
        details.contains("connection closed before message completed"),
        "{details}"
    );
    assert_eq!(
        details.matches("error sending request").count(),
        1,
        "{details}"
    );
}

/// Uses only a uniquely named scratch index; never changes application indices.
#[tokio::test]
#[ignore = "requires local OpenSearch at http://localhost:9200"]
async fn empty_index_accepts_both_authors_and_converges_on_each_snapshot() {
    use crate::OpensearchClient;
    use opensearch::{
        IndexParts, SearchParts, indices::IndicesDeleteParts, indices::IndicesRefreshParts,
    };

    let client =
        OpensearchClient::new("http://localhost:9200".into(), "".into(), "".into()).unwrap();
    let index = format!("agent-session-indexing-test-{}", uuid::Uuid::new_v4());
    client.ensure_index_exists(&index, json!({
        "settings": {"number_of_shards": 1, "number_of_replicas": 0, "refresh_interval": "-1"},
        "mappings": {"dynamic": "false", "properties": {
            "agent_session_id": {"type": "keyword"},
            "projection_generation": {"type": "keyword"},
            "content": {"type": "text"},
            "agent_session_relation": {"type": "join", "relations": {"agent_session": "message"}}
        }}
    })).await.unwrap();

    let result: anyhow::Result<()> = async {
        let refresh = || async {
            client.inner.indices().refresh(IndicesRefreshParts::Index(&[&index])).send().await?.error_for_status_code()?;
            anyhow::Ok(())
        };
        let contents = || async {
            let hits: serde_json::Value = client.inner.search(SearchParts::Index(&[&index]))
                .body(json!({"query": {"exists": {"field": "content"}}}))
                .send().await?.error_for_status_code()?.json().await?;
            let mut contents: Vec<String> = hits["hits"]["hits"].as_array().unwrap().iter()
                .map(|hit| hit["_source"]["content"].as_str().unwrap().to_owned())
                .collect();
            contents.sort();
            anyhow::Ok(contents)
        };

        // A child from a projection written before parents kept records.
        client.inner.index(IndexParts::IndexId(&index, "session-1:9:agent")).routing("session-1")
            .body(json!({"agent_session_id": "session-1", "projection_generation": "old", "content": "stalechild",
                "agent_session_relation": {"name": "message", "parent": "session-1"}}))
            .send().await?.error_for_status_code()?;
        refresh().await?;

        let mut projection = args();
        projection.messages[0].content = "quartzresponse".into();
        projection.messages.push(user_message(3, "cobaltquestion"));
        let writes = client.reconcile_agent_session(&projection, Some(&index)).await?;
        assert_eq!(writes.messages_written, 2);
        refresh().await?;
        // Both terms must join back to the same parent, across different authors.
        let hits: serde_json::Value = client.inner.search(SearchParts::Index(&[&index]))
            .body(json!({"query": {"bool": {"must": [
                {"has_child": {"type": "message", "query": {"match": {"content": "quartzresponse"}}}},
                {"has_child": {"type": "message", "query": {"match": {"content": "cobaltquestion"}}}}
            ]}}})).send().await?.error_for_status_code()?.json().await?;
        assert_eq!(hits["hits"]["total"]["value"], 1);
        assert_eq!(contents().await?, ["cobaltquestion", "quartzresponse"], "the old child is pruned");

        // The same snapshot again writes nothing, even before a refresh.
        let writes = client.reconcile_agent_session(&projection, Some(&index)).await?;
        assert_eq!(writes, AgentSessionReconcileWrites { parent_written: false, messages_written: 0, messages_unchanged: 2, messages_deleted: 0 });

        // History replacement removes the old user child and replaces agent text.
        projection.messages.truncate(1);
        projection.messages[0].content = "newhistory".into();
        let writes = client.reconcile_agent_session(&projection, Some(&index)).await?;
        assert_eq!(writes, AgentSessionReconcileWrites { parent_written: true, messages_written: 1, messages_unchanged: 0, messages_deleted: 1 });
        // The next event's sweep still sees the child deleted by id, unrefreshed.
        client.reconcile_agent_session(&projection, Some(&index)).await?;
        refresh().await?;
        assert_eq!(contents().await?, ["newhistory"]);

        // A delayed request from an earlier reconcile applies after a later
        // one: the index refuses it, so the newer child and parent stay.
        let mut earlier = projection.clone();
        earlier.version = projection.version - 1;
        earlier.messages[0].content = "stalehistory".into();
        let delayed = plan(&earlier, None, &[])?;
        let refused = write_children(&client.inner, &index, "session-1", &delayed, false, earlier.version).await;
        assert!(refused.is_err(), "an older child write must not apply");
        let refused = write_parent(&client.inner, &index, &earlier, to_parent_value(parent_document(&earlier, &delayed.record, &[]))?, false).await;
        assert!(refused.is_err(), "an older parent write must not apply");
        let operation = OpensearchOperation::ReconcileAgentSessionPrune;
        let children: Vec<String> = delayed.record.keys().cloned().collect();
        let refused = delete_by_id(&client.inner, &index, "session-1", &children, external_version(earlier.version, operation)?, operation).await;
        assert!(refused.is_err(), "an older sweep delete must not apply");
        refresh().await?;
        assert_eq!(contents().await?, ["newhistory"]);
        let writes = client.reconcile_agent_session(&projection, Some(&index)).await?;
        assert_eq!(writes.messages_written, 0, "the record still matches what the index holds");

        // A child written just before the session is deleted goes too, unrefreshed.
        projection.messages.push(user_message(4, "lastprompt"));
        client.reconcile_agent_session(&projection, Some(&index)).await?;
        client.delete_agent_session(&projection.agent_session_id, Some(&index), projection.version).await?;
        refresh().await?;
        let hits: serde_json::Value = client.inner.search(SearchParts::Index(&[&index]))
            .body(json!({"query": {"match_all": {}}})).send().await?.error_for_status_code()?.json().await?;
        assert_eq!(hits["hits"]["total"]["value"], 0);
        Ok(())
    }.await;
    client
        .inner
        .indices()
        .delete(IndicesDeleteParts::Index(&[&index]))
        .send()
        .await
        .unwrap()
        .error_for_status_code()
        .unwrap();
    result.unwrap();
}
