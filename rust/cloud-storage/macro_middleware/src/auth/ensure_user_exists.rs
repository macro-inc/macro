use axum::{Extension, extract::Request, http::StatusCode, middleware::Next, response::Response};

use model::user::UserContext;

/// Ensures that the user has been attached to the context
pub async fn handler(
    user_context: Extension<UserContext>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    if user_context.user_id.is_empty() {
        tracing::warn!("user id is empty");
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(next.run(req).await)
}
