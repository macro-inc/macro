use super::*;
use crate::domain::cloud::{CloudId, CloudTasks, Launch};
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    response::Response as AxumResponse,
    routing::any,
};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

type Recorded = (String, reqwest::header::HeaderMap, String);
struct Mock {
    replies: Mutex<VecDeque<(u16, String)>>,
    requests: Mutex<Vec<Recorded>>,
}
struct Server {
    task: tokio::task::JoinHandle<()>,
    mock: Arc<Mock>,
    provider: OpenAi,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn server(replies: Vec<(u16, String)>) -> Server {
    let mock = Arc::new(Mock {
        replies: Mutex::new(replies.into()),
        requests: Mutex::new(vec![]),
    });
    let app = Router::new()
        .fallback(any(
            async |State(mock): State<Arc<Mock>>, request: Request| {
                let (parts, body) = request.into_parts();
                let text =
                    String::from_utf8(to_bytes(body, MAX_BODY).await.unwrap().to_vec()).unwrap();
                mock.requests.lock().unwrap().push((
                    format!("{} {}", parts.method, parts.uri.path()),
                    parts.headers,
                    text,
                ));
                let (status, body) = mock
                    .replies
                    .lock()
                    .unwrap()
                    .pop_front()
                    .expect("unexpected HTTP request");
                AxumResponse::builder()
                    .status(status)
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap()
            },
        ))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let mut provider = OpenAi::new().unwrap();
    provider.issuer = origin.clone();
    provider.cloud = origin;
    Server {
        task,
        mock,
        provider,
    }
}
fn jwt(account: &str) -> String {
    format!("header.{}.signature", URL_SAFE_NO_PAD.encode(serde_json::json!({"https://api.openai.com/auth": {"chatgpt_account_id": account}, "exp": 4102444800_u64}).to_string()))
}
fn token_body(refresh: bool) -> String {
    let mut body = serde_json::json!({"access_token": jwt("account-a"), "expires_in": 3600});
    if refresh {
        body["refresh_token"] = "test-refresh".into();
    }
    body.to_string()
}
fn device_body(interval: serde_json::Value) -> String {
    serde_json::json!({"device_auth_id": "private-device", "user_code": "ABCD-1234", "interval": interval}).to_string()
}

#[tokio::test]
async fn direct_device_flow_sends_codex_client_and_pkce_exchange() {
    let server = server(vec![
        (200, device_body("5".into())),
        (403, "pending".to_owned()),
        (404, "pending".to_owned()),
        (
            200,
            serde_json::json!({"authorization_code":"code", "code_verifier":"verifier"})
                .to_string(),
        ),
        (200, token_body(true)),
    ])
    .await;
    let login = server.provider.begin().await.unwrap();
    assert_eq!(login.interval, Duration::from_secs(8));
    assert_eq!(login.user_code, "ABCD-1234");
    assert!(matches!(
        server.provider.poll(&login).await.unwrap(),
        LoginPoll::Pending
    ));
    assert!(matches!(
        server.provider.poll(&login).await.unwrap(),
        LoginPoll::Pending
    ));
    let LoginPoll::Complete(tokens) = server.provider.poll(&login).await.unwrap() else {
        panic!("expected completion")
    };
    assert_eq!(tokens.account_id, "account-a");
    let requests = server.mock.requests.lock().unwrap();
    assert_eq!(requests[0].0, "POST /api/accounts/deviceauth/usercode");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&requests[0].2).unwrap()["client_id"],
        CLIENT_ID
    );
    assert_eq!(requests[4].0, "POST /oauth/token");
    let form: std::collections::HashMap<_, _> =
        reqwest::Url::parse(&format!("http://localhost/?{}", requests[4].2))
            .unwrap()
            .query_pairs()
            .into_owned()
            .collect();
    assert_eq!(form["grant_type"], "authorization_code");
    assert_eq!(form["code_verifier"], "verifier");
    assert_eq!(form["client_id"], CLIENT_ID);
    assert_eq!(
        form["redirect_uri"],
        format!("{}/deviceauth/callback", server.provider.issuer)
    );
}

#[tokio::test]
async fn numeric_interval_and_safe_environment_projection() {
    let server = server(vec![
        (200, device_body(7.into())),
        (
            200,
            r#"[{"id":"env-1","label":"Test","setup_script":"secret-marker"}]"#.to_owned(),
        ),
    ])
    .await;
    assert_eq!(
        server.provider.begin().await.unwrap().interval,
        Duration::from_secs(10)
    );
    let tokens: Tokens = serde_json::from_str(&token_body(true)).unwrap();
    let credentials = tokens.credentials(None, 1).unwrap();
    let environments = server.provider.environments(&credentials).await.unwrap();
    assert_eq!(
        environments,
        vec![Environment {
            repositories: vec![],
            id: "env-1".to_owned(),
            label: Some("Test".to_owned())
        }]
    );
    let requests = server.mock.requests.lock().unwrap();
    assert_eq!(requests[1].0, "GET /wham/environments");
    assert_eq!(requests[1].1["chatgpt-account-id"], "account-a");
    assert_eq!(
        requests[1].1["authorization"],
        format!("Bearer {}", credentials.access_token.expose())
    );
    assert!(
        !serde_json::to_string(&environments)
            .unwrap()
            .contains("secret-marker")
    );
}

#[tokio::test]
async fn refresh_keeps_old_refresh_token_if_provider_omits_rotation() {
    let server = server(vec![(200, token_body(false))]).await;
    let credentials = serde_json::from_str::<Tokens>(&token_body(true))
        .unwrap()
        .credentials(None, 1)
        .unwrap();
    let next = server.provider.refresh(&credentials).await.unwrap();
    assert_eq!(next.refresh_token.expose(), "test-refresh");
    assert_eq!(next.account_id, credentials.account_id);
    assert!(
        server.mock.requests.lock().unwrap()[0]
            .2
            .contains("grant_type=refresh_token")
    );
}

#[tokio::test]
async fn provider_errors_and_invalid_json_never_echo_bodies_or_retry() {
    for (status, body) in [
        (400, "secret-marker"),
        (429, "secret-marker"),
        (500, "secret-marker"),
        (302, "secret-marker"),
        (200, "secret-marker"),
    ] {
        let server = server(vec![(status, body.to_owned())]).await;
        let error = server.provider.begin().await.err().unwrap().to_string();
        assert!(!error.contains("secret-marker"));
        assert_eq!(server.mock.requests.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn rejects_oversized_response() {
    let server = server(vec![(200, " ".repeat(MAX_BODY + 1))]).await;
    assert!(
        server
            .provider
            .begin()
            .await
            .err()
            .unwrap()
            .to_string()
            .contains("1 MiB")
    );
}

#[test]
fn token_metadata_is_required_and_secrets_are_not_in_errors() {
    let tokens: Tokens = serde_json::from_value(serde_json::json!({"access_token":"secret-marker", "refresh_token":"refresh", "expires_in":3600})).unwrap();
    let error = tokens.credentials(None, 1).err().unwrap().to_string();
    assert!(!error.contains("secret-marker"));
    assert!(error.contains("account ID"));
    let tokens: Tokens = serde_json::from_str(&token_body(false)).unwrap();
    assert!(tokens.credentials(None, 1).is_err());
}

#[tokio::test]
async fn task_creation_uses_observed_payload_and_account_headers_once() {
    for body in [r#"{"task":{"id":"task_test"}}"#, r#"{"id":"task_test"}"#] {
        let server = server(vec![(200, body.to_owned())]).await;
        let credentials = serde_json::from_str::<Tokens>(&token_body(true))
            .unwrap()
            .credentials(None, 1)
            .unwrap();
        let prompt = "Quote 'hello'; $(this is data)\nNext line";
        let request = Launch {
            environment: CloudId::new("env-test".to_owned()).unwrap(),
            branch: "feature/test".to_owned(),
            prompt: prompt.to_owned(),
        };
        let created = server
            .provider
            .create(&credentials, &request)
            .await
            .unwrap();
        assert_eq!(created.url, "https://chatgpt.com/codex/tasks/task_test");
        let requests = server.mock.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].0, "POST /wham/tasks");
        assert_eq!(requests[0].1["chatgpt-account-id"], "account-a");
        let body: serde_json::Value = serde_json::from_str(&requests[0].2).unwrap();
        assert_eq!(
            body,
            serde_json::json!({
                "new_task":{"environment_id":"env-test", "branch":"feature/test", "run_environment_in_qa_mode":false},
                "input_items":[{"type":"message","role":"user","content":[{"content_type":"text","text":prompt}]}],
            })
        );
    }
}

#[tokio::test]
async fn unknown_creation_response_never_retries_or_exposes_body() {
    let server = server(vec![(200, r#"{"unexpected":"secret-marker"}"#.to_owned())]).await;
    let credentials = serde_json::from_str::<Tokens>(&token_body(true))
        .unwrap()
        .credentials(None, 1)
        .unwrap();
    let request = Launch {
        environment: CloudId::new("env-test".to_owned()).unwrap(),
        branch: "main".to_owned(),
        prompt: "test".to_owned(),
    };
    let error = server
        .provider
        .create(&credentials, &request)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("acceptance unknown"));
    assert!(!error.contains("secret-marker"));
    assert_eq!(server.mock.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn snapshots_preserve_partial_text_unknown_kinds_and_status_without_fake_completion() {
    let bodies = ["in_progress", "new_provider_status", "completed"].map(|status| serde_json::json!({
        "task":{"id":"task_test","title":"Test","summary":{"files_changed":2}},
        "current_assistant_turn": {"id":"turn-1", "turn_status":status, "output_items":[
            {"type":"message","content":[{"content_type":"text","text":"Partial 🐺"}]},
            {"type":"new_tool","secret":"not included"}
        ]},
        "current_diff_task_turn":{"id":"turn-2","output_items":[{"type":"output_diff","diff":"private file contents"}]}
    }).to_string());
    let server = server(bodies.into_iter().map(|body| (200, body)).collect()).await;
    let credentials = serde_json::from_str::<Tokens>(&token_body(true))
        .unwrap()
        .credentials(None, 1)
        .unwrap();
    let task = CloudId::new("task_test".to_owned()).unwrap();
    for terminal in [false, false, true] {
        let snapshot = server.provider.snapshot(&credentials, &task).await.unwrap();
        assert_eq!(snapshot.terminal(), terminal);
        assert_eq!(snapshot.turns[0].messages, ["Partial 🐺"]);
        assert_eq!(snapshot.turns[0].output_types, ["message", "new_tool"]);
        assert!(snapshot.turns[1].has_diff);
        let json = serde_json::to_string(&snapshot).unwrap();
        assert!(!json.contains("private file contents"));
        assert!(!json.contains("files_changed"));
        assert!(!json.contains("not included"));
    }
}

#[tokio::test]
async fn wrong_task_id_and_non_task_response_are_rejected() {
    let server = server(vec![
        (200, r#"{"task":{"id":"another-task"}}"#.to_owned()),
        (200, "{}".to_owned()),
    ])
    .await;
    let credentials = serde_json::from_str::<Tokens>(&token_body(true))
        .unwrap()
        .credentials(None, 1)
        .unwrap();
    let task = CloudId::new("task_test".to_owned()).unwrap();
    for _ in 0..2 {
        assert!(server.provider.snapshot(&credentials, &task).await.is_err());
    }
}
