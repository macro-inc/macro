use axum::{
    Extension, Json,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use macro_user_id::user_id::MacroUserId;
use model::{response::ErrorResponse, user::UserContext};
use sqlx::PgPool;
use user_quota::UserQuota;

/// Checks if the user has a valid quota for document creation
#[tracing::instrument(skip(db, user_context, req, next), fields(user_id=?user_context.user_id))]
pub async fn document_handler(
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    req: Request,
    next: Next,
) -> Result<Response, Response> {
    if let Some(permissions) = user_context.permissions.as_ref() {
        // This is hard-coded for the permission since we don't want to introduce another
        // dependency here
        if permissions.contains("read:professional_features") {
            return Ok(next.run(req).await);
        }

        let user_quota = get_user_quota(&db, &user_context.user_id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response())?;

        if user_quota.documents + 1 > user_quota.max_documents.into() {
            return Err((StatusCode::FORBIDDEN, "USER_QUOTA_EXCEEDED").into_response());
        }
        Ok(next.run(req).await)
    } else {
        Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "no permissions were found for user",
            }),
        )
            .into_response())
    }
}

/// Checks if the user has a valid quota for ai chat message creation
pub async fn ai_chat_message_handler(
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    req: Request,
    next: Next,
) -> Result<Response, Response> {
    if let Some(permissions) = user_context.permissions.as_ref() {
        // This is hard-coded for the permission since we don't want to introduce another
        // dependency here
        if permissions.contains("read:professional_features") {
            return Ok(next.run(req).await);
        }

        let user_quota = get_user_quota(&db, &user_context.user_id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response())?;

        if user_quota.ai_chat_messages + 1 > user_quota.max_ai_chat_messages.into() {
            return Err((StatusCode::FORBIDDEN, "USER_QUOTA_EXCEEDED").into_response());
        }
        Ok(next.run(req).await)
    } else {
        Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "no permissions were found for user",
            }),
        )
            .into_response())
    }
}

async fn get_user_quota(db: &PgPool, user_id: &str) -> anyhow::Result<UserQuota> {
    let user_id = MacroUserId::parse_from_str(user_id)?.lowercase();

    macro_db_client::user_quota::get_user_quota(db, &user_id).await
}
