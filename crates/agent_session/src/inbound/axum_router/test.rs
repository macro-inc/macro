use super::*;
use crate::domain::model::SessionStatus;
use axum::body::Body;
use axum::http::{Request, header};
use chrono::Utc;
use macro_authorization::{
    BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, BotActingUserClaims, BotAuthentication, BotAuthorizer,
    BotScope, InternalAuthConfig, JwtValidator, MacroAuthorizationError,
    MacroAuthorizationServiceImpl, ValidatedIdentity,
};
use rootcause::Report;
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

const BOT_TOKEN: &str = "mbot_self_test";
const OWNER: &str = "macro|owner@example.com";
const STRANGER: &str = "macro|stranger@example.com";

#[derive(Clone, Default)]
struct FakeJwtValidator;

impl JwtValidator for FakeJwtValidator {
    fn validate(&self, jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        Ok(ValidatedIdentity {
            user_id: jwt.to_string(),
            fusion_user_id: "fusion-user".to_string(),
            organization_id: None,
            permissions: None,
        })
    }
}

/// Accepts exactly [`BOT_TOKEN`] as [`BotId::TEST_A`].
#[derive(Clone)]
struct SelfBotAuthorizer;

impl BotAuthorizer for SelfBotAuthorizer {
    async fn authorize_bot(
        &self,
        bot_token: &str,
        bot_scope: BotScope,
        _acting_user: Option<BotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        if bot_token != BOT_TOKEN {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(BotAuthentication {
            bot_id: BotId::TEST_A,
            token_id: Uuid::new_v4(),
            bot_scope,
            team_id: None,
            acting_user: None,
        })
    }
}

/// Records opens and answers with a canned session row.
#[derive(Default)]
struct RecordingOpener {
    opened: Mutex<Vec<OpenExternalAgentSession>>,
    managed: Mutex<Vec<OpenManagedSession>>,
}

impl SessionOpener for RecordingOpener {
    async fn open_external_session(
        &self,
        request: OpenExternalAgentSession,
    ) -> crate::domain::error::Result<AgentSession> {
        let session = AgentSession {
            id: AgentSessionId::TEST_A,
            name: crate::domain::model::DEFAULT_AGENT_SESSION_NAME.to_owned(),
            owner_id: request.owner.clone(),
            thread_id: request.thread.as_ref().map(|thread| thread.thread_id),
            thread_channel_id: request.thread.as_ref().map(|thread| thread.channel_id),
            originating_message_id: request.thread.as_ref().map(|thread| thread.message_id),
            bot_id: request.bot_id,
            model: "claude".to_owned(),
            harness: "opencode".to_owned(),
            repo_url: request.repo_url.clone(),
            workspace: request.workspace.clone(),
            sandbox_size: crate::domain::model::SandboxSize::Default,
            instructions: request.instructions.clone(),
            acp_session_id: None,
            external: None,
            status: SessionStatus::NoMessages,
            created_at: Utc::now(),
            modified_at: Utc::now(),
        };
        self.opened.lock().unwrap().push(request);
        Ok(session)
    }

    async fn open_managed_session(
        &self,
        request: OpenManagedSession,
    ) -> crate::domain::error::Result<AgentSession> {
        let session = AgentSession {
            id: AgentSessionId::TEST_A,
            name: crate::domain::model::DEFAULT_AGENT_SESSION_NAME.to_owned(),
            owner_id: request.owner.clone(),
            thread_id: None,
            thread_channel_id: None,
            originating_message_id: None,
            bot_id: BotId::TEST_A,
            model: "claude".to_owned(),
            harness: "opencode".to_owned(),
            repo_url: Some("https://github.com/macro-inc/macro".to_owned()),
            workspace: crate::MANAGED_CONTAINER_WORKSPACE.to_owned(),
            sandbox_size: crate::domain::model::SandboxSize::Default,
            instructions: request.instructions.clone(),
            acp_session_id: None,
            external: None,
            status: SessionStatus::NoMessages,
            created_at: Utc::now(),
            modified_at: Utc::now(),
        };
        self.managed.lock().unwrap().push(request);
        Ok(session)
    }

    async fn find_thread_session(
        &self,
        _thread_id: Uuid,
        _bot_id: BotId,
    ) -> crate::domain::error::Result<Option<AgentSessionId>> {
        Ok(None)
    }
}

/// Serves one canned bot: [`BotId::TEST_A`], an external agent bot owned by
/// [`OWNER`]. Every other id is unknown.
struct OneBotDirectory {
    facts: BotFacts,
}

impl OneBotDirectory {
    fn external_agent() -> Self {
        Self {
            facts: BotFacts {
                has_agent: true,
                is_managed: false,
                owner_user_id: Some(MacroUserIdStr::try_from(OWNER.to_owned()).unwrap()),
            },
        }
    }

    fn managed_agent() -> Self {
        Self {
            facts: BotFacts {
                has_agent: true,
                is_managed: true,
                owner_user_id: None,
            },
        }
    }

    fn plain_bot() -> Self {
        Self {
            facts: BotFacts {
                has_agent: false,
                is_managed: false,
                owner_user_id: Some(MacroUserIdStr::try_from(OWNER.to_owned()).unwrap()),
            },
        }
    }
}

impl BotDirectory for OneBotDirectory {
    async fn bot_facts(&self, bot: BotId) -> crate::domain::error::Result<Option<BotFacts>> {
        Ok((bot == BotId::TEST_A).then(|| self.facts.clone()))
    }
}

fn router_for(opener: Arc<RecordingOpener>, bots: OneBotDirectory) -> Router {
    let service = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: "test-internal-key".to_string(),
            default_user_id: None,
        },
        SelfBotAuthorizer,
    );
    agent_session_create_router(CreateSessionState::new(
        opener,
        Arc::new(bots),
        MacroAuthorizationState::new(Arc::new(service)),
    ))
}

fn router(opener: Arc<RecordingOpener>) -> Router {
    router_for(opener, OneBotDirectory::external_agent())
}

fn body(bot_id: Option<Uuid>, workspace: &str, owner: Option<&str>) -> String {
    serde_json::json!({
        "botId": bot_id,
        "workspace": workspace,
        "owner": owner,
        "thread": {
            "channelId": "00000000-0000-0000-0000-000000000001",
            "messageId": "00000000-0000-0000-0000-000000000002",
            "content": "fix the flaky test",
        },
    })
    .to_string()
}

fn as_bot(request_body: String) -> Request<Body> {
    Request::post("/")
        .header(header::CONTENT_TYPE, "application/json")
        .header(BOT_TOKEN_HEADER, BOT_TOKEN)
        .header(BOT_SCOPE_HEADER, "user")
        .body(Body::from(request_body))
        .unwrap()
}

fn as_user(user: &str, request_body: String) -> Request<Body> {
    Request::post("/")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {user}"))
        .body(Body::from(request_body))
        .unwrap()
}

#[tokio::test]
async fn a_bot_opens_an_external_session_for_itself() {
    let opener = Arc::new(RecordingOpener::default());
    let request = as_bot(body(None, "/home/wolf/code", Some(OWNER)));

    let response = router(opener.clone()).oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let payload: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(payload["session"]["workspace"], "/home/wolf/code");

    let opened = opener.opened.lock().unwrap();
    assert_eq!(opened.len(), 1);
    assert_eq!(opened[0].bot_id, BotId::TEST_A);
    assert_eq!(opened[0].workspace, "/home/wolf/code");
    // A top-level mention roots its own thread.
    let thread = opened[0].thread.as_ref().expect("thread linkage was given");
    assert_eq!(thread.thread_id, thread.message_id);
    assert_eq!(thread.content, "fix the flaky test");
}

#[tokio::test]
async fn a_session_may_have_no_thread_at_all() {
    let opener = Arc::new(RecordingOpener::default());
    let request =
        as_bot(serde_json::json!({ "workspace": "/srv/agent", "owner": OWNER }).to_string());

    let response = router(opener.clone()).oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    assert!(opener.opened.lock().unwrap()[0].thread.is_none());
}

#[tokio::test]
async fn the_owner_opens_a_session_for_their_bot() {
    let opener = Arc::new(RecordingOpener::default());
    let request = as_user(
        OWNER,
        body(Some(BotId::TEST_A.as_uuid()), "/srv/agent", None),
    );

    let response = router(opener.clone()).oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    // The caller owns their own session; no claimed owner needed.
    let opened = opener.opened.lock().unwrap();
    assert_eq!(opened[0].owner.as_ref(), OWNER);
}

#[tokio::test]
async fn a_stranger_may_not_open_sessions_for_someone_elses_bot() {
    let opener = Arc::new(RecordingOpener::default());
    let request = as_user(
        STRANGER,
        body(Some(BotId::TEST_A.as_uuid()), "/srv/agent", None),
    );

    let response = router(opener.clone()).oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert!(opener.opened.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_bot_may_not_name_another_bot() {
    let opener = Arc::new(RecordingOpener::default());
    let request = as_bot(body(
        Some(BotId::TEST_B.as_uuid()),
        "/srv/agent",
        Some(OWNER),
    ));

    let response = router(opener.clone()).oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert!(opener.opened.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_user_caller_must_name_a_bot() {
    let opener = Arc::new(RecordingOpener::default());
    let request = as_user(OWNER, body(None, "/srv/agent", None));

    let response = router(opener.clone()).oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(opener.opened.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_bot_caller_must_claim_an_owner() {
    let opener = Arc::new(RecordingOpener::default());
    let request = as_bot(body(None, "/srv/agent", None));

    let response = router(opener.clone()).oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(opener.opened.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_relative_workspace_is_rejected() {
    let opener = Arc::new(RecordingOpener::default());
    let request = as_bot(body(None, "code/agent", Some(OWNER)));

    let response = router(opener.clone()).oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(opener.opened.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_managed_bots_sessions_are_not_openable_here() {
    let opener = Arc::new(RecordingOpener::default());
    let request = as_bot(body(None, "/srv/agent", Some(OWNER)));

    let response = router_for(opener.clone(), OneBotDirectory::managed_agent())
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(opener.opened.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_bot_without_an_agent_is_rejected() {
    let opener = Arc::new(RecordingOpener::default());
    let request = as_bot(body(None, "/srv/agent", Some(OWNER)));

    let response = router_for(opener.clone(), OneBotDirectory::plain_bot())
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(opener.opened.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_unauthenticated_request_is_rejected() {
    let opener = Arc::new(RecordingOpener::default());
    let request = Request::post("/")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body(None, "/srv/agent", Some(OWNER))))
        .unwrap();

    let response = router(opener.clone()).oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(opener.opened.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_unknown_bot_is_a_404() {
    let opener = Arc::new(RecordingOpener::default());
    let request = as_user(
        OWNER,
        body(Some(BotId::TEST_B.as_uuid()), "/srv/agent", None),
    );

    let response = router(opener.clone()).oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert!(opener.opened.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_session_whose_runtime_is_gone_is_a_409() {
    let error =
        AgentSessionApiError::Domain(AgentSessionError::Disconnected(AgentSessionId::new()));

    let response = error.into_response();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(
        body.as_ref(),
        b"the agent's runtime is not connected to this session"
    );
}

#[test]
fn other_domain_failures_stay_500() {
    let error = AgentSessionApiError::Domain(AgentSessionError::UnknownOwner);

    let response = error.into_response();

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

/// Instructions on a managed open reach the opener verbatim.
#[tokio::test]
async fn a_managed_open_carries_its_instructions() {
    const INSTRUCTIONS: &str = "Answer in one sentence.";

    let opener = Arc::new(RecordingOpener::default());
    let request = as_user(
        OWNER,
        serde_json::json!({ "prompt": "fix it", "instructions": INSTRUCTIONS }).to_string(),
    );

    let response = router(opener.clone()).oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let managed = opener.managed.lock().unwrap();
    assert_eq!(
        managed
            .iter()
            .map(|open| open.instructions.as_deref())
            .collect::<Vec<_>>(),
        vec![Some(INSTRUCTIONS)]
    );
}

/// Whitespace-only instructions are absence stated clumsily, and are
/// normalized away rather than stored as a section a runtime would splice in
/// empty.
#[tokio::test]
async fn blank_instructions_are_normalized_to_none() {
    let opener = Arc::new(RecordingOpener::default());
    let request = as_user(
        OWNER,
        serde_json::json!({ "prompt": "fix it", "instructions": "   \n  " }).to_string(),
    );

    let response = router(opener.clone()).oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(opener.managed.lock().unwrap()[0].instructions, None);
}

/// An external open records instructions too. Nothing on that side reads them
/// yet, but the row is the durable statement of what the session was opened
/// with, so dropping them here would lose the fact rather than defer it.
#[tokio::test]
async fn an_external_open_carries_its_instructions() {
    const INSTRUCTIONS: &str = "Never force-push.";

    let opener = Arc::new(RecordingOpener::default());
    let mut request_body: serde_json::Value =
        serde_json::from_str(&body(None, "/home/wolf/code", Some(OWNER))).unwrap();
    request_body["instructions"] = serde_json::json!(INSTRUCTIONS);
    let request = as_bot(request_body.to_string());

    let response = router(opener.clone()).oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(
        opener.opened.lock().unwrap()[0].instructions.as_deref(),
        Some(INSTRUCTIONS)
    );
}
