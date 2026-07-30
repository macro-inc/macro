#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use frecency::domain::models::AggregateFrecency;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{
    CursorOptionExt, CursorWithValAndFilter, PaginateOn, Paginated, SimpleSortMethod,
    TypeEraseCursor,
};
use serde::{Deserialize, Serialize};
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
const MAX_CHANNEL_LIST_LIMIT: u32 = 100;

/// Router state for legacy channel-list endpoints.
pub struct ChannelListRouterState<S, Auth> {
    /// Inner channel list service.
    pub inner: Arc<S>,
    /// State for request authorization.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for ChannelListRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> ChannelListRouterState<S, Auth> {
    /// Build router state from a channel list service and authorization state.
    pub fn new(s: S, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            inner: Arc::new(s),
            authorization_state,
        }
    }
}

impl<S, Auth> FromRef<ChannelListRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ChannelListRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Legacy `/channels` and `/activity` list routes.
pub fn channel_list_router<S, Auth, T>(s: ChannelListRouterState<S, Auth>) -> Router<T>
where
    S: ChannelListService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/channels", get(get_channels_handler::<S, Auth>))
        .route("/activity", get(get_activity_handler::<S, Auth>))
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

/// Handle channel list requests for `GET /comms/channels`.
#[utoipa::path(
    get,
    path = "/comms/channels",
    tag = "channels",
    operation_id = "get_channels",
    params(
        ("limit" = Option<u32>, Query, description = "Page size (1-100, default 100)"),
        ("cursor" = Option<String>, Query, description = "Opaque cursor for the next page"),
    ),
    responses(
        (status = 200, body=ApiChannelListPage),
        (status = 400, body=String),
        (status = 401, body=String),
        (status = 404, body=String),
        (status = 500, body=String),
    )
)]
async fn get_channels_handler<S, Auth>(
    State(service): State<ChannelListRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Query(params): Query<GetChannelsQueryParams>,
    cursor: Option<CursorWithValAndFilter<Uuid, SimpleSortMethod, ()>>,
) -> Result<Json<ApiChannelListPage>, ChannelListRouterErr>
where
    S: ChannelListService,
    Auth: MacroAuthorizationService,
{
    let user = &authorization.authorization.user;
    let limit = params
        .limit
        .unwrap_or(DEFAULT_CHANNEL_LIST_LIMIT)
        .clamp(1, MAX_CHANNEL_LIST_LIMIT);
    let res = service
        .inner
        .get_channels(GetChannelsRequest {
            macro_id: user.macro_user_id.clone(),
            // Fetch one extra row so pagination can distinguish a full final
            // page from a page with more results.
            limit: Some(limit.saturating_add(1)),
            include_frecency: true,
            query: cursor
                .into_query(SimpleSortMethod::UpdatedAt, ())
                .map_filter(|_| None),
        })
        .await
        .map_err(|_| ChannelListRouterErr::Internal)?;

    let has_more = res.len() > limit as usize;
    let Paginated {
        items, next_cursor, ..
    } = res
        .into_iter()
        .paginate_on(limit as usize, SimpleSortMethod::UpdatedAt)
        .filter_on(())
        .into_page()
        .type_erase();

    Ok(Json(ApiChannelListPage {
        items: items
            .into_iter()
            .map(ApiChannelWithLatest::new_from_domain)
            .collect(),
        next_cursor: next_cursor.filter(|_| has_more),
    }))
}

#[derive(Debug, Deserialize)]
struct GetChannelsQueryParams {
    limit: Option<u32>,
}

#[tracing::instrument(skip(service, authorization))]
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
pub async fn get_activity_handler<S, Auth>(
    State(service): State<ChannelListRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<Vec<ApiActivity>>, ChannelListRouterErr>
where
    S: ChannelListService,
    Auth: MacroAuthorizationService,
{
    let user = &authorization.authorization.user;
    let res = service
        .inner
        .get_activities(user.macro_user_id.clone())
        .await
        .map_err(|_| ChannelListRouterErr::Internal)?;

    Ok(Json(
        res.into_iter().map(ApiActivity::new_from_domain).collect(),
    ))
}

/// Participant role in API responses.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApiParticipantListRole {
    /// Channel owner.
    Owner,
    /// Channel admin.
    Admin,
    /// Regular member.
    Member,
}

impl ApiParticipantListRole {
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
pub struct ApiChannelListParticipant {
    /// id of the channel
    pub channel_id: Uuid,
    /// id of the user
    pub user_id: String,
    /// type of the participant
    pub role: ApiParticipantListRole,
    /// timestamp of when the user joined the channel
    pub joined_at: chrono::DateTime<chrono::Utc>,
    /// timestamp of when the user left the channel
    pub left_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl ApiChannelListParticipant {
    fn new_from_domain(value: crate::domain::models::ChannelParticipant) -> Self {
        Self {
            channel_id: value.channel_id,
            user_id: value.user_id,
            role: ApiParticipantListRole::new_from_domain(value.role),
            joined_at: value.joined_at,
            left_at: value.left_at,
        }
    }
}

/// Channel list response item.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ApiChannelWithLatest {
    /// Channel id.
    pub id: Uuid,
    /// Channel name.
    pub name: Option<String>,
    /// Channel type.
    pub channel_type: ApiChannelListType,
    /// Organization id.
    #[schema(value_type = Option<u32>)]
    pub org_id: Option<u32>,
    /// Team id.
    pub team_id: Option<Uuid>,
    /// Whether team members automatically join the channel.
    pub auto_join_team: bool,
    /// Channel creation timestamp.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Channel last-updated timestamp.
    pub updated_at: chrono::DateTime<chrono::Utc>,
    /// Channel owner user id.
    pub owner_id: String,
    /// Active participants.
    pub participants: Vec<ApiChannelListParticipant>,
    /// Whether the requesting user is an active participant of the channel.
    pub is_participant: bool,
    /// Latest message including thread replies.
    pub latest_message: Option<ApiChannelListMessage>,
    /// Latest top-level non-thread message.
    pub latest_non_thread_message: Option<ApiChannelListMessage>,
    /// Last viewed timestamp for requesting user.
    pub viewed_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Last interaction timestamp for requesting user.
    pub interacted_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Aggregate frecency score.
    pub frecency_score: Option<f64>,
}

/// A cursor-paginated channel list response.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ApiChannelListPage {
    /// Channels in this page.
    pub items: Vec<ApiChannelWithLatest>,
    /// Opaque cursor for the next page, if one exists.
    pub next_cursor: Option<String>,
}

impl ApiChannelWithLatest {
    fn new_from_domain(value: ChannelWithLatest) -> Self {
        let ch = ApiChannelListItem::new_from_domain(value.channel.channel);
        let latest = ApiLatestMessage::new_from_domain(value.latest_message);
        Self {
            id: ch.id,
            name: ch.name,
            channel_type: ch.channel_type,
            org_id: ch.org_id,
            team_id: ch.team_id,
            auto_join_team: ch.auto_join_team,
            created_at: ch.created_at,
            updated_at: ch.updated_at,
            owner_id: ch.owner_id.to_string(),
            participants: value
                .channel
                .participants
                .into_iter()
                .map(ApiChannelListParticipant::new_from_domain)
                .collect(),
            is_participant: value.channel.is_participant,
            latest_message: latest.latest_message,
            latest_non_thread_message: latest.latest_non_thread_message,
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
pub struct ApiChannelListItem {
    /// uuid of the channel
    pub id: Uuid,
    /// string name of the channel
    pub name: Option<String>,
    /// type of the channel
    pub channel_type: ApiChannelListType,
    /// id of the organization this channel belongs too
    #[schema(value_type = Option<u32>)]
    pub org_id: Option<u32>,
    /// id of the team this channel belongs to
    pub team_id: Option<Uuid>,
    /// whether team members automatically join the channel
    pub auto_join_team: bool,
    /// timestamp of when the channel was created
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// timestamp of when the channel was last updated
    pub updated_at: chrono::DateTime<chrono::Utc>,
    /// id of the user who created the channel
    #[schema(value_type = String)]
    pub owner_id: MacroUserIdStr<'static>,
}

impl ApiChannelListItem {
    fn new_from_domain(value: ChannelListItem) -> Self {
        Self {
            id: value.id,
            name: value.name,
            channel_type: ApiChannelListType::new_from_domain(value.channel_type),
            org_id: value.org_id.and_then(|org_id| u32::try_from(org_id).ok()),
            team_id: value.team_id,
            auto_join_team: value.auto_join_team,
            created_at: value.created_at,
            updated_at: value.updated_at,
            owner_id: value.owner_id,
        }
    }
}

/// Latest-message bundle in API responses.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ApiLatestMessage {
    /// Latest message including thread replies.
    pub latest_message: Option<ApiChannelListMessage>,
    /// Latest non-thread top-level message.
    pub latest_non_thread_message: Option<ApiChannelListMessage>,
}

impl ApiLatestMessage {
    fn new_from_domain(value: crate::domain::models::LatestMessage) -> Self {
        Self {
            latest_message: value
                .latest_message
                .map(ApiChannelListMessage::new_from_recent),
            latest_non_thread_message: value
                .latest_non_thread_message
                .map(ApiChannelListMessage::new_from_recent),
        }
    }
}

/// Channel type in API responses.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApiChannelListType {
    /// Public channel.
    Public,
    /// Private channel.
    Private,
    /// Direct message channel.
    DirectMessage,
    /// Team channel.
    Team,
}

impl ApiChannelListType {
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
pub struct ApiChannelListMessage {
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

impl ApiChannelListMessage {
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
