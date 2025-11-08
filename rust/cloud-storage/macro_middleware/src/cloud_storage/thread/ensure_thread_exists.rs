use crate::error_handler::error_handler;
use anyhow::Context;
use axum::extract::{Path, Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use email_service_client::EmailServiceClient;
use model::thread::EmailThreadPermission;
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;
use serde::Deserialize;
use sqlx::{PgPool, Pool, Postgres};
use std::sync::Arc;

#[derive(Deserialize)]
pub struct ThreadParams {
    pub thread_id: String,
}

/// Validates the thread exists and inserts EmailThreadPermission into req context
pub async fn handler(
    State(db): State<PgPool>,
    State(email_client): State<Arc<EmailServiceClient>>,
    Path(ThreadParams { thread_id }): Path<ThreadParams>,
    mut req: Request,
    next: Next,
) -> Result<Response, Response> {
    let permission = insert_thread_share_permissions(&db, &email_client, &thread_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to ensure thread exists");
            error_handler("unknown error occurred", StatusCode::INTERNAL_SERVER_ERROR)
        })?;

    req.extensions_mut().insert(permission);
    Ok(next.run(req).await)
}

// insert SharePermission and EmailThreadPermission for thread if it doesn't already exist.
pub async fn insert_thread_share_permissions(
    db: &Pool<Postgres>,
    email_service_client: &email_service_client::EmailServiceClient,
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
    let owner_result = email_service_client
        .get_thread_owner(thread_id)
        .await
        .context("Failed to get thread owner from email-service")?;

    let owner_id = owner_result.user_id.to_string();

    // Create a new share permission
    let share_permission = SharePermissionV2 {
        id: macro_uuid::generate_uuid_v7().to_string(),
        is_public: false,
        public_access_level: None,
        owner: owner_id.clone(),
        channel_share_permissions: None,
    };

    let mut tx = db.begin().await.context("Failed to start transaction")?;

    let permission = macro_db_client::share_permission::create::create_thread_permission(
        &mut tx,
        &owner_id,
        thread_id,
        &share_permission,
    )
    .await
    .context("failed to create thread permission")?;

    // insert UserItemAccess for owner
    macro_db_client::item_access::insert::insert_user_item_access(
        &mut tx,
        &owner_id,
        thread_id,
        "thread",
        AccessLevel::Owner,
        None,
    )
    .await
    .context("failed to insert UserItemAccess row for owner")?;

    tx.commit().await.context("failed to commit transaction")?;

    Ok(permission)
}
