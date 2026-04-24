use super::*;
use crate::domain::models::{
    ChannelAttachment, ChannelMessage, ChannelMessageFilters, ChannelParticipant,
    MessagePageDirection, ParticipantRole,
};
use crate::domain::ports::{
    ChannelAttachmentsPage, ChannelMessagesErr, ChannelMessagesQueryResult, ChannelMessagesService,
};
use axum::{
    Extension, Router,
    http::{Request, StatusCode},
};
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, EntityAccessReceipt, EntityPermission, EntityType,
        ParticipantRole as EntityParticipantRole, RequiredPermission,
    },
    ports::EntityAccessService,
};
use http_body_util::BodyExt;
use macro_user_id::user_id::MacroUserIdStr;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use model_user::UserContext;
use models_pagination::{Base64Str, CreatedAt, Cursor, CursorVal, PaginateOn, Query};
use tower::util::ServiceExt;

// --- Access service implementations for tests ---

#[derive(Clone, Copy)]
enum AccessMode {
    Allow,
    Deny,
    NotFound,
}

#[derive(Clone)]
struct TestAccessService {
    mode: AccessMode,
}

impl TestAccessService {
    const fn allow() -> Self {
        Self {
            mode: AccessMode::Allow,
        }
    }

    const fn deny() -> Self {
        Self {
            mode: AccessMode::Deny,
        }
    }

    const fn not_found() -> Self {
        Self {
            mode: AccessMode::NotFound,
        }
    }

    fn access_err(&self) -> AccessError {
        match self.mode {
            AccessMode::Allow => AccessError::Internal,
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
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
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
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
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
}

// --- Mock services (business logic only, no auth concerns) ---

struct MockService;

impl ChannelMessagesService for MockService {
    async fn get_channel_messages(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _direction: MessagePageDirection,
        _limit: u16,
        _filters: &ChannelMessageFilters,
    ) -> Result<ChannelMessagesQueryResult, ChannelMessagesErr> {
        Ok(ChannelMessagesQueryResult {
            page: Vec::<ChannelMessage>::new()
                .into_iter()
                .paginate_on(50, CreatedAt)
                .filter_on(())
                .into_page(),
            has_more_newer: false,
        })
    }

    async fn get_channel_attachments(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _limit: u16,
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

    async fn get_channel_messages_around(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
        _limit: u16,
    ) -> Result<ChannelMessagesQueryResult, ChannelMessagesErr> {
        Ok(ChannelMessagesQueryResult {
            page: Vec::<ChannelMessage>::new()
                .into_iter()
                .paginate_on(50, CreatedAt)
                .filter_on(())
                .into_page(),
            has_more_newer: false,
        })
    }

    async fn get_thread_replies(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
    ) -> Result<Vec<crate::domain::models::ThreadReply>, ChannelMessagesErr> {
        Ok(vec![])
    }
}

struct ErrorService;

impl ChannelMessagesService for ErrorService {
    async fn get_channel_messages(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _direction: MessagePageDirection,
        _limit: u16,
        _filters: &ChannelMessageFilters,
    ) -> Result<ChannelMessagesQueryResult, ChannelMessagesErr> {
        Err(ChannelMessagesErr::Repo(anyhow::anyhow!("database error")))
    }

    async fn get_channel_attachments(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _limit: u16,
    ) -> Result<ChannelAttachmentsPage, ChannelMessagesErr> {
        Err(ChannelMessagesErr::Repo(anyhow::anyhow!("database error")))
    }

    async fn get_channel_participants(
        &self,
        _channel_id: Uuid,
    ) -> Result<Vec<ChannelParticipant>, ChannelMessagesErr> {
        Err(ChannelMessagesErr::Repo(anyhow::anyhow!("database error")))
    }

    async fn get_channel_messages_around(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
        _limit: u16,
    ) -> Result<ChannelMessagesQueryResult, ChannelMessagesErr> {
        Err(ChannelMessagesErr::Repo(anyhow::anyhow!("database error")))
    }

    async fn get_thread_replies(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
    ) -> Result<Vec<crate::domain::models::ThreadReply>, ChannelMessagesErr> {
        Err(ChannelMessagesErr::Repo(anyhow::anyhow!("database error")))
    }
}

struct ParticipantsService;

impl ChannelMessagesService for ParticipantsService {
    async fn get_channel_messages(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _direction: MessagePageDirection,
        _limit: u16,
        _filters: &ChannelMessageFilters,
    ) -> Result<ChannelMessagesQueryResult, ChannelMessagesErr> {
        Ok(ChannelMessagesQueryResult {
            page: Vec::<ChannelMessage>::new()
                .into_iter()
                .paginate_on(50, CreatedAt)
                .filter_on(())
                .into_page(),
            has_more_newer: false,
        })
    }

    async fn get_channel_attachments(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _limit: u16,
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

    async fn get_channel_messages_around(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
        _limit: u16,
    ) -> Result<ChannelMessagesQueryResult, ChannelMessagesErr> {
        Ok(ChannelMessagesQueryResult {
            page: Vec::<ChannelMessage>::new()
                .into_iter()
                .paginate_on(50, CreatedAt)
                .filter_on(())
                .into_page(),
            has_more_newer: false,
        })
    }

    async fn get_thread_replies(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
    ) -> Result<Vec<crate::domain::models::ThreadReply>, ChannelMessagesErr> {
        Ok(vec![])
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

fn mock_router() -> Router {
    channels_router(ChannelsRouterState::new(
        MockService,
        TestAccessService::allow(),
    ))
    .layer(user_extension())
}

fn error_router() -> Router {
    channels_router(ChannelsRouterState::new(
        ErrorService,
        TestAccessService::allow(),
    ))
    .layer(user_extension())
}

fn denied_router() -> Router {
    channels_router(ChannelsRouterState::new(
        MockService,
        TestAccessService::deny(),
    ))
    .layer(user_extension())
}

fn not_found_router() -> Router {
    channels_router(ChannelsRouterState::new(
        MockService,
        TestAccessService::not_found(),
    ))
    .layer(user_extension())
}

#[tokio::test]
async fn messages_returns_empty_page() {
    let router = mock_router();
    let channel_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!("/{channel_id}/messages"))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["items"], serde_json::json!([]));
    assert!(json["next_cursor"].is_null());
    assert!(json["previous_cursor"].is_null());
}

#[tokio::test]
async fn messages_returns_400_when_both_cursor_params_are_set() {
    let router = mock_router();
    let channel_id = Uuid::new_v4();
    let raw_cursor = Base64Str::encode_json(Cursor {
        id: Uuid::new_v4(),
        limit: 50,
        val: CursorVal {
            sort_type: CreatedAt,
            last_val: chrono::Utc::now(),
        },
        filter: (),
    })
    .type_erase();
    let cursor = raw_cursor
        .replace('+', "%2B")
        .replace('/', "%2F")
        .replace('=', "%3D");

    let request = Request::builder()
        .uri(format!(
            "/{channel_id}/messages?cursor={cursor}&previous_cursor={cursor}"
        ))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        json["message"],
        "provide only one of cursor or previous_cursor"
    );
}

#[tokio::test]
async fn messages_returns_400_on_invalid_previous_cursor() {
    let router = mock_router();
    let channel_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!("/{channel_id}/messages?previous_cursor=not-base64"))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["message"], "failed to decode cursor value");
}

#[tokio::test]
async fn messages_returns_500_on_service_error() {
    let router = error_router();
    let channel_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!("/{channel_id}/messages"))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);

    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["message"], "An internal server error occurred");
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
    ))
    .layer(user_extension());
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

struct NotFoundService;

impl ChannelMessagesService for NotFoundService {
    async fn get_channel_messages(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _direction: MessagePageDirection,
        _limit: u16,
        _filters: &ChannelMessageFilters,
    ) -> Result<ChannelMessagesQueryResult, ChannelMessagesErr> {
        Ok(ChannelMessagesQueryResult {
            page: Vec::<ChannelMessage>::new()
                .into_iter()
                .paginate_on(50, CreatedAt)
                .filter_on(())
                .into_page(),
            has_more_newer: false,
        })
    }

    async fn get_channel_attachments(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _limit: u16,
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

    async fn get_channel_messages_around(
        &self,
        _channel_id: Uuid,
        message_id: Uuid,
        _limit: u16,
    ) -> Result<ChannelMessagesQueryResult, ChannelMessagesErr> {
        Err(ChannelMessagesErr::MessageNotFound(message_id))
    }

    async fn get_thread_replies(
        &self,
        _channel_id: Uuid,
        message_id: Uuid,
    ) -> Result<Vec<crate::domain::models::ThreadReply>, ChannelMessagesErr> {
        Err(ChannelMessagesErr::MessageNotFound(message_id))
    }
}

struct AroundHasItemsService {
    has_more_newer: bool,
}

impl ChannelMessagesService for AroundHasItemsService {
    async fn get_channel_messages(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _direction: MessagePageDirection,
        _limit: u16,
        _filters: &ChannelMessageFilters,
    ) -> Result<ChannelMessagesQueryResult, ChannelMessagesErr> {
        Ok(ChannelMessagesQueryResult {
            page: Vec::<ChannelMessage>::new()
                .into_iter()
                .paginate_on(50, CreatedAt)
                .filter_on(())
                .into_page(),
            has_more_newer: false,
        })
    }

    async fn get_channel_attachments(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _limit: u16,
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

    async fn get_channel_messages_around(
        &self,
        channel_id: Uuid,
        _message_id: Uuid,
        limit: u16,
    ) -> Result<ChannelMessagesQueryResult, ChannelMessagesErr> {
        let now = chrono::Utc::now();
        let message = ChannelMessage {
            id: Uuid::new_v4(),
            channel_id,
            sender_id: "macro|user@example.com".to_string(),
            content: "hello".to_string(),
            created_at: now,
            updated_at: now,
            edited_at: None,
            deleted_at: None,
            thread: crate::domain::models::ThreadInfo {
                reply_count: 0,
                latest_reply_at: None,
                preview: vec![],
            },
            reactions: vec![],
            attachments: vec![],
        };

        Ok(ChannelMessagesQueryResult {
            page: vec![message]
                .into_iter()
                .paginate_on(usize::from(limit), CreatedAt)
                .filter_on(())
                .into_page(),
            has_more_newer: self.has_more_newer,
        })
    }

    async fn get_thread_replies(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
    ) -> Result<Vec<crate::domain::models::ThreadReply>, ChannelMessagesErr> {
        Ok(vec![])
    }
}

#[tokio::test]
async fn messages_around_returns_empty_page() {
    let router = mock_router();
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!(
            "/{channel_id}/messages?load_around_message_id={message_id}"
        ))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["items"], serde_json::json!([]));
    assert!(json["previous_cursor"].is_null());
}

#[tokio::test]
async fn messages_around_omits_previous_cursor_when_no_newer_page() {
    let router = channels_router(ChannelsRouterState::new(
        AroundHasItemsService {
            has_more_newer: false,
        },
        TestAccessService::allow(),
    ))
    .layer(user_extension());
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!(
            "/{channel_id}/messages?load_around_message_id={message_id}"
        ))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["items"].as_array().unwrap().len(), 1);
    assert!(json["previous_cursor"].is_null());
}

#[tokio::test]
async fn messages_around_returns_previous_cursor_when_newer_page_exists() {
    let router = channels_router(ChannelsRouterState::new(
        AroundHasItemsService {
            has_more_newer: true,
        },
        TestAccessService::allow(),
    ))
    .layer(user_extension());
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!(
            "/{channel_id}/messages?load_around_message_id={message_id}"
        ))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["items"].as_array().unwrap().len(), 1);
    assert!(json["previous_cursor"].is_string());
}

#[tokio::test]
async fn messages_around_returns_404_when_not_found() {
    let router = channels_router(ChannelsRouterState::new(
        NotFoundService,
        TestAccessService::allow(),
    ))
    .layer(user_extension());
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!(
            "/{channel_id}/messages?load_around_message_id={message_id}"
        ))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["message"], "Message not found");
}

// --- POST /messages filter tests ---

struct CapturingService {
    captured: std::sync::Mutex<Option<ChannelMessageFilters>>,
}

impl CapturingService {
    fn new() -> std::sync::Arc<Self> {
        std::sync::Arc::new(Self {
            captured: std::sync::Mutex::new(None),
        })
    }
}

impl ChannelMessagesService for std::sync::Arc<CapturingService> {
    async fn get_channel_messages(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _direction: MessagePageDirection,
        _limit: u16,
        filters: &ChannelMessageFilters,
    ) -> Result<ChannelMessagesQueryResult, ChannelMessagesErr> {
        *self.captured.lock().unwrap() = Some(filters.clone());
        Ok(ChannelMessagesQueryResult {
            page: Vec::<ChannelMessage>::new()
                .into_iter()
                .paginate_on(50, CreatedAt)
                .filter_on(())
                .into_page(),
            has_more_newer: false,
        })
    }

    async fn get_channel_attachments(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _limit: u16,
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

    async fn get_channel_messages_around(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
        _limit: u16,
    ) -> Result<ChannelMessagesQueryResult, ChannelMessagesErr> {
        Ok(ChannelMessagesQueryResult {
            page: Vec::<ChannelMessage>::new()
                .into_iter()
                .paginate_on(50, CreatedAt)
                .filter_on(())
                .into_page(),
            has_more_newer: false,
        })
    }

    async fn get_thread_replies(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
    ) -> Result<Vec<crate::domain::models::ThreadReply>, ChannelMessagesErr> {
        Ok(vec![])
    }
}

#[tokio::test]
async fn post_messages_empty_body_uses_default_filters() {
    let svc = CapturingService::new();
    let router = channels_router(ChannelsRouterState::new(
        svc.clone(),
        TestAccessService::allow(),
    ))
    .layer(user_extension());

    let channel_id = Uuid::new_v4();
    let request = Request::builder()
        .method("POST")
        .uri(format!("/{channel_id}/messages"))
        .header("content-type", "application/json")
        .body(axum::body::Body::from("{}"))
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let captured = svc.captured.lock().unwrap().clone().unwrap();
    assert!(captured.message_ids.is_empty());
    assert!(captured.last_activity.is_none());
}

#[tokio::test]
async fn post_messages_forwards_message_ids_filter() {
    let svc = CapturingService::new();
    let router = channels_router(ChannelsRouterState::new(
        svc.clone(),
        TestAccessService::allow(),
    ))
    .layer(user_extension());

    let channel_id = Uuid::new_v4();
    let id_a = Uuid::new_v4();
    let id_b = Uuid::new_v4();
    let body = serde_json::json!({ "message_ids": [id_a, id_b] }).to_string();

    let request = Request::builder()
        .method("POST")
        .uri(format!("/{channel_id}/messages"))
        .header("content-type", "application/json")
        .body(axum::body::Body::from(body))
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let captured = svc.captured.lock().unwrap().clone().unwrap();
    assert_eq!(captured.message_ids, vec![id_a, id_b]);
}

#[tokio::test]
async fn post_messages_forwards_last_activity_filter() {
    let svc = CapturingService::new();
    let router = channels_router(ChannelsRouterState::new(
        svc.clone(),
        TestAccessService::allow(),
    ))
    .layer(user_extension());

    let channel_id = Uuid::new_v4();
    let body = serde_json::json!({ "last_activity": "2024-06-01T12:00:00Z" }).to_string();

    let request = Request::builder()
        .method("POST")
        .uri(format!("/{channel_id}/messages"))
        .header("content-type", "application/json")
        .body(axum::body::Body::from(body))
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let captured = svc.captured.lock().unwrap().clone().unwrap();
    assert!(captured.last_activity.is_some());
    let ts = captured.last_activity.unwrap();
    assert_eq!(
        ts,
        chrono::DateTime::parse_from_rfc3339("2024-06-01T12:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc)
    );
}

#[tokio::test]
async fn post_messages_rejects_oversized_filter_list() {
    let router = channels_router(ChannelsRouterState::new(
        MockService,
        TestAccessService::allow(),
    ))
    .layer(user_extension());

    let channel_id = Uuid::new_v4();
    let ids: Vec<Uuid> = (0..101).map(|_| Uuid::new_v4()).collect();
    let body = serde_json::json!({ "message_ids": ids }).to_string();

    let request = Request::builder()
        .method("POST")
        .uri(format!("/{channel_id}/messages"))
        .header("content-type", "application/json")
        .body(axum::body::Body::from(body))
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["message"], "too many message_ids");
}

#[tokio::test]
async fn thread_replies_returns_empty_list() {
    let router = mock_router();
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!("/{channel_id}/messages/{message_id}/replies"))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json, serde_json::json!([]));
}

#[tokio::test]
async fn thread_replies_returns_404_when_not_found() {
    let router = channels_router(ChannelsRouterState::new(
        NotFoundService,
        TestAccessService::allow(),
    ))
    .layer(user_extension());
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!("/{channel_id}/messages/{message_id}/replies"))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["message"], "Message not found");
}

// --- Access control tests ---

#[tokio::test]
async fn non_member_cannot_access_messages() {
    let router = denied_router();
    let channel_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!("/{channel_id}/messages"))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        json["message"],
        "User does not have access to the requested resource"
    );
}

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
async fn non_member_cannot_access_thread_replies() {
    let router = denied_router();
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let request = Request::builder()
        .uri(format!("/{channel_id}/messages/{message_id}/replies"))
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
        .uri(format!("/{channel_id}/messages"))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}
