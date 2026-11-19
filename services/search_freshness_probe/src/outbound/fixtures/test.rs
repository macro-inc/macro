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
async fn no_marked_session_means_no_fixture() {
    let (_server, api, search) = server().await;

    let found = AgentSessions::new(api, search)
        .find()
        .await
        .expect("searched");

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
