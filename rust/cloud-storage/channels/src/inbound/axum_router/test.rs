use super::*;
use crate::domain::models::{
    ChannelAttachment, ChannelMessage, ChannelParticipant, ParticipantRole,
};
use crate::domain::ports::{
    ChannelAttachmentsPage, ChannelMessagesErr, ChannelMessagesPage, ChannelMessagesService,
};
use axum::{
    Extension, Router,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use model_user::UserContext;
use models_pagination::{CreatedAt, PaginateOn, Query};
use tower::util::ServiceExt;

struct MockService;

impl ChannelMessagesService for MockService {
    async fn get_channel_messages(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _limit: u16,
    ) -> Result<ChannelMessagesPage, ChannelMessagesErr> {
        Ok(Vec::<ChannelMessage>::new()
            .into_iter()
            .paginate_on(50, CreatedAt)
            .filter_on(())
            .into_page())
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
}

struct ErrorService;

impl ChannelMessagesService for ErrorService {
    async fn get_channel_messages(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _limit: u16,
    ) -> Result<ChannelMessagesPage, ChannelMessagesErr> {
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
}

struct ParticipantsService;

impl ChannelMessagesService for ParticipantsService {
    async fn get_channel_messages(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _limit: u16,
    ) -> Result<ChannelMessagesPage, ChannelMessagesErr> {
        Ok(Vec::<ChannelMessage>::new()
            .into_iter()
            .paginate_on(50, CreatedAt)
            .filter_on(())
            .into_page())
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
    channels_router(ChannelsRouterState::new(MockService)).layer(user_extension())
}

fn error_router() -> Router {
    channels_router(ChannelsRouterState::new(ErrorService)).layer(user_extension())
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
    let router =
        channels_router(ChannelsRouterState::new(ParticipantsService)).layer(user_extension());
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
