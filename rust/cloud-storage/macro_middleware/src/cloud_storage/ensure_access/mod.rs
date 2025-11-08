pub mod chat;
pub mod document;
pub mod history;
pub mod macros;
pub mod pin;
pub mod project;
pub mod thread;

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use models_permissions::share_permission::access_level::{
    AccessLevel, CommentAccessLevel, EditAccessLevel, OwnerAccessLevel,
};
use models_permissions::share_permission::channel_share_permission::ChannelSharePermission;
use models_permissions::share_permission::{SharePermissionV2, access_level::ViewAccessLevel};
use std::str::FromStr;
use std::time::Instant;
use thiserror::Error;

use sqlx::{Pool, Postgres};
use uuid::Uuid;

/// trait which turns a Unit struct into a [AccessLevel]
pub(crate) trait BuildAccessLevel: std::fmt::Debug {
    fn into_access_level() -> AccessLevel;
}

impl BuildAccessLevel for ViewAccessLevel {
    fn into_access_level() -> AccessLevel {
        AccessLevel::View
    }
}

impl BuildAccessLevel for EditAccessLevel {
    fn into_access_level() -> AccessLevel {
        AccessLevel::Edit
    }
}

impl BuildAccessLevel for OwnerAccessLevel {
    fn into_access_level() -> AccessLevel {
        AccessLevel::Owner
    }
}

impl BuildAccessLevel for CommentAccessLevel {
    fn into_access_level() -> AccessLevel {
        AccessLevel::Comment
    }
}

#[derive(Debug, Error)]
pub enum AccessLevelErr {
    #[error("{}", .0.1)]
    DbErr((StatusCode, String)),
    #[error("User does not have access to the desired resource")]
    UnAuthorized,
    #[error("{0}")]
    UnAuthorizedWithMsg(&'static str),
    #[error("No macro_prompt_id was included in the request")]
    BadRequest,
    #[error("Internal server error")]
    InternalErr,
}

impl IntoResponse for AccessLevelErr {
    fn into_response(self) -> Response {
        match &self {
            AccessLevelErr::DbErr(e) => (e.0, self.to_string()).into_response(),
            AccessLevelErr::UnAuthorized => {
                (StatusCode::UNAUTHORIZED, self.to_string()).into_response()
            }
            AccessLevelErr::UnAuthorizedWithMsg(_) => {
                (StatusCode::UNAUTHORIZED, self.to_string()).into_response()
            }
            AccessLevelErr::BadRequest => {
                (StatusCode::BAD_REQUEST, self.to_string()).into_response()
            }
            AccessLevelErr::InternalErr => {
                (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()).into_response()
            }
        }
    }
}

/// Gets the users AccessLevel for a given item
/// This is for the new permission system
#[tracing::instrument(skip(db, comms_service_client))]
pub async fn get_users_access_level_v2(
    db: &Pool<Postgres>,
    comms_service_client: &comms_service_client::CommsServiceClient,
    user_id: &str,
    item_id: &str,
    item_type: &str,
) -> Result<Option<AccessLevel>, (StatusCode, String)> {
    // it's much faster to check access level using UserItemAccess, if supported
    if matches!(item_type, "document" | "chat" | "project" | "thread") {
        return get_highest_access_level(db, user_id, item_id, item_type).await;
    }

    let start_time = Instant::now();
    let share_permissions: Vec<SharePermissionV2> = match item_type {
        "macro" => {
            let share_permission =
                macro_db_client::share_permission::get::get_macro_share_permission(db, item_id)
                    .await
                    .map_err(|_e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "failed to get macro share permission".to_string(),
                        )
                    })?;

            Ok(vec![share_permission])
        }
        "channel" => {
            let channel_id = Uuid::from_str(item_id)
                .map_err(|_| (StatusCode::BAD_REQUEST, "invalid channel id".to_string()))?;
            let user_channels = comms_service_client
                .check_channels_for_user(user_id, &[channel_id])
                .await
                .map_err(|err| {
                    tracing::error!(error=?err, "internal server error checking channel membership");
                    (StatusCode::INTERNAL_SERVER_ERROR, "internal server error".to_string())
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
        .map_err(|e: (StatusCode, String)| {
            tracing::error!(error=?e, "failed to get user permission");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to get user permission".to_string(),
            )
        })?;

    // Check if the user is an owner in any of the share permissions
    let is_owner = share_permissions
        .iter()
        .any(|share_permission| share_permission.owner == user_id);

    if is_owner {
        tracing::trace!("user is owner of a share permission");
        return Ok(Some(AccessLevel::Owner));
    }

    // Get all public share permission access levels
    let mut access_levels: Vec<AccessLevel> = share_permissions
        .iter()
        .filter_map(|share_permission| {
            if share_permission.is_public {
                Some(
                    share_permission
                        .public_access_level
                        .unwrap_or(AccessLevel::View),
                )
            } else {
                None
            }
        })
        .collect();

    // Get all channel share permissions and get user's highest access level from it if it exists
    let channel_share_permissions: Vec<ChannelSharePermission> = share_permissions
        .into_iter()
        .flat_map(|share_permission| {
            share_permission
                .channel_share_permissions
                .unwrap_or_default()
        })
        .collect();

    // Add the highest access level from the channel if it exists
    if !channel_share_permissions.is_empty() {
        tracing::trace!("channel share permissions exist");
        let channel_ids: Vec<Uuid> = channel_share_permissions
            .iter()
            .filter_map(|channel_share_permission| {
                Uuid::from_str(channel_share_permission.channel_id.as_str()).ok()
            })
            .collect();

        let user_channels = comms_service_client
            .check_channels_for_user(user_id, &channel_ids)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "failed to get user channels");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "failed to get user channels".to_string(),
                )
            })?;

        tracing::trace!("user has channels");
        let user_channels: Vec<String> = user_channels
            .iter()
            .map(|channel| channel.to_string())
            .collect();

        let user_access_levels: Vec<AccessLevel> = channel_share_permissions
            .iter()
            .filter_map(|channel_share_permission| {
                if user_channels.contains(&channel_share_permission.channel_id.to_string()) {
                    Some(channel_share_permission.access_level)
                } else {
                    None
                }
            })
            .collect();

        access_levels.extend(user_access_levels);
    }

    tracing::trace!(elapsed_time = ?start_time.elapsed(), "get_users_access_level_v2 took");

    if access_levels.is_empty() {
        Ok(None)
    } else {
        // Sort access levels from lowest to highest
        access_levels.sort();
        Ok(Some(*access_levels.last().unwrap()))
    }
}

/// Gets the users AccessLevel for a given item using UserItemAccess and SharePermissions
#[tracing::instrument(skip(db))]
pub async fn get_highest_access_level(
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
