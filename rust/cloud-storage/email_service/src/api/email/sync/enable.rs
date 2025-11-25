use crate::api::context::ApiContext;
use crate::utils::extract_email_with_response;
use anyhow::Context;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use macro_user_id::email::EmailStr;
use macro_user_id::user_id::MacroUserIdStr;
use model::response::{EmptyResponse, ErrorResponse};
use model::user::UserContext;
use models_email::email::service::link;
use models_email::email::service::link::Link;
use models_email::email::service::link::UserProvider;
use strum_macros::AsRefStr;
use thiserror::Error;

#[derive(Debug, Error, AsRefStr)]
pub enum EnableSyncError {
    #[error("Syncing is already enabled")]
    SyncAlreadyEnabled,

    #[error("Failed to register Gmail watch")]
    RegisterWatchError(#[from] anyhow::Error),

    #[error("Database query error")]
    QueryError(#[from] sqlx::Error),

    #[error("Bad request")]
    BadRequest(String),

    #[error("Invalid input")]
    Parse(#[from] macro_user_id::error::ParseErr),
}

impl IntoResponse for EnableSyncError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            EnableSyncError::SyncAlreadyEnabled
            | EnableSyncError::BadRequest(_)
            | EnableSyncError::Parse(_) => StatusCode::BAD_REQUEST,
            EnableSyncError::RegisterWatchError(_) | EnableSyncError::QueryError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        if status_code.is_server_error() {
            tracing::error!(
                nested_error = ?self,
                error_type = "EnableSyncError",
                variant = self.as_ref(),
                "Internal server error");
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Enables inbox syncing for user.
#[utoipa::path(
    post,
    tag = "Sync",
    path = "/email/sync",
    operation_id = "enable_sync",
    responses(
            (status = 201, body=EmptyResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn enable_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> Result<Response, EnableSyncError> {
    // if link exists already and syncing is already enabled, return error
    let existing_link = email_db_client::links::get::fetch_link_by_fusionauth_and_macro_id(
        &ctx.db,
        &user_context.fusion_user_id,
        &user_context.user_id,
        UserProvider::Gmail,
    )
    .await
    .context("Failed to fetch link")?;

    if let Some(link) = existing_link
        && link.is_sync_active
    {
        return Err(EnableSyncError::SyncAlreadyEnabled);
    }

    enable_gmail_sync(&ctx, &user_context, None).await?;

    Ok((StatusCode::CREATED, Json(EmptyResponse::default())).into_response())
}

/// Enables Gmail sync for a user by A) registering a watch with Gmail API B) updating the link record
/// to is_sync_active = true and C) updating gmail_histories entry with the current history value.
#[tracing::instrument(skip(ctx, user_context, gmail_access_token), level = "info")]
pub async fn enable_gmail_sync(
    ctx: &ApiContext,
    user_context: &UserContext,
    gmail_access_token: Option<&str>,
) -> Result<Link, EnableSyncError> {
    let token = match gmail_access_token {
        Some(token) => token.to_string(),
        None => crate::util::gmail::auth::fetch_gmail_token_usercontext_response(
            user_context,
            &ctx.redis_client,
            &ctx.auth_service_client,
        )
        .await
        .map_err(|_| EnableSyncError::BadRequest("Failed to fetch Gmail token".to_string()))?,
    };

    // Register watch with Gmail
    let watch_response = ctx
        .gmail_client
        .register_watch(&token)
        .await
        .context("Gmail call to register watch failed")?;

    let email = extract_email_with_response(&user_context.user_id)
        .map_err(|_| EnableSyncError::BadRequest("Failed to extract email".to_string()))?;

    let mut link = link::Link {
        id: macro_uuid::generate_uuid_v7(), // will get ignored for existing links
        macro_id: MacroUserIdStr::try_from(user_context.user_id.clone())?,
        fusionauth_user_id: user_context.fusion_user_id.clone(),
        email_address: EmailStr::try_from(email)?,
        provider: UserProvider::Gmail,
        is_sync_active: true,
        created_at: Default::default(),
        updated_at: Default::default(),
    };

    // either create new link for user or update is_sync_active to true
    link = email_db_client::links::insert::upsert_link(&ctx.db, link)
        .await
        .context("Failed to upsert link")?;

    // either create gmail_histories value or update history_id to current value
    email_db_client::histories::upsert_gmail_history(&ctx.db, link.id, &watch_response.history_id)
        .await
        .context("Failed to upsert gmail history")?;

    Ok(link)
}
