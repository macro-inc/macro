//! HTTP adapter for channel topic use cases.
use crate::domain::topics::{ChannelTopic, TopicError, TopicRepository, TopicService};
use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, put},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// Router dependencies.
pub struct TopicsRouterState<R, Auth> {
    /// Domain service.
    pub service: Arc<TopicService<R>>,
    /// Authentication adapter state.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<R, Auth> Clone for TopicsRouterState<R, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<R, Auth> TopicsRouterState<R, Auth> {
    /// Construct router state in the composition root.
    pub fn new(
        service: TopicService<R>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service: Arc::new(service),
            authorization_state,
        }
    }
}

impl<R, Auth> FromRef<TopicsRouterState<R, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &TopicsRouterState<R, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Topic metadata command.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct TopicBody {
    /// Display name.
    pub name: Option<String>,
    /// Optional description.
    pub description: Option<String>,
}

/// Ordered topic IDs for this user.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct TopicOrderBody {
    /// Topic IDs in display order.
    pub topic_ids: Vec<Uuid>,
}

/// A newly created topic ID.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CreateTopicResponse {
    /// Topic ID.
    pub id: Uuid,
}

/// Participant-scoped topic list.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct TopicListResponse {
    /// Team topics.
    pub topics: Vec<ChannelTopic>,
}

fn response(error: TopicError) -> axum::response::Response {
    let status = match error {
        TopicError::Invalid(_) => StatusCode::BAD_REQUEST,
        TopicError::Forbidden => StatusCode::FORBIDDEN,
        TopicError::NotFound => StatusCode::NOT_FOUND,
        TopicError::Repo(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, error.to_string()).into_response()
}

/// Routes mounted at /channel-topics.
pub fn topics_router<R, Auth, T>(state: TopicsRouterState<R, Auth>) -> Router<T>
where
    R: TopicRepository,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/", get(list::<R, Auth>).post(create::<R, Auth>))
        .route("/prefs/order", put(order::<R, Auth>))
        .route(
            "/{id}",
            axum::routing::patch(update::<R, Auth>).delete(delete::<R, Auth>),
        )
        .route(
            "/{id}/channels/{channel_id}",
            put(add_channel::<R, Auth>).delete(remove_channel::<R, Auth>),
        )
        .with_state(state)
}

/// List the caller's team topics and participant-scoped channel IDs.
#[utoipa::path(get, path = "/channel-topics", tag = "channel-topics", operation_id = "list_channel_topics", responses((status = 200, body = TopicListResponse)))]
pub async fn list<R: TopicRepository, Auth: MacroAuthorizationService>(
    State(state): State<TopicsRouterState<R, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<TopicListResponse>, axum::response::Response> {
    let user = auth.authorization.user.macro_user_id.as_ref();
    state
        .service
        .list(user)
        .await
        .map(|topics| Json(TopicListResponse { topics }))
        .map_err(response)
}

/// Create a topic.
#[utoipa::path(post, path = "/channel-topics", tag = "channel-topics", operation_id = "create_channel_topic", request_body = TopicBody, responses((status = 200, body = CreateTopicResponse)))]
pub async fn create<R: TopicRepository, Auth: MacroAuthorizationService>(
    State(state): State<TopicsRouterState<R, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(body): Json<TopicBody>,
) -> Result<Json<CreateTopicResponse>, axum::response::Response> {
    let user = auth.authorization.user.macro_user_id.as_ref();
    let id = state
        .service
        .create(
            user,
            body.name.as_deref().unwrap_or(""),
            body.description.as_deref(),
        )
        .await
        .map_err(response)?;
    Ok(Json(CreateTopicResponse { id }))
}

/// Update topic metadata.
#[utoipa::path(patch, path = "/channel-topics/{id}", tag = "channel-topics", operation_id = "update_channel_topic", request_body = TopicBody, responses((status = 204)))]
pub async fn update<R: TopicRepository, Auth: MacroAuthorizationService>(
    State(state): State<TopicsRouterState<R, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(id): Path<Uuid>,
    Json(body): Json<TopicBody>,
) -> Result<StatusCode, axum::response::Response> {
    state
        .service
        .update(
            auth.authorization.user.macro_user_id.as_ref(),
            id,
            body.name.as_deref(),
            body.description.as_deref(),
        )
        .await
        .map_err(response)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Delete a topic.
#[utoipa::path(delete, path = "/channel-topics/{id}", tag = "channel-topics", operation_id = "delete_channel_topic", responses((status = 204)))]
pub async fn delete<R: TopicRepository, Auth: MacroAuthorizationService>(
    State(state): State<TopicsRouterState<R, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, axum::response::Response> {
    state
        .service
        .delete(auth.authorization.user.macro_user_id.as_ref(), id)
        .await
        .map_err(response)?;
    Ok(StatusCode::NO_CONTENT)
}

/// File a channel under a topic.
#[utoipa::path(put, path = "/channel-topics/{id}/channels/{channel_id}", tag = "channel-topics", operation_id = "add_channel_to_topic", responses((status = 204)))]
pub async fn add_channel<R: TopicRepository, Auth: MacroAuthorizationService>(
    State(state): State<TopicsRouterState<R, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path((id, channel_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, axum::response::Response> {
    state
        .service
        .add_channel(
            auth.authorization.user.macro_user_id.as_ref(),
            id,
            channel_id,
        )
        .await
        .map_err(response)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Remove a channel from a topic.
#[utoipa::path(delete, path = "/channel-topics/{id}/channels/{channel_id}", tag = "channel-topics", operation_id = "remove_channel_from_topic", responses((status = 204)))]
pub async fn remove_channel<R: TopicRepository, Auth: MacroAuthorizationService>(
    State(state): State<TopicsRouterState<R, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path((id, channel_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, axum::response::Response> {
    state
        .service
        .remove_channel(
            auth.authorization.user.macro_user_id.as_ref(),
            id,
            channel_id,
        )
        .await
        .map_err(response)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Set this user's custom topic order.
#[utoipa::path(put, path = "/channel-topics/prefs/order", tag = "channel-topics", operation_id = "set_channel_topic_order", request_body = TopicOrderBody, responses((status = 204)))]
pub async fn order<R: TopicRepository, Auth: MacroAuthorizationService>(
    State(state): State<TopicsRouterState<R, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(body): Json<TopicOrderBody>,
) -> Result<StatusCode, axum::response::Response> {
    state
        .service
        .set_order(
            auth.authorization.user.macro_user_id.as_ref(),
            &body.topic_ids,
        )
        .await
        .map_err(response)?;
    Ok(StatusCode::NO_CONTENT)
}
