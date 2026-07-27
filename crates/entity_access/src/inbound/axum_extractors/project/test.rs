use crate::domain::models::TeamRole;
use std::sync::{Arc, Mutex};

use axum::{
    body::{Body, to_bytes},
    extract::{FromRef, FromRequest, FromRequestParts},
    http::{Request, StatusCode, header},
    response::IntoResponse,
};
use macro_authorization::{
    BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, BotActingUserClaims, BotAuthentication, BotScope,
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalIdentityClaims,
    MacroAuthorizationError, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId, user_id::MacroUserIdStr};
use model_user::UserContext;
use rootcause::Report;
use uuid::Uuid;

use super::*;
use crate::{
    domain::models::{
        AccessError, BotAccessScope, BotId, CallChannelInfo, EditAccessLevel, EntityAccessAuth,
        UserTeamInfo, ViewAccessLevel,
    },
    inbound::axum_extractors::test_support::{
        BOT_ACTING_USER_ID, BOT_ACTING_USER_ORGANIZATION_ID, BOT_ID, BOT_TEAM_ID, BotAccessCall,
        MALFORMED_SYSTEM_BOT_TOKEN, VALID_BOT_TOKEN, malformed_system_bot_authentication,
        valid_bot_authentication,
    },
};

const PROJECT_ID: &str = "project-1";
const OWNER_ID: &str = "macro|owner@example.com";
const VALID_INTERNAL_KEY: &str = "valid-internal-key";
const USER_ID: &str = "macro|user@example.com";
const INTERNAL_USER_ID: &str = "macro|internal-user@example.com";

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestBody {
    name: String,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    project_parent_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct AccessCall {
    user_id: Option<String>,
    entity_id: String,
    entity_type: EntityType,
}

#[derive(Clone, Debug)]
struct FakeEntityAccessService {
    access_level: Option<AccessLevel>,
    bot_permission: Option<EntityPermission>,
    calls: Arc<Mutex<Vec<AccessCall>>>,
    bot_calls: Arc<Mutex<Vec<BotAccessCall>>>,
}

impl FakeEntityAccessService {
    fn new(access_level: Option<AccessLevel>) -> Self {
        Self {
            access_level,
            bot_permission: access_level
                .map(|access_level| EntityPermission::AccessLevel { access_level }),
            calls: Arc::new(Mutex::new(Vec::new())),
            bot_calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn calls(&self) -> Vec<AccessCall> {
        self.calls.lock().expect("calls lock poisoned").clone()
    }

    fn bot_calls(&self) -> Vec<BotAccessCall> {
        self.bot_calls
            .lock()
            .expect("bot calls lock poisoned")
            .clone()
    }
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
        self.bot_calls
            .lock()
            .expect("bot calls lock poisoned")
            .push(BotAccessCall {
                bot_id,
                scope: scope.clone(),
                entity_id: entity_id.to_string(),
                entity_type,
            });

        let permission = self.bot_permission.ok_or(AccessError::Unauthorized)?;
        EntityAccessReceipt::try_new_bot(
            bot_id.into_storage_id(),
            (&scope).into(),
            Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            permission,
        )
    }

    async fn get_access_level(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(AccessCall {
                user_id: user_id.map(|user_id| user_id.as_ref().to_string()),
                entity_id: entity_id.to_string(),
                entity_type,
            });

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
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        panic!("unexpected get_entity_permission call")
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

#[derive(Clone, Debug, Default)]
struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        match jwt {
            "owner" => Ok(user_context(OWNER_ID)),
            "valid" => Ok(user_context(USER_ID)),
            "expired" => Err(Report::new(MacroAuthorizationError::CredentialsExpired)),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }

    async fn authorize_bot(
        &self,
        token: &str,
        bot_scope: BotScope,
        _claims: Option<BotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        match token {
            VALID_BOT_TOKEN => Ok(valid_bot_authentication(bot_scope)),
            MALFORMED_SYSTEM_BOT_TOKEN => Ok(malformed_system_bot_authentication(bot_scope)),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if provided_key != VALID_INTERNAL_KEY {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(claims.user_id.as_deref().map(user_context))
    }
}

fn user_context(user_id: &str) -> UserContext {
    UserContext {
        user_id: user_id.to_string(),
        fusion_user_id: "fusion-user-id".to_string(),
        organization_id: None,
        permissions: None,
    }
}

#[derive(Clone)]
struct TestState {
    entity_access: Arc<FakeEntityAccessService>,
    authorization: MacroAuthorizationState<FakeAuthorizationService>,
}

impl FromRef<TestState> for Arc<FakeEntityAccessService> {
    fn from_ref(state: &TestState) -> Self {
        state.entity_access.clone()
    }
}

impl FromRef<TestState> for MacroAuthorizationState<FakeAuthorizationService> {
    fn from_ref(state: &TestState) -> Self {
        state.authorization.clone()
    }
}

impl TestState {
    fn new(access_level: Option<AccessLevel>) -> Self {
        Self {
            entity_access: Arc::new(FakeEntityAccessService::new(access_level)),
            authorization: MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
        }
    }
}

type EditExtractor = ProjectBodyAccessLevelExtractorV2<
    EditAccessLevel,
    TestBody,
    FakeEntityAccessService,
    FakeAuthorizationService,
>;
type ViewExtractor = ProjectBodyAccessLevelExtractorV2<
    ViewAccessLevel,
    TestBody,
    FakeEntityAccessService,
    FakeAuthorizationService,
>;

fn json_request(body: &str) -> Request<Body> {
    Request::post("/")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .expect("request should be valid")
}

fn bearer_request(body: &str, token: &str) -> Request<Body> {
    Request::post("/")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(body.to_string()))
        .expect("request should be valid")
}

fn bot_request(body: &str, scope: BotScope, token: &str) -> Request<Body> {
    Request::post("/")
        .header(header::CONTENT_TYPE, "application/json")
        .header(BOT_TOKEN_HEADER, token)
        .header(BOT_SCOPE_HEADER, scope.as_str())
        .body(Body::from(body.to_string()))
        .expect("request should be valid")
}

fn internal_request(body: &str, user_id: Option<&str>) -> Request<Body> {
    let mut request = Request::post("/")
        .header(header::CONTENT_TYPE, "application/json")
        .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY);
    if let Some(user_id) = user_id {
        request = request.header(INTERNAL_MACRO_USER_ID_HEADER, user_id);
    }

    request
        .body(Body::from(body.to_string()))
        .expect("request should be valid")
}

fn project(deleted: bool) -> BasicProject {
    project_owned_by(deleted, OWNER_ID)
}

fn project_owned_by(deleted: bool, owner_id: &'static str) -> BasicProject {
    BasicProject {
        id: PROJECT_ID.to_string(),
        user_id: MacroUserIdStr::parse_from_str(owner_id).expect("owner id should be valid"),
        parent_id: None,
        name: "Test project".to_string(),
        deleted_at: deleted.then(|| {
            "2026-01-01T00:00:00Z"
                .parse()
                .expect("deleted timestamp should be valid")
        }),
    }
}

fn project_request(token: Option<&str>, project: BasicProject) -> Request<Body> {
    let mut request = Request::new(Body::empty());
    request.extensions_mut().insert(project);
    if let Some(token) = token {
        request.headers_mut().insert(
            header::AUTHORIZATION,
            format!("Bearer {token}")
                .parse()
                .expect("header should be valid"),
        );
    }
    request
}

fn bot_project_request(scope: BotScope, token: &str, project: BasicProject) -> Request<Body> {
    let mut request = bot_request("", scope, token);
    request.extensions_mut().insert(project);
    request
}

fn internal_project_request(user_id: Option<&str>, project: BasicProject) -> Request<Body> {
    let mut request = internal_request("", user_id);
    request.extensions_mut().insert(project);
    request
}

async fn extract_project_access<T: RequiredPermission>(
    request: Request<Body>,
    state: &TestState,
) -> Result<
    ProjectAccessLevelExtractor<T, FakeEntityAccessService, FakeAuthorizationService>,
    ExtractorError,
> {
    let (mut parts, _) = request.into_parts();
    ProjectAccessLevelExtractor::from_request_parts(&mut parts, state).await
}

#[tokio::test]
async fn anonymous_project_access_returns_unauthenticated_receipt() {
    let state = TestState::new(Some(AccessLevel::View));
    let extracted =
        extract_project_access::<ViewAccessLevel>(project_request(None, project(false)), &state)
            .await
            .expect("public project access should be allowed");

    assert!(matches!(
        extracted.entity_access_receipt.auth(),
        EntityAccessAuth::Unauthenticated
    ));
    assert_eq!(state.entity_access.calls()[0].user_id, None);
}

#[tokio::test]
async fn authenticated_project_owner_bypasses_access_lookup() {
    let state = TestState::new(None);
    let extracted = extract_project_access::<EditAccessLevel>(
        project_request(Some("owner"), project(false)),
        &state,
    )
    .await
    .expect("the project owner should be allowed");

    assert!(matches!(
        extracted.entity_access_receipt.entity_permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner
        }
    ));
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn user_scoped_bot_project_owner_delegates_to_the_service() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let extracted = extract_project_access::<EditAccessLevel>(
        bot_project_request(
            BotScope::User,
            VALID_BOT_TOKEN,
            project_owned_by(false, BOT_ACTING_USER_ID),
        ),
        &state,
    )
    .await
    .expect("the scoped service should delegate owner access");

    assert_eq!(
        extracted
            .entity_access_receipt
            .get_authenticated_bot()
            .expect("receipt should authenticate the bot")
            .bot_id(),
        BOT_ID
    );
    assert!(matches!(
        extracted.entity_access_receipt.entity_permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner
        }
    ));
    assert_eq!(
        state.entity_access.bot_calls(),
        [BotAccessCall {
            bot_id: BOT_ID,
            scope: BotAccessScope::User {
                user_id: MacroUserIdStr::parse_from_str(BOT_ACTING_USER_ID)
                    .expect("bot acting user id should be valid"),
                user_org_id: Some(i64::from(BOT_ACTING_USER_ORGANIZATION_ID)),
            },
            entity_id: PROJECT_ID.to_string(),
            entity_type: EntityType::Project,
        }]
    );
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn team_scoped_bot_project_access_uses_the_scoped_service() {
    let state = TestState::new(Some(AccessLevel::Edit));
    let extracted = extract_project_access::<EditAccessLevel>(
        bot_project_request(BotScope::Team, VALID_BOT_TOKEN, project(false)),
        &state,
    )
    .await
    .expect("team-scoped project access should be allowed");

    assert!(matches!(
        extracted.entity_access_receipt.auth(),
        EntityAccessAuth::Bot(_)
    ));
    assert_eq!(
        state.entity_access.bot_calls(),
        [BotAccessCall {
            bot_id: BOT_ID,
            scope: BotAccessScope::Team {
                team_id: BOT_TEAM_ID,
            },
            entity_id: PROJECT_ID.to_string(),
            entity_type: EntityType::Project,
        }]
    );
}

#[tokio::test]
async fn user_scoped_bot_without_acting_user_is_rejected() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let result = extract_project_access::<ViewAccessLevel>(
        bot_project_request(BotScope::User, MALFORMED_SYSTEM_BOT_TOKEN, project(false)),
        &state,
    )
    .await;

    assert!(matches!(
        result,
        Err(ExtractorError::UnauthorizedWithMessage(
            "bot user scope requires an acting user"
        ))
    ));
    assert!(state.entity_access.bot_calls().is_empty());
}

#[tokio::test]
async fn bot_project_access_below_the_required_level_is_rejected() {
    let state = TestState::new(Some(AccessLevel::View));
    let result = extract_project_access::<EditAccessLevel>(
        bot_project_request(BotScope::Team, VALID_BOT_TOKEN, project(false)),
        &state,
    )
    .await;

    assert!(matches!(result, Err(ExtractorError::Unauthorized)));
    assert_eq!(state.entity_access.bot_calls().len(), 1);
}

#[tokio::test]
async fn deleted_project_requires_owner_permission_from_the_bot_service() {
    let owner_state = TestState::new(Some(AccessLevel::Owner));
    let extracted = extract_project_access::<ViewAccessLevel>(
        bot_project_request(BotScope::Team, VALID_BOT_TOKEN, project(true)),
        &owner_state,
    )
    .await
    .expect("a bot receipt with owner permission should access a deleted project");
    assert!(matches!(
        extracted.entity_access_receipt.entity_permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner
        }
    ));

    let view_state = TestState::new(Some(AccessLevel::View));
    let result = extract_project_access::<ViewAccessLevel>(
        bot_project_request(BotScope::Team, VALID_BOT_TOKEN, project(true)),
        &view_state,
    )
    .await;
    assert!(matches!(
        result,
        Err(ExtractorError::UnauthorizedWithMessage(
            "only owner can access deleted resource"
        ))
    ));
    assert_eq!(view_state.entity_access.bot_calls().len(), 1);
}

#[tokio::test]
async fn deleted_project_rejects_non_owner_before_access_lookup() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let result = extract_project_access::<ViewAccessLevel>(
        project_request(Some("valid"), project(true)),
        &state,
    )
    .await;

    assert!(matches!(
        result,
        Err(ExtractorError::UnauthorizedWithMessage(
            "only owner can access deleted resource"
        ))
    ));
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn identity_less_internal_project_access_receives_owner_without_lookup() {
    let state = TestState::new(None);
    let extracted = extract_project_access::<EditAccessLevel>(
        internal_project_request(None, project(false)),
        &state,
    )
    .await
    .expect("identity-less internal access should be allowed");

    assert!(matches!(
        extracted.entity_access_receipt.auth(),
        EntityAccessAuth::Internal
    ));
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn internal_project_act_as_identity_uses_acl() {
    let state = TestState::new(Some(AccessLevel::Edit));
    let extracted = extract_project_access::<EditAccessLevel>(
        internal_project_request(Some(INTERNAL_USER_ID), project(false)),
        &state,
    )
    .await
    .expect("the internal identity should use its project ACL");

    assert!(matches!(
        extracted.entity_access_receipt.auth(),
        EntityAccessAuth::Authenticated(user_id) if user_id.as_ref() == INTERNAL_USER_ID
    ));
    assert_eq!(
        state.entity_access.calls(),
        [AccessCall {
            user_id: Some(INTERNAL_USER_ID.to_string()),
            entity_id: PROJECT_ID.to_string(),
            entity_type: EntityType::Project,
        }]
    );
}

#[tokio::test]
async fn direct_project_id_with_sufficient_access_returns_receipt_and_body() {
    let state = TestState::new(Some(AccessLevel::Edit));
    let result = EditExtractor::from_request(
        bearer_request(r#"{"name":"document","projectId":"project-1"}"#, "valid"),
        &state,
    )
    .await
    .expect("edit access should be allowed");

    let ProjectBodyAccessLevelExtractorV2::FoundProject {
        project,
        entity_access_receipt,
        body,
        ..
    } = result
    else {
        panic!("project should be found")
    };

    assert_eq!(project.id(), "project-1");
    assert_eq!(body.name, "document");
    assert_eq!(body.project_id.as_deref(), Some("project-1"));
    assert!(body.project_parent_id.is_none());
    assert_eq!(entity_access_receipt.entity().entity_id, "project-1");
    assert!(matches!(
        entity_access_receipt.entity_permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit
        }
    ));
    assert!(matches!(
        entity_access_receipt.auth(),
        EntityAccessAuth::Authenticated(user_id) if user_id.to_string() == USER_ID
    ));
    assert_eq!(
        state.entity_access.calls(),
        [AccessCall {
            user_id: Some(USER_ID.to_string()),
            entity_id: "project-1".to_string(),
            entity_type: EntityType::Project,
        }]
    );
}

#[tokio::test]
async fn user_scoped_bot_project_body_access_preserves_the_typed_body() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let result = EditExtractor::from_request(
        bot_request(
            r#"{"name":"document","projectId":"project-1"}"#,
            BotScope::User,
            VALID_BOT_TOKEN,
        ),
        &state,
    )
    .await
    .expect("the user-scoped bot should receive delegated owner access");

    let ProjectBodyAccessLevelExtractorV2::FoundProject {
        entity_access_receipt,
        body,
        ..
    } = result
    else {
        panic!("project should be found")
    };

    assert_eq!(body.name, "document");
    assert_eq!(body.project_id.as_deref(), Some(PROJECT_ID));
    assert!(matches!(
        entity_access_receipt.auth(),
        EntityAccessAuth::Bot(_)
    ));
    assert!(matches!(
        entity_access_receipt.entity_permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner
        }
    ));
    assert_eq!(
        state.entity_access.bot_calls(),
        [BotAccessCall {
            bot_id: BOT_ID,
            scope: BotAccessScope::User {
                user_id: MacroUserIdStr::parse_from_str(BOT_ACTING_USER_ID)
                    .expect("bot acting user id should be valid"),
                user_org_id: Some(i64::from(BOT_ACTING_USER_ORGANIZATION_ID)),
            },
            entity_id: PROJECT_ID.to_string(),
            entity_type: EntityType::Project,
        }]
    );
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn team_scoped_bot_project_body_access_uses_the_scoped_service() {
    let state = TestState::new(Some(AccessLevel::Edit));
    let result = EditExtractor::from_request(
        bot_request(
            r#"{"name":"document","projectParentId":"parent-project"}"#,
            BotScope::Team,
            VALID_BOT_TOKEN,
        ),
        &state,
    )
    .await
    .expect("team-scoped bot access should be allowed");

    let ProjectBodyAccessLevelExtractorV2::FoundProject { project, body, .. } = result else {
        panic!("parent project should be found")
    };
    assert_eq!(project.id(), "parent-project");
    assert_eq!(body.project_parent_id.as_deref(), Some("parent-project"));
    assert_eq!(
        state.entity_access.bot_calls(),
        [BotAccessCall {
            bot_id: BOT_ID,
            scope: BotAccessScope::Team {
                team_id: BOT_TEAM_ID,
            },
            entity_id: "parent-project".to_string(),
            entity_type: EntityType::Project,
        }]
    );
}

#[tokio::test]
async fn user_scoped_bot_project_body_without_acting_user_is_rejected() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let result = EditExtractor::from_request(
        bot_request(
            r#"{"name":"document","projectId":"project-1"}"#,
            BotScope::User,
            MALFORMED_SYSTEM_BOT_TOKEN,
        ),
        &state,
    )
    .await;

    assert!(matches!(
        result,
        Err(ExtractorError::UnauthorizedWithMessage(
            "bot user scope requires an acting user"
        ))
    ));
    assert!(state.entity_access.bot_calls().is_empty());
}

#[tokio::test]
async fn bot_project_body_access_below_the_required_level_is_rejected() {
    let state = TestState::new(Some(AccessLevel::View));
    let result = EditExtractor::from_request(
        bot_request(
            r#"{"name":"document","projectId":"project-1"}"#,
            BotScope::Team,
            VALID_BOT_TOKEN,
        ),
        &state,
    )
    .await;

    assert!(matches!(result, Err(ExtractorError::Unauthorized)));
    assert_eq!(state.entity_access.bot_calls().len(), 1);
}

#[tokio::test]
async fn parent_project_id_is_used_for_access_lookup() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let result = EditExtractor::from_request(
        bearer_request(
            r#"{"name":"document","projectParentId":"parent-project"}"#,
            "valid",
        ),
        &state,
    )
    .await
    .expect("owner access should be allowed");

    let ProjectBodyAccessLevelExtractorV2::FoundProject { project, body, .. } = result else {
        panic!("parent project should be found")
    };

    assert_eq!(project.id(), "parent-project");
    assert_eq!(body.project_parent_id.as_deref(), Some("parent-project"));
    assert_eq!(state.entity_access.calls()[0].entity_id, "parent-project");
}

#[tokio::test]
async fn insufficient_access_level_is_rejected() {
    let state = TestState::new(Some(AccessLevel::View));
    let result = EditExtractor::from_request(
        bearer_request(r#"{"name":"document","projectId":"project-1"}"#, "valid"),
        &state,
    )
    .await;

    assert!(matches!(result, Err(ExtractorError::Unauthorized)));
}

#[tokio::test]
async fn anonymous_without_project_access_is_rejected() {
    let state = TestState::new(None);
    let result = EditExtractor::from_request(
        json_request(r#"{"name":"document","projectId":"project-1"}"#),
        &state,
    )
    .await;

    assert!(matches!(result, Err(ExtractorError::Unauthorized)));
    assert_eq!(state.entity_access.calls()[0].user_id, None);
}

#[tokio::test]
async fn absent_project_returns_the_parsed_body_without_access_lookup() {
    let state = TestState::new(None);
    let result = EditExtractor::from_request(json_request(r#"{"name":"document"}"#), &state)
        .await
        .expect("a project is optional");

    let ProjectBodyAccessLevelExtractorV2::ProjectNotInBody { body, .. } = result else {
        panic!("project should not be found")
    };

    assert_eq!(body.name, "document");
    assert!(body.project_id.is_none());
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn empty_project_id_returns_no_project_without_access_lookup() {
    let state = TestState::new(None);
    let result = EditExtractor::from_request(
        json_request(r#"{"name":"document","projectId":""}"#),
        &state,
    )
    .await
    .expect("an empty project id clears the project");

    assert!(matches!(
        result,
        ProjectBodyAccessLevelExtractorV2::ProjectNotInBody { .. }
    ));
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn malformed_json_and_invalid_body_are_distinguished() {
    let state = TestState::new(Some(AccessLevel::Edit));
    let malformed_json = EditExtractor::from_request(json_request("{"), &state).await;
    assert!(matches!(
        malformed_json,
        Err(ExtractorError::BadRequest("Invalid JSON body"))
    ));

    let invalid_body = EditExtractor::from_request(
        json_request(r#"{"name":42,"projectId":"project-1"}"#),
        &state,
    )
    .await;
    assert!(matches!(
        invalid_body,
        Err(ExtractorError::BadRequest("Invalid request body"))
    ));
}

#[tokio::test]
async fn bot_project_body_parse_failures_are_preserved() {
    let malformed_state = TestState::new(Some(AccessLevel::Edit));
    let malformed_json = EditExtractor::from_request(
        bot_request("{", BotScope::Team, VALID_BOT_TOKEN),
        &malformed_state,
    )
    .await;
    assert!(matches!(
        malformed_json,
        Err(ExtractorError::BadRequest("Invalid JSON body"))
    ));
    assert!(malformed_state.entity_access.bot_calls().is_empty());

    let invalid_body_state = TestState::new(Some(AccessLevel::Edit));
    let invalid_body = EditExtractor::from_request(
        bot_request(
            r#"{"name":42,"projectId":"project-1"}"#,
            BotScope::Team,
            VALID_BOT_TOKEN,
        ),
        &invalid_body_state,
    )
    .await;
    assert!(matches!(
        invalid_body,
        Err(ExtractorError::BadRequest("Invalid request body"))
    ));
    assert_eq!(invalid_body_state.entity_access.bot_calls().len(), 1);
}

#[tokio::test]
async fn anonymous_access_uses_public_project_access() {
    let state = TestState::new(Some(AccessLevel::View));
    let result = ViewExtractor::from_request(
        json_request(r#"{"name":"document","projectId":"public-project"}"#),
        &state,
    )
    .await
    .expect("anonymous view access should be allowed");

    let ProjectBodyAccessLevelExtractorV2::FoundProject {
        entity_access_receipt,
        ..
    } = result
    else {
        panic!("project should be found")
    };

    assert!(matches!(
        entity_access_receipt.auth(),
        EntityAccessAuth::Unauthenticated
    ));
    assert_eq!(state.entity_access.calls()[0].user_id, None);
}

#[tokio::test]
async fn identity_less_internal_access_receives_owner_without_acl_lookup() {
    let state = TestState::new(None);
    let result = EditExtractor::from_request(
        internal_request(
            r#"{"name":"document","projectId":"internal-project"}"#,
            None,
        ),
        &state,
    )
    .await
    .expect("identity-less internal access should be allowed");

    let ProjectBodyAccessLevelExtractorV2::FoundProject {
        entity_access_receipt,
        ..
    } = result
    else {
        panic!("project should be found")
    };

    assert!(matches!(
        entity_access_receipt.auth(),
        EntityAccessAuth::Internal
    ));
    assert!(matches!(
        entity_access_receipt.entity_permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner
        }
    ));
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn internal_act_as_identity_must_satisfy_project_acl() {
    let state = TestState::new(Some(AccessLevel::View));
    let result = EditExtractor::from_request(
        internal_request(
            r#"{"name":"document","projectId":"internal-project"}"#,
            Some(INTERNAL_USER_ID),
        ),
        &state,
    )
    .await;

    assert!(matches!(result, Err(ExtractorError::Unauthorized)));
    assert_eq!(
        state.entity_access.calls(),
        [AccessCall {
            user_id: Some(INTERNAL_USER_ID.to_string()),
            entity_id: "internal-project".to_string(),
            entity_type: EntityType::Project,
        }]
    );
}

#[tokio::test]
async fn expired_token_rejection_is_preserved() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let error = EditExtractor::from_request(
        bearer_request(r#"{"name":"document","projectId":"project-1"}"#, "expired"),
        &state,
    )
    .await
    .expect_err("an expired token should be rejected");

    let response = error.into_response();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should be readable");
    assert_eq!(body.as_ref(), br#"{"message":"jwt expired"}"#);
    assert!(state.entity_access.calls().is_empty());
}

#[test]
fn into_inner_matches_both_v2_variants() {
    let without_project = EditExtractor::ProjectNotInBody {
        body: TestBody {
            name: "without project".to_string(),
            project_id: None,
            project_parent_id: None,
        },
        _marker: PhantomData,
    };
    assert_eq!(without_project.into_inner().name, "without project");

    let with_project = EditExtractor::FoundProject {
        project: ProjectOrParentId::ProjectId(ProjectId {
            project_id: "project-1".to_string(),
        }),
        desired: PhantomData,
        entity_access_receipt: EntityAccessReceipt::dangerously_assert_internal_user(
            "project-1",
            EntityType::Project,
        ),
        body: TestBody {
            name: "with project".to_string(),
            project_id: Some("project-1".to_string()),
            project_parent_id: None,
        },
    };
    assert_eq!(with_project.into_inner().name, "with project");
}
