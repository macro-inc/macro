use crate::error_handler::error_handler;
use axum::{
    Extension,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use model::user::UserContext;
use sqlx::PgPool;

/// Attaches user permissions to the UserContext
#[tracing::instrument(skip(db, user_context, req, next), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    mut req: Request,
    next: Next,
) -> Result<Response, Response> {
    let permissions = match macro_db_client::user::get_permissions::get_user_permissions(
        &db,
        &user_context.user_id,
    )
    .await
    {
        Ok(permissions) => permissions,
        Err(e) => {
            tracing::error!(error=?e, user_id=?user_context.user_id, "unable to get user permissions");
            return Err(error_handler(
                "unable to get user permissions",
                StatusCode::INTERNAL_SERVER_ERROR,
            ));
        }
    };

    // Attach user permissions to the UserContext
    req.extensions_mut().insert(UserContext {
        user_id: user_context.user_id.clone(),
        fusion_user_id: user_context.fusion_user_id.clone(),
        permissions: Some(permissions),
        organization_id: user_context.organization_id,
    });

    Ok(next.run(req).await)
}
