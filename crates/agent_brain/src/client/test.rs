use serde_json::json;
use wiremock::matchers::{body_partial_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

const KEY: &str = "test-key";

async fn client(server: &MockServer) -> MacroClient {
    MacroClient::new(KEY, Hosts::all_at(&server.uri())).unwrap()
}

#[tokio::test]
async fn decide_sends_the_key_and_reads_probabilities() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/decisions"))
        .and(header("x-macro-user-api-key", KEY))
        .and(body_partial_json(json!({"questions": {"q": "Is it?"}})))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"probabilities": {"q": 0.75}})),
        )
        .expect(1)
        .mount(&server)
        .await;

    let response = client(&server)
        .await
        .decide(&DecideRequest {
            input: json!({"text": "hi"}),
            questions: [("q".to_owned(), "Is it?".to_owned())].into(),
        })
        .await
        .unwrap();

    assert_eq!(response.probabilities.get("q"), Some(&0.75));
}

#[tokio::test]
async fn reply_posts_into_the_thread_with_a_nonce() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/messages/channel/ch1"))
        .and(body_partial_json(
            json!({"content": "hello", "thread_id": "root1"}),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "m1", "content": "hello", "created_at": "2026-11-02T10:00:00Z",
            "sender_id": "macro|agent@example.com", "thread_id": "root1",
            "mentions": [], "attachments": [], "reactions": [],
            "parent": {"type": "channel", "id": "ch1"}
        })))
        .expect(1)
        .mount(&server)
        .await;

    let message = client(&server)
        .await
        .reply("ch1", "root1", "hello")
        .await
        .unwrap();

    assert_eq!(message.id, "m1");
    let requests = server.received_requests().await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert!(body["nonce"].as_str().is_some_and(|n| !n.is_empty()));
}

#[tokio::test]
async fn error_statuses_carry_the_status_code() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/agent-sessions"))
        .respond_with(ResponseTemplate::new(409).set_body_string("runtime offline"))
        .mount(&server)
        .await;

    let err = client(&server)
        .await
        .create_agent_session(Uuid::now_v7(), Uuid::now_v7())
        .await
        .unwrap_err();

    assert_eq!(err.status(), Some(409));
}

#[test]
fn environment_parses_and_rejects() {
    assert_eq!("dev".parse::<Environment>().unwrap(), Environment::Dev);
    assert_eq!("PROD".parse::<Environment>().unwrap(), Environment::Prod);
    assert!("staging".parse::<Environment>().is_err());
    assert_eq!(
        Hosts::for_env(Environment::Dev).storage,
        "https://dev-gateway.macro.com/dss"
    );
}

#[test]
fn debug_hides_the_key() {
    let client = MacroClient::new("secret-key", Hosts::for_env(Environment::Prod)).unwrap();
    assert!(!format!("{client:?}").contains("secret-key"));
}
