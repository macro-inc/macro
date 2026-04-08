use axum::http::StatusCode;
pub use model_entity::EntityType;
use models_permissions::share_permission::access_level::AccessLevel;
use std::str::FromStr;
use std::time::Instant;

use sqlx::{Pool, Postgres};
use uuid::Uuid;

/// Gets the users AccessLevel for a given item
/// This is for the new permission system
#[tracing::instrument(skip(db))]
pub async fn get_users_access_level_v2(
    db: &Pool<Postgres>,
    user_id: &str,
    item_id: &str,
    item_type: &str,
) -> Result<Option<AccessLevel>, (StatusCode, String)> {
    // it's much faster to check access level using UserItemAccess, if supported
    if matches!(item_type, "document" | "chat" | "project" | "thread") {
        return get_highest_access_level(db, user_id, item_id, item_type).await;
    }

    // We need to simply check if the user is part of the channel
    match item_type {
        "channel" => {
            let channel_id = Uuid::from_str(item_id)
                .map_err(|_| (StatusCode::BAD_REQUEST, "invalid channel id".to_string()))?;

            let user_channels = macro_db_client::share_permission::get::check_channels_for_user(
                db,
                user_id,
                &[channel_id],
            )
            .await
            .map_err(|err| {
                tracing::error!(error=?err, "internal server error checking channel membership");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal server error".to_string(),
                )
            })?;

            if !user_channels.contains(&channel_id) {
                return Err((StatusCode::UNAUTHORIZED, "permission".to_string()));
            }
            return Ok(Some(AccessLevel::View));
        }
        _ => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("unsupported item type {item_type}"),
            ));
        }
    }
}

/// Gets the users AccessLevel for a given item using UserItemAccess and SharePermissions
#[tracing::instrument(skip(db))]
async fn get_highest_access_level(
    db: &Pool<Postgres>,
    user_id: &str,
    item_id: &str,
    item_type: &str,
) -> Result<Option<AccessLevel>, (StatusCode, String)> {
    let start_time = Instant::now();

    let highest_access_level: Option<AccessLevel> = match item_type {
        "document" => {
            macro_db_client::share_permission::access_level::document::get_highest_access_level_for_document(
                db, item_id, user_id,
            )
            .await
        }
        "chat" => {
            macro_db_client::share_permission::access_level::chat::get_highest_access_level_for_chat(
                db, item_id, user_id,
            )
            .await
        }
        "project" => {
            macro_db_client::share_permission::access_level::project::get_highest_access_level_for_project(
                db, item_id, user_id,
            )
            .await
        }
        "thread" => {
            macro_db_client::share_permission::access_level::thread::get_highest_access_level_for_thread(
                db, item_id, user_id,
            )
            .await
        }
        _ => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("unsupported item type {item_type}"),
            ));
        }
    }
    .map_err(|e| {
        tracing::error!(error=?e, "failed to get user access level");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to get user access level".to_string(),
        )
    })?;

    tracing::debug!(elapsed_time = ?start_time.elapsed(), "get_user_item_access_level took");

    // return the highest level of access the user has to the item
    Ok(highest_access_level)
}
