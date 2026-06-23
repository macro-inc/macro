use std::sync::Arc;

use axum::{Json, Router, extract::State, http::StatusCode, response::IntoResponse, routing::get};
use frecency::domain::models::AggregateFrecency;
use macro_user_id::user_id::MacroUserIdStr;
use model_user::axum_extractor::MacroUserExtractor;
use serde::Serialize;
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::{
    models::{
        Activity, ChannelListItem, ChannelType as DomainChannelType, ChannelWithLatest,
        GetChannelsRequest, ParticipantRole as DomainParticipantRole, RecentChannelMessage,
    },
    ports::ChannelListService,
};

const DEFAULT_CHANNEL_LIST_LIMIT: u32 = 100;

/// Router state for legacy channel-list endpoints.
pub struct ChannelListRouterState<S> {
    /// Inner channel list service.
    pub inner: Arc<S>,
}

impl<S> Clone for ChannelListRouterState<S> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<S: ChannelListService> ChannelListRouterState<S> {
    /// Build router state from a channel list service.
    pub fn new(s: S) -> Self {
        Self { inner: Arc::new(s) }
    }
}

/// Legacy `/channels` and `/activity` list routes.
pub fn channel_list_router<S: ChannelListService, T: Send + Sync + 'static>(
    s: ChannelListRouterState<S>,
) -> Router<T> {
    Router::new()
        .route("/channels", get(get_channels_handler))
        .route("/activity", get(get_activity_handler))
        .with_state(s)
}

/// Errors returned by channel list routes.
#[derive(Debug, Error)]
pub enum ChannelListRouterErr {
    /// Internal server error.
    #[error("Internal server error")]
    Internal,
}

impl IntoResponse for ChannelListRouterErr {
    fn into_response(self) -> axum::response::Response {
        let status = match self {
            Self::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (status, self.to_string()).into_response()
    }
}

#[utoipa::path(
    get,
    path = "/channels",
    tag = "channels",
    operation_id = "get_channels",
    responses(
        (status = 200, body=Vec<ApiChannelWithLatest>),
        (status = 401, body=String),
        (status = 404, body=String),
        (status = 500, body=String),
    )
)]
async fn get_channels_handler<S: ChannelListService>(
    State(service): State<ChannelListRouterState<S>>,
    MacroUserExtractor { macro_user_id, .. }: MacroUserExtractor,
) -> Result<Json<Vec<ApiChannelWithLatest>>, ChannelListRouterErr> {
    let res = service
        .inner
        .get_channels(GetChannelsRequest {
            macro_id: macro_user_id,
            limit: Some(DEFAULT_CHANNEL_LIST_LIMIT),
            query: models_pagination::Query::Sort(
                models_pagination::SimpleSortMethod::UpdatedAt,
                None,
            ),
        })
        .await
        .map_err(|_| ChannelListRouterErr::Internal)?;

    Ok(Json(
        res.into_iter()
            .map(ApiChannelWithLatest::new_from_domain)
            .collect(),
    ))
}

#[tracing::instrument(skip(service))]
#[utoipa::path(get,
    tag = "activity",
    operation_id = "get_activity",
    path = "/activity", responses(
    (status = 200, body=Vec<ApiActivity>),
    (status = 401, body=String),
    (status = 404, body=String),
    (status = 500, body=String),
))]
/// Handle legacy channel activity list requests.
pub async fn get_activity_handler<S: ChannelListService>(
    State(service): State<ChannelListRouterState<S>>,
    MacroUserExtractor { macro_user_id, .. }: MacroUserExtractor,
) -> Result<Json<Vec<ApiActivity>>, ChannelListRouterErr> {
    let res = service
        .inner
        .get_activities(macro_user_id)
        .await
        .map_err(|_| ChannelListRouterErr::Internal)?;

    Ok(Json(
        res.into_iter().map(ApiActivity::new_from_domain).collect(),
    ))
}

/// Participant role in API responses.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ParticipantRole {
    /// Channel owner.
    Owner,
    /// Channel admin.
    Admin,
    /// Regular member.
    Member,
}

impl ParticipantRole {
    fn new_from_domain(value: DomainParticipantRole) -> Self {
        match value {
            DomainParticipantRole::Owner => Self::Owner,
            DomainParticipantRole::Admin => Self::Admin,
            DomainParticipantRole::Member => Self::Member,
        }
    }
}

/// Channel participant in API responses.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ChannelParticipant {
    /// id of the channel
    pub channel_id: Uuid,
    /// id of the user
    pub user_id: String,
    /// type of the participant
    pub role: ParticipantRole,
    /// timestamp of when the user joined the channel
    pub joined_at: chrono::DateTime<chrono::Utc>,
    /// timestamp of when the user left the channel
    pub left_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl ChannelParticipant {
    fn new_from_domain(value: crate::domain::models::ChannelParticipant) -> Self {
        Self {
            channel_id: value.channel_id,
            user_id: value.user_id,
            role: ParticipantRole::new_from_domain(value.role),
            joined_at: value.joined_at,
            left_at: value.left_at,
        }
    }
}

/// Channel with participants in API responses.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ChannelWithParticipants {
    /// Channel fields.
    #[serde(flatten)]
    pub channel: Channel,
    /// Active participants.
    pub participants: Vec<ChannelParticipant>,
}

/// Channel list response item.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ApiChannelWithLatest {
    /// Channel and participants.
    #[serde(flatten)]
    pub channel: ChannelWithParticipants,
    /// Latest message fields.
    #[serde(flatten)]
    pub latest_message: LatestMessage,
    /// Last viewed timestamp for requesting user.
    pub viewed_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Last interaction timestamp for requesting user.
    pub interacted_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Aggregate frecency score.
    pub frecency_score: Option<f64>,
}

impl ApiChannelWithLatest {
    fn new_from_domain(value: ChannelWithLatest) -> Self {
        Self {
            channel: ChannelWithParticipants {
                channel: Channel::new_from_domain(value.channel.channel),
                participants: value
                    .channel
                    .participants
                    .into_iter()
                    .map(ChannelParticipant::new_from_domain)
                    .collect(),
            },
            latest_message: LatestMessage::new_from_domain(value.latest_message),
            viewed_at: value.viewed_at,
            interacted_at: value.interacted_at,
            frecency_score: map_frecency(value.frecency_score),
        }
    }
}

fn map_frecency(f: Option<AggregateFrecency>) -> Option<f64> {
    f.map(|f| f.data.frecency_score)
}

/// Channel fields in API responses.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct Channel {
    /// uuid of the channel
    pub id: Uuid,
    /// string name of the channel
    pub name: Option<String>,
    /// type of the channel
    pub channel_type: ChannelType,
    /// id of the organization this channel belongs too
    #[schema(value_type = Option<u32>)]
    pub org_id: Option<u32>,
    /// id of the team this channel belongs to
    pub team_id: Option<Uuid>,
    /// timestamp of when the channel was created
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// timestamp of when the channel was last updated
    pub updated_at: chrono::DateTime<chrono::Utc>,
    /// id of the user who created the channel
    #[schema(value_type = String)]
    pub owner_id: MacroUserIdStr<'static>,
}

impl Channel {
    fn new_from_domain(value: ChannelListItem) -> Self {
        Self {
            id: value.id,
            name: value.name,
            channel_type: ChannelType::new_from_domain(value.channel_type),
            org_id: value.org_id.and_then(|org_id| u32::try_from(org_id).ok()),
            team_id: value.team_id,
            created_at: value.created_at,
            updated_at: value.updated_at,
            owner_id: value.owner_id,
        }
    }
}

/// Latest-message bundle in API responses.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct LatestMessage {
    /// Latest message including thread replies.
    pub latest_message: Option<ChannelMessage>,
    /// Latest non-thread top-level message.
    pub latest_non_thread_message: Option<ChannelMessage>,
}

impl LatestMessage {
    fn new_from_domain(value: crate::domain::models::LatestMessage) -> Self {
        Self {
            latest_message: value.latest_message.map(ChannelMessage::new_from_recent),
            latest_non_thread_message: value
                .latest_non_thread_message
                .map(ChannelMessage::new_from_recent),
        }
    }
}

/// Channel type in API responses.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChannelType {
    /// Public channel.
    Public,
    /// Private channel.
    Private,
    /// Direct message channel.
    DirectMessage,
    /// Team channel.
    Team,
}

impl ChannelType {
    fn new_from_domain(value: DomainChannelType) -> Self {
        match value {
            DomainChannelType::Public => Self::Public,
            DomainChannelType::Private => Self::Private,
            DomainChannelType::DirectMessage => Self::DirectMessage,
            DomainChannelType::Team => Self::Team,
        }
    }
}

/// Channel message in API responses.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ChannelMessage {
    /// Message id.
    pub message_id: Uuid,
    /// Thread id, if the message is a reply.
    pub thread_id: Option<Uuid>,
    /// Sender user id.
    pub sender_id: String,
    /// Message content.
    pub content: String,
    /// Creation timestamp.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Update timestamp.
    pub updated_at: chrono::DateTime<chrono::Utc>,
    /// Deletion timestamp, if deleted.
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
    /// message mentions formatted as `{ENTITY_TYPE}:{ENTITY_ID}`
    pub mentions: Vec<String>,
}

impl ChannelMessage {
    fn new_from_recent(value: RecentChannelMessage) -> Self {
        Self {
            message_id: value.message_id,
            thread_id: value.thread_id,
            sender_id: value.sender_id,
            content: value.content,
            created_at: value.created_at,
            updated_at: value.updated_at,
            deleted_at: value.deleted_at,
            mentions: value.mentions,
        }
    }
}

/// Activity item in API responses.
#[derive(Debug, ToSchema, Serialize)]
pub struct ApiActivity {
    /// Activity id.
    pub id: Uuid,
    /// User id.
    pub user_id: String,
    /// Channel id.
    pub channel_id: Uuid,
    /// Created timestamp.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Updated timestamp.
    pub updated_at: chrono::DateTime<chrono::Utc>,
    /// the last time the user viewed the channel
    pub viewed_at: Option<chrono::DateTime<chrono::Utc>>,
    /// the last time the user intereacted with the channel
    /// eg. reacting, replying, sending a message
    pub interacted_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl ApiActivity {
    fn new_from_domain(value: Activity) -> Self {
        Self {
            id: value.id,
            user_id: value.user_id,
            channel_id: value.channel_id,
            created_at: value.created_at,
            updated_at: value.updated_at,
            viewed_at: value.viewed_at,
            interacted_at: value.interacted_at,
        }
    }
}
