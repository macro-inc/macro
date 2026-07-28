use crate::api::context::AuthorizationService;
use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_db_client::user::onboarding_status::get_onboarding_status;
use sqlx::PgPool;

pub async fn handler(
    State(db): State<PgPool>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    req: Request,
    next: Next,
) -> Result<Response, (StatusCode, String)> {
    let is_onboarded = get_onboarding_status(&db, user.authorization.user.macro_user_id.as_ref())
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
