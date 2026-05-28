use super::*;
use crate::domain::models::AuthenticatedBot;
use axum::{
    Extension,
    body::Body,
    http::{Request, StatusCode},
};
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, CallChannelInfo, EntityPermission, EntityType,
        ParticipantRole as EntityParticipantRole, RequiredPermission, UserTeamInfo,
    },
    ports::EntityAccessService,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use model_user::UserContext;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tower::ServiceExt;

#[derive(Clone, Copy)]
enum TestBotMode {
    Ok,
    Unauthorized,
}

#[derive(Clone)]
struct TestBotService {
    mode: TestBotMode,
    add_calls: Arc<AtomicUsize>,
    remove_calls: Arc<AtomicUsize>,
}

impl TestBotService {
    fn new(mode: TestBotMode) -> Self {
        Self {
            mode,
            add_calls: Arc::new(AtomicUsize::new(0)),
            remove_calls: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn result(&self) -> Result<(), BotError> {
        match self.mode {
            TestBotMode::Ok => Ok(()),
            TestBotMode::Unauthorized => Err(BotError::Unauthorized),
        }
    }
}

impl BotService for TestBotService {
    async fn create_bot(
        &self,
        _caller: MacroUserIdStr<'static>,
        _req: CreateBotRequest,
    ) -> Result<Bot, BotError> {
        unimplemented!()
    }

    async fn list_bots(&self, _caller: MacroUserIdStr<'static>) -> Result<Vec<Bot>, BotError> {
        unimplemented!()
    }

    async fn get_bot(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
    ) -> Result<Bot, BotError> {
        unimplemented!()
    }

    async fn patch_bot(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
        _req: PatchBotRequest,
    ) -> Result<Bot, BotError> {
        unimplemented!()
    }

    async fn delete_bot(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
    ) -> Result<(), BotError> {
        unimplemented!()
    }

    async fn add_bot_to_channel(
        &self,
        _caller: MacroUserIdStr<'static>,
        _channel_id: Uuid,
        _bot_id: BotId,
    ) -> Result<(), BotError> {
        self.add_calls.fetch_add(1, Ordering::SeqCst);
        self.result()
    }

    async fn remove_bot_from_channel(
        &self,
        _caller: MacroUserIdStr<'static>,
        _channel_id: Uuid,
        _bot_id: BotId,
    ) -> Result<(), BotError> {
        self.remove_calls.fetch_add(1, Ordering::SeqCst);
        self.result()
    }

    async fn list_channel_bots(&self, _channel_id: Uuid) -> Result<Vec<Bot>, BotError> {
        unimplemented!()
    }

    async fn create_token(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
        _req: CreateBotTokenRequest,
    ) -> Result<CreateBotTokenResponse, BotError> {
        unimplemented!()
    }

    async fn list_tokens(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
    ) -> Result<Vec<BotToken>, BotError> {
        unimplemented!()
    }

    async fn revoke_token(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
        _token_id: Uuid,
    ) -> Result<(), BotError> {
        unimplemented!()
    }

    async fn authenticate_token(&self, _token: &str) -> Result<AuthenticatedBot, BotError> {
        unimplemented!()
    }
}

#[derive(Clone, Copy)]
struct TestAccessService {
    role: EntityParticipantRole,
}

impl TestAccessService {
    const fn new(role: EntityParticipantRole) -> Self {
        Self { role }
    }
}

impl EntityAccessService for TestAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unimplemented!()
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        unimplemented!()
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unimplemented!()
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unimplemented!()
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        Ok(EntityPermission::ChannelRole { role: self.role })
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        unimplemented!()
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unimplemented!()
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unimplemented!()
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        unimplemented!()
    }
}

fn user_extension() -> Extension<UserContext> {
    Extension(UserContext {
        user_id: "macro|bot-admin@example.com".to_string(),
        fusion_user_id: "fusion-user".to_string(),
        permissions: None,
        organization_id: None,
    })
}

fn router(service: TestBotService, role: EntityParticipantRole) -> Router {
    bots_router(BotsRouterState::new(service, TestAccessService::new(role))).layer(user_extension())
}

#[tokio::test]
async fn channel_member_cannot_add_bot_to_channel() {
    let service = TestBotService::new(TestBotMode::Ok);
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::from_uuid(Uuid::new_v4());
    let request = Request::builder()
        .method("POST")
        .uri(format!("/channels/{channel_id}/bots"))
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::json!({ "bot_id": bot_id }).to_string(),
        ))
        .unwrap();

    let response = router(service.clone(), EntityParticipantRole::Member)
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.add_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn channel_admin_still_needs_bot_usability_to_add_bot() {
    let service = TestBotService::new(TestBotMode::Unauthorized);
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::from_uuid(Uuid::new_v4());
    let request = Request::builder()
        .method("POST")
        .uri(format!("/channels/{channel_id}/bots"))
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::json!({ "bot_id": bot_id }).to_string(),
        ))
        .unwrap();

    let response = router(service.clone(), EntityParticipantRole::Admin)
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.add_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn channel_member_cannot_remove_bot_from_channel() {
    let service = TestBotService::new(TestBotMode::Ok);
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::from_uuid(Uuid::new_v4());
    let request = Request::builder()
        .method("DELETE")
        .uri(format!("/channels/{channel_id}/bots/{bot_id}"))
        .body(Body::empty())
        .unwrap();

    let response = router(service.clone(), EntityParticipantRole::Member)
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.remove_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn channel_admin_still_needs_bot_usability_to_remove_bot() {
    let service = TestBotService::new(TestBotMode::Unauthorized);
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::from_uuid(Uuid::new_v4());
    let request = Request::builder()
        .method("DELETE")
        .uri(format!("/channels/{channel_id}/bots/{bot_id}"))
        .body(Body::empty())
        .unwrap();

    let response = router(service.clone(), EntityParticipantRole::Admin)
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.remove_calls.load(Ordering::SeqCst), 1);
}
