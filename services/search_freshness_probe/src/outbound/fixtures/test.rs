use serde_json::json;
use uuid::Uuid;
use wiremock::matchers::{body_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

async fn server() -> (MockServer, MacroApi, UnifiedSearch) {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/dss/search"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"results": []})))
        .mount(&server)
        .await;
    let api = MacroApi::new(&server.uri(), "mak_key").expect("a valid key");
    let search = UnifiedSearch::new(api.clone());
    (server, api, search)
}

#[tokio::test]
async fn with_no_session_titled_for_it_the_probe_creates_one_once() {
    let (server, api, search) = server().await;
    let session = Uuid::new_v4();
    Mock::given(method("POST"))
        .and(path("/agent-harness/agent-sessions"))
        .and(body_json(json!({})))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({"session": {"id": session}})))
        .expect(1)
        .mount(&server)
        .await;
    let mut sessions = AgentSessions::new(api, search);

    let found = sessions.find().await.expect("created");
    // Search does not show the new session yet; it is not created twice.
    let again = sessions.find().await.expect("the same one");

    assert_eq!(found, Some(EntityId(session)));
    assert_eq!(again, found);
}

#[tokio::test]
async fn no_marked_call_record_means_no_fixture() {
    let (_server, api, search) = server().await;

    let found = Calls::new(api, search).find().await.expect("searched");

    assert_eq!(found, None);
}

#[tokio::test]
async fn a_session_is_renamed_through_the_harness() {
    let (server, api, search) = server().await;
    let session = Uuid::new_v4();
    let title = Token::random();
    Mock::given(method("PUT"))
        .and(path(format!(
            "/agent-harness/agent-sessions/{session}/name"
        )))
        .and(body_json(json!({"name": title.title()})))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    AgentSessions::new(api, search)
        .rename(EntityId(session), &title)
        .await
        .expect("renamed");
}

#[tokio::test]
async fn a_call_record_is_renamed_by_its_custom_name() {
    let (server, api, search) = server().await;
    let call = Uuid::new_v4();
    let title = Token::random();
    Mock::given(method("PATCH"))
        .and(path(format!("/dss/call/record/{call}")))
        .and(body_json(json!({"customName": title.title()})))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    Calls::new(api, search)
        .rename(EntityId(call), &title)
        .await
        .expect("renamed");
}
