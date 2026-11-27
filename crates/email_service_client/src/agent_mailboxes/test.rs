use serde_json::json;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

const AGENT: &str = "macro|ada-1@agents.macro.invalid";

fn client(server: &MockServer) -> AgentMailboxesClient {
    EmailServiceClient::new("internal-key".to_owned(), server.uri()).agent_mailboxes()
}

#[tokio::test]
async fn provisions_with_the_internal_key_and_reads_the_fake_vendor_notice() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/internal/agent-mailboxes"))
        .and(header("x-internal-auth-key", "internal-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "0193a1b2-0000-7000-8000-000000000001",
            "address": "ada@example.net",
            "state": "active",
            "lastError": null,
            "provider": "dead_simple",
            "vendorMode": "fake",
            "notice": "fake vendor, not live",
        })))
        .mount(&server)
        .await;
    let request = ProvisionAgentMailboxRequest {
        request_id: uuid::Uuid::from_u128(1),
        agent_user_id: AGENT.to_owned(),
        display_name: Some("Ada".to_owned()),
        requested_local_part: Some("ada".to_owned()),
    };

    let response = client(&server).provision(&request).await.unwrap();

    assert_eq!(response.mailbox.state, MailboxState::Active);
    assert_eq!(response.mailbox.vendor_mode, VendorMode::Fake);
    assert_eq!(response.notice.as_deref(), Some("fake vendor, not live"));
}

#[tokio::test]
async fn a_refusal_carries_its_code_and_the_agent_id_is_path_encoded() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(
            "/internal/agent-mailboxes/macro%7Cada-1%40agents.macro.invalid/release",
        ))
        .respond_with(ResponseTemplate::new(503).set_body_json(json!({
            "code": "provider_unavailable",
            "message": "retry",
        })))
        .mount(&server)
        .await;

    let error = client(&server).release(AGENT).await.unwrap_err();

    assert_eq!(
        error.code(),
        Some(AgentMailboxErrorCode::ProviderUnavailable)
    );
}
