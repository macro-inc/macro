use super::*;
use crate::domain::models::{
    AuthenticatedBot, CreateChannelScopedBotRequest, CreateChannelScopedBotResponse,
};
use crate::{domain::service::BotServiceImpl, outbound::pg_bots_repo::PgBotsRepo};
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
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use model_user::UserContext;
use sqlx::{PgPool, Row};
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

fn user_context(user_id: &str) -> Extension<UserContext> {
    Extension(UserContext {
        user_id: user_id.to_string(),
        fusion_user_id: "fusion-user".to_string(),
        permissions: None,
        organization_id: None,
    })
}

fn real_router(pool: PgPool, user_id: &str) -> Router {
    let bot_service = BotServiceImpl::new(PgBotsRepo::new(pool.clone()));
    let access_service = EntityAccessServiceImpl::new(PgAccessRepository::new(pool));
    bots_router(BotsRouterState::new(bot_service, access_service)).layer(user_context(user_id))
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_admin_can_add_and_remove_owned_bot_via_http(pool: PgPool) -> anyhow::Result<()> {
    const ADMIN_USER_ID: &str = "macro|bot-admin@example.com";
    let channel_id = Uuid::new_v4();

    insert_user(&pool, ADMIN_USER_ID).await?;
    insert_private_channel_with_admin(&pool, channel_id, ADMIN_USER_ID).await?;

    let bot_service = BotServiceImpl::new(PgBotsRepo::new(pool.clone()));
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

    let bot_principal_id = bot.id.to_storage_string();
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
