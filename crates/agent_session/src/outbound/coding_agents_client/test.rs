use super::*;
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    task::JoinHandle,
};
use uuid::Uuid;

const KEY: &str = "test-internal-key";
const USER: &str = "macro|coding-owner@example.com";

struct Reply {
    status: u16,
    body: String,
    headers: String,
    delay: Duration,
}

impl Reply {
    fn json(status: u16, body: Value) -> Self {
        Self {
            status,
            body: body.to_string(),
            headers: String::new(),
            delay: Duration::ZERO,
        }
    }
}

#[derive(Debug)]
struct Request {
    head: String,
    body: Value,
}

struct Server {
    url: String,
    requests: Arc<Mutex<Vec<Request>>>,
    task: JoinHandle<()>,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}

// A real socket catches URL joining, auth header, serialization and transport
// failures without importing another adapter's router or DTOs into this adapter.
async fn server(replies: Vec<Reply>) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let requests = Arc::new(Mutex::new(Vec::new()));
    let captured = requests.clone();
    let mut replies = VecDeque::from(replies);
    let task = tokio::spawn(async move {
        while let Some(reply) = replies.pop_front() {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            let (header_end, content_length) = loop {
                let mut buf = [0; 4096];
                let read = socket.read(&mut buf).await.unwrap();
                assert!(read > 0);
                bytes.extend_from_slice(&buf[..read]);
                if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    let len = head
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length: "))
                        .unwrap()
                        .parse::<usize>()
                        .unwrap();
                    break (end + 4, len);
                }
            };
            while bytes.len() < header_end + content_length {
                let mut buf = [0; 4096];
                let read = socket.read(&mut buf).await.unwrap();
                assert!(read > 0);
                bytes.extend_from_slice(&buf[..read]);
            }
            captured.lock().unwrap().push(Request {
                head: String::from_utf8(bytes[..header_end].to_vec()).unwrap(),
                body: serde_json::from_slice(&bytes[header_end..header_end + content_length])
                    .unwrap(),
            });
            tokio::time::sleep(reply.delay).await;
            let response = format!(
                "HTTP/1.1 {} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n{}",
                reply.status,
                reply.body.len(),
                reply.headers,
                reply.body,
            );
            let _ = socket.write_all(response.as_bytes()).await;
        }
    });
    Server {
        url,
        requests,
        task,
    }
}

fn command() -> DispatchCodingAgentRequest {
    DispatchCodingAgentRequest {
        user_id: MacroUserIdStr::try_from(USER).unwrap(),
        agent_id: Uuid::now_v7(),
        prompt: "Fix the regression in the user's repository".into(),
    }
}

#[tokio::test]
async fn internal_auth_and_domain_commands_preserve_gateway_prefixes() {
    for prefix in ["", "/agent-harness"] {
        let command = command();
        let output = DispatchedCodingAgent {
            agent_session_id: Uuid::now_v7(),
            agent_id: command.agent_id,
            agent_name: "Repository maintainer".into(),
        };
        let server = server(vec![
            Reply::json(200, json!({"agents":[]})),
            Reply::json(200, json!(output)),
        ])
        .await;
        let client = CodingAgentsClient::new(&format!("{}{prefix}/", server.url), KEY).unwrap();
        assert!(
            client
                .list(command.user_id.clone())
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(client.dispatch(command.clone()).await.unwrap(), output);
        let requests = server.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        for (request, (operation, expected)) in requests.iter().zip([
            ("list", json!({"user_id":USER})),
            ("dispatch", json!(command)),
        ]) {
            assert!(request.head.starts_with(&format!(
                "POST {prefix}/internal/coding-agents/{operation} HTTP/1.1\r\n"
            )));
            assert!(
                request
                    .head
                    .contains(&format!("{INTERNAL_API_KEY_HEADER}: {KEY}\r\n"))
            );
            assert!(!request.head.contains("authorization:"));
            assert_eq!(request.body, expected);
        }
    }
}

#[tokio::test]
async fn ambiguous_dispatch_responses_do_not_replay_or_hide_the_uncertainty() {
    for (status, body) in [
        (200, "not JSON"),
        (200, "{}"),
        (502, "private upstream body"),
        (503, "unavailable"),
    ] {
        let server = server(vec![Reply {
            body: body.into(),
            ..Reply::json(status, Value::Null)
        }])
        .await;
        let client = CodingAgentsClient::new(&server.url, KEY).unwrap();
        let error = client.dispatch(command()).await.unwrap_err();
        assert_eq!(error, CodingAgentError::DispatchDeliveryUnknown);
        assert!(!error.to_string().contains("private upstream body"));
        assert_eq!(server.requests.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn domain_dispatch_failure_preserves_the_session_for_followup() {
    let error = CodingAgentError::DispatchFailed {
        agent_session_id: Uuid::now_v7(),
        reason: crate::domain::routines::RoutineSessionError::PromptDeliveryUnknown,
    };
    let server = server(vec![Reply::json(502, json!(error))]).await;
    let client = CodingAgentsClient::new(&server.url, KEY).unwrap();
    assert_eq!(client.dispatch(command()).await.unwrap_err(), error);
    assert_eq!(server.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn contradictory_status_and_error_envelopes_keep_dispatch_uncertain() {
    for (status, error) in [
        (307, CodingAgentError::Unavailable),
        (500, CodingAgentError::InvalidPrompt),
        (503, CodingAgentError::Forbidden),
        (504, CodingAgentError::OperationFailed),
        (
            400,
            CodingAgentError::DispatchFailed {
                agent_session_id: Uuid::now_v7(),
                reason: crate::domain::routines::RoutineSessionError::PromptDeliveryUnknown,
            },
        ),
    ] {
        let server = server(vec![Reply::json(status, json!(error))]).await;
        let client = CodingAgentsClient::new(&server.url, KEY).unwrap();
        assert_eq!(
            client.dispatch(command()).await.unwrap_err(),
            CodingAgentError::DispatchDeliveryUnknown,
        );
        assert_eq!(server.requests.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn matching_domain_errors_and_gateway_timeouts_are_preserved() {
    for (status, error) in [
        (400, CodingAgentError::InvalidCommand),
        (400, CodingAgentError::InvalidPrompt),
        (403, CodingAgentError::Forbidden),
        (404, CodingAgentError::Unavailable),
        (500, CodingAgentError::OperationFailed),
        (502, CodingAgentError::DispatchDeliveryUnknown),
        (504, CodingAgentError::DispatchDeliveryUnknown),
    ] {
        let server = server(vec![Reply::json(status, json!(error))]).await;
        let client = CodingAgentsClient::new(&server.url, KEY).unwrap();
        assert_eq!(client.dispatch(command()).await.unwrap_err(), error);
        assert_eq!(server.requests.lock().unwrap().len(), 1);
    }
    let server = server(vec![
        Reply::json(504, json!(CodingAgentError::OperationFailed)),
        Reply::json(504, json!(CodingAgentError::DispatchDeliveryUnknown)),
    ])
    .await;
    let client = CodingAgentsClient::new(&server.url, KEY).unwrap();
    assert_eq!(
        client.list(command().user_id).await.unwrap_err(),
        CodingAgentError::OperationFailed,
    );
    assert_eq!(
        client.list(command().user_id).await.unwrap_err(),
        CodingAgentError::OperationFailed,
    );
    assert_eq!(server.requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn redirects_never_forward_credentials_or_replay_dispatch() {
    let sink = server(vec![Reply::json(200, json!({"agents":[]}))]).await;
    let server = server(vec![Reply {
        headers: format!("Location: {}/other\r\n", sink.url),
        ..Reply::json(307, Value::Null)
    }])
    .await;
    let client = CodingAgentsClient::new(&server.url, KEY).unwrap();
    assert_eq!(
        client.dispatch(command()).await.unwrap_err(),
        CodingAgentError::DispatchDeliveryUnknown
    );
    assert_eq!(server.requests.lock().unwrap().len(), 1);
    assert!(sink.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn oversized_success_body_keeps_dispatch_uncertainty() {
    let server = server(vec![Reply {
        body: " ".repeat(MAX_RESPONSE_BYTES + 1),
        ..Reply::json(200, Value::Null)
    }])
    .await;
    let client = CodingAgentsClient::new(&server.url, KEY).unwrap();
    assert_eq!(
        client.dispatch(command()).await.unwrap_err(),
        CodingAgentError::DispatchDeliveryUnknown
    );
}

#[tokio::test]
async fn timed_out_dispatch_does_not_replay() {
    let server = server(vec![Reply {
        delay: Duration::from_secs(240),
        ..Reply::json(200, Value::Null)
    }])
    .await;
    let client = CodingAgentsClient::new(&server.url, KEY).unwrap();
    let request = tokio::spawn(async move { client.dispatch(command()).await });
    tokio::time::timeout(Duration::from_secs(2), async {
        while server.requests.lock().unwrap().is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    tokio::time::pause();
    tokio::time::advance(DISPATCH_TIMEOUT + Duration::from_secs(1)).await;
    assert_eq!(
        request.await.unwrap().unwrap_err(),
        CodingAgentError::DispatchDeliveryUnknown
    );
    tokio::time::resume();
    assert_eq!(server.requests.lock().unwrap().len(), 1);
}

#[test]
fn configuration_rejects_invalid_urls_and_marks_credentials_sensitive() {
    for url in [
        "not a url",
        "ftp://localhost",
        "http://user:pass@localhost",
        "http://localhost/?q=1",
        "http://localhost/#fragment",
    ] {
        assert!(CodingAgentsClient::new(url, KEY).is_err());
    }
    for key in ["", " ", "invalid\nheader"] {
        assert!(CodingAgentsClient::new("http://localhost", key).is_err());
    }
    let client = CodingAgentsClient::new("https://example.com/agent-harness", KEY).unwrap();
    assert!(client.internal_key.is_sensitive());
}
