use super::*;
use entity_access::domain::models::{AccessLevel, Entity, EntityPermission};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;

fn access() -> EntityAccessReceipt<MessageWrite> {
    EntityAccessReceipt::try_new_authenticated_user(
        MacroUserIdStr::try_from_email("assigner@example.com").unwrap(),
        Entity {
            entity_type: EntityType::Document,
            entity_id: "task-1".to_owned(),
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}

fn task() -> Value {
    json!({
        "documentId": "task-1",
        "documentName": "Fix the flaky test",
        "owner": "macro|assigner@example.com",
        "fileType": "md",
        "subType": "task",
        "deletedAt": null,
    })
}

fn server(
    responses: Vec<(&'static str, u16, Value)>,
) -> (DssTaskAssignmentContext, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let handle = std::thread::spawn(move || {
        for (path, status, body) in responses {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            assert_eq!(line.trim_end(), format!("GET {path} HTTP/1.1"));
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
            }
            let body = body.to_string();
            write!(stream, "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        }
    });
    let url = format!("http://{address}");
    (
        DssTaskAssignmentContext::new(
            DocumentStorageServiceClient::new("test-key".to_owned(), url.clone()),
            LexicalClient::new("test-key".to_owned(), url),
        ),
        handle,
    )
}

#[tokio::test]
async fn a_task_brief_contains_the_title_and_current_markdown() {
    let (context, server) = server(vec![
        ("/internal/documents/task-1/basic", 200, task()),
        (
            "/markdown/task-1?target=external",
            200,
            json!({"data": "Reproduce the race, then add a regression test."}),
        ),
    ]);
    let brief = context.task_brief(access()).await.unwrap().unwrap();
    assert_eq!(brief.title, "Fix the flaky test");
    assert_eq!(
        brief.markdown,
        "Reproduce the race, then add a regression test."
    );
    server.join().unwrap();
}

#[tokio::test]
async fn missing_deleted_and_non_task_documents_do_not_load_content() {
    let mut deleted = task();
    deleted["deletedAt"] = json!("2026-09-24T12:00:00Z");
    let mut ordinary = task();
    ordinary["subType"] = Value::Null;
    for (status, metadata) in [(404, json!({})), (200, deleted), (200, ordinary)] {
        let (context, server) =
            server(vec![("/internal/documents/task-1/basic", status, metadata)]);
        assert!(context.task_brief(access()).await.unwrap().is_none());
        server.join().unwrap();
    }
}

#[tokio::test]
async fn a_response_for_a_different_document_cannot_supply_the_brief() {
    let mut metadata = task();
    metadata["documentId"] = json!("other-task");
    let (context, server) = server(vec![("/internal/documents/task-1/basic", 200, metadata)]);
    assert!(matches!(
        context.task_brief(access()).await,
        Err(AgentSessionError::Forbidden)
    ));
    server.join().unwrap();
}

#[tokio::test]
async fn unavailable_live_content_is_retried_instead_of_starting_without_a_description() {
    let (context, server) = server(vec![
        ("/internal/documents/task-1/basic", 200, task()),
        (
            "/markdown/task-1?target=external",
            503,
            json!({"error": "temporarily unavailable"}),
        ),
    ]);
    assert!(context.task_brief(access()).await.is_err());
    server.join().unwrap();
}
