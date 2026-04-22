use crate::error_handler::error_handler;
use anyhow::Context;
use axum::extract::{Path, Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model::thread::EmailThreadPermission;
use model_entity::EntityType;
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;
use serde::Deserialize;
use sqlx::{PgPool, Pool, Postgres};

#[derive(Deserialize)]
pub struct ThreadParams {
    pub thread_id: String,
}

/// Validates the thread exists and inserts EmailThreadPermission into req context
pub async fn handler(
    State(db): State<PgPool>,
    Path(ThreadParams { thread_id }): Path<ThreadParams>,
    mut req: Request,
    next: Next,
) -> Result<Response, Response> {
    let permission = insert_thread_share_permissions(&db, &thread_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to ensure thread exists");
            error_handler("unknown error occurred", StatusCode::INTERNAL_SERVER_ERROR)
        })?;

    req.extensions_mut().insert(permission);
    Ok(next.run(req).await)
}

/// Insert SharePermission and EmailThreadPermission for thread if it doesn't already exist.
pub async fn insert_thread_share_permissions(
    db: &Pool<Postgres>,
    thread_id: &str,
) -> anyhow::Result<EmailThreadPermission> {
    // Ensure permissions don't already exist
    let permission =
        macro_db_client::share_permission::get::get_email_thread_permission(db, thread_id)
            .await
            .context("failed to get email thread permission from db")?;

    if let Some(permission) = permission {
        return Ok(permission);
    }

    // Get the thread owner
    let owner_result: Option<String> =
        macro_db_client::share_permission::get::get_macro_id_from_thread_id(db, thread_id)
            .await
            .context("Failed to get thread owner for email")?;

    let owner_id = if let Some(owner_result) = owner_result {
        MacroUserIdStr::parse_from_str(&owner_result)
            .context("invalid macro user id")?
            .into_owned()
    } else {
        anyhow::bail!("thread not found");
    };

    // Create a new share permission
    let share_permission = SharePermissionV2 {
        id: macro_uuid::generate_uuid_v7().to_string(),
        is_public: false,
        public_access_level: None,
        owner: owner_id.to_string(),
        channel_share_permissions: None,
    };

    let mut tx = db.begin().await.context("Failed to start transaction")?;

    let permission = macro_db_client::share_permission::create::create_thread_permission(
        &mut tx,
        owner_id.copied(),
        thread_id,
        &share_permission,
    )
    .await
    .context("failed to create thread permission")?;

    // insert entity_access row for owner
    entity_access_db_utils::insert_entity_access_row(
        &mut tx,
        &macro_uuid::string_to_uuid(thread_id).unwrap(),
        EntityType::EmailThread,
        owner_id.as_ref(),
        entity_access_db_utils::EntityAccessSourceType::User,
        AccessLevel::Owner,
    )
    .await
    .context("failed to insert entity_access row for owner")?;

    tx.commit().await.context("failed to commit transaction")?;

    Ok(permission)
}
