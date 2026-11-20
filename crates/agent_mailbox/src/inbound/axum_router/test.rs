use std::sync::Mutex;

use axum::body::Body;
use axum::http::Request;
use macro_authorization::{InternalIdentityClaims, MacroAuthorizationError};
use model_user::UserContext;
use rootcause::Report;
use tower::ServiceExt;

use super::*;
use crate::domain::models::{
    AgentMailboxId, AgentMailboxView, MailboxProvider, MailboxState, OwnerApproval, VendorMode,
};
use crate::wire::FAKE_VENDOR_NOTICE;
use uuid::Uuid;

const AGENT: &str = "macro|ada-1@agents.macro.invalid";
const INTERNAL_KEY: &str = "internal-key";

/// Records which use case was reached and answers with a canned result.
#[derive(Default)]
struct Recording {
    calls: Mutex<Vec<String>>,
    send_limit: bool,
}

impl Recording {
    fn record(&self, call: String) {
        self.calls.lock().unwrap().push(call);
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }
}

fn view() -> AgentMailboxView {
    AgentMailboxView {
        id: AgentMailboxId(Uuid::from_u128(1)),
        address: Some("ada@example.net".to_owned()),
        state: MailboxState::Active,
        last_error: None,
        provider: MailboxProvider::DeadSimple,
        vendor_mode: VendorMode::Fake,
    }
}

fn sent() -> SentMessage {
    SentMessage {
        id: ProviderMessageId("sent-1".to_owned()),
        thread_id: None,
    }
}

impl AgentMailboxUseCases for Recording {
    async fn provision(
        &self,
        request: ProvisionRequest,
    ) -> Result<AgentMailboxView, AgentMailboxError> {
        self.record(format!("provision {}", request.agent));
        Ok(view())
    }
    async fn status(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<AgentMailboxView, AgentMailboxError> {
        self.record(format!("status {agent}"));
        Ok(view())
    }
    async fn pause(
        &self,
        agent: &MacroUserIdStr<'_>,
        _: DateTime<Utc>,
    ) -> Result<AgentMailboxView, AgentMailboxError> {
        self.record(format!("pause {agent}"));
        Ok(view())
    }
    async fn resume(
        &self,
        agent: &MacroUserIdStr<'_>,
        _: DateTime<Utc>,
    ) -> Result<AgentMailboxView, AgentMailboxError> {
        self.record(format!("resume {agent}"));
        Ok(view())
    }
    async fn release(
        &self,
        agent: &MacroUserIdStr<'_>,
        _: DateTime<Utc>,
    ) -> Result<(), AgentMailboxError> {
        self.record(format!("release {agent}"));
        Ok(())
    }
    async fn list_messages(
        &self,
        agent: &MacroUserIdStr<'_>,
        _: MessagePage,
    ) -> Result<MessageList, AgentMailboxError> {
        self.record(format!("list {agent}"));
        Ok(MessageList {
            messages: vec![],
            next_cursor: None,
        })
    }
    async fn read_message(
        &self,
        agent: &MacroUserIdStr<'_>,
        message: &ProviderMessageId,
    ) -> Result<MailMessage, AgentMailboxError> {
        self.record(format!("read {agent} {}", message.0));
        Err(AgentMailboxError::NotFound)
    }
    async fn send(
        &self,
        agent: &MacroUserIdStr<'_>,
        approval: OwnerApproval,
        _: Uuid,
        _: OutgoingMessage,
    ) -> Result<SentMessage, AgentMailboxError> {
        self.record(format!("send {agent} {approval:?}"));
        if approval == OwnerApproval(None) {
            return Err(AgentMailboxError::ConfirmationRequired);
        }
        if self.send_limit {
            return Err(AgentMailboxError::SendLimit {
                retry_at: Utc::now() + chrono::Duration::minutes(10),
            });
        }
        Ok(sent())
    }
    async fn reply(
        &self,
        agent: &MacroUserIdStr<'_>,
        _: OwnerApproval,
        message: &ProviderMessageId,
        _: Uuid,
        _: ReplyMessage,
    ) -> Result<SentMessage, AgentMailboxError> {
        self.record(format!("reply {agent} {}", message.0));
        Ok(sent())
    }
}

#[derive(Clone, Default)]
struct FakeAuthorization;

impl MacroAuthorizationService for FakeAuthorization {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if matches!(jwt, "agent-key" | "agent-run") {
            return Ok(UserContext {
                user_id: AGENT.to_owned(),
                fusion_user_id: "fusion-agent".to_owned(),
                organization_id: None,
                permissions: None,
            });
        }
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<macro_authorization::ValidatedCredential, Report<MacroAuthorizationError>> {
        let context = self.authorize(jwt).await?;
        let mut credential = macro_authorization::ValidatedCredential::session(context);
        credential.origin = macro_authorization::CredentialOrigin::MacroApiJwt;
        if jwt == "agent-run" {
            credential.identity.agent_id = Some(bot_id::MACRO_AI_BOT_ID);
        }
        Ok(credential)
    }

    async fn authorize_internal(
        &self,
        key: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if key == INTERNAL_KEY {
            return Ok(None);
        }
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

fn state(service: Arc<Recording>) -> AgentMailboxRouterState<Recording, FakeAuthorization> {
    AgentMailboxRouterState {
        service,
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuthorization)),
    }
}

fn agent_router_for(service: Arc<Recording>) -> Router {
    agent_mailbox_router(state(service))
}

fn internal_router_for(service: Arc<Recording>) -> Router {
    internal_agent_mailbox_router(state(service))
}

fn send_request(bearer: &str, confirmation: Option<&str>) -> Request<Body> {
    let body = serde_json::json!({
        "idempotencyKey": Uuid::from_u128(5),
        "to": ["person@example.com"],
        "subject": "Hi",
        "textBody": "Hello",
        "confirmation": confirmation,
    });
    Request::post("/messages")
        .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn json_body(response: Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn the_agent_sees_its_own_mailbox_labelled_as_a_fake_vendor() {
    let service = Arc::new(Recording::default());

    let response = agent_router_for(service.clone())
        .oneshot(
            Request::get("/")
                .header(header::AUTHORIZATION, "Bearer agent-key")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["address"], "ada@example.net");
    assert_eq!(body["vendorMode"], "fake");
    assert_eq!(body["notice"], FAKE_VENDOR_NOTICE);
    assert_eq!(service.calls(), vec![format!("status {AGENT}")]);
}

#[tokio::test]
async fn every_send_carries_its_quoted_approval_to_the_service() {
    let service = Arc::new(Recording::default());

    let refused = agent_router_for(service.clone())
        .oneshot(send_request("agent-key", None))
        .await
        .unwrap();
    let confirmed = agent_router_for(service.clone())
        .oneshot(send_request("agent-run", Some("yes, send it")))
        .await
        .unwrap();

    assert_eq!(refused.status(), StatusCode::FORBIDDEN);
    assert_eq!(json_body(refused).await["code"], "confirmation_required");
    assert_eq!(confirmed.status(), StatusCode::CREATED);
    assert_eq!(
        service.calls(),
        vec![
            format!("send {AGENT} OwnerApproval(None)"),
            format!("send {AGENT} OwnerApproval(Some(\"yes, send it\"))"),
        ]
    );
}

#[tokio::test]
async fn a_malformed_message_id_never_reaches_the_service() {
    let service = Arc::new(Recording::default());

    let response = agent_router_for(service.clone())
        .oneshot(
            Request::get("/messages/..%2Fother")
                .header(header::AUTHORIZATION, "Bearer agent-key")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn a_full_send_cap_answers_429_with_retry_after() {
    let service = Arc::new(Recording {
        send_limit: true,
        ..Recording::default()
    });

    let response = agent_router_for(service)
        .oneshot(send_request("agent-key", Some("yes")))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(response.headers().contains_key(header::RETRY_AFTER));
    let body = json_body(response).await;
    assert_eq!(body["code"], "send_limit");
    assert!(body["retryAt"].is_string());
}

#[tokio::test]
async fn a_message_outside_the_mailbox_is_not_found() {
    let service = Arc::new(Recording::default());

    let response = agent_router_for(service.clone())
        .oneshot(
            Request::get("/messages/m-other")
                .header(header::AUTHORIZATION, "Bearer agent-key")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(service.calls(), vec![format!("read {AGENT} m-other")]);
}

#[tokio::test]
async fn lifecycle_routes_admit_only_internal_callers() {
    let service = Arc::new(Recording::default());
    let path = format!("/{}/pause", urlencoding::encode(AGENT));

    let as_agent = internal_router_for(service.clone())
        .oneshot(
            Request::post(&path)
                .header(header::AUTHORIZATION, "Bearer agent-key")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let as_internal = internal_router_for(service.clone())
        .oneshot(
            Request::post(&path)
                .header(macro_authorization::INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert!(as_agent.status().is_client_error());
    assert_eq!(as_internal.status(), StatusCode::OK);
    assert_eq!(service.calls(), vec![format!("pause {AGENT}")]);
}

#[tokio::test]
async fn provisioning_rejects_a_malformed_local_part_before_the_service() {
    let service = Arc::new(Recording::default());
    let body = serde_json::json!({
        "requestId": Uuid::from_u128(1),
        "agentUserId": AGENT,
        "requestedLocalPart": "Not Valid",
    });

    let response = internal_router_for(service.clone())
        .oneshot(
            Request::post("/")
                .header(macro_authorization::INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(service.calls().is_empty());
}
