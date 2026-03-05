use axum::Extension;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use model::chat::{Chat, ChatBasic};
use model::response::StringIDResponse;
use model_user::UserContext;
use tower::util::ServiceExt;

use super::*;
use crate::domain::ports::ChatRepo;
use crate::models::{ChatResponse, CopyChatArgs, CreateChatArgs, GetChatResponse, PatchChatArgs};
use entity_access::domain::models::{AccessError, AccessLevel, EntityPermission, EntityType};
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::lowercased::Lowercase;
use macro_user_id::user_id::MacroUserId;

struct MockRepo;

impl ChatRepo for MockRepo {
    async fn create(
        &self,
        _user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        _args: CreateChatArgs,
    ) -> anyhow::Result<String> {
        Ok("test-chat-id".to_string())
    }

    #[allow(deprecated)]
    async fn get_chat(&self, chat_id: &str) -> anyhow::Result<ChatResponse> {
        Ok(ChatResponse {
            id: chat_id.to_string(),
            user_id: "macro|test@example.com".to_string(),
            project_id: None,
            name: "Mock Chat".to_string(),
            messages: Vec::new(),
            model: None,
            created_at: None,
            updated_at: None,
            attachments: Vec::new(),
            token_count: None,
            available_models: Vec::new(),
            web_citations: Vec::new(),
            is_persistent: false,
        })
    }

    async fn get_metadata(&self, chat_id: &str) -> anyhow::Result<Chat> {
        Ok(Chat {
            id: chat_id.to_string(),
            name: "Mock Chat".to_string(),
            user_id: "macro|test@example.com".to_string(),
            model: None,
            project_id: None,
            created_at: None,
            updated_at: None,
            deleted_at: None,
            token_count: None,
            is_persistent: false,
        })
    }

    async fn get_access_level(
        &self,
        _user_id: macro_user_id::user_id::MacroUserIdStr<'_>,
        _chat_id: &str,
    ) -> anyhow::Result<AccessLevel> {
        Ok(AccessLevel::Owner)
    }

    async fn copy_chat(
        &self,
        _user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        _source_chat_id: &str,
        _args: CopyChatArgs,
    ) -> anyhow::Result<String> {
        Ok("copied-chat-id".to_string())
    }

    async fn revert_delete(&self, _chat_id: &str, _project_id: Option<&str>) -> anyhow::Result<()> {
        Ok(())
    }

    async fn get_permissions(
        &self,
        _chat_id: &str,
    ) -> anyhow::Result<models_permissions::share_permission::SharePermissionV2> {
        anyhow::bail!("not implemented")
    }

    async fn delete(&self, _chat_id: &str) -> anyhow::Result<()> {
        Ok(())
    }

    async fn permanently_delete(&self, _chat_id: &str) -> anyhow::Result<()> {
        Ok(())
    }

    async fn patch(
        &self,
        _user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        _chat_id: &str,
        _args: PatchChatArgs,
    ) -> anyhow::Result<()> {
        Ok(())
    }
}

struct ErrorRepo;

impl ChatRepo for ErrorRepo {
    async fn create(
        &self,
        _user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        _args: CreateChatArgs,
    ) -> anyhow::Result<String> {
        anyhow::bail!("db error")
    }

    async fn get_chat(&self, _chat_id: &str) -> anyhow::Result<ChatResponse> {
        anyhow::bail!("db error")
    }

    async fn get_metadata(&self, _chat_id: &str) -> anyhow::Result<Chat> {
        anyhow::bail!("db error")
    }

    async fn get_access_level(
        &self,
        _user_id: macro_user_id::user_id::MacroUserIdStr<'_>,
        _chat_id: &str,
    ) -> anyhow::Result<AccessLevel> {
        anyhow::bail!("db error")
    }

    async fn copy_chat(
        &self,
        _user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        _source_chat_id: &str,
        _args: CopyChatArgs,
    ) -> anyhow::Result<String> {
        anyhow::bail!("db error")
    }

    async fn revert_delete(&self, _chat_id: &str, _project_id: Option<&str>) -> anyhow::Result<()> {
        anyhow::bail!("db error")
    }

    async fn get_permissions(
        &self,
        _chat_id: &str,
    ) -> anyhow::Result<models_permissions::share_permission::SharePermissionV2> {
        anyhow::bail!("db error")
    }

    async fn delete(&self, _chat_id: &str) -> anyhow::Result<()> {
        anyhow::bail!("db error")
    }

    async fn permanently_delete(&self, _chat_id: &str) -> anyhow::Result<()> {
        anyhow::bail!("db error")
    }

    async fn patch(
        &self,
        _user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        _chat_id: &str,
        _args: PatchChatArgs,
    ) -> anyhow::Result<()> {
        anyhow::bail!("db error")
    }
}

struct NotFoundRepo;

impl ChatRepo for NotFoundRepo {
    async fn create(
        &self,
        _user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        _args: CreateChatArgs,
    ) -> anyhow::Result<String> {
        anyhow::bail!("db error")
    }

    async fn get_chat(&self, _chat_id: &str) -> anyhow::Result<ChatResponse> {
        anyhow::bail!("no rows returned by a query that expected to return at least one row")
    }

    async fn get_metadata(&self, _chat_id: &str) -> anyhow::Result<Chat> {
        anyhow::bail!("no rows returned by a query that expected to return at least one row")
    }

    async fn get_access_level(
        &self,
        _user_id: macro_user_id::user_id::MacroUserIdStr<'_>,
        _chat_id: &str,
    ) -> anyhow::Result<AccessLevel> {
        anyhow::bail!("db error")
    }

    async fn copy_chat(
        &self,
        _user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        _source_chat_id: &str,
        _args: CopyChatArgs,
    ) -> anyhow::Result<String> {
        anyhow::bail!("db error")
    }

    async fn revert_delete(&self, _chat_id: &str, _project_id: Option<&str>) -> anyhow::Result<()> {
        anyhow::bail!("db error")
    }

    async fn get_permissions(
        &self,
        _chat_id: &str,
    ) -> anyhow::Result<models_permissions::share_permission::SharePermissionV2> {
        anyhow::bail!("db error")
    }

    async fn delete(&self, _chat_id: &str) -> anyhow::Result<()> {
        anyhow::bail!("db error")
    }

    async fn permanently_delete(&self, _chat_id: &str) -> anyhow::Result<()> {
        anyhow::bail!("db error")
    }

    async fn patch(
        &self,
        _user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        _chat_id: &str,
        _args: PatchChatArgs,
    ) -> anyhow::Result<()> {
        anyhow::bail!("db error")
    }
}

#[derive(Clone)]
struct MockAccessService;

impl EntityAccessService for MockAccessService {
    async fn generate_entity_access_receipt<
        T: entity_access::domain::models::RequiredAccessLevel,
    >(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<entity_access::domain::models::EntityAccessReceipt<T>, AccessError> {
        unreachable!("not used by ChatAccessLevelExtractor")
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(Some(AccessLevel::Owner))
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Ok(AccessLevel::Owner)
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Ok(AccessLevel::Owner)
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        Ok(EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        })
    }
}

fn user_extension() -> Extension<UserContext> {
    Extension(UserContext {
        user_id: "macro|test@example.com".to_string(),
        fusion_user_id: "1234".to_string(),
        permissions: None,
        organization_id: None,
    })
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

fn mock_create_router() -> Router {
    chat_create_router(ChatRouterState::new(MockRepo, MockAccessService)).layer(user_extension())
}

fn mock_id_router() -> Router {
    chat_id_router(ChatRouterState::new(MockRepo, MockAccessService))
        .layer(chat_basic_extension())
        .layer(user_extension())
}

fn error_id_router() -> Router {
    chat_id_router(ChatRouterState::new(ErrorRepo, MockAccessService))
        .layer(chat_basic_extension())
        .layer(user_extension())
}

fn not_found_id_router() -> Router {
    chat_id_router(ChatRouterState::new(NotFoundRepo, MockAccessService))
        .layer(chat_basic_extension())
        .layer(user_extension())
}

fn error_create_router() -> Router {
    chat_create_router(ChatRouterState::new(ErrorRepo, MockAccessService)).layer(user_extension())
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

#[tokio::test]
async fn create_chat_with_default_name() {
    let req = Request::builder()
        .method("POST")
        .uri("/")
        .header("content-type", "application/json")
        .body(Body::from(r#"{}"#))
        .unwrap();

    let res = mock_create_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn create_chat_repo_error_returns_500() {
    let req = Request::builder()
        .method("POST")
        .uri("/")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"name": "My Chat"}"#))
        .unwrap();

    let res = error_create_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn create_chat_without_auth_returns_401() {
    let router: Router = chat_create_router(ChatRouterState::new(MockRepo, MockAccessService));

    let req = Request::builder()
        .method("POST")
        .uri("/")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"name": "My Chat"}"#))
        .unwrap();

    let res = router.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
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
