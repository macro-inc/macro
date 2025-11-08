use axum::{
    Extension,
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::api::MACRO_IT_PANEL_PERMISSION;

use model::user::UserContext;

/// Ensures the user has the correct permission(s) for access
pub(in crate::api) async fn handler(
    user_context: Extension<UserContext>,
    req: Request,
    next: Next,
) -> Result<Response, Response> {
    let permissions = user_context
        .permissions
        .as_ref()
        .expect("permissions must be supplied");
    if !permissions.contains(MACRO_IT_PANEL_PERMISSION) {
        return Err(StatusCode::UNAUTHORIZED.into_response());
    }

    Ok(next.run(req).await)
}
