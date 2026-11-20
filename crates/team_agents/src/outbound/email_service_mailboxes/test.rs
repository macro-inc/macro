use email_service_client::EmailServiceClient;
use macro_user_id::cowlike::CowLike;
use serde_json::json;
use uuid::Uuid;
use wiremock::matchers::{body_partial_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

const AGENT: &str = "macro|sam-rivera-abc123@agents.macro.invalid";
const AGENT_PATH: &str =
    "/internal/agent-mailboxes/macro%7Csam-rivera-abc123%40agents.macro.invalid";

fn agent() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(AGENT).unwrap().into_owned()
}

fn mailboxes(server: &MockServer) -> EmailServiceMailboxes {
    EmailServiceMailboxes::new(
        EmailServiceClient::new("internal-key".to_owned(), server.uri()).agent_mailboxes(),
    )
}

fn active() -> serde_json::Value {
    json!({
        "id": "0193a1b2-0000-7000-8000-000000000001",
        "address": "sam-rivera@agents.example.com",
        "state": "active",
        "lastError": null,
        "provider": "dead_simple",
        "vendorMode": "fake",
        "notice": "fake vendor, not live",
    })
}

fn refused(status: u16, code: &str) -> ResponseTemplate {
    ResponseTemplate::new(status).set_body_json(json!({ "code": code, "message": code }))
}

fn request() -> ProvisionMailbox {
    ProvisionMailbox {
        request_id: Uuid::from_u128(7),
        agent: agent(),
        display_name: "Sam Rivera".to_owned(),
        local_part: "sam-rivera".to_owned(),
    }
}

#[tokio::test]
async fn provisioning_sends_the_agent_and_reads_a_fake_providers_mailbox() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/internal/agent-mailboxes"))
        .and(body_partial_json(json!({
            "requestId": "00000000-0000-0000-0000-000000000007",
            "agentUserId": AGENT,
            "displayName": "Sam Rivera",
            "requestedLocalPart": "sam-rivera",
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(active()))
        .expect(1)
        .mount(&server)
        .await;

    let view = mailboxes(&server).provision(&request()).await.unwrap();

    assert_eq!(
        view,
        MailboxView {
            mailbox_id: Uuid::parse_str("0193a1b2-0000-7000-8000-000000000001").unwrap(),
            address: Some("sam-rivera@agents.example.com".to_owned()),
            state: AgentInboxState::Active,
            last_error: None,
            fake_provider: true,
        }
    );
}

#[tokio::test]
async fn a_failed_answer_carries_its_reason() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/internal/agent-mailboxes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "0193a1b2-0000-7000-8000-000000000001",
            "address": null,
            "state": "failed",
            "lastError": "address_taken",
            "provider": "dead_simple",
            "vendorMode": "live",
        })))
        .mount(&server)
        .await;

    let view = mailboxes(&server).provision(&request()).await.unwrap();

    assert_eq!(view.state, AgentInboxState::Failed);
    assert_eq!(view.last_error, Some(AgentInboxFailure::AddressTaken));
    assert!(!view.fake_provider);
}

#[tokio::test]
async fn a_mailbox_from_an_earlier_request_is_answered_with_that_mailbox() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/internal/agent-mailboxes"))
        .respond_with(refused(409, "already_provisioned"))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(AGENT_PATH))
        .respond_with(ResponseTemplate::new(200).set_body_json(active()))
        .mount(&server)
        .await;

    let view = mailboxes(&server).provision(&request()).await.unwrap();

    assert_eq!(view.state, AgentInboxState::Active);
}

#[tokio::test]
async fn no_provider_and_a_refusing_provider_are_told_apart() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/internal/agent-mailboxes"))
        .respond_with(refused(503, "not_configured"))
        .mount(&server)
        .await;
    assert!(matches!(
        mailboxes(&server).provision(&request()).await,
        Err(MailboxError::NotConfigured)
    ));

    server.reset().await;
    Mock::given(method("POST"))
        .and(path("/internal/agent-mailboxes"))
        .respond_with(refused(502, "provider_rejected"))
        .mount(&server)
        .await;
    assert!(matches!(
        mailboxes(&server).provision(&request()).await,
        Err(MailboxError::Rejected)
    ));
}

#[tokio::test]
async fn an_agent_without_a_mailbox_has_no_status_and_nothing_to_pause_or_release() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(AGENT_PATH))
        .respond_with(refused(404, "not_found"))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("{AGENT_PATH}/pause")))
        .respond_with(refused(404, "not_found"))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("{AGENT_PATH}/release")))
        .respond_with(refused(404, "not_found"))
        .mount(&server)
        .await;
    let mailboxes = mailboxes(&server);

    assert_eq!(mailboxes.status(&agent()).await.unwrap(), None);
    mailboxes.pause(&agent()).await.unwrap();
    mailboxes.release(&agent()).await.unwrap();
}

#[tokio::test]
async fn a_release_left_for_the_sweep_counts_as_done_and_a_failed_pause_does_not() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("{AGENT_PATH}/release")))
        .respond_with(refused(503, "provider_unavailable"))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("{AGENT_PATH}/pause")))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    let mailboxes = mailboxes(&server);

    mailboxes.release(&agent()).await.unwrap();
    assert!(matches!(
        mailboxes.pause(&agent()).await,
        Err(MailboxError::Unavailable(_))
    ));
}

#[tokio::test]
async fn a_pause_of_a_mailbox_already_paused_or_being_deleted_is_done() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("{AGENT_PATH}/pause")))
        .respond_with(refused(409, "not_ready"))
        .mount(&server)
        .await;

    mailboxes(&server).pause(&agent()).await.unwrap();
}

#[tokio::test]
async fn a_permanent_refusal_is_rejected_not_an_outage() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/internal/agent-mailboxes"))
        .respond_with(refused(403, "not_an_agent"))
        .mount(&server)
        .await;

    assert!(matches!(
        mailboxes(&server).provision(&request()).await,
        Err(MailboxError::Rejected)
    ));
}

#[tokio::test]
async fn a_failed_request_never_names_the_agent() {
    // Nothing listens there.
    let mailboxes = EmailServiceMailboxes::new(
        EmailServiceClient::new("internal-key".to_owned(), "http://127.0.0.1:9".to_owned())
            .agent_mailboxes(),
    );

    let Err(MailboxError::Unavailable(report)) = mailboxes.status(&agent()).await else {
        panic!("a refused connection is an outage");
    };

    let logged = format!("{report:?} {report}");
    assert!(!logged.contains("agents.macro.invalid"), "{logged}");
    assert!(!logged.contains("sam-rivera"), "{logged}");
}
