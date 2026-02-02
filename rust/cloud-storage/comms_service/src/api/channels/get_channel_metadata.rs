use crate::api::{
    context::AppState,
    extractors::{ChannelId, ChannelMember},
};
use anyhow::Result;
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use axum_extra::extract::Cached;
use comms::domain::models::channel_name::resolve_channel_name;
use comms_db_client::participants::get_participants::get_participants;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_comms::channel::OrganizationId;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChannelMetadataResponse {
    pub channel_name: String,
    pub channel_type: model::comms::ChannelType,
}

#[tracing::instrument(skip(db))]
pub async fn get_channel_name_and_type(
    db: &Pool<Postgres>,
    channel_id: &models_comms::channel::ChannelId,
    user_id: MacroUserIdStr<'_>,
) -> Result<(String, model::comms::ChannelType)> {
    let channel = sqlx::query!(
        r#"
        SELECT
            id,
            name,
            channel_type AS "channel_type: model::comms::ChannelType",
            org_id,
            created_at,
            updated_at,
            owner_id
        FROM comms_channels
        WHERE id = $1
        "#,
        channel_id.0
    )
    .try_map(|channel_row| {
        Ok(model::comms::Channel {
            id: models_comms::channel::ChannelId(channel_row.id),
            name: channel_row.name,
            channel_type: channel_row.channel_type,
            org_id: channel_row.org_id.map(|i| OrganizationId(i as u32)),
            created_at: channel_row.created_at,
            updated_at: channel_row.updated_at,
            owner_id: MacroUserIdStr::parse_from_str(&channel_row.owner_id)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
                .into_owned(),
        })
    })
    .fetch_one(db)
    .await?;

    let participants = get_participants(db, &channel_id.0).await?;

    let channel_name = resolve_channel_name(
        &match channel.channel_type {
            model::comms::ChannelType::Public => models_comms::channel::ChannelType::Public,
            model::comms::ChannelType::Organization => {
                models_comms::channel::ChannelType::Organization
            }
            model::comms::ChannelType::Private => models_comms::channel::ChannelType::Private,
            model::comms::ChannelType::DirectMessage => {
                models_comms::channel::ChannelType::DirectMessage
            }
        },
        channel.name.as_deref(),
        &participants,
        channel_id,
        user_id,
        &Default::default(),
    );

    Ok((channel_name, channel.channel_type))
}

/// External handler with channel access middleware
#[tracing::instrument(skip(ctx))]
#[axum::debug_handler]
pub async fn handler_external(
    State(ctx): State<AppState>,
    Cached(ChannelMember(channel_member)): Cached<ChannelMember>,
    Cached(ChannelId(channel_id)): Cached<ChannelId>,
) -> Result<Response, Response> {
    let (channel_name, channel_type) = get_channel_name_and_type(
        &ctx.db,
        &models_comms::channel::ChannelId(channel_id),
        channel_member.user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to get channel metadata");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to get channel metadata",
        )
            .into_response()
    })?;

    let response = ChannelMetadataResponse {
        channel_name,
        channel_type,
    };

    Ok((StatusCode::OK, Json(response)).into_response())
}
