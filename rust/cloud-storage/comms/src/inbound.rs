use axum::{Json, Router, extract::State, http::StatusCode, response::IntoResponse, routing::get};
use doppleganger::{Doppleganger, Mirror};
use macro_user_id::user_id::MacroUserIdStr;
use model_user::axum_extractor::MacroUserExtractor;
use models_comms::channel::{ChannelId, OrganizationId};
use serde::Serialize;
use std::sync::Arc;
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::ports::ChannelsService;

struct CommsRouterState<S> {
    inner: Arc<S>,
}

impl<S> Clone for CommsRouterState<S> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<S: ChannelsService> CommsRouterState<S> {
    fn new(s: S) -> Self {
        CommsRouterState { inner: Arc::new(s) }
    }
}

pub fn comms_router<S: ChannelsService, T: Send + Sync + 'static>(s: S) -> Router<T> {
    Router::new()
        .route("/channels", get(get_channels_handler))
        .with_state(CommsRouterState::new(s))
}

#[derive(Debug, Error)]
pub enum CommsErr {
    #[error("Internal server error")]
    Unknown,
}

impl IntoResponse for CommsErr {
    fn into_response(self) -> axum::response::Response {
        let status = match self {
            CommsErr::Unknown => StatusCode::INTERNAL_SERVER_ERROR,
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
        (status = 200, body=Vec<ChannelWithLatest>),
        (status = 401, body=String),
        (status = 404, body=String),
        (status = 500, body=String),
    )
)]
async fn get_channels_handler<S: ChannelsService>(
    State(service): State<CommsRouterState<S>>,
    MacroUserExtractor { macro_user_id, .. }: MacroUserExtractor,
) -> Result<Json<Vec<ChannelWithLatest>>, CommsErr> {
    let res = service
        .inner
        .get_channels(macro_user_id)
        .await
        .map_err(|_| CommsErr::Unknown)?;

    Ok(Json(<Vec<ChannelWithLatest>>::mirror(res)))
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema, Doppleganger)]
#[serde(rename_all = "snake_case")]
#[dg(backward = models_comms::channel::ParticipantRole)]
pub enum ParticipantRole {
    Owner,
    Admin,
    Member,
}

#[derive(Debug, Clone, Serialize, ToSchema, Doppleganger)]
#[dg(backward = models_comms::channel::ChannelParticipant)]
pub struct ChannelParticipant {
    /// id of the channel
    #[schema(value_type = Uuid)]
    pub channel_id: ChannelId,
    /// id of the user
    #[schema(value_type = String)]
    pub user_id: MacroUserIdStr<'static>,
    /// type of the participant
    pub role: ParticipantRole,
    /// timestamp of when the user joined the channel
    pub joined_at: chrono::DateTime<chrono::Utc>,
    /// timestamp of when the user left the channel
    pub left_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Serialize, ToSchema, Doppleganger)]
#[dg(backward = models_comms::channel::ChannelWithParticipants)]
pub struct ChannelWithParticipants {
    #[serde(flatten)]
    pub channel: Channel,
    pub participants: Vec<ChannelParticipant>,
}

#[derive(Debug, Clone, Serialize, ToSchema, Doppleganger)]
#[dg(backward = models_comms::channel::ChannelWithLatest)]
pub struct ChannelWithLatest {
    #[serde(flatten)]
    pub channel: ChannelWithParticipants,
    #[serde(flatten)]
    pub latest_message: LatestMessage,
    pub viewed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub interacted_at: Option<chrono::DateTime<chrono::Utc>>,
    pub frecency_score: f64,
}

#[derive(Debug, Clone, Serialize, ToSchema, Doppleganger)]
#[dg(backward = models_comms::channel::Channel)]
pub struct Channel {
    /// uuid of the channel
    #[schema(value_type = Uuid)]
    pub id: ChannelId,
    /// string name of the channel
    pub name: Option<String>,
    /// type of the channel
    pub channel_type: ChannelType,
    /// id of the organization this channel belongs too
    #[schema(value_type = Option<u32>)]
    pub org_id: Option<OrganizationId>,
    /// timestamp of when the channel was created
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// timestamp of when the channel was last updated
    pub updated_at: chrono::DateTime<chrono::Utc>,
    /// id of the user who created the channel
    #[schema(value_type = String)]
    pub owner_id: MacroUserIdStr<'static>,
}

#[derive(Debug, Clone, ToSchema, Serialize, Doppleganger)]
#[dg(backward = models_comms::channel::LatestMessage)]
pub struct LatestMessage {
    pub latest_message: Option<ChannelMessage>,
    pub latest_non_thread_message: Option<ChannelMessage>,
}

#[derive(Debug, Clone, Copy, Serialize, Doppleganger, ToSchema)]
#[dg(backward = models_comms::channel::ChannelType)]
#[serde(rename_all = "snake_case")]
pub enum ChannelType {
    Public,
    Organization,
    Private,
    DirectMessage,
}

#[derive(Debug, Clone, Serialize, ToSchema, Doppleganger)]
#[dg(backward = models_comms::channel::ChannelMessage)]
pub struct ChannelMessage {
    pub message_id: Uuid,
    pub thread_id: Option<Uuid>,
    pub sender_id: String,
    pub content: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
    /// message mentions formatted as `{ENTITY_TYPE}:{ENTITY_ID}`
    pub mentions: Vec<String>,
}
