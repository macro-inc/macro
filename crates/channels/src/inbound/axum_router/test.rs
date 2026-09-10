use super::*;
use crate::domain::models::{
    Activity, ActivityType, ChannelAttachment, ChannelParticipant, GetOrCreateChannelResponse,
    GetOrCreateDmRequest, GetOrCreatePrivateRequest, ParticipantRole, PatchChannelRequest,
    RemoveParticipantsRequest, Sender,
};
use crate::domain::ports::{
    ChannelAttachmentsPage, ChannelMessagesErr, ChannelMutationErr, ChannelService,
};
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use entity_access::domain::models::TeamRole;
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, BotAccessScope, BotId, Entity, EntityAccessReceipt,
        EntityPermission, EntityType, MemberParticipantRole,
        ParticipantRole as EntityParticipantRole, RequiredPermission, UserTeamInfo,
    },
    ports::EntityAccessService,
};
use http_body_util::BodyExt;
#[allow(deprecated)]
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_ORGANIZATION_ID_HEADER, INTERNAL_MACRO_USER_ID_HEADER,
    InternalAuthConfig, JwtValidator, LEGACY_DSS_INTERNAL_API_KEY_HEADER,
    LEGACY_DSS_INTERNAL_MACRO_USER_ID_HEADER, MacroAuthorizationError,
    MacroAuthorizationServiceImpl, MacroAuthorizationState, ValidatedIdentity,
};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use models_pagination::{CreatedAt, PaginateOn, Query};
use rootcause::Report;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use tower::util::ServiceExt;

const TEST_USER_ID: &str = "macro|test@example.com";
const INTERNAL_USER_ID: &str = "macro|internal@example.com";
const VALID_BEARER_TOKEN: &str = "valid";
const ORGANIZATION_BEARER_TOKEN: &str = "valid-with-organization";
const VALID_INTERNAL_KEY: &str = "valid-internal-key";
const TEST_ORGANIZATION_ID: i32 = 42;

// --- Access service implementations for tests ---

#[derive(Clone, Copy)]
enum AccessMode {
    Allow,
    Deny,
    NotFound,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PermissionCall {
    user_id: Option<String>,
    entity_id: String,
    entity_type: EntityType,
    organization_id: Option<i64>,
}

#[derive(Clone)]
struct TestAccessService {
    mode: AccessMode,
    channel_view_only: bool,
    permission_calls: Arc<Mutex<Vec<PermissionCall>>>,
}

impl TestAccessService {
    fn allow() -> Self {
        Self::new(AccessMode::Allow)
    }

    fn channel_view_only() -> Self {
        Self {
            channel_view_only: true,
            ..Self::allow()
        }
    }

    fn deny() -> Self {
        Self::new(AccessMode::Deny)
    }

    fn not_found() -> Self {
        Self::new(AccessMode::NotFound)
    }

    fn new(mode: AccessMode) -> Self {
        Self {
            mode,
            channel_view_only: false,
            permission_calls: Arc::default(),
        }
    }

    fn permission_calls(&self) -> Vec<PermissionCall> {
        self.permission_calls.lock().unwrap().clone()
    }

    fn access_err(&self) -> AccessError {
        match self.mode {
            AccessMode::Allow => AccessError::internal("test access failure"),
            AccessMode::Deny => AccessError::Unauthorized,
            AccessMode::NotFound => AccessError::NotFound("Channel not found"),
        }
    }
}

impl EntityAccessService for TestAccessService {
    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        unimplemented!()
    }

    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        if !matches!(self.mode, AccessMode::Allow) {
            return Err(self.access_err());
        }
        EntityAccessReceipt::try_new_authenticated_user(
            MacroUserIdStr::parse_from_str(user_id.as_ref())
                .unwrap()
                .into_owned(),
            Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            EntityPermission::ChannelRole {
                role: EntityParticipantRole::Member,
            },
        )
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(self.access_err())
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(match self.mode {
            AccessMode::Allow => Some(AccessLevel::View),
            AccessMode::Deny | AccessMode::NotFound => None,
        })
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        match self.mode {
            AccessMode::Allow => Ok(AccessLevel::View),
            AccessMode::Deny => Err(AccessError::Unauthorized),
            AccessMode::NotFound => Err(AccessError::NotFound("Channel not found")),
        }
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        match self.mode {
            AccessMode::Allow => Ok(AccessLevel::View),
            AccessMode::Deny => Err(AccessError::Unauthorized),
            AccessMode::NotFound => Err(AccessError::NotFound("Channel not found")),
        }
    }

    async fn get_entity_permission(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        self.permission_calls.lock().unwrap().push(PermissionCall {
            user_id: user_id.map(|user_id| user_id.as_ref().to_string()),
            entity_id: entity_id.to_string(),
            entity_type,
            organization_id: user_org_id,
        });

        if self.channel_view_only && entity_type == EntityType::Channel {
            return Ok(EntityPermission::ChannelViewOnly);
        }

        match self.mode {
            AccessMode::Allow => match entity_type {
                EntityType::Channel => Ok(EntityPermission::ChannelRole {
                    role: EntityParticipantRole::Member,
                }),
                _ => Ok(EntityPermission::AccessLevel {
                    access_level: AccessLevel::View,
                }),
            },
            AccessMode::Deny => Err(AccessError::Unauthorized),
            AccessMode::NotFound => Err(AccessError::NotFound("Channel not found")),
        }
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, uuid::Uuid, TeamRole), AccessError> {
        unimplemented!("channels test mock does not support CRM entity access")
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<entity_access::domain::models::CallChannelInfo>, AccessError> {
        unimplemented!()
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<entity_access::domain::models::CallChannelInfo>, AccessError> {
        unimplemented!()
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        unimplemented!()
    }
}

// --- Mock services (business logic only, no auth concerns) ---

struct MockService;

impl ChannelService for MockService {
    async fn get_channel_attachments(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _limit: u16,
        _attachment_type: Option<crate::domain::models::ChannelAttachmentType>,
    ) -> Result<ChannelAttachmentsPage, ChannelMessagesErr> {
        Ok(Vec::<ChannelAttachment>::new()
            .into_iter()
            .paginate_on(50, CreatedAt)
            .filter_on(())
            .into_page())
    }

    async fn get_channel_participants(
        &self,
        _channel_id: Uuid,
    ) -> Result<Vec<ChannelParticipant>, ChannelMessagesErr> {
        Ok(vec![])
    }

    async fn get_attachment_references(
        &self,
        entity_type: String,
        entity_id: String,
        _user_id: String,
    ) -> Result<Vec<crate::domain::models::AttachmentEntityReference>, ChannelMessagesErr> {
        let now = chrono::Utc::now();
        Ok(vec![
            crate::domain::models::AttachmentEntityReference::Channel(
                crate::domain::models::AttachmentChannelReference {
                    channel_id: Uuid::new_v4(),
                    channel_name: Some("test-channel".to_string()),
                    message_id: Uuid::new_v4(),
                    thread_id: None,
                    sender_id: "macro|user@example.com".to_string(),
                    message_content: "look at this".to_string(),
                    message_created_at: now,
                    attachment_created_at: now,
                },
            ),
            crate::domain::models::AttachmentEntityReference::Generic(
                crate::domain::models::AttachmentGenericReference {
                    source_entity_type: "doc".to_string(),
                    source_entity_id: "src-doc".to_string(),
                    entity_type,
                    entity_id,
                    user_id: None,
                    created_at: now,
                },
            ),
        ])
    }
}

struct ErrorService;

impl ChannelService for ErrorService {
    async fn get_channel_attachments(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _limit: u16,
        _attachment_type: Option<crate::domain::models::ChannelAttachmentType>,
    ) -> Result<ChannelAttachmentsPage, ChannelMessagesErr> {
        Err(ChannelMessagesErr::Repo(anyhow::anyhow!("database error")))
    }

    async fn get_channel_participants(
        &self,
        _channel_id: Uuid,
    ) -> Result<Vec<ChannelParticipant>, ChannelMessagesErr> {
        Err(ChannelMessagesErr::Repo(anyhow::anyhow!("database error")))
    }

    async fn get_attachment_references(
        &self,
        _entity_type: String,
        _entity_id: String,
        _user_id: String,
    ) -> Result<Vec<crate::domain::models::AttachmentEntityReference>, ChannelMessagesErr> {
        Err(ChannelMessagesErr::Repo(anyhow::anyhow!("database error")))
    }
}

struct ParticipantsService;

impl ChannelService for ParticipantsService {
    async fn get_channel_attachments(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _limit: u16,
        _attachment_type: Option<crate::domain::models::ChannelAttachmentType>,
    ) -> Result<ChannelAttachmentsPage, ChannelMessagesErr> {
        Ok(Vec::<ChannelAttachment>::new()
            .into_iter()
            .paginate_on(50, CreatedAt)
            .filter_on(())
            .into_page())
    }

    async fn get_channel_participants(
        &self,
        channel_id: Uuid,
    ) -> Result<Vec<ChannelParticipant>, ChannelMessagesErr> {
        Ok(vec![
            ChannelParticipant {
                channel_id,
                user_id: "macro|user1@example.com".into(),
                role: ParticipantRole::Owner,
                joined_at: chrono::Utc::now(),
                left_at: None,
            },
            ChannelParticipant {
                channel_id,
                user_id: "macro|user2@example.com".into(),
                role: ParticipantRole::Member,
                joined_at: chrono::Utc::now(),
                left_at: None,
            },
        ])
    }

    async fn get_attachment_references(
        &self,
        _entity_type: String,
        _entity_id: String,
        _user_id: String,
    ) -> Result<Vec<crate::domain::models::AttachmentEntityReference>, ChannelMessagesErr> {
        Ok(vec![])
    }
}

#[derive(Clone)]
struct JoinLinkService {
    join_code: Uuid,
    private_channel_id: Uuid,
    forbidden_channel_ids: Arc<Vec<Uuid>>,
    requested_channel_ids: Arc<Mutex<Vec<Uuid>>>,
    joined_users: Arc<Mutex<Vec<Sender>>>,
}

impl JoinLinkService {
    fn new(private_channel_id: Uuid, join_code: Uuid, forbidden_channel_ids: Vec<Uuid>) -> Self {
        Self {
            join_code,
            private_channel_id,
            forbidden_channel_ids: Arc::new(forbidden_channel_ids),
            requested_channel_ids: Arc::default(),
            joined_users: Arc::default(),
        }
    }
}

impl ChannelService for JoinLinkService {
    async fn get_channel_attachments(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _limit: u16,
        _attachment_type: Option<ChannelAttachmentType>,
    ) -> Result<ChannelAttachmentsPage, ChannelMessagesErr> {
        unimplemented!()
    }

    async fn get_channel_participants(
        &self,
        _channel_id: Uuid,
    ) -> Result<Vec<ChannelParticipant>, ChannelMessagesErr> {
        unimplemented!()
    }

    async fn get_attachment_references(
        &self,
        _entity_type: String,
        _entity_id: String,
        _user_id: String,
    ) -> Result<Vec<crate::domain::models::AttachmentEntityReference>, ChannelMessagesErr> {
        unimplemented!()
    }

    async fn get_channel_join_code(
        &self,
        channel_id: Uuid,
    ) -> Result<ChannelJoinCodeResponse, ChannelMutationErr> {
        self.requested_channel_ids.lock().unwrap().push(channel_id);
        if self.forbidden_channel_ids.contains(&channel_id) {
            return Err(ChannelMutationErr::Forbidden(
                "join links are only available for private channels".to_string(),
            ));
        }
        if channel_id != self.private_channel_id {
            return Err(ChannelMutationErr::NotFound(
                "channel not found".to_string(),
            ));
        }
        Ok(ChannelJoinCodeResponse {
            join_code: self.join_code,
        })
    }

    async fn join_channel_by_code(
        &self,
        actor: Sender,
        join_code: Uuid,
    ) -> Result<(), ChannelMutationErr> {
        if join_code != self.join_code {
            return Err(ChannelMutationErr::NotFound(
                "channel join code not found".to_string(),
            ));
        }
        self.joined_users.lock().unwrap().push(actor);
        Ok(())
    }
}

#[derive(Clone, Default)]
struct RecordingMutationService {
    joins: Arc<Mutex<Vec<(Sender, Uuid)>>>,
}

impl ChannelService for RecordingMutationService {
    async fn get_channel_attachments(
        &self,
        _channel_id: Uuid,
        _query: models_pagination::Query<Uuid, CreatedAt, ()>,
        _limit: u16,
        _attachment_type: Option<ChannelAttachmentType>,
    ) -> Result<ChannelAttachmentsPage, ChannelMessagesErr> {
        Ok(Vec::<ChannelAttachment>::new()
            .into_iter()
            .paginate_on(50, CreatedAt)
            .filter_on(())
            .into_page())
    }

    async fn get_channel_participants(
        &self,
        _channel_id: Uuid,
    ) -> Result<Vec<ChannelParticipant>, ChannelMessagesErr> {
        Ok(vec![])
    }

    async fn create_channel(
        &self,
        _actor: Sender,
        _actor_org_id: Option<i64>,
        _req: CreateChannelRequest,
    ) -> Result<CreateChannelResponse, ChannelMutationErr> {
        Ok(CreateChannelResponse {
            id: Uuid::new_v4().to_string(),
        })
    }

    async fn get_or_create_dm(
        &self,
        _actor: Sender,
        _req: GetOrCreateDmRequest,
    ) -> Result<GetOrCreateChannelResponse, ChannelMutationErr> {
        Err(ChannelMutationErr::NotFound("unused".to_string()))
    }

    async fn get_or_create_private(
        &self,
        _actor: Sender,
        _req: GetOrCreatePrivateRequest,
    ) -> Result<GetOrCreateChannelResponse, ChannelMutationErr> {
        Err(ChannelMutationErr::NotFound("unused".to_string()))
    }

    async fn patch_channel(
        &self,
        _actor: Sender,
        _channel_id: Uuid,
        _req: PatchChannelRequest,
    ) -> Result<(), ChannelMutationErr> {
        Ok(())
    }

    async fn delete_channel(
        &self,
        _actor: Sender,
        _channel_id: Uuid,
    ) -> Result<(), ChannelMutationErr> {
        Ok(())
    }

    async fn add_participants(
        &self,
        _actor: Sender,
        _channel_id: Uuid,
        _req: AddParticipantsRequest,
    ) -> Result<(), ChannelMutationErr> {
        Ok(())
    }

    async fn remove_participants(
        &self,
        _actor: Sender,
        _channel_id: Uuid,
        _req: RemoveParticipantsRequest,
    ) -> Result<(), ChannelMutationErr> {
        Ok(())
    }

    async fn join_channel(
        &self,
        actor: Sender,
        channel_id: Uuid,
    ) -> Result<(), ChannelMutationErr> {
        self.joins.lock().unwrap().push((actor, channel_id));
        Ok(())
    }

    async fn leave_channel(
        &self,
        _actor: Sender,
        _channel_id: Uuid,
    ) -> Result<(), ChannelMutationErr> {
        Ok(())
    }

    async fn get_attachment_references(
        &self,
        _entity_type: String,
        _entity_id: String,
        _user_id: String,
    ) -> Result<Vec<crate::domain::models::AttachmentEntityReference>, ChannelMessagesErr> {
        Ok(vec![])
    }
}

#[derive(Clone, Default)]
struct FakeJwtValidator {
    validation_count: Arc<AtomicUsize>,
}

impl FakeJwtValidator {
    fn validation_count(&self) -> usize {
        self.validation_count.load(Ordering::SeqCst)
    }
}

impl JwtValidator for FakeJwtValidator {
    fn validate(&self, jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        self.validation_count.fetch_add(1, Ordering::SeqCst);

        let organization_id = match jwt {
            VALID_BEARER_TOKEN => None,
            ORGANIZATION_BEARER_TOKEN => Some(TEST_ORGANIZATION_ID),
            "expired" => return Err(Report::new(MacroAuthorizationError::CredentialsExpired)),
            _ => return Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        };

        Ok(ValidatedIdentity {
            user_id: TEST_USER_ID.to_string(),
            fusion_user_id: "test-fusion-user".to_string(),
            organization_id,
            permissions: None,
        })
    }
}

type TestAuthorizationService = MacroAuthorizationServiceImpl<FakeJwtValidator>;

fn authorization_state_with_default(
    default_user_id: Option<&str>,
) -> (
    MacroAuthorizationState<TestAuthorizationService>,
    FakeJwtValidator,
) {
    let validator = FakeJwtValidator::default();
    let service = MacroAuthorizationServiceImpl::new(
        validator.clone(),
        InternalAuthConfig {
            api_key: VALID_INTERNAL_KEY.to_string(),
            default_user_id: default_user_id.map(str::to_string),
        },
        macro_authorization::NoBotAuthorizer,
        macro_authorization::NoUserApiKeyAuthorizer,
    );
    (MacroAuthorizationState::new(Arc::new(service)), validator)
}

fn authorization_state() -> MacroAuthorizationState<TestAuthorizationService> {
    authorization_state_with_default(None).0
}

async fn attach_bearer(mut request: Request<Body>) -> Request<Body> {
    request.headers_mut().insert(
        header::AUTHORIZATION,
        format!("Bearer {VALID_BEARER_TOKEN}").parse().unwrap(),
    );
    request
}

fn mock_router() -> Router {
    channels_router(ChannelsRouterState::new(
        MockService,
        TestAccessService::allow(),
        authorization_state(),
    ))
    .layer(axum::middleware::map_request(attach_bearer))
}

fn error_router() -> Router {
    channels_router(ChannelsRouterState::new(
        ErrorService,
        TestAccessService::allow(),
        authorization_state(),
    ))
    .layer(axum::middleware::map_request(attach_bearer))
}

fn denied_router() -> Router {
    channels_router(ChannelsRouterState::new(
        MockService,
        TestAccessService::deny(),
        authorization_state(),
    ))
    .layer(axum::middleware::map_request(attach_bearer))
}

fn not_found_router() -> Router {
    channels_router(ChannelsRouterState::new(
        MockService,
        TestAccessService::not_found(),
        authorization_state(),
    ))
    .layer(axum::middleware::map_request(attach_bearer))
}

fn join_by_code_router(
    default_user_id: Option<&str>,
) -> (Router, Uuid, Arc<Mutex<Vec<Sender>>>, FakeJwtValidator) {
    let join_code = Uuid::new_v4();
    let service = JoinLinkService::new(Uuid::new_v4(), join_code, vec![]);
    let joined_users = service.joined_users.clone();
    let (authorization_state, validator) = authorization_state_with_default(default_user_id);
    let router = channels_router(ChannelsRouterState::new(
        service,
        TestAccessService::deny(),
        authorization_state,
    ));
    (router, join_code, joined_users, validator)
}

fn join_by_code_request(join_code: Uuid) -> axum::http::request::Builder {
    Request::post(format!("/join/{join_code}"))
}

#[tokio::test]
async fn valid_bearer_authenticates_user() {
    let (router, join_code, joined_users, validator) = join_by_code_router(None);
    let request = join_by_code_request(join_code)
        .header(
            header::AUTHORIZATION,
            format!("Bearer {VALID_BEARER_TOKEN}"),
        )
        .body(Body::empty())
        .unwrap();

    let response = router.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(validator.validation_count(), 1);
    let joined_users = joined_users.lock().unwrap();
    assert_eq!(joined_users.len(), 1);
    assert_eq!(joined_users[0].as_ref(), TEST_USER_ID);
}

#[tokio::test]
async fn missing_credentials_are_rejected_before_service_invocation() {
    let (router, join_code, joined_users, validator) = join_by_code_router(None);
    let request = join_by_code_request(join_code).body(Body::empty()).unwrap();

    let response = router.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(validator.validation_count(), 0);
    assert!(joined_users.lock().unwrap().is_empty());
}

#[tokio::test]
async fn invalid_credentials_are_rejected_before_service_invocation() {
    let (router, join_code, joined_users, validator) = join_by_code_router(None);
    let request = join_by_code_request(join_code)
        .header(header::AUTHORIZATION, "Bearer invalid")
        .body(Body::empty())
        .unwrap();

    let response = router.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(validator.validation_count(), 1);
    assert!(joined_users.lock().unwrap().is_empty());
}

#[tokio::test]
async fn expired_credentials_are_rejected_before_service_invocation() {
    let (router, join_code, joined_users, validator) = join_by_code_router(None);
    let request = join_by_code_request(join_code)
        .header(header::AUTHORIZATION, "Bearer expired")
        .body(Body::empty())
        .unwrap();

    let response = router.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(validator.validation_count(), 1);
    assert!(joined_users.lock().unwrap().is_empty());
}

#[tokio::test]
async fn standard_internal_headers_propagate_organization_to_entity_access() {
    let channel_id = Uuid::new_v4();
    let access_service = TestAccessService::allow();
    let router = channels_router(ChannelsRouterState::new(
        MockService,
        access_service.clone(),
        authorization_state(),
    ));
    let request = Request::get(format!("/{channel_id}/participants"))
        .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
        .header(INTERNAL_MACRO_USER_ID_HEADER, INTERNAL_USER_ID)
        .header(INTERNAL_MACRO_ORGANIZATION_ID_HEADER, "73")
        .body(Body::empty())
        .unwrap();

    let response = router.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        access_service.permission_calls(),
        [PermissionCall {
            user_id: Some(INTERNAL_USER_ID.to_string()),
            entity_id: channel_id.to_string(),
            entity_type: EntityType::Channel,
            organization_id: Some(73),
        }]
    );
}

#[allow(deprecated)]
#[tokio::test]
async fn legacy_internal_headers_authenticate_acting_user() {
    let (router, join_code, joined_users, validator) = join_by_code_router(None);
    let request = join_by_code_request(join_code)
        .header(LEGACY_DSS_INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
        .header(LEGACY_DSS_INTERNAL_MACRO_USER_ID_HEADER, INTERNAL_USER_ID)
        .body(Body::empty())
        .unwrap();

    let response = router.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(validator.validation_count(), 0);
    let joined_users = joined_users.lock().unwrap();
    assert_eq!(joined_users.len(), 1);
    assert_eq!(joined_users[0].as_ref(), INTERNAL_USER_ID);
}

#[tokio::test]
async fn internal_headers_use_dss_style_default_identity() {
    let (router, join_code, joined_users, validator) = join_by_code_router(Some(TEST_USER_ID));
    let request = join_by_code_request(join_code)
        .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
        .body(Body::empty())
        .unwrap();

    let response = router.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(validator.validation_count(), 0);
    let joined_users = joined_users.lock().unwrap();
    assert_eq!(joined_users.len(), 1);
    assert_eq!(joined_users[0].as_ref(), TEST_USER_ID);
}

#[tokio::test]
async fn bearer_organization_is_propagated_to_entity_access() {
    let channel_id = Uuid::new_v4();
    let access_service = TestAccessService::allow();
    let (authorization_state, validator) = authorization_state_with_default(None);
    let router = channels_router(ChannelsRouterState::new(
        MockService,
        access_service.clone(),
        authorization_state,
    ));
    let request = Request::get(format!("/{channel_id}/participants"))
        .header(
            header::AUTHORIZATION,
            format!("Bearer {ORGANIZATION_BEARER_TOKEN}"),
        )
        .body(Body::empty())
        .unwrap();

    let response = router.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(validator.validation_count(), 1);
    assert_eq!(
        access_service.permission_calls(),
        [PermissionCall {
            user_id: Some(TEST_USER_ID.to_string()),
            entity_id: channel_id.to_string(),
            entity_type: EntityType::Channel,
            organization_id: Some(i64::from(TEST_ORGANIZATION_ID)),
        }]
    );
}

#[tokio::test]
async fn active_participant_can_get_persisted_channel_join_code() {
    let channel_id = Uuid::new_v4();
    let join_code = Uuid::new_v4();
    let service = JoinLinkService::new(channel_id, join_code, vec![]);
    let requested_channel_ids = service.requested_channel_ids.clone();
    let router = channels_router(ChannelsRouterState::new(
        service,
        TestAccessService::allow(),
        authorization_state(),
    ))
    .layer(axum::middleware::map_request(attach_bearer));

    let response = router
        .oneshot(
            Request::builder()
                .uri(format!("/{channel_id}/join-link"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        serde_json::json!({ "join_code": join_code })
    );
    assert_eq!(*requested_channel_ids.lock().unwrap(), vec![channel_id]);
}

#[tokio::test]
async fn non_participant_cannot_get_channel_join_code() {
    let channel_id = Uuid::new_v4();
    let service = JoinLinkService::new(channel_id, Uuid::new_v4(), vec![]);
    let requested_channel_ids = service.requested_channel_ids.clone();
    let router = channels_router(ChannelsRouterState::new(
        service,
        TestAccessService::deny(),
        authorization_state(),
    ))
    .layer(axum::middleware::map_request(attach_bearer));

    let response = router
        .oneshot(
            Request::builder()
                .uri(format!("/{channel_id}/join-link"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(requested_channel_ids.lock().unwrap().is_empty());
}

#[tokio::test]
async fn non_private_channels_cannot_get_join_codes() {
    let non_private_channels = [
        ("public", Uuid::new_v4()),
        ("direct_message", Uuid::new_v4()),
        ("team", Uuid::new_v4()),
    ];
    let service = JoinLinkService::new(
        Uuid::new_v4(),
        Uuid::new_v4(),
        non_private_channels.iter().map(|(_, id)| *id).collect(),
    );
    let router = channels_router(ChannelsRouterState::new(
        service,
        TestAccessService::allow(),
        authorization_state(),
    ))
    .layer(axum::middleware::map_request(attach_bearer));

    for (channel_type, channel_id) in non_private_channels {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/{channel_id}/join-link"))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::FORBIDDEN,
            "expected {channel_type} channel to be forbidden"
        );
    }
}

#[tokio::test]
async fn join_channel_by_code_handles_malformed_and_unknown_codes() {
    let service = JoinLinkService::new(Uuid::new_v4(), Uuid::new_v4(), vec![]);
    let router = channels_router(ChannelsRouterState::new(
        service,
        TestAccessService::deny(),
        authorization_state(),
    ))
    .layer(axum::middleware::map_request(attach_bearer));

    let malformed_response = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/join/not-a-uuid")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(malformed_response.status(), StatusCode::BAD_REQUEST);

    let unknown_response = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/join/{}", Uuid::new_v4()))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unknown_response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn authenticated_user_can_join_by_code_without_channel_access() {
    let join_code = Uuid::new_v4();
    let service = JoinLinkService::new(Uuid::new_v4(), join_code, vec![]);
    let joined_users = service.joined_users.clone();
    let router = channels_router(ChannelsRouterState::new(
        service,
        TestAccessService::deny(),
        authorization_state(),
    ))
    .layer(axum::middleware::map_request(attach_bearer));

    let response = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/join/{join_code}"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .len(),
        0
    );
    let users = joined_users.lock().unwrap();
    assert_eq!(users.len(), 1);
    assert_eq!(users[0].as_ref(), "macro|test@example.com");
}

#[tokio::test]
async fn channel_view_only_user_can_join_channel_by_id() {
    let channel_id = Uuid::new_v4();
    let mutation_service = RecordingMutationService::default();
    let joins = mutation_service.joins.clone();
    let access_service = TestAccessService::channel_view_only();
    let router = channels_router(ChannelsRouterState::new(
        mutation_service,
        access_service.clone(),
        authorization_state(),
    ))
    .layer(axum::middleware::map_request(attach_bearer));

    let response = router
        .oneshot(
            Request::post(format!("/{channel_id}/join"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        access_service.permission_calls(),
        [PermissionCall {
            user_id: Some(TEST_USER_ID.to_string()),
            entity_id: channel_id.to_string(),
            entity_type: EntityType::Channel,
            organization_id: None,
        }]
    );
    let joins = joins.lock().unwrap();
    assert_eq!(joins.len(), 1);
    assert_eq!(joins[0].0.as_ref(), TEST_USER_ID);
    assert_eq!(joins[0].1, channel_id);
}

#[tokio::test]
async fn user_without_channel_access_cannot_join_channel_by_id() {
    let channel_id = Uuid::new_v4();
    let mutation_service = RecordingMutationService::default();
    let joins = mutation_service.joins.clone();
    let router = channels_router(ChannelsRouterState::new(
        mutation_service,
        TestAccessService::deny(),
        authorization_state(),
    ))
    .layer(axum::middleware::map_request(attach_bearer));

    let response = router
        .oneshot(
            Request::post(format!("/{channel_id}/join"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(joins.lock().unwrap().is_empty());
}

#[tokio::test]
async fn malformed_channel_id_does_not_invoke_join_service() {
    let mutation_service = RecordingMutationService::default();
    let joins = mutation_service.joins.clone();
    let access_service = TestAccessService::channel_view_only();
    let router = channels_router(ChannelsRouterState::new(
        mutation_service,
        access_service.clone(),
        authorization_state(),
    ))
    .layer(axum::middleware::map_request(attach_bearer));

    let response = router
        .oneshot(
            Request::post("/not-a-uuid/join")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        access_service.permission_calls(),
        [PermissionCall {
            user_id: Some(TEST_USER_ID.to_string()),
            entity_id: "not-a-uuid".to_string(),
            entity_type: EntityType::Channel,
            organization_id: None,
        }]
    );
    assert!(joins.lock().unwrap().is_empty());
}

#[tokio::test]
async fn attachments_returns_empty_page() {
    let router = mock_router();
    let channel_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!("/{channel_id}/attachments"))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["items"], serde_json::json!([]));
    assert!(json["next_cursor"].is_null());
}

#[tokio::test]
async fn attachments_returns_500_on_service_error() {
    let router = error_router();
    let channel_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!("/{channel_id}/attachments"))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn participants_returns_empty_list() {
    let router = mock_router();
    let channel_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!("/{channel_id}/participants"))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json, serde_json::json!([]));
}

#[tokio::test]
async fn participants_returns_data_with_correct_shape() {
    let router = channels_router(ChannelsRouterState::new(
        ParticipantsService,
        TestAccessService::allow(),
        authorization_state(),
    ))
    .layer(axum::middleware::map_request(attach_bearer));
    let channel_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!("/{channel_id}/participants"))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let arr = json.as_array().unwrap();
    assert_eq!(arr.len(), 2);
    assert_eq!(arr[0]["role"], "owner");
    assert_eq!(arr[1]["role"], "member");
    assert_eq!(arr[0]["user_id"], "macro|user1@example.com");
}

#[tokio::test]
async fn participants_returns_500_on_service_error() {
    let router = error_router();
    let channel_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!("/{channel_id}/participants"))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);

    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["message"], "An internal server error occurred");
}

#[tokio::test]
async fn attachment_references_returns_tagged_references() {
    let router = mock_router();
    let request = Request::builder()
        .uri("/attachments/document/doc1/references")
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let references = json["references"].as_array().unwrap();
    assert_eq!(references.len(), 2);
    assert_eq!(references[0]["reference_type"], "channel");
    assert_eq!(references[0]["message_content"], "look at this");
    assert_eq!(references[1]["reference_type"], "generic");
    assert_eq!(references[1]["entity_id"], "doc1");
    assert_eq!(references[1]["source_entity_type"], "doc");
}

// --- Access control tests ---

#[tokio::test]
async fn non_member_cannot_access_attachments() {
    let router = denied_router();
    let channel_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!("/{channel_id}/attachments"))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn non_member_cannot_access_participants() {
    let router = denied_router();
    let channel_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!("/{channel_id}/participants"))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn missing_channel_returns_404() {
    let router = not_found_router();
    let channel_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!("/{channel_id}/participants"))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

// --- Activity endpoint tests ---

#[derive(Default)]
struct ActivityService {
    posts: Arc<Mutex<Vec<(String, Uuid, ActivityType)>>>,
}

impl ChannelService for ActivityService {
    async fn get_channel_attachments(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _limit: u16,
        _attachment_type: Option<crate::domain::models::ChannelAttachmentType>,
    ) -> Result<ChannelAttachmentsPage, ChannelMessagesErr> {
        Ok(Vec::<ChannelAttachment>::new()
            .into_iter()
            .paginate_on(50, CreatedAt)
            .filter_on(())
            .into_page())
    }

    async fn get_channel_participants(
        &self,
        _channel_id: Uuid,
    ) -> Result<Vec<ChannelParticipant>, ChannelMessagesErr> {
        Ok(vec![])
    }

    async fn get_attachment_references(
        &self,
        _entity_type: String,
        _entity_id: String,
        _user_id: String,
    ) -> Result<Vec<crate::domain::models::AttachmentEntityReference>, ChannelMessagesErr> {
        Ok(vec![])
    }

    async fn get_activities(&self, user_id: String) -> Result<Vec<Activity>, ChannelMessagesErr> {
        Ok(vec![Activity {
            id: Uuid::nil(),
            user_id,
            channel_id: Uuid::nil(),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            viewed_at: None,
            interacted_at: None,
        }])
    }

    async fn post_activity(
        &self,
        access: EntityAccessReceipt<MemberParticipantRole>,
        activity_type: ActivityType,
    ) -> Result<Activity, ChannelMutationErr> {
        let actor = access.get_authenticated_user().unwrap().to_string();
        let channel_id = Uuid::parse_str(&access.entity().entity_id).unwrap();
        self.posts
            .lock()
            .unwrap()
            .push((actor.clone(), channel_id, activity_type));
        Ok(Activity {
            id: Uuid::nil(),
            user_id: actor,
            channel_id,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            viewed_at: None,
            interacted_at: None,
        })
    }
}

#[tokio::test]
async fn get_activity_returns_user_activities() {
    let router = channels_router(ChannelsRouterState::new(
        ActivityService::default(),
        TestAccessService::allow(),
        authorization_state(),
    ))
    .layer(axum::middleware::map_request(attach_bearer));
    let request = Request::builder()
        .uri("/activity")
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(json.is_array());
    assert_eq!(json[0]["user_id"], "macro|test@example.com");
}

#[tokio::test]
async fn post_activity_records_and_returns_activity() {
    let service = ActivityService::default();
    let posts = service.posts.clone();
    let router = channels_router(ChannelsRouterState::new(
        service,
        TestAccessService::allow(),
        authorization_state(),
    ))
    .layer(axum::middleware::map_request(attach_bearer));
    let channel_id = Uuid::new_v4();
    let request = Request::builder()
        .method("POST")
        .uri("/activity")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::json!({
                "channel_id": channel_id.to_string(),
                "activity_type": "view"
            })
            .to_string(),
        ))
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["channel_id"], channel_id.to_string());

    let posts = posts.lock().unwrap();
    assert_eq!(posts.len(), 1);
    assert_eq!(posts[0].0, "macro|test@example.com");
    assert_eq!(posts[0].1, channel_id);
    assert!(matches!(posts[0].2, ActivityType::View));
}

#[tokio::test]
async fn post_activity_rejects_non_members() {
    let router = channels_router(ChannelsRouterState::new(
        ActivityService::default(),
        TestAccessService::deny(),
        authorization_state(),
    ))
    .layer(axum::middleware::map_request(attach_bearer));
    let request = Request::builder()
        .method("POST")
        .uri("/activity")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::json!({
                "channel_id": Uuid::new_v4().to_string(),
                "activity_type": "view"
            })
            .to_string(),
        ))
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn post_activity_rejects_invalid_channel_id() {
    let router = channels_router(ChannelsRouterState::new(
        ActivityService::default(),
        TestAccessService::allow(),
        authorization_state(),
    ))
    .layer(axum::middleware::map_request(attach_bearer));
    let request = Request::builder()
        .method("POST")
        .uri("/activity")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::json!({
                "channel_id": "not-a-uuid",
                "activity_type": "interact"
            })
            .to_string(),
        ))
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}
