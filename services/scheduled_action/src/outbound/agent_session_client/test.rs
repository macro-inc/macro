use super::*;
use agent_runtime_protocol::domain::action::AgentActionId;
use agent_session::domain::model::AgentSessionId;
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::generate_uuid_v7;
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

const KEY: &str = "test-internal-key";

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

fn selection() -> ValidateRoutineSession {
    ValidateRoutineSession {
        owner: MacroUserIdStr::parse_from_str("macro|routine@macro.com").unwrap(),
        bot_id: BotId::new_from_uuid(generate_uuid_v7()),
        model: Some("selected/runtime-model".into()),
    }
}

fn identity() -> RoutineSessionAction {
    let selection = selection();
    RoutineSessionAction {
        owner: selection.owner,
        bot_id: selection.bot_id,
        session_id: AgentSessionId::new_from_uuid(generate_uuid_v7()),
        action_id: AgentActionId::mint(),
    }
}

#[tokio::test]
async fn all_commands_use_internal_auth_and_domain_wire_contract_at_both_prefixes() {
    for prefix in ["", "/agent-harness"] {
        let identity = identity();
        let selection = ValidateRoutineSession {
            owner: identity.owner.clone(),
            bot_id: identity.bot_id,
            ..selection()
        };
        let prepare = PrepareRoutineSession {
            repo_url: None,
            repo_branch: None,
            selection: selection.clone(),
            session_id: identity.session_id,
        };
        let prompt = PromptRoutineSession {
            action: identity.clone(),
            prompt: "Routine instructions\nUser task\nTriggering event context (data): {\"event_name\":\"document.updated\"}".into(),
        };
        let server = server(vec![
            Reply::json(200, json!({"managed":false})),
            Reply::json(200, json!({"session_id":identity.session_id})),
            Reply::json(200, json!({"action_id":identity.action_id,"queued":false})),
            Reply::json(200, json!({"state":"succeeded"})),
            Reply {
                body: String::new(),
                ..Reply::json(204, Value::Null)
            },
        ])
        .await;
        let client = AgentSessionClient::new(&format!("{}{prefix}/", server.url), KEY).unwrap();
        assert!(!client.validate(selection.clone()).await.unwrap().managed);
        assert_eq!(
            client.prepare(prepare.clone()).await.unwrap().session_id,
            identity.session_id
        );
        assert_eq!(
            client.prompt(prompt.clone()).await.unwrap().action_id,
            identity.action_id
        );
        assert_eq!(
            client.status(identity.clone()).await.unwrap(),
            RoutineActionStatus::Succeeded
        );
        client.cancel(identity.clone()).await.unwrap();
        let requests = server.requests.lock().unwrap();
        assert_eq!(requests.len(), 5);
        for (request, (operation, command)) in requests.iter().zip([
            ("validate", serde_json::to_value(selection).unwrap()),
            ("prepare", serde_json::to_value(prepare).unwrap()),
            ("prompt", serde_json::to_value(prompt).unwrap()),
            ("status", serde_json::to_value(&identity).unwrap()),
            ("cancel", serde_json::to_value(&identity).unwrap()),
        ]) {
            assert!(request.head.starts_with(&format!(
                "POST {prefix}/internal/routine-sessions/{operation} HTTP/1.1\r\n"
            )));
            assert!(
                request
                    .head
                    .contains(&format!("{INTERNAL_API_KEY_HEADER}: {KEY}\r\n"))
            );
            assert!(!request.head.contains("authorization:"));
            assert_eq!(request.body, command);
        }
    }
}

#[tokio::test]
async fn typed_sanitized_domain_errors_are_preserved() {
    for (status, code) in [
        (
            402,
            RoutineSessionError::Admission(ai_billing::AiAdmissionError::Denied(
                ai_billing::DenyReason::AllowanceExhausted,
            )),
        ),
        (
            503,
            RoutineSessionError::Admission(ai_billing::AiAdmissionError::Unavailable),
        ),
        (400, RoutineSessionError::InvalidCommand),
        (403, RoutineSessionError::Forbidden),
        (404, RoutineSessionError::PersonaUnavailable),
        (503, RoutineSessionError::RuntimeUnavailable),
        (409, RoutineSessionError::SessionMismatch),
        (409, RoutineSessionError::ModelMismatch),
        (409, RoutineSessionError::Conflict),
        (502, RoutineSessionError::PromptDeliveryUnknown),
        (500, RoutineSessionError::OperationFailed),
    ] {
        let server = server(vec![Reply::json(
            status,
            json!({"code":code,"detail":"private content"}),
        )])
        .await;
        let client = AgentSessionClient::new(&server.url, KEY).unwrap();
        let error = client
            .prepare(PrepareRoutineSession {
                repo_url: None,
                repo_branch: None,
                selection: selection(),
                session_id: identity().session_id,
            })
            .await
            .unwrap_err();
        assert_eq!(error, code);
        assert!(!error.to_string().contains("private content"));
        assert_eq!(server.requests.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn malformed_and_ambiguous_prompt_responses_never_replay() {
    for (status, body) in [
        (200, "not JSON"),
        (502, "private upstream error"),
        (200, "{}"),
        (503, "unavailable"),
    ] {
        let server = server(vec![Reply {
            body: body.into(),
            ..Reply::json(status, Value::Null)
        }])
        .await;
        let client = AgentSessionClient::new(&server.url, KEY).unwrap();
        let error = client
            .prompt(PromptRoutineSession {
                action: identity(),
                prompt: "task".into(),
            })
            .await
            .unwrap_err();
        assert_eq!(error, RoutineSessionError::PromptDeliveryUnknown);
        assert_eq!(server.requests.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn proxy_errors_map_without_exposing_response_body() {
    for (status, expected) in [
        (401, RoutineSessionError::Forbidden),
        (403, RoutineSessionError::Forbidden),
        (400, RoutineSessionError::InvalidCommand),
        (409, RoutineSessionError::Conflict),
        (429, RoutineSessionError::RuntimeUnavailable),
        (503, RoutineSessionError::RuntimeUnavailable),
        (500, RoutineSessionError::OperationFailed),
    ] {
        let server = server(vec![Reply {
            body: "private upstream response".into(),
            ..Reply::json(status, Value::Null)
        }])
        .await;
        let client = AgentSessionClient::new(&server.url, KEY).unwrap();
        assert_eq!(client.status(identity()).await.unwrap_err(), expected);
    }
}

#[tokio::test]
async fn redirects_never_forward_internal_credentials_or_replay_commands() {
    let sink = server(vec![Reply::json(200, json!({"managed":true}))]).await;
    let server = server(vec![Reply {
        headers: format!("Location: {}/other\r\n", sink.url),
        ..Reply::json(307, Value::Null)
    }])
    .await;
    let client = AgentSessionClient::new(&server.url, KEY).unwrap();
    assert!(client.validate(selection()).await.is_err());
    assert_eq!(server.requests.lock().unwrap().len(), 1);
    assert!(sink.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn oversized_success_responses_are_rejected() {
    let server = server(vec![Reply {
        body: " ".repeat(MAX_RESPONSE_BYTES + 1),
        ..Reply::json(200, Value::Null)
    }])
    .await;
    let client = AgentSessionClient::new(&server.url, KEY).unwrap();
    assert_eq!(
        client.status(identity()).await.unwrap_err(),
        RoutineSessionError::OperationFailed
    );
}

#[tokio::test]
async fn status_and_prompt_requests_have_bounded_timeouts() {
    // Advance only after the socket has accepted the request, rather than let
    // paused Tokio time race real network readiness during connect.
    for operation in [Operation::Status, Operation::Prompt] {
        let server = server(vec![Reply {
            delay: Duration::from_secs(120),
            ..Reply::json(200, Value::Null)
        }])
        .await;
        let client = AgentSessionClient::new(&server.url, KEY).unwrap();
        let request = tokio::spawn(async move {
            if operation == Operation::Prompt {
                client
                    .prompt(PromptRoutineSession {
                        action: identity(),
                        prompt: "task".into(),
                    })
                    .await
                    .map(|_| ())
            } else {
                client.status(identity()).await.map(|_| ())
            }
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            while server.requests.lock().unwrap().is_empty() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        tokio::time::pause();
        tokio::time::advance(operation.timeout() + Duration::from_secs(1)).await;
        assert_eq!(
            request.await.unwrap().unwrap_err(),
            operation.uncertain_error()
        );
        tokio::time::resume();
        assert_eq!(server.requests.lock().unwrap().len(), 1);
    }
}

#[test]
fn configuration_is_validated_and_secret_header_is_sensitive() {
    for url in [
        "not a url",
        "ftp://localhost",
        "http://user:pass@localhost",
        "http://localhost/?q=1",
        "http://localhost/#fragment",
    ] {
        assert!(AgentSessionClient::new(url, KEY).is_err());
    }
    for key in ["", " ", "invalid\nheader"] {
        assert!(AgentSessionClient::new("http://localhost", key).is_err());
    }
    let client = AgentSessionClient::new("https://example.com/agent-harness", KEY).unwrap();
    assert!(client.internal_key.is_sensitive());
}
