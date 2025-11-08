use std::str::FromStr;

use crate::api::context::ApiContext;
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use macro_middleware::cloud_storage::ensure_access::get_users_access_level_v2;
use macro_middleware::cloud_storage::thread::ensure_thread_exists::insert_thread_share_permissions;
use model::{
    document_storage_service_internal::UpdateChannelSharePermissionRequest,
    item::ShareableItemType,
    response::{ErrorResponse, GenericSuccessResponse},
};
use models_permissions::share_permission::access_level::AccessLevel;

/// Attaches/Removes a given channel from a DSS items share permissions
#[tracing::instrument(skip(ctx, req), fields(channel_id=%req.channel_id, item_id=%req.item_id, item_type=%req.item_type, user_id=%req.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Json(req): Json<UpdateChannelSharePermissionRequest>,
) -> Result<Response, Response> {
    tracing::info!("update_channel_share_permission");

    // if the item type is not a supported shareable item type, return success early
    if ShareableItemType::from_str(&req.item_type).is_err() {
        return Ok((StatusCode::OK, Json(GenericSuccessResponse::default())).into_response());
    }

    // ensure thread share permissions exist before getting access level
    if req.item_type == "thread" {
        insert_thread_share_permissions(&ctx.db, &ctx.email_service_client, &req.item_id)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "failed to insert thread share permissions");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "failed to insert thread share permissions",
                    }),
                )
                    .into_response()
            })?;
    }

    // Get users max access level to the item
    let user_access_level = get_users_access_level_v2(
        &ctx.db,
        &ctx.comms_service_client,
        &req.user_id,
        &req.item_id,
        &req.item_type,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to get user access level");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to get user access level",
            }),
        )
            .into_response()
    })?;

    if user_access_level.is_none() {
        tracing::info!("user does not have access to the item, not modifying share permissions");
        return Ok((
            StatusCode::NOT_MODIFIED,
            Json(ErrorResponse {
                message: "user does not have access to the item, not modifying share permissions",
            }),
        )
            .into_response());
    }

    let channel_share_permission_access_level = AccessLevel::View;

    // Get share permission id
    let share_permission_id = macro_db_client::share_permission::get::get_share_permission_id(
        &ctx.db,
        &req.item_id,
        &req.item_type,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to get share permission id");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to get share permission id",
            }),
        )
            .into_response()
    })?;

    if let Err(e) = macro_db_client::share_permission::channel_permission::create::insert_channel_share_permission(
        &ctx.db,
        &share_permission_id,
        &req.channel_id,
        &channel_share_permission_access_level,
    )
        .await
    {
        if e.to_string() == "channel permission already exists" {
            // fail silently. this flow happens when the patch item call made by the FE inserts the CSP
            // before this.
        } else {
            tracing::error!(error=?e, "failed to insert channel share permission");
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to insert channel share permission",
                }),
            ).into_response());
        }
    } else {
        // this flow means the channel share permission is new - the user shared the item directly
        // through a channel message.

        let channel_id = uuid::Uuid::parse_str(&req.channel_id).map_err(|e| {
            tracing::error!(error=?e, "failed to parse channel_id as UUID");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to parse channel_id as UUID",
                }),
            )
                .into_response()
        })?;

        let channel_participants = ctx
            .comms_service_client
            .get_channel_participants(&req.channel_id)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "failed to get channel participants");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "failed to get channel participants",
                    }),
                )
                    .into_response()
            })?
            .into_iter()
            .filter(|p| p.user_id != req.user_id && p.left_at.is_none())
            .map(|p| p.user_id)
            .collect::<Vec<_>>();


        macro_db_client::item_access::insert::upsert_user_item_access_bulk(
            &ctx.db,
            &channel_participants,
            &req.item_id,
            &req.item_type,
            channel_share_permission_access_level,
            Some(channel_id))
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "failed to insert user item access rows");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "failed to insert user item access rows",
                    }),
                )
                    .into_response()
            })?;

    }

    Ok((StatusCode::OK, Json(GenericSuccessResponse::default())).into_response())
}
