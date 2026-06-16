use super::*;
use crate::domain::models::{
    AuthenticatedBot, Bot, BotId, BotKind, BotOwner, BotToken, CreateBotRequest,
    CreateBotTokenRequest, CreateBotTokenResponse, PatchBotRequest,
};
use axum::{
    Extension, Router,
    body::Body,
    http::{Request, StatusCode},
};
use channels::domain::models::PostMessageResponse;
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
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use tower::ServiceExt;

#[derive(Clone)]
enum TestCreateMode {
    Ok(CreateChannelScopedBotResponse),
    Unauthorized,
}

#[derive(Clone)]
enum TestAuthMode {
    Ok {
        expected_channel_id: Uuid,
        expected_token: String,
        bot_id: BotId,
    },
    Unauthorized,
}

#[derive(Debug, Clone)]
struct CreateCall {
    caller: MacroUserIdStr<'static>,
    channel_id: Uuid,
}

#[derive(Debug, Clone)]
struct AuthCall {
    channel_id: Uuid,
    token: String,
}

#[derive(Clone)]
struct TestBotService {
    create_mode: TestCreateMode,
    auth_mode: TestAuthMode,
    create_calls: Arc<AtomicUsize>,
    auth_calls: Arc<AtomicUsize>,
    last_create: Arc<Mutex<Option<CreateCall>>>,
    last_auth: Arc<Mutex<Option<AuthCall>>>,
}

impl TestBotService {
    fn for_create(response: CreateChannelScopedBotResponse) -> Self {
        Self {
            create_mode: TestCreateMode::Ok(response),
            auth_mode: TestAuthMode::Unauthorized,
            create_calls: Arc::new(AtomicUsize::new(0)),
            auth_calls: Arc::new(AtomicUsize::new(0)),
            last_create: Arc::new(Mutex::new(None)),
            last_auth: Arc::new(Mutex::new(None)),
        }
    }

    fn for_webhook(channel_id: Uuid, token: &str, bot_id: BotId) -> Self {
        Self {
            create_mode: TestCreateMode::Unauthorized,
            auth_mode: TestAuthMode::Ok {
                expected_channel_id: channel_id,
                expected_token: token.to_string(),
                bot_id,
            },
            create_calls: Arc::new(AtomicUsize::new(0)),
            auth_calls: Arc::new(AtomicUsize::new(0)),
            last_create: Arc::new(Mutex::new(None)),
            last_auth: Arc::new(Mutex::new(None)),
        }
    }

    fn unauthorized_webhook() -> Self {
        Self {
            create_mode: TestCreateMode::Unauthorized,
            auth_mode: TestAuthMode::Unauthorized,
            create_calls: Arc::new(AtomicUsize::new(0)),
            auth_calls: Arc::new(AtomicUsize::new(0)),
            last_create: Arc::new(Mutex::new(None)),
            last_auth: Arc::new(Mutex::new(None)),
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

    async fn create_channel_scoped_bot(
        &self,
        caller: MacroUserIdStr<'static>,
        channel_id: Uuid,
        _req: CreateChannelScopedBotRequest,
    ) -> Result<CreateChannelScopedBotResponse, BotError> {
        self.create_calls.fetch_add(1, Ordering::SeqCst);
        *self.last_create.lock().expect("create call mutex poisoned") =
            Some(CreateCall { caller, channel_id });

        match &self.create_mode {
            TestCreateMode::Ok(response) => Ok(response.clone()),
            TestCreateMode::Unauthorized => Err(BotError::Unauthorized),
        }
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
        unimplemented!()
    }

    async fn remove_bot_from_channel(
        &self,
        _caller: MacroUserIdStr<'static>,
        _channel_id: Uuid,
        _bot_id: BotId,
    ) -> Result<(), BotError> {
        unimplemented!()
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

    async fn authenticate_channel_token(
        &self,
        channel_id: Uuid,
        token: &str,
    ) -> Result<AuthenticatedBot, BotError> {
        self.auth_calls.fetch_add(1, Ordering::SeqCst);
        *self.last_auth.lock().expect("auth call mutex poisoned") = Some(AuthCall {
            channel_id,
            token: token.to_string(),
        });

        match &self.auth_mode {
            TestAuthMode::Ok {
                expected_channel_id,
                expected_token,
                bot_id,
            } if channel_id == *expected_channel_id && token == expected_token => {
                Ok(AuthenticatedBot {
                    bot_id: *bot_id,
                    kind: BotKind::Owned,
                })
            }
            _ => Err(BotError::Unauthorized),
        }
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

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, uuid::Uuid), AccessError> {
        unimplemented!("channel webhook router tests do not support CRM entity access")
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

#[derive(Debug, Clone)]
struct PostedMessage {
    actor: Sender,
    channel_id: Uuid,
    req: PostMessageRequest,
}

#[derive(Clone, Copy)]
enum TestPostMode {
    Ok,
}

#[derive(Clone)]
struct TestChannelPoster {
    mode: TestPostMode,
    calls: Arc<Mutex<Vec<PostedMessage>>>,
}

impl TestChannelPoster {
    fn new() -> Self {
        Self {
            mode: TestPostMode::Ok,
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl ChannelMessagePoster for TestChannelPoster {
    fn post_message(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: PostMessageRequest,
    ) -> impl Future<Output = Result<PostMessageResponse, ChannelMutationErr>> + Send {
        let calls = self.calls.clone();
        let mode = self.mode;
        async move {
            calls
                .lock()
                .expect("posted message mutex poisoned")
                .push(PostedMessage {
                    actor,
                    channel_id,
                    req,
                });

            match mode {
                TestPostMode::Ok => Ok(PostMessageResponse {
                    id: Uuid::new_v4().to_string(),
                    nonce: None,
                }),
            }
        }
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

fn router(
    service: TestBotService,
    poster: TestChannelPoster,
    role: EntityParticipantRole,
) -> Router {
    channel_scoped_bot_router(ChannelBotWebhookRouterState::new(
        service,
        poster,
        TestAccessService::new(role),
    ))
    .layer(user_extension())
}

fn webhook_router(service: TestBotService, poster: TestChannelPoster) -> Router {
    channel_bot_webhook_router(ChannelBotWebhookRouterState::new(
        service,
        poster,
        TestAccessService::new(EntityParticipantRole::Member),
    ))
}

fn scoped_bot_response(bot_id: BotId) -> CreateChannelScopedBotResponse {
    let now = chrono::Utc::now();
    let bot_token = "mbot_test_1234".to_string();

    CreateChannelScopedBotResponse {
        bot: Bot {
            id: bot_id,
            kind: BotKind::Owned,
            owner: Some(BotOwner::User {
                user_id: "macro|bot-admin@example.com".to_string(),
            }),
            name: "Datadog Alerts".to_string(),
            handle: "datadog-alerts".to_string(),
            description: Some("Posts alarm notifications".to_string()),
            avatar_url: None,
            created_by: Some("macro|bot-admin@example.com".to_string()),
            created_at: now,
            updated_at: now,
            deleted_at: None,
        },
        token: BotToken {
            id: Uuid::new_v4(),
            bot_id,
            token: bot_token.clone(),
            label: Some("webhook".to_string()),
            last_used_at: None,
            expires_at: None,
            revoked_at: None,
            created_at: now,
        },
        bot_token,
    }
}

fn scoped_bot_request_body() -> Body {
    Body::from(
        serde_json::json!({
            "team_id": null,
            "name": "Datadog Alerts",
            "handle": "datadog-alerts",
            "description": "Posts alarm notifications",
            "avatar_url": null,
            "token_label": "webhook",
            "token_expires_at": null,
        })
        .to_string(),
    )
}

#[tokio::test]
async fn channel_webhook_router_member_cannot_create_scoped_bot() {
    let bot_id = BotId::from_uuid(Uuid::new_v4());
    let service = TestBotService::for_create(scoped_bot_response(bot_id));
    let poster = TestChannelPoster::new();
    let channel_id = Uuid::new_v4();
    let request = Request::builder()
        .method("POST")
        .uri(format!("/channels/{channel_id}/bots/scoped"))
        .header("content-type", "application/json")
        .body(scoped_bot_request_body())
        .unwrap();

    let response = router(service.clone(), poster, EntityParticipantRole::Member)
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.create_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn channel_webhook_router_admin_can_create_scoped_bot() {
    let bot_id = BotId::from_uuid(Uuid::new_v4());
    let service = TestBotService::for_create(scoped_bot_response(bot_id));
    let poster = TestChannelPoster::new();
    let channel_id = Uuid::new_v4();
    let request = Request::builder()
        .method("POST")
        .uri(format!("/channels/{channel_id}/bots/scoped"))
        .header("content-type", "application/json")
        .body(scoped_bot_request_body())
        .unwrap();

    let response = router(service.clone(), poster, EntityParticipantRole::Admin)
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(service.create_calls.load(Ordering::SeqCst), 1);

    let call = service
        .last_create
        .lock()
        .expect("create call mutex poisoned")
        .clone()
        .expect("create call recorded");
    assert_eq!(call.caller.as_ref(), "macro|bot-admin@example.com");
    assert_eq!(call.channel_id, channel_id);
}

#[tokio::test]
async fn channel_webhook_router_valid_json_posts_as_bot() {
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::from_uuid(Uuid::new_v4());
    let token = "mbot_test_valid";
    let service = TestBotService::for_webhook(channel_id, token, bot_id);
    let poster = TestChannelPoster::new();
    let request = Request::builder()
        .method("POST")
        .uri(format!("/channels/{channel_id}/webhook"))
        .header("content-type", "application/json")
        .header(CHANNEL_BOT_TOKEN_HEADER, token)
        .body(Body::from(
            serde_json::json!({ "content": "hello" }).to_string(),
        ))
        .unwrap();

    let response = webhook_router(service.clone(), poster.clone())
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(service.auth_calls.load(Ordering::SeqCst), 1);

    let auth_call = service
        .last_auth
        .lock()
        .expect("auth call mutex poisoned")
        .clone()
        .expect("auth call recorded");
    assert_eq!(auth_call.channel_id, channel_id);
    assert_eq!(auth_call.token, token);

    let calls = poster.calls.lock().expect("posted message mutex poisoned");
    assert_eq!(calls.len(), 1);
    let call = &calls[0];
    assert_eq!(call.actor, Sender::Bot(bot_id));
    assert_eq!(call.channel_id, channel_id);
    assert_eq!(call.req.content, "hello");
    assert!(call.req.mentions.is_empty());
    assert!(call.req.attachments.is_empty());
    assert!(call.req.thread_id.is_none());
    assert!(call.req.nonce.is_none());
}

#[tokio::test]
async fn channel_webhook_router_raw_body_starting_with_brace_posts_as_bot() {
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::from_uuid(Uuid::new_v4());
    let token = "mbot_test_valid";
    let content = "{raw alert payload";
    let service = TestBotService::for_webhook(channel_id, token, bot_id);
    let poster = TestChannelPoster::new();
    let request = Request::builder()
        .method("POST")
        .uri(format!("/channels/{channel_id}/webhook"))
        .header("content-type", "text/plain")
        .header(CHANNEL_BOT_TOKEN_HEADER, token)
        .body(Body::from(content))
        .unwrap();

    let response = webhook_router(service.clone(), poster.clone())
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(service.auth_calls.load(Ordering::SeqCst), 1);

    let calls = poster.calls.lock().expect("posted message mutex poisoned");
    assert_eq!(calls.len(), 1);
    let call = &calls[0];
    assert_eq!(call.actor, Sender::Bot(bot_id));
    assert_eq!(call.channel_id, channel_id);
    assert_eq!(call.req.content, content);
}

#[tokio::test]
async fn channel_webhook_router_invalid_token_returns_unauthorized_without_posting() {
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::from_uuid(Uuid::new_v4());
    let service = TestBotService::for_webhook(channel_id, "mbot_test_valid", bot_id);
    let poster = TestChannelPoster::new();
    let request = Request::builder()
        .method("POST")
        .uri(format!("/channels/{channel_id}/webhook"))
        .header("content-type", "application/json")
        .header(CHANNEL_BOT_TOKEN_HEADER, "mbot_test_invalid")
        .body(Body::from(
            serde_json::json!({ "content": "hello" }).to_string(),
        ))
        .unwrap();

    let response = webhook_router(service.clone(), poster.clone())
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.auth_calls.load(Ordering::SeqCst), 1);
    assert!(
        poster
            .calls
            .lock()
            .expect("posted message mutex poisoned")
            .is_empty()
    );
}

#[tokio::test]
async fn channel_webhook_router_missing_token_header_returns_unauthorized_without_posting() {
    let channel_id = Uuid::new_v4();
    let service = TestBotService::unauthorized_webhook();
    let poster = TestChannelPoster::new();
    let request = Request::builder()
        .method("POST")
        .uri(format!("/channels/{channel_id}/webhook"))
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::json!({ "content": "hello" }).to_string(),
        ))
        .unwrap();

    let response = webhook_router(service.clone(), poster.clone())
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.auth_calls.load(Ordering::SeqCst), 0);
    assert!(
        poster
            .calls
            .lock()
            .expect("posted message mutex poisoned")
            .is_empty()
    );
}

#[tokio::test]
async fn channel_webhook_router_wrong_channel_returns_unauthorized_without_posting() {
    let expected_channel_id = Uuid::new_v4();
    let requested_channel_id = Uuid::new_v4();
    let bot_id = BotId::from_uuid(Uuid::new_v4());
    let token = "mbot_test_valid";
    let service = TestBotService::for_webhook(expected_channel_id, token, bot_id);
    let poster = TestChannelPoster::new();
    let request = Request::builder()
        .method("POST")
        .uri(format!("/channels/{requested_channel_id}/webhook"))
        .header("content-type", "application/json")
        .header(CHANNEL_BOT_TOKEN_HEADER, token)
        .body(Body::from(
            serde_json::json!({ "content": "hello" }).to_string(),
        ))
        .unwrap();

    let response = webhook_router(service.clone(), poster.clone())
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.auth_calls.load(Ordering::SeqCst), 1);
    assert!(
        poster
            .calls
            .lock()
            .expect("posted message mutex poisoned")
            .is_empty()
    );
}

#[tokio::test]
async fn channel_webhook_router_revoked_token_auth_failure_returns_unauthorized() {
    let channel_id = Uuid::new_v4();
    let service = TestBotService::unauthorized_webhook();
    let poster = TestChannelPoster::new();
    let request = Request::builder()
        .method("POST")
        .uri(format!("/channels/{channel_id}/webhook"))
        .header("content-type", "application/json")
        .header(CHANNEL_BOT_TOKEN_HEADER, "mbot_test_revoked")
        .body(Body::from(
            serde_json::json!({ "content": "hello" }).to_string(),
        ))
        .unwrap();

    let response = webhook_router(service.clone(), poster.clone())
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.auth_calls.load(Ordering::SeqCst), 1);
    assert!(
        poster
            .calls
            .lock()
            .expect("posted message mutex poisoned")
            .is_empty()
    );
}

#[tokio::test]
async fn channel_webhook_router_empty_content_returns_bad_request_without_authenticating() {
    let channel_id = Uuid::new_v4();
    let service = TestBotService::unauthorized_webhook();
    let poster = TestChannelPoster::new();
    let request = Request::builder()
        .method("POST")
        .uri(format!("/channels/{channel_id}/webhook"))
        .header("content-type", "application/json")
        .header(CHANNEL_BOT_TOKEN_HEADER, "mbot_test_valid")
        .body(Body::from(
            serde_json::json!({ "content": "  \n\t" }).to_string(),
        ))
        .unwrap();

    let response = webhook_router(service.clone(), poster.clone())
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(service.auth_calls.load(Ordering::SeqCst), 0);
    assert!(
        poster
            .calls
            .lock()
            .expect("posted message mutex poisoned")
            .is_empty()
    );
}
