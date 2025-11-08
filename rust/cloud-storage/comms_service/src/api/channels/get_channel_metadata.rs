use crate::{
    api::{
        context::AppState,
        extractors::{ChannelId, ChannelMember},
    },
    utils::channel_name::resolve_channel_name,
};
use anyhow::Result;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use axum_extra::extract::Cached;
use comms_db_client::participants::get_participants::get_participants;
#[allow(unused_imports)]
use model::comms::{Channel, ChannelType};
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChannelMetadataResponse {
    pub channel_name: String,
    pub channel_type: ChannelType,
}

#[derive(Deserialize, Debug)]
pub struct UserIdQuery {
    pub user_id: Option<String>,
}

#[tracing::instrument(skip(db))]
pub async fn get_channel_name_and_type(
    db: &Pool<Postgres>,
    channel_id: &Uuid,
    user_id: &str,
) -> Result<(String, ChannelType)> {
    let channel_row = sqlx::query!(
        r#"
        SELECT
            id,
            name,
            channel_type AS "channel_type: ChannelType",
            org_id,
            created_at,
            updated_at,
            owner_id
        FROM comms_channels
        WHERE id = $1
        "#,
        channel_id
    )
    .fetch_one(db)
    .await?;

    let channel = Channel {
        id: channel_row.id,
        name: channel_row.name,
        channel_type: channel_row.channel_type,
        org_id: channel_row.org_id,
        created_at: channel_row.created_at,
        updated_at: channel_row.updated_at,
        owner_id: channel_row.owner_id,
    };

    let participants = get_participants(db, channel_id).await?;

    let channel_name = resolve_channel_name(
        &channel.channel_type,
        channel.name.as_deref(),
        &participants,
        channel_id,
        user_id,
        None,
    );

    Ok((channel_name, channel.channel_type))
}

/// External handler with channel access middleware
#[tracing::instrument(skip(ctx))]
pub async fn handler_external(
    State(ctx): State<AppState>,
    Cached(ChannelMember(channel_member)): Cached<ChannelMember>,
    Cached(ChannelId(channel_id)): Cached<ChannelId>,
) -> Result<Response, Response> {
    let (channel_name, channel_type) =
        get_channel_name_and_type(&ctx.db, &channel_id, &channel_member.context.user_id)
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

/// Internal handler without authentication
#[tracing::instrument(skip(ctx))]
pub async fn handler_internal(
    State(ctx): State<AppState>,
    Path(channel_id): Path<Uuid>,
    Query(query): Query<UserIdQuery>,
) -> Result<Response, Response> {
    let user_id = query.user_id.as_deref().unwrap_or("");

    let (channel_name, channel_type) = get_channel_name_and_type(&ctx.db, &channel_id, user_id)
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
