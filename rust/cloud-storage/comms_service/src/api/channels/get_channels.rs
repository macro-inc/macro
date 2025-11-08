use crate::{
    api::context::AppState,
    utils::{channel_name::resolve_channel_name, user_name::generate_name_lookup},
};
use anyhow::Result;
use axum::{
    Json,
    extract::{Extension, State},
    http::StatusCode,
    response::IntoResponse,
};
use comms_db_client::{
    activity::get_activity::get_activities,
    channels::get_channels::get_user_channels_with_participants,
};
use comms_db_client::{messages::get_latest_channel_messages_batch, model::Activity};
use frecency::domain::ports::AggregateFrecencyStorage;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model::{comms::ChannelWithLatest, user::UserContext};
use model_entity::EntityType;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, str::FromStr};
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GetChannelsResponse {
    pub channels: Vec<ChannelWithLatest>,
}

#[derive(Debug, Error)]
pub enum GetChannelsError {
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error("Invalid user id")]
    Id(#[from] macro_user_id::user_id::ParseErr),
}

impl IntoResponse for GetChannelsError {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            GetChannelsError::Sqlx(_) | GetChannelsError::Id(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
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
            (status = 200, body=GetChannelsResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(app_state, user_context), fields(user_id=?user_context.user_id))]
pub async fn get_channels_handler(
    State(app_state): State<AppState>,
    user_context: Extension<UserContext>,
) -> Result<Json<GetChannelsResponse>, GetChannelsError> {
    let db = &app_state.db;

    let channels = get_user_channels_with_participants(db, &user_context.user_id).await?;

    let channel_ids: Vec<Uuid> = channels.iter().map(|c| c.channel.id).collect();

    let (names_res, latest_messages, activities, frecency_score) = futures::join!(
        app_state
            .auth_service_client
            .get_names_from_channels(&channels),
        get_latest_channel_messages_batch(db, &channel_ids),
        get_activities(db, &user_context.user_id),
        app_state.frecency_storage.get_aggregate_for_user_entities(
            MacroUserIdStr::parse_from_str(&user_context.0.user_id)?.into_owned(),
            channel_ids
                .iter()
                .map(|id| EntityType::Channel.with_entity_string(id.to_string()))
        )
    );

    let mut activity_lookup: HashMap<Uuid, Activity> = activities
        .unwrap_or_default()
        .into_iter()
        .map(|a| (a.channel_id, a))
        .collect();

    let frecency_map: HashMap<Uuid, f64> = frecency_score
        .unwrap_or_default()
        .into_iter()
        .filter_map(|f| {
            Some((
                Uuid::from_str(&f.id.entity.entity_id).ok()?,
                f.data.frecency_score,
            ))
        })
        .collect();

    let name_lookup = names_res.ok().map(generate_name_lookup);

    let mut latest_messages = latest_messages.unwrap_or_default();
    // Map a channel to its correct name and latest message
    let channels: Vec<ChannelWithLatest> = channels
        .into_iter()
        .map(|mut channel| {
            let resolved_name = resolve_channel_name(
                &channel.channel.channel_type,
                channel.channel.name.as_deref(),
                &channel.participants,
                &channel.channel.id,
                &user_context.user_id,
                name_lookup.as_ref(),
            );
            channel.channel.name = Some(resolved_name);
            let activity = activity_lookup.remove(&channel.channel.id);
            let viewed_at = activity.as_ref().and_then(|a| a.viewed_at);
            let interacted_at = activity.as_ref().and_then(|a| a.interacted_at);
            let channel_with_latest = ChannelWithLatest {
                channel: channel.clone(),
                latest_message: latest_messages.remove(&channel.channel.id).unwrap_or_default(),
                viewed_at,
                interacted_at,
                frecency_score: frecency_map.get(&channel.channel.id).copied().unwrap_or_default()
            };

            tracing::trace!(channel_type=?channel.channel.channel_type,channel_name=?channel.channel.name, "resolved channel name");
            channel_with_latest
        })
        .collect();

    return Ok(Json(GetChannelsResponse { channels }));
}
