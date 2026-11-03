use std::time::Duration;

use serde_json::json;
use wiremock::matchers::{method, path, path_regex};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::client::Hosts;

#[tokio::test]
async fn command_waker_pipes_the_prompt_and_logs_output() {
    let dir = tempfile::tempdir().unwrap();
    let waker = CommandWaker::new("cat", dir.path(), dir.path().join("log"));

    let outcome = waker
        .wake(Turn::new("respond", "hello agent"))
        .await
        .unwrap();

    assert!(outcome.success);
    let log = tokio::fs::read_to_string(outcome.log_path.unwrap())
        .await
        .unwrap();
    assert_eq!(log, "hello agent");
    let index = tokio::fs::read_to_string(dir.path().join("log/index.log"))
        .await
        .unwrap();
    assert!(index.contains(" respond ok "));
}

#[tokio::test]
async fn command_waker_kills_a_turn_that_runs_too_long() {
    let dir = tempfile::tempdir().unwrap();
    let waker = CommandWaker::new("sleep", dir.path(), dir.path())
        .args(["30"])
        .timeout(Duration::from_millis(100));

    let outcome = waker.wake(Turn::new("slow", "")).await.unwrap();

    assert!(!outcome.success);
    assert!(outcome.detail.contains("timed out"));
}

#[tokio::test]
async fn session_waker_reuses_one_session_per_conversation() {
    let dir = tempfile::tempdir().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/agent-sessions"))
        .respond_with(
            ResponseTemplate::new(201)
                .set_body_json(json!({"session": {"id": Uuid::now_v7(), "status": "idle"}})),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path_regex("^/agent-sessions/[^/]+/control$"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"actionId": Uuid::now_v7(), "status": "sent"})),
        )
        .expect(2)
        .mount(&server)
        .await;
    let client = MacroClient::new("k", Hosts::all_at(&server.uri())).unwrap();
    let sessions = dir.path().join("sessions.json");
    let waker = SessionWaker::new(client, Uuid::now_v7(), &sessions);

    for _ in 0..2 {
        let outcome = waker
            .wake(Turn::new("respond", "hi").in_conversation("ch1"))
            .await
            .unwrap();
        assert!(outcome.success);
    }

    let saved: HashMap<String, Uuid> =
        serde_json::from_str(&tokio::fs::read_to_string(&sessions).await.unwrap()).unwrap();
    assert!(saved.contains_key("ch1"));
}
