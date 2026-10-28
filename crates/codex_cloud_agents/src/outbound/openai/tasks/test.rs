use super::*;

#[test]
fn creation_receipt_preserves_task_qualified_turn_identity() {
    let body =
        serde_json::json!({"task":{"id":"task_e_123"},"turn":{"id":"task_e_123~assttrn_e_456"}});
    let created = receipt(serde_json::from_value(body).unwrap()).unwrap();
    assert_eq!(created.task_id.as_str(), "task_e_123");
    assert_eq!(
        created.assistant_turn_id.unwrap().as_str(),
        "task_e_123~assttrn_e_456"
    );
    assert!(TurnId::new("../other".to_owned()).is_err());
    assert!(CloudId::new("task/other".to_owned()).is_err());
}

#[test]
fn task_projection_checks_identity_and_unknown_status_is_not_terminal() {
    let task = CloudId::new("task_e_123".to_owned()).unwrap();
    let body = serde_json::json!({"task":{"id":"task_e_123"},"current_assistant_turn":{"id":"task_e_123~assttrn_e_456", "turn_status":"future_status", "output_items":[{"type":"message","content":[{"content_type":"text","text":"done"}]}]}});
    let snapshot = project(&task, &body).unwrap();
    assert!(!snapshot.terminal());
    assert_eq!(snapshot.turns[0].messages, ["done"]);
    assert!(project(&CloudId::new("different".to_owned()).unwrap(), &body).is_err());
}

#[tokio::test]
async fn conversation_routes_payloads_and_replay_match_desktop_contract() {
    use crate::domain::Secret;
    use crate::domain::cloud::CloudConversation;
    use axum::{
        Router,
        body::{Body, to_bytes},
        extract::Request,
        response::Response,
        routing::any,
    };
    use futures::StreamExt;
    let app = Router::new().fallback(any(async |request: Request| {
        let (parts, body) = request.into_parts();
        assert_eq!(parts.headers["chatgpt-account-id"], "test-account");
        assert_eq!(parts.headers["authorization"], "Bearer test-access");
        let path = parts.uri.path();
        let (content_type, reply) = if path.ends_with("/stream") {
            assert_eq!(parts.uri.query(), Some("item_type=thread_event&item_type=log"));
            ("text/event-stream", "data: {\"id\":\"event1\",\"item_type\":\"thread_event\",\"event\":{\"method\":\"turn/completed\",\"params\":{}}}\n\n")
        } else if path.ends_with("/cancel") {
            assert_eq!(parts.method, "POST");
            assert!(to_bytes(body, 1024).await.unwrap().is_empty());
            ("application/json", r#"{"success":true}"#)
        } else if path == "/wham/tasks" {
            assert_eq!(parts.method, "POST");
            let body: Value = serde_json::from_slice(&to_bytes(body, 4096).await.unwrap()).unwrap();
            assert_eq!(body["follow_up"], serde_json::json!({"task_id":"task_test", "turn_id":"task_test~turn_old", "environment_mode":"code"}));
            assert_eq!(body["input_items"][0]["content"][0]["text"], "next prompt");
            ("application/json", r#"{"task":{"id":"task_test"},"turn":{"id":"task_test~turn_new"}}"#)
        } else {
            assert_eq!(path, "/wham/tasks/task_test/turns/task_test~turn_new");
            ("application/json", r#"{"task":{"id":"task_test"},"turn":{"id":"task_test~turn_new","turn_status":"cancelled","output_items":[]}}"#)
        };
        Response::builder().header("content-type", content_type).body(Body::from(reply)).unwrap()
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut provider = OpenAi::new().unwrap();
    provider.cloud = origin;
    let auth = Credentials {
        version: 1,
        access_token: Secret::new("test-access".to_owned()).unwrap(),
        refresh_token: Secret::new("test-refresh".to_owned()).unwrap(),
        expires_at: 1000,
        account_id: "test-account".to_owned(),
    };
    let task = CloudId::new("task_test".to_owned()).unwrap();
    let turn = TurnId::new("task_test~turn_old".to_owned()).unwrap();
    let created = provider
        .follow_up(&auth, &task, &turn, "next prompt")
        .await
        .unwrap();
    let turn = created.assistant_turn_id.unwrap();
    let mut stream = provider.stream(&auth, &task, &turn).await.unwrap();
    assert_eq!(
        stream
            .next()
            .await
            .unwrap()
            .unwrap()
            .decode()
            .unwrap()
            .unwrap()
            .method,
        "turn/completed"
    );
    assert!(stream.next().await.is_none());
    provider.cancel(&auth, &task).await.unwrap();
    let snapshot = provider.turn(&auth, &task, &turn).await.unwrap();
    assert!(snapshot.terminal());
    assert_eq!(snapshot.assistant_status.as_deref(), Some("cancelled"));
    server.abort();
}
