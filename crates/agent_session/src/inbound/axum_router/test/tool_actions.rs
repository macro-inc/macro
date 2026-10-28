use super::*;
use crate::domain::error::Result as SessionResult;
use crate::domain::ports::{AcceptedControl, QueuedControl};
use entity_access::domain::models::{
    AccessError, AccessLevel, BotAccessScope, CallChannelInfo, EntityAccessReceipt,
    EntityPermission, EntityType, RequiredPermission, TeamRole, UserTeamInfo,
};
use macro_authorization::{INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use shared_entity_registry::OwnedPurgeOutcome;

#[derive(Default)]
struct Controls {
    deleted: Mutex<Vec<AgentSessionId>>,
    controls: Mutex<Vec<(AgentSessionId, Option<MacroUserIdStr<'static>>)>>,
}
impl AgentSessionNotificationRecipient for Controls {
    async fn purge_owned_session(
        &self,
        _: AgentSessionId,
        _: &Owner,
    ) -> SessionResult<OwnedPurgeOutcome> {
        unreachable!()
    }
    async fn delete_user_sessions(&self, _: MacroUserIdStr<'static>) -> SessionResult<()> {
        unreachable!()
    }
    async fn session_deleted(&self, id: AgentSessionId) -> SessionResult<()> {
        self.deleted.lock().unwrap().push(id);
        Ok(())
    }
    async fn control_event(
        &self,
        id: AgentSessionId,
        event: ControlEvent,
    ) -> SessionResult<AcceptedControl> {
        self.controls.lock().unwrap().push((id, event.actor));
        Ok(AcceptedControl {
            action_id: AgentActionId::mint(),
            disposition: crate::domain::ports::ControlDisposition::Sent,
        })
    }
    async fn queued_controls(&self, _: AgentSessionId) -> SessionResult<Vec<QueuedControl>> {
        unreachable!()
    }
    async fn edit_queued_control(
        &self,
        _: AgentSessionId,
        _: AgentActionId,
        _: String,
        _: Option<MacroUserIdStr<'static>>,
    ) -> SessionResult<()> {
        unreachable!()
    }
    async fn remove_queued_control(
        &self,
        _: AgentSessionId,
        _: AgentActionId,
        _: Option<MacroUserIdStr<'static>>,
    ) -> SessionResult<()> {
        unreachable!()
    }
    async fn steer_queued_control(
        &self,
        _: AgentSessionId,
        _: AgentActionId,
        _: Option<MacroUserIdStr<'static>>,
    ) -> SessionResult<()> {
        unreachable!()
    }
    async fn set_sandbox_size(&self, _: AgentSessionId, _: SandboxSize) -> SessionResult<()> {
        unreachable!()
    }
    async fn session_harness(
        &self,
        _: AgentSessionId,
    ) -> SessionResult<Option<harness_id::HarnessId>> {
        unreachable!()
    }
}

#[derive(Clone)]
struct FakeEntityAccessService {
    access_level: Option<AccessLevel>,
}
impl EntityAccessService for FakeEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        panic!("unexpected generate_entity_access_receipt call")
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        bot_id: BotId,
        scope: BotAccessScope,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        let _ = (bot_id, scope, entity_id, entity_type);
        unreachable!()
    }

    async fn get_access_level(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        assert_eq!(user_id.unwrap().as_ref(), OWNER);
        assert_eq!(entity_id, AgentSessionId::TEST_A.to_string());
        assert_eq!(entity_type, EntityType::AgentSession);
        Ok(self.access_level)
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        panic!("unexpected check_access call")
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        panic!("unexpected check_public_access call")
    }

    async fn get_entity_permission(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        let access_level = self
            .get_access_level(user_id, entity_id, entity_type)
            .await?
            .ok_or(AccessError::Unauthorized)?;
        Ok(EntityPermission::AccessLevel { access_level })
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        panic!("unexpected get_crm_entity_permission_with_team call")
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        panic!("unexpected get_users_by_entity call")
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected get_call_channel call")
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected get_call_channel_by_channel_id call")
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        panic!("unexpected get_user_team call")
    }
}

async fn request(
    controls: Arc<Controls>,
    level: AccessLevel,
    method: &str,
    suffix: &str,
    key: bool,
    user: bool,
    body: serde_json::Value,
) -> StatusCode {
    let auth = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: "test-key".into(),
            default_user_id: None,
        },
        SelfBotAuthorizer,
        NoUserApiKeyAuthorizer,
    );
    let router = super::super::tool_actions::agent_session_tool_actions_router(
        AgentSessionControlState::new(
            controls,
            Arc::new(FakeEntityAccessService {
                access_level: Some(level),
            }),
            MacroAuthorizationState::new(Arc::new(auth)),
        ),
    );
    let mut req = Request::builder()
        .method(method)
        .uri(format!(
            "/internal/agent-sessions/{}{suffix}",
            AgentSessionId::TEST_A
        ))
        .header("content-type", "application/json");
    if key {
        req = req.header(INTERNAL_API_KEY_HEADER, "test-key");
    }
    if user {
        req = req.header(INTERNAL_MACRO_USER_ID_HEADER, OWNER);
    }
    router
        .oneshot(req.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn internal_actions_require_user_identity_and_sufficient_entity_access() {
    let controls = Arc::new(Controls::default());
    for (key, user) in [(false, false), (false, true), (true, false)] {
        assert_eq!(
            request(
                controls.clone(),
                AccessLevel::Owner,
                "DELETE",
                "",
                key,
                user,
                serde_json::Value::Null
            )
            .await,
            StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        request(
            controls.clone(),
            AccessLevel::Edit,
            "DELETE",
            "",
            true,
            true,
            serde_json::Value::Null
        )
        .await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(
            controls.clone(),
            AccessLevel::View,
            "POST",
            "/control",
            true,
            true,
            serde_json::json!({"type":"stop"})
        )
        .await,
        StatusCode::UNAUTHORIZED
    );
    assert!(controls.deleted.lock().unwrap().is_empty());
    assert!(controls.controls.lock().unwrap().is_empty());
    assert_eq!(
        request(
            controls.clone(),
            AccessLevel::Owner,
            "DELETE",
            "",
            true,
            true,
            serde_json::Value::Null
        )
        .await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(*controls.deleted.lock().unwrap(), [AgentSessionId::TEST_A]);
    assert_eq!(
        request(
            controls.clone(),
            AccessLevel::Edit,
            "POST",
            "/control",
            true,
            true,
            serde_json::json!({"type":"prompt","prompt":"Continue"})
        )
        .await,
        StatusCode::OK
    );
    assert_eq!(
        *controls.controls.lock().unwrap(),
        [(
            AgentSessionId::TEST_A,
            Some(MacroUserIdStr::try_from(OWNER.to_owned()).unwrap())
        )]
    );
}

#[tokio::test]
async fn tools_cannot_approve_requests_or_supply_another_actor() {
    let controls = Arc::new(Controls::default());
    for body in [
        serde_json::json!({"type":"respondToPermission"}),
        serde_json::json!({"type":"respondElicitation"}),
        serde_json::json!({"type":"prompt","prompt":"Hello","actor":STRANGER}),
    ] {
        assert_eq!(
            request(
                controls.clone(),
                AccessLevel::Owner,
                "POST",
                "/control",
                true,
                true,
                body
            )
            .await,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    assert!(controls.controls.lock().unwrap().is_empty());
}
