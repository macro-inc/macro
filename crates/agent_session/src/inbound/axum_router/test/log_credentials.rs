use super::*;
use crate::domain::model::{
    AgentSessionLog, CreateAgentSessionParams, Message, ReplicaId, SandboxSize,
};
use crate::domain::ports::{
    AgentSessionRepo, NoOpAgentSessionNameGenerator, NoOpRealtime, NoOpTurnObserver,
    NoopLifecyclePublisher,
};
use crate::domain::service::AgentSessionServiceImpl;
use crate::testing::InMemoryAgentSessionRepo;
use agent_runtime_protocol::domain::schema::v0::ToRuntimeMessage;
use entity_access::domain::models::{
    AccessError, AccessLevel, BotAccessScope, CallChannelInfo, EntityAccessReceipt,
    EntityPermission, EntityType, RequiredPermission, TeamRole, UserTeamInfo,
};
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};

const CREDENTIAL: &str = "Bearer placeholder-session-credential";

/// A public link or share: everyone who asks can view, and nothing more.
#[derive(Clone, Copy)]
struct ViewerGrant;

impl EntityAccessService for ViewerGrant {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(AccessError::internal(
            "entity access service not configured",
        ))
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(AccessError::internal(
            "entity access service not configured",
        ))
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Err(AccessError::internal(
            "entity access service not configured",
        ))
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::internal(
            "entity access service not configured",
        ))
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::internal(
            "entity access service not configured",
        ))
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        Ok(EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        })
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        Err(AccessError::internal(
            "entity access service not configured",
        ))
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Err(AccessError::internal(
            "entity access service not configured",
        ))
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::internal(
            "entity access service not configured",
        ))
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::internal(
            "entity access service not configured",
        ))
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        Ok(None)
    }
}

/// A log holding one frame of each session-opening method, every server
/// transport carrying what the harness hands an agent.
fn opening_frames() -> Vec<AgentSessionLog> {
    ["session/new", "session/load", "session/resume"]
        .into_iter()
        .enumerate()
        .map(|(id, method)| AgentSessionLog {
            agent_session_id: AgentSessionId::TEST_A,
            user_id: None,
            content: Message::ToRuntime(
                serde_json::from_value::<ToRuntimeMessage>(serde_json::json!({
                    "type": "acp",
                    "jsonrpc": "2.0",
                    "id": id,
                    "method": method,
                    "params": {
                        "sessionId": "acp-session",
                        "cwd": "/workspace",
                        "mcpServers": [{
                            "type": "http",
                            "name": "macro_internal",
                            "url": "https://egress.example.com/mcp/internal",
                            "headers": [{"name": "Authorization", "value": CREDENTIAL}],
                        }],
                    },
                }))
                .unwrap(),
            ),
            logged_at: None,
        })
        .collect()
}

async fn router_for_viewer() -> Router {
    let repo = InMemoryAgentSessionRepo::new();
    repo.extend_log(opening_frames());
    repo.create(CreateAgentSessionParams {
        origin: trigger_context::TriggerOrigin::Unknown,
        purpose: crate::domain::model::SessionPurpose::Standalone,
        repo_branch: None,
        id: AgentSessionId::TEST_A,
        owner_id: Owner::User(MacroUserIdStr::try_from(OWNER.to_owned()).unwrap()),
        bot_id: BotId::TEST_A,
        thread_id: None,
        originating_message_id: None,
        model: "codex".into(),
        harness: "codex-cloud".into(),
        repo_url: None,
        workspace: String::new(),
        sandbox_size: SandboxSize::Default,
        instructions: None,
        mcp_servers: Default::default(),
        egress_token_hash: None,
    })
    .await
    .unwrap();
    let auth = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: "test-internal-key".into(),
            default_user_id: None,
        },
        SelfBotAuthorizer,
        NoUserApiKeyAuthorizer,
    );
    agent_session_read_router(AgentSessionRouterState::new(
        AgentSessionServiceImpl::new(
            repo.clone(),
            agent_fold::domain::service::FoldedMessageService::new(repo),
            NoOpRealtime,
            NoOpAgentSessionNameGenerator,
            Arc::new(NoOpTurnObserver),
            Arc::new(NoopLifecyclePublisher),
            ReplicaId::mint(),
        ),
        Arc::new(ViewerGrant),
        MacroAuthorizationState::new(Arc::new(auth)),
    ))
}

async fn log_as(viewer: Option<&str>) -> String {
    let mut request = Request::builder().uri(format!("/{}/log", AgentSessionId::TEST_A));
    if let Some(viewer) = viewer {
        request = request.header(header::AUTHORIZATION, format!("Bearer {viewer}"));
    }
    let response = router_for_viewer()
        .await
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    String::from_utf8(body.to_vec()).unwrap()
}

#[tokio::test]
async fn a_public_link_viewer_reads_no_credential_from_the_log() {
    let log = log_as(None).await;

    assert!(log.contains("session/new"), "the frames are still served");
    assert!(!log.contains(CREDENTIAL));
}

#[tokio::test]
async fn a_signed_in_viewer_who_is_not_the_owner_reads_no_credential_from_the_log() {
    let log = log_as(Some(STRANGER)).await;

    assert!(
        log.contains("session/resume"),
        "the frames are still served"
    );
    assert!(!log.contains(CREDENTIAL));
}
