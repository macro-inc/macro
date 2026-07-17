use axum::Extension;
use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState,
};
use macro_user_id::user_id::MacroUserIdStr;
use model::chat::ChatBasic;
use model::response::StringIDResponse;
use model::user::UserContext;
use rootcause::Report;
use std::sync::Arc;
use tower::util::ServiceExt;

use crate::domain::models::{
    ChatErr, ChatResponse, CreateChatArgs, GetChatResponse, PatchChatArgs, Result,
};
use crate::domain::ports::ChatService;
use crate::inbound::http::router::{ChatRouterState, chat_create_router, chat_id_router};
use ai_toolset::tool_object::UserToolResponse;
use entity_access::domain::models::{
    AccessError, AccessLevel, BotId, EditAccessLevel, EntityAccessReceipt, EntityPermission,
    EntityType, OwnerAccessLevel, UserTeamInfo, ViewAccessLevel,
};
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::lowercased::Lowercase;
use macro_user_id::user_id::MacroUserId;

struct MockService;

impl ChatService for MockService {
    async fn create(
        &self,
        _user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        _args: CreateChatArgs,
    ) -> Result<String> {
        Ok("test-chat-id".to_string())
    }

    #[allow(deprecated)]
    async fn get_chat(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<GetChatResponse> {
        let chat_id = entity_access_receipt.entity().entity_id.clone();
        Ok(GetChatResponse {
            chat: ChatResponse {
                id: chat_id,
                user_id: "macro|test@example.com".to_string(),
                project_id: None,
                name: "Mock Chat".to_string(),
                messages: Vec::new(),
                model: None,
                created_at: None,
                updated_at: None,
            },
            user_access_level: AccessLevel::Owner,
        })
    }

    async fn copy_chat(
        &self,
        _entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String> {
        Ok("copied-chat-id".to_string())
    }

    async fn delete(
        &self,
        _entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<()> {
        Ok(())
    }

    async fn permanently_delete(
        &self,
        _entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<()> {
        Ok(())
    }

    async fn patch(
        &self,
        _entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _args: PatchChatArgs,
    ) -> Result<()> {
        Ok(())
    }

    async fn revert_delete(
        &self,
        _entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<()> {
        Ok(())
    }

    async fn get_permissions(
        &self,
        _entity_access_receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<models_permissions::share_permission::SharePermissionV2> {
        Err(ChatErr::Unknown(anyhow::anyhow!("not implemented")))
    }

    async fn update_tool_call(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _message_id: &str,
        _tool_call_id: &str,
        _new_args: serde_json::Value,
    ) -> Result<()> {
        Ok(())
    }

    async fn update_tool_response(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _message_id: &str,
        _tool_call_id: &str,
        _response: UserToolResponse<serde_json::Value>,
    ) -> Result<()> {
        Ok(())
    }

    async fn call_tool(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _message_id: &str,
        _tool_call_id: &str,
        _args: Option<serde_json::Value>,
    ) -> Result<serde_json::Value> {
        Ok(serde_json::json!({
            "argsWasProvided": _args.is_some(),
            "args": _args,
        }))
    }

    async fn reject_tool_call(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _message_id: &str,
        _tool_call_id: &str,
    ) -> Result<()> {
        Ok(())
    }
}

struct ErrorService;

impl ChatService for ErrorService {
    async fn create(
        &self,
        _user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        _args: CreateChatArgs,
    ) -> Result<String> {
        Err(ChatErr::Unknown(anyhow::anyhow!("db error")))
    }

    async fn get_chat(
        &self,
        _entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<GetChatResponse> {
        Err(ChatErr::Unknown(anyhow::anyhow!("db error")))
    }

    async fn copy_chat(
        &self,
        _entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String> {
        Err(ChatErr::Unknown(anyhow::anyhow!("db error")))
    }

    async fn delete(
        &self,
        _entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<()> {
        Err(ChatErr::Unknown(anyhow::anyhow!("db error")))
    }

    async fn permanently_delete(
        &self,
        _entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<()> {
        Err(ChatErr::Unknown(anyhow::anyhow!("db error")))
    }

    async fn patch(
        &self,
        _entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _args: PatchChatArgs,
    ) -> Result<()> {
        Err(ChatErr::Unknown(anyhow::anyhow!("db error")))
    }

    async fn revert_delete(
        &self,
        _entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<()> {
        Err(ChatErr::Unknown(anyhow::anyhow!("db error")))
    }

    async fn get_permissions(
        &self,
        _entity_access_receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<models_permissions::share_permission::SharePermissionV2> {
        Err(ChatErr::Unknown(anyhow::anyhow!("db error")))
    }

    async fn update_tool_call(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _message_id: &str,
        _tool_call_id: &str,
        _new_args: serde_json::Value,
    ) -> Result<()> {
        Err(ChatErr::Unknown(anyhow::anyhow!("db error")))
    }

    async fn update_tool_response(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _message_id: &str,
        _tool_call_id: &str,
        _response: UserToolResponse<serde_json::Value>,
    ) -> Result<()> {
        Err(ChatErr::Unknown(anyhow::anyhow!("db error")))
    }

    async fn call_tool(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _message_id: &str,
        _tool_call_id: &str,
        _args: Option<serde_json::Value>,
    ) -> Result<serde_json::Value> {
        Err(ChatErr::Unknown(anyhow::anyhow!("db error")))
    }

    async fn reject_tool_call(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _message_id: &str,
        _tool_call_id: &str,
    ) -> Result<()> {
        Err(ChatErr::Unknown(anyhow::anyhow!("db error")))
    }
}

struct NotFoundService;

impl ChatService for NotFoundService {
    async fn create(
        &self,
        _user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        _args: CreateChatArgs,
    ) -> Result<String> {
        Err(ChatErr::Unknown(anyhow::anyhow!("db error")))
    }

    async fn get_chat(
        &self,
        _entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<GetChatResponse> {
        Err(ChatErr::NotFound)
    }

    async fn copy_chat(
        &self,
        _entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String> {
        Err(ChatErr::NotFound)
    }

    async fn delete(
        &self,
        _entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<()> {
        Err(ChatErr::Unknown(anyhow::anyhow!("db error")))
    }

    async fn permanently_delete(
        &self,
        _entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<()> {
        Err(ChatErr::Unknown(anyhow::anyhow!("db error")))
    }

    async fn patch(
        &self,
        _entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _args: PatchChatArgs,
    ) -> Result<()> {
        Err(ChatErr::Unknown(anyhow::anyhow!("db error")))
    }

    async fn revert_delete(
        &self,
        _entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<()> {
        Err(ChatErr::Unknown(anyhow::anyhow!("db error")))
    }

    async fn get_permissions(
        &self,
        _entity_access_receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<models_permissions::share_permission::SharePermissionV2> {
        Err(ChatErr::Unknown(anyhow::anyhow!("db error")))
    }

    async fn update_tool_call(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _message_id: &str,
        _tool_call_id: &str,
        _new_args: serde_json::Value,
    ) -> Result<()> {
        Err(ChatErr::NotFound)
    }

    async fn update_tool_response(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _message_id: &str,
        _tool_call_id: &str,
        _response: UserToolResponse<serde_json::Value>,
    ) -> Result<()> {
        Err(ChatErr::NotFound)
    }

    async fn call_tool(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _message_id: &str,
        _tool_call_id: &str,
        _args: Option<serde_json::Value>,
    ) -> Result<serde_json::Value> {
        Err(ChatErr::NotFound)
    }

    async fn reject_tool_call(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _message_id: &str,
        _tool_call_id: &str,
    ) -> Result<()> {
        Err(ChatErr::NotFound)
    }
}

#[derive(Clone)]
struct MockAccessService;

impl EntityAccessService for MockAccessService {
    async fn generate_entity_access_receipt<
        T: entity_access::domain::models::RequiredPermission,
    >(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> std::result::Result<entity_access::domain::models::EntityAccessReceipt<T>, AccessError>
    {
        unreachable!("not used by ChatAccessLevelExtractor")
    }

    async fn generate_bot_entity_access_receipt<
        T: entity_access::domain::models::RequiredPermission,
    >(
        &self,
        _bot_id: BotId,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> std::result::Result<entity_access::domain::models::EntityAccessReceipt<T>, AccessError>
    {
        unreachable!("not used by ChatAccessLevelExtractor")
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> std::result::Result<Option<AccessLevel>, AccessError> {
        Ok(Some(AccessLevel::Owner))
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> std::result::Result<AccessLevel, AccessError> {
        Ok(AccessLevel::Owner)
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> std::result::Result<AccessLevel, AccessError> {
        Ok(AccessLevel::Owner)
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> std::result::Result<EntityPermission, AccessError> {
        Ok(EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        })
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> std::result::Result<(EntityPermission, uuid::Uuid), AccessError> {
        unimplemented!("chat test mock does not support CRM entity access")
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> std::result::Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Ok(vec![])
    }

    async fn get_call_channel(
        &self,
        _call_id: &sqlx::types::Uuid,
    ) -> std::result::Result<Option<entity_access::domain::models::CallChannelInfo>, AccessError>
    {
        unimplemented!()
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &sqlx::types::Uuid,
    ) -> std::result::Result<Option<entity_access::domain::models::CallChannelInfo>, AccessError>
    {
        unimplemented!()
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> std::result::Result<Option<UserTeamInfo>, AccessError> {
        unimplemented!()
    }
}

/// Fake authorization service accepting the `valid` bearer token as the test
/// user.
#[derive(Clone)]
struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(
        &self,
        jwt: &str,
    ) -> std::result::Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != "valid" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(UserContext {
            user_id: "macro|test@example.com".to_string(),
            fusion_user_id: "1234".to_string(),
            permissions: None,
            organization_id: None,
        })
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> std::result::Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

fn authorization_state() -> MacroAuthorizationState<FakeAuthorizationService> {
    MacroAuthorizationState::new(Arc::new(FakeAuthorizationService))
}

/// Fake roles-and-permissions service granting no permissions (free tier).
#[derive(Clone)]
struct FakeUserPermissionsService;

impl roles_and_permissions::domain::port::UserRolesAndPermissionsService
    for FakeUserPermissionsService
{
    async fn get_user_roles(
        &self,
        _user_id: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> std::result::Result<
        std::collections::HashSet<roles_and_permissions::domain::model::RoleId>,
        roles_and_permissions::domain::model::UserRolesAndPermissionsError,
    > {
        Ok(std::collections::HashSet::new())
    }

    async fn get_user_permissions(
        &self,
        _user_id: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> std::result::Result<
        std::collections::HashSet<roles_and_permissions::domain::model::PermissionId>,
        roles_and_permissions::domain::model::UserRolesAndPermissionsError,
    > {
        Ok(std::collections::HashSet::new())
    }

    async fn update_user_roles_and_permissions_for_subscription(
        &self,
        _email: macro_user_id::email::Email<macro_user_id::lowercased::Lowercase<'_>>,
        _subscription_status: roles_and_permissions::domain::model::SubscriptionStatus,
        _product_tier: roles_and_permissions::domain::model::ProductTier,
    ) -> std::result::Result<(), roles_and_permissions::domain::model::UserRolesAndPermissionsError>
    {
        unimplemented!("not used by chat handlers")
    }

    async fn dangerous_upsert_roles_for_user(
        &self,
        _user_id: &macro_user_id::user_id::MacroUserIdStr<'_>,
        _role_ids: non_empty::NonEmpty<&[roles_and_permissions::domain::model::RoleId]>,
    ) -> std::result::Result<(), roles_and_permissions::domain::model::UserRolesAndPermissionsError>
    {
        unimplemented!("not used by chat handlers")
    }

    async fn dangerous_remove_roles_from_user(
        &self,
        _user_id: &macro_user_id::user_id::MacroUserIdStr<'_>,
        _role_ids: &non_empty::NonEmpty<&[roles_and_permissions::domain::model::RoleId]>,
    ) -> std::result::Result<(), roles_and_permissions::domain::model::UserRolesAndPermissionsError>
    {
        unimplemented!("not used by chat handlers")
    }
}

fn permissions_service() -> Arc<FakeUserPermissionsService> {
    Arc::new(FakeUserPermissionsService)
}

/// Attaches the test user's bearer token to every request, mirroring the
/// credentials a real client would send.
async fn attach_bearer(mut req: Request<Body>) -> Request<Body> {
    req.headers_mut().insert(
        header::AUTHORIZATION,
        "Bearer valid".parse().expect("header should be valid"),
    );
    req
}

fn chat_basic_extension() -> Extension<ChatBasic> {
    Extension(ChatBasic {
        id: "some-chat-id".to_string(),
        name: "Mock Chat".to_string(),
        user_id: macro_user_id::user_id::MacroUserIdStr::try_from(
            "macro|test@example.com".to_string(),
        )
        .unwrap(),
        project_id: None,
        deleted_at: None,
    })
}

fn mock_id_router() -> Router {
    chat_id_router(ChatRouterState::new(
        MockService,
        MockAccessService,
        authorization_state(),
        permissions_service(),
    ))
    .layer(chat_basic_extension())
    .layer(axum::middleware::map_request(attach_bearer))
}

fn error_id_router() -> Router {
    chat_id_router(ChatRouterState::new(
        ErrorService,
        MockAccessService,
        authorization_state(),
        permissions_service(),
    ))
    .layer(chat_basic_extension())
    .layer(axum::middleware::map_request(attach_bearer))
}

fn not_found_id_router() -> Router {
    chat_id_router(ChatRouterState::new(
        NotFoundService,
        MockAccessService,
        authorization_state(),
        permissions_service(),
    ))
    .layer(chat_basic_extension())
    .layer(axum::middleware::map_request(attach_bearer))
}

fn mock_create_router() -> Router {
    chat_create_router(ChatRouterState::new(
        MockService,
        MockAccessService,
        authorization_state(),
        permissions_service(),
    ))
    .layer(axum::middleware::map_request(attach_bearer))
}

// -- create_chat tests --

#[tokio::test]
async fn create_chat_returns_id() {
    let req = Request::builder()
        .method("POST")
        .uri("/")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"name": "My Chat"}"#))
        .unwrap();

    let res = mock_create_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body = res.into_body().collect().await.unwrap().to_bytes();
    let response: StringIDResponse = serde_json::from_slice(&body).unwrap();
    assert_eq!(response.id, "test-chat-id");
}

// -- get_chat tests --

#[tokio::test]
async fn get_chat_returns_chat() {
    let req = Request::builder()
        .uri("/some-chat-id")
        .body(Body::empty())
        .unwrap();

    let res = mock_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body = res.into_body().collect().await.unwrap().to_bytes();
    let response: GetChatResponse = serde_json::from_slice(&body).unwrap();
    assert_eq!(response.chat.id, "some-chat-id");
    assert_eq!(response.chat.name, "Mock Chat");
    assert_eq!(response.user_access_level, AccessLevel::Owner);
}

#[tokio::test]
async fn get_chat_not_found_returns_404() {
    let req = Request::builder()
        .uri("/nonexistent")
        .body(Body::empty())
        .unwrap();

    let res = not_found_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn get_chat_repo_error_returns_500() {
    let req = Request::builder()
        .uri("/some-chat-id")
        .body(Body::empty())
        .unwrap();

    let res = error_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

// -- delete_chat tests --

#[tokio::test]
async fn delete_chat_returns_ok() {
    let req = Request::builder()
        .method("DELETE")
        .uri("/some-chat-id")
        .body(Body::empty())
        .unwrap();

    let res = mock_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn delete_chat_repo_error_returns_500() {
    let req = Request::builder()
        .method("DELETE")
        .uri("/some-chat-id")
        .body(Body::empty())
        .unwrap();

    let res = error_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

// -- permanently_delete_chat tests --

#[tokio::test]
async fn permanently_delete_chat_returns_ok() {
    let req = Request::builder()
        .method("DELETE")
        .uri("/some-chat-id/permanent")
        .body(Body::empty())
        .unwrap();

    let res = mock_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn permanently_delete_chat_repo_error_returns_500() {
    let req = Request::builder()
        .method("DELETE")
        .uri("/some-chat-id/permanent")
        .body(Body::empty())
        .unwrap();

    let res = error_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

// -- patch_chat tests --

#[tokio::test]
async fn patch_chat_returns_ok() {
    let req = Request::builder()
        .method("PATCH")
        .uri("/some-chat-id")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"name": "Renamed"}"#))
        .unwrap();

    let res = mock_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn patch_chat_repo_error_returns_500() {
    let req = Request::builder()
        .method("PATCH")
        .uri("/some-chat-id")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"name": "Renamed"}"#))
        .unwrap();

    let res = error_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

// -- copy_chat tests --

#[tokio::test]
async fn copy_chat_returns_id() {
    let req = Request::builder()
        .method("POST")
        .uri("/some-chat-id/copy")
        .body(Body::empty())
        .unwrap();

    let res = mock_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body = res.into_body().collect().await.unwrap().to_bytes();
    let response: StringIDResponse = serde_json::from_slice(&body).unwrap();
    assert_eq!(response.id, "copied-chat-id");
}

#[tokio::test]
async fn copy_chat_repo_error_returns_500() {
    let req = Request::builder()
        .method("POST")
        .uri("/some-chat-id/copy")
        .body(Body::empty())
        .unwrap();

    let res = error_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

// -- revert_delete tests --

#[tokio::test]
async fn revert_delete_returns_ok() {
    let req = Request::builder()
        .method("PUT")
        .uri("/some-chat-id/revert_delete")
        .body(Body::empty())
        .unwrap();

    let res = mock_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn revert_delete_repo_error_returns_500() {
    let req = Request::builder()
        .method("PUT")
        .uri("/some-chat-id/revert_delete")
        .body(Body::empty())
        .unwrap();

    let res = error_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

// -- get_chat_permissions tests --

#[tokio::test]
async fn get_permissions_repo_error_returns_500() {
    let req = Request::builder()
        .uri("/some-chat-id/permissions")
        .body(Body::empty())
        .unwrap();

    let res = error_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

// -- tool handler tests --

#[tokio::test]
async fn update_tool_call_returns_ok() {
    let req = Request::builder()
        .method("POST")
        .uri("/some-chat-id/tool/update")
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{"messageId":"message-1","toolCallId":"tool-1","args":{"x":1}}"#,
        ))
        .unwrap();

    let res = mock_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn update_tool_response_returns_ok() {
    let req = Request::builder()
        .method("POST")
        .uri("/some-chat-id/tool/response/update")
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{"messageId":"message-1","toolCallId":"tool-1","response":{"UserAction":{"draftId":"draft-1"}}}"#,
        ))
        .unwrap();

    let res = mock_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn call_tool_returns_result() {
    let req = Request::builder()
        .method("POST")
        .uri("/some-chat-id/tool/call")
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{"messageId":"message-1","toolCallId":"tool-1","args":{"x":1}}"#,
        ))
        .unwrap();

    let res = mock_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body = res.into_body().collect().await.unwrap().to_bytes();
    let response: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        response,
        serde_json::json!({
            "result": {
                "argsWasProvided": true,
                "args": { "x": 1 },
            }
        })
    );
}

#[tokio::test]
async fn call_tool_forwards_missing_args() {
    let req = Request::builder()
        .method("POST")
        .uri("/some-chat-id/tool/call")
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{"messageId":"message-1","toolCallId":"tool-1"}"#,
        ))
        .unwrap();

    let res = mock_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body = res.into_body().collect().await.unwrap().to_bytes();
    let response: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        response,
        serde_json::json!({
            "result": {
                "argsWasProvided": false,
                "args": null,
            }
        })
    );
}

#[tokio::test]
async fn reject_tool_call_returns_ok() {
    let req = Request::builder()
        .method("POST")
        .uri("/some-chat-id/tool/reject")
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{"messageId":"message-1","toolCallId":"tool-1"}"#,
        ))
        .unwrap();

    let res = mock_id_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}
