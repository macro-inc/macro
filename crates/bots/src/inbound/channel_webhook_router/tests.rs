use super::*;
use crate::domain::models::{
    AuthenticatedBot, Bot, BotChannel, BotKind, BotOwner, BotToken, CreateBotRequest,
    CreateBotTokenRequest, CreateBotTokenResponse, PatchBotRequest,
};
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use channels::domain::models::PostMessageResponse;
use entity_access::domain::models::TeamRole;
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, BotId, CallChannelInfo, EntityPermission, EntityType,
        ParticipantRole as EntityParticipantRole, RequiredPermission, UserTeamInfo,
    },
    ports::EntityAccessService,
};
use macro_authorization::{
    BOT_FOR_FUSIONAUTH_USER_ID_HEADER, BOT_FOR_MACRO_USER_ID_HEADER,
    BOT_FOR_ORGANIZATION_ID_HEADER, BOT_SCOPE_HEADER, BOT_TOKEN_HEADER,
    BotActingUserClaims as AuthorizationBotActingUserClaims, BotAuthentication, BotAuthorizer,
    BotScope, InternalAuthConfig, JwtValidator, MacroAuthorizationError,
    MacroAuthorizationServiceImpl, MacroAuthorizationState, MacroUserAuthentication,
    ValidatedIdentity,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use rootcause::Report;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use tower::ServiceExt;

const DEFAULT_BEARER_TOKEN: &str = "macro|bot-admin@example.com";

#[derive(Clone)]
enum TestCreateMode {
    Ok(CreateChannelScopedBotResponse),
    Unauthorized,
}

#[derive(Clone)]
enum TestLegacyAuthMode {
    Ok {
        expected_channel_id: Uuid,
        expected_token: String,
        bot_id: BotId,
    },
    Unauthorized,
}

#[derive(Clone)]
enum TestMembershipMode {
    Ok {
        expected_channel_id: Uuid,
        expected_bot_id: BotId,
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

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
struct MembershipCall {
    channel_id: Uuid,
    bot_id: BotId,
}

#[derive(Clone)]
struct TestBotService {
    create_mode: TestCreateMode,
    legacy_auth_mode: TestLegacyAuthMode,
    membership_mode: TestMembershipMode,
    create_calls: Arc<AtomicUsize>,
    auth_calls: Arc<AtomicUsize>,
    membership_calls: Arc<AtomicUsize>,
    last_create: Arc<Mutex<Option<CreateCall>>>,
    last_auth: Arc<Mutex<Option<AuthCall>>>,
    last_membership: Arc<Mutex<Option<MembershipCall>>>,
}

impl TestBotService {
    fn for_create(response: CreateChannelScopedBotResponse) -> Self {
        Self::new(
            TestCreateMode::Ok(response),
            TestLegacyAuthMode::Unauthorized,
            TestMembershipMode::Unauthorized,
        )
    }

    fn for_webhook(channel_id: Uuid, token: &str, bot_id: BotId) -> Self {
        Self::new(
            TestCreateMode::Unauthorized,
            TestLegacyAuthMode::Ok {
                expected_channel_id: channel_id,
                expected_token: token.to_string(),
                bot_id,
            },
            TestMembershipMode::Unauthorized,
        )
    }

    fn for_preferred_webhook(channel_id: Uuid, bot_id: BotId) -> Self {
        Self::new(
            TestCreateMode::Unauthorized,
            TestLegacyAuthMode::Unauthorized,
            TestMembershipMode::Ok {
                expected_channel_id: channel_id,
                expected_bot_id: bot_id,
            },
        )
    }

    fn unauthorized_webhook() -> Self {
        Self::new(
            TestCreateMode::Unauthorized,
            TestLegacyAuthMode::Unauthorized,
            TestMembershipMode::Unauthorized,
        )
    }

    fn new(
        create_mode: TestCreateMode,
        legacy_auth_mode: TestLegacyAuthMode,
        membership_mode: TestMembershipMode,
    ) -> Self {
        Self {
            create_mode,
            legacy_auth_mode,
            membership_mode,
            create_calls: Arc::new(AtomicUsize::new(0)),
            auth_calls: Arc::new(AtomicUsize::new(0)),
            membership_calls: Arc::new(AtomicUsize::new(0)),
            last_create: Arc::new(Mutex::new(None)),
            last_auth: Arc::new(Mutex::new(None)),
            last_membership: Arc::new(Mutex::new(None)),
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

    async fn list_bot_channels(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
    ) -> Result<Vec<BotChannel>, BotError> {
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

    async fn ensure_bot_in_channel(&self, bot_id: BotId, channel_id: Uuid) -> Result<(), BotError> {
        self.membership_calls.fetch_add(1, Ordering::SeqCst);
        *self
            .last_membership
            .lock()
            .expect("membership call mutex poisoned") = Some(MembershipCall { channel_id, bot_id });

        match self.membership_mode {
            TestMembershipMode::Ok {
                expected_channel_id,
                expected_bot_id,
            } if channel_id == expected_channel_id && bot_id == expected_bot_id => Ok(()),
            TestMembershipMode::Ok { .. } | TestMembershipMode::Unauthorized => {
                Err(BotError::Unauthorized)
            }
        }
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

        match &self.legacy_auth_mode {
            TestLegacyAuthMode::Ok {
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

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
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
    ) -> Result<(EntityPermission, uuid::Uuid, TeamRole), AccessError> {
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

#[derive(Clone)]
enum TestBotAuthorizationMode {
    Ok {
        expected_token: String,
        expected_claims: Option<AuthorizationBotActingUserClaims>,
        authentication: Box<BotAuthentication>,
    },
    Reject(MacroAuthorizationError),
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct BotAuthorizationCall {
    token: String,
    bot_scope: BotScope,
    claims: Option<AuthorizationBotActingUserClaims>,
}

#[derive(Clone)]
struct TestBotAuthorizer {
    mode: TestBotAuthorizationMode,
    calls: Arc<Mutex<Vec<BotAuthorizationCall>>>,
}

impl TestBotAuthorizer {
    fn authorized(
        token: &str,
        claims: Option<AuthorizationBotActingUserClaims>,
        authentication: BotAuthentication,
    ) -> Self {
        Self {
            mode: TestBotAuthorizationMode::Ok {
                expected_token: token.to_string(),
                expected_claims: claims,
                authentication: Box::new(authentication),
            },
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn rejecting(error: MacroAuthorizationError) -> Self {
        Self {
            mode: TestBotAuthorizationMode::Reject(error),
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn call_count(&self) -> usize {
        self.calls
            .lock()
            .expect("bot authorization calls mutex poisoned")
            .len()
    }
}

impl BotAuthorizer for TestBotAuthorizer {
    async fn authorize_bot(
        &self,
        bot_token: &str,
        bot_scope: BotScope,
        acting_user: Option<AuthorizationBotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        self.calls
            .lock()
            .expect("bot authorization calls mutex poisoned")
            .push(BotAuthorizationCall {
                token: bot_token.to_string(),
                bot_scope,
                claims: acting_user.clone(),
            });

        match &self.mode {
            TestBotAuthorizationMode::Ok {
                expected_token,
                expected_claims,
                authentication,
            } if bot_token == expected_token && acting_user == *expected_claims => {
                let mut authentication = authentication.as_ref().clone();
                authentication.bot_scope = bot_scope;
                Ok(authentication)
            }
            TestBotAuthorizationMode::Ok { .. } => {
                Err(Report::new(MacroAuthorizationError::InvalidCredentials))
            }
            TestBotAuthorizationMode::Reject(error) => Err(Report::new(*error)),
        }
    }
}

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

type TestAuthorizationService = MacroAuthorizationServiceImpl<FakeJwtValidator>;

fn authorization_state(
    bot_authorizer: TestBotAuthorizer,
) -> MacroAuthorizationState<TestAuthorizationService> {
    let service = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: "test-internal-key".to_string(),
            default_user_id: None,
        },
        bot_authorizer,
    );
    MacroAuthorizationState::new(Arc::new(service))
}

async fn attach_default_bearer(mut request: Request<Body>) -> Request<Body> {
    request.headers_mut().insert(
        header::AUTHORIZATION,
        format!("Bearer {DEFAULT_BEARER_TOKEN}").parse().unwrap(),
    );
    request
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
        authorization_state(TestBotAuthorizer::rejecting(
            MacroAuthorizationError::InvalidCredentials,
        )),
    ))
    .layer(axum::middleware::map_request(attach_default_bearer))
}

fn webhook_router(service: TestBotService, poster: TestChannelPoster) -> Router {
    webhook_router_with_authorizer(service, poster, rejecting_bot_authorizer())
}

fn webhook_router_with_authorizer(
    service: TestBotService,
    poster: TestChannelPoster,
    bot_authorizer: TestBotAuthorizer,
) -> Router {
    channel_bot_webhook_router(ChannelBotWebhookRouterState::new(
        service,
        poster,
        TestAccessService::new(EntityParticipantRole::Member),
        authorization_state(bot_authorizer),
    ))
}

fn rejecting_bot_authorizer() -> TestBotAuthorizer {
    TestBotAuthorizer::rejecting(MacroAuthorizationError::InvalidCredentials)
}

fn bot_authentication(bot_id: BotId) -> BotAuthentication {
    BotAuthentication {
        bot_id,
        token_id: Uuid::new_v4(),
        bot_scope: BotScope::User,
        team_id: None,
        acting_user: None,
    }
}

fn bot_authentication_with_acting_user(bot_id: BotId) -> BotAuthentication {
    BotAuthentication {
        bot_id,
        token_id: Uuid::new_v4(),
        bot_scope: BotScope::User,
        team_id: None,
        acting_user: Some(MacroUserAuthentication {
            macro_user_id: MacroUserIdStr::parse_from_str("macro|acting-bot@example.com").unwrap(),
            user_context: Default::default(),
        }),
    }
}

fn webhook_request(channel_id: Uuid) -> axum::http::request::Builder {
    Request::builder()
        .method("POST")
        .uri(format!("/channels/{channel_id}/webhook"))
        .header("content-type", "application/json")
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
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
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
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
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
async fn channel_webhook_router_preferred_token_posts_as_bot() {
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let token = "mbot_test_preferred";
    let service = TestBotService::for_preferred_webhook(channel_id, bot_id);
    let poster = TestChannelPoster::new();
    let authorizer = TestBotAuthorizer::authorized(token, None, bot_authentication(bot_id));
    let request = webhook_request(channel_id)
        .header(BOT_TOKEN_HEADER, token)
        .header(BOT_SCOPE_HEADER, BotScope::User.as_str())
        .body(Body::from(
            serde_json::json!({ "content": "hello preferred" }).to_string(),
        ))
        .unwrap();

    let response =
        webhook_router_with_authorizer(service.clone(), poster.clone(), authorizer.clone())
            .oneshot(request)
            .await
            .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(authorizer.call_count(), 1);
    assert_eq!(service.auth_calls.load(Ordering::SeqCst), 0);
    assert_eq!(service.membership_calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        *service
            .last_membership
            .lock()
            .expect("membership call mutex poisoned"),
        Some(MembershipCall { channel_id, bot_id })
    );

    let calls = poster.calls.lock().expect("posted message mutex poisoned");
    assert_eq!(calls.len(), 1);
    let call = &calls[0];
    assert_eq!(call.actor, Sender::new_from_bot(bot_id));
    assert_eq!(call.channel_id, channel_id);
    assert_eq!(call.req.content, "hello preferred");
    assert!(call.req.triggered_by.is_none());
}

#[tokio::test]
async fn channel_webhook_router_verified_acting_user_is_not_used_for_attribution() {
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let token = "mbot_test_acting_user";
    let claims = AuthorizationBotActingUserClaims {
        user_id: Some("macro|acting-bot@example.com".to_string()),
        fusion_user_id: Some("fusion-acting-bot".to_string()),
        organization_id: Some(42),
    };
    let service = TestBotService::for_preferred_webhook(channel_id, bot_id);
    let poster = TestChannelPoster::new();
    let authorizer = TestBotAuthorizer::authorized(
        token,
        Some(claims.clone()),
        bot_authentication_with_acting_user(bot_id),
    );
    let request = webhook_request(channel_id)
        .header(BOT_TOKEN_HEADER, token)
        .header(BOT_SCOPE_HEADER, BotScope::User.as_str())
        .header(
            BOT_FOR_MACRO_USER_ID_HEADER,
            claims.user_id.as_deref().unwrap(),
        )
        .header(
            BOT_FOR_FUSIONAUTH_USER_ID_HEADER,
            claims.fusion_user_id.as_deref().unwrap(),
        )
        .header(
            BOT_FOR_ORGANIZATION_ID_HEADER,
            claims.organization_id.unwrap(),
        )
        .body(Body::from(
            serde_json::json!({ "content": "verified user" }).to_string(),
        ))
        .unwrap();

    let response =
        webhook_router_with_authorizer(service.clone(), poster.clone(), authorizer.clone())
            .oneshot(request)
            .await
            .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        authorizer
            .calls
            .lock()
            .expect("bot authorization calls mutex poisoned")
            .as_slice(),
        &[BotAuthorizationCall {
            token: token.to_string(),
            bot_scope: BotScope::User,
            claims: Some(claims),
        }]
    );
    assert_eq!(service.membership_calls.load(Ordering::SeqCst), 1);
    let calls = poster.calls.lock().expect("posted message mutex poisoned");
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].actor, Sender::new_from_bot(bot_id));
    assert!(calls[0].req.triggered_by.is_none());
}

#[tokio::test]
async fn channel_webhook_router_cookie_only_user_is_forbidden_without_posting() {
    let channel_id = Uuid::new_v4();
    let service = TestBotService::unauthorized_webhook();
    let poster = TestChannelPoster::new();
    let authorizer = rejecting_bot_authorizer();
    let request = webhook_request(channel_id)
        .header("cookie", "macro-access-token=macro|cookie-user@example.com")
        .body(Body::from(
            serde_json::json!({ "content": "user request" }).to_string(),
        ))
        .unwrap();

    let response =
        webhook_router_with_authorizer(service.clone(), poster.clone(), authorizer.clone())
            .oneshot(request)
            .await
            .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let error: ErrorResponse = serde_json::from_slice(&body).unwrap();
    assert_eq!(error.message, "forbidden");
    assert_eq!(authorizer.call_count(), 0);
    assert_eq!(service.auth_calls.load(Ordering::SeqCst), 0);
    assert_eq!(service.membership_calls.load(Ordering::SeqCst), 0);
    assert!(
        poster
            .calls
            .lock()
            .expect("posted message mutex poisoned")
            .is_empty()
    );
}

#[tokio::test]
async fn channel_webhook_router_bot_token_and_user_are_ambiguous_without_posting() {
    let channel_id = Uuid::new_v4();
    let service = TestBotService::unauthorized_webhook();
    let poster = TestChannelPoster::new();
    let authorizer = rejecting_bot_authorizer();
    let request = webhook_request(channel_id)
        .header(BOT_TOKEN_HEADER, "mbot_test_preferred")
        .header(BOT_SCOPE_HEADER, BotScope::User.as_str())
        .header(
            header::AUTHORIZATION,
            "Bearer macro|explicit-user@example.com",
        )
        .body(Body::from(
            serde_json::json!({ "content": "ambiguous" }).to_string(),
        ))
        .unwrap();

    let response =
        webhook_router_with_authorizer(service.clone(), poster.clone(), authorizer.clone())
            .oneshot(request)
            .await
            .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let error: ErrorResponse = serde_json::from_slice(&body).unwrap();
    assert_eq!(error.message, "ambiguous credentials");
    assert_eq!(authorizer.call_count(), 0);
    assert_eq!(service.auth_calls.load(Ordering::SeqCst), 0);
    assert_eq!(service.membership_calls.load(Ordering::SeqCst), 0);
    assert!(
        poster
            .calls
            .lock()
            .expect("posted message mutex poisoned")
            .is_empty()
    );
}

#[tokio::test]
async fn channel_webhook_router_both_bot_headers_are_ambiguous_before_validation() {
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let legacy_token = "mbot_test_legacy";
    let service = TestBotService::for_webhook(channel_id, legacy_token, bot_id);
    let poster = TestChannelPoster::new();
    let authorizer = rejecting_bot_authorizer();
    let request = webhook_request(channel_id)
        .header(BOT_TOKEN_HEADER, "mbot_test_invalid_preferred")
        .header(BOT_SCOPE_HEADER, BotScope::User.as_str())
        .header(CHANNEL_BOT_TOKEN_HEADER, legacy_token)
        .body(Body::from(
            serde_json::json!({ "content": "ambiguous" }).to_string(),
        ))
        .unwrap();

    let response =
        webhook_router_with_authorizer(service.clone(), poster.clone(), authorizer.clone())
            .oneshot(request)
            .await
            .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let error: ErrorResponse = serde_json::from_slice(&body).unwrap();
    assert_eq!(error.message, "ambiguous credentials");
    assert_eq!(authorizer.call_count(), 0);
    assert_eq!(service.auth_calls.load(Ordering::SeqCst), 0);
    assert_eq!(service.membership_calls.load(Ordering::SeqCst), 0);
    assert!(
        poster
            .calls
            .lock()
            .expect("posted message mutex poisoned")
            .is_empty()
    );
}

#[tokio::test]
async fn channel_webhook_router_invalid_preferred_token_does_not_fall_back_to_legacy() {
    let channel_id = Uuid::new_v4();
    let service = TestBotService::unauthorized_webhook();
    let poster = TestChannelPoster::new();
    let authorizer = rejecting_bot_authorizer();
    let request = webhook_request(channel_id)
        .header(BOT_TOKEN_HEADER, "mbot_test_invalid_preferred")
        .header(BOT_SCOPE_HEADER, BotScope::User.as_str())
        .body(Body::from(
            serde_json::json!({ "content": "invalid preferred" }).to_string(),
        ))
        .unwrap();

    let response =
        webhook_router_with_authorizer(service.clone(), poster.clone(), authorizer.clone())
            .oneshot(request)
            .await
            .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(authorizer.call_count(), 1);
    assert_eq!(service.auth_calls.load(Ordering::SeqCst), 0);
    assert_eq!(service.membership_calls.load(Ordering::SeqCst), 0);
    assert!(
        poster
            .calls
            .lock()
            .expect("posted message mutex poisoned")
            .is_empty()
    );
}

#[tokio::test]
async fn channel_webhook_router_preferred_bot_outside_channel_is_unauthorized() {
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let token = "mbot_test_outside_channel";
    let service = TestBotService::unauthorized_webhook();
    let poster = TestChannelPoster::new();
    let authorizer = TestBotAuthorizer::authorized(token, None, bot_authentication(bot_id));
    let request = webhook_request(channel_id)
        .header(BOT_TOKEN_HEADER, token)
        .header(BOT_SCOPE_HEADER, BotScope::User.as_str())
        .body(Body::from(
            serde_json::json!({ "content": "outside channel" }).to_string(),
        ))
        .unwrap();

    let response =
        webhook_router_with_authorizer(service.clone(), poster.clone(), authorizer.clone())
            .oneshot(request)
            .await
            .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(authorizer.call_count(), 1);
    assert_eq!(service.auth_calls.load(Ordering::SeqCst), 0);
    assert_eq!(service.membership_calls.load(Ordering::SeqCst), 1);
    assert!(
        poster
            .calls
            .lock()
            .expect("posted message mutex poisoned")
            .is_empty()
    );
}

#[tokio::test]
async fn channel_webhook_router_rejected_acting_user_is_forbidden_without_posting() {
    let channel_id = Uuid::new_v4();
    let service = TestBotService::unauthorized_webhook();
    let poster = TestChannelPoster::new();
    let authorizer = TestBotAuthorizer::rejecting(MacroAuthorizationError::ActingUserNotAuthorized);
    let request = webhook_request(channel_id)
        .header(BOT_TOKEN_HEADER, "mbot_test_forbidden_claims")
        .header(BOT_SCOPE_HEADER, BotScope::User.as_str())
        .header(BOT_FOR_MACRO_USER_ID_HEADER, "macro|forbidden@example.com")
        .body(Body::from(
            serde_json::json!({ "content": "forbidden" }).to_string(),
        ))
        .unwrap();

    let response =
        webhook_router_with_authorizer(service.clone(), poster.clone(), authorizer.clone())
            .oneshot(request)
            .await
            .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(authorizer.call_count(), 1);
    assert_eq!(service.auth_calls.load(Ordering::SeqCst), 0);
    assert_eq!(service.membership_calls.load(Ordering::SeqCst), 0);
    assert!(
        poster
            .calls
            .lock()
            .expect("posted message mutex poisoned")
            .is_empty()
    );
}

#[tokio::test]
async fn channel_webhook_router_legacy_valid_json_posts_as_bot() {
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
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
    assert_eq!(call.actor, Sender::new_from_bot(bot_id));
    assert_eq!(call.channel_id, channel_id);
    assert_eq!(call.req.content, "hello");
    assert!(call.req.mentions.is_empty());
    assert!(call.req.attachments.is_empty());
    assert!(call.req.thread_id.is_none());
    assert!(call.req.nonce.is_none());
    assert!(call.req.triggered_by.is_none());
}

#[tokio::test]
async fn channel_webhook_router_raw_body_starting_with_brace_posts_as_bot() {
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
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
    assert_eq!(call.actor, Sender::new_from_bot(bot_id));
    assert_eq!(call.channel_id, channel_id);
    assert_eq!(call.req.content, content);
}

#[tokio::test]
async fn channel_webhook_router_invalid_token_returns_unauthorized_without_posting() {
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
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
    let authorizer = rejecting_bot_authorizer();
    let request = webhook_request(channel_id)
        .body(Body::from(
            serde_json::json!({ "content": "hello" }).to_string(),
        ))
        .unwrap();

    let response =
        webhook_router_with_authorizer(service.clone(), poster.clone(), authorizer.clone())
            .oneshot(request)
            .await
            .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(authorizer.call_count(), 0);
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
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
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
