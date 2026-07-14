use axum::{
    Extension,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use macro_db_client::user::onboarding_status::get_onboarding_status;
use model::user::UserContext;
use sqlx::PgPool;

pub async fn handler(
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    req: Request,
    next: Next,
) -> Result<Response, (StatusCode, String)> {
    let is_onboarded = get_onboarding_status(&db, user_context.user_id.as_str())
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get onboarding status: {}", e),
            )
        })?;

    if is_onboarded {
        return Err((
            StatusCode::FORBIDDEN,
            "User is already onboarded".to_string(),
        ));
    }

    Ok(next.run(req).await)
}
