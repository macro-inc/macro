use super::*;
use crate::domain::models::{
    AuthenticatedBot, BotChannel, BotChannelType, CreateChannelScopedBotRequest,
    CreateChannelScopedBotResponse,
};
use crate::{domain::service::BotServiceImpl, outbound::pg_bots_repo::PgBotsRepo};
use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use entity_access::domain::models::TeamRole;
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EntityPermission,
        EntityType, ParticipantRole as EntityParticipantRole, RequiredPermission, UserTeamInfo,
    },
    ports::EntityAccessService,
};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use macro_authorization::{
    InternalAuthConfig, JwtValidator, MacroAuthorizationError, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer, ValidatedIdentity,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::NoopMacroEventBroker;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use rootcause::Report;
use sqlx::{PgPool, Row};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tower::ServiceExt;

const DEFAULT_BEARER_TOKEN: &str = "macro|bot-admin@example.com";
const INVALID_BEARER_TOKEN: &str = "invalid";

#[derive(Clone, Copy)]
enum TestBotMode {
    Ok,
    Unauthorized,
}

#[derive(Clone)]
struct TestBotService {
    mode: TestBotMode,
    bot_channels: Vec<BotChannel>,
    add_calls: Arc<AtomicUsize>,
    remove_calls: Arc<AtomicUsize>,
    list_bot_channels_calls: Arc<AtomicUsize>,
}

impl TestBotService {
    fn new(mode: TestBotMode) -> Self {
        Self::with_bot_channels(mode, Vec::new())
    }

    fn with_bot_channels(mode: TestBotMode, bot_channels: Vec<BotChannel>) -> Self {
        Self {
            mode,
            bot_channels,
            add_calls: Arc::new(AtomicUsize::new(0)),
            remove_calls: Arc::new(AtomicUsize::new(0)),
            list_bot_channels_calls: Arc::new(AtomicUsize::new(0)),
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

    async fn create_channel_scoped_bot(
        &self,
        _caller: MacroUserIdStr<'static>,
        _channel_id: Uuid,
        _req: CreateChannelScopedBotRequest,
    ) -> Result<CreateChannelScopedBotResponse, BotError> {
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

    async fn list_bot_channels(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
    ) -> Result<Vec<BotChannel>, BotError> {
        self.list_bot_channels_calls.fetch_add(1, Ordering::SeqCst);
        self.result()?;
        Ok(self.bot_channels.clone())
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

    async fn ensure_bot_in_channel(
        &self,
        _bot_id: BotId,
        _channel_id: Uuid,
    ) -> Result<(), BotError> {
        unimplemented!()
    }

    async fn authenticate_token(&self, _token: &str) -> Result<AuthenticatedBot, BotError> {
        unimplemented!()
    }

    async fn authenticate_channel_token(
        &self,
        _channel_id: Uuid,
        _token: &str,
    ) -> Result<AuthenticatedBot, BotError> {
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

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
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
        unimplemented!("bots test mock does not support CRM entity access")
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

#[derive(Clone, Default)]
struct FakeJwtValidator;

impl JwtValidator for FakeJwtValidator {
    fn validate(&self, jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        if jwt == INVALID_BEARER_TOKEN {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(ValidatedIdentity {
            user_id: jwt.to_string(),
            fusion_user_id: "fusion-user".to_string(),
            organization_id: None,
            permissions: None,
        })
    }
}

type TestAuthorizationService = MacroAuthorizationServiceImpl<FakeJwtValidator>;

fn authorization_state() -> MacroAuthorizationState<TestAuthorizationService> {
    let service = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: "test-internal-key".to_string(),
            default_user_id: None,
        },
        NoBotAuthorizer,
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

fn router_without_credentials(service: TestBotService, role: EntityParticipantRole) -> Router {
    bots_router(BotsRouterState::new(
        service,
        TestAccessService::new(role),
        authorization_state(),
    ))
}

fn router(service: TestBotService, role: EntityParticipantRole) -> Router {
    router_without_credentials(service, role)
        .layer(axum::middleware::map_request(attach_default_bearer))
}

fn real_router(pool: PgPool, user_id: &str) -> Router {
    let bot_service = BotServiceImpl::new(PgBotsRepo::new(pool.clone()), NoopMacroEventBroker);
    let access_service = EntityAccessServiceImpl::new(PgAccessRepository::new(pool));
    let bearer_token = user_id.to_string();
    bots_router(BotsRouterState::new(
        bot_service,
        access_service,
        authorization_state(),
    ))
    .layer(axum::middleware::from_fn(
        move |mut request: Request<Body>, next: axum::middleware::Next| {
            let bearer_token = bearer_token.clone();
            async move {
                request.headers_mut().insert(
                    header::AUTHORIZATION,
                    format!("Bearer {bearer_token}").parse().unwrap(),
                );
                next.run(request).await
            }
        },
    ))
}

async fn insert_user(pool: &PgPool, user_id: &str) -> anyhow::Result<()> {
    let macro_user_id = Uuid::new_v4();
    let email = user_id.strip_prefix("macro|").unwrap_or(user_id);
    let stripe_customer_id = format!("stripe_{macro_user_id}");

    sqlx::query(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(macro_user_id)
    .bind(email)
    .bind(email)
    .bind(stripe_customer_id)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(user_id)
    .bind(email)
    .bind(macro_user_id)
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_private_channel_with_admin(
    pool: &PgPool,
    channel_id: Uuid,
    admin_user_id: &str,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO comms_channels (id, name, channel_type, owner_id)
        VALUES ($1, $2, 'private'::comms_channel_type, $3)
        "#,
    )
    .bind(channel_id)
    .bind("alarms")
    .bind(admin_user_id)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO comms_channel_participants (channel_id, user_id, role)
        VALUES ($1, $2, 'admin'::comms_participant_role)
        "#,
    )
    .bind(channel_id)
    .bind(admin_user_id)
    .execute(pool)
    .await?;

    Ok(())
}

fn macro_user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid macro user id")
}

fn bot_channel(channel_id: Uuid) -> BotChannel {
    BotChannel {
        channel_id,
        name: Some("alarms".to_string()),
        channel_type: BotChannelType::Private,
        joined_at: chrono::Utc::now(),
    }
}

async fn read_bot_channels(response: axum::response::Response) -> Vec<BotChannel> {
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&body).unwrap()
}

#[tokio::test]
async fn bot_owner_can_list_bot_channels_via_http() {
    let channel_id = Uuid::new_v4();
    let service = TestBotService::with_bot_channels(TestBotMode::Ok, vec![bot_channel(channel_id)]);
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let request = Request::builder()
        .method("GET")
        .uri(format!("/bots/{bot_id}/channels"))
        .body(Body::empty())
        .unwrap();

    let response = router(service.clone(), EntityParticipantRole::Member)
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let channels = read_bot_channels(response).await;
    assert_eq!(channels.len(), 1);
    assert_eq!(channels[0].channel_id, channel_id);
    assert_eq!(channels[0].name.as_deref(), Some("alarms"));
    assert_eq!(channels[0].channel_type, BotChannelType::Private);
    assert_eq!(service.list_bot_channels_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn bot_route_requires_credentials_without_invoking_service() {
    let service = TestBotService::new(TestBotMode::Ok);
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let request = Request::builder()
        .method("GET")
        .uri(format!("/bots/{bot_id}/channels"))
        .body(Body::empty())
        .unwrap();

    let response = router_without_credentials(service.clone(), EntityParticipantRole::Member)
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.list_bot_channels_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn bot_listing_requires_bot_usability() {
    let service = TestBotService::new(TestBotMode::Unauthorized);
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let request = Request::builder()
        .method("GET")
        .uri(format!("/bots/{bot_id}/channels"))
        .body(Body::empty())
        .unwrap();

    let response = router(service.clone(), EntityParticipantRole::Member)
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.list_bot_channels_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn bot_owner_can_remove_bot_from_channel_via_bot_route_without_channel_admin() {
    let service = TestBotService::new(TestBotMode::Ok);
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let request = Request::builder()
        .method("DELETE")
        .uri(format!("/bots/{bot_id}/channels/{channel_id}"))
        .body(Body::empty())
        .unwrap();

    let response = router(service.clone(), EntityParticipantRole::Member)
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(service.remove_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn bot_remove_channel_requires_bot_usability() {
    let service = TestBotService::new(TestBotMode::Unauthorized);
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let request = Request::builder()
        .method("DELETE")
        .uri(format!("/bots/{bot_id}/channels/{channel_id}"))
        .body(Body::empty())
        .unwrap();

    let response = router(service.clone(), EntityParticipantRole::Member)
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.remove_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn channel_member_cannot_add_bot_to_channel() {
    let service = TestBotService::new(TestBotMode::Ok);
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
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
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
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
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
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
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bot_owner_can_list_and_remove_bot_channels_via_bot_routes(
    pool: PgPool,
) -> anyhow::Result<()> {
    const BOT_OWNER_ID: &str = "macro|bot-owner@example.com";
    const CHANNEL_ADMIN_ID: &str = "macro|channel-admin@example.com";
    let channel_id = Uuid::new_v4();

    insert_user(&pool, BOT_OWNER_ID).await?;
    insert_user(&pool, CHANNEL_ADMIN_ID).await?;
    insert_private_channel_with_admin(&pool, channel_id, CHANNEL_ADMIN_ID).await?;

    let bot_service = BotServiceImpl::new(PgBotsRepo::new(pool.clone()), NoopMacroEventBroker);
    let bot = bot_service
        .create_bot(
            macro_user_id(BOT_OWNER_ID),
            CreateBotRequest {
                team_id: None,
                name: "Datadog Alerts".to_string(),
                handle: "bot-route-alerts".to_string(),
                description: Some("Posts alarm notifications".to_string()),
                avatar_url: None,
            },
        )
        .await?;

    bot_service
        .add_bot_to_channel(macro_user_id(BOT_OWNER_ID), channel_id, bot.id)
        .await?;

    let bot_principal_id = bot.id.into_storage_id().to_string();
    let router = real_router(pool.clone(), BOT_OWNER_ID);
    let list_request = Request::builder()
        .method("GET")
        .uri(format!("/bots/{}/channels", bot.id))
        .body(Body::empty())
        .unwrap();

    let list_response = router.clone().oneshot(list_request).await.unwrap();
    assert_eq!(list_response.status(), StatusCode::OK);
    let channels = read_bot_channels(list_response).await;
    assert_eq!(channels.len(), 1);
    assert_eq!(channels[0].channel_id, channel_id);
    assert_eq!(channels[0].name.as_deref(), Some("alarms"));
    assert_eq!(channels[0].channel_type, BotChannelType::Private);

    let remove_request = Request::builder()
        .method("DELETE")
        .uri(format!("/bots/{}/channels/{channel_id}", bot.id))
        .body(Body::empty())
        .unwrap();

    let remove_response = router.clone().oneshot(remove_request).await.unwrap();
    assert_eq!(remove_response.status(), StatusCode::NO_CONTENT);

    let left_at: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
        r#"
        SELECT left_at
        FROM comms_channel_participants
        WHERE channel_id = $1 AND user_id = $2
        "#,
    )
    .bind(channel_id)
    .bind(&bot_principal_id)
    .fetch_one(&pool)
    .await?;
    assert!(left_at.is_some());

    let list_request = Request::builder()
        .method("GET")
        .uri(format!("/bots/{}/channels", bot.id))
        .body(Body::empty())
        .unwrap();

    let list_response = router.clone().oneshot(list_request).await.unwrap();
    assert_eq!(list_response.status(), StatusCode::OK);
    assert!(read_bot_channels(list_response).await.is_empty());

    let missing_remove_request = Request::builder()
        .method("DELETE")
        .uri(format!("/bots/{}/channels/{channel_id}", bot.id))
        .body(Body::empty())
        .unwrap();

    let missing_remove_response = router.oneshot(missing_remove_request).await.unwrap();
    assert_eq!(missing_remove_response.status(), StatusCode::NOT_FOUND);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_admin_can_add_and_remove_owned_bot_via_http(pool: PgPool) -> anyhow::Result<()> {
    const ADMIN_USER_ID: &str = "macro|bot-admin@example.com";
    let channel_id = Uuid::new_v4();

    insert_user(&pool, ADMIN_USER_ID).await?;
    insert_private_channel_with_admin(&pool, channel_id, ADMIN_USER_ID).await?;

    let bot_service = BotServiceImpl::new(PgBotsRepo::new(pool.clone()), NoopMacroEventBroker);
    let bot = bot_service
        .create_bot(
            macro_user_id(ADMIN_USER_ID),
            CreateBotRequest {
                team_id: None,
                name: "Datadog Alerts".to_string(),
                handle: "datadog-alerts".to_string(),
                description: Some("Posts alarm notifications".to_string()),
                avatar_url: None,
            },
        )
        .await?;

    let bot_principal_id = bot.id.into_storage_id().to_string();
    let router = real_router(pool.clone(), ADMIN_USER_ID);
    let add_request = Request::builder()
        .method("POST")
        .uri(format!("/channels/{channel_id}/bots"))
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::json!({ "bot_id": bot.id }).to_string(),
        ))
        .unwrap();

    let add_response = router.clone().oneshot(add_request).await.unwrap();
    assert_eq!(add_response.status(), StatusCode::NO_CONTENT);

    let participant = sqlx::query(
        r#"
        SELECT role::text AS role, left_at
        FROM comms_channel_participants
        WHERE channel_id = $1 AND user_id = $2
        "#,
    )
    .bind(channel_id)
    .bind(&bot_principal_id)
    .fetch_one(&pool)
    .await?;

    let role: String = participant.try_get("role")?;
    let left_at: Option<chrono::DateTime<chrono::Utc>> = participant.try_get("left_at")?;
    assert_eq!(role, "member");
    assert!(left_at.is_none());

    let remove_request = Request::builder()
        .method("DELETE")
        .uri(format!("/channels/{channel_id}/bots/{}", bot.id))
        .body(Body::empty())
        .unwrap();

    let remove_response = router.oneshot(remove_request).await.unwrap();
    assert_eq!(remove_response.status(), StatusCode::NO_CONTENT);

    let participant = sqlx::query(
        r#"
        SELECT left_at
        FROM comms_channel_participants
        WHERE channel_id = $1 AND user_id = $2
        "#,
    )
    .bind(channel_id)
    .bind(bot_principal_id)
    .fetch_one(&pool)
    .await?;

    let left_at: Option<chrono::DateTime<chrono::Utc>> = participant.try_get("left_at")?;
    assert!(left_at.is_some());

    Ok(())
}
