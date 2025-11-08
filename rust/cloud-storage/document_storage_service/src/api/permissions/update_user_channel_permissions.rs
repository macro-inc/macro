use crate::api::context::ApiContext;
use anyhow::Context;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use model::document_storage_service_internal::UpdateUserChannelPermissionsRequest;
use model::response::{ErrorResponse, GenericSuccessResponse};
use models_permissions::share_permission::channel_share_permission::UpdateOperation;
use models_permissions::user_item_access::UserItemAccess;
use sqlx::PgPool;
use uuid::Uuid;

/// Adds or removes permissions for a user for all items in a channel they were just added to/removed from.
#[tracing::instrument(skip(ctx, req), fields(channel_id=%req.channel_id, user_ids=?req.user_ids))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Json(req): Json<UpdateUserChannelPermissionsRequest>,
) -> Result<Response, Response> {
    let channel_id = macro_uuid::string_to_uuid(&req.channel_id).map_err(|e| {
        tracing::error!(error=?e, "failed to parse channel_id as UUID");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "invalid channel id format",
            }),
        )
            .into_response()
    })?;

    // insert
    match req.operation {
        UpdateOperation::Add | UpdateOperation::Replace => {
            add_permissions_for_channel_users(&ctx.db, &req.channel_id, &req.user_ids, channel_id)
                .await
                .map_err(|e| {
                    tracing::error!(error=?e, "failed to add permissions for channel users");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ErrorResponse {
                            message: "failed to add permissions for channel users",
                        }),
                    )
                        .into_response()
                })?;
        }
        UpdateOperation::Remove => {
            remove_permissions_for_channel_users(&ctx.db, channel_id, &req.user_ids)
                .await
                .map_err(|e| {
                    tracing::error!(error=?e, "failed to remove permissions for channel users");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ErrorResponse {
                            message: "failed to remove permissions for channel users",
                        }),
                    )
                        .into_response()
                })?;
        }
    }

    Ok((StatusCode::OK, Json(GenericSuccessResponse::default())).into_response())
}

/// Adds permissions for users who have been added to a channel
#[tracing::instrument(skip(db))]
async fn add_permissions_for_channel_users(
    db: &PgPool,
    channel_id: &str,
    user_ids: &[String],
    channel_uuid: Uuid,
) -> anyhow::Result<()> {
    if user_ids.is_empty() {
        return Ok(());
    }

    let mut items_to_insert: Vec<UserItemAccess> = Vec::new();

    // Get all channel share permissions for the channel
    let csps = macro_db_client::share_permission::channel_permission::get::get_channel_share_permissions_by_channel_id(
        db,
        channel_id,
    )
        .await
        .context("failed to get channel share permissions for channel")?;

    let csp_ids = csps
        .iter()
        .map(|csp| csp.share_permission_id.clone())
        .collect::<Vec<_>>();

    if csp_ids.is_empty() {
        return Ok(());
    }

    // Get all items matching the channel share permission IDs
    let item_type_map =
        macro_db_client::share_permission::get::get_items_by_share_permission_ids(db, &csp_ids)
            .await
            .context("failed to get items for share permission ids")?;

    // For each item, add an entry for each user into UserItemAccess
    for csp in csps {
        if let Some((item_id, item_type)) = item_type_map.get(&csp.share_permission_id) {
            for user_id in user_ids.iter() {
                items_to_insert.push(UserItemAccess {
                    id: macro_uuid::generate_uuid_v7(),
                    user_id: user_id.to_string(),
                    item_id: item_id.to_string(),
                    item_type: item_type.to_string(),
                    access_level: csp.access_level,
                    granted_from_channel_id: Some(channel_uuid),
                    created_at: chrono::Utc::now(),
                    updated_at: chrono::Utc::now(),
                });
            }
        }
    }

    if !items_to_insert.is_empty() {
        // Insert into database
        macro_db_client::item_access::insert::insert_user_item_access_batch(db, &items_to_insert)
            .await
            .context("failed to insert user item access records")?;
    }

    Ok(())
}

/// Removes permissions for users who have been removed from a channel
#[tracing::instrument(skip(db))]
async fn remove_permissions_for_channel_users(
    db: &PgPool,
    channel_id: Uuid,
    user_ids: &[String],
) -> anyhow::Result<u64> {
    if user_ids.is_empty() {
        return Ok(0);
    }

    // Delete all UserItemAccess records for these users granted from this channel
    let rows_affected =
        macro_db_client::item_access::delete::delete_user_item_access_by_channel_and_users(
            db, channel_id, user_ids,
        )
        .await
        .context("failed to delete user item access records")?;

    Ok(rows_affected)
}
